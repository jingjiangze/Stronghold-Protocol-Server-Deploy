// server/sim/content/enemies/unclaimed.js — the display-only fallback for enemy skills no kit implements.
//
// A skill whose prefabKey no ability of the enemy's kit casts produces no ['cast', id, slot] event: the client plays no
// skill clip, no telegraph and no official skill effects for it (render/app.js 'cast' → UnitView.setSkillSlot,
// render/vfx/wiring.js enemyCast), so the whole ability is invisible — 110 prefabKeys of data/enemies.json at 0.4.3
// (20 pure visuals, 17 form switches, 73 with a gameplay line this mode leaves to the data). This module announces
// them: one display-only ability per unclaimed prefabKey that names the skill's slot (`castSlot`) and drops a
// `telegraph` ring on the enemy (render/fx/kinds.js, no new asset). Nothing else — no HP, no blocking, no status, no
// damage, no random draw, no state of the battle: the battle with these abilities is the battle without them, plus
// events (the rule castSlot already follows, DESIGN §8.2). They are ordinary entries of `ab.list` so that every path
// that ticks / dispatches abilities sees them; none of them implements a hook but `fire` / `before`.
//
// Which keys: `ab.sk[k]` exists and no ability of `ab.list` names it (`a.sk` — helpers.js castSlot, the archetypes'
// skill() / nthAttackStatus s argument). An attack-cycle skill (data `spCost` > 0, "攻击N次后…") announces on that
// attack, exactly the cadence the kits' own SP abilities use (archetypes.js nthAttackStatus), so a kit that announces
// it too speaks once: castSlot records the instant of every announced slot (`e.mem.castAt`) and the fallback stays
// quiet when the slot was announced in the same tick. Every other unclaimed key announces on a cooldown.
//
// STATS_ONLY keys get none (content/enemies.js: "deliberately left to their data stats" — a ring for a line this mode
// does not model would be a lie); onSpawnDisplay installs them for every other enemy. Silence stops an announcement
// (`sil: true`: a silenced enemy uses no skill, PRTS 异常效果 沉默), stun / 失衡 hold it like any skill (canCast).

import { abOf, attach, castSlot } from './helpers.js';

/** At most this many display abilities per enemy (a 12-skill record — 锏's two forms, 掠海漂移体 — must not flood). */
const MAX_DISPLAY = 8;

/** A cooldown below this is lifted to it: a 1 s skill's 1.2 s ring would overlap itself [ASSUMED, no data value]. */
const MIN_CD = 4;

/** A skill the data gives no working cooldown (`0` / negative: talent-, form- or death-driven) is announced this
 *  often, so the enemy shows something without inventing a 1-tick stream [ASSUMED]. */
const UNSCHEDULED_CD = 12;

/** FX_KINDS.telegraph's own default duration (render/fx/kinds.js); a skill whose blackboard has one uses that. */
const TELEGRAPH_DUR = 1.2, DUR_MIN = 0.6, DUR_MAX = 3;

/** The ring's radius in tiles: the caster's own tile — these lines have no data radius. */
const TELEGRAPH_R = 1;

/** The name families of the fx `kind` the ring carries ("按 key 名猜"; render/fx/kinds.js FX_GUESS reads them). */
const KIND_GUESS = [
  [/warning|alert|premoni|mark/i, 'warning'],
  [/effect|impact|boom|burst/i, 'effect'],
  [/anim|pose|show/i, 'anim'],
  [/start|begin|switch|change|awake|appear|takeoff|enter/i, 'start'],
];

/** The announcement schedule of one unclaimed key: the attack it lands on, or its cooldown in seconds. */
const planOf = (key, sk) => {
  const sp = Number(sk.sp) || 0;
  if (sp > 0) return { key, sk, attack: sp + 1 };        // "攻击 spCost 次后，下一次攻击" (nthOf, helpers.js)
  const cd = Number(sk.cd);
  if (!(cd > 0)) return { key, sk, cd: UNSCHEDULED_CD, icd: 0 };
  return { key, sk, cd: Math.max(cd, MIN_CD), icd: Math.min(Math.max(Number(sk.icd) || 0, 0), cd) };
};

