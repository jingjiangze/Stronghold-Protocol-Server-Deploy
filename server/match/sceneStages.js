// server/match/sceneStages.js — the stages that ship an official scene package (third layer).
//
// data/local-assets.json lists every art group the local client package carries. A stage with a third layer (the scene
// package: background layers / foreground / tiles) has a `groups['scene/<stageId>']` entry; a stage without one is
// still playable — the engine falls back to a procedurally generated board — but it does not look like the official map.
// A stage without a package of its own may reuse the scene of its base map (`sceneAliases`: `foo-4-b` → `foo-4`, a field
// variant, and `foo_dlc2` → `foo`, a DLC copy); the client resolves the same way (public/js/render/board3d/load.js), so
// the option below and the board agree on which maps have official art.
// The room option 「包含无场景地图」 (room.setIncompleteMaps, off by default) narrows every stage pool to the ids this
// module returns; with the option on, the old pools (all of `mode.stages`) come back.
//
// The manifest is read once per process and re-read only when its size / mtime changes (an update replaces the file), so
// a match never pays for a parse twice. An absent or unreadable manifest gives the empty set: callers then fall back to
// their unfiltered pool — exactly the behaviour before this option existed (a deployment without local art keeps every
// stage).
//
// Both the vanilla engine (server/match/{waves,match}/…) and the mota plugin (plugins/mota/server/match/…) import this
// module; it is plain Node (no match state, no timers), so it is safe to share.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The committed manifest this server ships (data/local-assets.json); absent on a package that has no local art. */
export const SCENE_MANIFEST_PATH = path.join(ROOT, 'data', 'local-assets.json');
/** A scene group's key in the manifest: `scene/<stageId>`. */
const SCENE_PREFIX = 'scene/';

/** A stage id ending in a one-letter field suffix: `foo-4-b` → `foo-4`. */
const SCENE_ALIAS_TAIL = /^(.+)-[a-z]$/;
/** A stage id of a DLC copy: `foo_dlc2` → `foo`. */
const SCENE_ALIAS_DLC = /^(.+)_dlc[1-3]$/;

/**
 * Ids whose scene directory a stage without a package of its own may reuse: `foo-4-b` / `-c` / `-d` are field variants
 * of the map `foo-4` and `foo_dlc2` is its DLC copy, so the base map's scene (same rows / rogueFrame) fits. Ordered,
 * deduped, and never the id itself. Only these two literal rules: no `_` / `-` swap and no repeated stripping
 * (`ro5_b-9-a` → `ro5_b-9`, no further).
 *
 * MIRROR of `sceneAliases` in public/js/render/board3d/load.js — the same rule written twice (the server must not
 * import that browser ESM module). Change one, change both.
 * @param {string} stageId
 * @returns {string[]} alias ids, most specific first
 */
function sceneAliases(stageId) {
  if (typeof stageId !== 'string' || !stageId) return [];
  const out = [];
  const add = (id) => { if (id && id !== stageId && !out.includes(id)) out.push(id); };
  const dlc = SCENE_ALIAS_DLC.exec(stageId);
  if (dlc) {
    add(dlc[1]);
    const inner = SCENE_ALIAS_TAIL.exec(dlc[1]);
    if (inner) add(inner[1]);
  }
  const tail = SCENE_ALIAS_TAIL.exec(stageId);
  if (tail) add(tail[1]);
  return out;
}

/**
 * A Set of the manifest's scene stage ids (iteration / size = the ids the manifest literally lists) whose `has` also
 * answers true for a stage that has no package of its own but whose alias does (`sceneAliases`). Callers only ever ask
 * `has(id)` on a stage pool, so the alias rule lives in the membership test, not in the stored ids.
 */
class SceneStageSet extends Set {
  has(stageId) {
    if (super.has(stageId)) return true;
    for (const id of sceneAliases(stageId)) if (super.has(id)) return true;
    return false;
  }
}

/** @type {{ key: string | null, stages: Set<string> }} the last parse (key = manifest identity: mtime + size) */
let cached = { key: null, stages: new SceneStageSet() };

/**
 * The stage ids with an official scene package (`data/local-assets.json`'s `scene/<stageId>` groups).
 *
 * Cached; a changed manifest (size or mtime) is parsed again. Treat the returned Set as read-only (it is the cache).
 * Its iteration order and size are the ids the manifest lists; `has` also accepts a stage whose base map is listed
 * (`sceneAliases`), because that stage renders the base map's scene. An absent / unreadable manifest returns an empty
 * Set — a caller filtering a pool with it gets an empty result and is expected to fall back to the unfiltered pool.
 *
 * @param {{ file?: string }} [o] `file` overrides the manifest (tools / tests only)
 * @returns {Set<string>}
 */
export function stagesWithScene({ file = SCENE_MANIFEST_PATH } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return new SceneStageSet(); }
  const key = `${st.mtimeMs}:${st.size}`;
  if (cached.key === key) return cached.stages;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return new SceneStageSet(); }
  const groups = doc && typeof doc === 'object' && doc.groups && typeof doc.groups === 'object' ? doc.groups : {};
  const stages = new SceneStageSet();
  for (const k of Object.keys(groups)) {
    if (!k.startsWith(SCENE_PREFIX)) continue;
    const id = k.slice(SCENE_PREFIX.length);
    if (id) stages.add(id);
  }
  cached = { key, stages };
  return stages;
}

/** Drop the cache (an update / a test that rewrites the manifest in place, same size and mtime granularity). */
export function clearSceneStagesCache() {
  cached = { key: null, stages: new SceneStageSet() };
}
