#!/usr/bin/env node
// Merge the ro4 rogue-level enemies that data/enemies.json is missing into it (data only: no asset, schema or
// sim change). tools/build-data.mjs builds enemies.json from the season's own key set (templates / factions /
// bands / bosses / summons); the roguelike levels spawn a further 242 enemy keys that therefore never got a
// record, and a SPAWN action for an unknown key leaves the wave without stats. This script appends those
// records, shaped exactly like buildEnemies() writes them, and is idempotent: keys already in the file are
// skipped, so a second run adds nothing.
//
// Sources, in the order the dispatch fixed:
//   1. enemy_database level 0 (`enemy_database.json`, the Oct-13 gamedata snapshot) — every number comes from
//      here whenever the key has a record (214 of 242); the roguelike level's own enemyDbRefs overwrite is NOT
//      applied on top (same-season comparability was asked for, and the db is what build-data reads).
//   2. the levels' own `enemyDbRefs[].overwrittenData` — only for keys the database lacks (28 of 242). Every
//      `m_defined:true` field is merged; if one key carries several distinct value sets the most frequent set
//      wins and the record notes `overwriteVariants: N`.
//   3. neither → not written at all, listed under `unresolved` in the report.
// Shape fields the database has no column for come from the repo itself where it can: enemy_handbook_table
// (handbookIndex / abilities / damageType), autoChessData (beFactor, isFlyEnemy, summons, enemy types, template
// slot, inactive modes, the constData power factors), data/assets.json (attackAnim). What is left comes from the
// 0.4.3 upstream content file (same author, same shape) and finally from build-data's documented defaults.
// `modelScale` is never emitted: none of these prefabs is in build-data's MODEL_SCALES (i.e. all are the standard
// 0.27 → scale 1, which build-data omits), and attackAnim is omitted for prefabs the manifest lacks.
// Every appended record carries `source: 'db' | 'override'` so it stays traceable.
//
// Paths (all overridable; the three required ones fail loudly with where the file belongs):
//   ENEMIES_JSON        data/enemies.json                                  (default: <repo>/data/enemies.json)
//   ROGUE_LEVELS_DIR    a directory of ro4 level_*.json                     (required)
//   ENEMY_DB            levels/enemydata/enemy_database.json                (required)
//   GAMEDATA_DIR        the gamedata cache root (excel/activity_table.json, excel/enemy_handbook_table.json)
//   REF_ENEMIES         0.4.3 data/enemies.json, shape fallback only        (optional)
//   ASSETS_MANIFEST     data/assets.json                                    (default: <repo>/data/assets.json)
//   ENEMIES_BACKUP      where the pre-merge file is copied (created once)   (optional)
// Usage: node tools/build-enemies-merged.mjs [--dry-run]
//        npm-free: plain `node`, no dependencies beyond the repo's own modules.

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { createOfficialUnitBuilders } from '../server/plugins/officialUnitBuilder.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// This checkout lives at <workspace>/_tmp/<task>/src/<repo>; the gamedata cache and the ro4 level export sit
// elsewhere in the same workspace, so the defaults stay relative to it instead of hard-coding a drive letter.
const WORKSPACE = resolve(ROOT, '../../../..');

const warnings = [];
const warn = (m) => { warnings.push(m); console.error(`warn: ${m}`); };
const { stripRich, richRaw, cleanNum, flattenBB } = createOfficialUnitBuilders(warn);

const PATHS = {
  enemies: process.env.ENEMIES_JSON || join(ROOT, 'data/enemies.json'),
  levels: process.env.ROGUE_LEVELS_DIR || join(WORKSPACE, '_tmp/rogue-mapdata-2026-11-02/levels/ro4'),
  enemyDb: process.env.ENEMY_DB || join(WORKSPACE, 'stronghold-server/.cache/gamedata/levels/enemydata/enemy_database.json'),
  gamedata: process.env.GAMEDATA_DIR || join(WORKSPACE, 'stronghold-server/.cache/gamedata'),
  ref: process.env.REF_ENEMIES || join(WORKSPACE, '_tmp/zuoyeyuanche-2026-11-03/sim-upgrade/plugins/upstream-043-content/data/enemies.json'),
  manifest: process.env.ASSETS_MANIFEST || join(ROOT, 'data/assets.json'),
  backup: process.env.ENEMIES_BACKUP || join(WORKSPACE, '_tmp/ai-modes-2026-11-03/backup/enemies.orig.json'),
};
const DRY_RUN = process.argv.includes('--dry-run');

