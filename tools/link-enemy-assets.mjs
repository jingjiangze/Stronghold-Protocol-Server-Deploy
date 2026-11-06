#!/usr/bin/env node
// Register the assets of the enemies data/enemies.json gained from the roguelike levels in data/assets.json.
// tools/build-enemies-merged.mjs appended 242 records to data/enemies.json (each carrying `source: 'db' | 'override'`);
// the ones whose icon / Spine model a dump really carries need an `enemies[key]` entry, or the client draws its
// placeholder. docs/ASSETS.md "Manifest schema": only entries whose files exist on disk are emitted — so a key with no
// file in any asset tree is left out and listed, never written with an invented path.
//
// What an entry is, exactly as tools/fetch-assets.mjs writes it (icon + Spine; the Spine part is the localSpineMeta /
// processModels shape):
//   { icon?, spine?: { skel, atlas, textures[], pma, anims, animations, events, hits, bounds } }
// The Spine metadata is read from the model on disk with the repo's own parsers (tools/assets/skel.mjs, atlas.mjs,
// anim-roles.mjs, spine.mjs — PREFAB_SPINE_ROLES applied like the web models), not guessed: `anims` is what the
// renderer plays (assets.js validSpine rejects a Spine entry without `anims`), `animations` the clips' durations.
//
// Write: append only. The manifest text is sliced at the closing brace of the top-level `enemies` object, the new
// entries are inserted there — every existing byte (the other top-level objects, the old enemy entries, the minified
// layout, the key order) stays as it is. The build fields version / hash / generator / stats are NOT touched (they
// describe tools/fetch-assets.mjs's run; nothing reads `stats` at runtime). The pre-write file is copied once to
// ASSETS_BACKUP. Idempotent: an enemy already in the manifest (or with no file) is skipped, so a second run adds 0.
//
// Optional preview: `--preview` copies the files of the enemies this run links into PREVIEW_ASSETS as
// `assets/enemy/icon/<file>` and `assets/spine/enemy/<key>/<file>`, so a local preview can show them without writing
// into the repo's public/assets (a junction to the shared dl-cache; docs/ASSETS.md "No game art in git").
//
// Paths (all overridable by the environment; the defaults sit where this workspace keeps the trees):
//   ENEMIES_JSON          data/enemies.json                       (default: <repo>/data/enemies.json)
//   ASSETS_MANIFEST       data/assets.json                        (default: <repo>/data/assets.json)
//   ENEMY_ASSET_SOURCES   asset trees, path.delimiter-separated   (default: the two sim-upgrade / roguelike build trees)
//   ASSETS_BACKUP         the file the pre-write manifest is copied to (default: _tmp/ai-modes-2026-11-03/backup/…)
//   PREVIEW_ASSETS        preview root for `--preview`
// Usage: node tools/link-enemy-assets.mjs [--dry-run] [--preview]
//        plain `node`, no dependency beyond the repo's own modules (pixi-spine, for the skeleton parser).

import { existsSync } from 'node:fs';
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { atlasInfo } from './assets/atlas.mjs';
import { resolveRoles } from './assets/anim-roles.mjs';
import { applyRoleFix, PREFAB_SPINE_ROLES } from './assets/spine.mjs';
import { parseSkel } from './assets/skel.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// This checkout lives at <workspace>/_tmp/<task>/src/<repo>; the asset trees sit elsewhere in the same workspace, so the
// defaults stay relative to it instead of hard-coding a drive letter.
const WORKSPACE = resolve(ROOT, '../../../..');

const warnings = [];
const warn = (m) => { warnings.push(m); console.error(`warn: ${m}`); };
const die = (m) => { console.error(`error: ${m}`); process.exit(1); };

const PATHS = {
  enemies: process.env.ENEMIES_JSON || join(ROOT, 'data/enemies.json'),
  manifest: process.env.ASSETS_MANIFEST || join(ROOT, 'data/assets.json'),
  backup: process.env.ASSETS_BACKUP || join(WORKSPACE, '_tmp/ai-modes-2026-11-03/backup/assets.orig.json'),
  preview: process.env.PREVIEW_ASSETS || '',
  sources: (process.env.ENEMY_ASSET_SOURCES
    ? process.env.ENEMY_ASSET_SOURCES.split(delimiter)
    : [
      join(WORKSPACE, '_tmp/zuoyeyuanche-2026-11-03/sim-upgrade/public/assets'),
      join(WORKSPACE, '_tmp/roguelike-impl-2026-11-03/build/public/assets'),
    ]).map((p) => p.trim()).filter(Boolean),
};

