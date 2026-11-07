import { webWireShape } from './arkWebTraits20261101.js';
import { validRoomMusicCommand } from './roomMusic.js';
import {validCricket} from './cricket.js';
import { validNamecard } from './namecard.js';
import {validRandomEvents} from './roundEvents.js';
// Normative message catalogue (DESIGN §8). Used by server (validation) and client (building requests).
// Every client→server message is `{ t, rid?, ...fields }`. Unknown `t` or invalid fields ⇒ ERR.BAD_MSG.

import { DIFFICULTIES, DIFFICULTY_TIERS, TRAINING_DIFFICULTY, NAME_MAX_LEN, ROOM_CODE_LEN, MAX_SEATS, ROOM_CAPACITIES, MAX_DRAFT_CARDS, EMOTES, GEO, CHAT_MAX_LEN, ROOM_DESC_MAX } from './constants.js';
import { isDroppableChess } from './standIn.js';
import { diySlot, diySlotIds, validateDiyPicks } from './diy.js';
import { cultivatedStats, isPotential, isCultivate, POTENTIAL_DEFAULT, CULTIVATE_DEFAULT, hasPotentialData } from './potential.js';
import { isContentHash } from './plugins/identity.js';
import { isPluginId } from './plugins/manifest.js';
import { CONTRACTS } from './contracts.js';
import { isTestCommand } from './testMode.js';
import { PLUGIN_OFFER_SLOTS } from './plugins/limits.js';
// 肉鸽「地图主题池」 (room.create { mapPool }, 2026-11-06): 'all' | 'ro1'…'ro6' —— 与插件顶替拷贝同口径。
import { isPool } from './rogueThemes.js';

// ---- tiny validators -------------------------------------------------------
const isInt = (v, lo = -Infinity, hi = Infinity) => Number.isInteger(v) && v >= lo && v <= hi;
const isStr = (v, max = 64) => typeof v === 'string' && v.length <= max;
const isBool = (v) => typeof v === 'boolean';
const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_\-.:]+$/.test(v);
/** { id: count }:称号次数 / 常选计数。宽度和数值都封顶,避免一个恶意 payload 撑爆内存。 */
const isCounts = (v) => {
  if (v == null || typeof v !== 'object' || Array.isArray(v)) return false;
  const keys = Object.keys(v);
  if (keys.length > 64) return false;
  return keys.every((k) => k.length <= 40 && Number.isInteger(v[k]) && v[k] >= 0 && v[k] <= 1e6);
};
/** 战绩三格:模拟总数 / 成功卫戍 / 绝境突破。 */
const isTally = (v) => v == null || (typeof v === 'object' && !Array.isArray(v)
  && ['matches', 'wins', 'hardWins'].every((k) => v[k] == null || (Number.isInteger(v[k]) && v[k] >= 0 && v[k] <= 1e6)));
