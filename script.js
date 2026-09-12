"use strict";

/* ============================================================
   Sim 02b — Freefall Simulator (with optional air resistance)
   Vanilla JS + Canvas. No dependencies, no build step.

   Extends sim02: the motion is now produced by NUMERICAL INTEGRATION
   instead of the closed-form kinematics equations, because with air
   resistance the drag force depends on v^2 and there is no closed form.
   The whole sim (including the no-drag case) uses the same integrator,
   so behavior is consistent whether air is on or off.

   Sign convention (unchanged): UP is positive, the ground is y = 0. A
   falling object has negative velocity; y is reported as height above
   ground and is always >= 0; the sim stops exactly when y = 0.

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
};

/* A slot holds one object's parameters, color, and its precomputed
   trajectory (arrays sampled every DT, plus the exact impact sample). */
function makeSlot(id, color, presetKey) {
  return {
    id, color, presetKey,
    params: { ...OBJECTS[presetKey] },
    // trajectory (filled by computeTrajectory):
    y: [state.y0], v: [state.v0], n: 1, dt: DT,
    k: 0, terminal: Infinity, tImpact: 0, vImpact: 0, capped: false,
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
  slot.capped = false;

  // Semi-implicit (symplectic) Euler: update velocity first, then position.
  while (true) {
    const a = -G - k * v * Math.abs(v);     // drag always opposes velocity
    const vN = v + a * dt;
    const yN = y + vN * dt;
    if (yN <= 0) {
      // Interpolate the exact ground crossing inside this final sub-step.
      const f = y / (y - yN);               // fraction of the step to y = 0
      slot.tImpact = t + f * dt;
      slot.vImpact = v + (vN - v) * f;
      yArr.push(0);
      vArr.push(slot.vImpact);
      break;
    }
    y = yN; v = vN; t += dt;
    yArr.push(y);
    vArr.push(v);
    if (t > MAX_T) {                        // never actually lands (rare)
      slot.tImpact = t; slot.vImpact = v; slot.capped = true; break;
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
  const tI = slot.tImpact;
  if (t >= tI) {
    const v = slot.vImpact;
    return { y: 0, v, a: -G - slot.k * v * Math.abs(v) };
  }
  const dt = slot.dt, n = slot.n;
  const lastUniformT = (n - 2) * dt;
  let y, v;
  if (t >= lastUniformT) {
    // final partial interval: sample[n-2] -> (y=0, vImpact) at tImpact
    const frac = (t - lastUniformT) / (tI - lastUniformT);
    y = slot.y[n - 2] + (0 - slot.y[n - 2]) * frac;
    v = slot.v[n - 2] + (slot.vImpact - slot.v[n - 2]) * frac;
  } else {
    const x = t / dt, i = Math.floor(x), f = x - i;
    y = slot.y[i] + (slot.y[i + 1] - slot.y[i]) * f;
    v = slot.v[i] + (slot.v[i + 1] - slot.v[i]) * f;
  }
  return { y, v, a: -G - slot.k * v * Math.abs(v) };
}

/* ============================================================
   DOM references
   ============================================================ */
const el = {
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
  impactText: document.getElementById("impactText"),
  roA: document.getElementById("roA"), roB: document.getElementById("roB"),
  nameA: document.getElementById("nameA"), nameB: document.getElementById("nameB"),
  impA: document.getElementById("impA"), impB: document.getElementById("impB"),
  tA: document.getElementById("tA"), yA: document.getElementById("yA"), vA: document.getElementById("vA"), aA: document.getElementById("aA"),
  tB: document.getElementById("tB"), yB: document.getElementById("yB"), vB: document.getElementById("vB"), aB: document.getElementById("aB"),
  track: document.getElementById("track"),
  graphY: document.getElementById("graphY"),
  graphV: document.getElementById("graphV"),
};

/* Per-slot readout element bundles, keyed by slot id. */
const RO = {
  A: { name: el.nameA, imp: el.impA, t: el.tA, y: el.yA, v: el.vA, a: el.aA },
  B: { name: el.nameB, imp: el.impB, t: el.tB, y: el.yB, v: el.vB, a: el.aB },
};

/* The two graphs share a time axis; each overlays all active objects. */
const GRAPHS = [
  { key: "y", canvas: el.graphY, title: "Height",   unit: "m",   rangeKey: "y", get: (s, t) => sampleAt(s, t).y, terminal: false },
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

  state.tMax = Math.max(...slots.map((s) => s.tImpact));

  // Height axis: ground up to the highest point reached. Both objects share
  // y0 and v0, so their peak is the same (above y0 only for an upward toss).
  const peak = state.v0 > 0 ? state.y0 + (state.v0 * state.v0) / (2 * G) : state.y0;
  state.yTop = peak;
  state.ranges.y = [0, peak * 1.06];

  // Velocity axis: from the most negative impact velocity up to the launch
  // velocity. Also fold in terminal-velocity guide lines when air is on and
  // the object actually gets close to terminal within this drop.
  let vMin = Math.min(0, ...slots.map((s) => s.vImpact));
  const vMax = Math.max(0, state.v0);
  state.termLines = [];
  for (const s of slots) {
    if (state.air && isFinite(s.terminal) && Math.abs(s.vImpact) >= 0.5 * s.terminal) {
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
  const yTop = state.yTop * 1.06;          // meters at the top of the track
  const groundPx = h - m.b;
  const topPx = m.t;
  const toPx = (yMeters) => groundPx - (yMeters / yTop) * (groundPx - topPx);

  // ---- title ----
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 14px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Height (m)", m.l - 44, 22);

  // ---- ruler ticks in meters ----
  const step = niceStep(yTop, 10);
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  const railX = m.l;
  const areaRight = w - m.r;
  for (let val = 0; val <= yTop + 1e-9; val += step) {
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

  // current object state (clamped to its own impact once it has landed)
  const tShown = Math.min(state.t, slot.tImpact);
  const s = sampleAt(slot, tShown);
  const objY = toPx(Math.max(0, s.y));

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

  // velocity arrow (direction + rough magnitude), hidden once landed
  const v = s.v;
  if (Math.abs(v) > 0.05 && state.t < slot.tImpact) {
    const dir = v < 0 ? 1 : -1; // pixel-down while falling (v < 0)
    const len = Math.min(44, 8 + Math.abs(v) * 1.4);
    const ay0 = objY + dir * 15, ay1 = objY + dir * (15 + len);
    ctx.strokeStyle = slot.color;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(laneX, ay0);
    ctx.lineTo(laneX, ay1);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(laneX, ay1);
    ctx.lineTo(laneX - 5, ay1 - dir * 8);
    ctx.lineTo(laneX + 5, ay1 - dir * 8);
    ctx.closePath();
    ctx.fillStyle = slot.color;
    ctx.fill();
  }
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
  const tMax = state.tMax;
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

  // ----- each object's curve: solid up to "now", faint to its own impact -----
  for (const slot of slots) {
    const tCut = Math.min(state.t, slot.tImpact);
    drawCurve(ctx, g, slot, 0, tCut, tToPx, yToPx, slot.color, 4, 1);
    if (state.t < slot.tImpact) {
      drawCurve(ctx, g, slot, tCut, slot.tImpact, tToPx, yToPx, hexToRgba(slot.color, 0.2), 2.5, 1);
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
    const tShown = Math.min(state.t, slot.tImpact);
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
    const tShown = Math.min(state.t, slot.tImpact);
    const s = sampleAt(slot, tShown);
    ro.name.textContent = slot.params.label || OBJECTS[slot.presetKey].label;
    ro.t.textContent = fmt2(tShown);
    ro.y.textContent = fmt2(Math.max(0, s.y));
    ro.v.textContent = fmt2(s.v);
    ro.a.textContent = fmt2(s.a);
    // per-object impact tag, shown as soon as that object lands
    if (state.t >= slot.tImpact) {
      ro.imp.hidden = false;
      ro.imp.textContent = `Impact  t=${fmt2(slot.tImpact)} s, v=${fmt2(slot.vImpact)} m/s`;
    } else {
      ro.imp.hidden = true;
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

  state.t += dtWall * state.speed;

  if (state.t >= state.tMax) { finish(); return; }
  render();
  if (state.playing) rafId = requestAnimationFrame(tick);
}

/* All active objects have landed: freeze and report. */
function finish() {
  state.t = state.tMax;
  state.playing = false;
  state.finished = true;
  if (rafId) cancelAnimationFrame(rafId);
  render();
  showImpactBanner();
  setControlsEnabled();
  setPlayLabel();
}

function showImpactBanner() {
  const slots = activeSlots();
  if (slots.length === 1) {
    const s = slots[0];
    el.impactText.textContent = `${labelOf(s)} landed: t = ${fmt2(s.tImpact)} s, v = ${fmt2(s.vImpact)} m/s`;
  } else {
    const [a, b] = slots;
    const gap = Math.abs(a.tImpact - b.tImpact);
    if (gap < 0.05) {
      el.impactText.textContent =
        `Both landed together at t ≈ ${fmt2(a.tImpact)} s (same time — no air resistance to tell them apart).`;
    } else {
      const first = a.tImpact < b.tImpact ? a : b;
      const last = a.tImpact < b.tImpact ? b : a;
      el.impactText.textContent =
        `${labelOf(first)} landed ${fmt2(gap)} s before ${labelOf(last)} ` +
        `(${labelOf(first)} ${fmt2(first.tImpact)} s, ${labelOf(last)} ${fmt2(last.tImpact)} s).`;
    }
  }
  el.impact.hidden = false;
}
function labelOf(slot) { return slot.params.label || OBJECTS[slot.presetKey].label; }

function play() {
  if (state.playing || state.finished) return;
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
  el.impact.hidden = true;
  el.impA.hidden = true;
  el.impB.hidden = true;
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
  el.v0mode.textContent = state.v0 > 0 ? "(toss upward)" : "(drop from rest)";
}

function setY0(raw) {
  state.y0 = clamp(parseFloat(raw) || 0, 5, 2000);
  el.y0.value = state.y0;
  el.y0num.value = state.y0;
  rebuild();
}
function setV0(raw) {
  state.v0 = clamp(parseFloat(raw) || 0, 0, 20);
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

/* Reflect the current state in the control widgets (used on boot). */
function syncControls() {
  el.y0.value = state.y0; el.y0num.value = state.y0;
  el.v0.value = state.v0; el.v0num.value = state.v0;
  updateV0Mode();
  el.objA.value = slotA.presetKey;
  el.objB.value = slotB.presetKey;
  el.compare.checked = state.compare;
  el.pickB.hidden = !state.compare;
  el.airOn.classList.toggle("is-active", state.air);
  el.airVacuum.classList.toggle("is-active", !state.air);
  updateCustomPanels();
}

/* ---- listeners ---- */
el.y0.addEventListener("input", (e) => setY0(e.target.value));
el.y0num.addEventListener("input", (e) => setY0(e.target.value));
el.v0.addEventListener("input", (e) => setV0(e.target.value));
el.v0num.addEventListener("input", (e) => setV0(e.target.value));

el.airOn.addEventListener("click", () => { state.air = true; syncControls(); rebuild(); });
el.airVacuum.addEventListener("click", () => { state.air = false; syncControls(); rebuild(); });

el.objA.addEventListener("change", (e) => { applyPreset(slotA, e.target.value); rebuild(); });
el.objB.addEventListener("change", (e) => { applyPreset(slotB, e.target.value); rebuild(); });

el.compare.addEventListener("change", (e) => {
  state.compare = e.target.checked;
  el.pickB.hidden = !state.compare;
  if (state.compare) applyPreset(slotB, slotB.presetKey);
  updateCustomPanels();
  rebuild();
});

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
