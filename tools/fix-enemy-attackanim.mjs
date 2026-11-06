#!/usr/bin/env node
// Repair `attackAnim` in data/enemies.json so every enemy whose model carries a real attack clip in data/assets.json
// has the field the sim reads (server/sim/ai.js attackStand) and no enemy whose model lacks one carries a stale copy.
//
// The rule is exactly the generator's: tools/build-data.mjs writes `attackAnim` from `enemyAttackAnim(manifest, spine)`
// (the clip `anims.attack.loop` of the enemy's own model, its duration, and its first OnAttack frame); an enemy whose
// model the manifest lacks, or whose `anims.attack` is only the idle stand-in (`via: 'idle'`), gets none and the sim
// falls back to ATTACK_PAUSE. The 242 records tools/build-enemies-merged.mjs appended never went through that call, and
// a handful of older ones kept a value their model no longer backs.
//
// Both directions, one pass:
//   real !== null && !attackAnim → write { clip, dur[, hit] }   (field appended last: the generator's key order)
//   real === null &&  attackAnim → delete the field
// Nothing else is touched: an existing value that differs from `real` while both are non-null stays as it is (the CI
// assertion only asks that the field exists iff the model has a clip), and no other field, key order or byte of the
// file's layout changes beyond the two edits above. Idempotent: a second run reports `changed 0` and writes nothing.
//
// `enemyAttackAnim` is a verbatim copy of tools/build-data.mjs:1695-1703 — that module has no `export` and calls
// `main()` at import time, so importing it would rebuild the whole dataset instead of reading one function.

import { readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENEMIES_JSON = join(ROOT, 'data/enemies.json');
const ASSETS_JSON = join(ROOT, 'data/assets.json');

/** tools/build-data.mjs:1695-1703, copied verbatim (see the header for why it is not imported). */
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

/**
 * Put the field where the records that already carry it put it: the generator writes `attackAnim` after the model keys
 * and tools/build-enemies-merged.mjs appends its `source` tag afterwards, so among the merged records the field reads
 * `…,spine,attackAnim,source`. Inserting before a trailing `source` (else at the end) keeps that one shape.
 */
function withAttackAnim(e, attackAnim) {
  const out = {};
  let placed = false;
  for (const [k, v] of Object.entries(e)) {
    if (k === 'source' && !placed) { out.attackAnim = attackAnim; placed = true; }
    out[k] = v;
  }
  if (!placed) out.attackAnim = attackAnim;
  return out;
}

const [enemiesRaw, manifest] = await Promise.all([
  readFile(ENEMIES_JSON, 'utf8'),
  readFile(ASSETS_JSON, 'utf8').then(JSON.parse),
]);
const enemies = JSON.parse(enemiesRaw);

const added = [];
const removed = [];
for (const [key, e] of Object.entries(enemies)) {
  const real = enemyAttackAnim(manifest, e.spine || e.key);
  if (real && !e.attackAnim) {
    enemies[key] = withAttackAnim(e, real);
    added.push(`${key} ${JSON.stringify(real)}`);
  } else if (!real && e.attackAnim) {
    delete e.attackAnim;
    removed.push(key);
  }
}

const changed = added.length + removed.length;
console.log(`changed ${changed}`);
for (const line of added) console.log(`  + ${line}`);
for (const key of removed) console.log(`  - ${key}`);

// Same serialization as the generator (JSON.stringify, no indentation, no trailing newline); tmp + rename so an
// interrupted run cannot leave a truncated enemies.json behind.
if (changed) {
  const tmp = `${ENEMIES_JSON}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(enemies));
  await rename(tmp, ENEMIES_JSON);
}
