// test/match/rogue-map-pool.test.js — 肉鸽「地图主题池」 (room.create { mapPool }; shared/rogueThemes.js, 2026-11-06)。
//
// 只测纯逻辑（不启动完整对局）：
//   ① 常量表的口径（all + ro1…ro6；ro7 / foo 不算池）
//   ② MatchPhases._stagePool 只留该主题的 `rogue_ro<N>_*`
//   ③ 'all' 与没有这个开关时逐项一致（集合相等）
//   ④ 主题内 tier 缺口兜底（ro1 没有 7 层 → 同主题可战斗图，不跨主题）
//   ⑤ 非法池回落 'all'
//   ⑥ 开局图（waves.setupMatchWaves）同样只从该主题里抽

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { POOL_IDS, isPool, poolName, poolPrefix, normalizePool } from '../../shared/rogueThemes.js';
import { MatchPhases } from '../../plugins/mota/server/match/match/phases.js';
import { Mixin } from '../../plugins/roguelike-core/server/match/NodeMixin.js';
import { setupMatchWaves } from '../../plugins/mota/server/match/waves.js';
import { createRng } from '../../plugins/mota/server/sim/rng.js';

// ---------------------------------------------------------------------------------------------
// ① 常量表
// ---------------------------------------------------------------------------------------------

test('① 池 id：all + ro1…ro6 共 7 个；ro7 / foo / 大小写变体都不算', () => {
  assert.deepEqual([...POOL_IDS], ['all', 'ro1', 'ro2', 'ro3', 'ro4', 'ro5', 'ro6']);
  for (const id of POOL_IDS) assert.equal(isPool(id), true, `${id} 应是合法池`);
  for (const bad of ['ro7', 'ro0', 'foo', 'RO1', 'ro', '', null, undefined, 1, {}, []]) {
    assert.equal(isPool(bad), false, `${String(bad)} 不应是合法池`);
  }
  // 官方全名（activity_table.json 的 dis_rogue_1..6）
  assert.deepEqual(
    POOL_IDS.map((id) => poolName(id)),
    ['全部主题', '傀影与猩红孤钻', '水月与深蓝之树', '探索者的银凇止境', '萨卡兹的无终奇语', '岁的界园志异', '沉沦者的黑流树海']);
  assert.equal(poolName('ro7'), '', '非法池不编造名字');
  assert.equal(poolPrefix('ro2'), 'rogue_ro2_');
  assert.equal(poolPrefix('all'), '', 'all 不收窄');
  assert.equal(poolPrefix('foo'), '', '非法值不收窄');
  assert.equal(normalizePool('ro5'), 'ro5');
  assert.equal(normalizePool('ro7'), 'all');
  assert.equal(normalizePool(undefined), 'all');
});

// ---------------------------------------------------------------------------------------------
// ②③⑤ MatchPhases._stagePool
// ---------------------------------------------------------------------------------------------

/** 只带 _stagePool 需要的字段的假对局（方法容器：this 就是 match）。 */
function fakePool({ stages, sceneStages = null, incompleteMaps = false, rogueMapPool } = {}) {
  return {
    gd: { mode: { stages }, ...(sceneStages ? { sceneStages } : {}) },
    sceneStages,
    incompleteMaps,
    ...(rogueMapPool === undefined ? {} : { rogueMapPool }),
  };
}

const MIXED = [
  'rogue_ro1_1-a', 'rogue_ro2_1-a', 'rogue_ro2_2-a', 'rogue_ro2_b-a', 'rogue_ro6_3-a',
  'act1autochess_m01', 'rogue_ro2_1-b_dlc1',
];

