// render/style.js — palette and visual tunables of the battlefield renderer (pure data).
// Colours follow research 07 §7 (tile palette, tuned by eye) and the UI design system (theme.css).

export const TILE_H = Object.freeze({
  wall: 0.42,      // 'h' high ground
  forbid: 0.3,     // '#' forbidden block (data: HIGH)
  sep: 0.55,       // 'X' hard separator wall (rows 6 / 13)
  bench: 0.16,     // 'a' / 'A' hand & temp slots (data: HIGH)
  platform: 0.465, // active 射击台: the top of the official model (trap_1106_achplat, 46.5 cm; round 40)
  mound: 0.26,     // active mound devices
});

/** Stage glyph → material + height class (data/stages.json legend, DATA.md §12). */
export const GLYPH = Object.freeze({
  '#': { mat: 'forbid', h: 'forbid' },
  X: { mat: 'sep', h: 'sep' },
  r: { mat: 'road', h: null },
  R: { mat: 'roadN', h: null },
  f: { mat: 'floor', h: null },
  p: { mat: 'preview', h: null },
  h: { mat: 'wall', h: 'wall' },
  b: { mat: 'fence', h: null },
  a: { mat: 'hand', h: 'bench' },
  A: { mat: 'temp', h: 'bench' },
  S: { mat: 'start', h: null },
  E: { mat: 'end', h: null },
  I: { mat: 'telin', h: null },
  O: { mat: 'telout', h: null },
  m: { mat: 'mire', h: null },
  g: { mat: 'smog', h: null },
  d: { mat: 'deepsea', h: null },
  i: { mat: 'infection', h: null },
});

/**
 * tileKey (the stage legend's own tile id) → glyph, used by tiles.js `parseStage` and board3d/layout.js
 * `classifyStage` to pick the material of a legend entry.
 *
 * Every tileKey of data/stages.json must appear here: an unmapped one falls back on the tile's height
 * (`HIGH` → '#' forbid, else 'R' roadN), which paints lava / poison / teleport ground as a raised block or a
 * striped road. The 2026-11-04 rogue set added 23 keys; each is mapped to the existing material whose
 * height/buildable/passable combination matches the tile's own legend entry (data/stages.json `tiles{}`), so the
 * renderer needs no new material.
 *
 * Resolution order (tiles.js / board3d/layout.js, must stay identical in the two boards):
 *   1. `'<tileKey>:<HEIGHT>'` first — a key of the same tile can need another material per height (tile_empty /
 *      tile_defup are LOW ground as 'r' but a HIGH RANGED-only plate as 'h'),
 *   2. then the bare tileKey,
 *   3. and the table wins over the legend letter itself, because the rogue set reuses the letters 'a' / 'b' / 'd' /
 *      'g' for volcano, poison, fly-start and dugmny ground — the letter's own material would hide the tile.
 *      `GLYPH_PINNED` lists the letters exempt from (3).
 */