const argv = process.argv.slice(2);
const DRY_RUN = argv.includes('--dry-run');
const PREVIEW = argv.includes('--preview') || !!PATHS.preview;
if (argv.includes('--help') || argv.includes('-h')) {
  console.log('usage: node tools/link-enemy-assets.mjs [--dry-run] [--preview]');
  console.log('  paths: ENEMIES_JSON ASSETS_MANIFEST ENEMY_ASSET_SOURCES ASSETS_BACKUP PREVIEW_ASSETS');
  process.exit(0);
}

// ===== helpers ==================================================================================
const ICON_EXTS = ['.png', '.webp'];
const assetUrl = (rel) => `/assets/${rel}`;

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function isFile(path) {
  try {
    const s = await stat(path);
    return s.isFile() && s.size > 0;
  } catch { return false; }
}

/** Icon file of one enemy id in one asset tree, or null. */
async function iconAt(root, id) {
  for (const ext of ICON_EXTS) {
    const name = `${id}${ext}`;
    if (!(await isFile(join(root, 'enemy', 'icon', name)))) continue;
    return { name, file: join(root, 'enemy', 'icon', name), url: assetUrl(`enemy/icon/${name}`) };
  }
  return null;
}

/**
 * The Spine model of one enemy id in one asset tree, read and resolved the way fetch-assets.mjs emits a web model.
 * @returns {Promise<{ entry: any|null, reason: string|null, dir?: string, files?: string[] }>}
 */
async function spineAt(root, id) {
  const dir = join(root, 'spine', 'enemy', id);
  const names = await readdir(dir).catch(() => null);
  if (!names) return { entry: null, reason: 'no model folder' };
  // A .json skeleton cannot be a manifest model: assets.js validSpine accepts a .skel URL only (docs/ASSETS.md).
  if (!names.includes(`${id}.skel`)) {
    return { entry: null, reason: names.includes(`${id}.json`) ? 'only a .json skeleton (the client loads .skel)' : 'no .skel' };
  }
  if (!names.includes(`${id}.atlas`)) return { entry: null, reason: 'no .atlas' };
  const text = await readFile(join(dir, `${id}.atlas`), 'utf8');
  const info = atlasInfo(text);
  const missingPages = [];
  for (const page of info.pages) if (!(await isFile(join(dir, page)))) missingPages.push(page);
  if (!info.pages.length || missingPages.length) {
    return { entry: null, reason: `atlas page(s) missing: ${missingPages.join(', ') || '(the atlas lists none)'}` };
  }
  let sk;
  try {
    sk = parseSkel(await readFile(join(dir, `${id}.skel`)), info.regions);
  } catch (err) {
    return { entry: null, reason: `skeleton does not parse: ${err.message}` };
  }
  if (!sk.animations.length) return { entry: null, reason: 'skeleton has no animations' };
  const fixed = applyRoleFix(
    resolveRoles(sk.animations, { skillIndices: [0], numberedSkills: true, durations: sk.durations }),
    PREFAB_SPINE_ROLES[id],
    sk.durations,
  );
  const rel = `spine/enemy/${id}`;
  return {
    entry: {
      skel: assetUrl(`${rel}/${id}.skel`),
      atlas: assetUrl(`${rel}/${id}.atlas`),
      textures: info.pages.map((p) => assetUrl(`${rel}/${p}`)),
      pma: info.hasPma,
      anims: fixed.roles,
      animations: sk.durations,
      events: sk.events,
      hits: sk.hits,
      bounds: sk.bounds,
    },
    reason: fixed.missing.length ? `role fix not applied (clip missing): ${fixed.missing.join(', ')}` : null,
    dir,
    files: [`${id}.skel`, `${id}.atlas`, ...info.pages],
  };
}

/**
 * Span of a top-level object of a minified JSON text: `{ start, end }` are the braces' own indexes. The scan honours
 * strings and escapes, so a brace or a quote inside a value cannot end it early.
 */
function objectSpan(text, key) {
  const at = text.indexOf(`"${key}":{`);
  if (at < 0) die(`cannot append: the manifest has no "${key}" object`);
  const open = at + `"${key}":{`.length - 1;
  if (text[open] !== '{') die(`cannot append: "${key}" is not an object`);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return { start: open, end: i };
  }
  die(`cannot append: the "${key}" object is not closed`);
}

