// 2026-11-06 审计四条 PENDING 的回归：投放名单不给攻方看 / master 队长阵亡后投放权移交 /
// pendingLp 双向折账 / 盟约一阶阈值按本回合买得下几只封顶。
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { rosterHiddenFor } from '../../plugins/mota/shared/constants.js';
import { monsterBondThresholds, factionThresholdsOf } from '../../plugins/mota/server/match/monsterBonds.js';
import { Match } from '../../plugins/mota/server/match/Match.js';

// ---------------------------------------------------------------------------
// 1) 投放名单只给对面看（业主 2026-11-06：「投放方不显示投放名单，仅对面显示」）
// ---------------------------------------------------------------------------
test('投放名单：攻方那一队看不到，守方照常看', () => {
  const pub = { attackingTeam: 'red', defenderTeam: 'blue' };
  assert.equal(rosterHiddenFor(pub, 'red'), true, '攻方不该看投放名单');
  assert.equal(rosterHiddenFor(pub, 'blue'), false, '守方要看');
});

test('投放名单：非攻守回合 / 观战 / 拿不到队伍 → 照常渲染（与改造前一致）', () => {
  assert.equal(rosterHiddenFor({ attackingTeam: null }, 'red'), false);
  assert.equal(rosterHiddenFor({}, 'red'), false);
  assert.equal(rosterHiddenFor(null, 'red'), false);
  assert.equal(rosterHiddenFor({ attackingTeam: 'red' }, null), false);
  assert.equal(rosterHiddenFor({ attackingTeam: 'red' }, undefined), false);
});

// ---------------------------------------------------------------------------
// 2) 盟约一阶阈值：不能高过「本回合买得下几只」
// ---------------------------------------------------------------------------
/** 造一个只够 factionPoolCounts 走缓存命中的 m。 */
const bondM = (counts, { share = Infinity, median = 1 } = {}) => ({
  round: 0,
  _roundOfficialSpawns: null,
  _bondFactionPool: { stamp: null, round: 0, counts: new Map(Object.entries(counts)) },
  monsterFundsSharePerAttacker: () => share,
  confrontPoolMedianValue: () => median,
});

test('阵营条：池里 90 只 REUNION ⇒ 一阶 14，军费买得下 5 只时压到 5，二三阶仍严格递增', () => {
  assert.deepEqual(factionThresholdsOf(90), [14, 27, 41], '原始比例（未封顶）');
  assert.deepEqual(monsterBondThresholds(bondM({ REUNION: 90 }, { share: 5, median: 1 }), 'REUNION'), [5, 27, 41]);
});

test('阵营条：军费够买 20 只时不封顶（一阶仍是 14）', () => {
  assert.deepEqual(monsterBondThresholds(bondM({ REUNION: 90 }, { share: 20, median: 1 }), 'REUNION'), [14, 27, 41]);
});

test('阵营条：拿不到军费 / 中位价（旧对局、非对抗局）⇒ 不设上界，行为与改造前一致', () => {
  assert.deepEqual(monsterBondThresholds(bondM({ REUNION: 90 }), 'REUNION'), [14, 27, 41]);
  assert.deepEqual(monsterBondThresholds(bondM({ REUNION: 90 }, { share: 5, median: 0 }), 'REUNION'), [14, 27, 41]);
});

test('阵营条：本回合一只都买不起时一阶仍 ≥ 1（形态占位，不塌成 0）', () => {
  const t = monsterBondThresholds(bondM({ REUNION: 90 }, { share: 0, median: 4 }), 'REUNION');
  assert.equal(t[0], 1);
  assert.ok(t[1] > t[0] && t[2] > t[1], '三阶必须严格递增');
});

test('通用条（增援 / 回收）不受回合封顶影响', () => {
  const m = bondM({}, { share: 1, median: 1 });
  assert.deepEqual(monsterBondThresholds(m, 'reinforce'), [2, 4, 6]);
  assert.deepEqual(monsterBondThresholds(m, 'recover'), [2, 4, 6]);
  assert.deepEqual(monsterBondThresholds(m, 'concert'), [2, 3, 4]);
});

// ---------------------------------------------------------------------------
// 3) pendingLp / 共享血池：外部写入**双向**折账（加血不再被下一次拆池抹掉）
// ---------------------------------------------------------------------------
const lpFixture = () => {
  const a = { playerId: 'a', lp: 10, alive: true };
  const b = { playerId: 'b', lp: 10, alive: true };
  const m = {
    isVersus: true,
    teamLps: new Map([[0, 20]]),
    teamLp: 20,
    order: [a, b],
    matchTeamIds: () => [0],
    teamIdOf: () => 0,
  };
  Match.prototype._syncVersusTeamLp.call(m);
  return { m, a, b };
};

