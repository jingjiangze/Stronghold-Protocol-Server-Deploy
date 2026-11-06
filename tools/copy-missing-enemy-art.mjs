#!/usr/bin/env node
// tools/copy-missing-enemy-art.mjs — 用工作区里现成的兄弟树补齐「manifest 声明了、public/assets 里没落盘」的敌人美术。
//
// 为什么：data/assets.json 是资产 manifest，路径本来就是对的；真正缺的是文件。本机实测（2026-11-06）：
// data/enemies.json 475 条里 112 条的 icon 与 Spine 三件套在 public/assets 下不存在（icon 363/475、spine 362/475），
// 怪物商店卡池（monsterPoolKeys 口径 408 只）里有 101 只露空图。同一批文件在工作区另外两棵树里 112/112 齐全，
// 且是原件（抽验 enemy_1000_gopro.png 37948 B / PNG magic，.skel 101737 B，atlas 含 `size: 256,256` 与 `pma: true`），
// 所以这里只做**本地拷贝**，不联网；要下载走 tools/fetch-missing-enemy-art.mjs。
//
// 路径口径（统一到「assets 根下的相对路径」，manifest 的三种写法都归一到这里）：
//   · `icon` / `spine.skel` / `spine.atlas` / `spine.textures[]` 是 site-absolute（`/assets/enemy/icon/x.png`）
//     ⇒ 去掉 `/assets/` 前缀；目标 = `<repo>/public/assets/<rel>`。
//   · `spineLocal.group`（`spine/enemy/<id>`）+ `skel` / `atlas` / `textures[]` 已经是 assets 根下的相对路径
//     ⇒ 目标同上。它只在条目**没有** `spine` 时才算 required（4 条只有 spineLocal 的条目）。
//   · `spineAliasOf` 的 14 条别名（如 enemy_1305_mhslim → enemy_1007_slime）`spine` 已指向基座目录，
//     基座文件补齐后别名条目自动修复；它自己的 `spineLocal` 只是历史本地副本，源树没有就不算缺失（计入 optional）。
//
// 幂等与校验：目标存在且 size > 0 就跳过；每个复制都过后校验（PNG 完整签名 + IEND / skel 二进制且前 8 字节非全零 /
// atlas 含页面图行；校验器复用 tools/assets/formats.mjs），失败就删掉刚写的那个文件并计入 failed。
// **不写 data/**：manifest 不需要改（docs/ASSETS.md 的 schema 没变，缺的只是文件）。
//
// Usage:
//   node tools/copy-missing-enemy-art.mjs [--dry-run] [--verbose] [--json] [--help]
// 路径（环境变量可覆盖；ENEMY_ASSET_SOURCES 用 path.delimiter 分隔，按顺序取第一个有该文件的源）：
//   ENEMIES_JSON         data/enemies.json   要补的 key 表
//   ASSETS_MANIFEST      data/assets.json    路径真源（只读）
//   PUBLIC_DIR           public              写入根（本机是到 dl-cache 的符号链接）
//   ENEMY_ASSET_SOURCES  源树 assets 根      默认下面两棵
//     <工作区>/_tmp/roguelike-impl-2026-11-03/build/public/assets
//     <工作区>/_tmp/zuoyeyuanche-2026-11-03/sim-upgrade/public/assets

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, unlinkSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { kindOf, validate } from './assets/formats.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// 这棵检出在 <工作区>/_tmp/<task>/src/<repo>；源树在同工作区的 _tmp/ 下，所以默认按相对路径算，不写死盘符。
const WORKSPACE = resolve(ROOT, '../../../..');

const PATHS = {
  enemies: process.env.ENEMIES_JSON || join(ROOT, 'data/enemies.json'),
  manifest: process.env.ASSETS_MANIFEST || join(ROOT, 'data/assets.json'),
  public: process.env.PUBLIC_DIR || join(ROOT, 'public'),
  sources: (process.env.ENEMY_ASSET_SOURCES
    ? process.env.ENEMY_ASSET_SOURCES.split(delimiter)
    : [
      join(WORKSPACE, '_tmp/roguelike-impl-2026-11-03/build/public/assets'),
      join(WORKSPACE, '_tmp/zuoyeyuanche-2026-11-03/sim-upgrade/public/assets'),
    ]).map((p) => p.trim()).filter(Boolean),
};

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const VERBOSE = argv.includes('--verbose');
const JSON_OUT = argv.includes('--json');
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node tools/copy-missing-enemy-art.mjs [--dry-run] [--verbose] [--json]');
  console.log('  env: ENEMIES_JSON ASSETS_MANIFEST PUBLIC_DIR ENEMY_ASSET_SOURCES');
  process.exit(0);
}