/** Copy `src` to `dest`, skipping a same-size file (so a re-run copies nothing). */
async function copyInto(src, dest) {
  const from = await stat(src).catch(() => null);
  if (!from) return 'missing';
  const to = await stat(dest).catch(() => null);
  if (to && to.isFile() && to.size === from.size) return 'kept';
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(src, dest);
  return 'copied';
}

// ===== read the two data files ==================================================================
const enemies = await readJson(PATHS.enemies);
const rawText = await readFile(PATHS.manifest, 'utf8');
const manifest = JSON.parse(rawText);
if (!manifest.enemies || typeof manifest.enemies !== 'object' || Array.isArray(manifest.enemies)) {
  die(`${PATHS.manifest} has no "enemies" object`);
}
if (!manifest.enemies || !Object.keys(manifest.enemies).length) warn('the manifest holds no enemy entry yet');

const sources = [];
for (const s of PATHS.sources) {
  if (existsSync(join(s, 'enemy')) || existsSync(join(s, 'spine'))) sources.push(s);
  else warn(`asset source not found, skipped: ${s}`);
}
if (!sources.length) die('no asset source left (set ENEMY_ASSET_SOURCES to a directory holding enemy/ and spine/)');

// ===== pick the keys to link ====================================================================
const rosterKeys = Object.keys(enemies).filter((k) => enemies[k] && typeof enemies[k] === 'object' && Object.hasOwn(enemies[k], 'source'));
const candidates = rosterKeys.filter((k) => !Object.hasOwn(manifest.enemies, k));
const registered = rosterKeys.length - candidates.length;

const added = [];
const noFiles = [];
// A record whose `spine` names another key is a form variant whose own files no tree carries (e.g. enemy_1012_dcross_a →
// enemy_1012_dcross). The manifest expresses "the model belongs to another enemy" as spineAliasOf (docs/ASSETS.md
// "Enemy aliases"); that is a maintainer decision about the roster, not a copy of another model's paths, so it is only
// reported here.
const aliasCandidates = [];
for (const key of candidates) {
  const rec = enemies[key];
  const reasons = [];
  let icon = null;
  let spine = null;
  for (const root of sources) {
    if (!icon) icon = await iconAt(root, key);
    if (!spine) {
      const m = await spineAt(root, key);
      if (m.entry) spine = m;
      else reasons.push(m.reason);
    }
    if (icon && spine) break;
  }
  if (!icon && !spine) {
    const named = typeof rec.spine === 'string' && rec.spine && rec.spine !== key ? rec.spine : null;
    if (named && (await spineAt(sources[0], named)).entry) aliasCandidates.push({ key, spine: named });
    noFiles.push({ key, reasons: [...new Set(reasons)] });
    continue;
  }
  if (spine?.reason) warn(`${key}: ${spine.reason}`);
  const entry = {};
  if (icon) entry.icon = icon.url;
  if (spine) entry.spine = spine.entry;
  added.push({ key, entry, icon, spine });
}

// ===== verify before writing ====================================================================
const span = objectSpan(rawText, 'enemies');
const head = rawText.slice(0, span.end);
const tail = rawText.slice(span.end);
const appended = added.map((e) => `${JSON.stringify(e.key)}:${JSON.stringify(e.entry)}`).join(',');
const sep = Object.keys(manifest.enemies).length && added.length ? ',' : '';
const mergedText = added.length ? `${head}${sep}${appended}${tail}` : rawText;

let merged = manifest;
if (added.length) {
  try {
    merged = JSON.parse(mergedText);
  } catch (err) {
    die(`internal check failed: the appended manifest text is not valid JSON (${err.message})`);
  }
  const changedOld = Object.keys(manifest.enemies).filter((k) => !isDeepStrictEqual(manifest.enemies[k], merged.enemies[k]));
  const badNew = added.filter((e) => !isDeepStrictEqual(e.entry, merged.enemies[e.key]));
  if (changedOld.length) die(`internal check failed: existing enemy entries changed — ${changedOld.slice(0, 5).join(', ')}`);
  if (badNew.length) die(`internal check failed: appended entries do not round-trip — ${badNew.slice(0, 5).map((e) => e.key).join(', ')}`);
  if (Object.keys(merged.enemies).length !== Object.keys(manifest.enemies).length + added.length) {
    die('internal check failed: enemy entry count mismatch');
  }
  for (const k of Object.keys(manifest)) {
    if (k !== 'enemies' && !isDeepStrictEqual(manifest[k], merged[k])) die(`internal check failed: top-level "${k}" changed`);
  }
  // byte-level: the text before the insertion point is untouched and so is everything from the closing brace on
  if (!mergedText.startsWith(rawText.slice(0, span.end)) || !mergedText.endsWith(rawText.slice(span.end))) {
    die('internal check failed: the existing bytes were not preserved');
  }
}

