#!/usr/bin/env node
// Top up the enemy art data/assets.json lacked: the icon and the Spine model of 55
// enemy ids, then register them. Two sources, both already used by tools/fetch-assets.mjs:
//
//   A. 49 ids from the public dumps (the same two repos tools/assets/sources.mjs names)
//        icon : https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/enemy/<id>.png
//        model: https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models_enemies/<dir>/<stem>.{skel,atlas,png}
//        <dir> = <id> without the `enemy_` prefix, <stem> = <id> (checked against Ark-Models'
//        models_data.json: every one of the 49 has its own folder, stem == id)
//      2 of them are aliases of a base id: data/enemies.json spells their `spine` as the base's
//      id (enemy_1428_lrsoul_a → enemy_1428_lrsoul, enemy_2094_skzamb_2 → enemy_2094_skzamb),
//      so they take the base's icon and model and carry `spineAliasOf` (docs/ASSETS.md "Enemy
//      aliases"); they download nothing of their own.
//
//   B. 4 ids whose entry had an icon but no model, from our own CDN repo
//      (jingjiangze/Stronghold-Protocol-CDN, branch assets-raw, assets/enemy/...): the branch
//      holds them better than the dumps do. Read through the GitHub contents API (`gh api`,
//      base64) with a Git Data API blob fallback for files the contents API refuses, so no
//      second copy of the credential is needed and no token is printed.
//
// Layout (the pipeline's own; data/assets.json points at it):
//   public/assets/enemy/icon/<id>.png
//   public/assets/spine/enemy/<id>/<id>.{skel,atlas,png}
// A page name an atlas spells differently is rewritten to <id>.png (normalizeAtlas renamePage),
// so the folder always holds exactly <id>.skel / <id>.atlas / <id>.png — the `textures` of the
// manifest entry follow the normalized atlas.
//
// Downloaded bytes are checked before anything is written (HTTP 200, size > 0, skel header not
// empty, atlas with a page-image line, PNG magic 89 50 4E 47 + IEND); an already present file
// that passes is never re-downloaded, an entry already in the manifest is never rewritten, so
// re-running is a no-op (and prints `manifest unchanged`). Atlases are normalized the way
// tools/assets/spine.mjs does it (`size: W,H`, `pma: true`), skeletons parsed with
// tools/assets/skel.mjs, animation roles resolved with tools/assets/anim-roles.mjs and the
// PREFAB_SPINE_ROLES fixes applied — the entry is the shape processModels writes otherwise.
//
// The 16 no-art ids (no icon, no model upstream: absent from both dumps and from Ark-Models'
// models_data.json) were removed from the monster table on 2026-11-05 (owner decision); they are
// only recorded as a comment now, nothing is skipped.
//
// stats: the derived counts are countStats()' (tools/fetch-assets.mjs:332) recomputed from the
// manifest; files/bytes are that function's two *inputs* — the file set resolveTemplate resolved
// on a complete public/assets, which a checkout like this one is not (measured on 2026-11-05:
// 11331 of the 20258 files the manifest references are present, the rest belongs to the chars /
// voice trees no run here downloaded), so they are advanced by the files this run adds, as the
// sibling tools/fetch-stats-assets.mjs:26-27 does. hash is contentHash()
// (tools/assets/manifest.mjs:174) of the manifest without its version/hash/generator/stats, as
// fetch-assets.mjs:542 computes it.
//
// Usage: node tools/fetch-missing-enemy-art.mjs

import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isCompletePng, isAtlasText, isSkelBinary, pngSize } from './assets/formats.mjs';
import { atlasInfo, normalizeAtlas } from './assets/atlas.mjs';
import { parseSkel } from './assets/skel.mjs';
import { resolveRoles } from './assets/anim-roles.mjs';
import { applyRoleFix, PREFAB_SPINE_ROLES } from './assets/spine.mjs';
import { contentHash } from './assets/manifest.mjs';
import { assetUrl, safeName, mirrorUrl } from './assets/sources.mjs';
import { guardDefaultFetch, restartForEnvProxy } from './assets/env-proxy.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const ASSETS = join(ROOT, 'public', 'assets');
const MANIFEST = join(ROOT, 'data', 'assets.json');

