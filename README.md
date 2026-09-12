# Freefall Simulator (sim02 / sim02b)

The second in a series of physics teaching simulators for **PHY2201 General
Physics I** (algebra-based) at Merrimack College. It supports the *Falling
Objects* unit: 1D vertical motion under gravity, now with **optional air
resistance** so students can see, hands-on, that objects fall at different
rates *because of drag*, not because of mass — and that in a vacuum a feather
and a hammer land together (the Apollo 15 demo).

Drop an object (or toss it upward) from a chosen height and watch it fall,
with live numeric readouts and height/velocity graphs that fill in as the sim
plays — so students can connect the physics to what they see.

## What it does

- Animated object(s) falling down a vertical track with a meter ruler and a
  ground line. In **Compare mode** two objects fall side by side on the same
  height scale.
- Live readout of time `t`, height `y`, velocity `v`, and acceleration `a` for
  each object (2 decimals), color-matched to its track and graph curves.
- Two live-updating graphs sharing a time axis — **height vs. time** and
  **velocity vs. time** — with both objects overlaid, a legend, and (when air
  is on) a dashed **terminal-velocity** guide line on the velocity graph.
- On impact each object reports its own time and velocity; in Compare mode the
  banner also shows the gap (e.g. "Hammer landed 20.93 s before Feather").

## Controls

- **Air resistance:** a prominent **Vacuum / Air (sea level)** switch. This is
  the main pedagogical control — it sets air density `ρ` to 0 or 1.225 kg/m³.
- **Object:** presets with realistic mass / drag coefficient / area — Feather,
  Hammer, Basketball, Bowling ball, Skydiver (belly-to-earth), plus **Custom**
  (expose mass, C_d, and area directly).
- **Compare two objects:** drop a second object simultaneously to compare.
  Defaults to the Feather-vs-Hammer / air-on demo.
- **Initial height (y₀):** 5–2000 m (slider + number box), default 20 m.
- **Initial velocity (v₀):** 0–20 m/s *upward* (slider + number box), default 0.
  `0` = dropped from rest; positive = tossed straight up.
- **Play / Pause / Reset**, a **Step** button for frame-by-frame analysis, and
  **playback speed** 0.25× / 0.5× / 1× / 2× (speed scales *simulated time*, not
  just the frame rate).
- Keyboard: `Space` = play/pause, `S` = step, `R` = reset.

## Physics

Sign convention: **up is positive**, the ground is `y = 0`. A falling object
has **negative** velocity; reported height is always ≥ 0 and the run stops
exactly at `y = 0`.

Because drag depends on `v²`, there is no closed-form solution, so the **entire
simulation** (including the no-drag case) uses **numerical integration** —
semi-implicit (symplectic) Euler:

```
drag  = 0.5 * Cd * rho * A * v^2      (opposes motion)
a     = -g - k*v*|v|,   k = 0.5*Cd*rho*A / m
v_new = v + a*dt                       (velocity first ...)
y_new = y + v_new*dt                   (... then position; v<0 lowers y)
```

In a vacuum `rho = 0`, so `k = 0` and `a = -g` (constant) for every object —
mass drops out and all objects fall identically. Terminal velocity (drawn as a
guide line when relevant) is where drag balances gravity:

```
v_terminal = sqrt( 2*m*g / (Cd * rho * A) )
```

`g = 9.8 m/s²` and `rho = 1.225 kg/m³` are named constants (`G`, `RHO_SEA`) at
the top of `script.js` — change `G` to run on the Moon. The physics timestep
`DT` is small (1/2000 s, sub-stepped independent of the render frame rate) so
the vacuum case still matches the original closed-form sim02 to 2 decimals.

### Verified acceptance checks

1. **Regression — vacuum, y₀ = 20 m, v₀ = 0:** `t = 2.02 s`, `v = −19.80 m/s`
   (matches the original sim02).
2. **Feather vs. Hammer, y₀ = 20 m** — *air on:* Hammer lands at **2.05 s**,
   Feather at **22.97 s** (hammer first by ~21 s). *Vacuum:* both land together
   at **2.02 s**.
3. **Skydiver, air on, y₀ = 2000 m:** velocity levels off at its terminal
   value ≈ **−54.77 m/s** (realistic belly-to-earth ballpark).

## Running it

- **Locally:** open `index.html` directly in any modern browser. No build step,
  no server, no dependencies.
- **Deployed:** hosted via GitHub Pages — push the folder and the static files
  serve as-is (a `.nojekyll` file is included so Pages serves them verbatim).

## Files

- `index.html` — markup and layout
- `style.css` — styling (classroom-legible, projector-friendly)
- `script.js` — physics integrator + Canvas rendering (commented for review)

No test suite — this is a teaching tool.
