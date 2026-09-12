# Build Spec: Freefall Simulator (sim02)

## Context
This is the second in a series of physics teaching simulators for PHY2201 General
Physics I (algebra-based, no calculus) at Merrimack College. It follows the same
build conventions as sim01 (position/velocity/acceleration grapher). This sim
supports the "Falling Objects" unit (1D kinematics, constant acceleration under
gravity) and will be used both live in lecture and as a standalone student
practice tool, hosted on GitHub Pages.

## Goal
Build a single-page, self-contained web app that lets a student drop an object
from a chosen height and watch it fall under gravity, with live numeric readouts
and live-updating position/velocity graphs, so they can connect the equations of
motion to what they're seeing happen.

## Technical requirements
- Vanilla HTML/CSS/JS only — no frameworks, no build step, no external
  dependencies (must run by opening index.html directly, and must deploy
  cleanly to GitHub Pages with no config).
- Single file (index.html with inline <style> and <script>) unless there's a
  clear reason to split into separate .css/.js files — if you split, keep it
  to 3 files max.
- Use HTML5 Canvas for the falling-object animation.
- Responsive layout: usable on a projector at 1920x1080 and on a laptop
  screen down to ~1280px wide. Doesn't need to support mobile.
- Comment the physics code clearly — I'll be reading it to sanity-check the
  implementation, and may reuse pieces in later sims.

## Physics
- Motion: 1D vertical freefall under constant acceleration, no air resistance.
- g = 9.8 m/s² (downward), configurable as a named constant at the top of the
  code (not hardcoded inline) in case I want to demo g on the Moon later.
- Governing equations (algebra-based course — no calculus in the UI or
  explanations):
  - v(t) = v0 + g*t
  - y(t) = y0 + v0*t - 0.5*g*t²   (y measured as height above ground, so
    falling is a decrease in y; internally track using whatever sign
    convention is cleanest, but the on-screen numbers should read as
    "height above ground" in meters, always ≥ 0, and the sim should stop
    exactly at y = 0, not go negative)
  - Impact time: t = (v0 + sqrt(v0² + 2*g*y0)) / g  for v0 pointing downward,
    or the appropriate root for an upward toss — show your work in a comment.
- Support an optional initial velocity (v0), not just a pure drop from rest —
  a slider or input that goes from -20 m/s (thrown upward) to 0 m/s (dropped
  from rest). Default to 0 (pure freefall) since that's the day-1 case.

## Controls (all visible without scrolling on a laptop)
- Initial height (y0): slider + numeric input, range 5 m to 100 m, default 20 m.
- Initial velocity (v0): slider + numeric input, range -20 m/s to 0 m/s,
  default 0 m/s (label it clearly as "toss upward" vs "drop" so students
  aren't confused by the sign).
- Play / Pause / Reset buttons.
- Playback speed control (0.25x, 0.5x, 1x, 2x) — freefall from realistic
  heights is fast; slow motion matters for teaching.
- A "step forward one frame" button while paused, for frame-by-frame analysis.

## Display
1. **Canvas animation** (left or top, larger panel): the object falling down
   a vertical track with a ground line at the bottom and a height ruler/scale
   marked in meters along the side. Object should be a simple shape (circle
   or small square) — no need for imagery.
2. **Live numeric readout** (updates every frame while playing): elapsed
   time t, current height y, current velocity v, current acceleration
   (always -g, shown to reinforce that it's constant). Use consistent units
   and 2 decimal places.
3. **Two live-updating line graphs**, sharing a time axis, both filling in
   as the sim plays (not just a static pre-drawn curve):
   - Position (height, m) vs. time (s)
   - Velocity (m/s) vs. time (s)
   Axes should auto-scale to the chosen y0/v0/impact time. Include axis
   labels and units.
4. On impact (y reaches 0), pause automatically, show the final time and
   impact velocity clearly (e.g. a small "Impact!" readout: "t = 2.02 s,
   v = -19.8 m/s"), and disable further motion until Reset.

## Style
- Clean and uncluttered — this will be projected in a classroom, so use a
  large, legible font for the numeric readout (at least 20px) and good
  contrast.
- Use a simple, consistent color scheme (e.g. one accent color for
  position-related elements, a second for velocity-related elements, used
  consistently between the readout labels and the matching graph line).
- No animation easing/physics fakery — the fall must track the real
  kinematic equations exactly, including at non-1x playback speeds (i.e.
  playback speed should scale simulated time, not just visual frame rate).

## Deliverables
- `index.html` (plus `style.css` / `script.js` if split, per the file-count
  limit above).
- A short `README.md`: what the sim does, the equations it implements, how
  to run it locally, and a note that it's deployed via GitHub Pages.
- No test suite needed — this is a teaching tool, not production software.

## Explicitly out of scope for this version
- Air resistance / terminal velocity.
- 2D motion or projectile motion (that's the next sim in the series).
- Multiple simultaneous objects being compared side-by-side.
- Sound effects.

## Acceptance check
Before considering this done, verify by hand for the default case (y0 = 20 m,
v0 = 0): impact time should come out to ≈2.02 s and impact velocity ≈-19.8 m/s.
State these two numbers back to me after the build so I can confirm the
physics is right before I use it in class.