test('② _stagePool：选了 ro2 后每张图都以 rogue_ro2_ 开头', () => {
  const self = fakePool({
    stages: MIXED,
    sceneStages: new Set(['rogue_ro1_1-a', 'rogue_ro2_1-a', 'act1autochess_m01']),
    rogueMapPool: 'ro2',
  });
  const pool = MatchPhases.prototype._stagePool.call(self);
  assert.ok(pool.length > 0, 'ro2 池不该为空');
  for (const id of pool) assert.ok(id.startsWith('rogue_ro2_'), `${id} 不在 ro2 主题里`);
  // 场景包收窄仍在主题内做：ro2 里只有 1-a 有场景包
  assert.deepEqual(pool, ['rogue_ro2_1-a']);
});

test('② _stagePool：主题内没有一张带场景包时回该主题全量（不回全局）', () => {
  const self = fakePool({
    stages: MIXED,
    sceneStages: new Set(['rogue_ro1_1-a', 'act1autochess_m01']),
    rogueMapPool: 'ro2',
  });
  const pool = MatchPhases.prototype._stagePool.call(self);
  assert.deepEqual(pool, ['rogue_ro2_1-a', 'rogue_ro2_2-a', 'rogue_ro2_b-a', 'rogue_ro2_1-b_dlc1']);
});

test("③ 'all' 与没有这个开关（rogueMapPool 缺省）逐项一致", () => {
  for (const sceneStages of [null, new Set(['rogue_ro1_1-a', 'rogue_ro2_1-a', 'act1autochess_m01'])]) {
    for (const incompleteMaps of [false, true]) {
      const before = MatchPhases.prototype._stagePool.call(fakePool({ stages: MIXED, sceneStages, incompleteMaps }));
      const after = MatchPhases.prototype._stagePool.call(fakePool({ stages: MIXED, sceneStages, incompleteMaps, rogueMapPool: 'all' }));
      assert.deepEqual(after, before, `scene=${!!sceneStages} incompleteMaps=${incompleteMaps} 下 'all' 必须与今天一致`);
    }
  }
});

test("⑤ 非法池（ro7 / foo / 数字）回落 'all'，与缺省完全一致", () => {
  const baseline = MatchPhases.prototype._stagePool.call(fakePool({ stages: MIXED }));
  for (const bad of ['ro7', 'foo', '', 7, null, {}]) {
    const pool = MatchPhases.prototype._stagePool.call(fakePool({ stages: MIXED, rogueMapPool: bad }));
    assert.deepEqual(pool, baseline, `${String(bad)} 应回落 'all'`);
  }
});

// ---------------------------------------------------------------------------------------------
// ④ NodeMixin.rogueStageFor 的主题内 tier 兜底
// ---------------------------------------------------------------------------------------------

/** 只带 NodeMixin 需要的字段的假对局；nodes 决定本回合的 tier。 */
function fakeNodeMatch({ stages, rogueMapPool, tier = '7', inactive = [] } = {}) {
  const table = {
    rules: { startAp: 1, maxAp: 1 },
    layers: [{ id: 'R1', name: '第一层', nodes: [{ id: 'N1', name: 'n1', type: 'battle', tier, cost: 0, reward: {} }] }],
  };
  const self = Object.create(Mixin.prototype);
  Object.assign(self, {
    isRogue: true,
    round: 1,
    seed: 12345,
    rogueMapPool,
    gd: {
      raw: { 'rogue-nodes': table },
      mode: { stages },
      stage: (id) => (stages.includes(id) ? { id, active: !inactive.includes(id) } : null),
    },
    alivePlayers: () => [],
    markPublic() {},
    reportError() {},
  });
  return self;
}

test('④ 主题内 tier 缺口：ro1 没有第 7 层 → 抽同主题的可战斗图，不跨主题', () => {
  const stages = ['rogue_ro1_1-a', 'rogue_ro1_t-a', 'rogue_ro1_ev-a', 'rogue_ro2_7-a'];
  const s = fakeNodeMatch({ stages, rogueMapPool: 'ro1', tier: '7' });
  const got = s.rogueStageFor(1);
  assert.ok(got && got.startsWith('rogue_ro1_'), `实际 ${got} 应仍在 ro1 主题内`);
  assert.ok(['rogue_ro1_1-a', 'rogue_ro1_t-a'].includes(got), `实际 ${got} 应是可战斗 tier（1..7/t/b）的图`);
  // 同一局两次调用一致（稳定抽取）
  assert.equal(s.rogueStageFor(1), got);
});

