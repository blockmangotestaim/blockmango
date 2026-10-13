/* =====================================================================
   FIST ARENA - config.js
   Every tunable number lives here. Units:
     - "per tick" values use Minecraft's 20 ticks/second
     - distances are in blocks
   Defaults are the vanilla Minecraft (Java 1.8 / PE-era) numbers.
   Give me your own values later and just overwrite them below.
   ===================================================================== */
const CONFIG = {
  tickRate: 20,
  defaultMode: 'tpole',          // 'tdpad' | 'tpole'

  player: {
    width: 0.6, height: 1.8,
    eyeHeight: 1.62, sneakEyeHeight: 1.27,
    maxHealth: 20,               // 20 = 10 hearts
  },

  physics: {
    gravity: 0.08,               // subtracted from vy every tick
    drag: 0.98,                  // vy *= drag every tick
    groundSlip: 0.6,             // block slipperiness (ground friction = slip * 0.91)
    airFriction: 0.91,
    walkSpeed: 0.1,              // movement attribute
    sprintMultiplier: 1.3,
    sneakMultiplier: 0.3,
    inputScale: 0.98,
    airControl: 0.02,
    sprintAirControl: 0.026,
    jumpVelocity: 0.42,
    jumpDelayTicks: 10,          // auto-jump delay when holding jump
    sprintJumpBoost: 0.2,
    sprintConeDeg: 12,           // moving within this angle of straight forward = sprint, anything wider = walk
    entityPush: 0.05,            // player <-> player body push
    fallSafeDistance: 3,         // damage = ceil(fall - this)
  },

  combat: {
    reach: 3.0,
    hitboxExpand: 0.1,           // target hitbox grows by this per side
    fistDamage: 1,               // 1 = half heart
    critMultiplier: 1.5,         // attacker falling & airborne
    invulnTicks: 20,             // after a hit, only damage > last hit lands in the first half
    kbHorizontal: 0.4,
    kbVertical: 0.4,             // vy is capped at this after knockback
    kbMotionDamp: 0.5,           // victim's old velocity is multiplied by this first
    sprintKbExtra: 0.5,          // extra horizontal kb if attacker is sprinting
    sprintKbVertical: 0.1,
    attackerSlowdown: 0.6,       // attacker's vx/vz multiplier after a sprint hit (also ends sprint)
    swingTicks: 6,
    resprintTicks: 5,            // after a sprint hit, sprint is locked out this many ticks (w-tap)
    regenTicks: 80,              // +1 HP every N ticks (full hunger bar)
    respawnTicks: 50,
  },

  bot: {
    turnSpeedDeg: 28,            // max aim turn per tick
    aimLerp: 0.4,
    aimJitterDeg: 1.5,
    attackMinTicks: 6,           // delay between swings (random in range)
    attackMaxTicks: 11,
    aimToleranceRad: 0.35,
    stopDistance: 1.3,
    backoffDistance: 0.9,
    sprintDistance: 3.5,
    strafeRange: 4.5,
    jumpRange: 3.5,
    jumpChance: 0.03,
    resprintDelay: 5,            // ticks before bot re-sprints after a sprint hit
    farStraightDist: 6,          // farther than this the bot runs straight at you (both styles)
    // bot plays like the control mode you picked:
    tdpad: { holdMin: 6, holdMax: 22, forward: 0.68, diagonal: 0.14, side: 0.1, stopDist: 1.0 },      // arrow-pad style: mostly straight forward = mostly sprinting
    tpole: { holdMin: 10, holdMax: 30, straightChance: 0.2, straightDeg: 8, sideMinDeg: 25, sideMaxDeg: 80, flipChance: 0.3, turnLerp: 0.25 }, // analog style: mostly angled = mostly walking
  },

  view: {
    fov: 70,
    sprintFovMul: 1.1,
    viewBob: true,
  },

  controls: {
    touchLookSens: 0.2,          // degrees per pixel at 100% (the Settings slider scales this)
    ringDiameterVh: 24.8,        // touch ring outer diameter, % of screen height (measured from the reference screenshot)
    mouseLookSens: 0.12,
    deadZone: 0.18,              // tpole
    poleAnalogSpeed: false,      // false = any push past the dead zone walks at full walking speed (direction only)
    doubleTapMs: 300,            // keyboard only: double-tap W to sprint
    sprintMinTilt: 0.5,          // tpole: push the pole at least this far (0-1) straight forward to sprint
    poleReach: 0.6,              // finger travel (fraction of pad radius) for full tilt
    dpadCenterRadius: 0.22,      // tdpad center zone (no movement)
    tapMaxMs: 250,
    tapMaxMove: 12,              // px
    holdAttackMs: 260,
    holdRepeatMs: 250,
  },
};
if (typeof module !== 'undefined') module.exports = CONFIG;
