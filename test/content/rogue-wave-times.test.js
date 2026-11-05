// test/content/rogue-wave-times.test.js — 肉鸽出怪时间必须落在本回合时限内（2026-11-05 审计修）。
//
// 时限 L = 回合 combatTimeLimit × COMBAT_TIME_SCALE(=2)，tier 由 stage id `rogue_ro<主题>_<tier>-<编号>` 决定：
//   1/2/3 → 90，4/5 → 140，6/7 → 230，t → 110，ev → 110，d → 110，b → 240（data/config.json R1/R2 45、R3–R5 55、
//   R6 70、R11 115、R14 120）。未知 tier（sv/fs/c/dv/s）不纳入本测试。
// 断言：每张已知 tier 的肉鸽波（有 spawns 时）首怪 ≤ 0.1L、末怪（time+(count-1)×interval）≤ L；
//       rogue_ro4_1-2 首怪 ≤ 9 且末怪 ≤ 90（修前首怪被 ACTIVATE_PREDEFINED 推到 118s）。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIER_SPAWN_LIMITS, tierOfStageId, spawnLimitForTier, fitTimeline } from '../../tools/build-rogue-maps-v2.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const WAVES = JSON.parse(readFileSync(join(ROOT, 'data/waves.json'), 'utf8'));
/** 允许 0.01 秒的浮点误差（fitTimeline 保留两位小数）。 */
const EPS = 0.01;

function boundsOf(spawns) {
  const rows = (Array.isArray(spawns) ? spawns : []).filter((s) => s && typeof s.time === 'number');
  if (!rows.length) return null;
  const first = Math.min(...rows.map((s) => s.time));
  const end = Math.max(...rows.map((s) => s.time + Math.max(0, (Number(s.count) || 1) - 1) * Math.max(0, Number(s.interval) || 0)));
  return { first, end };
}

test('肉鸽波：已知 tier 的首怪 ≤ 0.1L 且末怪 ≤ L', () => {
  const failures = [];
  let checked = 0;
  for (const [id, wave] of Object.entries(WAVES)) {
    if (!id.startsWith('rogue_') || !wave || typeof wave !== 'object') continue;
    const limit = spawnLimitForTier(tierOfStageId(id));
    if (!limit) continue;   // 未知 tier（sv/fs/c/dv/s）不纳入
    const b = boundsOf(wave.spawns);
    if (!b) continue;
    checked += 1;
    if (b.first > 0.1 * limit + EPS) failures.push(`${id}: first ${b.first} > ${0.1 * limit} (L ${limit})`);
    if (b.end > limit + EPS) failures.push(`${id}: end ${b.end} > ${limit}`);
  }
  assert.ok(checked > 0, '应至少检查到一张已知 tier 的肉鸽波');
  assert.deepEqual(failures.slice(0, 20), [], `出怪时间超限（共 ${failures.length} 条，前 20 条如上）`);
});

test('rogue_ro4_1-2：首怪 ≤ 9s 且末怪 ≤ 90s（修前首怪 118s）', () => {
  const wave = WAVES['rogue_ro4_1-2'];
  assert.ok(wave, 'data/waves.json 应包含 rogue_ro4_1-2');
  const b = boundsOf(wave.spawns);
  assert.ok(b, 'rogue_ro4_1-2 应有 spawns');
  assert.ok(b.first <= 9 + EPS, `首怪应 ≤ 9s，实际 ${b.first}s`);
  assert.ok(b.end <= 90 + EPS, `末怪应 ≤ 90s，实际 ${b.end}s`);
});

test('tier→时限表：已知 tier 有值，未知 tier 不纳入', () => {
  for (const t of ['1', '2', '3', '4', '5', '6', '7', 't', 'ev', 'd', 'b']) {
    assert.equal(spawnLimitForTier(t), TIER_SPAWN_LIMITS[t], `tier ${t} 应有时限`);
  }
  for (const t of ['sv', 'fs', 'c', 'dv', 's']) assert.equal(spawnLimitForTier(t), null, `未知 tier ${t} 不应有时限`);
});

test('fitTimeline 幂等：对已归一化数据再跑一次不改时间', () => {
  const copy = JSON.parse(JSON.stringify(WAVES));
  let changed = 0;
  for (const [id, wave] of Object.entries(copy)) {
    if (!id.startsWith('rogue_') || !wave || !Array.isArray(wave.spawns)) continue;
    const limit = spawnLimitForTier(tierOfStageId(id));
    if (!limit) continue;
    const before = JSON.stringify(wave.spawns.map((s) => [s.time, s.interval]));
    fitTimeline(wave.spawns, limit);
    if (JSON.stringify(wave.spawns.map((s) => [s.time, s.interval])) !== before) changed += 1;
  }
  assert.equal(changed, 0, '已归一化的波再跑 fitTimeline 应保持不变');
});

test('0 秒 Boss 行：注入的 boss spawn（count 1 / interval 0）保持 t=0', () => {
  const bad = [];
  for (const [id, wave] of Object.entries(WAVES)) {
    if (!id.startsWith('rogue_')) continue;
    for (const s of wave && Array.isArray(wave.spawns) ? wave.spawns : []) {
      if (s && s.tag === 'boss' && s.count === 1 && s.interval === 0 && s.time !== 0) bad.push(`${id}: ${s.key} t=${s.time}`);
    }
  }
  assert.deepEqual(bad, []);
});
