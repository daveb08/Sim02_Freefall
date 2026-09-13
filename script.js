"use strict";

/* ============================================================
   Sim 02b — Freefall Simulator (with optional air resistance)
   Vanilla JS + Canvas. No dependencies, no build step.

   Extends sim02: the motion is now produced by NUMERICAL INTEGRATION
   instead of the closed-form kinematics equations, because with air
   resistance the drag force depends on v^2 and there is no closed form.
   The whole sim (including the no-drag case) uses the same integrator,
   so behavior is consistent whether air is on or off.

   Sign convention (unchanged): UP is positive, the ground is y = state.ground. A
   falling object has negative velocity; y is reported as height above
   ground and is at or above the selected ground; the sim stops exactly at the selected ground.

   Equation of motion (per object), integrated with semi-implicit Euler:
       drag magnitude = 0.5 * Cd * rho * A * v^2   (opposes motion)
       a = -g - k*v*|v|,   where  k = 0.5*Cd*rho*A / m
       v <- v + a*dt
       y <- y + v*dt        (v is negative while falling, so y decreases)
   The  -k*v*|v|  term is +k*v^2 while falling (v<0), i.e. drag points up.
   In a vacuum rho = 0, so k = 0 and a = -g (constant) for every object.
   ============================================================ */

/* ---- Named physical constants (change these to re-gravitate / re-air) ---- */
const G = 9.8;          // m/s^2, gravitational acceleration (Moon: 1.62)
const RHO_SEA = 1.225;  // kg/m^3, air density at sea level

/* Fixed physics timestep, independent of the render frame rate. Small on
   purpose: semi-implicit Euler drifts ~O(dt) over a fall, and a small dt
   keeps the VACUUM case matching the original closed-form sim02 to 2 dp
   (y0=20, v0=0  ->  t=2.02 s, v=-19.80 m/s). Sub-stepping is implicit:
   the whole trajectory is precomputed at this dt, then sampled by time. */
const DT = 1 / 2000;    // s
const STEP_DT = 1 / 60; // s advanced by the "Step" button (one 60 fps frame)
const MAX_T = 300;      // s, safety cap so a pathological object can't hang

/* ---- Object presets: approximate real-world mass / drag coeff / area ---- */
const OBJECTS = {
  feather:    { label: "Feather",      m: 0.001, Cd: 0.7,  A: 0.03  },
  hammer:     { label: "Hammer",       m: 1.0,   Cd: 1.05, A: 0.006 },
  basketball: { label: "Basketball",   m: 0.62,  Cd: 0.47, A: 0.045 },
  bowling:    { label: "Bowling ball", m: 7.0,   Cd: 0.47, A: 0.037 },
  skydiver:   { label: "Skydiver",     m: 75,    Cd: 1.0,  A: 0.4   },
  custom:     { label: "Custom",       m: 1.0,   Cd: 0.5,  A: 0.05  },
};

const COLORS = {
  objA: "#2563eb", // object A - blue
  objB: "#ea580c", // object B - orange
  grid: "#e2e8f0",
  axis: "#334155",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#cbd5e1",
  term: "#94a3b8", // terminal-velocity guide line
};

/* ============================================================
   Simulation state + the two object "slots"
   ============================================================ */
const state = {
  ground: 0,     // Ground coordinate; negative values allow falls below the origin.
  y0: 20,        // initial height (m)
  v0: 0,         // initial velocity (m/s, + = up)
  air: true,     // air resistance on? (rho = RHO_SEA when true, else 0)
  compare: true, // compare two objects side by side?
  speed: 1,      // playback multiplier: sim seconds per wall second
  t: 0,          // shared simulated clock (s)
  tMax: 1,       // latest impact across active objects (for axes / end)
  yTop: 20,      // highest point reached this run (m), for scaling
  playing: false,
  finished: false,
  ranges: { y: [0, 1], v: [0, 1] },
  termLines: [], // terminal-velocity guide lines to draw on the v-graph

  // ---- guided-activity + display options ----
  showV: true,          // draw the velocity arrow?
  showA: true,          // draw the acceleration arrow?
  showFuture: false,    // draw faint future graph curves? (off by default)
  pauseAtApex: false,   // auto-pause at the velocity-zero crossing (toss)?
  investigation: false, // "upward toss investigation" activity active?
  apexT: null,          // time of the v=0 crossing for a single upward toss
  apexConsumed: false,  // already auto-paused at the apex this run?
  atApex: false,        // currently frozen at the apex pause?
};

/* Arrow display scales. Velocity and acceleration have DIFFERENT units, so
   their arrows use independent px scales — students must NOT compare a v arrow
   length against an a arrow length. Lengths are capped so fast/large values
   stay on-screen. In a vacuum a = -g is constant, so the a arrow keeps a
   constant length (and always points down) throughout the flight. */
const VEL_SCALE = 2.2;   // px per (m/s)
const ACC_SCALE = 3.4;   // px per (m/s^2)
const ARROW_MAX = 54;    // px, max arrow length
const ARROW_ZERO_EPS = 0.05; // |value| below this reads as exactly zero

/* A slot holds one object's parameters, color, and its precomputed
   trajectory (arrays sampled every DT, plus the exact impact sample). */
function makeSlot(id, color, presetKey) {
  return {
    id, color, presetKey,
    params: { ...OBJECTS[presetKey] },
    // trajectory (filled by computeTrajectory):
    y: [state.y0], v: [state.v0], n: 1, dt: DT,
    k: 0, terminal: Infinity,
    landed: false, capped: false,           // outcome: genuine impact vs time-limit
    tImpact: 0, vImpact: 0,                  // valid ONLY when landed
    tEnd: 0, yEnd: state.y0, vEnd: state.v0, // trajectory end (impact time or cap)
  };
}
const slotA = makeSlot("A", COLORS.objA, "feather");
const slotB = makeSlot("B", COLORS.objB, "hammer");

