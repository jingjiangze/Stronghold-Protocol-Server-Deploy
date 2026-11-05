// test/content/stats-only-enemies-runtime.test.js — the STATS_ONLY enemies really enter a running battle.
//
// server/sim/content/enemies.js STATS_ONLY lists the enemy keys deliberately left to their data stats (no kit / no
// ability). test/content/enemies_bosses.test.js already pins that such a key attaches no ability; this file pins the
// other half of the contract: the key is still spawnable through data/enemies.json and survives a full-content battle
// with valid stats (no NaN, hp within maxHp, engine invariants hold) — a key that is "stats only" must not be a key that
// breaks at runtime (missing data, zero max HP, bad route, …). Skill behaviour is NOT required here.
//
// Static evidence checked below (data/assets.json `enemies.<key>` spine + icon, data/waves.json `spawns[].key`
// occurrence count at 2026-11):
//   enemy_1088_ltsmer    ≤9  wave references      enemy_1111_ucommd_2  ≤11
//   enemy_1298_ymmonk    ≤16                     enemy_1298_ymmonk_2  ≤34
//   enemy_1012_dcross    ≤25                     enemy_1012_dcross_2  ≤16
//   enemy_1099_nbkght    ≤23                     enemy_1102_sdkght_2  ≤13
//   enemy_1147_dshond    ≤71                     enemy_1147_dshond_2  ≤34
//   enemy_1189_krgaxe    ≤36

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';

const IDS = [
  'enemy_1088_ltsmer', 'enemy_1111_ucommd_2', 'enemy_1298_ymmonk', 'enemy_1298_ymmonk_2', 'enemy_1012_dcross',
  'enemy_1012_dcross_2', 'enemy_1099_nbkght', 'enemy_1102_sdkght_2', 'enemy_1147_dshond', 'enemy_1147_dshond_2',
  'enemy_1189_krgaxe',
];

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const A = JSON.parse(fs.readFileSync(new URL('../../data/assets.json', import.meta.url), 'utf8'));
const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));

/** waves.json `spawns[].key` → occurrence count. */
const WAVE_REFS = new Map();
for (const w of Object.values(W)) {
  for (const s of w?.spawns ?? []) if (s?.key) WAVE_REFS.set(s.key, (WAVE_REFS.get(s.key) ?? 0) + 1);
}

test('stats-only enemy list: every listed key is STATS_ONLY data with a model and a wave', () => {
  for (const id of IDS) {
    assert.ok(enemiesMod.STATS_ONLY[id], `${id} is not in STATS_ONLY (${String(enemiesMod.STATS_ONLY[id])})`);
    assert.ok(E[id], `${id} missing from data/enemies.json`);
    assert.ok((WAVE_REFS.get(id) ?? 0) > 0, `${id} never spawned by data/waves.json`);
    const a = A.enemies?.[id];
    assert.ok(a, `${id} missing from data/assets.json enemies`);
    assert.ok(typeof a.icon === 'string' && a.icon.length > 0, `${id} has no icon`);
    assert.ok(typeof a.spine?.skel === 'string' && a.spine.skel.length > 0, `${id} has no spine skel`);
    assert.ok(typeof a.spine?.atlas === 'string' && a.spine.atlas.length > 0, `${id} has no spine atlas`);
  }
});

for (const id of IDS) {
  test(`stats-only enemy ${id} spawns and runs through a full-content battle`, () => {
    const h = makeBattle({
      units: [{ chessId: 'chess_char_1_01_a', row: 10, col: 5 }],
      enemies: [{ key: id, pos: [9, 8] }],
      content: 'full', timeLimit: 8, autoFinish: false, seed: 7,
    });
    h.run(3);
    const e = h.enemy(id);
    assert.ok(e, `${id} spawned`);
    assert.ok(e.deployed, `${id} deployed onto the field`);
    assert.equal(h.result().errors, 0, `${id} handler errors: ${JSON.stringify(h.result().errors)}`);
    assert.ok(Number.isFinite(e.s.maxHp) && e.s.maxHp > 0, `${id} maxHp ${e.s.maxHp}`);
    assert.ok(Number.isFinite(e.hp) && e.hp >= 0 && e.hp <= e.s.maxHp, `${id} hp ${e.hp} / ${e.s.maxHp}`);
    // checkInvariants throws on the first violation (no NaN, hp bounds, positions, skill state, capsule counters)
    let inv = null;
    try { h.invariants(); } catch (err) { inv = err; }
    assert.equal(inv, null, `${id} invariants: ${inv?.message}`);
  });
}