test("④ 同一份数据换成 'all'：仍按老行为抽跨主题的第 7 层图", () => {
  const stages = ['rogue_ro1_1-a', 'rogue_ro1_t-a', 'rogue_ro1_ev-a', 'rogue_ro2_7-a'];
  const s = fakeNodeMatch({ stages, rogueMapPool: 'all', tier: '7' });
  assert.equal(s.rogueStageFor(1), 'rogue_ro2_7-a');
});

test('④ 主题内只剩非战斗 tier（ev）时兜底到主题内任意可用图；主题一张都没有才 null', () => {
  const onlyEvent = fakeNodeMatch({ stages: ['rogue_ro1_ev-a', 'rogue_ro2_7-a'], rogueMapPool: 'ro1', tier: '7' });
  assert.equal(onlyEvent.rogueStageFor(1), 'rogue_ro1_ev-a', '主题内任意可用图兜底');
  const noneInTheme = fakeNodeMatch({ stages: ['rogue_ro2_7-a'], rogueMapPool: 'ro1', tier: '7' });
  assert.equal(noneInTheme.rogueStageFor(1), null, '该主题一张可用图都没有 → null，不回全局');
});

test("⑤ rogueStageFor：非法池回落 'all'（与缺省同图）", () => {
  const stages = ['rogue_ro1_1-a', 'rogue_ro2_7-a'];
  for (const bad of ['ro9', 'foo', undefined]) {
    const a = fakeNodeMatch({ stages, rogueMapPool: bad, tier: '7' }).rogueStageFor(1);
    const b = fakeNodeMatch({ stages, rogueMapPool: 'all', tier: '7' }).rogueStageFor(1);
    assert.equal(a, b, `${String(bad)} 应与 'all' 一致`);
  }
});

// ---------------------------------------------------------------------------------------------
// ⑥ 开局图（waves.setupMatchWaves）
// ---------------------------------------------------------------------------------------------

/** 只带 setupMatchWaves 需要的字段的假 gd。 */
function fakeGd({ stages, rogueMapPool, active = [] } = {}) {
  const raw = Object.fromEntries(stages.map((id) => [id, { id, weight: 1, active: active.length ? active.includes(id) : true }]));
  return {
    mode: { stages },
    raw: { stages: raw },
    factions: { types: {}, generation: {} },
    bossWeights: () => [],
    hiddenBossWeights: () => [],
    hiddenRound: 0,
    allowIncompleteMaps: true,
    stage: (id) => (raw[id] ? { ...raw[id] } : null),
    ...(rogueMapPool === undefined ? {} : { rogueMapPool }),
  };
}

test('⑥ 开局图：选了 ro6 就只从 rogue_ro6_ 里抽；该主题无图时是 null', () => {
  const stages = ['rogue_ro1_1-a', 'rogue_ro6_1-a', 'rogue_ro6_2-a', 'act1autochess_m01'];
  for (let seed = 1; seed <= 8; seed++) {
    const { stageId } = setupMatchWaves(fakeGd({ stages, rogueMapPool: 'ro6' }), createRng(seed));
    assert.ok(stageId && stageId.startsWith('rogue_ro6_'), `seed ${seed} 抽到 ${stageId}`);
  }
  const none = setupMatchWaves(fakeGd({ stages: ['rogue_ro1_1-a'], rogueMapPool: 'ro6' }), createRng(1));
  assert.equal(none.stageId, null, '该主题一张图都没有 → null（不回全局）');
  // 'all' 与缺省一致
  const all = setupMatchWaves(fakeGd({ stages, rogueMapPool: 'all' }), createRng(3)).stageId;
  const before = setupMatchWaves(fakeGd({ stages }), createRng(3)).stageId;
  assert.equal(all, before);
});