/* Which slots are currently in play. */
function activeSlots() { return state.compare ? [slotA, slotB] : [slotA]; }

/* ============================================================
   Physics — integrate one object's whole fall, once, up front.
   ============================================================ */
function computeTrajectory(slot) {
  const { m, Cd, A } = slot.params;
  const rho = state.air ? RHO_SEA : 0;
  const k = 0.5 * Cd * rho * A / m;         // drag / (m*v^2) grouping
  slot.k = k;
  // Terminal velocity magnitude (speed where drag balances gravity):
  //   0.5*Cd*rho*A*vt^2 = m*g  ->  vt = sqrt(2*m*g / (Cd*rho*A))
  slot.terminal = rho > 0 ? Math.sqrt((2 * m * G) / (Cd * rho * A)) : Infinity;

  const dt = DT;
  slot.dt = dt;
  const yArr = [state.y0];
  const vArr = [state.v0];
  let y = state.y0, v = state.v0, t = 0;
  slot.landed = false;
  slot.capped = false;

  // At ground level, only an upward launch has an airborne trajectory.
  // Keep an immediate contact at t=0 without integrating below the ground.
  if (y === state.ground && v <= 0) {
    slot.landed = true;
    slot.tImpact = slot.tEnd = 0;
    slot.vImpact = slot.vEnd = v;
    slot.yEnd = state.ground;
    slot.y = yArr; slot.v = vArr; slot.n = 1;
    return;
  }
  // Semi-implicit (symplectic) Euler: update velocity first, then position.
  while (true) {
    const a = -G - k * v * Math.abs(v);     // drag always opposes velocity
    const vN = v + a * dt;
    const yN = y + vN * dt;
    if (yN <= state.ground) {
      // Genuine ground contact: interpolate the exact crossing in this step.
      const f = (y - state.ground) / (y - yN);               // fraction of the step to the ground
      const tI = t + f * dt;
      const vI = v + (vN - v) * f;
      yArr.push(state.ground);
      vArr.push(vI);
      slot.landed = true;
      slot.tImpact = tI; slot.vImpact = vI;
      slot.tEnd = tI; slot.yEnd = state.ground; slot.vEnd = vI;
      break;
    }
    y = yN; v = vN; t += dt;
    yArr.push(y);
    vArr.push(v);
    if (t > MAX_T) {
      // Time limit reached while still airborne — this is NOT a landing.
      // Keep the real final state; tImpact/vImpact stay null (see slot.landed).
      slot.capped = true;
      slot.tImpact = null; slot.vImpact = null;
      slot.tEnd = t; slot.yEnd = y; slot.vEnd = v;
      break;
    }
  }
  slot.y = yArr;
  slot.v = vArr;
  slot.n = yArr.length;
}

/* Sample an object's state {y, v, a} at an arbitrary time by interpolating
   its precomputed trajectory. Times 0..(n-2)*dt are uniform; the very last
   sample sits at the exact (non-uniform) impact time, handled separately. */
function sampleAt(slot, t) {
  const dt = slot.dt, n = slot.n;
  const tEnd = slot.tEnd;
  if (t >= tEnd) {
    // Frozen at the trajectory's final state: the ground (y = 0) for a genuine
    // landing at the selected ground, or the actual airborne state for a time-limited (capped) run.
    // No assumption that the last sample is ground contact.
    const v = slot.vEnd;
    return { y: slot.yEnd, v, a: -G - slot.k * v * Math.abs(v) };
  }
  let y, v;
  if (slot.landed && t >= (n - 2) * dt) {
    // Final partial interval before a genuine impact only: interpolate
    // sample[n-2] -> (y = 0, vEnd) at the exact impact time.
    const lastUniformT = (n - 2) * dt;
    const frac = (t - lastUniformT) / (tEnd - lastUniformT);
    y = slot.y[n - 2] + (slot.yEnd - slot.y[n - 2]) * frac;
    v = slot.v[n - 2] + (slot.vEnd - slot.v[n - 2]) * frac;
  } else {
    // Uniform interpolation. Covers every capped-trajectory step (evenly
    // spaced right up to the cap) and every non-final landing step — never
    // interpolates toward y = 0 for a capped run.
    const x = t / dt, i = Math.floor(x), f = x - i;
    y = slot.y[i] + (slot.y[i + 1] - slot.y[i]) * f;
    v = slot.v[i] + (slot.v[i + 1] - slot.v[i]) * f;
  }
  return { y, v, a: -G - slot.k * v * Math.abs(v) };
}

/* Time of the first velocity-zero crossing on the way up (the highest point of
   an upward toss), interpolated from the stored samples so it matches the
   trajectory's own timebase. Returns null if the object never rises (v0 <= 0)
   or no +->- crossing exists. Samples are uniformly spaced at dt. */
function findApexTime(slot) {
  const vs = slot.v, dt = slot.dt;
  for (let i = 0; i < slot.n - 1; i++) {
    if (vs[i] >= 0 && vs[i + 1] < 0) {
      const f = vs[i] / (vs[i] - vs[i + 1]); // fraction of the step to v = 0
      return (i + f) * dt;
    }
  }
  return null;
}

/* ============================================================
   DOM references
   ============================================================ */
