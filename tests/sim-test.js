// Run with: node tests/sim-test.js   (checks physics against vanilla Minecraft numbers)
const Sim = require('../js/sim.js');
let fails = 0;
let T = 0; const realNow = Sim.now, realTick = Sim.tickEntity;          // fake clock: attacks are gated by time now
Sim.now = () => T; Sim.tickEntity = e => { T += 0.025; return realTick(e); };
const near = (name, got, want, tol) => {
  const ok = Math.abs(got - want) <= tol; if (!ok) fails++;
  console.log((ok ? 'PASS ' : 'FAIL ') + name + ': got ' + got.toFixed(4) + ' want ' + want + ' (+-' + tol + ')');
};
function fresh() {
  Sim.reset(); const p = Sim.player, b = Sim.bot;
  b.alive = false; b.deathTimer = 1e9; p.yaw = -Math.PI / 2; // face +x
  for (let i = 0; i < 5; i++) Sim.tickEntity(p);
  return { p, b };
}
let { p } = fresh();
p.input.f = 1; for (let i = 0; i < 30; i++) Sim.tickEntity(p);
near('walk speed b/s', Math.hypot(p.x - p.px, p.z - p.pz) * 20, 4.317, 0.02);
({ p } = fresh()); p.input.f = 1; p.wantSprint = true; for (let i = 0; i < 30; i++) Sim.tickEntity(p);
near('sprint speed b/s', Math.hypot(p.x - p.px, p.z - p.pz) * 20, 5.0, 0.01);
({ p } = fresh()); const y0 = p.y; let maxY = 0; p.input.jump = true; Sim.tickEntity(p); p.input.jump = false;
for (let i = 0; i < 30; i++) { Sim.tickEntity(p); maxY = Math.max(maxY, p.y - y0); }
near('jump height', maxY, 1.2522, 0.01);
({ p } = fresh()); const fy = p.y; p.y += 10; p.py = p.y; for (let i = 0; i < 60; i++) Sim.tickEntity(p);
near('fall lands on floor', p.y, fy, 0.001); near('fall damage (10 blocks -> ceil(7)=7)', 20 - p.health, 7, 0);
// knockback
Sim.reset(); const a = Sim.player, t = Sim.bot;
a.x = 20.5; a.z = 24.5; t.x = 22.0; t.z = 24.5; a.y = t.y = 1; a.yaw = -Math.PI / 2; a.pitch = 0;
for (let i = 0; i < 3; i++) { Sim.tickEntity(a); Sim.tickEntity(t); }
const ok1 = Sim.tryAttack(a, t);
console.log((ok1 ? 'PASS' : 'FAIL') + ' fist hit lands at 1.5 blocks'); if (!ok1) fails++;
near('victim health after hit', t.health, 19, 0);
const ok2 = Sim.tryAttack(a, t);
console.log((!ok2 ? 'PASS' : 'FAIL') + ' second hit blocked by i-frames'); if (ok2) fails++;
for (let i = 0; i < 11; i++) { Sim.tickEntity(a); Sim.tickEntity(t); }
a.x = t.x - 1.5; a.y = 1; for (let i = 0; i < 1; i++) {}
const ok3 = Sim.tryAttack(a, t);
console.log((ok3 ? 'PASS' : 'FAIL') + ' hit lands again after 10+ ticks'); if (!ok3) fails++;
const far = (() => { t.invul = 0; t.x = 30; return Sim.tryAttack(a, t); })();
console.log((!far ? 'PASS' : 'FAIL') + ' out of reach misses'); if (far) fails++;
// exact knockback distances: 0.9 walking hit, 1.4 sprinting hit, no lift
function kbTest(sprint, victimAir) {
  Sim.reset(); const a = Sim.player, v = Sim.bot; a.x = 20.5; a.z = 24.5; v.x = 22.0; v.z = 24.5; a.yaw = -Math.PI / 2; a.pitch = 0;
  v.alive = true; v.health = 20; v.brain.atkCd = 1e9; v.input.f = v.input.s = 0;
  if (victimAir) { v.y = 1.6; v.py = 1.6; }   // a little above the ground, inside the attacker's line of fire
  for (let i = 0; i < 3; i++) { Sim.tickEntity(a); Sim.tickEntity(v); }
  a.sprinting = sprint; const x0 = v.x, z0 = v.z, y0 = v.y; let maxRise = 0;
  const ok = Sim.tryAttack(a, v); a.sprinting = false;
  for (let i = 0; i < require("./../js/config.js").combat.kbSlideTicks; i++) { v.input.f = 1; v.input.jump = true; Sim.tickEntity(v); maxRise = Math.max(maxRise, v.y - y0); }  // mashing forward+jump during the slide changes nothing
  const d = Math.hypot(v.x - x0, v.z - z0), dir = v.x - x0, dz = v.z - z0;
  v.input.f = 0; v.input.jump = false; for (let i = 0; i < 10; i++) Sim.tickEntity(v);                                        // afterwards: no residual drift
  return { ok, d, dir, dz, maxRise, drift: Math.hypot(v.x - x0, v.z - z0) - d, onGround: v.onGround };
}
let r = kbTest(false, false);
near('knockback, normal hit (blocks)', r.d, 0.9, 0.001); near('  pushed away from attacker (+x)', r.dir, 0.9, 0.001); near('  no residual drift after the shift', r.drift, 0, 0.001); near('  no sideways drift (z)', r.dz, 0, 0.001); near('  no lift', r.maxRise, 0, 0.001);
r = kbTest(true, false);
near('knockback, sprint hit (blocks)', r.d, 1.4, 0.001); near('  no lift (sprint hit)', r.maxRise, 0, 0.001);
r = kbTest(false, true);
console.log((r.ok ? 'PASS' : 'FAIL') + ' knockback works on an airborne victim and adds no upward push'); if (!r.ok) fails++;
// tap-to-target: view looks away, but the tap ray (aimDir) points at the bot
Sim.reset(); const q = Sim.player, w = Sim.bot;
q.x = 20.5; q.z = 24.5; w.x = 22.5; w.z = 24.5; q.yaw = 0; q.pitch = 0;
for (let i = 0; i < 3; i++) { Sim.tickEntity(q); Sim.tickEntity(w); }
const eye = Sim.eyeOf(q), tc = { x: w.x - eye.x, y: w.y + 1 - eye.y, z: w.z - eye.z }, tl = Math.hypot(tc.x, tc.y, tc.z);
q.aimDir = { x: tc.x / tl, y: tc.y / tl, z: tc.z / tl };
const tapHit = Sim.aimCheck(q, w); q.aimDir = null; const centreMiss = Sim.aimCheck(q, w);
console.log((tapHit && !centreMiss ? 'PASS' : 'FAIL') + ' tap ray hits target the view-centre ray misses'); if (!(tapHit && !centreMiss)) fails++;
q.aimDir = { x: 0, y: 0, z: -1 }; const offTap = Sim.aimCheck(q, w); q.aimDir = null;
console.log((!offTap ? 'PASS' : 'FAIL') + ' tap on empty space misses'); if (offTap) fails++;
// walk vs sprint rule
const cone = Sim.inSprintCone;
const okCone = cone(1, 0) && cone(1, 0.15) && !cone(1, 0.3) && !cone(1, 1) && !cone(0, 1) && !cone(-1, 0) && !cone(1, 0.5 / 1);
console.log((okCone ? 'PASS' : 'FAIL') + ' sprint cone: straight (<12deg) = sprint, 17deg+/diagonal/side/back = walk'); if (!okCone) fails++;
({ p } = fresh()); p.input.f = Math.cos(0.5); p.input.s = Math.sin(0.5); p.wantSprint = Sim.inSprintCone(p.input.f, p.input.s); for (let i = 0; i < 30; i++) Sim.tickEntity(p);
near('angled (29deg) walks at normal speed', Math.hypot(p.x - p.px, p.z - p.pz) * 20, 4.317, 0.05);
({ p } = fresh()); p.input.f = 1; p.input.s = 0; p.wantSprint = true; for (let i = 0; i < 30; i++) Sim.tickEntity(p);
near('straight forward sprints', Math.hypot(p.x - p.px, p.z - p.pz) * 20, 5.0, 0.01);
p.input.f = Math.cos(0.7); p.input.s = Math.sin(0.7); p.wantSprint = Sim.inSprintCone(p.input.f, p.input.s); for (let i = 0; i < 30; i++) Sim.tickEntity(p);
const lostSprint = !p.sprinting; console.log((lostSprint ? 'PASS' : 'FAIL') + ' drifting sideways while sprinting drops to walk'); if (!lostSprint) fails++;
// bot style: fraction of moving ticks spent sprinting
// ---- hit delay, hit stun, damage ----
function dirTo(a, t) { const o = Sim.eyeOf(a), dx = t.x - o.x, dy = t.y + 0.9 - o.y, dz = t.z - o.z, l = Math.hypot(dx, dy, dz); return { x: dx / l, y: dy / l, z: dz / l }; }
function duel() { Sim.reset(); const A = Sim.player, V = Sim.bot; A.x = 20.5; A.z = 24.5; V.x = 22.0; V.z = 24.5; A.y = V.y = 1; A.yaw = -Math.PI / 2; A.pitch = 0; V.yaw = Math.PI / 2; V.pitch = 0;
  for (let i = 0; i < 3; i++) { realTick(A); realTick(V); } return { A, V }; }
{ let { A, V } = duel(); T = 100; Sim.tryAttack(A, V);
  near('1 normal hit = 1 HP', 20 - V.health, 1, 0);
  ({ A, V } = duel()); A.y = 1.6; A.onGround = false; A.aimDir = dirTo(A, V); T = 100; Sim.tryAttack(A, V);
  near('jump hit (airborne) = 2 HP', 20 - V.health, 2, 0);
  ({ A, V } = duel()); let swings = 0; Sim.events.onSwing = () => swings++;
  T = 1; Sim.tryAttack(A, V); T = 1.0799; Sim.tryAttack(A, V); const blocked = swings === 1; T = 1.0801; Sim.tryAttack(A, V);
  console.log((blocked && swings === 2 ? 'PASS' : 'FAIL') + ' hit delay: swing blocked at 0.0799 s, allowed at 0.0801 s'); if (!(blocked && swings === 2)) fails++;
  ({ A, V } = duel()); swings = 0; const who = []; Sim.events.onSwing = e => who.push(e === Sim.player ? 'player' : 'bot');
  T = 5; Sim.tryAttack(V, A);                                   // the bot hits the player
  T = 5.10; Sim.tryAttack(A, V); const stunnedBlocked = !who.includes('player');
  T = 5.16; Sim.tryAttack(A, V); const freeAgain = who.includes('player');
  console.log((stunnedBlocked && freeAgain ? 'PASS' : 'FAIL') + ' hit stun: the player cannot hit back for 0.15 s after being hit'); if (!(stunnedBlocked && freeAgain)) fails++;
  ({ A, V } = duel()); who.length = 0; T = 7; Sim.tryAttack(A, V); T = 7.10; Sim.tryAttack(V, A); const botBlocked = !who.includes('bot'); T = 7.16; Sim.tryAttack(V, A); const botFree = who.includes('bot');
  console.log((botBlocked && botFree ? 'PASS' : 'FAIL') + ' hit stun applies to the bot too'); if (!(botBlocked && botFree)) fails++;
  Sim.events.onSwing = function () {}; }