export const TILEKEY_GLYPH = Object.freeze({
  tile_forbidden: '#', tile_road: 'r', tile_floor: 'f', tile_wall: 'h', tile_fence_bound: 'b', tile_fence: 'b',
  tile_achand: 'a', tile_start: 'S', tile_end: 'E', tile_telin: 'I', tile_telout: 'O', tile_mire: 'm',
  tile_smog: 'g', tile_deepsea: 'd', tile_infection: 'i', tile_grass: 'r',
  // 2026-11-03：官方肉鸽的坑洞是「低洼、不可站、可飞越」，此前映射到 '#'（抬升 0.3 的禁区块）画出来像一堵墙
  tile_hole: 'd',
  // ---- 肉鸽地形（2026-11-04 全量肉鸽图）-------------------------------------------------------------
  // 地面路（LOW + groundPassable + buildable MELEE/ALL）：与 tile_road 同属性，用 'r'（普通低平地面），
  // 不用 'R'（roadN 是条纹路）也不给 '#'（会抬升 0.3 并被当成禁区）
  tile_toxicroad: 'r', tile_yinyang_road: 'r', tile_defbreak: 'r', tile_pollution_road: 'r', tile_creep: 'r',
  tile_dygmny_1: 'r', tile_defup: 'r', tile_empty: 'r',
  // 高度变体：同一 tileKey 的 LOW 格是地面、HIGH 格是抬升台（data: tile_empty / tile_defup 的 HIGH 是
  // FLY_ONLY + buildable NONE/RANGED + groundPassable=false，与 tile_wall 同属性）。查找先试 `tileKey:HEIGHT`，
  // 没有变体键再回落 tileKey，所以 LOW 仍走上面的 'r'
  'tile_empty:HIGH': 'h', 'tile_defup:HIGH': 'h',
  // tile_volcano：LOW / MELEE / passable ALL —— 可走可部署，所以是地面而不是 forbid；'#' 会抬升 0.3 并让它
  // 在渲染网格里变成不可部署的禁区块（playable=false），与数据相反
  tile_volcano: 'r',
  // 地面但不可部署（LOW + buildable NONE + groundPassable）：与 tile_floor 同属性，用 'f'
  tile_dygmny_2: 'f', tile_creepf: 'f', tile_healing: 'f',
  // tile_pollution_roadf 的数据是 LOW + buildable NONE，和上一组同属性；按指定归入路面 'r'
  tile_pollution_roadf: 'r',
  // 腐蚀 / 剧毒地面：mire 是既有材质里唯一的「损伤性地表」（tiles.js 给它画冒泡动画），比 forbid/road 更贴
  tile_toxic: 'm', tile_corrosion: 'm',
  // 高台（HIGH + FLY_ONLY + buildable RANGED）：与 tile_wall 完全同属性，用 'h'
  tile_toxicwall: 'h', tile_yinyang_wall: 'h', tile_dygmny_3: 'h', tile_pollution_wall: 'h', tile_gazebo: 'h',
  // 传送 / 飞行起点：用 start 的材质（'S' 不抬升，飞越格没有地面单位站立，不需要 HIGH 的台面）
  tile_flystart: 'S', tile_ftstart: 'S',
  // tile_bigforce 按指定归入 forbid
  tile_bigforce: '#',
});

/**
 * Legend letters that keep their own `GLYPH` material even when the legend entry points at another tileKey.
 *
 * `TILEKEY_GLYPH` normally wins over the letter (a rogue stage writes volcano / poison / fly-start ground with the
 * letters 'a' / 'b' / 'd' / 'g'), but these four have rendering meaning beyond the material — the board draws them
 * specially, so repainting them would drop that:
 *   X  separator wall: non-playable (playable / content = false), REST AREA / EVACUATION side panels
 *   p  enemy preview pen: glass hatch sent to its own bucket (penGlass / `glass` in board3d)
 *   A  temp bench slot: bench pad + railing (`padEquip`), excluded from device zones
 *   R  hazard-striped road: the `concreteStripe` surface, not plain road
 * Read-only by convention: nothing mutates it (`Object.freeze` does not lock a Set's contents).
 */
export const GLYPH_PINNED = Object.freeze(new Set(['X', 'p', 'A', 'R']));

export const COLORS = Object.freeze({
  bgTop: '#0b0f0e',
  bgMid: '#131a18',
  bgBottom: '#07090a',
  fog: [0.62, 0.68, 0.72],
  mint: 0x4ed8af,
  mintHi: 0x59f4ca,
  gold: 0xffc600,
  gateRed: 0xff3b30,
  gateRedDeep: 0xd0453b,
  objBlue: 0x39a7ff,
  objBlueDeep: 0x2d7fd6,
  legal: 0x3ce08c,
  illegal: 0xff4040,
  range: 0xff9c33,
  rangeStand: 0x4ed8af,
  hpAlly: 0x5fe07a,
  hpAllyLow: 0xe8c547,
  hpEnemy: 0xff4b3e,
  hpBoss: 0xff2d55,
  hpGhost: 0xfff0c8,
  hpBack: 0x0c0f0e,
  // the red bar of a negative-HP pool (斩业星熊's 我执, b.snap `neg`) — the same red as an enemy's HP
  hpNeg: 0xff4b3e,
  sp: 0x6fd3ff,
  spReady: 0xffe066,
  spActive: 0xffb347,
  // the ammo bar's yellow cells (b.snap `ammo`) and 伺夜's 狼影 pips (b.snap `wolves`)
  ammo: 0xffd04a,
  wolf: 0xe8f0ff,
  // 秘术师's stored attack energies (b.snap `energy`): a violet no other HUD state uses — the purse's gold coin and its
  // count are told apart from the orb and its count at a glance
  energy: 0xb07dff,
  shield: 0xdfe8ff,
});