// ===== loading ===================================================================================
const REQUIRED = [
  ['ENEMIES_JSON', 'enemies', 'data/enemies.json of this repo (the file that gets appended to)'],
  ['ROGUE_LEVELS_DIR', 'levels', 'the ro4 level_*.json export directory'],
  ['ENEMY_DB', 'enemyDb', 'levels/enemydata/enemy_database.json of the gamedata snapshot'],
];

function die(msg) {
  console.error(`error: ${msg}`);
  process.exit(1);
}
for (const [env, key, what] of REQUIRED) {
  if (!existsSync(PATHS[key])) die(`${env} not found at ${PATHS[key]} — set ${env} to the ${what}`);
}

async function readJson(path, label, { required = true } = {}) {
  if (!existsSync(path)) {
    if (required) die(`${label} not found at ${path}`);
    warn(`${label} not found at ${path}; continuing without it`);
    return null;
  }
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    die(`${label} at ${path} is not valid JSON: ${err.message}`);
  }
}

// ===== enemy_database vocabulary (parity with tools/build-data.mjs:1417-1478) ====================
/** m_value of an enemy field, or the default when the database never defined it. */
const mv = (f, dflt = null) => {
  if (!f || typeof f !== 'object' || !('m_value' in f)) return dflt;
  const v = f.m_value;
  if (f.m_defined === false && (v == null || v === 0 || v === false || v === '')) return dflt;
  return v;
};

/** Only defined fields of an override (m_defined === true), flattened to plain values. */
function definedFields(over) {
  const out = {};
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && 'm_defined' in v) { if (v.m_defined) out[k] = v.m_value; }
    else if (k === 'attributes' && v) Object.assign(out, definedFields(v));
    else if ((k === 'talentBlackboard' || k === 'skills' || k === 'spData') && v != null) out[k] = v;
  }
  return out;
}

/** MELEE enemies only ever hit their blocker (build-data effectiveRangeRadius). */
function effectiveRangeRadius(applyWay, raw) {
  if (applyWay === 'MELEE' || typeof raw !== 'number' || !Number.isFinite(raw)) return 0;
  return Math.max(0, raw);
}

/** enemy skills → compact records (build-data enemySkills). */
function enemySkills(list, label) {
  return (Array.isArray(list) ? list : []).map((sk) => {
    const { bb, bbStr } = flattenBB(sk.blackboard, `${label} skill ${sk.prefabKey}`);
    return { prefabKey: sk.prefabKey, priority: sk.priority, cooldown: sk.cooldown, initCooldown: sk.initCooldown, spCost: sk.spCost, bb, bbStr };
  });
}

/** Stable string for "this override set has these values", independent of the JSON's key order. */
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v);
}

/**
 * Identity of one override set for the "most frequent set wins" rule. Blackboard / skill lists are an
 * unordered key→value bag (their order only feeds flattenBB's duplicate suffixing), so two levels that list
 * the same buffs in a different order are one set, not two.
 */
const byCanonical = (a, b) => { const x = canonical(a), y = canonical(b); return x < y ? -1 : x > y ? 1 : 0; };
function overrideSetId(defs) {
  const norm = { ...defs };
  for (const k of ['talentBlackboard', 'skills']) if (Array.isArray(norm[k])) norm[k] = [...norm[k]].sort(byCanonical);
  return canonical(norm);
}

/**
 * Rebuild an enemy_database-shaped `enemyData` from a flattened override, so the same mv()-based mapping runs
 * on both sources. `attrKeys` is the database's attribute vocabulary (attributes nest one level deeper there).
 */
function wrapDefined(defs, attrKeys) {
  const out = {};
  for (const [k, v] of Object.entries(defs)) {
    if (k === 'talentBlackboard' || k === 'skills' || k === 'spData') out[k] = v;
    else if (attrKeys.has(k)) (out.attributes ||= {})[k] = { m_defined: true, m_value: v };
    else out[k] = { m_defined: true, m_value: v };
  }
  return out;
}

