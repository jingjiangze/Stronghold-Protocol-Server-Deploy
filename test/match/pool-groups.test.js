// 分组牌库 (owner 2026-11-05「每四人一个分组牌库」): shared/playerCapacity.js poolGroupSizes / poolCopyScale and the
// per-group SharedPool instances every Match builds (Match.pools / seat poolId).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { poolGroupSizes, poolCopyScale } from '../../shared/playerCapacity.js';
import { collectViolations } from '../../server/match/invariants.js';
import { Match as MotaMatch } from '../../plugins/mota/server/match/Match.js';
import { makeMatch } from './harness.js';

test('poolGroupSizes: 每 4 人一队的保序切块; 越界人数抛 RangeError; poolCopyScale 对 ≤4 人组恒为 1', () => {
  assert.deepEqual(poolGroupSizes(5), [4, 1]);
  assert.deepEqual(poolGroupSizes(6), [4, 2]);
  assert.deepEqual(poolGroupSizes(7), [4, 3]);
  assert.deepEqual(poolGroupSizes(8), [4, 4]);
  assert.deepEqual(poolGroupSizes(9), [4, 4, 1]);
  assert.deepEqual(poolGroupSizes(12), [4, 4, 4]);
  assert.deepEqual(poolGroupSizes(20), [4, 4, 4, 4, 4]);
  assert.throws(() => poolGroupSizes(0), RangeError);
  assert.throws(() => poolGroupSizes(21), RangeError);
  assert.equal(poolCopyScale(4), 1);
});

test('8 人房建两组牌库: 座位 0-3 用组 0、4-7 用组 1，两组各拿一份完整 4 人份库存', () => {
  const h = makeMatch({ humans: 8, fake: true });
  const m = h.m;
  assert.equal(m.pools.length, 2, `expected 2 pools, got ${m.pools.length}`);
  assert.deepEqual(m.order.map((p) => p.poolId), [0, 0, 0, 0, 1, 1, 1, 1]);
  assert.equal(m.pool, m.pools[0], 'm.pool stays the first group');
  assert.equal(m.pools[0].entries.size, m.pools[1].entries.size);
  for (const pool of m.pools) {
    for (const [base, e] of pool.entries) {
      assert.equal(e.cap, m.gd.poolCopies(base), `${base} cap ${e.cap} != gd.poolCopies ${m.gd.poolCopies(base)}`);
    }
  }
  m.dispose();
});

test('组间库存隔离: 组 0 抽空某 base 不影响组 1, 组 1 仍可 take; 归还后引擎不变量无违规', () => {
  const h = makeMatch({ humans: 8, fake: true });
  const m = h.m;
  const [group0, group1] = m.pools;
  const base = [...group0.entries.keys()][0];
  const cap = group0.cap(base);
  assert.ok(cap > 0, `${base} must be in the pool`);
  assert.equal(group1.cap(base), cap, 'both groups hold the same original stock');

  assert.equal(group0.take(base, cap), cap);
  assert.equal(group0.left(base), 0, 'group 0 is drained');
  assert.equal(group1.left(base), cap, 'group 1 is untouched');

  // NOTE: taking copies without any piece holding them breaks the per-group accounting check
  // (invariants.js: left + Σ held == cap), in LOBBY as in any other phase. What this test pins is that the deficit
  // stays inside the group that took the copies — group 1 must not be reported while it still holds full stock.
  const violations = collectViolations(m);
  assert.ok(
    violations.every((v) => v.startsWith(`pool[0] ${base}:`)),
    `only group 0 may account for the drained stock, got:\n  ${violations.join('\n  ')}`,
  );
  assert.ok(!violations.some((v) => v.startsWith('pool[1]')), 'group 1 reports no violation');

  assert.equal(group1.take(base, 1), 1, 'group 1 can still take after group 0 is empty');
  assert.equal(group1.left(base), cap - 1, 'group 1 stock follows only its own takes');

  // returning the copies restores the invariant (a clean take/return round trip)
  assert.equal(group1.give(base, 1), 1);
  assert.equal(group0.give(base, cap), cap);
  assert.deepEqual(collectViolations(m), [], 'a settled round trip leaves no violation');
  m.dispose();
});

test('插件 Match（实际运行的那份副本）同样按 4 人分组: 8 人房两组, 座位 4-7 的 poolGroup() 指向组 1', () => {
  const h = makeMatch({ matchClass: MotaMatch, mode: 'coop', difficulty: 'NORMAL', humans: 8, fake: true });
  const m = h.m;
  assert.equal(m.pools.length, 2, `expected 2 pools, got ${m.pools.length}`);
  assert.ok(
    m.order.slice(0, 4).every((p) => p.poolId === 0),
    `seats 0-3 must sit in group 0, got ${m.order.map((p) => p.poolId)}`,
  );
  assert.ok(
    m.order.slice(4).every((p) => p.poolId === 1),
    `seats 4-7 must sit in group 1, got ${m.order.map((p) => p.poolId)}`,
  );
  assert.equal(m.order[4].poolGroup(), m.pools[1], 'seat 4 resolves its own group through poolGroup()');
  assert.notEqual(m.pools[0], m.pools[1], 'the two groups are distinct pool instances');

  const [group0, group1] = m.pools;
  const base = [...group0.entries.keys()][0];
  const cap = group0.cap(base);
  assert.ok(cap > 0, `${base} must be in the pool`);
  assert.equal(group1.cap(base), cap, 'both groups hold the same original stock');
  assert.equal(group0.take(base, cap), cap);
  assert.equal(group0.left(base), 0, 'group 0 is drained');
  assert.equal(group1.left(base), cap, 'group 1 keeps full stock after group 0 empties');
  m.dispose();
});

test('20 人房建五组牌库: poolId 每 4 人递增 0,1,2,3,4', () => {
  const h = makeMatch({ humans: 20, fake: true });
  const m = h.m;
  assert.equal(m.pools.length, 5, `expected 5 pools, got ${m.pools.length}`);
  assert.deepEqual(m.order.map((p) => p.poolId), [
    0, 0, 0, 0,
    1, 1, 1, 1,
    2, 2, 2, 2,
    3, 3, 3, 3,
    4, 4, 4, 4,
  ]);
  m.dispose();
});
