// AI 投放清洗：**直接 import 实现**（pureShares.sanitizeBotPickList）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeBotPickList } from '../../plugins/mota/server/match/match/pureShares.js';

const ok = () => ({ len: 5, travel: 2 });
const pick = (n) => Array.from({ length: n }, (_, i) => ({ enemyKey: `e${i}`, gate: i % 2 ? 'upper' : 'lower', routeIndex: i, time: i }));

test('合法投放原样保留（含 routeIndex/time）', () => {
  const r = sanitizeBotPickList(pick(2), { timeLimit: 60, cap: 8, metricsOf: ok, spentOf: () => 10, budget: 100 });
  assert.equal(r.length, 2);
  assert.equal(r[0].routeIndex, 0);
  assert.equal(typeof r[0].time, 'number');
});

test('非法 routeIndex（metrics 为 null）被剥掉，但怪物保留', () => {
  const r = sanitizeBotPickList(pick(1), { timeLimit: 60, cap: 8, metricsOf: () => null, spentOf: () => 0, budget: 100 });
  assert.equal(r.length, 1);
  assert.equal(r[0].routeIndex, undefined);
});

test('超长路线（len > 40）被剥掉', () => {
  const r = sanitizeBotPickList(pick(1), { timeLimit: 60, cap: 8, metricsOf: () => ({ len: 41, travel: 1 }), spentOf: () => 0, budget: 100 });
  assert.equal(r[0].routeIndex, undefined);
});

test('time 夹进 timeLimit - travel - 2 窗口', () => {
  const r = sanitizeBotPickList([{ enemyKey: 'a', routeIndex: 0, time: 999 }], { timeLimit: 20, cap: 8, metricsOf: () => ({ len: 5, travel: 3 }), spentOf: () => 0, budget: 100 });
  assert.ok(r[0].time <= 20 - 3 - 2, `time ${r[0].time} 越界`);
});

test('窗口为负时不给 time（等同人类省略）', () => {
  const r = sanitizeBotPickList([{ enemyKey: 'a', routeIndex: 0, time: 5 }], { timeLimit: 10, cap: 8, metricsOf: () => ({ len: 5, travel: 20 }), spentOf: () => 0, budget: 100 });
  assert.equal(r[0].time, undefined);
  assert.equal(r[0].routeIndex, 0);
});

test('预算超支：先让最长路线（不是按输入顺序）', () => {
  // 两条路线成本 2 与 60，预算 40 ⇒ 只应让出长的那条
  const metricsOf = (i) => (i === 1 ? { len: 30, travel: 1 } : { len: 1, travel: 1 });
  const r = sanitizeBotPickList(
    [{ enemyKey: 'a', routeIndex: 0 }, { enemyKey: 'b', routeIndex: 1 }],
    { timeLimit: 60, cap: 8, metricsOf, spentOf: () => 20, budget: 40 },
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].routeIndex, 0, '短的合法路线被误删');
  assert.equal(r[1].routeIndex, undefined, '长路线应被让出');
});

test('预算 <= 0 返回空（与人类路径一致）', () => {
  const r = sanitizeBotPickList(pick(2), { timeLimit: 60, cap: 8, metricsOf: ok, spentOf: () => 0, budget: 0 });
  assert.deepEqual(r, []);
});

test('只数上限生效', () => {
  const r = sanitizeBotPickList(pick(10), { timeLimit: 60, cap: 3, metricsOf: ok, spentOf: () => 0, budget: 999 });
  assert.equal(r.length, 3);
});