// ===== sources ===================================================================================
/** Every distinct enemy_ key spawned by waves[].fragments[].actions[] of the level files. */
async function collectRogueKeys(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const keys = new Set();
  for (const f of files) {
    const level = JSON.parse(await readFile(join(dir, f), 'utf8'));
    for (const w of level.waves || []) for (const fr of w.fragments || []) for (const a of fr.actions || []) {
      if (typeof a.key === 'string' && a.key.startsWith('enemy_')) keys.add(a.key);
    }
  }
  return { keys, files };
}

/** key → the override sets its enemyDbRefs carry, in file order (for keys the database lacks). */
async function collectOverrides(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json')).sort();
  const out = new Map();
  for (const f of files) {
    const level = JSON.parse(await readFile(join(dir, f), 'utf8'));
    for (const r of level.enemyDbRefs || []) {
      if (!r || typeof r.id !== 'string' || !r.overwrittenData) continue;
      if (!out.has(r.id)) out.set(r.id, []);
      out.get(r.id).push(r.overwrittenData);
    }
  }
  return out;
}

/** The attack clip of a prefab (build-data enemyAttackAnim, over data/assets.json). */
function enemyAttackAnim(manifest, spineId) {
  const sp = manifest?.enemies?.[spineId]?.spine;
  const a = sp?.anims?.attack;
  if (!a || typeof a.loop !== 'string' || a.via === 'idle') return null;
  const dur = sp.animations?.[a.loop];
  if (!(typeof dur === 'number' && dur > 0)) return null;
  const h = sp.hits?.[a.loop];
  const hit = Array.isArray(h) && Number.isFinite(h[0]) ? Math.min(dur, Math.max(0, h[0])) : null;
  return hit != null ? { clip: a.loop, dur, hit } : { clip: a.loop, dur };
}

const DMG_MAP = { PHYSIC: 'phys', MAGIC: 'arts', HEAL: 'heal', NO_DAMAGE: 'none', TRUE: 'true', ELEMENT: 'element' };

/** build-data's season-wide tables a rogue enemy can still be listed in (sparse: these keys are not pool keys). */
function seasonTables(ac, season) {
  const typeOf = new Map();
  for (const [type, list] of Object.entries(season?.enemyInfoDict || {})) for (const k of list || []) {
    if (!typeOf.has(k)) typeOf.set(k, []);
    typeOf.get(k).push(type);
  }
  const specialType = new Map(Object.values(season?.specialEnemyInfoDict || {}).map((e) => [e.specialEnemyKey, e.type]));
  const inactiveIn = new Map();
  for (const m of Object.values(season?.modeDataDict || {})) for (const k of m.inactiveEnemyKey || []) {
    if (!inactiveIn.has(k)) inactiveIn.set(k, []);
    inactiveIn.get(k).push(m.modeId);
  }
  const c = ac?.constData || {};
  const slots = {
    [c.templateEnemyNormal]: 'N', [c.templateEnemyElite]: 'E', [c.templateEnemySpecial]: 'S',
    [c.templateEnemyNormalFly]: 'NF', [c.templateEnemyEliteFly]: 'EF', [c.templateEnemySpecialFly]: 'SF',
    [c.templateEnemyToken]: 'T', [c.templateEnemyTokenFly]: 'TF',
  };
  delete slots.undefined;
  return {
    typeOf, specialType, inactiveIn, slots,
    rand: ac?.randomEnemyAttributeDict || {},
    factors: {
      hp: c.enemyMaxHpFactor ?? 1, atk: c.enemyAtkFactor ?? 5,
      def: c.enemyDefFactor ?? 3, res: c.enemyMagicResistanceFactor ?? 3,
    },
  };
}

