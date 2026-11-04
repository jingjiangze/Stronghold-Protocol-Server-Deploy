// test/plugins/rogue-nodes.test.js — 肉鸽节点核心（roguelike-core）单测。
// 只测纯逻辑：层与候选节点、行动力、奖励、选择落地、结局钩子。
// 数据来自 plugins/roguelike-data-ro4/data/rogue-nodes.json（自设计，非官方）：14 层 × 3 候选 = 42 节点。

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Mixin } from '../../plugins/roguelike-core/server/match/NodeMixin.js';

const table = JSON.parse(fs.readFileSync(new URL('../../plugins/roguelike-data-ro4/data/rogue-nodes.json', import.meta.url), 'utf8'));

/** 只带 mixin 需要的字段的假对局（不启动引擎）。 */
function fakeMatch({ isRogue = true, raw = table } = {}) {
  const ps = { alive: true, lp: 5, funds: 0, deployCapBonus: 0, addFunds(n) { this.funds += n; } };
  const m = Object.create(Mixin.prototype);
  Object.assign(m, {
    isRogue,
    round: 1,
    seed: 12345,
    gd: { raw: raw ? { 'rogue-nodes': raw } : {}, lastRound: 14 },
    alivePlayers: () => [ps],
    markPublic() {},
    reportError() {},
  });
  return { m, ps };
}

test('数据：14 层 × 3 候选 = 42 节点，id 形如 R<层>-N<n>', () => {
  assert.equal(table.selfDesigned, true);
  assert.match(table.notice, /非官方/);
  assert.deepEqual(table.rules, { startAp: 5, maxAp: 5, choices: 3, layers: 14, nodesPerLayer: 3 });
  assert.equal(table.layers.length, 14);
  assert.equal(table.layers.reduce((n, l) => n + l.nodes.length, 0), 42);
  const ids = new Set();
  table.layers.forEach((layer, i) => {
    assert.equal(layer.id, `R${i + 1}`, `第 ${i + 1} 层的 id`);
    assert.equal(layer.nodes.length, 3, `${layer.id} 的候选数`);
    for (const n of layer.nodes) {
      assert.match(n.id, new RegExp(`^R${i + 1}-N[1-3]$`));
      assert.equal(typeof n.tier, 'string');
      assert.ok(!ids.has(n.id), `重复节点 id ${n.id}`);
      ids.add(n.id);
    }
  });
  assert.equal(ids.size, 42);
  assert.deepEqual(table.layers.at(-1).nodes.map((n) => n.type), ['boss', 'boss', 'boss']);
});

test('未开始时没有状态', () => {
  const { m } = fakeMatch();
  assert.equal(m.rogueNodeState(), null);
});

test('第一回合落到 R1-N1：扣 1 AP、发 2 资金 + 1 AP（封顶 maxAp），visited 记一次', () => {
  const { m, ps } = fakeMatch();
  const st = m.rogueNodeBegin(1);
  assert.equal(st.current, 'R1-N1');
  assert.equal(st.index, 0);
  assert.equal(st.layer, 'R1');
  assert.equal(st.layerName, '第一层 · 荒废站台');
  assert.equal(st.tier, '1');
  assert.equal(st.maxAp, 5);
  assert.equal(st.ap, 5, 'startAp 5 − cost 1 + reward.ap 1，封顶 maxAp 5');
  assert.equal(st.picked, 'R1-N1');
  assert.equal(st.ended, false);
  assert.equal(ps.funds, 2, 'R1-N1 的 reward.funds');
  assert.equal(ps.lp, 5, 'R1-N1 不带生命奖励');
  assert.deepEqual(st.visited, ['R1-N1']);
  assert.equal(st.sequence.length, 42);
  assert.equal(st.mapId, null, '没有 stages 数据时不编造地图');
});

test('choices / nextChoices 各 3 个：本层候选与下一层候选', () => {
  const { m } = fakeMatch();
  const st = m.rogueNodeBegin(1);
  assert.equal(st.round, 1);
  assert.deepEqual(st.choices.map((c) => c.id), ['R1-N1', 'R1-N2', 'R1-N3']);
  assert.deepEqual(st.choices.map((c) => c.cost), [1, 1, 2]);
  assert.deepEqual(st.choices.map((c) => c.available), [true, true, true]);
  assert.equal(st.nextRound, 2);
  assert.deepEqual(st.nextChoices.map((c) => c.id), ['R2-N1', 'R2-N2', 'R2-N3']);
  assert.equal(st.nextPicked, null);
});

test('行动力为 0 时本层候选都标为不可用', () => {
  const { m } = fakeMatch();
  m.rogueNodeBegin(1);
  m._rogueNodes.ap = 0;
  assert.deepEqual(m.rogueNodeChoices(1).map((c) => c.available), [false, false, false]);
});