const el = {
  ground: document.getElementById("ground"),
  y0: document.getElementById("y0"),
  y0num: document.getElementById("y0num"),
  v0: document.getElementById("v0"),
  v0num: document.getElementById("v0num"),
  v0mode: document.getElementById("v0mode"),
  airVacuum: document.getElementById("airVacuum"),
  airOn: document.getElementById("airOn"),
  objA: document.getElementById("objA"),
  objB: document.getElementById("objB"),
  compare: document.getElementById("compare"),
  pickB: document.getElementById("pickB"),
  customA: document.getElementById("customA"),
  customB: document.getElementById("customB"),
  mA: document.getElementById("mA"), cdA: document.getElementById("cdA"), areaA: document.getElementById("areaA"),
  mB: document.getElementById("mB"), cdB: document.getElementById("cdB"), areaB: document.getElementById("areaB"),
  playPause: document.getElementById("playPause"),
  step: document.getElementById("step"),
  reset: document.getElementById("reset"),
  speedBtns: Array.from(document.querySelectorAll(".btn-speed")),
  impact: document.getElementById("impact"),
  impactBadge: document.getElementById("impactBadge"),
  impactText: document.getElementById("impactText"),
  // activity + display options
  presetToss: document.getElementById("presetToss"),
  showV: document.getElementById("showV"),
  showA: document.getElementById("showA"),
  pauseApex: document.getElementById("pauseApex"),
  showFuture: document.getElementById("showFuture"),
  apexHint: document.getElementById("apexHint"),
  activityPanel: document.getElementById("activityPanel"),
  activityQuestion: document.getElementById("activityQuestion"),
  activityObserve: document.getElementById("activityObserve"),
  roA: document.getElementById("roA"), roB: document.getElementById("roB"),
  nameA: document.getElementById("nameA"), nameB: document.getElementById("nameB"),
  impA: document.getElementById("impA"), impB: document.getElementById("impB"),
  tA: document.getElementById("tA"), yA: document.getElementById("yA"), vA: document.getElementById("vA"), aA: document.getElementById("aA"),
  tB: document.getElementById("tB"), yB: document.getElementById("yB"), vB: document.getElementById("vB"), aB: document.getElementById("aB"),
  track: document.getElementById("track"),
  graphY: document.getElementById("graphY"),
  graphV: document.getElementById("graphV"),
};

/* Per-slot readout element bundles, keyed by slot id. `l*` are the label spans
   (swapped to descriptive wording after a genuine impact). */
const RO = {
  A: { block: el.roA, name: el.nameA, imp: el.impA, t: el.tA, y: el.yA, v: el.vA, a: el.aA,
       lt: document.getElementById("rlAt"), ly: document.getElementById("rlAy"),
       lv: document.getElementById("rlAv"), la: document.getElementById("rlAa") },
  B: { block: el.roB, name: el.nameB, imp: el.impB, t: el.tB, y: el.yB, v: el.vB, a: el.aB,
       lt: document.getElementById("rlBt"), ly: document.getElementById("rlBy"),
       lv: document.getElementById("rlBv"), la: document.getElementById("rlBa") },
};

/* Compact symbols during flight; descriptive wording once an object has
   genuinely impacted the ground. */
const READ_LABELS_FLIGHT = { t: "t", y: "y", v: "v", a: "a" };
const READ_LABELS_IMPACT = {
  t: "Impact time", y: "Position",
  v: "Velocity at impact", a: "Acceleration just before impact",
};
function setReadLabels(ro, labels) {
  ro.lt.textContent = labels.t; ro.ly.textContent = labels.y;
  ro.lv.textContent = labels.v; ro.la.textContent = labels.a;
}

/* The two graphs share a time axis; each overlays all active objects. */
const GRAPHS = [
  { key: "y", canvas: el.graphY, title: "Position y",   unit: "m",   rangeKey: "y", get: (s, t) => sampleAt(s, t).y, terminal: false },
  { key: "v", canvas: el.graphV, title: "Velocity", unit: "m/s", rangeKey: "v", get: (s, t) => sampleAt(s, t).v, terminal: true  },
];

/* ============================================================
   Canvas / HiDPI helpers  (unchanged from sim02)
   ============================================================ */
function fitCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return { ctx, w: rect.width, h: rect.height };
}

function niceStep(range, target) {
  if (range <= 0 || !isFinite(range)) return 1;
  const rough = range / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / pow;
  let step;
  if (norm < 1.5) step = 1;
  else if (norm < 3) step = 2;
  else if (norm < 7) step = 5;
  else step = 10;
  return step * pow;
}

function fmt(n, dp = 1) {
  if (Math.abs(n) < 1e-9) n = 0;
  return n.toFixed(dp).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}