/** Chess tier accents (theme.css --tier-1…6) and rarity-ish frames for enemies. */
export const TIER_COLORS = Object.freeze([0x9aa5a0, 0x9aa5a0, 0x7fd37a, 0x52b6ff, 0xb98cff, 0xffc600, 0xff6b3d]);
export const ENEMY_FRAME = Object.freeze({ normal: 0xc84a3c, elite: 0xff7a33, boss: 0xff2d55 });

/**
 * 活性源石 (infection) — the ONE palette of that tile, shared by the two boards (GitHub #184: the 2D atlas cell and the
 * 3D shader used to be two different materials — a beveled brick with crystal clusters against a world-space crust).
 * The values are the 3D board's own working colours (`render/board3d/materials.js` writes them into its shaders, which
 * end in `#include <colorspace_fragment>`, i.e. they are LINEAR); `textures.js` converts them for its canvas with
 * `linearToHex`, so both renderers show the same colour.
 *   base — the crust's dark side, crust — its lit side, vein — the glowing veins, spec — the bright crystal grains.
 */
export const ORIGINIUM = Object.freeze({
  base: Object.freeze([0.16, 0.05, 0.05]),
  crust: Object.freeze([0.3, 0.1, 0.07]),
  vein: Object.freeze([1.0, 0.46, 0.18]),
  spec: Object.freeze([1.0, 0.78, 0.52]),
  glow: 0xff6a3d,        // the additive pulse the 2D board tints per tile
});

/**
 * One channel of a working (linear) colour as the 0–255 sRGB value a canvas stores — the shaders' `#include
 * <colorspace_fragment>` does this for the 3D board, the canvas has to do it itself.
 */
export function linearToSrgb255(v) {
  const k = Number(v);
  const s = k <= 0.0031308 ? k * 12.92 : 1.055 * Math.pow(Math.max(0, k), 1 / 2.4) - 0.055;
  return Math.max(0, Math.min(255, Math.round(s * 255)));
}

/** A working (linear) `ORIGINIUM` colour as the `#rrggbb` sRGB string of the canvas (`textures.js originiumCanvas`). */
export function linearToHex(rgb) {
  return `#${rgb.map((v) => linearToSrgb255(v).toString(16).padStart(2, '0')).join('')}`;
}

export const DMG_STYLE = Object.freeze({
  phys: { font: 'sp-dmg-phys', fill: ['#fffbe8', '#ffb35c'], stroke: '#3b1400' },
  arts: { font: 'sp-dmg-arts', fill: ['#fbe8ff', '#c77dff'], stroke: '#2a0b45' },
  true: { font: 'sp-dmg-true', fill: ['#ffffff', '#e8e8e8'], stroke: '#2a2a2a' },
  heal: { font: 'sp-dmg-heal', fill: ['#eafff0', '#62f08a'], stroke: '#07361a' },
  elem: { font: 'sp-dmg-elem', fill: ['#fff4e0', '#ff7b3a'], stroke: '#3a1000' },
  // Official red integer and yellow MISS (PRTS 作战机制 「伤害红字（暴击）」, MISS #ff9000). Default numbers never use these.
  crit: { font: 'sp-dmg-crit', fill: ['#ffd0d0', '#ff2a2a'], stroke: '#4a0000' },
  miss: { font: 'sp-dmg-miss', fill: ['#ffe0a8', '#ff9000'], stroke: '#4a2400' },
});

/** Map b.ev dmg types to a style key. */
export function dmgStyleKey(type) {
  if (type === 'phys' || type === 'arts' || type === 'true' || type === 'heal') return type;
  if (type === 'burn' || type === 'neural' || type === 'necrosis' || type === 'apoptosis' || type === 'erosion' || type === 'element') return 'elem';
  return 'phys';
}

