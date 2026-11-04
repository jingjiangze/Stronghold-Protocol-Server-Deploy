// test/match/confront-fill.test.js — 对抗投放「1.5× 只数 + 价值」双目标填充（2026-11-01 P1，审计 findings §2）。
// 实现在 plugins/mota/server/match/match/confrontFill.js；本测试 import 同一份代码，避免复刻版漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillConfrontPicks } from '../../plugins/mota/server/match/match/confrontFill.js';

const rowsOf = (pairs) => pairs.map(([key, value]) => ({ key, value }));

test('单目标价时选最接近目标的怪：只数与价值同时逼近', () => {
  // 目标单价 = 300/3 = 100 ⇒ 全选 100 的怪，3 只、价值 300
  const picks = fillConfrontPicks({ rows: rowsOf([['a', 8], ['b', 20], ['c', 100]]), budget: 300, unitsTarget: 3, cap: 80 });
  assert.equal(picks.length, 3);
  assert.deepEqual(picks.map((p) => p.enemyKey), ['c', 'c', 'c']);
  assert.equal(picks.reduce((n, p) => n + p.value, 0), 300);
});

test('跨越预算的怪不会选；只买得起便宜货时只数命中、价值不足', () => {
  const picks = fillConfrontPicks({ rows: rowsOf([['cheap', 8]]), budget: 300, unitsTarget: 3, cap: 80 });
  assert.equal(picks.length, 3, '只数目标命中');
  assert.equal(picks.reduce((n, p) => n + p.value, 0), 24, '价值随可用池封顶（不会编造贵的怪）');
});

test('cap 优先于只数目标；unitsTarget ≤ 0 按 1 处理', () => {
  const picks = fillConfrontPicks({ rows: rowsOf([['x', 10]]), budget: 999, unitsTarget: 50, cap: 3 });
  assert.equal(picks.length, 3, 'maxPicks 硬上限');
  const one = fillConfrontPicks({ rows: rowsOf([['x', 10]]), budget: 999, unitsTarget: 0, cap: 80 });
  assert.equal(one.length, 1);
});

test('预算连最便宜的都买不起 ⇒ 空；空/脏输入安全', () => {
  assert.deepEqual(fillConfrontPicks({ rows: rowsOf([['x', 10]]), budget: 9, unitsTarget: 3, cap: 80 }), []);
  assert.deepEqual(fillConfrontPicks({ rows: [], budget: 100, unitsTarget: 3, cap: 80 }), []);
  assert.deepEqual(fillConfrontPicks(), []);
  // 脏行（缺 key / 非数 / ≤0）被过滤
  const dirty = fillConfrontPicks({ rows: [{ key: 'ok', value: 5 }, { value: 7 }, { key: 'z', value: 'x' }, { key: 'neg', value: -1 }], budget: 10, unitsTarget: 2, cap: 80 });
  assert.deepEqual(dirty.map((p) => p.enemyKey), ['ok', 'ok']);
});

test('同预算下价差极大时不会全押最便宜：向目标单价靠拢', () => {
  // 预算 90、目标 3 只 ⇒ 单价 30；池 [5, 30, 90]
  const picks = fillConfrontPicks({ rows: rowsOf([['c5', 5], ['c30', 30], ['c90', 90]]), budget: 90, unitsTarget: 3, cap: 80 });
  assert.deepEqual(picks.map((p) => p.enemyKey), ['c30', 'c30', 'c30'], '每步都挑最接近剩余均价的');
  assert.equal(picks.reduce((n, p) => n + p.value, 0), 90);
});

test('确定性：同输入同输出（顺序无关的稳定排序）', () => {
  const a = fillConfrontPicks({ rows: rowsOf([['b', 20], ['a', 20], ['c', 10]]), budget: 60, unitsTarget: 3, cap: 80 });
  const b = fillConfrontPicks({ rows: rowsOf([['c', 10], ['a', 20], ['b', 20]]), budget: 60, unitsTarget: 3, cap: 80 });
  assert.deepEqual(a, b);
});