const ICON_URL = (id) => `https://raw.githubusercontent.com/yuanyan3060/ArknightsGameResource/main/enemy/${id}.png`;
const MODEL_URL = (id, ext) => `https://raw.githubusercontent.com/isHarryh/Ark-Models/main/models_enemies/${id.replace(/^enemy_/, '')}/${id}.${ext}`;
const CDN_REPO = 'jingjiangze/Stronghold-Protocol-CDN';
const CDN_REF = 'assets-raw';

/** Milliseconds between two requests (one per request, retries included). */
const REQUEST_GAP = 320;
/** Attempts per URL before moving to the mirror. */
const ATTEMPTS = 3;
/** Top-level manifest fields that describe the build, not assets (tools/assets/manifest.mjs BUILD_FIELDS). */
const BUILD_FIELDS = new Set(['version', 'hash', 'generator', 'stats']);

/**
 * The 49 ids with their own model in Ark-Models (source: data/enemies.json `spine` == id, and
 * every one of them present in Ark-Models' models_data.json `data[<id without enemy_>].assetList`
 * with the stem `<id>`).
 */
export const DIRECT_IDS = Object.freeze([
  'enemy_10003_trwlpl', 'enemy_1016_diaman', 'enemy_1027_mob', 'enemy_1084_sotidm', 'enemy_1085_sotiwz',
  'enemy_1090_mdsnpr_2', 'enemy_1128_spmage_2', 'enemy_1133_harchn', 'enemy_1134_diamd', 'enemy_1136_redace',
  'enemy_1141_merbow', 'enemy_1143_merrpg', 'enemy_1144_merlgd', 'enemy_1223_dmech', 'enemy_1238_ltmob',
  'enemy_1238_ltmob_2', 'enemy_1240_ltgint_2', 'enemy_1242_ltsmag', 'enemy_1243_ltswar', 'enemy_1263_durbus',
  'enemy_1285_sgwlf', 'enemy_1287_ducrb', 'enemy_1287_ducrb_2', 'enemy_1291_dusrch', 'enemy_1293_duswrd_3',
  'enemy_1302_ymtro', 'enemy_1306_mhtrtl_2', 'enemy_1309_mhboar_2', 'enemy_1311_mhkryk_2', 'enemy_1313_wdfmr',
  'enemy_1317_wdexg', 'enemy_1317_wdexg_2', 'enemy_1318_wdsmgc', 'enemy_1352_eslime', 'enemy_1384_winfrz',
  'enemy_1424_lrboom', 'enemy_1428_lrsoul', 'enemy_1429_lrwzrd', 'enemy_1429_lrwzrd_2', 'enemy_1431_lrmzrd_2',
  'enemy_2066_skzlcp', 'enemy_2067_skzcy', 'enemy_2069_skzbox', 'enemy_2070_skzfbx', 'enemy_2090_skzjbc',
  'enemy_2091_skzgds', 'enemy_2094_skzamb', 'enemy_3004_speople', 'enemy_3005_lpeopl',
]);

/**
 * The enemy ids data/enemies.json spells as another id (its `spine` field): alias id → base id.
 * Their manifest entry takes the base's icon and model and the `spineAliasOf` marker.
 */
export const ALIASES = Object.freeze({
  enemy_1428_lrsoul_a: 'enemy_1428_lrsoul',
  enemy_2094_skzamb_2: 'enemy_2094_skzamb',
});

/** The 4 ids whose model is on our own CDN branch (assets-raw) rather than in the dumps. */
export const CDN_IDS = Object.freeze([
  'enemy_1047_sagent_2', 'enemy_1049_eagent_2', 'enemy_1249_lysdb', 'enemy_1275_dwlock',
]);

// No-art ids, removed 2026-11-05 (owner decision): these 16 keys have no icon and no model upstream
// (absent from both dumps and from Ark-Models' models_data.json), so this tool never attempted them
// and only listed them. They are now removed from the monster table (data/enemies.json and every
// roster / faction list): nothing is left to skip, and they must not be re-added to the data.
// Kept as a record of the fact only — no constant, no skip set.
//   enemy_2086_skzdwx, enemy_2087_skzdwy,
//   enemy_2095_skzamf_04, enemy_2095_skzamf_13, enemy_2095_skzamf_16, enemy_2095_skzamf_17,
//   enemy_2095_skzamf_18, enemy_2095_skzamf_19, enemy_2095_skzamf_20,
//   enemy_2096_skzamj_01, enemy_2096_skzamj_02, enemy_2096_skzamj_03, enemy_2096_skzamj_04,
//   enemy_2096_skzamj_05, enemy_2096_skzamj_06, enemy_2096_skzamj_07

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(m);
const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;

