// test/match/rogue-node-core.test.js — 对局层的肉鸽节点叠加层（NodeMixin）单测。
// 只测纯逻辑（候选 / 选择落地 / 地图层级 / 防护），不启动完整对局。
// 数据：plugins/roguelike-data-ro4/data/rogue-nodes.json（自设计，非官方）。

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Mixin } from '../../plugins/roguelike-core/server/match/NodeMixin.js';

const TABLE = JSON.parse(fs.readFileSync(
  new URL('../../plugins/roguelike-data-ro4/data/rogue-nodes.json', import.meta.url), 'utf8'));

/** 每种 tier 一张图：rogueStageFor 按 `rogue_ro4_<tier>-` 前缀在 gd.mode.stages 里挑。 */
const STAGES = [
  'rogue_ro4_1-a', 'rogue_ro4_2-a', 'rogue_ro4_3-a', 'rogue_ro4_4-a', 'rogue_ro4_5-a',
  'rogue_ro4_6-a', 'rogue_ro4_7-a', 'rogue_ro4_t-a', 'rogue_ro4_d-a', 'rogue_ro4_ev-a', 'rogue_ro4_b-a',
];

/**
 * 假对局 + 假地图池。
 * @param {{ isRogue?: boolean, raw?: object|null, stages?: string[], inactive?: string[] }} [opts]
 */
function makeSelf({ isRogue = true, raw = TABLE, stages = STAGES, inactive = [] } = {}) {
  const ps = {
    playerId: 'p1', alive: true, lp: 5, funds: 0, deployCapBonus: 0,
    addFunds(n) { this.funds += n; },
  };
  const self = Object.create(Mixin.prototype);
  Object.assign(self, {
    isRogue,
    round: 1,
    seed: 12345,
    gd: {
      raw: raw ? { 'rogue-nodes': raw } : {},
      lastRound: 14,
      mode: { stages },
      // gd.stage(id)：池外的 id 返回 null；inactive 里的图带 active: false（不可用）
      stage: (id) => (stages.includes(id) ? { id, active: !inactive.includes(id) } : null),
    },
    alivePlayers: () => [ps],
    markPublic() {},
    reportError() {},
    ps,
  });
  return self;
}

test('choices 长度 3：14 层每层都是 3 个候选，元素带 id/type/name/tier/cost/reward/available', () => {
  const s = makeSelf();
  for (let r = 1; r <= 14; r++) {
    const c = s.rogueNodeChoices(r);
    assert.equal(c.length, TABLE.rules.choices, `第 ${r} 层候选数`);
    for (const x of c) {
      assert.equal(typeof x.id, 'string');
      assert.equal(typeof x.type, 'string');
      assert.equal(typeof x.name, 'string');
      assert.equal(typeof x.tier, 'string');
      assert.equal(typeof x.cost, 'number');
      assert.equal(typeof x.reward, 'object');
      assert.equal(typeof x.available, 'boolean');
    }
  }
  assert.equal(s.rogueNodeChoices(1).length, 3);
  assert.deepEqual(s.rogueNodeChoices(1).map((x) => x.id), ['R1-N1', 'R1-N2', 'R1-N3']);
  assert.deepEqual(s.rogueNodeChoices(14).map((x) => x.id), ['R14-N1', 'R14-N2', 'R14-N3']);
});

test('choices 的 available 跟随行动力：够时全可用，扣空后全不可用', () => {
  const s = makeSelf();
  s.rogueNodeBegin(1); // ap 5
  assert.equal(s._rogueNodes.ap, 5);
  assert.deepEqual(s.rogueNodeChoices(1).map((x) => x.available), [true, true, true]);
  s._rogueNodes.ap = 0;
  assert.deepEqual(s.rogueNodeChoices(1).map((x) => x.available), [false, false, false]);
});