/** 正常输出（`--json` 时只保留最后那一个 JSON）。 */
const out = JSON_OUT ? () => {} : (...a) => console.log(...a);

// ===== 纯函数：manifest → 文件需求 ==============================================================
const ASSETS_PREFIX = '/assets/';

/** manifest 的 site-absolute 路径 → assets 根下的相对路径（`/assets/enemy/icon/x.png` → `enemy/icon/x.png`）。 */
export function manifestRel(p) {
  const s = String(p || '').replace(/\\/g, '/');
  const at = s.indexOf(ASSETS_PREFIX);
  return (at >= 0 ? s.slice(at + ASSETS_PREFIX.length) : s.replace(/^\/+/, ''));
}

/** `spineLocal.group` + 文件名 → assets 根下的相对路径（`spine/enemy/<id>` + `<id>.skel`）。 */
function localRel(group, name) {
  const g = String(group || '').replace(/\\/g, '/').replace(/^\/+/, '').replace(/\/+$/, '');
  return g ? `${g}/${String(name).replace(/^\/+/, '')}` : String(name).replace(/^\/+/, '');
}

/** `spineLocal` 三个字段展开成相对路径（顺序：skel / atlas / 贴图）。 */
function spineLocalRels(local) {
  if (!local) return [];
  return [local.skel, local.atlas, ...(local.textures || [])]
    .filter(Boolean)
    .map((n) => localRel(local.group, n));
}

/**
 * 一个 key 的文件需求。
 * required = 渲染真正要用的（icon + 主 spine；没有 `spine` 时退到 `spineLocal`）。
 * optional = 有 `spine` 时 `spineLocal` 的历史本地副本（别名条目指向基座，自己那份源树常常没有）。
 * @param {object} entry data/assets.json 的 enemies[key]
 * @returns {{ required: string[], optional: string[] }} assets 根下的相对路径
 */
export function requirementsOf(entry) {
  const required = [];
  const optional = [];
  if (!entry || typeof entry !== 'object') return { required, optional };
  if (entry.icon) required.push(manifestRel(entry.icon));
  if (entry.spine) {
    if (entry.spine.skel) required.push(manifestRel(entry.spine.skel));
    if (entry.spine.atlas) required.push(manifestRel(entry.spine.atlas));
    for (const t of entry.spine.textures || []) required.push(manifestRel(t));
    optional.push(...spineLocalRels(entry.spineLocal));
  } else {
    required.push(...spineLocalRels(entry.spineLocal));
  }
  const clean = (list) => [...new Set(list)].filter(Boolean);
  return { required: clean(required), optional: clean(optional) };
}

/** 相对路径不能跑出 assets 根（manifest 里全是正常路径，这里只做防御）。 */
function isSafeRel(rel) {
  return !!rel && !rel.startsWith('/') && !/^[a-z]:/i.test(rel) && !rel.split('/').includes('..');
}

/**
 * 逐 key 汇总：`files` 是「文件 → 引用它的 key」（同一文件被多条别名共用时只处理一次），`byKey` 是 key → required。
 * @param {string[]} enemyKeys data/enemies.json 的 key（475）
 * @param {object} enemiesManifest data/assets.json 的 enemies 对象
 */