function fmt2(n) {
  if (Math.abs(n) < 5e-3) n = 0;
  return n.toFixed(2);
}
function hexToRgba(hex, alpha) {
  const num = parseInt(hex.slice(1), 16);
  const r = (num >> 16) & 255, g = (num >> 8) & 255, b = num & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ============================================================
   Range computation — auto-fit graphs & track to this run
   ============================================================ */
function padRange(lo, hi, includeZero, padFrac = 0.12) {
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * padFrac;
  return [lo - pad, hi + pad];
}

function computeRanges() {
  const slots = activeSlots();

  state.tMax = Math.max(...slots.map((s) => s.tEnd));

  // Height axis: ground up to the highest point reached. Both objects share
  // y0 and v0, so their peak is the same (above y0 only for an upward toss).
  const peak = state.v0 > 0 ? state.y0 + (state.v0 * state.v0) / (2 * G) : state.y0;
  state.yTop = Math.max(1, peak); // Nonzero display scale for a ground-level start.
  state.ranges.y = [state.ground, state.yTop + 0.06 * (state.yTop - state.ground)];

  // Velocity axis: from the most negative final velocity (at impact, or at the
  // time limit for a capped run) up to the launch velocity. Also fold in
  // terminal-velocity guide lines when air is on and the object gets close.
  let vMin = Math.min(0, state.v0, ...slots.map((s) => s.vEnd));
  const vMax = Math.max(0, state.v0);
  state.termLines = [];
  for (const s of slots) {
    if (state.air && isFinite(s.terminal) && Math.abs(s.vEnd) >= 0.5 * s.terminal) {
      const vt = -s.terminal; // terminal velocity points down => negative
      state.termLines.push({ slot: s, v: vt });
      if (vt < vMin) vMin = vt;
    }
  }
  state.ranges.v = padRange(vMin, vMax, true);
}

/* ============================================================
   Drawing — falling-object track (shared scale, one lane per object)
   ============================================================ */
function drawTrack() {
  const { ctx, w, h } = fitCanvas(el.track);
  ctx.clearRect(0, 0, w, h);

  const slots = activeSlots();
  const m = { l: 58, r: 22, t: 40, b: 40 };
  const yTop = state.ranges.y[1];          // meters at the top of the track
  const groundPx = h - m.b;
  const topPx = m.t;
  const toPx = (yMeters) => groundPx - ((yMeters - state.ground) / (yTop - state.ground)) * (groundPx - topPx);

  // ---- title ----
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 14px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Position y (m)", m.l - 44, 22);

  // ---- ruler ticks in meters ----
  const step = niceStep(yTop - state.ground, 10);
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  const railX = m.l;
  const areaRight = w - m.r;
  for (let val = Math.ceil(state.ground / step) * step; val <= yTop + 1e-9; val += step) {
    const py = toPx(val);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(railX - 6, py);
    ctx.lineTo(areaRight, py);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(fmt(val, 0), railX - 10, py);
  }

  // ---- release-height marker (faint dashed line at y0) ----
  const y0Px = toPx(state.y0);
  ctx.strokeStyle = hexToRgba(COLORS.ink, 0.25);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(railX, y0Px);
  ctx.lineTo(areaRight, y0Px);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- ground line (thick) ----
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(railX - 6, groundPx);
  ctx.lineTo(areaRight, groundPx);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("ground", areaRight, groundPx + 8);

  // ---- one lane per active object ----
  const laneL = railX + 24, laneR = areaRight - 10;
  const n = slots.length;
  slots.forEach((slot, i) => {
    const laneX = n === 1 ? (laneL + laneR) / 2
                          : laneL + ((i + 0.5) / n) * (laneR - laneL);
    drawLane(ctx, slot, laneX, toPx, topPx, groundPx);
  });
}

function drawLane(ctx, slot, laneX, toPx, topPx, groundPx) {
  // faint rail
  ctx.strokeStyle = hexToRgba(slot.color, 0.25);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(laneX, topPx);
  ctx.lineTo(laneX, groundPx);
  ctx.stroke();

  // object name label at the top of the lane
  ctx.fillStyle = slot.color;
  ctx.font = "800 13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "bottom";
  ctx.fillText(slot.params.label || OBJECTS[slot.presetKey].label, laneX, topPx - 6);

  // current object state (clamped to its own trajectory end — impact or cap)
  const tShown = Math.min(state.t, slot.tEnd);
  const s = sampleAt(slot, tShown);
  const objY = toPx(s.y);

  // glow + body
  ctx.beginPath();
  ctx.fillStyle = hexToRgba(slot.color, 0.18);
  ctx.arc(laneX, objY, 22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.fillStyle = slot.color;
  ctx.arc(laneX, objY, 14, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  // ----- vector arrows -----
  // Only while airborne: once the trajectory has ended (impact or time limit)
  // the object is frozen, so we do NOT draw airborne vectors on it.
  if (state.t < slot.tEnd) {
    // Velocity arrow LEFT of the object, acceleration arrow RIGHT of it, so
    // they are separately positioned and never overlap. v = solid, a = dashed
    // (a line-style difference, not color alone), and each carries its label.
    if (state.showV) drawVector(ctx, laneX - 18, objY, s.v, VEL_SCALE, slot.color, "v", false, -1);
    if (state.showA) drawVector(ctx, laneX + 18, objY, s.a, ACC_SCALE, slot.color, "a", true, 1);
  }
}

/* Draw a labeled vertical vector arrow rooted near (x, yBase). A negative value
   points down (screen +y); positive points up. Near-zero magnitude is written
   out ("name = 0") instead of a misleading tiny arrow — e.g. "v = 0" at the
   highest point, where the acceleration arrow is still drawn. `dashed`
   distinguishes acceleration from velocity without relying on color; `side`
   (-1 left / +1 right) places the label clear of the object. */
function drawVector(ctx, x, yBase, value, scale, color, name, dashed, side) {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.font = "800 14px 'Segoe UI', system-ui, sans-serif";

  if (Math.abs(value) < ARROW_ZERO_EPS) {
    ctx.textAlign = side < 0 ? "right" : "left";
    ctx.textBaseline = "middle";
    ctx.fillText(`${name} = 0`, x + side * 4, yBase);
    ctx.restore();
    return;
  }

  const dir = value < 0 ? 1 : -1;                 // pixel-down when negative
  const len = Math.min(ARROW_MAX, 10 + Math.abs(value) * scale);
  const y0 = yBase + dir * 4, y1 = yBase + dir * (4 + len);

  ctx.lineWidth = 3;
  if (dashed) ctx.setLineDash([6, 4]);
  ctx.beginPath(); ctx.moveTo(x, y0); ctx.lineTo(x, y1); ctx.stroke();
  ctx.setLineDash([]);

  // solid arrowhead
  ctx.beginPath();
  ctx.moveTo(x, y1);
  ctx.lineTo(x - 5, y1 - dir * 9);
  ctx.lineTo(x + 5, y1 - dir * 9);
  ctx.closePath();
  ctx.fill();

  // label beside the tail, clear of the object
  ctx.textAlign = side < 0 ? "right" : "left";
  ctx.textBaseline = "middle";
  ctx.fillText(name, x + side * 6, yBase);
  ctx.restore();
}

/* ============================================================
   Drawing — a shared-time graph overlaying every active object
   ============================================================ */
const PLOT_MARGIN = { l: 62, r: 22, t: 30, b: 40 };

function plotRect(w, h) {
  return {
    left: PLOT_MARGIN.l,
    right: w - PLOT_MARGIN.r,
    top: PLOT_MARGIN.t,
    bottom: h - PLOT_MARGIN.b,
    get width() { return this.right - this.left; },
    get height() { return this.bottom - this.top; },
  };
}

function drawGraph(g) {
  const { ctx, w, h } = fitCanvas(g.canvas);
  ctx.clearRect(0, 0, w, h);

  const rect = plotRect(w, h);
  const [yLo, yHi] = state.ranges[g.rangeKey];
  const tMax = Math.max(1, state.tMax); // Display axis only; actual duration may be zero.
  const slots = activeSlots();

  const tToPx = (t) => rect.left + (t / tMax) * rect.width;
  const yToPx = (val) => rect.bottom - ((val - yLo) / (yHi - yLo)) * rect.height;

  // ----- value gridlines -----
  const yStep = niceStep(yHi - yLo, 5);
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  const yStart = Math.ceil(yLo / yStep) * yStep;
  for (let val = yStart; val <= yHi + 1e-9; val += yStep) {
    const py = yToPx(val);
    const isZero = Math.abs(val) < 1e-9;
    ctx.strokeStyle = isZero ? COLORS.axis : COLORS.grid;
    ctx.lineWidth = isZero ? 2 : 1;
    ctx.beginPath(); ctx.moveTo(rect.left, py); ctx.lineTo(rect.right, py); ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fmt(val, 1), rect.left - 10, py);
  }

  // ----- time gridlines -----
  const tStep = niceStep(tMax, 8);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let tv = 0; tv <= tMax + 1e-9; tv += tStep) {
    const px = tToPx(tv);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, rect.top); ctx.lineTo(px, rect.bottom); ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fmt(tv, tMax < 5 ? 1 : 0), px, rect.bottom + 8);
  }

  // ----- titles / axis labels -----
  ctx.fillStyle = COLORS.ink;
  ctx.font = "800 17px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${g.title} (${g.unit})`, rect.left, 20);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("time (s)", rect.right, rect.bottom + 24);

  // ----- terminal-velocity guide lines (velocity graph only) -----
  if (g.terminal) {
    for (const tl of state.termLines) {
      if (tl.v < yLo || tl.v > yHi) continue;
      const py = yToPx(tl.v);
      ctx.strokeStyle = hexToRgba(tl.slot.color, 0.55);
      ctx.lineWidth = 1.5;
      ctx.setLineDash([7, 5]);
      ctx.beginPath(); ctx.moveTo(rect.left, py); ctx.lineTo(rect.right, py); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = hexToRgba(tl.slot.color, 0.9);
      ctx.font = "700 12px 'Segoe UI', system-ui, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "bottom";
      ctx.fillText(`terminal ${fmt(tl.v, 1)} m/s`, rect.left + 6, py - 3);
    }
  }

  // ----- each object's curve: solid up to "now"; faint future only if asked --
  for (const slot of slots) {
    const tCut = Math.min(state.t, slot.tEnd);
    drawCurve(ctx, g, slot, 0, tCut, tToPx, yToPx, slot.color, 4, 1);
    // The faint future curve is opt-in ("Show future curves"). Off by default
    // so students predict rather than read the answer off the graph; it never
    // appears automatically (including at the highest-point pause).
    if (state.showFuture && state.t < slot.tEnd) {
      drawCurve(ctx, g, slot, tCut, slot.tEnd, tToPx, yToPx, hexToRgba(slot.color, 0.2), 2.5, 1);
    }
  }

  // ----- playhead (shared clock) -----
  const phx = tToPx(Math.min(state.t, tMax));
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(phx, rect.top); ctx.lineTo(phx, rect.bottom); ctx.stroke();
  ctx.setLineDash([]);

  // ----- current-value markers -----
  for (const slot of slots) {
    const tShown = Math.min(state.t, slot.tEnd);
    const my = yToPx(g.get(slot, tShown));
    ctx.beginPath();
    ctx.fillStyle = slot.color;
    ctx.arc(tToPx(tShown), my, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  }

  // ----- legend (only meaningful when comparing) -----
  if (slots.length > 1) drawLegend(ctx, rect, slots);
}