test('选下一层的节点：本回合不变，下一回合才落地并按新节点结算资金/AP', () => {
  const { m, ps } = fakeMatch();
  m.rogueNodeBegin(1); // R1-N1：funds 2、ap 5
  const st1 = m.rogueNodePick(ps, 'R2-N3');
  assert.equal(st1.current, 'R1-N1');
  assert.equal(st1.picked, 'R1-N1');
  assert.equal(st1.nextPicked, 'R2-N3');
  assert.equal(ps.funds, 2, '下一层的选择不在本回合结算');
  const st2 = m.rogueNodeBegin(2);
  assert.equal(st2.current, 'R2-N3');
  assert.equal(st2.tier, '3');
  assert.equal(st2.ap, 5, '5 − cost 2 + reward.ap 2');
  assert.equal(ps.funds, 7, '2 + reward.funds 5');
  assert.deepEqual(st2.visited, ['R1-N1', 'R2-N3']);
});

test('同层改选只换落地节点，不重发奖励也不退 AP', () => {
  const { m, ps } = fakeMatch();
  m.rogueNodeBegin(1); // R1-N1：funds 2、ap 5
  const st = m.rogueNodePick(ps, 'R1-N3'); // cost 2、funds 4、ap 2
  assert.equal(st.current, 'R1-N3');
  assert.equal(st.tier, '3');
  assert.equal(st.ap, 5, '回合开始已结算过，改选不再扣/退');
  assert.equal(ps.funds, 2, '不重复发奖励');
  assert.deepEqual(st.visited, ['R1-N3'], 'visited 换成真正生效的那个，仍只有一条');
});

test('非法 pick：不在当前层/下一层的 id、空 id、非肉鸽局都返回 BAD_TARGET', () => {
  const { m, ps } = fakeMatch();
  m.rogueNodeBegin(1);
  assert.deepEqual(m.rogueNodePick(ps, 'R9-N1'), { error: 'BAD_TARGET' }, '隔层的 id');
  assert.deepEqual(m.rogueNodePick(ps, 'R1-N9'), { error: 'BAD_TARGET' }, '不存在的 id');
  assert.deepEqual(m.rogueNodePick(ps, ''), { error: 'BAD_TARGET' }, '空 id');
  const off = fakeMatch({ isRogue: false });
  assert.deepEqual(off.m.rogueNodePick(off.ps, 'R1-N1'), { error: 'BAD_TARGET' });
});

test('行动力不够付当前节点时本节点免费（不欠 AP），奖励照发', () => {
  const { m, ps } = fakeMatch();
  m.rogueNodeBegin(1); // funds 2、ap 5
  m._rogueNodes.ap = 0;
  const st = m.rogueNodeBegin(2); // R2-N1 cost 1 > 0，本层没有休整节点 → 免费
  assert.equal(st.current, 'R2-N1');
  assert.equal(st.ap, 1, '0 + reward.ap 1');
  assert.equal(ps.funds, 4, '2 + reward.funds 2');
});

test('第 14 层是首领层：默认 R14-N1、tier b、触发结局、没有下一层候选', () => {
  const { m, ps } = fakeMatch();
  const st = m.rogueNodeBegin(14);
  assert.equal(st.layer, 'R14');
  assert.equal(st.index, 13);
  assert.equal(st.current, 'R14-N1');
  assert.equal(st.tier, 'b');
  assert.deepEqual(st.choices.map((c) => c.id), ['R14-N1', 'R14-N2', 'R14-N3']);
  assert.equal(st.ended, true);
  assert.equal(st.nextRound, 0);
  assert.deepEqual(st.nextChoices, []);
  assert.equal(st.ap, 4, '5 − cost 1（首领奖励不带 AP）');
  assert.equal(ps.funds, 6);
  assert.equal(ps.lp, 6, '5 + reward.lp 1');
});

test('回合号超出层数时对齐最后一层并结束', () => {
  const { m } = fakeMatch();
  const st = m.rogueNodeBegin(99);
  assert.equal(st.index, 13);
  assert.equal(st.current, 'R14-N1');
  assert.equal(st.ended, true);
});

test('14 回合逐层推进：第 1–13 回合未结束，第 14 回合结束，visited 逐层累积 14 条', () => {
  const { m } = fakeMatch();
  for (let r = 1; r <= 13; r++) {
    const st = m.rogueNodeBegin(r);
    assert.equal(st.index, r - 1);
    assert.equal(st.layer, `R${r}`);
    assert.equal(st.ended, false, `第 ${r} 回合不该结束`);
  }
  const last = m.rogueNodeBegin(14);
  assert.equal(last.ended, true);
  assert.equal(last.visited.length, 14);
  assert.deepEqual(last.visited, [...new Set(last.visited)]);
});

test('非肉鸽局与缺数据表都安全返回 null', () => {
  const off = fakeMatch({ isRogue: false });
  assert.equal(off.m.rogueNodeBegin(1), null);
  assert.equal(off.m.rogueNodeState(), null);
  const none = fakeMatch({ raw: null });
  assert.equal(none.m.rogueNodeBegin(1), null);
  assert.equal(none.m.rogueNodeState(), null);
});
