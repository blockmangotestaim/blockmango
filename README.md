# Fist Arena

MCPE-style 3D fist PvP practice vs a bot. Static site, no build step.

**Host on GitHub Pages:** push this folder's contents to a repo, then Settings > Pages > deploy from branch `main` / root.
three.js loads from cdnjs, so players need internet on first load.

## Files
- `js/config.js`  every tunable number (physics, knockback, bot, controls). Edit these.
- `js/sim.js`     pure simulation at 20 ticks/s: world, collision, physics, combat, bot. No DOM.
- `js/game.js`    three.js renderer, tdpad/tpole input, HUD, loop.
- `tests/sim-test.js`  `node tests/sim-test.js` checks walk 4.317 b/s, sprint 5.612 b/s, jump ~1.25, fall damage, i-frames, knockback.

## Modes
- `tdpad`  fixed 8-direction arrow pad.
- `tpole`  analog pole (teal knob), tilt = speed.
Walk vs sprint (player and bot): straight forward (within `sprintConeDeg`, 12 degrees) = sprint 5.6 b/s, any other direction = walk 4.3 b/s. The bot plays the same style as the mode you pick (tdpad bot mostly sprints, tpole bot mostly walks).
Both: tap pad = sneak, right button = jump, touch the screen = ring appears under your finger, drag = look, tap on a target = punch it, hold on it = keep punching (no crosshair, like MCPE).
Desktop: WASD, Space, Shift, Ctrl / double-tap W, mouse. F3 = debug. In the browser console `__FA.CONFIG` is live.

## Bot model
`assets/bot.glb` = "Blockman GO Player Model (Textured)" by Squidweird, CC BY 4.0 (https://sketchfab.com/squidweird.rko). Keep the credit if you publish.
It is a static (unrigged) model, so `game.js` (`makeGltfHumanoid`) pivots the parts itself. The GLB is embedded in `js/botmodel.js` (base64) and parsed by a small built-in reader,
so no network calls are needed. To swap the model: replace `assets/bot.glb` and regenerate `js/botmodel.js` (base64 of the file in `const BOT_GLB_B64`).
