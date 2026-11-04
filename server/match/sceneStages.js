// server/match/sceneStages.js — the stages that ship an official scene package (third layer).
//
// data/local-assets.json lists every art group the local client package carries. A stage with a third layer (the scene
// package: background layers / foreground / tiles) has a `groups['scene/<stageId>']` entry; a stage without one is
// still playable — the engine falls back to a procedurally generated board — but it does not look like the official map.
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

/** @type {{ key: string | null, stages: Set<string> }} the last parse (key = manifest identity: mtime + size) */
let cached = { key: null, stages: new Set() };

/**
 * The stage ids with an official scene package (`data/local-assets.json`'s `scene/<stageId>` groups).
 *
 * Cached; a changed manifest (size or mtime) is parsed again. Treat the returned Set as read-only (it is the cache).
 * An absent / unreadable manifest returns an empty Set — a caller filtering a pool with it gets an empty result and is
 * expected to fall back to the unfiltered pool.
 *
 * @param {{ file?: string }} [o] `file` overrides the manifest (tools / tests only)
 * @returns {Set<string>}
 */
export function stagesWithScene({ file = SCENE_MANIFEST_PATH } = {}) {
  let st;
  try { st = fs.statSync(file); } catch { return new Set(); }
  const key = `${st.mtimeMs}:${st.size}`;
  if (cached.key === key) return cached.stages;
  let doc;
  try { doc = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return new Set(); }
  const groups = doc && typeof doc === 'object' && doc.groups && typeof doc.groups === 'object' ? doc.groups : {};
  const stages = new Set();
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
  cached = { key: null, stages: new Set() };
}
