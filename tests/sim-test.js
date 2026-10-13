// Run with: node tests/sim-test.js   (checks physics against vanilla Minecraft numbers)
const Sim = require('../js/sim.js');
let fails = 0;
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
near('sprint speed b/s', Math.hypot(p.x - p.px, p.z - p.pz) * 20, 5.612, 0.03);
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
near('victim health after hit', t.health, 19, 0); near('victim kb vx', t.vx, 0.4, 0.05);
const ok2 = Sim.tryAttack(a, t);
console.log((!ok2 ? 'PASS' : 'FAIL') + ' second hit blocked by i-frames'); if (ok2) fails++;
for (let i = 0; i < 11; i++) { Sim.tickEntity(a); Sim.tickEntity(t); }
a.x = t.x - 1.5; a.y = 1; for (let i = 0; i < 1; i++) {}
const ok3 = Sim.tryAttack(a, t);
console.log((ok3 ? 'PASS' : 'FAIL') + ' hit lands again after 10+ ticks'); if (!ok3) fails++;
const far = (() => { t.invul = 0; t.x = 30; return Sim.tryAttack(a, t); })();
console.log((!far ? 'PASS' : 'FAIL') + ' out of reach misses'); if (far) fails++;
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
near('straight forward sprints', Math.hypot(p.x - p.px, p.z - p.pz) * 20, 5.612, 0.05);
p.input.f = Math.cos(0.7); p.input.s = Math.sin(0.7); p.wantSprint = Sim.inSprintCone(p.input.f, p.input.s); for (let i = 0; i < 30; i++) Sim.tickEntity(p);
const lostSprint = !p.sprinting; console.log((lostSprint ? 'PASS' : 'FAIL') + ' drifting sideways while sprinting drops to walk'); if (!lostSprint) fails++;
// bot style: fraction of moving ticks spent sprinting
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
// full match smoke test: bot vs idle player for 60s
Sim.reset(); for (let i = 0; i < 1200; i++) Sim.step();
console.log('bot score after 60s vs idle player: ' + Sim.score.bot + ', player hp ' + Sim.player.health);
console.log(Sim.score.bot > 0 ? 'PASS bot kills an idle player' : 'FAIL bot never scored'); if (!(Sim.score.bot > 0)) fails++;
console.log(fails ? ('\n' + fails + ' FAILED') : '\nALL PASSED'); process.exit(fails ? 1 : 0);