test('共享血池：外部**扣血**折进池（kingCrystal −2 不再被覆盖）', () => {
  const { m, a } = lpFixture();
  assert.equal(m.teamLps.get(0), 20);
  a.lp -= 2;                                   // 外部写入（match/meltdown.js applyRelicLpDrain）
  Match.prototype._syncVersusTeamLp.call(m);
  assert.equal(m.teamLps.get(0), 18);
  assert.equal(a.lp + 0 + 0 >= 0, true);
});

test('共享血池：外部**加血**同样折进池（meltdown 事件回血 / revival 救回 lp=1）', () => {
  const { m, a } = lpFixture();
  a.lp += 3;                                   // 外部写入（事件加血）
  Match.prototype._syncVersusTeamLp.call(m);
  assert.equal(m.teamLps.get(0), 23, '加血必须进池，否则下一次拆池就抹掉');
  Match.prototype._syncVersusTeamLp.call(m);   // 再拆一次：没有新的外部写入 ⇒ 池不变（不会重复累加）
  assert.equal(m.teamLps.get(0), 23);
});

test('共享血池：单人队的外部加血也折进池（meltdown 事件回血）', () => {
  const a = { playerId: 'a', lp: 12, alive: true };
  const m = { isVersus: true, teamLps: new Map([[0, 12]]), teamLp: 12, order: [a], matchTeamIds: () => [0], teamIdOf: () => 0 };
  Match.prototype._syncVersusTeamLp.call(m);
  a.lp = 15;                                   // 外部写入：事件回血 +3
  Match.prototype._syncVersusTeamLp.call(m);
  assert.equal(m.teamLps.get(0), 15);
  assert.equal(a.lp, 15, '池是权威，拆回来的仍是 15');
});

test('共享血池：成员离开后基线被清掉 ⇒ 回来后不会按旧值误折', () => {
  const { m, a, b } = lpFixture();
  a.alive = false;                             // 淘汰 / 退出：不再参与拆分
  Match.prototype._syncVersusTeamLp.call(m);
  assert.equal(b.lp, 20, '整池归活着的 b');
  a.alive = true;                              // 回来（复活）
  Match.prototype._syncVersusTeamLp.call(m);
  assert.equal(m.teamLps.get(0), 20, '旧基线已随上一轮拆分清掉，不会把池误缩');
});

// ---------------------------------------------------------------------------
// 4) master 队长阵亡 ⇒ 投放权（含草稿）移交给下一位存活攻方
// ---------------------------------------------------------------------------
const opFixture = ({ mode = 'master', actors = null } = {}) => {
  const a = { playerId: 'a', alive: false, left: false, monsterShop: { open: true }, monsterDraft: { picks: [{ enemyKey: 'x' }, { enemyKey: 'y' }], seq: 2 }, monsterSpentOwn: 3 };
  const b = { playerId: 'b', alive: true, left: false, monsterShop: null, monsterDraft: null };
  const c = { playerId: 'c', alive: true, left: false, monsterShop: null, monsterDraft: null };
  const m = {
    monsterShopOn: true,
    monsterMode: mode,
    phase: 'PREP',
    confrontStage: null,
    order: [a, b, c],
    confrontActive: () => true,
    confrontActors: () => (actors ? actors(a, b, c) : [b, c]),
    monsterPlaceActor(p) { return p === b; },
  };
  return { m, a, b, c };
};

test('master：队长阵亡后，投放权与已投放的草稿一起交给下一位，旧队长关店', () => {
  const { m } = opFixture();
  const plan = Match.prototype.monsterOperatorPlan.call(m);
  assert.equal(plan.apply, true);
  assert.deepEqual(plan.open.map((x) => x.ps.playerId), ['b']);
  assert.equal(plan.open[0].from.playerId, 'a', 'master 是队级资源，草稿要跟着走');
  assert.deepEqual(plan.close.map((x) => x.playerId), ['a'], '旧队长手里那间店要关掉（改发只读帧）');
});

test('master：已经开着店的那位不会被重复开一次（幂等）', () => {
  const { m, b } = opFixture();
  b.monsterShop = { open: true };
  const plan = Match.prototype.monsterOperatorPlan.call(m);
  assert.deepEqual(plan.open, []);
});

test('solo：按人的池，不做跨人草稿移交（只给新队长开一间干净的店）', () => {
  const { m } = opFixture({ mode: 'solo' });
  const plan = Match.prototype.monsterOperatorPlan.call(m);
  assert.equal(plan.open.length, 1);
  assert.equal(plan.open[0].from, null, 'solo 的池按 playerId，跨人移交会指向别人的卡');
  assert.deepEqual(plan.close.map((x) => x.playerId), ['a']);
});

test('shared / 商店关着 / 不在投放窗口 ⇒ 计划为空（一个字段都不写）', () => {
  for (const patch of [{ monsterMode: 'shared' }, { monsterShopOn: false }, { phase: 'COMBAT' }, { confrontStage: 'roster' }]) {
    const { m } = opFixture();
    Object.assign(m, patch);
    const plan = Match.prototype.monsterOperatorPlan.call(m);
    assert.deepEqual(plan, { apply: false, open: [], close: [] }, JSON.stringify(patch));
  }
});
