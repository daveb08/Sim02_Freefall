# Changelog

Notable changes to the Freefall Simulator (sim02 / sim02b). Dates are the
day the work landed; entries are newest first.

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