/**
 * Why a downloaded buffer is unusable, or null when it is fine. The four format checks
 * (HTTP 200 + size > 0 are the caller's), plus the format checks tools/assets/formats.mjs uses.
 * @param {'png'|'skel'|'atlas'} kind
 * @param {Buffer} buf
 * @returns {string|null}
 */
export function artifactProblem(kind, buf) {
  if (!buf || !buf.length) return 'empty body';
  if (kind === 'png') {
    if (buf.length < 8 || buf[0] !== 0x89 || buf[1] !== 0x50 || buf[2] !== 0x4e || buf[3] !== 0x47) return 'not a PNG (89 50 4E 47 missing)';
    if (!isCompletePng(buf)) return `incomplete PNG (${buf.length} B, no IEND)`;
    return null;
  }
  if (kind === 'skel') {
    if (buf.length < 8) return `skeleton shorter than 8 bytes (${buf.length} B)`;
    if (!buf.subarray(0, 8).some((b) => b !== 0)) return 'skeleton header is 8 zero bytes';
    if (!isSkelBinary(buf)) return 'skeleton looks like an error page';
    return null;
  }
  if (kind === 'atlas') {
    if (!isAtlasText(buf)) return 'atlas without a page-image line (.png)';
    return null;
  }
  return null;
}

/** The file's current bytes when it is present and passes artifactProblem, else null. */
async function readableArtifact(path, kind) {
  try {
    const buf = await readFile(path);
    return artifactProblem(kind, buf) ? null : buf;
  } catch { return null; }
}

/**
 * GET one URL (with the jsDelivr mirror as a second source) until a validating body arrives:
 * 404/410 moves on at once, any other failure is retried ATTEMPTS times.
 * @param {string} url
 * @param {'png'|'skel'|'atlas'} kind
 * @param {typeof fetch} doFetch
 * @returns {Promise<{buf: Buffer, url: string}>}
 */
async function download(url, kind, doFetch) {
  const urls = [...new Set([url, mirrorUrl(url)].filter(Boolean))];
  const problems = [];
  for (const u of urls) {
    for (let attempt = 1; attempt <= ATTEMPTS; attempt++) {
      await sleep(REQUEST_GAP);
      let res;
      try {
        res = await doFetch(u, { headers: { 'user-agent': 'stronghold-protocol-fetch-missing-enemy-art/1.0' }, redirect: 'follow' });
      } catch (e) {
        problems.push(`${u}: ${e?.message || e}`);
        continue;
      }
      if (res.status === 404 || res.status === 410) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        problems.push(`${u}: HTTP ${res.status}`);
        break; // definitive miss on this source
      }
      if (res.status !== 200) {
        try { await res.body?.cancel(); } catch { /* ignore */ }
        problems.push(`${u}: HTTP ${res.status}`);
        continue;
      }
      const buf = Buffer.from(await res.arrayBuffer());
      const bad = artifactProblem(kind, buf);
      if (!bad) return { buf, url: u };
      problems.push(`${u}: ${bad}`);
    }
  }
  throw new Error(problems.join('; '));
}

