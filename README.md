# Freefall Simulator (sim02)

The second in a series of physics teaching simulators for **PHY2201 General
Physics I** (algebra-based) at Merrimack College. It supports the *Falling
Objects* unit: 1D vertical motion under constant gravity, no air resistance.

Drop an object (or toss it upward) from a chosen height and watch it fall,
with live numeric readouts and position/velocity graphs that fill in as the
sim plays — so students can connect the equations of motion to what they see.

## What it does

- Animated object falling down a vertical track with a meter ruler and a
  ground line.
- Live readout of time `t`, height `y`, velocity `v`, and acceleration `a`
  (always `-g`, to reinforce that it's constant), all to 2 decimals.
- Two live-updating graphs sharing a time axis: **height vs. time** (blue) and
  **velocity vs. time** (green). Axes auto-scale to the chosen height, initial
  velocity, and impact time.
- On impact the sim pauses automatically and reports the impact time and
  velocity, then locks until **Reset**.

## Controls

- **Initial height (y₀):** 5–100 m (slider + number box), default 20 m.
- **Initial velocity (v₀):** 0–20 m/s *upward* (slider + number box), default 0.
  `0` = dropped from rest; positive = tossed straight up. The label switches
  between "drop from rest" and "toss upward" so the sign is unambiguous.
- **Play / Pause / Reset**, plus a **Step** button to advance one frame at a
  time while paused (frame-by-frame analysis).
- **Playback speed:** 0.25× / 0.5× / 1× / 2×. Speed scales *simulated time*,
  not just the frame rate — the motion always tracks the real physics.
- Keyboard: `Space` = play/pause, `S` = step, `R` = reset.

## Physics (the equations it implements)

Sign convention: **up is positive**, the ground is `y = 0`. A falling object
therefore has **negative** velocity, and acceleration is a constant `-g`.
Reported height is always ≥ 0, and the run stops exactly at `y = 0`.

```
a(t) = -g                         (constant)
v(t) = v0 - g*t
y(t) = y0 + v0*t - 0.5*g*t^2       (height above the ground)
```

Impact time comes from solving `y(t) = 0` (a quadratic); the physical root is

```
t_impact = ( v0 + sqrt(v0^2 + 2*g*y0) ) / g
```

`g = 9.8 m/s²` is defined as a single named constant `G` at the top of
`script.js`, so you can re-run the whole sim on the Moon (`G = 1.62`) by
changing one line. The full derivation is in the comments above
`impactTime()`.

**Sanity check (default y₀ = 20 m, v₀ = 0):** impact time ≈ **2.02 s**,
impact velocity ≈ **−19.80 m/s**.

## Running it

- **Locally:** open `index.html` directly in any modern browser. No build
  step, no server, no dependencies.
- **Deployed:** hosted via GitHub Pages — just push the folder; the static
  files serve as-is with no configuration.

## Files

- `index.html` — markup and layout
- `style.css` — styling (classroom-legible, projector-friendly)
- `script.js` — physics + Canvas rendering (commented for review)

No test suite — this is a teaching tool.