// ===== backup + write ===========================================================================
let backupWritten = false;
if (added.length && !DRY_RUN) {
  if (!existsSync(PATHS.backup)) {
    await mkdir(dirname(PATHS.backup), { recursive: true });
    await copyFile(PATHS.manifest, PATHS.backup);
    backupWritten = true;
  }
  await writeFile(PATHS.manifest, mergedText);
}

// ===== optional preview copy ====================================================================
const preview = { root: PREVIEW ? PATHS.preview : null, copied: 0, kept: 0, missing: 0 };
if (PREVIEW && added.length) {
  if (!PATHS.preview) die('--preview needs PREVIEW_ASSETS (the preview root)');
  for (const e of added) {
    const jobs = [];
    if (e.icon) jobs.push([e.icon.file, join(PATHS.preview, 'assets', 'enemy', 'icon', e.icon.name)]);
    if (e.spine) for (const f of e.spine.files) jobs.push([join(e.spine.dir, f), join(PATHS.preview, 'assets', 'spine', 'enemy', e.key, f)]);
    for (const [from, to] of jobs) {
      if (DRY_RUN) { preview.copied++; continue; }
      const r = await copyInto(from, to);
      preview[r] = (preview[r] || 0) + 1;
    }
  }
}

// ===== report ===================================================================================
const withSpine = added.filter((e) => e.spine).length;
const iconOnly = added.filter((e) => e.icon && !e.spine).length;
const report = {
  enemiesJson: PATHS.enemies,
  manifest: PATHS.manifest,
  assetSources: sources,
  roster: {
    keysWithSource: rosterKeys.length,
    alreadyRegistered: registered,
    candidates: candidates.length,
  },
  added: added.length,
  addedWithSpine: withSpine,
  addedIconOnly: iconOnly,
  // the candidates whose files no tree carries: left out of the manifest, the client draws its placeholder
  noFiles: { count: noFiles.length, keys: noFiles },
  // no files of their own, but the record names a model that exists: a spineAliasOf entry, if the roster should borrow it
  aliasCandidates,
  manifestEnemies: { before: Object.keys(manifest.enemies).length, after: Object.keys(merged.enemies).length },
  buildFieldsUntouched: { version: manifest.version, hash: manifest.hash, generator: manifest.generator },
  checks: {
    oldEntriesUnchanged: added.length ? Object.keys(manifest.enemies).every((k) => isDeepStrictEqual(manifest.enemies[k], merged.enemies[k])) : null,
    appendedRoundTrip: added.length ? added.every((e) => isDeepStrictEqual(e.entry, merged.enemies[e.key])) : null,
    existingBytesPreserved: added.length ? mergedText.startsWith(rawText.slice(0, span.end)) && mergedText.endsWith(rawText.slice(span.end)) : null,
  },
  backup: added.length ? { path: PATHS.backup, writtenNow: backupWritten } : null,
  preview: preview.root ? preview : null,
  dryRun: DRY_RUN,
  changed: added.length > 0 && !DRY_RUN,
  warnings,
};

console.log(added.length
  ? `${DRY_RUN ? '[dry-run] ' : ''}linked ${added.length} enemies (icon+Spine ${withSpine}, icon only ${iconOnly}); `
    + `the manifest holds ${report.manifestEnemies.after} enemies (was ${report.manifestEnemies.before})`
  : `nothing to add: no unregistered roster key with a file in ${sources.length} asset tree(s) (${candidates.length} candidates, `
    + `${noFiles.length} without files); the manifest holds ${report.manifestEnemies.before} enemies`);
if (noFiles.length) console.log(`no files (left to the client's placeholder), ${noFiles.length}: ${noFiles.map((e) => e.key).join(', ')}`);
if (report.backup?.writtenNow) console.log(`backup written to ${PATHS.backup}`);
if (report.preview) console.log(`preview: ${preview.copied} file(s) copied, ${preview.kept} kept under ${preview.root}`);
console.log(JSON.stringify(report, null, 2));