export function buildPlan(enemyKeys, enemiesManifest) {
  const files = new Map(); // rel -> { rel, keys: Set<string>, optional: boolean }
  const byKey = new Map(); // key -> rel[]
  const noEntry = [];
  const noSpine = [];
  const aliasKeys = [];
  const unsafe = [];
  const add = (rel, key, optional) => {
    if (!isSafeRel(rel)) {
      unsafe.push(`${key}: ${rel}`);
      return;
    }
    const rec = files.get(rel) || { rel, keys: new Set(), optional: true };
    rec.keys.add(key);
    if (!optional) rec.optional = false;
    files.set(rel, rec);
  };
  for (const key of enemyKeys) {
    const entry = enemiesManifest[key];
    if (!entry || typeof entry !== 'object') {
      noEntry.push(key);
      continue;
    }
    if (entry.spineAliasOf) aliasKeys.push(key);
    if (!entry.spine && !entry.spineLocal) noSpine.push(key);
    const { required, optional } = requirementsOf(entry);
    byKey.set(key, required);
    for (const rel of required) add(rel, key, false);
    for (const rel of optional) add(rel, key, true);
  }
  return { files, byKey, noEntry, noSpine, aliasKeys, unsafe };
}

// ===== 命令式外壳：读盘 / 拷贝 / 校验 ===========================================================
/** 文件字节数；不存在或不是文件 → 0（等价于「没落盘」）。 */
function bytesOf(p) {
  try {
    const st = statSync(p);
    return st.isFile() ? st.size : 0;
  } catch {
    return 0;
  }
}

/**
 * 复制一个文件到 public/assets 并后校验；校验不过就删掉刚写的那个（不留半件）。
 * @param {string} rel assets 根下的相对路径
 * @param {string[]} sources 源树 assets 根，按顺序取第一个有该文件的
 * @returns {{ status: 'copied'|'no-source'|'failed', bytes?: number, reason?: string, src?: string }}
 */