/* Draw one object's curve for the time window [t0, t1]. */
function drawCurve(ctx, g, slot, t0, t1, tToPx, yToPx, color, width, steps) {
  if (t1 <= t0) return;
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const N = 220;
  for (let i = 0; i <= N; i++) {
    const t = t0 + (i / N) * (t1 - t0);
    const px = tToPx(t), py = yToPx(g.get(slot, t));
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();
}

function drawLegend(ctx, rect, slots) {
  ctx.font = "800 13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  let y = rect.top + 12;
  for (const slot of slots) {
    const label = slot.params.label || OBJECTS[slot.presetKey].label;
    const tw = ctx.measureText(label).width;
    const x = rect.right - tw - 24;
    ctx.fillStyle = slot.color;
    ctx.fillRect(x, y - 6, 14, 12);
    ctx.fillStyle = COLORS.ink;
    ctx.fillText(label, x + 20, y);
    y += 20;
  }
}

/* ============================================================
   Render everything for the current shared clock state.t
   ============================================================ */
function render() {
  drawTrack();
  for (const g of GRAPHS) drawGraph(g);
  updateReadouts();
}

function updateReadouts() {
  const slots = activeSlots();
  el.roB.hidden = !state.compare;

  for (const slot of slots) {
    const ro = RO[slot.id];
    const tShown = Math.min(state.t, slot.tEnd);
    const s = sampleAt(slot, tShown);
    ro.name.textContent = slot.params.label || OBJECTS[slot.presetKey].label;
    ro.t.textContent = fmt2(tShown);
    ro.y.textContent = fmt2(s.y);
    ro.v.textContent = fmt2(s.v);
    ro.a.textContent = fmt2(s.a);

    // The trajectory ends either at a genuine impact or at the time limit.
    const ended = state.t >= slot.tEnd;
    const impacted = ended && slot.landed;
    ro.block.classList.toggle("is-frozen", ended);
    ro.block.classList.toggle("is-impact", impacted);
    // Descriptive labels only after a genuine impact; compact flight symbols
    // otherwise (restored automatically on reset / input change, since `ended`
    // becomes false). Applied per object, so one can read "Impact" while the
    // other is still falling.
    setReadLabels(ro, impacted ? READ_LABELS_IMPACT : READ_LABELS_FLIGHT);
    if (impacted) {
      ro.imp.hidden = false;
      ro.imp.classList.remove("capped");
      ro.imp.textContent = "Impact!";
    } else if (ended && slot.capped) {
      // Time-limit endpoint: still airborne — distinct messaging preserved.
      ro.imp.hidden = false;
      ro.imp.classList.add("capped");
      ro.imp.textContent = `Simulation time limit reached — object still airborne.`;
    } else {
      ro.imp.hidden = true;
      ro.imp.classList.remove("capped");
    }
  }
}

/* ============================================================
   Animation loop — playback speed scales SIMULATED time.
   ============================================================ */
let rafId = null;
let lastTs = null;

function tick(ts) {
  if (!state.playing) return;
  if (lastTs == null) lastTs = ts;
  const dtWall = (ts - lastTs) / 1000;
  lastTs = ts;

  const prevT = state.t;
  state.t += dtWall * state.speed;

  // Auto-pause at the highest point of a single upward toss, snapping to the
  // exact interpolated v=0 crossing (not the nearest animation frame). Once
  // consumed, Play resumes the descent without pausing here again.
  if (state.pauseAtApex && apexApplicable() && !state.apexConsumed &&
      state.apexT != null && prevT < state.apexT && state.t >= state.apexT) {
    state.t = state.apexT;
    state.apexConsumed = true;
    pauseAtApexStop();
    return;
  }

  if (state.t >= state.tMax) { finish(); return; }
  render();
  if (state.playing) rafId = requestAnimationFrame(tick);
}

/* The highest-point pause only makes sense for a single object thrown upward. */
function apexApplicable() { return !state.compare && state.v0 > 0; }

/* Freeze exactly at the highest point; all views derive from state.t, so this
   syncs the animation, the readouts, and the graph playheads together. */
function pauseAtApexStop() {
  state.playing = false;
  state.atApex = true;
  if (rafId) cancelAnimationFrame(rafId);
  updateActivityUI();
  setControlsEnabled();
  setPlayLabel();
  render(); // render last so the canvas re-fits after the prompt changes layout
}

/* All active objects have landed: freeze and report. */
function finish() {
  state.t = state.tMax;
  state.playing = false;
  state.finished = true;
  if (rafId) cancelAnimationFrame(rafId);
  showImpactBanner();
  setControlsEnabled();
  setPlayLabel();
  render(); // render last so the canvas re-fits after the banner changes layout
}

/* Two arrival times count as "equal" only when they differ by less than
   this tolerance. The sim integrates at a fixed timestep DT = 1/2000 s, so
   impact times are only resolved to ~DT; identical initial conditions AND
   identical object parameters produce bit-identical trajectories and an
   exactly-zero gap (always the case in a vacuum, where motion is
   mass-independent). We set the tolerance an order of magnitude below DT so
   only genuinely unresolvable differences read as "equal"; any larger gap is
   a real, resolvable difference and is reported as such. */
const ARRIVAL_EQUAL_TOL = DT / 10; // 5e-5 s

/* Fixed-decimal formatting (keeps trailing zeros, unlike fmt); tiny values
   below half a unit snap to zero to avoid "-0.00". */
function fixed(n, dp) {
  if (Math.abs(n) < 0.5 * Math.pow(10, -dp)) n = 0;
  return n.toFixed(dp);
}
/* Fewest decimals (2..4) at which the two times round to different values,
   so a small-but-real difference never prints as "0.00 s before" and the
   reported gap (computed from these rounded times below) can't contradict
   them. Gaps larger than ARRIVAL_EQUAL_TOL always resolve within 4 dp. */
function gapDecimals(first, last) {
  let dp = 2;
  while (dp < 4 && first.toFixed(dp) === last.toFixed(dp)) dp++;
  return dp;
}

/* Describe a time-limited (capped) object without claiming it landed. */
function cappedDesc(s) {
  return `${labelOf(s)} reached the ${MAX_T} s time limit still airborne ` +
         `(y = ${fmt2(s.yEnd)} m, v = ${fmt2(s.vEnd)} m/s)`;
}

function showImpactBanner() {
  const slots = activeSlots();
  // The "Impact!" badge only makes sense when every active object genuinely
  // landed; hide it if any object hit the time limit instead.
  const allLanded = slots.every((s) => s.landed);
  el.impactBadge.hidden = !allLanded;

  if (slots.length === 1) {
    const s = slots[0];
    el.impactText.textContent = s.landed
      ? `${labelOf(s)} landed: t = ${fmt2(s.tImpact)} s, v = ${fmt2(s.vImpact)} m/s`
      : `${cappedDesc(s)}.`;
    el.impact.hidden = false;
    return;
  }

  const [a, b] = slots;

  // Mixed / capped outcomes: report what happened to each, without inventing
  // an arrival-time difference between a landing and a non-landing.
  if (!a.landed || !b.landed) {
    if (!a.landed && !b.landed) {
      el.impactText.textContent =
        `Neither object landed within the ${MAX_T} s time limit. ` +
        `${cappedDesc(a)}; ${cappedDesc(b)}.`;
    } else {
      const L = a.landed ? a : b;   // the one that landed
      const C = a.landed ? b : a;   // the one that hit the cap
      el.impactText.textContent =
        `${labelOf(L)} landed at t = ${fmt2(L.tImpact)} s (v = ${fmt2(L.vImpact)} m/s). ` +
        `${cappedDesc(C)}.`;
    }
    el.impact.hidden = false;
    return;
  }

  // Both genuinely landed — compare their arrival times.
  const gap = Math.abs(a.tImpact - b.tImpact);

  if (gap <= ARRIVAL_EQUAL_TOL) {
    // Arrival times are equal within numerical tolerance. Base the
    // explanation on the ACTUAL air setting — never assert that air
    // resistance is absent when it is switched on.
    const t = fmt2(Math.max(a.tImpact, b.tImpact));
    if (state.air) {
      el.impactText.textContent =
        `Both landed at the same time, t = ${t} s (arrival times equal within numerical tolerance).`;
    } else {
      el.impactText.textContent =
        `Both landed at the same time, t = ${t} s. In a vacuum, motion depends only on ` +
        `initial height and velocity — not mass — so objects released together land together.`;
    }
  } else {
    // A real, resolvable difference. Show the gap and both times at the same
    // precision (enough to render the gap nonzero) so they never contradict
    // each other, e.g. no "landed 0.00 s before".
    const first = a.tImpact < b.tImpact ? a : b;
    const last = a.tImpact < b.tImpact ? b : a;
    const dp = gapDecimals(first.tImpact, last.tImpact);
    const fFirst = fixed(first.tImpact, dp);
    const fLast = fixed(last.tImpact, dp);
    // Report the gap as the difference of the *displayed* times, so the
    // banner is internally consistent at whatever precision it shows.
    const fGap = fixed(Number(fLast) - Number(fFirst), dp);
    el.impactText.textContent =
      `${labelOf(first)} landed ${fGap} s before ${labelOf(last)} ` +
      `(${labelOf(first)} ${fFirst} s, ${labelOf(last)} ${fLast} s).`;
  }
  el.impact.hidden = false;
}
function labelOf(slot) { return slot.params.label || OBJECTS[slot.presetKey].label; }

function play() {
  if (state.playing || state.finished) return;
  // Leaving the highest-point pause: resume the descent and drop the prompt.
  if (state.atApex) { state.atApex = false; updateActivityUI(); }
  state.playing = true;
  lastTs = null;
  setPlayLabel();
  setControlsEnabled();
  rafId = requestAnimationFrame(tick);
}
function pause() {
  state.playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  setPlayLabel();
  setControlsEnabled();
}
function togglePlay() { state.playing ? pause() : play(); }

function stepForward() {
  if (state.playing || state.finished) return;
  state.t += STEP_DT;
  if (state.t >= state.tMax) finish();
  else render();
}

/* Rebuild trajectories from the current inputs and rewind to t = 0. */
function rebuild() {
  for (const slot of activeSlots()) computeTrajectory(slot);
  computeRanges();
  state.t = 0;
  state.finished = false;
  state.playing = false;
  if (rafId) cancelAnimationFrame(rafId);
  // Recompute the highest point and reset the apex-pause behavior for this run.
  state.apexT = apexApplicable() ? findApexTime(slotA) : null;
  state.apexConsumed = false;
  state.atApex = false;
  el.impact.hidden = true;
  el.impactBadge.hidden = false; // restore default; banner sets it per-outcome
  el.impA.hidden = true;
  el.impB.hidden = true;
  // Clear per-object impact/time-limit labels so a fresh run starts unfrozen.
  el.roA.classList.remove("is-frozen", "is-impact");
  el.roB.classList.remove("is-frozen", "is-impact");
  el.impA.classList.remove("capped");
  el.impB.classList.remove("capped");
  // Restore the normal compact readout labels for a fresh run.
  setReadLabels(RO.A, READ_LABELS_FLIGHT);
  setReadLabels(RO.B, READ_LABELS_FLIGHT);
  updateApexAvailability();
  updateActivityUI();
  render();
  setControlsEnabled();
  setPlayLabel();
}

function setPlayLabel() { el.playPause.textContent = state.playing ? "Pause" : "Play"; }
function setControlsEnabled() {
  el.playPause.disabled = state.finished;
  el.step.disabled = state.playing || state.finished;
}

/* ============================================================
   Input wiring
   ============================================================ */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

function updateV0Mode() {
  el.v0mode.textContent = state.v0 > 0 ? "(toss upward)" : state.v0 < 0 ? "(throw downward)" : "(drop from rest)";
}

function setY0(raw) {
  leaveInvestigation();
  state.y0 = clamp(parseFloat(raw) || 0, 0, 2000);
  el.y0.value = state.y0;
  el.y0num.value = state.y0;
  rebuild();
}
function setV0(raw) {
  leaveInvestigation();
  state.v0 = clamp(parseFloat(raw) || 0, -20, 20);
  el.v0.value = state.v0;
  el.v0num.value = state.v0;
  updateV0Mode();
  rebuild();
}

/* Point a slot at a preset (or read its custom inputs). */
function applyPreset(slot, key) {
  slot.presetKey = key;
  if (key === "custom") {
    readCustom(slot);
  } else {
    slot.params = { ...OBJECTS[key] };
  }
  updateCustomPanels();
}
function readCustom(slot) {
  const src = slot.id === "A"
    ? { m: el.mA.value, Cd: el.cdA.value, A: el.areaA.value }
    : { m: el.mB.value, Cd: el.cdB.value, A: el.areaB.value };
  slot.params = {
    label: "Custom",
    m: clamp(parseFloat(src.m) || 1, 0.001, 500),
    Cd: clamp(parseFloat(src.Cd) || 0.5, 0.01, 2),
    A: clamp(parseFloat(src.A) || 0.05, 0.0001, 5),
  };
}
function updateCustomPanels() {
  el.customA.hidden = slotA.presetKey !== "custom";
  el.customB.hidden = !(state.compare && slotB.presetKey === "custom");
}

/* Reflect the current state in the control widgets (used on boot + presets). */
function syncControls() {
  el.ground.value = state.ground;
  el.y0.value = state.y0; el.y0num.value = state.y0;
  el.v0.value = state.v0; el.v0num.value = state.v0;
  updateV0Mode();
  el.objA.value = slotA.presetKey;
  el.objB.value = slotB.presetKey;
  el.compare.checked = state.compare;
  el.pickB.hidden = !state.compare;
  el.airOn.classList.toggle("is-active", state.air);
  el.airVacuum.classList.toggle("is-active", !state.air);
  el.airOn.setAttribute("aria-pressed", state.air ? "true" : "false");
  el.airVacuum.setAttribute("aria-pressed", !state.air ? "true" : "false");
  // display options
  el.showV.checked = state.showV;
  el.showA.checked = state.showA;
  el.pauseApex.checked = state.pauseAtApex;
  el.showFuture.checked = state.showFuture;
  // speed buttons
  el.speedBtns.forEach((b) =>
    b.classList.toggle("is-active", parseFloat(b.dataset.speed) === state.speed));
  updateCustomPanels();
}

/* Enable the highest-point pause only for a single upward toss; otherwise
   disable the control and explain why. */
function updateApexAvailability() {
  const ok = apexApplicable();
  el.pauseApex.disabled = !ok;
  el.apexHint.hidden = ok;
  if (!ok) {
    el.apexHint.textContent =
      "“Pause at highest point” applies to a single upward toss " +
      "(turn off Compare and set v₀ > 0).";
  }
}

/* Show/hide the guided-activity prompt panel and its observation line. */
function updateActivityUI() {
  el.activityPanel.hidden = !state.investigation;
  el.activityObserve.hidden = !(state.investigation && state.atApex);
  el.presetToss.classList.toggle("is-active", state.investigation);
  el.presetToss.setAttribute("aria-pressed", state.investigation ? "true" : "false");
}

/* Leaving the investigation setup (via a core physics control) drops the
   activity prompt; speed/arrow/pause/future toggles do NOT. */
function leaveInvestigation() {
  if (state.investigation) { state.investigation = false; updateActivityUI(); }
}

/* Configure the "upward toss investigation": one object, vacuum, y0 = 20 m,
   v0 = +15 m/s, paused at t = 0, 0.5x speed, apex-pause armed, future off. */
function applyTossInvestigation() {
  state.ground = 0;
  state.y0 = 20;
  state.v0 = 15;
  state.air = false;      // vacuum
  state.compare = false;  // single object
  state.speed = 0.5;
  applyPreset(slotA, "basketball"); // object is irrelevant in a vacuum
  state.showV = true;
  state.showA = true;
  state.pauseAtApex = true;
  state.showFuture = false;
  state.investigation = true;
  syncControls();
  rebuild();              // rewinds to t = 0 (paused); recomputes apexT
  updateActivityUI();
}

/* ---- listeners ---- */
el.ground.addEventListener("input", (e) => {
  leaveInvestigation();
  state.ground = clamp(parseFloat(e.target.value) || 0, -2000, 0);
  el.ground.value = state.ground;
  rebuild();
});
el.y0.addEventListener("input", (e) => setY0(e.target.value));
el.y0num.addEventListener("input", (e) => setY0(e.target.value));
el.v0.addEventListener("input", (e) => setV0(e.target.value));
el.v0num.addEventListener("input", (e) => setV0(e.target.value));

el.airOn.addEventListener("click", () => { leaveInvestigation(); state.air = true; syncControls(); rebuild(); });
el.airVacuum.addEventListener("click", () => { leaveInvestigation(); state.air = false; syncControls(); rebuild(); });

el.objA.addEventListener("change", (e) => { leaveInvestigation(); applyPreset(slotA, e.target.value); rebuild(); });
el.objB.addEventListener("change", (e) => { leaveInvestigation(); applyPreset(slotB, e.target.value); rebuild(); });

el.compare.addEventListener("change", (e) => {
  leaveInvestigation();
  state.compare = e.target.checked;
  el.pickB.hidden = !state.compare;
  if (state.compare) applyPreset(slotB, slotB.presetKey);
  updateCustomPanels();
  rebuild();
});

// ---- activity + display-option controls ----
el.presetToss.addEventListener("click", applyTossInvestigation);
el.showV.addEventListener("change", (e) => { state.showV = e.target.checked; render(); });
el.showA.addEventListener("change", (e) => { state.showA = e.target.checked; render(); });
// "Show future curves" is a pure display toggle: re-render only, never rebuild.
el.showFuture.addEventListener("change", (e) => { state.showFuture = e.target.checked; render(); });
el.pauseApex.addEventListener("change", (e) => { state.pauseAtApex = e.target.checked; });

[el.mA, el.cdA, el.areaA].forEach((inp) =>
  inp.addEventListener("input", () => { if (slotA.presetKey === "custom") { readCustom(slotA); rebuild(); } }));
[el.mB, el.cdB, el.areaB].forEach((inp) =>
  inp.addEventListener("input", () => { if (slotB.presetKey === "custom") { readCustom(slotB); rebuild(); } }));

el.playPause.addEventListener("click", togglePlay);
el.step.addEventListener("click", stepForward);
el.reset.addEventListener("click", rebuild);

el.speedBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.speed = parseFloat(btn.dataset.speed);
    el.speedBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
  });
});

window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key.toLowerCase() === "s") stepForward();
  else if (e.key.toLowerCase() === "r") rebuild();
});

let resizeRaf = null;
window.addEventListener("resize", () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(render);
});

/* ============================================================
   Boot — default to the Feather-vs-Hammer / air-on demo
   ============================================================ */
applyPreset(slotA, slotA.presetKey);
applyPreset(slotB, slotB.presetKey);
syncControls();
rebuild();

// Refit canvases when controls expand or readout labels change panel sizes.
// This observes layout only; it never rebuilds trajectories or advances time.
const panelResizeObserver = new ResizeObserver(() => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(render);
});
document.querySelectorAll('.panel-track, .graph-cell').forEach(panel => panelResizeObserver.observe(panel));
