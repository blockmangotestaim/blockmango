# Fist Arena

MCPE-style 3D fist PvP practice vs a bot. Static site, no build step.

**Host on GitHub Pages:** push this folder's contents to a repo, then Settings > Pages > deploy from branch `main` / root.
three.js loads from cdnjs, so players need internet on first load.

## Files
- `js/config.js`  every tunable number (physics, knockback, bot, controls). Edit these.
- `js/sim.js`     pure simulation at 20 ticks/s: world, collision, physics, combat, bot. No DOM.
- `js/game.js`    three.js renderer, tdpad/tpole input, HUD, loop.
- `tests/sim-test.js`  `node tests/sim-test.js` checks walk 4.317 b/s, sprint 5.0 b/s, jump ~1.25, fall damage, i-frames, knockback.

## Modes
- `tdpad`  fixed 8-direction arrow pad.
- `tpole`  analog pole (teal knob), tilt = speed.
Walk vs sprint (player and bot): straight forward (within `sprintConeDeg`, 12 degrees) = sprint 5.0 b/s, any other direction = walk 4.3 b/s. The bot plays the same style as the mode you pick (tdpad bot mostly sprints, tpole bot mostly walks).
Both: tap pad = sneak, right button = jump, touch the screen = ring appears under your finger, drag = look, tap on a target = punch it, hold on it = keep punching (no crosshair, like MCPE).
Desktop: WASD, Space, Shift, Ctrl / double-tap W, mouse. F3 = debug. In the browser console `__FA.CONFIG` is live.

## Bot model
`assets/bot.glb` = "Blockman GO Player Model (Textured)" by Squidweird, CC BY 4.0 (https://sketchfab.com/squidweird.rko). Keep the credit if you publish.
It is a static (unrigged) model, so `game.js` (`makeGltfHumanoid`) pivots the parts itself. The GLB is embedded in `js/botmodel.js` (base64) and parsed by a small built-in reader,
so no network calls are needed. To swap the model: replace `assets/bot.glb` and regenerate `js/botmodel.js` (base64 of the file in `const BOT_GLB_B64`).

## Knockback
Exact flat shift away from the attacker, no lift or jump: `combat.kbBlocksWalk` = 0.9 blocks, `combat.kbBlocksSprint` = 1.4 blocks (attacker sprinting), spread over `kbSlideTicks` ticks. Applies to every hit (bot and player).
Both characters are 1.8 blocks tall (player hitbox 1.8, bot model scaled to exactly 1.8).

## Combat timing and damage
- `combat.hitDelay` = 0.080 s minimum between one character's swings (real game clock, so it is exact even though physics ticks are 50 ms).
- `combat.hitStunSeconds` = 0.15 s: after you are hit you cannot swing (player and bot alike).
- `combat.fistDamage` = 1 HP per hit, `critMultiplier` = 2 -> 2 HP for a jump hit (any hit made while off the ground; set `critNeedsFalling` true for vanilla falling-only crits).
- Hit feedback on the player is the camera shake only (no red screen flash).


## Bot models / animations
- Normal: the standing model (embedded in `js/botmodel.js`), with the walk / punch-swing animation. It stays on screen when the bot jumps (there is no jump pose any more).
- Fist pose: `assets/bot_hit.glb` (fist.glb, embedded as `js/botmodel_hit.js`), a rigged model set to the "Fist_Raised_Stance" pose. Shown for `combat.swingTicks` (6 ticks = 0.3 s) after each bot swing.
- Spam animation: `assets/bot_spam.glb` (bot_fist_spam.glb, embedded as `js/botmodel_spam.js`), an animated model (clip `loop_18f_60fps`, 0.28 s loop). Shown while the bot is spam-clicking and restarts from frame 1 each time. It wins over the fist pose.
  Spam = `combat.spamMinClicks` (3) swings in a row, each within `combat.spamGapSeconds` (0.25 s) of the previous; it keeps playing `combat.spamHoldSeconds` (0.3 s) after the last fast click.
  The bot starts click bursts on its own (`bot.spam`: `chance` per swing, `minClicks`..`maxClicks` clicks, one every `intervalTicks`).
`parseGlb` in `game.js` reads meshes, skeletons (bones/skin weights) and glTF animation clips (played with THREE.AnimationMixer). `makePoseModel` scales/aligns each model to the standing one (`unit`: 100 for fist.glb, 1 for the spam model).
To replace one: put the GLB in `assets/` and regenerate its base64 file, e.g.
`python3 -c "import base64;open('js/botmodel_spam.js','w').write('const BOT_SPAM_GLB_B64 = \"'+base64.b64encode(open('assets/bot_spam.glb','rb').read()).decode()+'\";\n')"`