function copyOne(rel, sources) {
  const dest = join(PATHS.public, 'assets', rel);
  const src = sources.map((s) => join(s, rel)).find((p) => bytesOf(p) > 0) || null;
  if (!src) return { status: 'no-source' };
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
  const buf = readFileSync(dest);
  const kind = kindOf(rel);
  const head8 = buf.subarray(0, 8);
  const ok = buf.length > 0 && validate(kind, buf) && (kind !== 'skel' || head8.some((b) => b !== 0));
  if (!ok) {
    try {
      unlinkSync(dest);
    } catch {
      // 删不掉就留在 failed 里，绝不静默当成功
    }
    return { status: 'failed', reason: `校验失败（${kind}，${buf.length} B）`, src };
  }
  return { status: 'copied', bytes: buf.length, src };
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function listOut(title, rows, limit = 20) {
  if (!rows.length) return;
  out(`${title}（${rows.length}）：`);
  for (const row of rows.slice(0, limit)) out(`  ${row}`);
  if (rows.length > limit) out(`  … 另有 ${rows.length - limit} 个`);
}

// ===== run ======================================================================================
const enemies = readJson(PATHS.enemies);
const manifestRoot = readJson(PATHS.manifest);
if (!manifestRoot.enemies || typeof manifestRoot.enemies !== 'object' || Array.isArray(manifestRoot.enemies)) {
  console.error(`error: ${PATHS.manifest} has no "enemies" object`);
  process.exit(1);
}

const sources = [];
for (const s of PATHS.sources) {
  if (existsSync(s)) sources.push(s);
  else console.error(`warn: asset source not found, skipped: ${s}`);
}
if (!sources.length) {
  console.error('error: no asset source left (set ENEMY_ASSET_SOURCES to a directory holding enemy/ and spine/)');
  process.exit(1);
}

const plan = buildPlan(Object.keys(enemies), manifestRoot.enemies);
const assetsRoot = join(PATHS.public, 'assets');

if (!JSON_OUT) {
  out(`源树（按顺序）：\n${sources.map((s) => `  ${s}`).join('\n')}`);
  out(`目标：${assetsRoot}`);
  const optionalFiles = [...plan.files.values()].filter((rec) => rec.optional).length;
  out(`计划：${plan.files.size} 个不重复文件（${plan.byKey.size} 个 key；其中 spineLocal 历史副本 ${optionalFiles} 个）${DRY_RUN ? '；dry-run 不写盘' : ''}`);
}

const stats = { copied: 0, bytes: 0, skipped: 0, failed: [], noSource: [], optionalCopied: 0, optionalNoSource: [] };
const byKind = new Map();
for (const rec of plan.files.values()) {
  const dest = join(assetsRoot, rec.rel);
  const present = bytesOf(dest) > 0;
  if (rec.optional) {
    // 历史本地副本：有就补，源树没有不算缺失
    if (present) continue;
    const res = DRY_RUN ? { status: sources.some((s) => bytesOf(join(s, rec.rel)) > 0) ? 'copied' : 'no-source' } : copyOne(rec.rel, sources);
    if (res.status === 'copied') stats.optionalCopied++;
    else if (res.status === 'no-source') stats.optionalNoSource.push(rec.rel);
    else if (res.status === 'failed') stats.failed.push(`${rec.rel}（${res.reason}）`);
    continue;
  }
  if (present) {
    stats.skipped++;
    continue;
  }
  const res = DRY_RUN
    ? (() => {
      const src = sources.map((s) => join(s, rec.rel)).find((p) => bytesOf(p) > 0);
      return src ? { status: 'copied', bytes: bytesOf(src) } : { status: 'no-source' };
    })()
    : copyOne(rec.rel, sources);
  if (res.status === 'copied') {
    stats.copied++;
    stats.bytes += res.bytes || 0;
    const kind = kindOf(rec.rel);
    byKind.set(kind, (byKind.get(kind) || 0) + 1);
    if (VERBOSE) out(`  copied ${rec.rel}${res.bytes ? ` (${res.bytes} B)` : ''}`);
  } else if (res.status === 'no-source') {
    stats.noSource.push(rec.rel);
  } else {
    stats.failed.push(`${rec.rel}（${res.reason}）`);
  }
}

// 仍缺的 key：run 之后逐条回读磁盘（dry-run 时看「源树也没有」），不看中途计数
const stillMissing = [];
for (const [key, rels] of plan.byKey) {
  const missing = rels.filter((rel) => {
    if (bytesOf(join(assetsRoot, rel)) > 0) return false;
    if (!DRY_RUN) return true;
    return !sources.some((s) => bytesOf(join(s, rel)) > 0);
  });
  if (missing.length) stillMissing.push(`${key}: 缺 ${missing.length} 件（${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}）`);
}

const summary = {
  sources,
  assetsRoot,
  dryRun: DRY_RUN,
  plannedFiles: plan.files.size,
  plannedKeys: plan.byKey.size,
  copied: stats.copied,
  bytes: stats.bytes,
  skipped: stats.skipped,
  failed: stats.failed,
  noSource: stats.noSource,
  stillMissing,
  optionalCopied: stats.optionalCopied,
  optionalNoSource: stats.optionalNoSource,
  noEntry: plan.noEntry,
  noSpine: plan.noSpine,
  aliasKeys: plan.aliasKeys.length,
};

if (JSON_OUT) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  out(`${DRY_RUN ? '[dry-run] ' : ''}本轮复制 ${stats.copied} 个文件 / 总字节 ${stats.bytes} / 跳过 ${stats.skipped} / 失败 ${stats.failed.length} / 仍缺 ${stillMissing.length} 个 key`);
  if (byKind.size) out(`  按类型：${[...byKind].map(([k, n]) => `${k} ${n}`).join(' / ')}`);
  listOut('失败', stats.failed);
  listOut('仍缺 key', stillMissing);
  listOut('源树也没有的文件', stats.noSource);
  listOut('spineLocal 历史副本源树也没有（不影响渲染）', stats.optionalNoSource);
  if (stats.optionalCopied) out(`spineLocal 历史副本补齐：${stats.optionalCopied} 个文件`);
  if (plan.noEntry.length) out(`manifest 里没有条目（跳过）：${plan.noEntry.length} 个 key`);
  if (plan.noSpine.length) out(`manifest 未声明 spine（无可补，只有 icon）：${plan.noSpine.join(', ')}`);
  if (plan.unsafe.length) listOut('拒绝的非法路径', plan.unsafe);
  if (plan.aliasKeys) out(`别名条目 ${plan.aliasKeys.length} 个（spine 指向基座，基座补齐后自动修复）`);
}

process.exitCode = stats.failed.length || stillMissing.length || plan.unsafe.length ? 1 : 0;
