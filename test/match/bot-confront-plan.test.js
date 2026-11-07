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

test('路线不计费：预算只看 spentOf，长路线不被让出（2026-11-06 口径统一）', () => {
  // 旧契约：路线长度 ×1 也算进 bot 预算，超支时先让最长的那条。2026-11-06 起服务端（confront.js 的提交 / 投放
  // 判据）只看 settle.cost，路线费整条删除 —— bot 的报价必须同源，否则它会比人类少投几只。
  const metricsOf = (i) => (i === 1 ? { len: 30, travel: 1 } : { len: 1, travel: 1 });
  const r = sanitizeBotPickList(
    [{ enemyKey: 'a', routeIndex: 0 }, { enemyKey: 'b', routeIndex: 1 }],
    { timeLimit: 60, cap: 8, metricsOf, spentOf: () => 20, budget: 40 },
  );
  assert.equal(r.length, 2);
  assert.equal(r[0].routeIndex, 0);
  assert.equal(r[1].routeIndex, 1, '长路线不再占预算，不该被让出');
});

test('超支按只数从尾部削（spentOf 已经超过预算）', () => {
  const r = sanitizeBotPickList(pick(4), { timeLimit: 60, cap: 8, metricsOf: ok, spentOf: () => 50, budget: 10 });
  assert.equal(r.length, 0);
});

test('预算 <= 0 返回空（与人类路径一致）', () => {
  const r = sanitizeBotPickList(pick(2), { timeLimit: 60, cap: 8, metricsOf: ok, spentOf: () => 0, budget: 0 });
  assert.deepEqual(r, []);
});

test('只数上限生效', () => {
  const r = sanitizeBotPickList(pick(10), { timeLimit: 60, cap: 3, metricsOf: ok, spentOf: () => 0, budget: 999 });
  assert.equal(r.length, 3);
});
