# Changelog

Notable changes to the Freefall Simulator (sim02 / sim02b). Dates are the
day the work landed; entries are newest first.

## 2026-09-13 - Taller animation and cliff launches

- Moved setup and playback controls above the animation and graphs; placed activity/display options in an expandable panel. Readouts remain below the taller animation. Allow scrolling when needed rather than clipping content.
- Refit canvases when panel sizes change without rebuilding trajectories.
- Initial position now accepts 0 m; initial velocity accepts -20 to +20 m/s with downward-throw labeling.
- Added ground position (-2000 to 0 m). Launching at 0 m with ground at -20 m allows negative positions. Sampling, impact detection, graphs, ruler, and readouts use the selected ground coordinate.
- Ground remains 0 by default; the upward-toss investigation restores ground to 0. The integration method and time cap are retained.
- Checked rendered layout in Chrome and JavaScript syntax. Focused checks covered negative-position readouts, cliff impact (0 m, -10 m/s, ground -20 m: 1.24283 s in vacuum), reset, air comparisons, ordinary drops, and the upward-toss activity.

## 2026-09-13 — Two-column layout (fits 1280×800, no scrolling)

Reflowed the page so it fits a ~1280×800 Canvas iframe with no scrolling
(previously it was too tall). Functionality and physics unchanged.

- Two-column layout: left column holds the controls + falling-object animation
  + readouts (and the conditional impact/activity banners); right column holds
  both graphs, stacked and sized to fill the column height.
- The whole app fills the viewport (flex column, `overflow: hidden`); the
  animation canvas flexes to use the space left under the controls, and the two
  graphs each take half the right column. Canvases fill their panels via
  absolute positioning, so they resize themselves (they already measure their
  box with `getBoundingClientRect`).
- Reduced base font, control padding/margins, and readout sizes to hit the
  height budget. Removed the footer hint text (informational only) to save
  vertical space.
- Narrow screens (<1000 px wide) fall back to a single scrolling column.
- Only rendering-order tweak in JS: `render()` now runs after a banner/prompt
  toggles, so the canvas re-fits to the new layout (no physics change).
- Verified headlessly at 1280×800/900/950: no overflow (body scroll height ≤
  viewport); animation ~205 px and graphs ~363 px each at the 800 target;
  impact flow, labels, and the toss/apex activity all still work.

## 2026-09-12 — Simpler impact wording

Student-facing impact wording simplified; physics and all other behavior
unchanged.