/** `gh api <path>` parsed as JSON; throws with gh's own message. */
function ghApiJson(path) {
  const r = spawnSync('gh', ['api', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.error) throw new Error(`gh api ${path}: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`gh api ${path}: ${(r.stderr || r.stdout || '').trim() || `exit ${r.status}`}`);
  try { return JSON.parse(r.stdout); } catch (e) { throw new Error(`gh api ${path}: bad JSON (${e.message})`); }
}

/**
 * One file of the CDN branch: the contents API serves its base64 `content`, and a blob the
 * contents API answers without content (too large) is read through the Git Data API by its sha.
 * `gh` uses its own stored credential; no token passes through this process.
 * @param {string} path repo-relative path on CDN_REF
 * @returns {Buffer}
 */
export function readCdnFile(path) {
  const j = ghApiJson(`repos/${CDN_REPO}/contents/${path}?ref=${CDN_REF}`);
  const inline = typeof j?.content === 'string' ? j.content.replace(/\s+/g, '') : '';
  if (inline) return Buffer.from(inline, 'base64');
  if (!j?.sha) throw new Error(`CDN ${path}: no content and no blob sha (size ${j?.size})`);
  const blob = ghApiJson(`repos/${CDN_REPO}/git/blobs/${j.sha}`);
  const b64 = typeof blob?.content === 'string' ? blob.content.replace(/\s+/g, '') : '';
  if (!b64 || (blob.encoding && blob.encoding !== 'base64')) throw new Error(`CDN ${path}: blob ${j.sha} not base64`);
  return Buffer.from(b64, 'base64');
}

/**
 * Write a file atomically (temp + rename), creating its folder.
 * @param {string} path absolute
 * @param {Buffer|string} data
 */
async function writeAtomic(path, data) {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.part${process.pid}`;
  await writeFile(tmp, data);
  await rename(tmp, path);
}

/**
 * The Spine entry of one model folder, built like tools/assets/spine.mjs processModels does: the
 * atlas is normalized (`size:`, `pma: true`, page names rewritten to the files on disk), the
 * skeleton parsed for its clips / events / hits / bounds, and the animation roles resolved for an
 * enemy (skill index 0 + its numbered skill clips) with PREFAB_SPINE_ROLES applied.
 * @param {string} id enemy id
 * @param {string} dirRel model folder relative to public/assets ('spine/enemy/<id>')
 * @param {string} baseUrl URL folder the model's extra atlas pages come from ('' = no extra pages)
 * @param {typeof fetch} doFetch
 * @param {(msg:string)=>void} note problem sink
 * @returns {Promise<any|null>} the manifest Spine entry, or null when the model cannot be read
 */
async function spineEntryFromDisk(id, dirRel, baseUrl, doFetch, note) {
  const dirAbs = join(ASSETS, dirRel);
  const skelAbs = join(dirAbs, `${id}.skel`);
  const atlasAbs = join(dirAbs, `${id}.atlas`);
  const pngAbs = join(dirAbs, `${id}.png`);
  if (!existsSync(skelAbs) || !existsSync(atlasAbs) || !existsSync(pngAbs)) {
    note(`${id}: skel/atlas/png incomplete on disk`);
    return null;
  }
  const text0 = await readFile(atlasAbs, 'utf8');
  const info0 = atlasInfo(text0);
  if (!info0.pages.length) { note(`${id}: atlas without pages`); return null; }
  // The first page is the <id>.png downloaded beside the atlas; a further page an atlas names is
  // fetched (dumps keep every page in the model folder) under its sanitized name.
  for (const page of info0.pages.slice(1)) {
    const rel = safeName(page);
    const abs = join(dirAbs, rel);
    if (await readableArtifact(abs, 'png')) continue;
    if (!baseUrl) { note(`${id}: extra atlas page ${page} not on disk`); return null; }
    try {
      const r = await download(baseUrl + encodeURIComponent(page), 'png', doFetch);
      await writeAtomic(abs, r.buf);
      note(`${id}: extra atlas page ${page} downloaded`);
    } catch (e) {
      note(`${id}: extra atlas page ${page}: ${e.message}`);
      return null;
    }
  }
  const sizes = new Map();
  for (const [i, page] of info0.pages.entries()) {
    const abs = i === 0 ? pngAbs : join(dirAbs, safeName(page));
    const sz = pngSize(await readFile(abs));
    if (!sz) { note(`${id}: invalid page ${page}`); return null; }
    sizes.set(page, sz);
  }
  const renamePage = (p) => (p === info0.pages[0] ? `${id}.png` : safeName(p));
  const norm = normalizeAtlas(text0, { pageSize: (p) => sizes.get(p) || null, pma: true, renamePage });
  if (norm.missingSize.length) { note(`${id}: cannot size pages ${norm.missingSize.join(',')}`); return null; }
  if (norm.changed) await writeAtomic(atlasAbs, norm.text);
  const info = atlasInfo(norm.text);
  let sk;
  try {
    sk = parseSkel(await readFile(skelAbs), info.regions);
  } catch (e) {
    note(`${id}: skel parse failed (${e.message})`);
    return null;
  }
  if (!sk.animations.length) { note(`${id}: skeleton has no animations`); return null; }
  if (sk.missingRegions?.length) note(`${id}: ${sk.missingRegions.length} attachment(s) not in atlas (e.g. ${sk.missingRegions[0]})`);
  const resolved = resolveRoles(sk.animations, { skillIndices: [0], numberedSkills: true, durations: sk.durations });
  const fixed = applyRoleFix(resolved, PREFAB_SPINE_ROLES[id], sk.durations);
  if (fixed.missing.length) note(`${id}: role fix not applied (clip missing) for ${fixed.missing.join(', ')}`);
  return {
    skel: assetUrl(`${dirRel}/${id}.skel`),
    atlas: assetUrl(`${dirRel}/${id}.atlas`),
    textures: info.pages.map((p) => assetUrl(`${dirRel}/${p === info0.pages[0] ? `${id}.png` : safeName(p)}`)),
    pma: true,
    anims: fixed.roles,
    animations: sk.durations,
    events: sk.events,
    hits: sk.hits,
    bounds: sk.bounds,
  };
}

/**
 * Copy of countStats() (tools/fetch-assets.mjs:332): the per-kind counts of a manifest plus the
 * caller's file count / byte total (that function's `files` / `bytes`, which come from the resolve
 * step and are therefore passed in). Kept verbatim so a change there shows up as a diff here.
 * @param {any} m the manifest body (without version/hash/generator/stats)
 * @param {number} files
 * @param {number} bytes
 */
export function countStats(m, files, bytes) {
  const vals = (o) => Object.values(o || {});
  const spines = new Set();
  for (const c of vals(m.chars)) for (const s of vals(c.spine)) spines.add(s.skel);
  for (const e of vals(m.enemies)) if (e.spine) spines.add(e.spine.skel);
  for (const t of vals(m.tokens)) if (t.spine) spines.add(t.spine.skel);
  return {
    files,
    bytes,
    chars: Object.keys(m.chars || {}).length,
    charsWithBack: vals(m.chars).filter((c) => c.spine?.back).length,
    enemies: Object.keys(m.enemies || {}).length,
    enemiesWithSpine: vals(m.enemies).filter((e) => e.spine).length,
    tokens: Object.keys(m.tokens || {}).length,
    tokensWithSpine: vals(m.tokens).filter((t) => t.spine).length,
    spineModels: spines.size,
    bonds: Object.keys(m.bonds || {}).length,
    items: Object.keys(m.items || {}).length,
    bands: Object.keys(m.bands || {}).length,
    skills: Object.keys(m.skills || {}).length,
    modules: Object.keys(m.modules || {}).length,
    ui: Object.keys(m.ui || {}).length,
    sfxUnits: Object.keys(m.audio?.sfx?.units || {}).length,
    voiceChars: Object.keys(m.audio?.voice || {}).length,
    voiceJpChars: Object.keys(m.audio?.voiceJp || {}).length,
    voiceEnChars: Object.keys(m.audio?.voiceEn || {}).length,
    voiceKrChars: Object.keys(m.audio?.voiceKr || {}).length,
    voiceNativeChars: Object.keys(m.audio?.voiceNative || {}).length,
  };
}

/** Every '/assets/...' string of a JSON value as a path relative to public/assets. */
export function referencedFiles(value, out = new Set()) {
  if (typeof value === 'string') {
    if (value.startsWith('/assets/')) out.add(value.slice('/assets/'.length));
  } else if (Array.isArray(value)) {
    for (const v of value) referencedFiles(v, out);
  } else if (value && typeof value === 'object') {
    for (const v of Object.values(value)) referencedFiles(v, out);
  }
  return out;
}

async function main() {
  const doFetch = guardDefaultFetch(globalThis.fetch);
  const t0 = Date.now();
  log(`[art] root ${ROOT}`);

  const raw = await readFile(MANIFEST, 'utf8');
  const manifest = JSON.parse(raw);
  const before = referencedFiles(manifest);
  const stats0 = { ...(manifest.stats || {}) };
  const enemies = manifest.enemies || (manifest.enemies = {});

  const tally = { ok: 0, skip: 0, failed: 0, bytes: 0 };
  const failures = [];
  const failedIds = new Set();
  const notes = [];
  const downloaded = new Set();
  const managed = new Set(); // every rel path the 55 entries reference

  /**
   * Download one artifact unless a file that passes validation is already on disk.
   * `source` is `{ url }` (a dump URL, jsDelivr as its mirror) or `{ cdn: <path on CDN_REF> }`.
   */
  const ensure = async (abs, rel, kind, source) => {
    managed.add(rel);
    if (await readableArtifact(abs, kind)) { tally.skip++; return true; }
    try {
      let bytes;
      if (source.cdn) {
        await sleep(REQUEST_GAP);
        const got = readCdnFile(source.cdn);
        const bad = artifactProblem(kind, got);
        if (bad) throw new Error(`CDN ${source.cdn}: ${bad}`);
        await writeAtomic(abs, got);
        bytes = got.length;
      } else {
        const got = await download(source.url, kind, doFetch);
        await writeAtomic(abs, got.buf);
        bytes = got.buf.length;
      }
      downloaded.add(rel);
      tally.ok++;
      tally.bytes += bytes;
      return true;
    } catch (e) {
      tally.failed++;
      failures.push(`${rel}: ${e.message}`);
      const id = /^(?:enemy\/icon|spine\/enemy)\/(enemy_\d+_[a-z0-9_]+)/i.exec(rel);
      if (id) failedIds.add(id[1]);
      return false;
    }
  };

  /** Count an id whose entry could not be built (the reason goes to the failure list). */
  const noteFailure = (id, message) => {
    tally.failed++;
    failedIds.add(id);
    failures.push(message);
  };

  // --- A: the 49 dump ids (the 2 aliases reuse their base's files, below) --------------
  for (const id of DIRECT_IDS) {
    const dirRel = `spine/enemy/${id}`;
    const modelBase = MODEL_URL(id, 'png');
    const baseUrl = modelBase.slice(0, modelBase.lastIndexOf('/') + 1);
    const iconOk = await ensure(join(ASSETS, 'enemy', 'icon', `${id}.png`), `enemy/icon/${id}.png`, 'png', { url: ICON_URL(id) });
    for (const ext of ['skel', 'atlas', 'png']) {
      await ensure(join(ASSETS, dirRel, `${id}.${ext}`), `${dirRel}/${id}.${ext}`, ext, { url: MODEL_URL(id, ext) });
    }
    const entry = await spineEntryFromDisk(id, dirRel, baseUrl, doFetch, (m) => notes.push(m));
    if (!entry) { noteFailure(id, `${id}: spine entry not built`); continue; }
    const prev = enemies[id] || {};
    enemies[id] = {
      ...(iconOk ? { icon: assetUrl(`enemy/icon/${id}.png`) } : prev.icon ? { icon: prev.icon } : {}),
      spine: entry,
      ...(prev.spineLocal ? { spineLocal: prev.spineLocal } : {}),
    };
  }

  // --- B: the 4 CDN ids (their icon entries exist already; the icon file may not) --------
  for (const id of CDN_IDS) {
    const dirRel = `spine/enemy/${id}`;
    await ensure(join(ASSETS, 'enemy', 'icon', `${id}.png`), `enemy/icon/${id}.png`, 'png', { cdn: `assets/enemy/icon/${id}.png` });
    for (const ext of ['skel', 'atlas', 'png']) {
      await ensure(join(ASSETS, dirRel, `${id}.${ext}`), `${dirRel}/${id}.${ext}`, ext, { cdn: `assets/spine/enemy/${id}/${id}.${ext}` });
    }
    const entry = await spineEntryFromDisk(id, dirRel, '', doFetch, (m) => notes.push(m));
    if (!entry) { noteFailure(id, `${id}: spine entry not built`); continue; }
    const prev = enemies[id] || {};
    enemies[id] = { ...prev, icon: assetUrl(`enemy/icon/${id}.png`), spine: entry };
  }

  // --- the 2 aliases: the base's icon and model, `spineAliasOf` naming the base -----------
  for (const [alias, base] of Object.entries(ALIASES)) {
    const src = enemies[base];
    if (!src?.spine) { noteFailure(alias, `${alias}: base ${base} has no spine entry`); continue; }
    const prev = enemies[alias] || {};
    enemies[alias] = {
      icon: assetUrl(`enemy/icon/${base}.png`),
      spineAliasOf: base,
      spine: JSON.parse(JSON.stringify(src.spine)),
      ...(prev.spineLocal ? { spineLocal: prev.spineLocal } : {}),
    };
    managed.add(`enemy/icon/${base}.png`);
    for (const rel of [src.spine.skel, src.spine.atlas, ...(src.spine.textures || [])]) managed.add(rel.replace(/^\/assets\//, ''));
  }

  // --- stats / hash ----------------------------------------------------------------------
  // files/bytes are countStats()' inputs from a complete resolve; this checkout has 8931 of the
  // manifest's files absent, so count what this run adds: a file it downloaded (it was missing)
  // or one the manifest did not reference before (the run failed after downloading it once).
  let addedFiles = 0;
  let addedBytes = 0;
  for (const rel of managed) {
    if (before.has(rel) && !downloaded.has(rel)) continue;
    const abs = join(ASSETS, rel);
    if (!existsSync(abs)) continue;
    const st = statSync(abs);
    if (!st.isFile()) continue;
    addedFiles++;
    addedBytes += st.size;
  }
  const stats = countStats(manifest, (stats0.files || 0) + addedFiles, (stats0.bytes || 0) + addedBytes);
  // contentHash() hashes the manifest without its four build fields (fetch-assets.mjs:542); the key
  // order of the file stays as it is (version, hash, generator, stats, then the asset maps).
  const body = {};
  for (const [k, v] of Object.entries(manifest)) if (!BUILD_FIELDS.has(k)) body[k] = v;
  const next = {};
  for (const [k, v] of Object.entries(manifest)) {
    if (k === 'hash') next.hash = contentHash(body);
    else if (k === 'stats') next.stats = stats;
    else next[k] = v;
  }
  const serialized = `${JSON.stringify(next)}\n`;
  if (serialized === raw) {
    log('[art] manifest unchanged: every entry and every count is where it was');
  } else {
    await writeAtomic(MANIFEST, serialized);
    log(`[art] manifest written: ${MANIFEST}`);
  }

  // --- report ----------------------------------------------------------------------------
  log('');
  log('=== fetch-missing-enemy-art summary ===');
  log(`downloaded ${tally.ok} file(s), ${mb(tally.bytes)} · skipped ${tally.skip} (already on disk, valid) · failed ${tally.failed}`);
  log(`entries: ${DIRECT_IDS.length + CDN_IDS.length + Object.keys(ALIASES).length} ids managed · enemies ${Object.keys(enemies).length} in the manifest`);
  log(`stats: files ${stats0.files} → ${stats.files} (+${addedFiles}, ${mb(addedBytes)}) · bytes ${stats0.bytes} → ${stats.bytes} (${mb(stats.bytes)})`);
  log(`       enemies ${stats0.enemies} → ${stats.enemies} · enemiesWithSpine ${stats0.enemiesWithSpine} → ${stats.enemiesWithSpine} · spineModels ${stats0.spineModels} → ${stats.spineModels}`);
  log(`hash: ${manifest.hash} → ${next.hash}`);
  if (notes.length) { log(`notes (${notes.length}):`); for (const n of notes) log(`  ${n}`); }
  if (failures.length) {
    log(`failed (${failures.length}, ${failedIds.size} id(s)):`);
    for (const f of failures) log(`  ${f}`);
  }
  log(`${((Date.now() - t0) / 1000).toFixed(1)} s`);
  return failedIds.size ? 1 : 0;
}

// run only as a script (tests import the lists / countStats)
const invoked = (() => { try { return pathToFileURL(process.argv[1] || '').href; } catch { return null; } })();
if (invoked === import.meta.url && !restartForEnvProxy()) {
  main().then((code) => { process.exitCode = code; }, (e) => {
    console.error(`[art] FAILED: ${process.env.DEBUG ? e?.stack || e : e?.message || e}`);
    process.exitCode = 1;
  });
}
