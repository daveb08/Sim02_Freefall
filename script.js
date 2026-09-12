"use strict";

/* ============================================================
   Sim 02 — Freefall Simulator
   Vanilla JS + Canvas. No dependencies, no build step.

   Physics: 1D vertical freefall, constant acceleration, no air
   resistance. Sign convention: UP is positive, the ground is y = 0.
   So a falling object has negative velocity, and acceleration is a
   constant -g. y is reported as "height above ground" and is always
   >= 0; the sim stops exactly when y = 0.

     a(t) = -g                          (constant)
     v(t) = v0 - g*t
     y(t) = y0 + v0*t - 0.5*g*t^2

   v0 is the initial velocity, positive = tossed upward, 0 = dropped
   from rest. (Per the build spec's sign choice for this sim.)
   ============================================================ */

/* g is a named constant so it can be swapped for another world later
   (e.g. Moon g = 1.62 m/s^2). Change ONLY this line to re-gravitate. */
const G = 9.8; // m/s^2, magnitude of gravitational acceleration

const COLORS = {
  y: "#2563eb", // height / position (blue)
  v: "#16a34a", // velocity          (green)
  a: "#dc2626", // acceleration      (red)
  t: "#7c3aed", // time / playhead   (violet)
  grid: "#e2e8f0",
  axis: "#334155",
  ink: "#0f172a",
  muted: "#64748b",
  line: "#cbd5e1",
};

/* How much simulated time a single "Step" advances (one 60 fps frame). */
const STEP_DT = 1 / 60; // s

/* -------- Global simulation state -------- */
const state = {
  y0: 20,      // initial height (m)
  v0: 0,       // initial velocity (m/s, + = up)
  t: 0,        // current simulated time (s)
  tImpact: 0,  // time the object reaches the ground (computed)
  yMax: 20,    // highest point reached over the run (m), for auto-scaling
  playing: false,
  finished: false, // true once impact has happened (locks motion until Reset)
  speed: 1,    // playback multiplier: sim seconds per wall second
  // cached graph ranges (computed whenever inputs change)
  ranges: { y: [0, 1], v: [0, 1] },
};

/* ============================================================
   Kinematics — the three equations of motion.
   These are the lines to sanity-check against the textbook.
   ============================================================ */
const yAt = (t) => state.y0 + state.v0 * t - 0.5 * G * t * t; // height above ground
const vAt = (t) => state.v0 - G * t;                          // velocity (+ up)
const aAt = (_t) => -G;                                       // constant acceleration

/*
  Impact time — solve y(t) = 0 for t > 0:

      y0 + v0*t - 0.5*g*t^2 = 0
      0.5*g*t^2 - v0*t - y0 = 0            (multiply by -1, standard form)

  Quadratic a*t^2 + b*t + c = 0 with a = 0.5*g, b = -v0, c = -y0:

      t = ( -b ± sqrt(b^2 - 4ac) ) / (2a)
        = ( v0 ± sqrt(v0^2 + 2*g*y0) ) / g

  The discriminant v0^2 + 2*g*y0 is always positive here (y0 > 0), and
  sqrt(...) > |v0|, so the "+" root is the only positive one — that's the
  physical impact time. It works for a pure drop (v0 = 0) and for an
  upward toss (v0 > 0, where the object rises, comes back, then hits).
*/
function impactTime(y0, v0) {
  return (v0 + Math.sqrt(v0 * v0 + 2 * G * y0)) / G;
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
  playPause: document.getElementById("playPause"),
  step: document.getElementById("step"),
  reset: document.getElementById("reset"),
  valT: document.getElementById("valT"),
  valY: document.getElementById("valY"),
  valV: document.getElementById("valV"),
  valA: document.getElementById("valA"),
  impact: document.getElementById("impact"),
  impactText: document.getElementById("impactText"),
  track: document.getElementById("track"),
  graphY: document.getElementById("graphY"),
  graphV: document.getElementById("graphV"),
  speedBtns: Array.from(document.querySelectorAll(".btn-speed")),
};