- The per-object impact tag now reads simply **"Impact!"** (was "Immediately
  before impact — collision not modeled…"). The phrase "collision not modeled"
  is gone from the interface.
- After a genuine impact, that object's frozen readout labels become
  **"Impact time," "Height," "Velocity at impact,"** and **"Acceleration just
  before impact"** (compact `t/y/v/a` symbols during flight).
- Labels/tag are applied per object, so one object can show "Impact" while the
  other keeps falling; normal labels are restored on reset or input change.
- Time-limit (capped) messaging is preserved and stays distinct ("Simulation
  time limit reached — object still airborne," normal labels).
- Verified labels during flight, after impact, after reset, in a mixed
  one-landed/one-falling comparison, and for a capped run.

## 2026-09-12 — Upward-toss investigation activity (velocity vs. acceleration)

A focused classroom activity to help students distinguish velocity from
acceleration during an upward toss, especially at the highest point. Physics
model unchanged (numerical-solver overhaul remains deferred).

- **"Upward toss investigation" preset**: one object, vacuum, y₀ = 20 m,
  v₀ = +15 m/s, paused at t = 0, 0.5× speed, with a prediction prompt ("At the
  highest point, what will the velocity and acceleration be?"). All controls
  sync to the preset; other configurations remain fully available.
- **Vector display**: the velocity arrow is now labeled **v** (solid) and a
  separate **a** arrow (dashed) is drawn on the other side of the object —
  distinguished by line style and labels, not color. Independent Show v / Show a
  toggles. A note explains the arrows use separate scales (different units), so
  their lengths shouldn't be compared. At the highest point the velocity reads
  "v = 0" while the constant downward acceleration arrow remains. In a vacuum
  the a arrow stays downward and constant length throughout; frozen (impact or
  time-limit) states draw no airborne vectors.
- **Pause at highest point** (checkbox, armed by the preset): during a single
  upward toss, playback auto-stops at the exact interpolated v = 0 crossing
  (from the trajectory's own sample times), syncing animation, readouts, and
  graph playheads. Play resumes the descent without re-pausing; Reset re-arms
  it. Disabled with an explanation when not a single upward toss.
- **Show future curves** (checkbox, default off — including in the preset):
  when off, graphs draw only up to the current time (axes and current-value
  markers preserved); when on, the faint future preview returns. Pure display
  toggle — never restarts the sim and never auto-reveals at the apex pause.
- Controls are keyboard-accessible with associated labels and aria-pressed
  toggle states. No acceleration graph, quiz, scoring, or accounts added.
- Verified: ascent (v up, a down), auto-pause at apex (t ≈ 1.531 s,
  y ≈ 31.480 m, v = 0, a = −9.8, playheads agree), descent (both down), resume,
  reset, future-curve reveal while paused/playing without changing the
  trajectory, and that existing drops/comparisons/air/impact labels still work.

## 2026-09-12 — Time-limit (capped) trajectories separated from landings

A trajectory that reaches `MAX_T` while still airborne (e.g. a feather from
2000 m in air) was stored as an impact, and `sampleAt()` then reported `y = 0`
— the UI falsely showed a landing. Ground contact is now represented
separately from a time-limit ending.

- Each object now carries `landed` (genuine ground contact) plus `tEnd`,
  `yEnd`, `vEnd` (the true final time/height/velocity of the trajectory,
  whether it ends at impact or the cap). `tImpact`/`vImpact` are valid only
  when `landed`.
- **`sampleAt()`** freezes at the real final state (`yEnd`, `vEnd`); it only
  interpolates toward `y = 0` for a genuine landing — never for a capped run.
  Samples immediately before and at the cap are continuous (no teleport).
- Graph ranges, graph endpoints, track clamping, playback completion, and the
  playhead all use `tEnd` instead of `tImpact`.
- **Readouts**: a capped object shows "Simulation time limit reached — object
  still airborne." (neutral amber, not the red impact styling) with no impact
  badge, landing time, or impact velocity. Genuine-landing pre-impact labeling
  is unchanged.
- **Comparison banner**: handles one-landed/one-capped and both-capped without
  inventing an arrival-time difference; the "Impact!" badge is hidden unless
  every active object genuinely landed.
- The `MAX_T` cap is retained (bounded duration); Reset clears all
  labels/flags.
- Verified: feather from 2000 m (airborne at cap, y ≈ 1738 m, no teleport);
  feather vs hammer from 2000 m (hammer lands, feather capped); ordinary 20 m
  drops in vacuum and air (genuine impacts unchanged); continuity at the cap.

## 2026-09-12 — Post-landing readout interpretation

Clarify what the readouts mean after an object reaches the ground, so the
retained numbers aren't misread as an object resting on the ground. No
collision or bounce physics added; the model stays airborne-only.

- **`updateReadouts()`**: on a genuine ground contact (impact reached and the
  object is not a time-limit/capped endpoint), the object's readout is labeled
  **"Immediately before impact — collision not modeled. Frozen at impact time
  t = X.XX s."** The retained velocity and acceleration are the airborne,
  pre-impact values; the label reframes them without changing them. The landed
  object's readout block also gets an `is-frozen` flag so it is clearly
  distinguished from an object that is still falling in a two-object run.
- **`sampleAt()`**: a genuine landing rests at `y = 0`; a capped/time-limit
  endpoint now freezes at the object's actual last height instead of snapping
  to the ground, so time-limit endpoints are not mistaken for impacts (also
  keeps the height graph from diving to 0 at the cap).
- **`rebuild()`**: clears the frozen labels/flags on reset or any input change.
- Motion graphs already terminate at impact (no stationary segment appended);
  this behavior is preserved.
- **`style.css`**: readout header wraps to keep the longer label readable; new
  subtle `.obj-readout.is-frozen` background cue.
- Verified: single vacuum drop (t = 2.02 s, v = −19.80 m/s, labeled), two-object
  air run with different landing times (landed object frozen/labeled while the
  other keeps moving), reset after impact (labels cleared), and a capped
  endpoint (frozen at its true height with no impact label).

## 2026-09-12 — Air-aware landing comparison banner

- **`showImpactBanner()`** no longer calls every sub-0.05 s gap "same time — no
  air resistance," which was wrong for identical objects in air. Explanations
  now key on the actual air setting; in vacuum they note motion is
  mass-independent, in air they report equal/near-equal times without claiming
  air is absent.
- Introduced a documented equality tolerance `ARRIVAL_EQUAL_TOL = DT / 10`
  (5e-5 s) and reported gaps as the difference of the displayed times at a
  precision that never renders a contradictory "landed 0.00 s before."

## 2026-09-12 — Hidden-attribute CSS fix

- Added `[hidden] { display: none !important; }` so the `hidden` attribute wins
  over `display: flex` class rules; the Custom object panels, the Object-B
  picker, and the empty impact banner now stay hidden until actually needed.

## 2026-09-12 — Air resistance + compare mode (sim02b)

- Switched the whole simulation to numerical integration (semi-implicit Euler)
  so air resistance (`drag = ½·Cd·ρ·A·v²`) can be modeled; the vacuum case
  still matches the original closed-form results.
- Added an air-resistance toggle (Vacuum / Air at sea level), object presets
  (feather, hammer, basketball, bowling ball, skydiver) and a Custom object,
  compare mode with two objects and overlaid graphs, a terminal-velocity guide
  line, and per-object impact reporting.

## 2026-09-04 — Initial Freefall Simulator (sim02)

- Single-object 1D freefall under constant gravity with live readouts and
  live-updating height/velocity graphs; closed-form kinematics. Default drop
  (y₀ = 20 m, v₀ = 0) gives t ≈ 2.02 s, v ≈ −19.80 m/s.