// ===== one record ================================================================================
function buildEntry({ key, data, table, handbook, ref, manifest, source, variantCount }) {
  const at = data.attributes || {};
  const hb = handbook[key] || null;
  const rf = ref[key] || null;
  const rand = table.rand[key] || null;
  const f = table.factors;

  const applyWay = mv(data.applyWay, 'NONE');
  const hbDmg = Array.isArray(hb?.damageType) && hb.damageType.length
    ? hb.damageType.map((d) => DMG_MAP[d] || String(d).toLowerCase())
    : null;
  const dmgTypes = hbDmg || rf?.stats?.dmgTypes || [];
  const rawRangeRadius = cleanNum(mv(data.rangeRadius, 0));

  const stats = {
    maxHp: mv(at.maxHp, 0), atk: mv(at.atk, 0), def: mv(at.def, 0), res: cleanNum(mv(at.magicResistance, 0)),
    moveSpeed: cleanNum(mv(at.moveSpeed, 1)), bat: cleanNum(mv(at.baseAttackTime, 1)), aspd: cleanNum(mv(at.attackSpeed, 100)),
    rangeRadius: effectiveRangeRadius(applyWay, rawRangeRadius),
    rawRangeRadius,
    blockCnt: at.blockCnt?.m_defined ? at.blockCnt.m_value : 1,
    massLevel: mv(at.massLevel, 0), lpr: mv(data.lifePointReduce, 1),
    hpRecoveryPerSec: cleanNum(mv(at.hpRecoveryPerSec, 0)),
    elementRes: cleanNum(mv(at.epResistance, 0)), elementDmgRes: cleanNum(mv(at.epDamageResistance, 0)),
    hitRatePhys: cleanNum(mv(at.damageHitratePhysical, 0)), hitRateArts: cleanNum(mv(at.damageHitrateMagical, 0)),
    dmgType: dmgTypes[0] || (applyWay === 'NONE' ? 'none' : 'phys'), dmgTypes, motion: mv(data.motion, 'WALK'),
    immunities: {
      stun: !!mv(at.stunImmune, false), silence: !!mv(at.silenceImmune, false), sleep: !!mv(at.sleepImmune, false),
      frozen: !!mv(at.frozenImmune, false), levitate: !!mv(at.levitateImmune, false),
    },
    otherImmunities: ['disarmedCombat', 'feared', 'palsy', 'attract', 'teleport', 'groundBound'].filter((k) => !!mv(at[`${k}Immune`], false)),
    tauntLevel: mv(at.tauntLevel, 0),
  };

  const beFactor = rand?.enemyBattleEffectivenessFactor ?? 1;
  const be = beFactor > 0 ? Math.round((stats.maxHp * f.hp + stats.atk * f.atk + stats.def * f.def + stats.res * f.res) / beFactor) : null;
  // attrPower runs in the official client's f32 arithmetic (build-data enemyAttrPower), so it is not the same value
  const fr = Math.fround;
  let power = fr(fr(fr(stats.atk * f.atk) + fr(stats.maxHp * f.hp)) + fr(stats.def * f.def));
  power = fr(power + fr(f.res * stats.res));

  // handbook first, the 0.4.3 record second (its ability texts are the same official strings, already split)
  const abilitySrc = Array.isArray(hb?.abilityList) && hb.abilityList.length ? hb.abilityList : (rf?.abilities || []);
  const abilities = abilitySrc.map((a) => {
    const raw = a.textRaw ?? a.text;
    return { text: stripRich(raw), textRaw: richRaw(raw), format: a.textFormat || a.format || 'NORMAL' };
  });

  const { bb, bbStr } = flattenBB(data.talentBlackboard, `enemy ${key} talents`);
  const name = mv(data.name) || hb?.name || rf?.name || key;
  const descRaw = mv(data.description) ?? hb?.description ?? null;
  const spine = mv(data.prefabKey) || key;
  const attackAnim = enemyAttackAnim(manifest, spine) || rf?.attackAnim || null;
  const acTypes = table.typeOf.get(key) || (rf?.acTypes && rf.acTypes.length ? rf.acTypes : []);
  const acType = table.specialType.get(key) || table.typeOf.get(key)?.[0] || rf?.acType || acTypes[0] || null;

  const entry = {
    key, name, level: rand?.level ?? 0, rank: mv(data.levelType, 'NORMAL'), handbookIndex: hb?.enemyIndex || rf?.handbookIndex || null,
    desc: stripRich(descRaw), descRaw: richRaw(descRaw),
    applyWay, stats,
    abilities,
    talents: { bb, bbStr },
    skills: enemySkills(data.skills, `enemy ${key}`),
    ...(data.spData ? { sp: { type: data.spData.spType ?? null, maxSp: data.spData.maxSp ?? 0, initSp: data.spData.initSp ?? 0, increment: data.spData.increment ?? 0 } } : {}),
    notCountInTotal: !!mv(data.notCountInTotal, false),
    tags: mv(data.enemyTags) || [],
    be, beFactor, attrPower: power, isFlyEnemy: rand ? !!rand.isFlyEnemy : stats.motion === 'FLY',
    // every key here is spawned by a wave action of a ro4 level, so it is never a token reached only through refs
    tokenOnly: false,
    acTypes, acType,
    templateSlot: table.slots[key] || rf?.templateSlot || null,
    summons: rand?.extraEnemyKeyList || rf?.summons || [],
    inactiveIn: table.inactiveIn.get(key) || [],
    seasonOverride: null,
    iconId: key, spine,
    ...(attackAnim ? { attackAnim } : {}),
    ...(variantCount > 1 ? { overwriteVariants: variantCount } : {}),
    source,
  };
  return entry;
}