test('picks 生效：选下一层 → 下一回合落地；选当前层 → 立即换 current/tier 且奖励不重发', () => {
  const s = makeSelf();
  s.rogueNodeBegin(1); // R1-N1：funds 2
  const a = s.rogueNodePick(s.ps, 'R2-N2');
  assert.equal(a.current, 'R1-N1', '下一层的选择不改本回合');
  assert.equal(a.nextPicked, 'R2-N2');
  assert.equal(s.ps.funds, 2);
  const b = s.rogueNodeBegin(2);
  assert.equal(b.current, 'R2-N2');
  assert.equal(b.tier, '2');
  assert.equal(b.picked, 'R2-N2');
  assert.equal(s.ps.funds, 5, '2 + R2-N2 的 reward.funds 3');
  const c = s.rogueNodePick(s.ps, 'R2-N3');
  assert.equal(c.current, 'R2-N3', '当前层改选立即生效');
  assert.equal(c.tier, '3');
  assert.equal(s.ps.funds, 5, '同层改选不重发奖励');
});

test('stage 随 tier：R1 默认节点 tier 1 → rogue_ro4_1-*，改选同层 tier 3 节点后换图', () => {
  const s = makeSelf();
  s.rogueNodeBegin(1);
  assert.equal(s.rogueStageFor(1), 'rogue_ro4_1-a');
  assert.equal(s.rogueNodeState().mapId, 'rogue_ro4_1-a');
  s.rogueNodePick(s.ps, 'R1-N3'); // tier '3'
  assert.equal(s.rogueStageFor(1), 'rogue_ro4_3-a');
  assert.equal(s.rogueNodeState().mapId, 'rogue_ro4_3-a');
});

test('stage：首领层（tier b）取 rogue_ro4_b-*', () => {
  const s = makeSelf();
  s.rogueNodeBegin(14);
  assert.equal(s.rogueNodeState().tier, 'b');
  assert.equal(s.rogueStageFor(14), 'rogue_ro4_b-a');
  assert.equal(s.rogueNodeState().mapId, 'rogue_ro4_b-a');
});

test('stage：同 tier 多张图时按 seed 稳定选一张（同一局两次调用一致）', () => {
  const pool = ['rogue_ro4_1-a', 'rogue_ro4_1-b', 'rogue_ro4_1-c'];
  const s = makeSelf({ stages: pool });
  s.rogueNodeBegin(1);
  const a = s.rogueStageFor(1);
  const b = s.rogueStageFor(1);
  assert.ok(pool.includes(a), `期望池内的一张，实际 ${a}`);
  assert.equal(a, b);
});

test('stage：该 tier 没有可用图时返回 null（不编造，调用方落回原抽取）', () => {
  const s = makeSelf({ stages: ['rogue_ro4_1-a'] });
  s.rogueNodeBegin(1);
  assert.equal(s.rogueStageFor(1), 'rogue_ro4_1-a');
  s.rogueNodePick(s.ps, 'R1-N3'); // tier 3，池里没有 rogue_ro4_3- 图
  assert.equal(s.rogueStageFor(1), null);
  assert.equal(s.rogueNodeState().mapId, null);
});

test('stage：active: false 的图被跳过', () => {
  const s = makeSelf({ stages: ['rogue_ro4_1-a', 'rogue_ro4_1-b'], inactive: ['rogue_ro4_1-a'] });
  s.rogueNodeBegin(1);
  assert.equal(s.rogueStageFor(1), 'rogue_ro4_1-b');
});

test('非肉鸽局：四个入口都安全返回（null / [] / BAD_TARGET）', () => {
  const s = makeSelf({ isRogue: false });
  assert.equal(s.rogueNodeBegin(1), null);
  assert.deepEqual(s.rogueNodeChoices(1), []);
  assert.deepEqual(s.rogueNodePick(s.ps, 'R1-N1'), { error: 'BAD_TARGET' });
  assert.equal(s.rogueStageFor(1), null);
  assert.equal(s.rogueNodeState(), null);
});

test('无数据表：四个入口都安全返回（null / [] / BAD_TARGET）', () => {
  const s = makeSelf({ raw: null });
  assert.equal(s.rogueNodeBegin(1), null);
  assert.deepEqual(s.rogueNodeChoices(1), []);
  assert.deepEqual(s.rogueNodePick(s.ps, 'R1-N1'), { error: 'BAD_TARGET' });
  assert.equal(s.rogueStageFor(1), null);
  assert.equal(s.rogueNodeState(), null);
});