/** Hit spark colour per damage type. */
export const HIT_TINT = Object.freeze({ phys: 0xffd9a0, arts: 0xc77dff, true: 0xffffff, heal: 0x62f08a, elem: 0xff7b3a });

/**
 * Projectile visuals per b.ev 'atk' projKind (sim: none | arrow | bolt | bomb | lob | orb | drone | enemy | boomerang | droneBomb;
 * chain / chainHeal / beam are beams). Drawn by render/fx.js:
 *   look   tracer (bullet streak + muzzle flash) | orb (glowing ball, particle trail) | shell (lobbed on an arc with a
 *          ground shadow, smoke trail) | dart (small fast bolt) | boomerang (spins to the target and back to the thrower)
 *   speed  tiles per game second — a copy of the sim's PROJECTILE_SPEEDS (server/sim/constants.js; `back` of the
 *          boomerang = BOOMERANG_RETURN_SPEED, PRTS 跃跃: out 15, back 3.75). fx.js prefers the sim's own values, loaded
 *          from /sim/constants.js, so the visual flight ends with the sim's hit; this copy stands in until then (and in
 *          Node). test/render/fxproj.test.js keeps the two equal.
 *   sizes  in tiles (× the camera's px per tile at the shot): `len` trail length, `width` trail thickness, `head` glow
 *          diameter; `arc` peak height of a lob over a 3-tile throw (scales with the range)
 *   colours `tint` hot core, `glow` halo, `trail` trail particles, `muzzle` flash at the shooter
 *   hit    arrival burst (fx.js _impact): spark | arts | heal | boom | splash | zap | enemy
 *   once   a one-off cast, not an attack rhythm: the shooter's attack clip plays once at its own speed (render/spine.js
 *          SpineActor.attack / windUp) — 暴鸰's bomb drop
 */
export const PROJ = Object.freeze({
  arrow: { look: 'tracer', speed: 14, tint: 0xfff6dc, glow: 0xffc45a, len: 1.05, width: 0.2, head: 0.36, muzzle: 0xffd27a, hit: 'spark' },
  bolt: { look: 'orb', speed: 11, tint: 0xf4e2ff, glow: 0xb36bff, len: 0.6, width: 0.34, head: 0.52, trail: 0xa35cff, muzzle: 0xc77dff, hit: 'arts' },
  orb: { look: 'orb', speed: 10, tint: 0xeafff0, glow: 0x3fe07a, len: 0.55, width: 0.3, head: 0.48, trail: 0x62f08a, muzzle: 0x62f08a, hit: 'heal' },
  bomb: { look: 'shell', speed: 8, tint: 0xffeed0, glow: 0xff8a3d, len: 0.85, width: 0.3, head: 0.56, trail: 0xff9c4a, arc: 1.1, smoke: 0x2e2824, muzzle: 0xffb35c, hit: 'boom' },
  lob: { look: 'shell', speed: 8, tint: 0xfff4dc, glow: 0xffb04a, len: 0.7, width: 0.26, head: 0.5, trail: 0xffc27a, arc: 1.4, smoke: 0x3a322c, muzzle: 0xffc27a, hit: 'splash' },
  drone: { look: 'dart', speed: 16, tint: 0xe4fbff, glow: 0x57c9ff, len: 0.7, width: 0.16, head: 0.3, trail: 0x57c9ff, hit: 'zap' },
  enemy: { look: 'orb', speed: 10, tint: 0xffe2da, glow: 0xff3b30, len: 0.55, width: 0.28, head: 0.44, trail: 0xff4a3a, muzzle: 0xff6a5a, hit: 'enemy' },
  boomerang: { look: 'boomerang', speed: 15, back: 3.75, tint: 0xfff4d6, glow: 0x9ff0dc, len: 0.4, width: 0.3, head: 0.5, trail: 0x9ff0dc, hit: 'spark' },
  // 暴鸰's bomb (sim content/enemies/fly.js kitBombd; official projectile_bombd, speed 5): dropped from the drone, it falls
  // onto its target with a low arc and bursts where the sim's 'explode' blast goes off
  droneBomb: { look: 'shell', speed: 5, once: true, tint: 0xffe2c8, glow: 0xff5a3a, len: 0.6, width: 0.3, head: 0.5, trail: 0xff7a4a, arc: 0.35, smoke: 0x2e2824, hit: 'boom' },
});