const isUid = (v) => isInt(v, 1, 2 ** 31);
const isNum = (v, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isPlain = (v) => !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
const optional = (check) => (v) => v === undefined || check(v);
const nullable = (check) => (v) => v === null || v === undefined || check(v);
/** A plain object with at most `max` own keys, every key passing `key` and every value passing `val`. */
const isMap = (v, max, key, val) => {
  if (!isPlain(v)) return false;
  const keys = Object.keys(v);
  if (keys.length > max) return false;
  for (const k of keys) if (!key(k) || !val(v[k])) return false;
  return true;
};
const isList = (v, max, item) => Array.isArray(v) && v.length <= max && v.every(item);
const isScalar = (v) => isStr(v, 64) || isNum(v) || isBool(v);

// ---- client-side combat (DESIGN §14): b.progress / b.result payloads -------------------------------------------

/** Size limits of a b.result payload (the whole frame also obeys the 64 KB inbound limit). */
/**
 * Size limits of a battle-result payload.
 *
 * `players` stays 4 because it caps the per-source maps of ONE battle (a field holds a unite group, never the whole
 * room); `sources` is the room-wide count of contributing ids a result may name, which is what grew with capacity.
 */
export const RESULT_LIMITS = Object.freeze({ players: 4, sources: MAX_SEATS, leaked: 400, unitsEnd: 64, unitStats: 160, layerGains: 40, mods: 16, unspawned: 400 });
const BIG = 1e13;
const isStat = (v) => v === undefined || isNum(v, 0, BIG);
const isModVal = (v) => v === null || isNum(v, -BIG, BIG) || isStr(v, 64) || isBool(v);
const isLeak = (l) => isPlain(l) && isId(l.enemyKey)
  && (l.mods === undefined || l.mods === null || isMap(l.mods, RESULT_LIMITS.mods, (k) => isStr(k, 32), isModVal))
  && optional((v) => isNum(v, 0, 1000))(l.lpr) && nullable(isId)(l.sourcePlayerId) && nullable((v) => isStr(v, 16))(l.tag)
  && optional(isBool)(l.counted) && optional(isBool)(l.boss) && optional(isBool)(l.spawned) && optional(isBool)(l.uniteRuntime);
const isUnitEnd = (u) => isPlain(u) && nullable(isUid)(u.uid) && isNum(u.hpPct, 0, 1) && isNum(u.sp, 0, 1e5) && isBool(u.alive)
  && optional(isBool)(u.skillActive) && nullable(isId)(u.defId);
const isUnitStat = (u) => isPlain(u) && nullable(isUid)(u.uid) && nullable(isId)(u.defId) && optional((v) => isStr(v, 16))(u.kind)
  && isStat(u.dmg) && isStat(u.kills) && isStat(u.heal) && isStat(u.taken) && isStat(u.attacks);
const isPerPlayer = (p) => isPlain(p) && isInt(p.killed, 0, 1e5) && isInt(p.total, 0, 1e5)
  // `resolved` = the HUD capsule's numerator of this player's own field (the round's own scheduled enemies knocked out
  // or leaked: server/sim/battle/deploy.js killedInTotal / leakedInTotal, Battle.resolved). `killed` counts every counted
  // knock-out — a runtime split child / summon too — and may therefore exceed `total`, which counts only the round's own
  // scheduled enemies (server/match/fields.js validateClientResult bounds it against maxTotal instead).
  && optional((x) => isInt(x, 0, 1e5))(p.resolved)
  && optional((x) => isInt(x, 0, 1e9))(p.creditedKills)
  && isList(p.leaked, RESULT_LIMITS.leaked, isLeak) && isBool(p.perfect)
  && isMap(p.layerGains, RESULT_LIMITS.layerGains, isId, (v) => isNum(v, -1e4, 1e4))
  && isStat(p.coins) && isStat(p.damageDealt) && isStat(p.bossDamage) && isStat(p.healingDone) && isStat(p.deaths)
  && optional(webWireShape)(p.webTraits)
  && isList(p.unitsEnd, RESULT_LIMITS.unitsEnd, isUnitEnd)
  && (p.unitStats === undefined || isList(p.unitStats, RESULT_LIMITS.unitStats, isUnitStat));
const isUnspawned = (u) => isPlain(u) && isId(u.enemyKey) && nullable(isId)(u.sourcePlayerId) && nullable((v) => isStr(v, 16))(u.tag)
  && optional((v) => isNum(v, 0, 1e6))(u.time);

/**
 * Structural check of a client BattleResult (DESIGN §5.1 / §14 `b.result`): types, ranges and size limits only —
 * the semantic checks against the battle's spec are the server's (server/match/fields.js validateClientResult).
 */
export function isBattleResult(v) {
  return isPlain(v) && ['cleared', 'timeout', 'forced'].includes(v.reason) && isNum(v.time, 0, 1e5)
    && optional((x) => isInt(x, 0, 1e5))(v.killed) && optional((x) => isInt(x, 0, 1e5))(v.total)
    && optional((x) => isInt(x, 0, 1e5))(v.resolved)
    && isMap(v.perPlayer, RESULT_LIMITS.players, isId, isPerPlayer) && Object.keys(v.perPlayer).length > 0
    && (v.unspawned === undefined || isList(v.unspawned, RESULT_LIMITS.unspawned, isUnspawned))
    && optional((x) => isInt(x, 0, 1e9))(v.errors) && optional((x) => isNum(x, 0, BIG))(v.bossHpLeft);
}



// ---- operator loadout (DESIGN §16): room.loadout { entries } -------------------------------------------------

/**
 * `room.loadout { entries, ops? }`: `entries` = `{ [baseChessId]: { skill?: skillIndex, module?: uniEquipId | 'none' } }`
 * (the per-browser loadout of the 干员调配 screen); `ops` (0.2.2) = `{ [charId]: { potential?: 1–6, cultivate?: 0–3 } }`,
 * the player's per-operator 潜能 and 练度 (shared/potential.js; absent / missing = 潜能 6, 精英2 Lv.60 — the owner's
 * decision of 2026-10-08). Structural limits below; the semantic checks against the game data — known visible chess,
 * legal skill index for the normal AND the elite status, legal module of the elite (`checkLoadout`); an operator of the
 * 干员调配 roster or the 自选 owned pool (`checkLoadoutOps`) — are used by the server (lobby, match) and by the client to
 * sanitise a stored loadout before sending.
 */
export const LOADOUT_LIMITS = Object.freeze({ entries: 160, skillIndex: 9, ops: 256 });
/** The "no module" choice of an elite (模组: 不装备). */
export const MODULE_NONE = 'none';
const isLoadoutEntry = (e) => isPlain(e) && Object.keys(e).length > 0 && Object.keys(e).every((k) => k === 'skill' || k === 'module')
  && optional((v) => isInt(v, 0, LOADOUT_LIMITS.skillIndex))(e.skill) && optional(isId)(e.module);
/** Structural check of `room.loadout.entries`. */
export const isLoadoutEntries = (v) => isMap(v, LOADOUT_LIMITS.entries, isId, isLoadoutEntry);

/** One `room.loadout.ops` entry: `{ potential?: 1–6, cultivate?: 0–3 }`, at least one of them. */

/** Structural check of `room.loadout.ops` (0.2.2): a map of ≤ 256 charIds → `{ potential?, cultivate? }`. */


/**
 * The operators a player sets a potential / 练度 for (0.2.2): the charIds of the 干员调配 roster — the visible normal chess
 * (checkLoadout's targets; a hidden chess shares its visible twin's charId: 锡人, 耶拉 …) — and the owned 6★ 自选 picks
 * (data/backups.json `diy.ownedPool`). A PRESET (特许) operator the player does not own is set by hand (潜能 1, 未精英化:
 * the official 「未持有的特许按1潜」 and +0 %); a 补位 stand-in or a prototype pick takes neither.
 * @param {Record<string, any>|null|undefined} chess data/chess.json
 * @param {any} [backups] data/backups.json
 * @returns {Set<string>}
 */


/**
 * Semantic check + normalisation of `room.loadout.ops` (0.2.2) — strict like checkLoadout: an operator `isOperator` does
 * not know (cultivationCharIds) rejects the whole message. Entries equal to the defaults (潜能 6, 练度 3) are dropped, the
 * rest stored complete `{ potential, cultivate }`. `undefined` / `null` = no settings (`{}`).
 * @param {any} ops
 * @param {(charId: string) => boolean} isOperator
 * @returns {{ ok: true, ops: Record<string, { potential: number, cultivate: number }> } | { error: 'BAD_MSG'|'BAD_TARGET', detail: string }}
 */


/** Skill indexes a chess record offers (data `skills[]`, DESIGN §16; the default skill alone while data lacks it). */
function skillIndexesOf(c) {
  if (!c || typeof c !== 'object') return [];
  if (Array.isArray(c.skills) && c.skills.length) {
    return [...new Set(c.skills.map((s) => s && s.index).filter((i) => isInt(i, 0, LOADOUT_LIMITS.skillIndex)))].sort((a, b) => a - b);
  }
  return isInt(c.skill?.index, 0, LOADOUT_LIMITS.skillIndex) ? [c.skill.index] : [];
}

/**
 * What the 干员调配 screen may choose for one chess (DESIGN §16).
 *   skills: skill indexes unlocked at BOTH the normal and the elite status (identical sets in the official data)
 *   defaultSkill: `defaultSkillIndex` (data: the skills[] entry flagged isDefault, else `skill.index`)
 *   modules: the elite's modules (uniEquipId…) + 'none'; [] when the chess has no elite record
 *   defaultModule: the elite's default module (`defaultUniEquipId`), 'none' for module-less elites, null without elite
 * @param {any} base normal chess record
 * @param {any} [golden] its elite record (null when absent)
 * @returns {{ skills: number[], defaultSkill: number|null, modules: string[], defaultModule: string|null }}
 */
export function loadoutOptions(base, golden = null) {
  const n = skillIndexesOf(base);
  const g = golden ? skillIndexesOf(golden) : null;
  const skills = g && g.length ? n.filter((i) => g.includes(i)) : n;
  const flagged = Array.isArray(base?.skills) ? base.skills.find((s) => s && s.isDefault && isInt(s.index, 0, LOADOUT_LIMITS.skillIndex)) : null;
  let defaultSkill = flagged ? flagged.index : isInt(base?.skill?.index, 0, LOADOUT_LIMITS.skillIndex) ? base.skill.index : null;
  if (defaultSkill == null || !skills.includes(defaultSkill)) defaultSkill = skills.length ? skills[0] : defaultSkill;
  let modules = [];
  let defaultModule = null;
  if (golden) {
    let def = null;
    if (Array.isArray(golden.modules)) {
      modules = [...new Set(golden.modules.map((m) => m && m.uniEquipId).filter((id) => isId(id) && id !== MODULE_NONE))];
      const d = golden.modules.find((m) => m && m.isDefault && isId(m.uniEquipId));
      def = d ? d.uniEquipId : null;
    } else if (golden.module && golden.module.active && isId(golden.module.id)) {
      modules = [golden.module.id];
    }
    if (def == null && golden.module && golden.module.active && modules.includes(golden.module.id)) def = golden.module.id;
    modules.push(MODULE_NONE);
    defaultModule = def || MODULE_NONE;
  }
  return { skills, defaultSkill, modules, defaultModule };
}

/**
 * Semantic check + normalisation of a loadout against the game data (DESIGN §16). Strict: any unknown / hidden / elite
 * chess id, illegal skill index or module rejects the whole loadout. Entries equal to the defaults are dropped, the
 * rest are stored complete: `{ skill, module }` (module null for a chess without an elite record).
 * @param {any} entries `room.loadout.entries`
 * @param {(id: string) => any} getChess chess record lookup (normal and golden ids)
 * @returns {{ ok: true, loadout: Record<string, { skill: number, module: string|null }> } | { error: 'BAD_MSG'|'BAD_TARGET', detail: string }}
 */
export function checkLoadout(entries, getChess) {
  if (!isLoadoutEntries(entries)) return { error: 'BAD_MSG', detail: 'bad loadout entries' };
  const out = {};
  for (const id of Object.keys(entries)) {
    const e = entries[id];
    const base = typeof getChess === 'function' ? getChess(id) : null;
    if (!base || base.isGolden || base.visible === false || base.isHidden || base.isDiy || (base.baseId && base.baseId !== id)) {
      return { error: 'BAD_TARGET', detail: `unknown chess ${id}` };
    }
    const golden = base.goldenId ? getChess(base.goldenId) || null : null;
    const opt = loadoutOptions(base, golden);
    const skill = e.skill ?? opt.defaultSkill;
    if (!opt.skills.includes(skill)) return { error: 'BAD_TARGET', detail: `skill ${e.skill} not available for ${id}` };
    if (e.module !== undefined && !golden) return { error: 'BAD_TARGET', detail: `${id} has no elite module` };
    const module = golden ? (e.module ?? opt.defaultModule) : null;
    if (golden && !opt.modules.includes(module)) return { error: 'BAD_TARGET', detail: `module ${e.module} not available for ${id}` };
    if (skill === opt.defaultSkill && module === opt.defaultModule) continue;
    out[id] = { skill, module };
  }
  return { ok: true, loadout: out };
}

/**
 * The skill index / module a board chess fights with under a (checked) loadout (DESIGN §16 PlayerBattleInput units):
 * normal chess → `{ skillIndex, moduleId: null }` (normal chess have no module); elite → `moduleId` = uniEquipId or
 * 'none'. Chess the loadout does not mention use their defaults.
 * @param {Record<string, { skill: number, module: string|null }> | null | undefined} loadout
 * @param {any} chess the piece's chess record (normal or golden)
 * @param {(id: string) => any} getChess
 * @returns {{ skillIndex: number|null, moduleId: string|null }}
 */
export function resolveLoadout(loadout, chess, getChess) {
  if (!chess || typeof chess !== 'object') return { skillIndex: null, moduleId: null };
  const baseId = chess.baseId || chess.chessId;
  const base = chess.isGolden ? (getChess(baseId) || chess) : chess;
  const golden = chess.isGolden ? chess : null;
  const opt = loadoutOptions(base, chess.isGolden ? chess : (base.goldenId ? getChess(base.goldenId) || null : null));
  const e = loadout && Object.hasOwn(loadout, baseId) ? loadout[baseId] : null;
  const skillIndex = e && opt.skills.includes(e.skill) ? e.skill : opt.defaultSkill;
  let moduleId = null;
  if (golden) moduleId = e && opt.modules.includes(e.module) ? e.module : opt.defaultModule;
  return { skillIndex, moduleId };
}

/** One `room.loadout.ops` entry: `{ potential?: 1–6, cultivate?: 0–3 }`, at least one of them. */
const isOpsEntry = (e) => isPlain(e) && Object.keys(e).length > 0 && Object.keys(e).every((k) => k === 'potential' || k === 'cultivate')
  && optional(isPotential)(e.potential) && optional(isCultivate)(e.cultivate);
/** Structural check of `room.loadout.ops` (0.2.2): a map of ≤ 256 charIds → `{ potential?, cultivate? }`. */
export const isLoadoutOps = (v) => isMap(v, LOADOUT_LIMITS.ops, isId, isOpsEntry);

/**
 * The operators a player sets a potential / 练度 for (0.2.2): the charIds of the 干员调配 roster — the visible normal chess
 * (checkLoadout's targets; a hidden chess shares its visible twin's charId: 锡人, 耶拉 …) — and the owned 6★ 自选 picks
 * (data/backups.json `diy.ownedPool`). A PRESET (特许) operator the player does not own is set by hand (潜能 1, 未精英化:
 * the official 「未持有的特许按1潜」 and +0 %); a 补位 stand-in or a prototype pick takes neither.
 * @param {Record<string, any>|null|undefined} chess data/chess.json
 * @param {any} [backups] data/backups.json
 * @returns {Set<string>}
 */
export function cultivationCharIds(chess, backups = null) {
  const out = new Set();
  for (const c of Object.values(chess && typeof chess === 'object' ? chess : {})) {
    if (c && !c.isGolden && !c.isDiy && c.visible !== false && !c.isHidden && (!c.baseId || c.baseId === c.chessId) && isId(c.charId)) out.add(c.charId);
  }
  for (const id of Array.isArray(backups?.diy?.ownedPool) ? backups.diy.ownedPool : []) if (isId(id)) out.add(id);
  return out;
}

/**
 * Whether a non-default potential changes this operator. Official characters always may: a PRESET without `potDown`
 * (char_616_pithst) is stored as written and changes no stat, and that stays allowed. A plugin `char_x_` with no
 * `potDown` and no chained talent curve does not. [ASSUMED] only the plugin prefix is restricted (DESIGN §32.5).
 * @param {{ chess?: Record<string, any>, backups?: any }|null|undefined} data
 * @param {string} charId
 */
export function charPotentialChanges(data, charId) {
  if (typeof charId !== 'string' || !charId.startsWith('char_x_')) return true;
  const chess = data?.chess;
  if (chess && typeof chess === 'object') {
    for (const c of Object.values(chess)) if (c?.charId === charId && hasPotentialData(c)) return true;
  }
  const unit = data?.backups?.units?.[charId];
  if (unit) {
    if (hasPotentialData(unit)) return true;
    for (const f of Object.values(unit.forms ?? {})) if (hasPotentialData(f)) return true;
  }
  return false;
}

/**
 * Semantic check + normalisation of `room.loadout.ops` (0.2.2) — strict like checkLoadout: an operator `isOperator` does
 * not know (cultivationCharIds) rejects the whole message. Entries equal to the defaults (潜能 6, 练度 3) are dropped, the
 * rest stored complete `{ potential, cultivate }`. `undefined` / `null` = no settings (`{}`).
 * `changesWithPotential(charId)`, when passed, rejects a non-default potential for an operator whose record has no curve.
 * Callers that omit it keep the previous behaviour.
 * @param {any} ops
 * @param {(charId: string) => boolean} isOperator
 * @param {(charId: string) => boolean} [changesWithPotential]
 * @returns {{ ok: true, ops: Record<string, { potential: number, cultivate: number }> } | { error: 'BAD_MSG'|'BAD_TARGET', detail: string }}
 */
export function checkLoadoutOps(ops, isOperator, changesWithPotential = null) {
  if (ops == null) return { ok: true, ops: {} };
  if (!isLoadoutOps(ops)) return { error: 'BAD_MSG', detail: 'bad operator settings' };
  const out = {};
  for (const id of Object.keys(ops)) {
    if (typeof isOperator !== 'function' || !isOperator(id)) return { error: 'BAD_TARGET', detail: `unknown operator ${id}` };
    const potential = ops[id].potential ?? POTENTIAL_DEFAULT;
    const cultivate = ops[id].cultivate ?? CULTIVATE_DEFAULT;
    if (potential !== POTENTIAL_DEFAULT && typeof changesWithPotential === 'function' && changesWithPotential(id) === false) {
      return { error: 'BAD_TARGET', detail: `potential does not change ${id}` };
    }
    if (potential === POTENTIAL_DEFAULT && cultivate === CULTIVATE_DEFAULT) continue;
    out[id] = { potential, cultivate };
  }
  return { ok: true, ops: out };
}

// ---- 干员皮肤 (docs/SKINS.md): room.skins { skins } ------------------------------------------------------------

/**
 * `room.skins { skins }`: `skins` = `{ [charId]: skinId }` — which appearance each operator wears, one entry per
 * OPERATOR, so it covers the normal chess, its elite and a 自选 slot fielding the same operator (the skin catalogue of
 * the composed asset manifest is grouped per operator too: `chars[charId].skins`, docs/PLUGINS.md §9).
 *
 * A skin comes from an enabled cosmetic plugin's overlay (one the server's owner installed, switched on by each player
 * in 设置 → 外观插件 — `scope: ["personal"]`, so a room is never part of it). Unlike `room.loadout` these are PUBLIC:
 * they ride in `Match.publicView().players[]`, which is how a teammate sees your skin.
 *
 * The wire refuses the shape of the whole map (a non-plain object, a key that is not an operator charId, a value that
 * is not a skinId, or more than `SKIN_LIMITS.entries` pairs). Whether the operator is one this room's content has is
 * `checkSkinSelection`: that entry is dropped and the rest kept. A skinId the manifest does not hold still draws the
 * operator's default model (`spineEntry`).
 */
export const SKIN_LIMITS = Object.freeze({
  // [ASSUMED] absolute ceiling of one message. The practical cap is the operator count of the room's content
  // (checkSkinSelection drops the rest); 256 is above the vanilla roster (210) and the same order as the loadout's
  // operator map. A larger map is refused whole, the way an over-long loadout is.
  entries: 256, idLen: 64, charIdLen: 64,
});
/** A skinId. NOT `isId`: that allows only `[A-Za-z0-9_\-.:]`, while a skin key carries `@` and `#` (`char_002_amiya@winter#1`). The same character class as shared/plugins/visual.js `isSkinKey`. */
export const isSkinId = (v) => typeof v === 'string' && v.length > 0 && v.length <= SKIN_LIMITS.idLen && /^[A-Za-z0-9_][A-Za-z0-9_@#+.\-]*$/.test(v);
/**
 * An operator charId. Official ids are `char_<digits>_<token>` (character_table / data/chess.json: `char_498_inside`,
 * `char_1012_skadi2`, `char_4145_ulpia`, `char_616_pithst`). A plugin operator is `char_x_<id>`
 * (shared/plugins/recordsSchema.js). A chess id (`chess_char_1_01_a`) is not one: `isId` would accept it.
 */
export const CHAR_ID = /^char_(?:x_[A-Za-z0-9_-]+|[0-9]+_[A-Za-z0-9_]+)$/;
export const isCharId = (v) => typeof v === 'string' && v.length <= SKIN_LIMITS.charIdLen && CHAR_ID.test(v);
/**
 * Structural check of `room.skins.skins`: a plain object of ≤ 256 entries, keyed by an operator charId, each value a
 * skinId. Anything else — an array, a null-prototype object, a chess id, a bad skin id, one more entry — is refused
 * as a whole (BAD_MSG). The room's own operator list is not known here.
 */
export const isSkinSelection = (v) => isMap(v, SKIN_LIMITS.entries, isCharId, isSkinId);

const SKIN_OPS = new WeakMap();
/**
 * The operators a room's content has, as charIds: every chess record (hidden and golden share the base charId), the
 * stand-in bodies (`backups.units`), and the 自选 picks (`diy.ownedPool`, `diy.operators`). Not chess ids.
 * @param {{ chess?: Record<string, any>, backups?: any }|null|undefined} data
 * @returns {Set<string>}
 */
export function operatorCharIds(data) {
  if (!data || typeof data !== 'object') return new Set();
  let ids = SKIN_OPS.get(data);
  if (ids) return ids;
  ids = new Set();
  const chess = data.chess && typeof data.chess === 'object' ? data.chess : null;
  if (chess) for (const c of Object.values(chess)) if (c && isCharId(c.charId)) ids.add(c.charId);
  const backups = data.backups && typeof data.backups === 'object' ? data.backups : null;
  const units = backups?.units && typeof backups.units === 'object' ? backups.units : null;
  if (units) for (const id of Object.keys(units)) if (isCharId(id)) ids.add(id);
  const diy = backups?.diy && typeof backups.diy === 'object' ? backups.diy : null;
  if (Array.isArray(diy?.ownedPool)) for (const id of diy.ownedPool) if (isCharId(id)) ids.add(id);
  const ops = diy?.operators && typeof diy.operators === 'object' ? diy.operators : null;
  if (ops) for (const id of Object.keys(ops)) if (isCharId(id)) ids.add(id);
  SKIN_OPS.set(data, ids);
  return ids;
}

/**
 * A skin selection the room may store. The shape is `isSkinSelection` (a failure refuses the whole map). A charId the
 * room's content does not have is dropped; the rest is kept, so the stored map is at most the operator count, and at
 * most `SKIN_LIMITS.entries` [ASSUMED].
 * @param {any} skins
 * @param {(charId: string) => boolean} [hasOperator]
 * @returns {{ ok: true, skins: Record<string, string>, dropped: number } | { error: 'BAD_MSG', detail: string }}
 */
export function checkSkinSelection(skins, hasOperator) {
  if (!isSkinSelection(skins)) return { error: 'BAD_MSG', detail: 'bad skin selection' };
  const out = {};
  let dropped = 0;
  for (const id of Object.keys(skins)) {
    if (typeof hasOperator === 'function' && !hasOperator(id)) { dropped++; continue; }
    out[id] = skins[id];
  }
  return { ok: true, skins: out, dropped };
}

// ---- operator ownership (干员持有, 0.2.0 补位): room.ownership { notOwned } -------------------------------------------

/**
 * `room.ownership { notOwned }`: the base chess ids the player marked as not owned on the 干员持有 screen (the
 * per-browser setting next to 干员调配; default: every operator owned ⇒ []). Such a chess keeps its identity (name,
 * bonds, 特质, tier, price, merge) and fights as its official stand-in (shared/standIn.js standInRecord). Structural
 * limit below; the semantic check (`checkNotOwned`) is LENIENT, unlike checkLoadout: an id that is not a droppable chess
 * (unknown, elite, PRESET / 自选, a stale id of another build) is dropped, never the whole list.
 */
export const OWNERSHIP_LIMITS = Object.freeze({ notOwned: 160 });
/** Structural check of `room.ownership.notOwned`: an array of ≤ 160 ids. */
export const isNotOwnedList = (v) => isList(v, OWNERSHIP_LIMITS.notOwned, isId);

/**
 * Semantic check + normalisation of a not-owned list against the game data: keeps the ids of droppable chess
 * (shared/standIn.js isDroppableChess — NORMAL base chess with a stand-in), deduplicated and sorted; drops the rest.
 * Used by the server (lobby, match) and by the client before it sends or imports a list.
 * @param {any} list `room.ownership.notOwned`
 * @param {(id: string) => any} getChess chess record lookup
 * @returns {{ ok: true, notOwned: string[], dropped: number } | { error: 'BAD_MSG', detail: string }}
 */
export function checkNotOwned(list, getChess) {
  if (!isNotOwnedList(list)) return { error: 'BAD_MSG', detail: 'bad notOwned list' };
  const keep = new Set();
  for (const id of list) {
    const c = typeof getChess === 'function' ? getChess(id) : null;
    if (c && c.chessId === id && isDroppableChess(c)) keep.add(id);
  }
  const notOwned = [...keep].sort();
  return { ok: true, notOwned, dropped: list.length - notOwned.length };
}

// ---- 自选编队 (0.2.0 DIY): room.diy { picks } ------------------------------------------------------------------------

/**
 * `room.diy { picks }`: the player's 自选编队 — `{ [slotBaseId]: { charId, skillIndex?, uniEquipId? } | null }` for the
 * four DIY slots (data/backups.json `diy.slots`: two at tier 5, two at tier 6; shared/diy.js). An out-of-match setting
 * like 干员持有: stored per session / seat, a match takes the picks its seat had at its start. Structural limit below
 * (room for more slots in a later season); the semantic check (`checkDiyPicks`) is LENIENT, like checkNotOwned: an
 * illegal pick — not a pick of the slot's tier, an operator without a kit, a prototype off its locked skill, an unknown
 * skill / module, the same operator twice in a tier, an owned operator in a second slot, an unknown slot — is dropped,
 * never the whole roster; only malformed input is BAD_MSG.
 */
export const DIY_LIMITS = Object.freeze({ slots: 8 });
const isDiyPickWire = (p) => p === null || (isPlain(p) && isId(p.charId)
  && nullable((v) => isInt(v, 0, 9))(p.skillIndex) && nullable(isId)(p.uniEquipId));
/** Structural check of `room.diy.picks`: a map of ≤ 8 slot ids → a pick `{ charId, skillIndex?, uniEquipId? }` or null. */
export const isDiyPicks = (v) => isMap(v, DIY_LIMITS.slots, isId, isDiyPickWire);

/**
 * Semantic check + normalisation of a 自选 roster against the game data (`{ chess, backups }` or a sim DataSource) and
 * the kit registry (`kitted`: server/sim/content/kits/index.js KITTED_CHARS — an operator without a kit is never fielded):
 * the slots are taken in data order (tier 5, then tier 6), and each pick is kept when the roster so far plus it still
 * passes shared/diy.js validateDiyPicks — so the result always passes it, and of two picks that clash (one owned operator
 * in two slots, one operator twice in a tier) the first slot keeps it. Kept picks are complete
 * (`{ charId, skillIndex, uniEquipId }`: a prototype's locked selection, uniEquipId null = no module).
 * @param {any} picks `room.diy.picks`
 * @param {{ data: any, kitted?: Iterable<string>|((id: string) => boolean)|null }} opts
 * @returns {{ ok: true, picks: Record<string, { charId: string, skillIndex: number, uniEquipId: string|null }>, dropped: number }
 *   | { error: 'BAD_MSG', detail: string }}
 */
export function checkDiyPicks(picks, { data, kitted = null } = { data: null }) {
  if (!isDiyPicks(picks)) return { error: 'BAD_MSG', detail: 'bad 自选 picks' };
  const slots = diySlotIds(data);
  /** @type {Record<string, { charId: string, skillIndex: number, uniEquipId: string|null }>} */
  const kept = {};
  let dropped = 0;
  /*
   * ★ **金卡槽位(`_b`)要归一化到 baseId,不能当"不认识的键"丢掉。**
   *
   * 每一格自选在数据里有**两份**棋子记录:`_a`(普通)与 `_b`(精锐/金卡)。
   * 客户端发填报时,键用的是**玩家正在看的那一格**的 id —— 而金卡是单独一格,
   * 玩家完全可以在 `_b` 上填。
   *
   * 这里原来只做精确匹配(`slots.includes(id)`,而 `diySlotIds` 只返回 `_a`),于是:
   *   · `_b` 的键被计入 `dropped` 丢弃;
   *   · 下面那个 `for (const slotId of slots)` 只遍历 `_a`,自然也补不回来。
   * 结果返回 `{ ok: true, picks: {} }` —— **看着成功,其实一条都没留下**,
   * `setDiy` 于是把整份填报当空,干员与皮肤一起消失。
   *
   * 表现(owner 报的):**休整期正常(客户端本地显示),一进战斗就变回原皮** ——
   * 服务端从头到尾没存下这个填报。金卡自选槽还会连带丢掉干员本身。
   *
   * `diySlot()` 本来就知道 `_b` → `baseId` 的映射(shared/diy.js),用它认键即可。
   */
  for (const id of Object.keys(picks)) {
    if (picks[id] != null && !slots.includes(id)) dropped++;
  }
  for (const slotId of slots) {
    const slot = diySlot(slotId, data);
    /* 先看规范键;没有再找它的金卡 id(玩家可能是在 `_b` 那一格上填的) */
    let key = null;
    if (Object.hasOwn(picks, slotId)) key = slotId;
    else if (slot && slot.goldenId && Object.hasOwn(picks, slot.goldenId)) key = slot.goldenId;
    if (key == null) continue;
    const pick = picks[key];
    if (pick == null) continue;
    const res = validateDiyPicks({ ...kept, [slotId]: pick }, { data, kitted });
    if ('ok' in res) {
      kept[slotId] = res.picks[slotId];
      if (key !== slotId) dropped--;        // 上面按"不认识的键"记过一次:它其实被收下了
    } else dropped++;
  }
  return { ok: true, picks: kept, dropped: Math.max(0, dropped) };
}

// ---- unit stats (user playtest #4 item 7): m.unitStats units and the browser battle's live stats ---------------------

const fin = (v, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;
/** Attack interval (s) of a stats object: its own `interval`, else bat × 100 / aspd (null without an attack time). */
const intervalOf = (x) => {
  if (Number.isFinite(x.interval) && x.interval > 0) return round2(x.interval);
  const bat = fin(x.bat, 0);
  const aspd = fin(x.aspd, 100) > 0 ? fin(x.aspd, 100) : 100;
  return bat > 0 ? round2((bat * 100) / aspd) : null;
};
const statView = (x) => ({
  maxHp: Math.round(fin(x.maxHp)), atk: Math.round(fin(x.atk)), def: Math.round(fin(x.def)), res: round1(fin(x.res)),
  interval: intervalOf(x), blockCnt: Math.max(0, Math.round(fin(x.blockCnt))), moveSpeed: round2(fin(x.moveSpeed)),
});

/**
 * The detail card's stats of a sim unit (server/sim/units.js Unit): its effective stats `s` (the aggregated `unit.s`,
 * or the last ones the sim computed) next to its own numbers — `unit.base` with its 练度 multiplier (`unit.cultMul`,
 * 0.2.2: part of the operator's own numbers, as on the record cards; no buffs) — max HP, ATK, DEF, RES, attack interval
 * (s), block, move speed — rounded for display (the sim keeps floats), plus the current HP. The shape of the
 * `m.unitStats` units (Match.unitStats: what the board's units start their next battle with) and of the browser
 * runner's live battle stats (public/js/battle/runner.js unitStats). An ally with a range also carries `range`: the grid
 * (`[dRow, dCol]`, facing RIGHT) it attacks with now — a running skill's range, rangeExtend included, not a kit's
 * target-selection grid (the sim's `unit.liveRangeGrid`, Battle._refreshRange; community report E1 after 0.1.0: 烛煌
 * S3's 4-11 never reached the card). `dir`: the unit's facing now (UP / RIGHT / DOWN / LEFT; UnitInfo.dir is the facing
 * at send time and the snapshot tuples carry none) — the detail card's range overlay rotates by it (GitHub PR #281).
 * @param {{ id?: number, uid?: number|null, defId?: string, hp?: number, alive?: boolean, base?: any, liveRangeGrid?: any, dir?: string } | null} u
 * @param {any} [s] aggregated stats (missing ⇒ the base)
 * @returns {{ id: number|null, uid: number|null, defId: string|null, hp: number, alive: boolean, maxHp: number, atk: number,
 *   def: number, res: number, interval: number|null, blockCnt: number, moveSpeed: number,
 *   base: { maxHp: number, atk: number, def: number, res: number, interval: number|null, blockCnt: number, moveSpeed: number },
 *   range?: Array<[number, number]>, dir?: string }}
 */
export function unitStatsEntry(u, s = null) {
  const own = u && u.base && typeof u.base === 'object' ? u.base : {};
  const base = u && u.cultMul ? cultivatedStats(own, u.cultMul) : own;
  const cur = s && typeof s === 'object' ? s : base;
  const range = u?.side !== 'enemy' && Array.isArray(u?.liveRangeGrid)
    ? u.liveRangeGrid.filter((p) => Array.isArray(p) && Number.isInteger(p[0]) && Number.isInteger(p[1])).map((p) => [p[0], p[1]])
    : null;
  return {
    id: Number.isInteger(u?.id) ? u.id : null,
    uid: Number.isInteger(u?.uid) ? u.uid : null,
    defId: typeof u?.defId === 'string' ? u.defId : null,
    hp: Math.max(0, Math.round(fin(u?.hp))),
    alive: u?.alive !== false,
    ...statView(cur),
    base: statView(base),
    ...(range ? { range } : {}),
    ...(isDir(u?.dir) ? { dir: u.dir } : {}),
    // the enemy card greys a SILENCE-format line (折射) from this; absent flags ⇒ not silenced
    silenced: !!(cur.flags && cur.flags.silence),
  };
}

/** Deploy directions (DESIGN §3, research 09 §1.2; the same list as server/sim/dir.js DIRS). */
export const DIRS = Object.freeze(['UP', 'RIGHT', 'DOWN', 'LEFT']);
const isDir = (v) => DIRS.includes(v);

const target = (v) => {
  if (!v || typeof v !== 'object') return false;
  if (v.area === 'board') return isInt(v.row, 0, GEO.ROWS - 1) && isInt(v.col, 0, GEO.COLS - 1);
  if (v.area === 'hand') return isInt(v.idx, 0, GEO.HAND_SIZE - 1);
  return false;
};

/** @type {Record<string, Record<string, (v:any)=>boolean> & { $optional?: string[] }>} */
export const C2S = {
  // session & lobby
  // `avatar` is the 个人档案 portrait: the chessId the player picked, or '' / absent for the default. It is
  // validated as a plain identifier (letters/digits/underscore) so the server never forwards a path or markup to
  // other clients — the id is opaque beyond that and each client resolves it against its own chess data.
  hello: {
    name: (v) => isStr(v, NAME_MAX_LEN) && v.trim().length > 0,
    /*
     * ⚠ `token` = **断线重连令牌**(服务器发给会话,用来找回上一局——`registry.byToken`)。
     *   `pass`  = **登录准入码**(所有人要带的门牌,server/access.js)。
     *
     *   这两个**必须是两个字段**。它们原来挤在 `token` 上,而客户端只有一个值:
     *   写完重连令牌紧接着写准入码,后者**覆盖**前者 —— 于是服务端拿准入码去找旧会话,
     *   永远找不到,每次都建新会话(新 playerId),原席位变成幽灵,房间几次掉线就满了
     *   (owner 报的「一个房间就会导致房间已满 / 无法观战 / 中途断线无法重连回去」)。
     *
     *   服务端准入判定读 `pass ?? token`,所以**老客户端**(只发 token)仍然连得上。
     */
    token: (v) => v == null || isStr(v, 64),
    pass: (v) => v == null || isStr(v, 64),
    version: (v) => v == null || isInt(v, 0, 1e6),
    /*
     * `avatar` —— 玩家选的立绘/头像 id。
     *
     * ⚠⚠ **这里必须同时接受 `custom:` 自定义头像** (owner 2026-10-16:
     *   「是更换了自定义头像之后会无效的请求然后卡住」)。
     *
     *   原来只允许 `/^[A-Za-z0-9_]+$/` —— 那是**官方立绘 chessId** 的形状
     *   (`char_1041_angel2` 之类,纯字母数字下划线)。而自定义头像是
     *   `custom:<短名>`(带**冒号**)、玩家上传的更是 `custom:u/<账号>`(还带**斜杠**),
     *   两种写法**一律被判非法** ⇒ 整条 `hello` 回 `bad field avatar`
     *   ⇒ 客户端弹「无效的请求」,而且那次连接**就此卡住**。
     *
     *   教训:这个校验是"字段形状"的白名单,而头像的 id 空间**后来长出了新形状**
     *   —— 加自定义头像时只改了业务层(`shared/avatars.js` 的 `parseAvatarId`),
     *   漏了协议层这份白名单,于是两处对"合法 id"的定义不一致,
     *   而**协议层是先跑的那一道**,业务层根本没机会看到它。
     *
     *   现在两处共用同一个形状规则(见下面 `isAvatarIdStr`),不会再漂。
     */
    avatar: (v) => v == null || isAvatarIdStr(v),
    /*
     * ★ **设备身份 token** (owner 2026-10-17「排行榜和获赞还是不生效」→「都修」)。
     *
     *   客户端首次连接时生成一个随机 token 存在 localStorage,以后每次都带上。
     *   服务端没见过就**替它建一个账号**(账号名从博士代号派生)——
     *   玩家**不注册、不登录、不输密码**,但从此有稳定身份,
     *   排行榜 / 获赞 / 档案 / 自定义头像这些依赖账号的功能才有对象可用。
     *
     * ⚠ 它**是凭证**:拿到它就能冒充该账号。强度等同于"记住登录状态"的 cookie。
     *   不校验得更严是因为它本来就是个随机串(形状校验挡的是垃圾输入,不是攻击者)。
     */
    device: (v) => v == null || (typeof v === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(v)),
    noReplace: isBool, claimAt: (v) => isNum(v, 0, Number.MAX_SAFE_INTEGER),
    privateDelta: (v) => v === 1,
    $optional: ['token', 'pass', 'version', 'avatar', 'device', 'noReplace', 'claimAt', 'privateDelta'],
  },
  /*
   * 账号 (server/accounts.js) — 账号密码登录, so a player's profile follows them to another device.
   *
   * `proof` is NOT the password: it is the PBKDF2 derivation the client makes (`shared/accountAuth.js`), and the
   * server hashes THAT with scrypt before storing it. The extra hop keeps a password the player probably reuses
   * elsewhere off the wire and out of the logs — this is served over plain HTTP on a LAN, so the wire is readable.
   * It is not a substitute for TLS (a proof can be replayed); see the note on `Network.onAccountMsg`.
   *
   * These work BEFORE `hello`: the title screen has nothing to name yet. `acc.rename` / `acc.profile.set` come after,
   * because both need a session.
   */
  'acc.register': { account: (v) => isStr(v, 32), proof: (v) => isStr(v, 256) },
  'acc.login': { account: (v) => isStr(v, 32), proof: (v) => isStr(v, 256) },
  // the DISPLAY name only — the account name is the login and can never change
  'acc.rename': { name: (v) => isStr(v, NAME_MAX_LEN) && v.trim().length > 0 },
  /*
   * ★ `vote { target }` — 对局结束后给别的博士点赞 (owner 2026-10-17)。
   *
   *   ⚠ `target` 是**被赞那个人的 playerId**(对局里的 id,不是账号名)——
   *     客户端只可能知道 playerId,账号名由服务端自己查
   *     (`network.accountOf(target)`)。**绝不能让客户端直接指定账号名**,
   *     否则谁都能给任意账号刷赞。
   *
   *   服务端按"一对只能算一次"记,所以重复点不会刷数。
   */
  vote: { target: (v) => isStr(v, 64) && v.length > 0 },
  /*
   * acc.avatar.set { data } / acc.avatar.clear — 玩家自己上传头像
   * (owner 2026-10-15:「做在个人档案里(每个玩家都能传自己的)」)。
   *
   * `data` 是 `data:image/png;base64,...`(canvas 导出的那种)。上限由**服务端**判
   * (64 KB / 512px / 必须正方形),这里只挡一个明显离谱的长度 ——
   * 协议层的字符串长度限制是为了不让一个 100 MB 的帧进到业务逻辑里。
   *
   * ⚠ **不接受 http(s) 地址**:那样等于让服务器替玩家去抓一个外部 URL。
   */
  'acc.avatar.set': { data: (v) => isStr(v, 96 * 1024) },
  'acc.avatar.clear': { id: v=>v==null||isStr(v,80), $optional:['id'] },
  'acc.namecard.set': { data: (v) => isStr(v, 60 * 1024) },
  'acc.namecard.clear': { id: v=>v==null||isStr(v,80), $optional:['id'] },
  /*
   * 公开档案 (点击他人查看档案): 签名 + 对局数 + 胜场.
   *
   * The client owns this blob — there is no account any more, so the profile lives in localStorage and is PUSHED here
   * whenever it changes (and once on connect). The server keeps it on the session and projects it onto the seat, which
   * is where other players read it from.
   *
   * Only aggregates, never the per-match history: 「你赢了几成」 is public, 「你上周三打了什么」 is not.
   */
  'p.avatar': { avatar: v => v === null || isAvatarIdStr(v), revision: v => Number.isSafeInteger(v) && v > 0, epoch:v=>Number.isSafeInteger(v)&&v>=0 },
  'p.profile': {
    namecard: validNamecard,
    comment: (v) => v == null || isStr(v, 60),
    matches: (v) => v == null || isInt(v, 0, 1e6),
    wins: (v) => v == null || isInt(v, 0, 1e6),
    soloScore: (v) => v == null || isInt(v, 0, 100),
    coopScore: (v) => v == null || isInt(v, 0, 100),
    soloTitles: (v) => v == null || isCounts(v),
    coopTitles: (v) => v == null || isCounts(v),
    soloTally: (v) => v == null || isTally(v),
    coopTally: (v) => v == null || isTally(v),
    picks: (v) => v == null || isCounts(v),
    crisisPoints: (v) => v == null || isInt(v, 0, 1e9),
    /*
     * 危机合约分档 (owner:「只有成功完成（存活）的才会计入最高分和累计分数」「然后查看他人档案功能也增加这些
     * 包括危机合约相关的」): 别人的档案里也要看得到"他最好的成绩"和"三档各多少次",不能只有一个累计分 ——
     * 累计分只反映活动量,最高分和三档才反映水平。
     *
     * `tiers` 的键必须和 shared/crisisScore.js 的 `CRISIS_TIERS` 一致(clear / hold / fallen)。
     */
    crisis: (v) => v == null || (typeof v === 'object' && !Array.isArray(v)
      && [v.bestHard, v.bestAbyss, v.totalPoints, v.clears, v.matches].every((x) => x == null || isInt(x, 0, 1e9))
      && (v.tiers == null || (typeof v.tiers === 'object' && !Array.isArray(v.tiers)
        && [v.tiers.clear, v.tiers.hold, v.tiers.fallen].every((x) => x == null || isInt(x, 0, 1e6))))),
    $optional: ['namecard', 'comment', 'matches', 'wins', 'soloScore', 'coopScore', 'soloTitles', 'coopTitles', 'soloTally', 'coopTally', 'picks', 'crisisPoints', 'crisis'],
  },
  /*
   * 公开档案:签名 + 战绩 + 六维称号次数 + 常选 —— 点「查看档案」时别人看到的那一份.
   *
   * 数据只存在于**玩家自己的 localStorage** 里。做法是客户端**主动推上来**,服务端存一份、随 room.state 分发给
   * 同房的人 (owner:「然后服务端获取分发给同房的玩家不就行了」)—— 比"请求者去问对方客户端"简单得多,
   * 而且对方掉线之后档案还在,不会因为问不到就变空。
   *
   * 推的是**聚合值**:两栏的综合评分 / 称号次数 / 战绩三格、常选计数、合约总分。
   * 逐场战绩(history)**不参与** —— 那是"你上周三打了什么"级别的私人记录,不是给别人看的排行榜。
   */
  // the whole profile blob ({ avatar, comment, history }); the client owns its shape, the server bounds its size
  'acc.profile.set': { $optional:['identityEpoch'], identityEpoch:v=>Number.isSafeInteger(v)&&v>=0, profile: (v) => v == null || (typeof v === 'object' && !Array.isArray(v)) },
  ping: { c: (v) => typeof v === 'number' && Number.isFinite(v) },
  // test: only the literal true (DESIGN §34.8). Omit it for a normal room — `false` is a bad field, so a
  // string cannot sneak in as "not a test". The server still refuses it unless SP_TEST_MODE is on.
  // 肉鸽是独立模式（2026-11-01，客户端发 `mode:'rogue'`）：它的难度表是 N1–N20（difficultiesFor('rogue')），
  // 与 solo/coop 的旧 4 档并列接受；同一个 N 档发在 coop/solo 上仍然是坏字段（行为不变，不做全局放宽）。
  // `variant` 是房间玩法变体（'rogue' / 'xie' / 对抗规则档），只校验形状，怎么解释由 lobby 与插件决定。
  'room.create': { mode: (v) => v === 'solo' || v === 'coop' || v === 'rogue', difficulty: (v, m) => DIFFICULTIES.includes(v) || v === TRAINING_DIFFICULTY || (m?.mode === 'rogue' && DIFFICULTY_TIERS.includes(v)), variant: (v) => v == null || (typeof v === 'string' && v.length > 0 && v.length <= 64 && /^[A-Za-z0-9_.:-]+$/.test(v)), test: (v) => v === true, capacity: (v) => ROOM_CAPACITIES.includes(v),
    // 肉鸽「地图主题池」 (shared/rogueThemes.js): 'all' | 'ro1'…'ro6'。缺席 / null = 'all'（默认房一个键都不多）。
    mapPool: (v) => v == null || isPool(v),
    $optional: ['test','capacity','variant','mapPool'] },
  'room.join': { $optional: ['testAck'], testAck: (v) => v === true, code: (v) => isStr(v, ROOM_CODE_LEN + 2) && /^[A-Za-z0-9]+$/.test(v) },
  'room.leave': {},
  'room.music': { command: validRoomMusicCommand },
  'room.ready': { ready: isBool },
  // 名片干员 (room.card, server/lobby.js card()): the operator whose portrait fills the player's seat card — a visible
  // charId of the room's chess.json, '' for none. Cosmetic: accepted in any phase, never touches a match.
  // (插件顶替拷贝 plugins/mota/shared/protocol.js 有同一行；缺了它客户端一发包就在本地 BAD_MSG。)
  'room.card': { charId: (v) => v === '' || isCharId(v) },
  'room.setDifficulty': { difficulty: (v) => DIFFICULTIES.includes(v) || v === TRAINING_DIFFICULTY },
  // the co-op room option 「AI 队友最后选择」 (GitHub #338; host, before the match): the strategy and 机变 drafts order every
  // human seat before every AI seat (server/match/match/phases.js humansFirst); room.state.aiPicksLast
  'room.setAiPicksLast': { on: isBool },
  // 「包含无场景地图」 (host, before the match; off by default): `false` narrows every stage pool to the stages that ship
  // an official scene package (data/local-assets.json's `scene/<stageId>` groups, server/match/sceneStages.js); `true`
  // keeps every stage of the mode (a stage without a scene falls back to the procedural board). room.state.incompleteMaps
  // is omitted unless it is on, so a default room.state stays identical.
  'room.setIncompleteMaps': { on: isBool },
  // the host resizes the room before the match: `capacity` is one of ROOM_CAPACITIES and never below the seats taken
  'room.setCapacity': { capacity: (v) => ROOM_CAPACITIES.includes(v) },
  // 2026-11-07 房间席位数（默认 4）：客户端 ⚙ 的滑条发这条，服务端拒绝小于「已占用最高座位」的值。
  // 与 `room.setCapacity` 并存 —— 那条是历史键、服务端从未处理；这条才是真正接通的。
  'room.setSeatCap': { code: (v) => isStr(v, ROOM_CODE_LEN + 2) && /^[A-Za-z0-9]+$/.test(v), seatCap: (v) => ROOM_CAPACITIES.includes(v) },
  /*
   * 危机合约 (shared/contracts.js): the host replaces the room's selection with `contracts` — a small array of
   * contract ids. Validated against the room's size server-side (`contractsValidFor`), so the client only has to send
   * what the 危机合约 screen has ticked.
   *
   * ⚠ 上限是**合约表的总条数**,不是写死的 16。合约表从 1 条长到 45 条之后,16 会拒绝一份完全合法的选择
   * (湮灭 12 条 + 毁灭 13 条大多可以一起选),客户端看到的就是「无效的请求」(owner 报的)。
   * 用 `CONTRACTS.length` 而不是再写一个大数字:以后加合约不必记得回来改这里。
   */
  'room.setContracts': { contracts: (v) => Array.isArray(v) && v.length <= CONTRACTS.length && v.every((c) => isStr(c, 32)) },
  'room.setCricket': {settings:validCricket},
  'room.setRandomEvents': {settings:validRandomEvents},
  'room.addBot': {},
  'room.removeBot': { seat: (v) => isInt(v, 0, MAX_SEATS - 1) },
  // the host removes another human before the match (server/lobby.js kick; community report #17); playerId = the one the
  // host confirmed — a seat that changed hands meanwhile is refused
  'room.kick': { seat: (v) => isInt(v, 0, MAX_SEATS - 1), playerId: isId },
  // 移交创建者 (the seat card's player menu): host only, and only to a seat that holds a human
  'room.makeHost': { seat: (v) => isInt(v, 0, MAX_SEATS - 1) },
  /*
   * 私人 / 匹配开关 (host only). `isPrivate` is the 房间锁: a private room refuses EVERY join, code or not
   * (「持有密钥也无法进入」). `matchmaking` only means "list me in the lobby's 匹配 panel".
   *
   * Both optional so a caller may flip one without restating the other; the server forces `matchmaking` off whenever
   * `isPrivate` goes on.
   */
  'room.setAccess': {
    isPrivate: (v) => v == null || isBool(v),
    matchmaking: (v) => v == null || isBool(v),
    $optional: ['isPrivate', 'matchmaking'],
  },
  /*
   * 房间简介 (owner:「打开可以给房间写简介」).
   *
   * 上限给到 ROOM_DESC_MAX 的**两倍**:服务端还会再截断一次(`cleanRoomDesc`,按码点),
   * 这里只负责挡住"一个超长 payload 打进来"这种滥用。两边用同一个常量会让协议层
   * 拒绝掉服务端本来会接受的内容(比如差一个码点的边界),所以刻意留一倍余量。
   */
  'room.setDesc': { desc: (v) => typeof v === 'string' && [...v].length <= ROOM_DESC_MAX * 2 },
  /* 是否允许其他人观战(owner:「增加是否允许其他人观战」) */
  'room.setSpectate': { allow: isBool },
  // 随机匹配: join the fullest matchable room, or fail when there is none
  'room.matchNow': {},
  // ask for the 匹配 room list right now (the panel opening, or a manual refresh)
  'room.list': {},
  'room.start': {},
  'room.loadout': { entries: isLoadoutEntries, ops: isLoadoutOps, $optional: ['ops'] },
  // 干员皮肤 (docs/SKINS.md): the appearances the player wears, keyed by operator charId; PUBLIC, so it is accepted in
  // any room phase (the loadout locks at INFO_CHECK because it changes what a unit does; a skin changes only the model)
  'room.skins': { skins: isSkinSelection },
  // operator ownership (干员持有, 0.2.0 补位): stored per session / seat; a match takes the list its seat had when it
  // started (an out-of-match setting — during a match it is stored for the next one: ROOM_STARTED)
  'room.ownership': { notOwned: isNotOwnedList },
  // 自选编队 (0.2.0 DIY): the player's DIY slot picks; stored per session / seat like room.ownership (a match takes the
  // picks its seat had when it started; during a match they are stored for the next one: ROOM_STARTED)
  'room.diy': { picks: isDiyPicks },
  // spectator seats (remake feature, community report #26; MAX_SPECTATORS): take one of a co-op room's spectator seats —
  // in its lobby or while its match runs — never a player seat; the host frees one by playerId (the spectator gets
  // room.closed { reason: 'kicked' }). room.leave / g.leave leave a spectator seat like a player seat.
  'room.spectate': { $optional: ['testAck'], testAck: (v) => v === true, code: (v) => isStr(v, ROOM_CODE_LEN + 2) && /^[A-Za-z0-9]+$/.test(v) },
  'room.removeSpectator': { playerId: isId },
  // the room's plugins (DESIGN §32, P1a; host, before the match — like a difficulty change it un-readies the others):
  // the plugins of this server the room switches on, in any order (the server closes the set over their requirements
  // and sorts it: shared/plugins/order.js); [] = the original content. Cosmetic plugins (art: the room's visual set,
  // `vs`) and, from P1c (DESIGN §32.6), content plugins (gameplay: the room's content set, a `cs` of its own); `settings`
  // is for the classes that have settings (a cosmetic plugin has none, so it is ignored). room.state.content names the set
  'room.setPlugins': { plugins: (v) => isList(v, 32, (p) => isPlain(p) && isPluginId(p.id)
    && (p.settings === undefined || isMap(p.settings, 32, (k) => isStr(k, 32), isScalar))) },
  // the room's mode (DESIGN §32.6, P1c; host, before the match — like a difficulty change it un-readies the others): an
  // official mode of the room's type (the one of a difficulty: it sets the difficulty) or a mode a plugin of the room's
  // content set provides (room.state.content.modes; room.state.content.modeId while it is chosen)
  'room.setMode': { modeId: isId },
  // the page has loaded and checked the room's content set (DESIGN §32.6): `cs` = the room.state.content.cs it checked —
  // every data file's bytes against /cs/<cs16>/index.json, that manifest's composition against `cs`; `ok: false` = it
  // could not (the seat shows it). A room with gameplay plugins starts only once every player's page sent it for its cs
  'room.consent': { cs: isContentHash, accept: isBool },
  'room.contentReady': { cs: isContentHash, ok: isBool, $optional: ['ok'] },
  /*
   * 切换座位 (room.swapSeat) — 坐到空位,或与另一个人互换位置。
   *
   * `playerId` 省略 = 移动自己(任何人都可以);带上是**房主**在移动别人,这就是"调整所有人的座位顺序"。
   * 房主移动别人时仍然是一次**换位**:被移动的人与目标格的人互换,不会有人被挤掉,
   * 也不会出现两个座位同时指向同一个人。
   *
   * `targetSeat` 的上界按房间容量(最多 MAX_SEATS)在服务端再判一次 —— 这里用一个宽上界挡住明显的畸形值,
   * 具体是否越界由 lobby 按 `capacity` 决定(协议层不该知道房间多大)。
   */
  'room.swapSeat': {
    targetSeat: (v) => isInt(v, 0, MAX_SEATS - 1),
    playerId: isId,
    $optional: ['playerId'],
  },
  /* 玩家 ↔ 观战席互切:`out: true` 让出座位去观战,`false` 从观战席坐回一个空位。 */
  'room.sitOut': { out: isBool },
  /*
   * 房间聊天 (room.chat) — 只在**大厅**可用:开局后聊天走对局内的 `g.chat` / `m.chat`。
   * 上限与对局内聊天共用 `CHAT_MAX_LEN`(40 字符),服务端还会再清洗与截断一次。
   */
  'room.chat': { text: (v) => isStr(v, CHAT_MAX_LEN) && v.trim().length > 0 },
  /*
   * 重刷本局 (opening reroll, upstream 0.2.3 #77 / PR #408 — match/setupVote.js).
   *
   * INFO_CHECK only, host only, and only when every connected human agrees. `setupRevision` is the revision the
   * requester thinks it is confirming: a stale one is refused so a click that crossed a reroll cannot reroll again.
   * `voteId` does the same for a vote that has already been replaced by a newer one.
   *
   * ⚠ Both belong to `room.*` (not `g.*`) because the LOBBY authorizes them: the host check lives in
   * server/lobby.js rerollSetup, next to every other host-only action. `g.rerollVote` is the participants'.
   */
  'room.rerollSetup': { setupRevision: (v) => isInt(v, 0, 2 ** 31) },
  'room.cancelReroll': { voteId: (v) => isInt(v, 1, 2 ** 31) },

  // match
  'g.infoReady': { setupRevision: (v) => isInt(v, 0, 2 ** 31), $optional: ['setupRevision'] },
  
  'g.band': { bandId: isId },
  'g.bandSkip': {},
  // the strategy highlighted in the draft screen (user playtest #4 item 4): a turn that runs out takes it while it is
  // free (Match.timeoutBand); absent / null clears it
  'g.bandFocus': { bandId: nullable(isId), $optional: ['bandId'] },
  'g.bandWish': { bandId: nullable(isId), $optional: ['bandId'] },
  'g.buy': { slot: (v) => isInt(v, 0, 15) },
  'g.borrow': { n: (v) => isInt(v, 1, 8), $optional: ['n'] },
  'g.repay': { n: (v) => isInt(v, 1, 15), $optional: ['n'] },
  'g.refresh': {},
  'g.freeze': {},
  'g.levelUp': {},
  'g.sell': { uid: isUid },
  // dir: the facing chosen on the deploy wheel for a board target (absent ⇒ RIGHT; the piece's own tile ⇒ re-orient)
  'g.move': { uid: isUid, to: target, dir: isDir, $optional: ['dir'] },
  // replaceUid: with both of the target's slots used, the equipped item the replace dialog picked (research 09 §1.2
  // UseEquipUp.unloadInstId; absent ⇒ the oldest; not one of the target's items ⇒ BAD_TARGET)
  'g.equip': { itemUid: isUid, targetUid: isUid, replaceUid: nullable(isUid), recipientId:nullable(isId), $optional: ['replaceUid','recipientId'] },
  'g.art': { itemUid: isUid, row: (v) => isInt(v, 0, GEO.ROWS - 1), col: (v) => isInt(v, 0, GEO.COLS - 1), dir: isDir, $optional: ['dir'] },
  'g.suiCard': { fieldId:isId, row:v=>isInt(v,0,GEO.ROWS-1), col:v=>isInt(v,0,GEO.COLS-1) },
  'g.destroy': { uid: isUid },
  // unequip (DESIGN §34.15): one equipped item back to the hand, else the visible temp window. Official rooms refuse it.
  'g.unequip': { itemUid: isUid },
  'g.reward': { idx: (v) => isInt(v, 0, MAX_DRAFT_CARDS - 1) },
  'g.choice': { idx: (v) => isInt(v, 0, MAX_DRAFT_CARDS - 1), choiceId: isId, $optional: ['choiceId'] },
  // a plugin interaction window (PLUGIN API v2, docs/PLUGINS.md §10b): offerId is the window's declared id, idx the
  // slot picked; g.offerRefresh redraws one slot (the window's own `refresh.perSlot` bounds how often). The host
  // applies the window's declared effect primitive — a plugin never receives these messages itself.
  'g.offer': { offerId: isId, pluginId: isId, seq: (v) => isInt(v, 0, 1000000), cardId: optional(isId), idx: (v) => isInt(v, 0, PLUGIN_OFFER_SLOTS - 1) },
  'g.offerRefresh': { offerId: isId, pluginId: isId, seq: (v) => isInt(v, 0, 1000000), cardId: optional(isId), idx: (v) => isInt(v, 0, PLUGIN_OFFER_SLOTS - 1) },
  'g.ready': { ready: isBool },
  'g.selfLimit': { id: isStr,step:v=>Number.isInteger(v)&&v>=0&&v<64 },
  'g.selfBenefit':{id:v=>v===null||isStr(v),step:v=>Number.isInteger(v)&&v>=0&&v<64},
  'g.emote': { id: (v) => EMOTES.includes(v) },
  // 对局文字聊天: a free-text line, bounds-checked here so the server never has to trust the client's length.
  // `isStr` measures in CHARACTERS; an all-whitespace line is rejected outright.
  'g.chat': { text: (v) => isStr(v, CHAT_MAX_LEN) && v.trim().length > 0 },
  // playerId: the player tapped in the team panel (a 联防 / boss pair field shows two) — what an eliminated viewer or a
  // spectator seat follows from then on (Match.watchPref; community report of 2026-10-06, item 56)
  'g.watch': { fieldId: (v) => isStr(v, 32), playerId: isId, $optional: ['playerId'] },
  'g.autoplay': { on: isBool },
  // solo pause (official PauseUp / ResumeUp, DESIGN §14): freezes the running battle (field clock, deadlines, the
  // browser's local runner) — solo matches only (co-op ⇒ WRONG_PHASE), only while a battle runs; m.public.paused
  'g.pause': { on: isBool },
  'g.speed': { speed: (v) => v === 1 || v === 2 },
  /*
   * 暂停投票 (match/pauseVote.js) — co-op only, 休整期 only.
   *
   * `g.pauseVote` opens a vote to hold the round's prep clock for five minutes; `reason` is what goes into the popup
   * everyone sees (a 120-character cap, enforced server-side). `g.resumeVote` opens the same vote to lift a hold that
   * is already running — no reason: there is nothing to explain. `g.votePause { on }` is one player's answer to
   * whichever vote is open (true 同意 / false 拒绝; repeating the same side withdraws it).
   *
   * The 80 % rule and the tally are the server's (UNITE_ABANDON_RATIO over living humans) — the client never
   * re-derives them, it renders `m.public.pauseVote`.
   */
  'g.kickVote': { targetId: (v) => isStr(v,128)&&v.length>0, reason: (v)=>isStr(v,120)&&v.trim().length>0 },
  'g.voteKick': { voteId: (v)=>Number.isSafeInteger(v)&&v>0,on:isBool },
  'g.pauseVote': { reason: (v) => v == null || isStr(v, 120) },
  'g.resumeVote': {},
  'g.votePause': { on: isBool },
  /*
   * 重刷本局 (opening reroll, upstream 0.2.3 #77 / PR #408 — match/setupVote.js).
   *
   * One participant's answer to the open reroll vote: true 同意, false 拒绝 (a refusal ends the vote at once — unlike
   * the 暂停 vote there is no tally to keep, because EVERY connected human must agree). `voteId` guards against
   * answering a vote that has already been replaced.
   */
  'g.rerollVote': { voteId: (v) => isInt(v, 1, 2 ** 31), agree: isBool },
  /*
   * 分组拦截 (联防) controls.
   *
   * `g.uniteVote` asks the room to abandon the defence zone the current group is holding. The server counts it and, at
   * UNITE_ABANDON_RATIO of the LIVING players, retreats the group at once and puts the next one on. `on: false`
   * withdraws a vote already cast, so a repeat is idempotent.
   */
  'g.uniteVote': { on: isBool },
  // the stats the own board's units start their next battle with (user playtest #4 item 7; prep phases): answered by
  // the push m.unitStats { seq, round, units: [unitStatsEntry] }; `seq` is echoed so the client keeps the newest answer
  'g.unitStats': { seq: (v) => isInt(v, 0, 2 ** 31), $optional: ['seq'] },
  /*
   * 战斗中实时部署 (方案 A, flags.liveDeploy — server/match/match/combat.js liveDeploy / liveRetreat).
   *
   * `g.deploy` puts one of the player's OWN board pieces — created held off the field at battle start — on the field
   * during COMBAT, paying its `cost` in DP. `row`/`col` are the field tile the player tapped (stage coordinates;
   * absent = the piece's own board tile). `g.retreat` withdraws a standing piece: it leaves the field, arms its
   * redeploy timer and refunds no DP. Both are gated to the player's own uid (another player's piece answers 'unknown')
   * and answer the SENDER only, on m.deploy — the order's acceptance is not the deployment's result.
   */
  'g.deploy': { uid: isUid, row: (v) => isInt(v, 0, GEO.ROWS - 1), col: (v) => isInt(v, 0, GEO.COLS - 1), $optional: ['row', 'col'] },
  'g.retreat': { uid: isUid },
  'g.leave': {},
  // host test commands (DESIGN §34.8 phase 2). The server applies them only in a test match. `args` is checked
  // again by shared/testMode.js parseTestArgs (ids, bounds). Unknown keys inside args fail there, not here.
  'g.test': { cmd: isTestCommand, args: (v) => v === undefined || (isPlain(v) && Object.keys(v).length <= 8), $optional: ['args'] },

  // client-side combat (DESIGN §14): the authoritative client of a field reports its battle; a 联防 field adds
  // `left` = { [leakerId]: its enemies still standing (unspawned, alive, or through again) } (server/sim/spec.js
  // uniteLeft; user playtest #6 item 7 — the leakers' live counter)
  'b.bsFire': { battleId: isId, key: (v) => isStr(v, 120), duration: (v) => isNum(v, 0.01, 60) },
  // uniteLeft; user playtest #6 item 7 — the leakers' live counter). `resolved` = the HUD capsule's numerator: the
  // field's own scheduled enemies that were knocked out **or leaked** (official: 漏一个 1/3, 打死一个 2/3,
  // 打死会分裂的 3/3 — Battle.leakedInTotal; runtime splits / summons stay out of both parts of the capsule). A boss / hidden field adds
  // `leaksBy` = { [playerId]: the cumulative LP the enemies that reached that player's goal cost } — `leaks` minus its
  // sum is the leader's own "扣除目标生命" effects; the server holds the b.result's leaked lists to it (Match._bossLeaksAgree)
  'b.progress': {
    battleId: isId, gt: (v) => isNum(v, 0, 1e5), killed: (v) => isInt(v, 0, 1e5), total: (v) => isInt(v, 0, 1e5),
    resolved: (v) => isInt(v, 0, 1e5),
    leaks: (v) => isNum(v, 0, 1e6), bossDmg: (v) => isNum(v, 0, BIG),
    by: (v) => isMap(v, RESULT_LIMITS.sources, isId, (x) => isNum(x, 0, BIG)), done: isBool,
    left: (v) => isMap(v, RESULT_LIMITS.sources, isId, (x) => isInt(x, 0, 1e5)),
    leaksBy: (v) => isMap(v, RESULT_LIMITS.sources, isId, (x) => isNum(x, 0, 1e6)),
    $optional: ['resolved', 'leaks', 'bossDmg', 'by', 'done', 'left', 'leaksBy'],
  },
  // `cs` (DESIGN §32, optional): the content hash the reporting browser ran the battle on — its spec's `cs`. In a room
  // with gameplay plugins (P1c, DESIGN §32.6) the match refuses a result without it or with another one (and runs the
  // battle itself); a vanilla room's browser sends none
  'b.result': { battleId: isId, result: isBattleResult, cs: isContentHash, $optional: ['cs'] },
  // A delegated bot layout rehearsal (DESIGN §14): the match's current host answers the candidates it was handed with
  // the S2C 'b.rehearsal' frame. `choice` is the index of the candidate its browser picked, in the order the task sent
  // them — a malicious or buggy client can only name one of the server's own candidate layouts, never a layout or a
  // match state of its own; `error: true` says this client cannot run the task at all (no module Worker, or the
  // simulation data did not load), so the server takes the rehearsal over at once instead of waiting for its timeout.
  // An unknown task, another sender or a task the server already took over is ignored; an invalid `choice` makes the
  // server run the candidates itself. `choice` stops at 7 because a match rehearses at most 8 candidates.
  'b.rehearsalResult': {
    taskId: isId, choice: (v) => v === undefined || isInt(v, 0, 7), error: (v) => v === undefined || v === true,
    $optional: ['choice', 'error'],
  },
};

// Server → client message types (documentation + client dispatch table keys).
export const S2C = [
  'm.bsFire',
  'welcome', 'ok', 'error', 'pong',
  'b.speed', // Solo battle clock change: { speed: 1 | 2, fields: [{ battleId, elapsed }] }.
  /*
   * s.avatars { list: [{ id, url, label, by }], urls: [{ id, url }] }
   *
   * `list` — **这个人能选的自定义头像** (owner 2026-10-15「然后做成头像 让只有我能用」)。
   *   ⚠ 它是**服务端按账号裁剪过的**:别人的专属头像根本不在里面,所以客户端无从伪造。
   *   发两次 —— `onHello`(账号还没绑上)与 `onAccountBound`(绑上之后,这时才有专属头像);
   *   客户端语义是**整体替换**,重复发没有副作用。
   *
   * `urls` — ★ **所有人可见的 id → URL 映射** (owner 2026-10-17:「自定义头像 别的玩家不显示
   *   看不到」)。登记表里每一张图的 id 与公开 URL,**不含权限信息**。
   *
   *   ⚠ 它必须存在,而且必须发给**所有人**:只靠 `list` 的话,
   *     没被授权的玩家**画不出别人档案上的自定义头像**,房间里看你就成了首字母。
   *     而 owner 要的是「**所有人看得见,只有被授权的人能选**」——
   *     "能不能选"和"能不能看到"是两件事,原来把它们绑在一起了。
   *
   *   ⚠ 发它**不放松权限**:选头像仍然要过服务端(`server/avatars.js allows`
   *     + `net.onProfileMsg` 的白名单拦截)。而且图片本来就在 `/data/avatars/` 公开挂载下,
   *     这份映射只是让客户端知道该取哪个文件名。
   */
  's.avatars',
  's.namecards',
  'p.identity', 'room.state', 'room.closed', 'room.music',
  'm.public', 'm.private', 'm.field', 'm.toast', 'm.ticker', 'm.emote', 'm.result',
  // 房间聊天 { seq, playerId, name, seat, text, at } — one line, broadcast to the whole room (players + spectators)
  'm.roomChat',
  // 对局内聊天 { seq, playerId, name, seat, text, at } — the in-match channel (g.chat / m.chat).
  // ⚠ 这一条**上游 0.2.4/0.2.5 和 fork 的 S2C 里都漏了**(服务端 intents.js 在发、客户端 main.js 在监听)。
  //    S2C 只作文档与分发表用途,运行时不校验,所以一直没暴露;补上以免以后有人照着它对消息。
  'm.chat',
  // m.layer { playerId, bondId, add } — own live prep layer gain; ephemeral, never replayed on resync.
  // ⚠ 上游 0.2.5 新增。三方合并时它和 fork 自研的 'm.roomChat' 是同一块冲突,取任一侧都会丢掉另一侧 ——
  //    这里把两边都留下。少了它,`economy.js` 发出的 m.layer 不在 S2C 声明里(客户端 main.js 仍在监听)。
  'm.layer',
  // m.unitStats { seq, round, units: [unitStatsEntry] } — the answer to g.unitStats (the requester only)
  'm.unitStats',
  // 战斗中实时部署 (方案 A): the answer to g.deploy / g.retreat, to the requester only —
  // { ok: true, uid, dp?, retreat? } or { ok: false, error } with the engine's stable reason
  // ('mode' | 'player' | 'unknown' | 'deployed' | 'removed' | 'respawn' | 'tile' | 'occupied' | 'down' | 'dp' |
  // 'notdeployed' | 'finished'). `dp` (a deploy) is the battle's DP left; `retreat: true` names a withdrawal, whose ok
  // removes the piece from the client's standing set.
  'm.deploy',
  // client-side combat (DESIGN §14): b.start { battleId, fieldId, kind, spec, authoritative, startAt, serverNow, elapsed,
  // speed, watch?, bgmTheme? } — `bgmTheme` 是**自适应开战 BGM** 的主题名 (shared/bgmTheme.js):服务端在开战时算定
  // (关卡声明优先、敌人家族兜底),同一场战斗发给所有人都是同一个值,战斗中不变;null/缺失 = 走原来的回合曲子。
  // · b.pool { hp, max, teamLp, acked: { [fieldId]: cumulative boss damage counted },
  // fought: seconds since THIS boss round started, board?: [{ id, dmg }] top-5 damage of this boss round —
  // present only when it changed, so the client keeps the last value } ·
  // b.end { battleId, fieldId, reason }
  'b.start', 'b.pool', 'b.end',
  // a delegated bot layout rehearsal (DESIGN §14): b.rehearsal { taskId, playerId, cap, specs } — the host's browser
  // runs the candidate BattleSpecs off the page's main thread and answers with a C2S b.rehearsalResult ·
  // b.rehearsalCancel { taskId } — the server dropped that task (it timed out, the host changed, the prep ended):
  // the executor drops it too, and only a running simulation (the Worker) is really stopped
  'b.rehearsal', 'b.rehearsalCancel',
  // server-run combat streaming (legacy / SP_COMBAT=server only)
  'b.snap', 'b.ev',
];

/**
 * Validate a decoded client message. Returns `null` when valid, otherwise a short reason string.
 * Extra unknown fields are ignored (not copied by handlers).
 */
/**
 * 头像 id 的**形状白名单**(`hello.avatar`)。
 *
 * 合法形状有两类 —— 这个函数是它们**唯一**的定义,业务层(`shared/avatars.js`)与协议层共用:
 *
 *   · 官方立绘 chessId: `char_1041_angel2` / `chess_char_6_13_a` → 纯字母数字下划线
 *   · 自定义头像:       `custom:hat`、玩家上传的 `custom:u/<账号>`
 *
 * ⚠ 长度上限 48:`custom:` 7 字符 + 上传那条 `u/<账号≤32>` = 最多 41,
 *   留一点余量。上限必须真的挡住超长输入(它会进档案 blob 并广播给同房间的人)。
 *
 * ⚠ `custom:` 后面**不做细粒度校验** —— 那是 `shared/avatars.js parseAvatarId` 的职责
 *   (它还要判路径穿越、账号名字符集)。这里只管"形状像不像一个 id",
 *   免得把两套规则写两遍又写漂(这正是原来那个 bug 的成因)。
 *
 * @param {unknown} v
 */
export function isAvatarIdStr(v) {
  if (typeof v !== 'string' || v.length > 48) return false;
  if (v === '') return true;                                   // 空串 = 用默认
  if (/^custom:[A-Za-z0-9_/-]+$/.test(v)) return true;         // 自定义(含玩家上传)
  return /^[A-Za-z0-9_]+$/.test(v);                            // 官方立绘 chessId
}

export function validateC2S(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return 'not an object';
  const spec = typeof msg.t === 'string' && Object.hasOwn(C2S, msg.t) ? C2S[msg.t] : null;
  if (!spec) return `unknown type ${String(msg.t).slice(0, 32)}`;
  if (msg.rid != null && !isInt(msg.rid, 0, 2 ** 31)) return 'bad rid';
  const optional = spec.$optional || [];
  for (const [k, check] of Object.entries(spec)) {
    if (k === '$optional') continue;
    const v = msg[k];
    if (v === undefined && optional.includes(k)) continue;
    // the whole message is the second argument so a field may depend on another one (room.create.difficulty on
    // `mode`: the N1–N20 ladder belongs to 肉鸽). Every one-argument check ignores it, so nothing else changes.
    if (!check(v, msg)) return `bad field ${k}`;
  }
  return null;
}

// Event tuple kinds inside `b.ev` (DESIGN §8.2). 'cast' ['cast', id, slot, dur?] is display only: an enemy uses the skill
// of that slot of its data record's skills[] (server/sim/content/enemies/helpers.js castSlot; the client's skill clip
// and official skill effects — render/app.js).
export const EV = Object.freeze({
  SPAWN: 'spawn', ATK: 'atk', DMG: 'dmg', HEAL: 'heal', SKILL: 'skill', ENGAGE: 'engage', DIE: 'die', LEAK: 'leak',
  STATUS: 'status', FX: 'fx', LAYER: 'layer', BOUNTY: 'bounty', DEPLOY: 'deploy', CAST: 'cast',
});

/**
 * The model form a `b.ev` 'fx' tuple ['fx', kind, x, y, extra] puts its unit in: `extra.form` (sim content/enemies/helpers.js
 * setForm — 转译基底·α's forms, a 逐火 余烬 and its revival, a leader's 重生, 守墓石像's modes, 掠海漂移体's crawl; a 傀儡师's 替身,
 * sim professions.js; a string is that clip set, null the base one), undefined for any other tuple. A form is state, not decoration: a view that misses
 * the fx keeps drawing the old model (player report #5 after 0.1.0), so the client's catch-up frames, its hidden-tab
 * backlog (battle/runner.js) and the events buffered before a field is entered (screens/game.js) keep these tuples.
 */
export function fxForm(ev) {
  if (!Array.isArray(ev) || ev[0] !== EV.FX) return undefined;
  const x = ev[4];
  if (!x || typeof x !== 'object' || x.id == null || !Object.hasOwn(x, 'form')) return undefined;
  return typeof x.form === 'string' ? x.form : null;
}