/** The prefabKeys the enemy's own abilities announce (`a.sk` is the ab.sk entry an ability casts); a display ability of
 *  this module does not claim its own skill (it announces it, the kit does not). */
export function claimedSlots(ab) {
  const out = new Set();
  if (!ab || !ab.sk || !Array.isArray(ab.list)) return out;
  const bySkill = new Map();
  for (const k of Object.keys(ab.sk)) bySkill.set(ab.sk[k], k);
  for (const a of ab.list) {
    if (!a || a.display) continue;
    const k = a.sk && bySkill.get(a.sk);
    if (k != null) out.add(k);
  }
  return out;
}

/**
 * The unclaimed keys to announce, in data order, at most `limit` (MAX_DISPLAY unless asked otherwise): `{ key, sk,
 * attack }` (an SP skill: the attack it lands on) or `{ key, sk, cd, icd }` (a cooldown skill, seconds). Exported for
 * test/content/enemies_bosses.test.js, whose prefabKey gate asks for the whole plan (`limit` = Infinity: a 10-skill
 * record is trimmed at install, and the gate names the trimmed tail instead of hiding it).
 */
export function displayPlan(ab, limit = MAX_DISPLAY) {
  if (!ab || !ab.sk) return [];
  const claimed = claimedSlots(ab);
  const out = [];
  for (const key of Object.keys(ab.sk)) {
    const sk = ab.sk[key];
    if (!sk || !Number.isInteger(sk.slot) || claimed.has(key)) continue;
    out.push(planOf(key, sk));
    if (out.length >= limit) break;
  }
  return out;
}

/** The announcement itself: a telegraph ring on the enemy's tile, sized by the skill's own duration. */
function ring(b, e, sk, key) {
  const bb = Number(sk.bb && sk.bb.duration);
  const dur = Math.min(DUR_MAX, Math.max(DUR_MIN, bb > 0 ? bb : TELEGRAPH_DUR));
  const g = KIND_GUESS.find(([re]) => re.test(key));
  b.fx('telegraph', { id: e.id, x: e.x, y: e.y, r: TELEGRAPH_R, dur, ...(g ? { kind: g[1] } : {}) });
}

/** One display-only ability: names the skill's slot and drops its telegraph, nothing else. */
function announce({ key, sk, attack, cd, icd }) {
  const a = { id: `display:${key}`, display: true, sil: true, sk };
  if (attack) {
    a.n = 0;
    // the attack that the skill's line describes ("攻击N次后，下一次攻击"): the cast and its ring are ours (the ability has
    // no cooldown, so onTick casts nothing for it); a kit ability announcing the same slot in this tick keeps its one cast
    a.before = (c, b, e, self) => {
      if (++self.n % attack) return;
      const at = e.mem && e.mem.castAt && e.mem.castAt[sk.slot];
      if (at === b.time) return;
      castSlot(b, e, sk);
      ring(b, e, sk, key);
    };
  } else {
    // a cooldown skill: onTick emits the skill's `cast` for an ability with `sk` (content/enemies.js), so its fire only
    // adds the ring
    a.cd = cd; a.icd = icd;
    a.fire = (b, e) => ring(b, e, sk, key);
  }
  return a;
}

/**
 * Attach the display fallback to a spawned enemy (content/enemies.js onSpawnDisplay, after every kit installer has
 * attached its own abilities). `ab` is the kit's ability record, or null for an enemy without a kit — one is created
 * only when the enemy has a skills record.
 */
export function installUnclaimed(b, e, ab = null) {
  if (!e || !e.def) return ab;
  const ov = b.enemyOverrides && b.enemyOverrides[e.defId];
  const skills = (ov && Array.isArray(ov.skills) && ov.skills) || (Array.isArray(e.def.skills) && e.def.skills);
  if (!Array.isArray(skills) || !skills.length) return ab;
  const rec = ab || abOf(b, e);
  if (Array.isArray(rec.list) && rec.list.some((a) => a && a.display)) return rec;   // once per spawn
  const plan = displayPlan(rec);
  if (plan.length) attach(b, e, plan.map(announce));
  return rec;
}