// ===== main ======================================================================================
const rawText = await readFile(PATHS.enemies, 'utf8');
let current;
try {
  current = JSON.parse(rawText);
} catch (err) {
  die(`${PATHS.enemies} is not valid JSON: ${err.message}`);
}
const currentKeys = new Set(Object.keys(current));

const { keys: rogueKeys, files: levelFiles } = await collectRogueKeys(PATHS.levels);
const enemyDbRaw = await readJson(PATHS.enemyDb, 'ENEMY_DB');
const db = new Map();
for (const e of enemyDbRaw.enemies || []) db.set(e.Key, e.Value || []);

// the database's attribute vocabulary, taken from its widest record (attributes nest one level deeper there)
let attrKeys = new Set();
for (const levels of db.values()) {
  const a = levels.find((l) => l.level === 0)?.enemyData?.attributes
    || levels[0]?.enemyData?.attributes;
  if (a && Object.keys(a).length > attrKeys.size) attrKeys = new Set(Object.keys(a));
}

const activity = await readJson(join(PATHS.gamedata, 'excel/activity_table.json'), 'activity_table', { required: false });
const ac = activity?.autoChessData || null;
const season = activity?.activity?.AUTOCHESS_SEASON?.act2autochess || null;
if (!activity) warn('no activity_table: beFactor/isFlyEnemy/summons/enemy types/template slots fall back to build-data defaults');
else if (!season) warn('activity_table has no AUTOCHESS_SEASON.act2autochess: enemy types / inactive modes / template slots default to empty');
const table = seasonTables(ac, season);

const handbook = (await readJson(join(PATHS.gamedata, 'excel/enemy_handbook_table.json'), 'enemy_handbook_table', { required: false }))?.enemyData || {};
const ref = (await readJson(PATHS.ref, 'REF_ENEMIES', { required: false })) || {};
const manifest = (await readJson(PATHS.manifest, 'ASSETS_MANIFEST', { required: false })) || null;

const overrides = await collectOverrides(PATHS.levels);

const missing = [...rogueKeys].filter((k) => !currentKeys.has(k)).sort();
const unresolved = [];
const added = [];
const sources = { db: 0, override: 0 };
const multiVariant = [];

for (const key of missing) {
  const levels = db.get(key);
  if (levels && levels.length) {
    const base = levels.find((l) => l.level === 0)?.enemyData || levels[0].enemyData;
    added.push(buildEntry({ key, data: base, table, handbook, ref, manifest, source: 'db', variantCount: 0 }));
    sources.db++;
    continue;
  }
  const sets = overrides.get(key) || [];
  const grouped = new Map();
  for (const over of sets) {
    const defs = definedFields(over);
    if (!Object.keys(defs).length) continue;
    const id = overrideSetId(defs);
    if (!grouped.has(id)) grouped.set(id, { count: 0, defs, first: grouped.size });
    grouped.get(id).count++;
  }
  if (!grouped.size) { unresolved.push(key); continue; }
  // most frequent value set wins; equal counts keep the first one met in file order
  const winner = [...grouped.values()].sort((a, b) => b.count - a.count || a.first - b.first)[0];
  added.push(buildEntry({
    key, data: wrapDefined(winner.defs, attrKeys), table, handbook, ref, manifest,
    source: 'override', variantCount: grouped.size,
  }));
  sources.override++;
  if (grouped.size > 1) multiVariant.push(`${key} (${grouped.size})`);
}