// ---- spam detection ----
{ let { A, V } = duel(); Sim.events.onSwing = function () {}; A.lastAttackAt = -1;
  T = 50; Sim.tryAttack(A, V); T = 50.10; Sim.tryAttack(A, V); const notYet = !(T < A.spamUntil);
  T = 50.20; Sim.tryAttack(A, V); const spamming = T < A.spamUntil;
  T = 50.20 + 0.30 - 0.001; const holds = T < A.spamUntil; T = 50.20 + 0.30 + 0.001; const ends = !(T < A.spamUntil);
  console.log((notYet && spamming && holds && ends ? 'PASS' : 'FAIL') + ' spam: 3 fast clicks (0.1 s apart) = spamming, ends 0.3 s after the last one'); if (!(notYet && spamming && holds && ends)) fails++;
  ({ A, V } = duel()); T = 80; Sim.tryAttack(A, V); T = 80.45; Sim.tryAttack(A, V); T = 80.90; Sim.tryAttack(A, V); T = 81.35; Sim.tryAttack(A, V);
  const slowOk = !(T < A.spamUntil); console.log((slowOk ? 'PASS' : 'FAIL') + ' spam: slow clicking (0.45 s apart) is not spam'); if (!slowOk) fails++; }
Sim.now = realNow; Sim.tickEntity = realTick;                   // back to the real clock for the match simulations below
function botSprintShare(style) {
  Sim.reset(); Sim.botStyle = style; let mv = 0, sp = 0, dir = 0;
  for (let i = 0; i < 6000; i++) {
    const p = Sim.player; p.health = 20; p.alive = true;
    if (i % 40 === 0) dir = Math.random() * Math.PI * 2;                // player wanders at walking pace
    p.yaw = dir; p.input.f = 1; p.input.s = 0; p.wantSprint = false;
    if (p.x < 6 || p.x > 42 || p.z < 6 || p.z > 42) { p.yaw = Math.atan2(-(24 - p.x), -(24 - p.z)); dir = p.yaw; }
    Sim.step();
    const b = Sim.bot; if (b.alive && Math.hypot(b.x - b.px, b.z - b.pz) > 0.02) { mv++; if (b.sprinting) sp++; }
  }
  return sp / Math.max(1, mv);
}
const shareD = botSprintShare('tdpad'), shareP = botSprintShare('tpole');
console.log('bot sprint share  tdpad: ' + shareD.toFixed(2) + '   tpole: ' + shareP.toFixed(2));
const okShare = shareD > 0.5 && shareP < 0.4 && shareD > shareP + 0.2;
console.log((okShare ? 'PASS' : 'FAIL') + ' tdpad bot mostly sprints, tpole bot mostly walks'); if (!okShare) fails++;
Sim.botStyle = require('../js/config.js').defaultMode;
// bot AI: it should sometimes spam-click in bursts, but not all the time
{ Sim.reset(); Sim.botStyle = 'tdpad'; let spamTicks = 0, bursts = 0, was = false, alive = 0;
  for (let i = 0; i < 12000; i++) { const p = Sim.player; p.health = 20; p.alive = true; p.x = 24; p.z = 24; p.vx = p.vz = 0; p.stunUntil = 0; Sim.step();
    const b = Sim.bot; if (b.alive) { alive++; const s = Sim.now() < b.spamUntil; if (s) spamTicks++; if (s && !was) bursts++; was = s; } }
  const share = spamTicks / alive; console.log('bot spam: ' + bursts + ' bursts in ' + (12000 / 20 / 60).toFixed(0) + ' min, spamming ' + (share * 100).toFixed(0) + '% of the time');
  const okSpam = bursts >= 5 && share > 0.05 && share < 0.7; console.log((okSpam ? 'PASS' : 'FAIL') + ' bot spam-clicks in bursts sometimes (not never, not always)'); if (!okSpam) fails++; }
// full match smoke test: bot vs idle player for 60s
Sim.reset(); for (let i = 0; i < 1200; i++) Sim.step();
console.log('bot score after 60s vs idle player: ' + Sim.score.bot + ', player hp ' + Sim.player.health);
console.log(Sim.score.bot > 0 ? 'PASS bot kills an idle player' : 'FAIL bot never scored'); if (!(Sim.score.bot > 0)) fails++;
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASSED'); process.exit(fails ? 1 : 0);