/** Status keys (b.ev 'status' + UF flags) → icon atlas key (render/textures.js) and colour. */
export const STATUS_ICON = Object.freeze({
  stun: 'stun', freeze: 'freeze', cold: 'cold', stealth: 'stealth', shield: 'shield', fragile: 'fragile',
  artsFragile: 'fragile', physFragile: 'fragile', elemFragile: 'fragile', sleep: 'sleep', invulnerable: 'invuln',
  silence: 'silence', slow: 'slow', sluggish: 'slow', bind: 'bind', groundbind: 'bind', fear: 'fear', tremble: 'fear', weaken: 'weaken',
  levitate: 'levitate', taunt: 'taunt', defDown: 'weaken', resDown: 'weaken', aspdDown: 'slow', disarm: 'silence',
  burn: 'burn', burnBurst: 'burn', neural: 'neural', neuralBurst: 'neural', necrosis: 'necrosis', apoptosis: 'necrosis',
  // a 傀儡师 fighting as its <替身> (sim professions.js buff 'trait:substitute', the 20 s form)
  substitute: 'doll',
  // 禁疗 (sim status 'healFree': 史尔特尔's 余烬 — no heal reaches her until she leaves)
  healFree: 'healFree',
  // 折射 (sim buff 'ab:refraction', visible while the RES bonus is on). The tail of 'ab:refraction' hits this key.
  refraction: 'refraction',
});

/** Keyword fallbacks for namespaced / content status keys ('ab:frost', 'reed2:scorch', 'skill:shotst_shred' …). */
const STATUS_GUESS = [
  [/frost|chill|cold/i, 'cold'], [/freez/i, 'freeze'], [/scorch|burn|ignit|flame/i, 'burn'], [/stun|daze/i, 'stun'],
  [/sleep|slumber/i, 'sleep'], [/silenc/i, 'silence'], [/slow|slugg|bind|root|snare/i, 'slow'], [/fear|trembl/i, 'fear'],
  [/fragil|shred|expos|wanted|vulner|mark/i, 'fragile'], [/weak|down$/i, 'weaken'], [/shield|resist|guard|ward|barrier/i, 'shield'],
  [/invul|immun/i, 'invuln'], [/stealth|camou|invis/i, 'stealth'], [/levit|float/i, 'levitate'], [/taunt/i, 'taunt'],
  [/neural/i, 'neural'], [/necro|apopt|erosion/i, 'necrosis'],
];

/**
 * The 折射 icon is not drawn while the unit is silenced: the RES bonus is already off (sim content/enemies/archetypes.js refraction)
 * and the status must not keep looking active. Other icons stay.
 * @param {string} key a b.ev status key
 * @param {Set<string>|string[]|null} statuses
 */
export function statusIconSuppressed(key, statuses) {
  if (key !== 'ab:refraction' && key !== 'refraction') return false;
  if (!statuses) return false;
  return typeof statuses.has === 'function' ? statuses.has('silence') : Array.isArray(statuses) && statuses.includes('silence');
}

/** Icon key (textures STATUS_KEYS) for a b.ev status key or flag name; null when it has no icon. */
export function statusIconKey(key) {
  if (typeof key !== 'string' || !key) return null;
  if (STATUS_ICON[key]) return STATUS_ICON[key];
  const tail = key.includes(':') ? key.slice(key.lastIndexOf(':') + 1) : key;
  if (STATUS_ICON[tail]) return STATUS_ICON[tail];
  for (const [re, icon] of STATUS_GUESS) if (re.test(tail)) return icon;
  return null;
}

export const UNIT = Object.freeze({
  /** Spine skeleton units → world tiles (skeletons are ~360–450 units tall ⇒ ~1.2 tiles). */
  modelScale: 1 / 320,
  /** Fallback diamond size in tiles. */
  diamond: 0.78,
  headroom: 1.18, // tiles above the feet where bars sit (operators; enemies use their bounds)
  barWidth: 0.64,
  bossBarWidth: 2.2,
});
