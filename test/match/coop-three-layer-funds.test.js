// 协同三层资金：守恒 / 顺序无关 / 大小约束 / 设施加成 —— **直接 import 实现**（pureShares.js）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitLeftoverShares } from '../../plugins/mota/server/match/match/pureShares.js';

const run = (n, left, opts = {}) => {
  let team = 0; const out = [];
  for (let i = 0; i < n; i++) {
    const r = splitLeftoverShares({ left, reserveNow: out[i - 1]?.reserve ?? 0, teamReserve: team, ...opts });
    team += r.team;
    out.push({ personal: r.personal, team: r.team, reserve: (out[i - 1]?.reserve ?? 0) + r.personal });
  }
  return { out, team };
};

test('守恒：个人 + 团队 === left（不吞钱）', () => {
  for (const left of [1, 3, 5, 10, 15, 97, 101]) {
    const r = splitLeftoverShares({ left });
    assert.equal(r.personal + r.team, left, `left=${left} 吞钱了: ${r.personal}+${r.team}`);
  }
});

test('顺序无关：同输入多次调用结果一致', () => {
  const a = splitLeftoverShares({ left: 10, reserveNow: 0, teamReserve: 0 });
  const b = splitLeftoverShares({ left: 10, reserveNow: 0, teamReserve: 0 });
  assert.deepEqual(a, b);
});

test('大小约束：单人反复叠加后 个人储备 >= 团队储备', () => {
  let team = 0; let reserve = 0;
  for (let i = 0; i < 6; i++) {
    const r = splitLeftoverShares({ left: 10, reserveNow: reserve, teamReserve: team });
    reserve += r.personal; team += r.team;
    assert.ok(reserve >= team, `第 ${i + 1} 轮 reserve ${reserve} < team ${team}`);
  }
});

test('大小约束：团队池已很大时不再增长', () => {
  const r = splitLeftoverShares({ left: 10, reserveNow: 0, teamReserve: 50 });
  assert.equal(r.team, 0);
  assert.equal(r.personal, 10);
});

test('恒定三层拆分：任何输入都守恒，且不再有「100% 归个人」的档', () => {
  for (const left of [1, 5, 10, 37, 100]) {
    const r = splitLeftoverShares({ left });
    assert.equal(r.personal + r.team, left, `left ${left} 不守恒`);
    assert.ok(r.personal >= r.team, `left ${left} 个人份额低于团队：${JSON.stringify(r)}`);
    // 0.3 的团队份额向下取整，left < 4 时团队侧本来就是 0，不是分支导致的
    if (left >= 4) assert.ok(r.team > 0, `left ${left} 团队份额为 0：${JSON.stringify(r)}`);
  }
  // 传入已废弃的 individual 选项也不再改变结果（字段被忽略，不是分支）
  assert.deepEqual(splitLeftoverShares({ left: 10, individual: true }), splitLeftoverShares({ left: 10 }));
});

test('设施加成：应急仓储提高个人份额、后勤调度提高团队份额', () => {
  const base = splitLeftoverShares({ left: 100 });
  const store = splitLeftoverShares({ left: 100, personalRate: 1.3 });
  const logi = splitLeftoverShares({ left: 100, teamRate: 1.3 });
  assert.ok(store.personal > base.personal, `store ${store.personal} <= base ${base.personal}`);
  assert.ok(logi.team > base.team, `logi ${logi.team} <= base ${base.team}`);
});

test('left <= 0 不产生份额', () => {
  assert.deepEqual(splitLeftoverShares({ left: 0 }), { personal: 0, team: 0 });
  assert.deepEqual(splitLeftoverShares({ left: -5 }), { personal: 0, team: 0 });
});
