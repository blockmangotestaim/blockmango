/* =====================================================================
   FIST ARENA - sim.js
   Pure game simulation. No DOM, no three.js, so it can be unit-tested in
   Node (see tests/sim-test.js). Runs at a fixed 20 ticks/second.
   Coordinates: x/z horizontal, y up. yaw 0 faces -Z, forward = (-sin yaw, -cos yaw).
   ===================================================================== */
(function () {
  'use strict';
  const C = (typeof CONFIG !== 'undefined') ? CONFIG : require('./config.js');
  const P = C.physics, CB = C.combat, BT = C.bot, PL = C.player;

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const wrapRad = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
  const rand = (a, b) => a + Math.random() * (b - a);
  const randInt = (a, b) => Math.floor(rand(a, b + 1));

  /* ---------------- world ---------------- */
  const B = { AIR: 0, GRASS: 1, DIRT: 2, STONE: 3, PLANKS: 4, COBBLE: 5 };
  const WX = 48, WY = 10, WZ = 48;
  const blocks = new Uint8Array(WX * WY * WZ);
  const idx = (x, y, z) => (y * WZ + z) * WX + x;

  // Infinite flat world: y = 0 is grass everywhere, y < 0 is solid. The WX x WY x WZ array only stores the
  // obstacles near the spawn area; anything outside it is open air above the floor.
  function getBlock(x, y, z) {
    if (y < 0) return B.STONE;
    if (y === 0) return B.GRASS;
    if (y >= WY || x < 0 || z < 0 || x >= WX || z >= WZ) return B.AIR;
    return blocks[idx(x, y, z)];
  }
  const isSolid = (x, y, z) => getBlock(x, y, z) !== 0;
  function fillBox(x0, y0, z0, x1, y1, z1, id) {
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
      if (x >= 0 && y >= 0 && z >= 0 && x < WX && y < WY && z < WZ) blocks[idx(x, y, z)] = id;
  }
  function surfaceY(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    for (let y = WY - 1; y >= 0; y--) if (getBlock(ix, y, iz)) return y + 1;
    return 0;
  }
  function generateWorld() {
    blocks.fill(0);   // completely flat: the floor is implicit (see getBlock), no obstacles
  }

  /* ---------------- entities ---------------- */
  const SPAWN = { player: { x: 6.5, z: 24.5, yaw: -Math.PI / 2 }, bot: { x: 41.5, z: 24.5, yaw: Math.PI / 2 } };

  function createEntity(name, x, z, yaw) {
    const y = surfaceY(x, z);
    return {
      name, x, y, z, px: x, py: y, pz: z, vx: 0, vy: 0, vz: 0,
      yaw, pitch: 0, pyaw: yaw, ppitch: 0,
      onGround: false, hCollide: false, sprinting: false, wantSprint: false, sneaking: false,
      health: PL.maxHealth, invul: 0, lastDmg: 0, hurtTime: 0, jumpTicks: 0, fallDist: 0, swing: 0,
      alive: true, deathTimer: 0, deathTicks: 0, regen: 0, lastAttacker: null,
      input: { f: 0, s: 0, jump: false }, wantAttack: false, sprintCancel: false, aimDir: null,
      limbPhase: 0, plimbPhase: 0, limbAmp: 0, plimbAmp: 0,
      walkMod: 0, pwalkMod: 0, camYaw: 0, pcamYaw: 0,
      brain: { dirTimer: 0, dir: [1, 0], heading: 0, headTarget: 0, side: 1, atkCd: 20, sprintDelay: 0 },
    };
  }

  /* ---------------- collision ---------------- */
  const HW = PL.width / 2, EPS = 1e-4;
  function overlaps(e) {
    const x0 = Math.floor(e.x - HW + EPS), x1 = Math.floor(e.x + HW - EPS);
    const y0 = Math.floor(e.y + EPS), y1 = Math.floor(e.y + PL.height - EPS);
    const z0 = Math.floor(e.z - HW + EPS), z1 = Math.floor(e.z + HW - EPS);
    for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++)
      if (isSolid(x, y, z)) return true;
    return false;
  }
  // Move along one axis in small steps (no tunnelling at terminal velocity), snap to block face on hit.
  function collideAxis(e, axis, d) {
    if (d === 0) return false;
    const n = Math.ceil(Math.abs(d) / 0.25), sd = d / n;
    for (let i = 0; i < n; i++) {
      if (axis === 0) e.x += sd; else if (axis === 1) e.y += sd; else e.z += sd;
      if (overlaps(e)) {
        if (axis === 0) e.x = sd > 0 ? Math.floor(e.x + HW - EPS) - HW : Math.floor(e.x - HW + EPS) + 1 + HW;
        else if (axis === 2) e.z = sd > 0 ? Math.floor(e.z + HW - EPS) - HW : Math.floor(e.z - HW + EPS) + 1 + HW;
        else e.y = sd > 0 ? Math.floor(e.y + PL.height - EPS) - PL.height : Math.floor(e.y + EPS) + 1;
        return true;
      }
    }
    return false;
  }

  /* ---------------- per-tick physics (Minecraft LivingEntity.travel) ---------------- */
  function tickEntity(e) {
    e.px = e.x; e.py = e.y; e.pz = e.z; e.pyaw = e.yaw; e.ppitch = e.pitch;
    e.plimbPhase = e.limbPhase; e.plimbAmp = e.limbAmp; e.pwalkMod = e.walkMod; e.pcamYaw = e.camYaw;

    if (e.jumpTicks > 0) e.jumpTicks--;
    if (e.invul > 0) e.invul--;
    if (e.hurtTime > 0) e.hurtTime--;
    if (e.swing > 0) e.swing--;
    if (Math.abs(e.vx) < 0.005) e.vx = 0;
    if (Math.abs(e.vy) < 0.005) e.vy = 0;
    if (Math.abs(e.vz) < 0.005) e.vz = 0;

    const inp = e.alive ? e.input : { f: 0, s: 0, jump: false };
    const sneaking = e.alive && e.sneaking;

    // sprint rules: start needs forward >= 0.8, stops on low input / wall / sneak
    if (!e.sprinting && e.alive && e.wantSprint && inp.f >= 0.8 && !sneaking) e.sprinting = true;
    if (e.sprinting && (inp.f < 0.8 || e.hCollide || sneaking || !e.alive || !e.wantSprint)) e.sprinting = false;   // sprint only while heading straight (wantSprint)

    // jump
    if (inp.jump && e.onGround && e.jumpTicks === 0) {
      e.vy = P.jumpVelocity; e.jumpTicks = P.jumpDelayTicks;
      if (e.sprinting) { e.vx += -Math.sin(e.yaw) * P.sprintJumpBoost; e.vz += -Math.cos(e.yaw) * P.sprintJumpBoost; }
    }

    // moveRelative
    let f = inp.f * P.inputScale, s = inp.s * P.inputScale;
    if (sneaking) { f *= P.sneakMultiplier; s *= P.sneakMultiplier; }
    const slip = e.onGround ? P.groundSlip * P.airFriction : P.airFriction;
    let accel;
    if (e.onGround) accel = P.walkSpeed * (e.sprinting ? P.sprintMultiplier : 1) * (0.16277136 / (slip * slip * slip));
    else accel = e.sprinting ? P.sprintAirControl : P.airControl;
    let dist = s * s + f * f;
    if (dist >= 1e-4) {
      dist = Math.sqrt(dist); if (dist < 1) dist = 1; dist = accel / dist;
      s *= dist; f *= dist;
      const sin = Math.sin(e.yaw), cos = Math.cos(e.yaw);
      // forward = (-sin, -cos), right = (cos, -sin)
      e.vx += s * cos - f * sin;
      e.vz += -s * sin - f * cos;
    }

    // moveEntity (Y, X, Z like vanilla)
    const dx = e.vx, dy = e.vy, dz = e.vz, oy = e.y;
    const cy = collideAxis(e, 1, dy), cx = collideAxis(e, 0, dx), cz = collideAxis(e, 2, dz);
    e.onGround = cy && dy < 0;
    if (cy) e.vy = 0;
    if (cx) e.vx = 0;
    if (cz) e.vz = 0;
    e.hCollide = cx || cz;

    // fall damage
    const moved = e.y - oy;
    if (e.onGround) {
      if (e.fallDist > P.fallSafeDistance && e.alive) hurt(e, Math.ceil(e.fallDist - P.fallSafeDistance), null);
      e.fallDist = 0;
    } else if (moved < 0) e.fallDist -= moved;

    // gravity + friction
    e.vy = (e.vy - P.gravity) * P.drag;
    e.vx *= slip; e.vz *= slip;

    // animation helpers
    const hd = Math.hypot(e.x - e.px, e.z - e.pz);
    e.limbAmp += (Math.min(1, hd * 4) - e.limbAmp) * 0.4;
    e.limbPhase += e.limbAmp;
    e.walkMod += hd * 0.6;
    const camTarget = (e.onGround && e.alive) ? Math.min(0.1, Math.hypot(e.vx, e.vz)) : 0;
    e.camYaw += (camTarget - e.camYaw) * 0.4;

    // regen
    if (e.alive && e.health < PL.maxHealth) { if (++e.regen >= CB.regenTicks) { e.health = Math.min(PL.maxHealth, e.health + 1); e.regen = 0; } }
  }

  function pushEntities(a, b) {
    if (!a.alive || !b.alive) return;
    const w = PL.width, H = PL.height;
    if (Math.abs(a.x - b.x) < w && Math.abs(a.z - b.z) < w && a.y < b.y + H && b.y < a.y + H) {
      let dx = b.x - a.x, dz = b.z - a.z, m = Math.max(Math.abs(dx), Math.abs(dz));
      if (m >= 0.01) {
        m = Math.sqrt(m); dx /= m; dz /= m;
        let k = 1 / m; if (k > 1) k = 1;
        dx *= k * P.entityPush; dz *= k * P.entityPush;
        a.vx -= dx; a.vz -= dz; b.vx += dx; b.vz += dz;
      }
    }
  }

  /* ---------------- combat ---------------- */
  const eyeOf = e => ({ x: e.x, y: e.y + (e.sneaking ? PL.sneakEyeHeight : PL.eyeHeight), z: e.z });
  const lookDir = e => { const cp = Math.cos(e.pitch); return { x: -Math.sin(e.yaw) * cp, y: Math.sin(e.pitch), z: -Math.cos(e.yaw) * cp }; };

  function rayBox(o, d, mn, mx) {
    let tmin = 0, tmax = Infinity;
    for (const a of ['x', 'y', 'z']) {
      if (Math.abs(d[a]) < 1e-9) { if (o[a] < mn[a] || o[a] > mx[a]) return null; }
      else {
        let t1 = (mn[a] - o[a]) / d[a], t2 = (mx[a] - o[a]) / d[a];
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        tmin = Math.max(tmin, t1); tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
    }
    return tmin;
  }
  function blockRayDist(o, d, maxD) {
    for (let t = 0; t <= maxD; t += 0.05)
      if (isSolid(Math.floor(o.x + d.x * t), Math.floor(o.y + d.y * t), Math.floor(o.z + d.z * t))) return t;
    return Infinity;
  }

  const Sim = {
    C, B, world: { WX, WY, WZ, getBlock, isSolid, surfaceY },
    player: null, bot: null, score: { player: 0, bot: 0 }, tickCount: 0,
    events: { onSwing() {}, onHit() {}, onHurt() {}, onDeath() {}, onRespawn() {} },
    eyeOf, lookDir, inSprintCone, botStyle: C.defaultMode, tickEntity, pushEntities, hurt, tryAttack, aimCheck, botThink, generateWorld,
  };

  // Can `att` hit `tgt` along its aim ray? att.aimDir (unit vector, set by a screen tap) overrides the view-centre ray.
  function aimCheck(att, tgt) {
    if (!att.alive || !tgt.alive) return false;
    const o = eyeOf(att), d = att.aimDir || lookDir(att), e = CB.hitboxExpand, hw = PL.width / 2 + e;
    const t = rayBox(o, d, { x: tgt.x - hw, y: tgt.y - e, z: tgt.z - hw }, { x: tgt.x + hw, y: tgt.y + PL.height + e, z: tgt.z + hw });
    if (t === null || t > CB.reach) return false;
    return !(blockRayDist(o, d, t) < t);
  }

  function tryAttack(att, tgt) {
    if (!att.alive) return false;
    if (att.swing <= CB.swingTicks / 2) att.swing = CB.swingTicks;
    Sim.events.onSwing(att);
    const ok = aimCheck(att, tgt);
    att.aimDir = null;
    if (!ok) return false;
    let dmg = CB.fistDamage;
    const crit = att.fallDist > 0 && !att.onGround;
    if (crit) dmg *= CB.critMultiplier;
    const landed = hurt(tgt, dmg, att);
    if (landed) Sim.events.onHit(att, tgt, dmg, crit);
    return landed;
  }

  function hurt(tgt, amount, attacker) {
    if (!tgt.alive) return false;
    let knock = true;
    if (tgt.invul > CB.invulnTicks / 2) {
      if (amount <= tgt.lastDmg) return false;
      applyDamage(tgt, amount - tgt.lastDmg, attacker);
      tgt.lastDmg = amount; knock = false;
    } else {
      tgt.lastDmg = amount; tgt.invul = CB.invulnTicks;
      applyDamage(tgt, amount, attacker);
    }
    tgt.hurtTime = 10;
    if (attacker) tgt.lastAttacker = attacker;
    if (knock && attacker) knockback(tgt, attacker);
    Sim.events.onHurt(tgt, amount, attacker);
    return true;
  }
  function applyDamage(e, amt, attacker) {
    e.health -= amt;
    if (e.health <= 0) {
      e.health = 0; e.alive = false; e.deathTimer = CB.respawnTicks; e.deathTicks = 0;
      e.sprinting = false; e.input.f = e.input.s = 0; e.input.jump = false;
      const killer = attacker || e.lastAttacker;
      if (killer && killer !== e) Sim.score[killer === Sim.player ? 'player' : 'bot']++;
      Sim.events.onDeath(e, killer);
    }
  }
  function knockback(t, a) {
    let dx = a.x - t.x, dz = a.z - t.z;
    if (Math.hypot(dx, dz) < 1e-4) { dx = (Math.random() - 0.5) * 0.02; dz = (Math.random() - 0.5) * 0.02; }
    const len = Math.hypot(dx, dz);
    t.vx *= CB.kbMotionDamp; t.vy *= CB.kbMotionDamp; t.vz *= CB.kbMotionDamp;
    t.vx -= dx / len * CB.kbHorizontal; t.vz -= dz / len * CB.kbHorizontal;
    t.vy += CB.kbVertical; if (t.vy > CB.kbVertical) t.vy = CB.kbVertical;
    if (a.sprinting) {
      t.vx += -Math.sin(a.yaw) * CB.sprintKbExtra; t.vz += -Math.cos(a.yaw) * CB.sprintKbExtra;
      t.vy += CB.sprintKbVertical;
      a.vx *= CB.attackerSlowdown; a.vz *= CB.attackerSlowdown;
      a.sprinting = false; a.sprintCancel = true;
    }
  }

  // True when the move direction is straight enough ahead to sprint (walk otherwise).
  function inSprintCone(f, s) { return f > 0 && Math.atan2(Math.abs(s), f) <= P.sprintConeDeg * Math.PI / 180; }

  /* ---------------- bot brain ---------------- */
  // The bot "holds" the same kind of controls a player would in the chosen mode.
  function botMove(b, dist) {
    const br = b.brain, i = b.input, DEG = Math.PI / 180;
    if (Sim.botStyle === 'tdpad') {
      const T = BT.tdpad;
      if (--br.dirTimer <= 0) {
        br.dirTimer = randInt(T.holdMin, T.holdMax);
        const r = Math.random(), sd = Math.random() < 0.5 ? -1 : 1;
        br.dir = r < T.forward ? [1, 0] : r < T.forward + T.diagonal ? [1, sd] : r < T.forward + T.diagonal + T.side ? [0, sd] : [0, 0];
      }
      let [f, s] = br.dir;
      if (dist > BT.farStraightDist) { f = 1; s = 0; }
      if (dist < T.stopDist && f > 0) f = 0;
      if (dist < BT.backoffDistance) f = -1;
      i.f = f; i.s = s;
    } else {
      const T = BT.tpole;
      if (--br.dirTimer <= 0) {
        br.dirTimer = randInt(T.holdMin, T.holdMax);
        if (Math.random() < T.straightChance) br.headTarget = rand(-T.straightDeg, T.straightDeg);
        else { if (Math.random() < T.flipChance) br.side *= -1; br.headTarget = br.side * rand(T.sideMinDeg, T.sideMaxDeg); }
      }
      if (dist > BT.farStraightDist) br.headTarget = rand(-T.straightDeg, T.straightDeg) * 0.3;
      br.heading += (br.headTarget - br.heading) * T.turnLerp;
      let f = Math.cos(br.heading * DEG), s = Math.sin(br.heading * DEG);
      if (dist < BT.stopDistance) { f = 0; s = br.side * 0.9; }
      if (dist < BT.backoffDistance) f = -0.6;
      i.f = f; i.s = s;
    }
    b.wantSprint = br.sprintDelay <= 0 && dist > 1.6 && inSprintCone(i.f, i.s);
  }

  function botThink(b, p) {
    const i = b.input, br = b.brain;
    i.f = 0; i.s = 0; i.jump = false; b.wantSprint = false; b.sneaking = false;
    if (b.sprintCancel) { b.sprintCancel = false; br.sprintDelay = BT.resprintDelay; }
    if (!b.alive) return;
    if (br.sprintDelay > 0) br.sprintDelay--;
    if (!p.alive) return;

    const dx = p.x - b.x, dz = p.z - b.z, dist = Math.hypot(dx, dz);
    const eyeY = b.y + PL.eyeHeight, ty = p.y + 1.1;
    const wantYaw = Math.atan2(-dx, -dz), wantPitch = Math.atan2(ty - eyeY, Math.max(dist, 0.01));
    const maxT = BT.turnSpeedDeg * Math.PI / 180;
    b.yaw += clamp(wrapRad(wantYaw - b.yaw) * BT.aimLerp, -maxT, maxT) + (Math.random() - 0.5) * BT.aimJitterDeg * Math.PI / 180;
    b.pitch = clamp(b.pitch + clamp((wantPitch - b.pitch) * BT.aimLerp, -maxT, maxT), -1.5, 1.5);

    botMove(b, dist);
    if (b.hCollide && b.onGround) i.jump = true;
    if (dist < BT.jumpRange && Math.random() < BT.jumpChance) i.jump = true;

    if (br.atkCd > 0) br.atkCd--;
    else if (dist <= CB.reach + 0.4 && Math.abs(wrapRad(wantYaw - b.yaw)) < BT.aimToleranceRad) {
      tryAttack(b, p);
      br.atkCd = randInt(BT.attackMinTicks, BT.attackMaxTicks);
    }
  }

  /* ---------------- game flow ---------------- */
  function respawn(e) {
    let x, z, yaw;
    if (e === Sim.player) { ({ x, z, yaw } = SPAWN.player); }
    else {
      x = Sim.player.x + 20; z = Sim.player.z; yaw = Math.PI / 2;
      for (let k = 0; k < 30; k++) {
        const ang = rand(0, Math.PI * 2), r = rand(14, 24), tx = Sim.player.x + Math.cos(ang) * r, tz = Sim.player.z + Math.sin(ang) * r;
        if (surfaceY(tx, tz) <= 1) { x = tx; z = tz; yaw = rand(-Math.PI, Math.PI); break; }
      }
    }
    Object.assign(e, { x, z, yaw, y: surfaceY(x, z), vx: 0, vy: 0, vz: 0, pitch: 0, health: PL.maxHealth, alive: true,
      invul: 0, lastDmg: 0, hurtTime: 0, fallDist: 0, onGround: false, sprinting: false, swing: 0, regen: 0, lastAttacker: null, deathTicks: 0 });
    e.px = e.x; e.py = e.y; e.pz = e.z; e.pyaw = e.yaw; e.ppitch = e.pitch;
    Sim.events.onRespawn(e);
  }

  Sim.reset = function () {
    generateWorld();
    Sim.player = createEntity('You', SPAWN.player.x, SPAWN.player.z, SPAWN.player.yaw);
    Sim.bot = createEntity('Bot', SPAWN.bot.x, SPAWN.bot.z, SPAWN.bot.yaw);
    Sim.score.player = 0; Sim.score.bot = 0; Sim.tickCount = 0;
  };

  Sim.step = function () {
    const p = Sim.player, b = Sim.bot;
    Sim.tickCount++;
    if (p.wantAttack) { p.wantAttack = false; if (p.alive) tryAttack(p, b); }
    botThink(b, p);
    tickEntity(p); tickEntity(b);
    pushEntities(p, b);
    for (const e of [p, b]) if (!e.alive) { e.deathTicks++; if (--e.deathTimer <= 0) respawn(e); }
  };

  if (typeof window !== 'undefined') window.Sim = Sim; else module.exports = Sim;
})();