/* Descriptors for the two live graphs (shared time axis). */
const GRAPHS = [
  { key: "y", canvas: el.graphY, fn: yAt, color: COLORS.y, title: "Height",   unit: "m",   rangeKey: "y" },
  { key: "v", canvas: el.graphV, fn: vAt, color: COLORS.v, title: "Velocity", unit: "m/s", rangeKey: "v" },
];

/* ============================================================
   Canvas / HiDPI helpers
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

/* "Nice" tick spacing for an axis covering `range` with ~target ticks. */
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

/* Round a number for label display (drops trailing zeros). */
function fmt(n, dp = 1) {
  if (Math.abs(n) < 1e-9) n = 0;
  return n.toFixed(dp).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

/* Fixed 2-decimal formatting for the numeric readout (keeps -0.00 tidy). */
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
   Range computation — auto-fit the graphs & track to this run.
   Depends only on y0, v0 and the resulting impact time.
   ============================================================ */
function computeRanges() {
  state.tImpact = impactTime(state.y0, state.v0);

  // Highest point reached: for an upward toss the peak is above y0.
  // Peak occurs when v = 0 => t_peak = v0/g, y_peak = y0 + v0^2/(2g).
  const yPeak = state.v0 > 0 ? state.y0 + (state.v0 * state.v0) / (2 * G) : state.y0;
  state.yMax = yPeak;

  // Height axis: ground (0) up to the peak, with a little headroom.
  state.ranges.y = [0, yPeak * 1.08];

  // Velocity axis: from the (negative) impact velocity up to the launch
  // velocity (which is 0 for a drop, positive for a toss). Pad and keep 0.
  const vImpact = vAt(state.tImpact); // most negative velocity
  const vTop = Math.max(state.v0, 0);
  state.ranges.v = padRange(vImpact, vTop, true);
}

/* Pad [lo,hi]; includeZero forces 0 into the range; handles flat lines. */
function padRange(lo, hi, includeZero, padFrac = 0.12) {
  if (includeZero) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (lo === hi) { lo -= 1; hi += 1; }
  const pad = (hi - lo) * padFrac;
  return [lo - pad, hi + pad];
}

/* ============================================================
   Drawing — falling-object track (vertical), ruler, ground, object
   ============================================================ */
function drawTrack() {
  const { ctx, w, h } = fitCanvas(el.track);
  ctx.clearRect(0, 0, w, h);

  const m = { l: 58, r: 22, t: 34, b: 40 };
  const yTop = state.yMax * 1.08;          // meters at the top of the track
  const groundPx = h - m.b;                // pixel row of y = 0 (the ground)
  const topPx = m.t;
  // Map a height in meters to a pixel row (0 m at the ground, up = up).
  const toPx = (yMeters) => groundPx - (yMeters / yTop) * (groundPx - topPx);

  // ---- title ----
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 14px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText("Height (m)", m.l - 44, 22);

  // ---- ruler ticks in meters, along the left edge ----
  const step = niceStep(yTop, 10);
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  const railX = m.l;
  for (let val = 0; val <= yTop + 1e-9; val += step) {
    const py = toPx(val);
    ctx.strokeStyle = COLORS.line;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(railX - 6, py);
    ctx.lineTo(w - m.r, py);
    ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(fmt(val, 0), railX - 10, py);
  }

  // ---- vertical rail ----
  ctx.strokeStyle = COLORS.axis;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(railX, topPx);
  ctx.lineTo(railX, groundPx);
  ctx.stroke();

  // ---- ground line (thick) ----
  ctx.strokeStyle = COLORS.ink;
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.moveTo(railX - 6, groundPx);
  ctx.lineTo(w - m.r, groundPx);
  ctx.stroke();
  ctx.fillStyle = COLORS.muted;
  ctx.font = "700 13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.textBaseline = "top";
  ctx.fillText("ground", w - m.r, groundPx + 8);

  // ---- release-height marker (faint dashed line at y0) ----
  const y0Px = toPx(state.y0);
  ctx.strokeStyle = hexToRgba(COLORS.y, 0.35);
  ctx.lineWidth = 1.5;
  ctx.setLineDash([5, 5]);
  ctx.beginPath();
  ctx.moveTo(railX, y0Px);
  ctx.lineTo(w - m.r, y0Px);
  ctx.stroke();
  ctx.setLineDash([]);

  // ---- the falling object ----
  const objX = (railX + (w - m.r)) / 2 + 10;
  const objY = toPx(Math.max(0, yAt(state.t)));
  // glow
  ctx.beginPath();
  ctx.fillStyle = hexToRgba(COLORS.y, 0.18);
  ctx.arc(objX, objY, 24, 0, Math.PI * 2);
  ctx.fill();
  // body
  ctx.beginPath();
  ctx.fillStyle = COLORS.y;
  ctx.arc(objX, objY, 15, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = "#fff";
  ctx.stroke();

  // ---- velocity arrow on the object (direction + rough magnitude) ----
  const v = vAt(state.t);
  if (Math.abs(v) > 0.05 && !state.finished) {
    const dir = v < 0 ? 1 : -1; // pixel-down if moving down (v<0), else up
    const len = Math.min(46, 8 + Math.abs(v) * 1.6);
    const ax = objX, ay0 = objY + dir * 16, ay1 = objY + dir * (16 + len);
    ctx.strokeStyle = COLORS.v;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(ax, ay0);
    ctx.lineTo(ax, ay1);
    ctx.stroke();
    // arrowhead
    ctx.beginPath();
    ctx.moveTo(ax, ay1);
    ctx.lineTo(ax - 5, ay1 - dir * 8);
    ctx.lineTo(ax + 5, ay1 - dir * 8);
    ctx.closePath();
    ctx.fillStyle = COLORS.v;
    ctx.fill();
  }
}

/* ============================================================
   Drawing — a single line graph (height or velocity) vs. time
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
  const tMax = state.tImpact;

  const tToPx = (t) => rect.left + (t / tMax) * rect.width;
  const yToPx = (val) => rect.bottom - ((val - yLo) / (yHi - yLo)) * rect.height;

  // ----- horizontal gridlines (value axis) -----
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

  // ----- vertical gridlines (time axis) -----
  const tStep = niceStep(tMax, 8);
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (let tv = 0; tv <= tMax + 1e-9; tv += tStep) {
    const px = tToPx(tv);
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, rect.top); ctx.lineTo(px, rect.bottom); ctx.stroke();
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(fmt(tv, 1), px, rect.bottom + 8);
  }

  // ----- titles / axis labels -----
  ctx.fillStyle = g.color;
  ctx.font = "800 17px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(`${g.title} (${g.unit})`, rect.left, 20);

  ctx.fillStyle = COLORS.muted;
  ctx.font = "600 13px 'Segoe UI', system-ui, sans-serif";
  ctx.textAlign = "right";
  ctx.fillText("time (s)", rect.right, rect.bottom + 24);

  // ----- live trace: solid curve up to the current time -----
  ctx.strokeStyle = g.color;
  ctx.lineWidth = 4;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  const steps = 220;
  const tEnd = state.t;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * tEnd;
    const px = tToPx(t), py = yToPx(g.fn(t));
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // ----- faint preview of where the curve is heading -----
  ctx.strokeStyle = hexToRgba(g.color, 0.18);
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const t = tEnd + (i / steps) * (tMax - tEnd);
    const px = tToPx(t), py = yToPx(g.fn(t));
    if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
  }
  ctx.stroke();

  // ----- playhead + current-value marker -----
  const phx = tToPx(state.t);
  ctx.strokeStyle = COLORS.t;
  ctx.lineWidth = 2;
  ctx.setLineDash([6, 5]);
  ctx.beginPath(); ctx.moveTo(phx, rect.top); ctx.lineTo(phx, rect.bottom); ctx.stroke();
  ctx.setLineDash([]);

  const my = yToPx(g.fn(state.t));
  ctx.beginPath();
  ctx.fillStyle = g.color;
  ctx.arc(phx, my, 7, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "#fff";
  ctx.stroke();
}

/* ============================================================
   Render everything for the current state.t
   ============================================================ */
function render() {
  drawTrack();
  for (const g of GRAPHS) drawGraph(g);
  updateReadout();
}

function updateReadout() {
  el.valT.textContent = fmt2(state.t);
  el.valY.textContent = fmt2(Math.max(0, yAt(state.t))); // never show negative height
  el.valV.textContent = fmt2(vAt(state.t));
  el.valA.textContent = fmt2(aAt(state.t));
}

/* ============================================================
   Animation loop — playback speed scales SIMULATED time, so the
   motion always tracks the real equations, just faster/slower.
   ============================================================ */
let rafId = null;
let lastTs = null;

function tick(ts) {
  if (!state.playing) return;
  if (lastTs == null) lastTs = ts;
  const dtWall = (ts - lastTs) / 1000; // real seconds since last frame
  lastTs = ts;

  // Advance simulated time by (wall time * speed).
  state.t += dtWall * state.speed;

  if (state.t >= state.tImpact) {
    landAndStop();
    return;
  }
  render();
  if (state.playing) rafId = requestAnimationFrame(tick);
}

/* Snap to the exact impact instant, freeze, and show the result. */
function landAndStop() {
  state.t = state.tImpact;
  state.playing = false;
  state.finished = true;
  if (rafId) cancelAnimationFrame(rafId);
  render();
  showImpact();
  setControlsEnabled();
  setPlayLabel();
}

function showImpact() {
  const vImpact = vAt(state.tImpact);
  el.impactText.textContent = `t = ${fmt2(state.tImpact)} s, v = ${fmt2(vImpact)} m/s`;
  el.impact.hidden = false;
}

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

/* Step one frame forward while paused (for frame-by-frame analysis). */
function stepForward() {
  if (state.playing || state.finished) return;
  state.t += STEP_DT;
  if (state.t >= state.tImpact) {
    landAndStop();
  } else {
    render();
  }
}

function reset() {
  state.playing = false;
  state.finished = false;
  if (rafId) cancelAnimationFrame(rafId);
  state.t = 0;
  el.impact.hidden = true;
  computeRanges();
  render();
  setControlsEnabled();
  setPlayLabel();
}

function setPlayLabel() {
  el.playPause.textContent = state.playing ? "Pause" : "Play";
}

/* Enable/disable buttons to match the current mode. */
function setControlsEnabled() {
  el.playPause.disabled = state.finished;
  el.step.disabled = state.playing || state.finished;
}

/* ============================================================
   Input wiring — sliders + numeric boxes stay in sync
   ============================================================ */
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

/* Update the "(drop from rest)" / "(toss upward)" hint next to v0. */
function updateV0Mode() {
  el.v0mode.textContent = state.v0 > 0 ? "(toss upward)" : "(drop from rest)";
}

/* Read y0 from a control, clamp, mirror to both inputs, and re-fit. */
function setY0(raw) {
  const v = clamp(parseFloat(raw) || 0, 5, 100);
  state.y0 = v;
  el.y0.value = v;
  el.y0num.value = v;
  reset();
}

function setV0(raw) {
  const v = clamp(parseFloat(raw) || 0, 0, 20);
  state.v0 = v;
  el.v0.value = v;
  el.v0num.value = v;
  updateV0Mode();
  reset();
}

el.y0.addEventListener("input", (e) => setY0(e.target.value));
el.y0num.addEventListener("input", (e) => setY0(e.target.value));
el.v0.addEventListener("input", (e) => setV0(e.target.value));
el.v0num.addEventListener("input", (e) => setV0(e.target.value));

el.playPause.addEventListener("click", togglePlay);
el.step.addEventListener("click", stepForward);
el.reset.addEventListener("click", reset);

/* Speed buttons: set the multiplier and highlight the active one. */
el.speedBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    state.speed = parseFloat(btn.dataset.speed);
    el.speedBtns.forEach((b) => b.classList.toggle("is-active", b === btn));
  });
});

/* Keyboard: Space = play/pause, S = step, R = reset. */
window.addEventListener("keydown", (e) => {
  if (e.target.tagName === "INPUT" || e.target.tagName === "SELECT") return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); }
  else if (e.key.toLowerCase() === "s") stepForward();
  else if (e.key.toLowerCase() === "r") reset();
});

/* Redraw on resize (canvas backing store depends on CSS size). */
let resizeRaf = null;
window.addEventListener("resize", () => {
  if (resizeRaf) cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(render);
});

/* ============================================================
   Boot
   ============================================================ */
updateV0Mode();
computeRanges();
render();
setControlsEnabled();
