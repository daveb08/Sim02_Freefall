# Build Spec Addendum: Air Resistance for Freefall Simulator (sim02b)

## Context
This extends the existing sim02 freefall simulator (already built and working:
default case of y0=20m, v0=0, no drag gives t≈2.02s, v≈-19.8 m/s on impact).
**Extend the existing code — do not rewrite it from scratch.** The no-drag
case must still produce the same numbers after this change (see Acceptance
check below).

## Goal
Let students see, hands-on, that objects fall at different rates *because of
air resistance*, not because of mass — and that in a vacuum (drag = 0), a
feather and a hammer hit the ground at the same time (Apollo 15 demo). This
means the sim needs to support choosing an object, toggling air resistance,
and ideally dropping two objects side by side to compare.

## Physics change: from closed-form to numerical integration
With drag, the equation of motion is no longer solvable in closed form
(drag force depends on v²), so switch the *entire* simulation — including the
existing no-drag case — to numerical integration. Use semi-implicit
(symplectic) Euler, which is simple, stable, and accurate enough at a small
timestep:

  For each timestep dt (recommend dt = 1/120 s, independent of render frame
  rate — sub-step if needed to keep physics stable at low playback speeds):
    drag_force = 0.5 * Cd * rho * A * v²   (opposes direction of motion)
    a = -g + (drag_force / m) * (sign depends on direction of v; drag always
        opposes velocity, i.e. points upward while falling)
    v_new = v + a * dt
    y_new = y - v_new * dt   (clamp at y = 0, stop simulation, record impact)

Where:
  - g = 9.8 m/s² (existing constant)
  - rho = air density, kg/m³ (1.225 = sea level default; expose as a value
    tied to the "air resistance on/off" toggle — see Controls)
  - Cd = drag coefficient (dimensionless, depends on object shape)
  - A = cross-sectional area, m²
  - m = mass, kg

Terminal velocity (for reference / optional on-screen readout) = 
  sqrt((2*m*g) / (Cd * rho * A))

## Controls (add to existing control panel, don't remove existing ones)
- **Air resistance toggle**: "Vacuum" vs "Air (sea level)". This directly
  sets rho to 0 or 1.225 kg/m³. This is the main pedagogical control — make
  it visually prominent (e.g. a labeled switch, not buried in a menu).
- **Object preset dropdown**, each with realistic mass/Cd/frontal-area
  values (approximate real-world figures are fine, don't need to be exact):
  - Feather (m ≈ 0.001 kg, very high drag-to-weight ratio)
  - Hammer (m ≈ 1.0 kg, small area)
  - Basketball (m ≈ 0.62 kg, larger area, moderate Cd)
  - Bowling ball (m ≈ 7 kg, small area relative to mass)
  - Skydiver, belly-to-earth (m ≈ 75 kg, large area — should reach a
    realistic terminal velocity around 50-60 m/s at large drop heights)
  - Custom: expose mass, Cd, and area as sliders/inputs so students can
    experiment directly
- **Compare mode** (checkbox): when on, show a second object-preset dropdown
  and drop both objects simultaneously side by side (two tracks on the
  canvas, two colors, both feeding the same graphs so their curves can be
  compared directly). This is what makes the feather-vs-hammer demo work —
  it should be the featured/default way to use this mode, e.g. default to
  Feather vs. Hammer with air resistance ON, so a student immediately sees
  them separate, then flips to Vacuum and sees them land together.
- Keep existing height (y0), initial velocity (v0), play/pause/reset,
  playback speed, and step-forward controls working for both objects at once
  when in Compare mode.

## Display changes
- Canvas: when Compare mode is on, render two vertical tracks side by side
  (or two objects on a shared track if that's visually clearer — your call,
  but they must be clearly distinguishable and both visible falling at once).
- Live readout: show time, height, velocity, acceleration for each object
  when comparing (labeled clearly, color-matched to the object/track).
- Graphs: both objects' position-vs-time and velocity-vs-time curves overlay
  on the same axes, color-matched, with a small legend.
- When air resistance is on and the object's terminal velocity would be
  reached within the drop height, show a light dashed horizontal line on the
  velocity graph at that terminal velocity value, labeled "terminal
  velocity" — this is a good discussion trigger even if a given drop height
  is too short to actually reach it.
- On impact for each object independently: show its own "Impact!" readout
  (time and velocity), and if in Compare mode, also show the time gap
  between the two impacts (e.g. "Hammer landed 1.3 s before Feather").

## Explicitly out of scope
- Wind, lift, or any non-vertical forces.
- Spin or orientation effects (a real feather tumbles — ignore that, treat
  all objects as a point mass with a fixed effective Cd*A).
- Variable air density with altitude.
- More than two simultaneous objects.

## Acceptance check
Report back to me after the build:
1. **Regression check**: with Air resistance = Vacuum, y0=20m, v0=0
   (either object, since drag=0 makes them identical) — must still give
   t≈2.02s, v≈-19.8 m/s, matching the original sim02 behavior.
2. **Sanity check**: with Air resistance = On, Compare mode on, Feather vs.
   Hammer, y0=20m, v0=0 — confirm the hammer lands noticeably first (report
   both impact times) and that switching to Vacuum with the same setup makes
   them land within a small fraction of a second of each other (report both
   impact times again).
3. **Terminal velocity sanity check**: Skydiver preset, air on, dropped from
   a large height (e.g. y0=2000m) — report the velocity at which it levels
   off and confirm it's in a realistic ballpark (~50-60 m/s).