// ===== verify before writing =====================================================================
const newObj = {};
for (const e of added) newObj[e.key] = e;

const trailing = /\s*$/.exec(rawText)[0];
const body = rawText.slice(0, rawText.length - trailing.length);
if (!body.endsWith('}')) die('cannot append: the current file does not end with "}"');
const mergedText = added.length
  ? `${body.slice(0, -1)},${added.map((e) => `${JSON.stringify(e.key)}:${JSON.stringify(e)}`).join(',')}}${trailing}`
  : rawText;

let merged;
try {
  merged = JSON.parse(mergedText);
} catch (err) {
  die(`internal check failed: the merged text is not valid JSON (${err.message})`);
}
const oldChanged = Object.keys(current).filter((k) => !isDeepStrictEqual(current[k], merged[k]));
const addedChanged = added.filter((e) => !isDeepStrictEqual(e, merged[e.key]));
if (oldChanged.length) die(`internal check failed: existing records changed — ${oldChanged.slice(0, 5).join(', ')}`);
if (addedChanged.length) die(`internal check failed: appended records do not round-trip — ${addedChanged.map((e) => e.key).slice(0, 5).join(', ')}`);
if (Object.keys(merged).length !== Object.keys(current).length + added.length) die('internal check failed: record count mismatch');
if (added.length && !mergedText.startsWith(body.slice(0, -1))) die('internal check failed: the existing bytes were not preserved');

// ===== backup + write ============================================================================
let backupWritten = false;
if (added.length && !DRY_RUN) {
  if (!existsSync(PATHS.backup)) {
    await mkdir(dirname(PATHS.backup), { recursive: true });
    await copyFile(PATHS.enemies, PATHS.backup);
    backupWritten = true;
  }
  await writeFile(PATHS.enemies, mergedText);
}

// ===== report ====================================================================================
const report = {
  enemyJson: PATHS.enemies,
  levels: { dir: PATHS.levels, files: levelFiles.length, distinctEnemyKeys: rogueKeys.size },
  existing: currentKeys.size,
  missing,
  added: added.length,
  total: added.length ? Object.keys(merged).length : currentKeys.size,
  sources,
  overwriteVariants: multiVariant,
  unresolved: { count: unresolved.length, keys: unresolved },
  // what the records appended in THIS run could not fill (empty on a re-run: nothing is appended then)
  addedShape: {
    handbookIndexNull: added.filter((e) => !e.handbookIndex).map((e) => e.key),
    abilitiesEmpty: added.filter((e) => !e.abilities.length).length,
    acTypesEmpty: added.filter((e) => !e.acTypes.length).length,
    attackAnim: added.filter((e) => e.attackAnim).length,
    sp: added.filter((e) => e.sp).length,
  },
  checks: {
    oldRecordsUnchanged: oldChanged.length === 0,
    appendedRoundTrip: addedChanged.length === 0,
    existingBytesPreserved: !added.length || mergedText.startsWith(body.slice(0, -1)),
  },
  backup: added.length ? { path: PATHS.backup, writtenNow: backupWritten } : null,
  dryRun: DRY_RUN,
  changed: added.length > 0 && !DRY_RUN,
  warnings,
};

console.log(added.length
  ? `${DRY_RUN ? '[dry-run] ' : ''}added ${added.length} enemies (db ${sources.db}, override ${sources.override}); total ${report.total}`
  : `nothing to add: all ${rogueKeys.size} wave keys of ${levelFiles.length} ro4 levels are already in ${PATHS.enemies}`);
if (unresolved.length) console.log(`unresolved (no database record, no override): ${unresolved.join(', ')}`);
if (report.backup?.writtenNow) console.log(`backup written to ${PATHS.backup}`);
console.log(JSON.stringify(report, null, 2));
