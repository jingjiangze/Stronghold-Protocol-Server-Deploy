// 肉鸽模式的三大随机元素 + 紧急作战 + 幂等聚合（业主 2026-11-01「完成完整肉鸽模式」）。
// 直接调实现（不复制逻辑）：这些函数都在 MatchMeltdown.prototype 上，用一个最小 `this` 就能跑。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MatchMeltdown, relicEffectApplied } from '../../plugins/mota/server/match/match/meltdown.js';
// 肉鸽的随机元素（不期而遇 / 词缀 / 紧急作战）2026-11-01 迁到独立插件 rogue，用它的 Mixin 原型来测
import { Mixin as RogueMixin } from '../../plugins/rogue/server/match/RogueMixin.js';
import { rangeTileKeys } from '../../plugins/mota/server/match/player/round.js';

const RELICS = JSON.parse(fs.readFileSync(new URL('../../plugins/relics-87/data/relics.json', import.meta.url), 'utf8'));

/** 只够这些纯函数跑起来的最小 self。 */
function fakeMatch({ isRogue = true, round = 1, seed = 20261101, relics = [], modeId = 'mode_multi_normal' } = {}) {
  const ps = { playerId: 'p_0', alive: true, relics: relics.slice(), rogueAffixBonus: null };
  return {
    ps,
    self: {
      modeId, isRogue, round, seed,
      gd: { raw: { relics: RELICS } },
      players: new Map([[ps.playerId, ps]]),
      alivePlayers: () => [ps],
      // 纯函数借过来
      relicPool: MatchMeltdown.prototype.relicPool,
      relicDraftRound: MatchMeltdown.prototype.relicDraftRound,
      relicEnemyMul: MatchMeltdown.prototype.relicEnemyMul,
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      activeBondsOf: MatchMeltdown.prototype.activeBondsOf,
      rogueEventRound: RogueMixin.prototype.rogueEventRound,
      rogueRoundAffix: RogueMixin.prototype.rogueRoundAffix,
      rogueEmergencyRound: RogueMixin.prototype.rogueEmergencyRound,
    },
  };
}

test('藏品节奏：肉鸽 = 开局 + 每 2 回合；协同共竞 = R4/R8/R12', () => {
  const rogue = (r) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: true }, r);
  const xie = (r) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: false }, r);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(rogue), [true, true, false, true, false, true]);
  assert.deepEqual([1, 2, 3, 4, 8, 12, 13].map(xie), [false, false, false, true, true, true, false]);
});

test('不期而遇：回合表是 R3 / R6 / R9', () => {
  // 注意：`rogueEventRound(r)` 本身只看回合（不判 isRogue），"只有肉鸽才有"这道门在 phases.js 的调用点
  // （`if (this.isRogue === true && ... rogueEventRound(r))`）—— 测试按实现如实断言，避免把调用点的门写进纯函数测试。
  const at = (r) => RogueMixin.prototype.rogueEventRound.call({ isRogue: true }, r);
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(at),
    [false, false, true, false, false, true, false, false, true, false]);
});

test('紧急作战：只在 R5 / R9（肉鸽专属）', () => {
  const at = (r, isRogue = true) => RogueMixin.prototype.rogueEmergencyRound.call({ isRogue }, r);
  assert.deepEqual([4, 5, 6, 8, 9, 10].map((r) => at(r)), [false, true, false, false, true, false]);
  assert.equal(at(5, false), false);
});

test('每回合词缀：确定性（同 seed 同回合恒定）、三档之一、协同/普通房没有', () => {
  const aff = (round, seed = 7) => RogueMixin.prototype.rogueRoundAffix.call({ isRogue: true, seed }, round);
  const a1 = aff(4), a2 = aff(4);
  assert.deepEqual(a1, a2, '同 seed 同回合必须一致');
  for (const r of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
    const a = aff(r);
    assert.ok(['hp', 'atk', 'speed'].includes(a.kind), `R${r} 的词缀种类异常：${a && a.kind}`);
    assert.ok(Number.isFinite(a.mul) && a.mul > 0 && a.mul < 1, '倍率应是 0~1 的小数');
    assert.ok(typeof a.label === 'string' && a.label.length > 0);
  }
  assert.equal(RogueMixin.prototype.rogueRoundAffix.call({ isRogue: false, seed: 7 }, 4), null);
});

test('敌人修正聚合：词缀 + 紧急作战都进同一个 acc（幂等由 combat.js 的 relicApplied 保证）', () => {
  // R5 是紧急作战：hp +0.25 / atk +0.2；词缀另加一档
  const { self } = fakeMatch({ round: 5 });
  const mul = self.relicEnemyMul();
  const aff = self.rogueRoundAffix(5);
  const expectHp = 0.25 + (aff.kind === 'hp' ? aff.mul : 0);
  const expectAtk = 0.2 + (aff.kind === 'atk' ? aff.mul : 0);
  assert.ok(Math.abs(mul.hp - expectHp) < 1e-9, `hp=${mul.hp} != ${expectHp}`);
  assert.ok(Math.abs(mul.atk - expectAtk) < 1e-9, `atk=${mul.atk} != ${expectAtk}`);
  // R4 没有紧急作战
  const r4 = fakeMatch({ round: 4 }).self.relicEnemyMul();
  assert.ok(r4.hp < 0.25 + 1e-9, 'R4 不该吃到紧急作战的 +25%');
});

test('藏品里的 enemy/enemyRank 会累加进敌人修正；非肉鸽房没有词缀/紧急作战', () => {
  // n06（莱塔尼亚权杖·重铸）带 effect.enemy —— p40/p45 是 rule/allyPerBench 类，不参与敌人乘区
  const withRelic = fakeMatch({ isRogue: false, relics: ['n06'] }).self.relicEnemyMul();
  const without = fakeMatch({ isRogue: false, relics: [] }).self.relicEnemyMul();
  assert.notDeepEqual(withRelic, without, '带 enemy 类藏品的敌人修正应不同（n06）');
  // 非肉鸽：没有词缀与紧急作战，回合不改变结果
  const a = fakeMatch({ isRogue: false, round: 5 }).self.relicEnemyMul();
  const b = fakeMatch({ isRogue: false, round: 4 }).self.relicEnemyMul();
  assert.deepEqual(a, b, '非肉鸽房不该因回合变化而改变敌人修正');
});

test('藏品池：87 条、按 id 去重、排除已拥有', () => {
  const { self } = fakeMatch();
  const pool = self.relicPool();
  assert.equal(pool.length, 87, 'relics-87 应提供 87 条');
  assert.equal(new Set(pool.map((r) => r.id)).size, pool.length, 'id 不许重复');
  assert.ok(pool.every((r) => typeof r.id === 'string' && r.id));
});

test('藏品的「本局是否真生效」标记：enemy/immediate/deployCap/lpCap 算生效，rule 类不算', () => {
  assert.equal(relicEffectApplied({ enemy: { atk: 0.1 } }), true);
  assert.equal(relicEffectApplied({ enemyRank: { BOSS: { hp: 0.1 } } }), true);
  assert.equal(relicEffectApplied({ immediate: { funds: 3 } }), true);
  assert.equal(relicEffectApplied({ deployCap: 1 }), true);
  assert.equal(relicEffectApplied({ lpCap: 2 }), true);
  assert.equal(relicEffectApplied({ rule: { id: 'noSuchRule' } }), false, '未知 / 未接入的 rule 不算生效');
  assert.equal(relicEffectApplied({ rule: { id: 'fundsDrain' } }), true, '经济类 rule 已接入');
  assert.equal(relicEffectApplied({ ally: { atk: 0.1 } }), true, 'ally 类已接入（2026-11-03）');
  assert.equal(relicEffectApplied(null), false);
  // 数据侧盘点：87 条里「有已实现效果」的那批要够用，且 rule 类一律标未生效（诚实暴露给 HUD）
  const relics = RELICS.relics;
  const applied = relics.filter((r) => relicEffectApplied(r.effect)).length;
  const ruleInert = relics.filter((r) => { const e = r.effect || {}; return !!e.rule && !relicEffectApplied(e); }).length;
  assert.ok(applied >= 30, `有实现效果的藏品过少：${applied}/${relics.length}`);
  // 2026-11-02：57 条 rule 已全部接入；这条只留作「未来新增数据时」的可见提示（不再要求一定有未实装项）
  assert.ok(ruleInert >= 0, `未实装 rule 数异常：${ruleInert}`);
  assert.equal(applied + relics.filter((r) => !relicEffectApplied(r.effect)).length, relics.length, '未生效 = 总数 - 已生效');
});

test('抽卡池只发「效果已接实现」的藏品（死牌不进三选一），且数据异常时兜底回全池', () => {
  const { self } = fakeMatch();
  self.relicDraftPool = MatchMeltdown.prototype.relicDraftPool;
  const pool = self.relicDraftPool();
  assert.ok(pool.length > 0);
  assert.ok(pool.every((r) => relicEffectApplied(r.effect)), '池子里不许有未实装的藏品');
  // 2026-11-03：87 条全部接入后池子 = 全池；这条只保证「不会出现未实装卡」
  assert.ok(pool.length <= self.relicPool().length, '池子不能比全池还大');
  // 兜底：数据里一条已实现的都没有时，退回全池而不是空池
  const noLive = { gd: { raw: { relics: { relics: [{ id: 'x1', effect: { rule: { id: 'whatever' } } }] } } },
    relicPool: MatchMeltdown.prototype.relicPool, relicDraftPool: MatchMeltdown.prototype.relicDraftPool };
  assert.equal(noLive.relicDraftPool().length, 1, '没有已实现藏品时退回全池');
});

test('rule 类藏品：ussuri / leaderHalve / enemyDmgTaken / enemyCount 已接实现（语义照官方 desc）', () => {
  const { self } = fakeMatch({ isRogue: false, relics: ['n04'] }); // n04 = 乌萨斯弯刀（ussuri）
  const withUssuri = self.relicEnemyMul();
  // desc：「敌方攻击/防御/生命 +35%，每进入新回合额外 +10%」—— fake 的 round=1 ⇒ 至少 +35%
  assert.ok(withUssuri.hp >= 0.35 - 1e-9, `ussuri 至少要 +35%，实际 ${withUssuri.hp}`);
  assert.ok(withUssuri.atk >= 0.35 - 1e-9);
  // 第 3 回合应更高（+35% + 2×10%）
  const r3 = fakeMatch({ isRogue: false, round: 3, relics: ['n04'] }).self.relicEnemyMul();
  assert.ok(r3.hp > withUssuri.hp + 0.1, 'ussuri 每回合递增');

  // enemyDmgTaken：敌人受伤 −20% ⇒ 等效生命 +25%（近似）
  const dmg = fakeMatch({ isRogue: false, relics: ['n26'] }).self.relicEnemyMul();
  assert.ok(Math.abs(dmg.hp - (1 / 0.8 - 1)) < 1e-9, `enemyDmgTaken 近似应为 +25%，实际 ${dmg.hp}`);

  // 三条 rule 现在都算「已实现」⇒ 会进抽卡池
  for (const id of ['n04', 'n05', 'n26', 'n35']) {
    const def = RELICS.relics.find((r) => r.id === id);
    assert.equal(relicEffectApplied(def.effect), true, `${id} 应算已实现`);
  }
});

test('rule 收集器：同一件藏品只算一次、跨玩家去重', () => {
  const raw = { gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
    players: new Map([['a', { playerId: 'a', relics: ['n04', 'n04'] }], ['b', { playerId: 'b', relics: ['n04'] }]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    activeBondsOf: MatchMeltdown.prototype.activeBondsOf };
  assert.equal(raw.relicRuleParams('ussuri').length, 1, '同一件藏品只算一次');
});

test('rule 经济：fundsDrain 每回合 −1、最多 5 次；kingCrystal 休整期资金 +5；loseAllFunds 入手清零', () => {
  const mkPs = (relics, funds = 10) => ({ playerId: 'p0', relics: relics.slice(), funds,
    addFunds(n) { this.funds += n; }, dirty() {} });
  const mkSelf = (ps) => ({ gd: { raw: { relics: RELICS } }, players: new Map([[ps.playerId, ps]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    applyRelicRoundEconomy: MatchMeltdown.prototype.applyRelicRoundEconomy,
    relicGrantInstant: MatchMeltdown.prototype.relicGrantInstant });

  const drainPs = mkPs(['n03'], 10);
  const drainSelf = mkSelf(drainPs);
  for (let i = 0; i < 8; i++) drainSelf.applyRelicRoundEconomy();
  assert.equal(drainPs.funds, 5, '8 个回合也只失去 5 点（max=5）');

  const kingPs = mkPs(['p21'], 0);
  mkSelf(kingPs).applyRelicRoundEconomy();
  assert.equal(kingPs.funds, 5, 'kingCrystal：休整期资金 +5');

  const losePs = mkPs(['n34'], 12);
  const loseSelf = mkSelf(losePs);
  const def = RELICS.relics.find((r) => r.id === 'n34');
  loseSelf.relicGrantInstant(losePs, def);
  assert.equal(losePs.funds, 0, 'loseAllFunds：入手清空资金');

  for (const id of ['n03', 'p21', 'n34']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('rule 第三组：postBattleFunds 每战 +1、choiceFunds 每次选择 +8、enemyRamp 开局 +step', () => {
  const mkPs = (relics, funds = 0) => ({ playerId: 'p0', relics: relics.slice(), funds,
    addFunds(n) { this.funds += n; }, dirty() {} });
  const mkSelf = (ps) => ({ gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
    players: new Map([[ps.playerId, ps]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    applyRelicPostBattle: MatchMeltdown.prototype.applyRelicPostBattle,
    applyRelicChoiceFunds: MatchMeltdown.prototype.applyRelicChoiceFunds,
    relicEnemyMul: MatchMeltdown.prototype.relicEnemyMul,
    activeBondsOf: MatchMeltdown.prototype.activeBondsOf });

  const battlePs = mkPs(['p07'], 0);
  const battleSelf = mkSelf(battlePs);
  battleSelf.applyRelicPostBattle();
  battleSelf.applyRelicPostBattle();
  assert.equal(battlePs.funds, 2, '每场战斗 +1（两次 = 2）');

  const choicePs = mkPs(['p28'], 0);
  mkSelf(choicePs).applyRelicChoiceFunds(choicePs);
  assert.equal(choicePs.funds, 8, '每次选择 +8');

  const ramp = mkSelf(mkPs(['n40'], 0)).relicEnemyMul();
  assert.ok(ramp.hp >= 0.1 - 1e-9 && ramp.atk >= 0.1 - 1e-9, `enemyRamp 开局那一档应 ≥ +10%，实际 ${ramp.hp}`);

  for (const id of ['p07', 'p28', 'n40']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('己方属性通道：atkPerBond 按激活盟约数、atkPerRound 按已过回合（封顶 10）', () => {
  const mk = (relics, { round = 1, bonds = 0 } = {}) => {
    const ps = { playerId: 'p0', relics: relics.slice(), bonds: Object.fromEntries(
      Array.from({ length: bonds }, (_, i) => ['b' + i, { active: true }])) };
    const self = { gd: { raw: { relics: RELICS } }, round, isRogue: false,
      players: new Map([['p0', ps]]),
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      activeBondsOf: MatchMeltdown.prototype.activeBondsOf,
      relicAllyMul: MatchMeltdown.prototype.relicAllyMul };
    return self.relicAllyMul(ps);
  };
  assert.equal(mk(['p16'], { bonds: 0 }), null, '没有激活盟约就没有加成');
  assert.ok(Math.abs(mk(['p16'], { bonds: 3 }).atkMul - 1.3) < 1e-9, '每 1 个盟约 +10% → 3 个 = 1.3');
  assert.ok(Math.abs(mk(['p34'], { round: 5 }).atkMul - 1.6) < 1e-9, '4 个已过回合 × 15% = 1.6');
  assert.ok(Math.abs(mk(['p34'], { round: 20 }).atkMul - (1 + 0.15 * 10)) < 1e-9, '最多叠 10 次');
  for (const id of ['p16', 'p34']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('己方属性：atkPerEquip 按棋盘装备数、atkPerBenchItem 按待部署区装备数（封顶）、homeCooked 按完美作战', () => {
  const mk = (relics, extra = {}) => {
    const ps = { playerId: 'p0', relics: relics.slice(), bonds: {},
      board: new Map([['a', { items: [{ id: 'x' }, { id: 'y' }] }], ['b', { items: [] }]]),
      temp: [{ kind: 'item' }, { kind: 'item' }, { kind: 'chess' }], hand: [],
      relicPerfectBattles: 0, ...extra };
    const self = { gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
      players: new Map([['p0', ps]]),
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      activeBondsOf: MatchMeltdown.prototype.activeBondsOf,
      relicAllyMul: MatchMeltdown.prototype.relicAllyMul };
    return { ps, mul: self.relicAllyMul(ps) };
  };

  // atkPerEquip：棋盘共 2 件装备 ⇒ 攻击 +20%、生命 +40%
  const eq = mk(['p33']).mul;
  assert.ok(Math.abs(eq.atkMul - 1.2) < 1e-9, `atkPerEquip atk=${eq.atkMul}`);
  assert.ok(Math.abs(eq.hpMul - 1.4) < 1e-9, `atkPerEquip hp=${eq.hpMul}`);

  // atkPerBenchItem：待部署区 2 件 ⇒ +20%
  const bench = mk(['p37']).mul;
  assert.ok(Math.abs(bench.atkMul - 1.2) < 1e-9, `atkPerBenchItem atk=${bench.atkMul}`);
  // 封顶 1.5：塞 30 件也只 +150%
  const many = { temp: Array.from({ length: 30 }, () => ({ kind: 'item' })) };
  const capped = mk(['p37'], many).mul;
  assert.ok(Math.abs(capped.atkMul - 2.5) < 1e-9, `上限 +150% ⇒ 2.5，实际 ${capped.atkMul}`);

  // homeCooked：基础 +20%/+20%，每场完美作战 +10%
  const cooked0 = mk(['p31']).mul;
  assert.ok(Math.abs(cooked0.atkMul - 1.2) < 1e-9);
  const cooked3 = mk(['p31'], { relicPerfectBattles: 3 }).mul;
  assert.ok(Math.abs(cooked3.atkMul - 1.5) < 1e-9, `3 场完美 ⇒ 1.5，实际 ${cooked3.atkMul}`);

  for (const id of ['p33', 'p37', 'p31']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('消费类：atkPerSpend / hpdefPerSpend / aspdPerSpend 按整局累计花费换算', () => {
  const mk = (relics, totalSpent) => {
    const ps = { playerId: 'p0', relics: relics.slice(), bonds: {}, board: new Map(), temp: [], hand: [], totalSpent };
    const self = { gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
      players: new Map([['p0', ps]]),
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      activeBondsOf: MatchMeltdown.prototype.activeBondsOf,
      relicAllyMul: MatchMeltdown.prototype.relicAllyMul };
    return self.relicAllyMul(ps);
  };
  // atkPerSpend：每 5 资金 +5% ⇒ 花 20 ⇒ +20%
  assert.ok(Math.abs(mk(['p25'], 20).atkMul - 1.2) < 1e-9);
  assert.equal(mk(['p25'], 4), null, '不够 5 点就没有加成（返回 null）');
  // hpdefPerSpend：每 3 资金 +3% 生命/+3% 防御 ⇒ 花 9 ⇒ ×1.09
  const hd = mk(['p26'], 9);
  assert.ok(Math.abs(hd.hpMul - 1.09) < 1e-9);
  assert.ok(Math.abs(hd.defMul - 1.09) < 1e-9);
  // aspdPerSpend：每 3 资金 +7 攻速（加法）⇒ 花 9 ⇒ +21
  assert.equal(mk(['p09'], 9).aspdAdd, 21);
});

test('相邻类：relicNeighborRules 读出每相邻一人的加成（per-unit 在 battleInput 里算）', () => {
  const mkSelf = (relics) => ({ gd: { raw: { relics: RELICS } },
    players: new Map([['p0', { playerId: 'p0', relics: relics.slice() }]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    relicNeighborRules: MatchMeltdown.prototype.relicNeighborRules });
  assert.deepEqual(mkSelf(['p18']).relicNeighborRules(), { atkPer: 0.2, aspdPer: 0 });
  assert.deepEqual(mkSelf(['p17']).relicNeighborRules(), { atkPer: 0, aspdPer: 30 });
  assert.equal(mkSelf([]).relicNeighborRules(), null, '没有相邻类藏品时返回 null（不产生 relicMods）');
  for (const id of ['p09', 'p17', 'p18', 'p25', 'p26']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('敌方/经济余项：赏金倍率连乘、干员价格折扣、LP 流失、部署上限 −3', () => {
  const mkPs = (relics, extra = {}) => ({ playerId: 'p0', isBot: false, relics: relics.slice(),
    lp: 10, funds: 10, deployCapBonus: 0, dirty() {}, addFunds(n) { this.funds += n; }, ...extra });
  const mkSelf = (ps) => ({ gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
    players: new Map([[ps.playerId, ps]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    relicBountyMul: MatchMeltdown.prototype.relicBountyMul,
    relicChessPriceDelta: MatchMeltdown.prototype.relicChessPriceDelta,
    applyRelicLpDrain: MatchMeltdown.prototype.applyRelicLpDrain,
    relicGrantInstant: MatchMeltdown.prototype.relicGrantInstant });

  // 赏金倍率：n08 翻倍(×2) + p07 的 postBountyMul(×1.5) ⇒ 3
  const both = mkPs(['n08', 'p07']);
  assert.equal(mkSelf(both).relicBountyMul(), 3);
  assert.equal(mkSelf(mkPs(['n34'])).relicBountyMul(), 0.5, '追忆仪：悬赏减半');
  assert.equal(mkSelf(mkPs([])).relicBountyMul(), 1, '没有藏品时为 1');

  // 干员价格折扣：kingCrystal −1
  assert.equal(mkSelf(mkPs(['p21'])).relicChessPriceDelta(), -1);
  assert.equal(mkSelf(mkPs([])).relicChessPriceDelta(), 0);

  // 休整期 LP −1（最低 1）：lpDrainRest
  const restPs = mkPs(['n06'], { lp: 3 });
  mkSelf(restPs).applyRelicLpDrain('rest');
  assert.equal(restPs.lp, 2, '进入休整期 −1');
  restPs.lp = 1;
  mkSelf(restPs).applyRelicLpDrain('rest');
  assert.equal(restPs.lp, 1, '最低 1，不会归零');

  // 战斗结束 LP −2：kingCrystal
  const kingPs = mkPs(['p21'], { lp: 10 });
  mkSelf(kingPs).applyRelicLpDrain('battle');
  assert.equal(kingPs.lp, 8);

  // bountyKillDeploy：初始部署 −3 由 effect.deployCap 生效（rule 分支不得重复扣，曾经的 −6 就是这个 bug）
  const killPs = mkPs(['n09']);
  mkSelf(killPs).relicGrantInstant(killPs, RELICS.relics.find((r) => r.id === 'n09'));
  assert.equal(killPs.deployCapBonus, -3);
});

test('atkPerBounty / dmgDealt（己方攻击）与 elite 每回合削弱', () => {
  const mkPs = (relics, extra = {}) => ({ playerId: 'p0', relics: relics.slice(), bonds: {},
    board: new Map(), temp: [], hand: [], totalSpent: 0, ...extra });
  const mkSelf = (ps, round = 1) => ({ gd: { raw: { relics: RELICS } }, round, isRogue: false,
    players: new Map([[ps.playerId, ps]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    activeBondsOf: MatchMeltdown.prototype.activeBondsOf,
    relicAllyMul: MatchMeltdown.prototype.relicAllyMul,
    relicEliteRoundMul: MatchMeltdown.prototype.relicEliteRoundMul });

  // atkPerBounty：base 20% + 每次完成 20%（3 次 ⇒ 1 + 0.2 + 0.6 = 1.8）
  const b = mkPs(['p39'], { relicBountiesDone: 3 });
  assert.ok(Math.abs(mkSelf(b).relicAllyMul(b).atkMul - 1.8) < 1e-9);
  // 封顶 10 层：完成 30 次也只 +200% ⇒ 1 + 0.2 + 2.0 = 3.2
  const b30 = mkPs(['p39'], { relicBountiesDone: 30 });
  assert.ok(Math.abs(mkSelf(b30).relicAllyMul(b30).atkMul - 3.2) < 1e-9, '最高 +200%');

  // dmgDealt：造成伤害 +50% ⇒ 用攻击 ×1.5 近似
  const d = mkPs(['p23']);
  assert.ok(Math.abs(mkSelf(d).relicAllyMul(d).atkMul - 1.5) < 1e-9);

  // eliteAtkPerRound：第 3 回合精锐攻击 ×0.8；第 20 回合封在 ×0.5
  const e1 = mkPs(['n36']);
  assert.ok(Math.abs(mkSelf(e1, 3).relicEliteRoundMul().atkMul - 0.8) < 1e-9);
  assert.ok(Math.abs(mkSelf(e1, 20).relicEliteRoundMul().atkMul - 0.5) < 1e-9, '最多 −50%');
  // 没有该藏品时不削弱
  const none = mkPs([]);
  assert.deepEqual(mkSelf(none, 9).relicEliteRoundMul(), { atkMul: 1, hpMul: 1 });

  for (const id of ['p39', 'p23', 'n36', 'n41']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('精锐目标类：eliteStatsPerElite / eliteAspdPerElite / eliteAtkPerMerge 参数与生效标记', () => {
  const mkSelf = (relics) => ({ gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
    players: new Map([['p0', { playerId: 'p0', relics: relics.slice() }]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    relicEliteRules: MatchMeltdown.prototype.relicEliteRules });

  assert.deepEqual(mkSelf(['p35']).relicEliteRules(),
    { hp: 0.1, atk: 0.1, def: 0.1, aspdPer: 0, aspdMax: 0, mergePer: 0, mergeMax: 0 });
  assert.deepEqual(mkSelf(['p32']).relicEliteRules(),
    { hp: 0, atk: 0, def: 0, aspdPer: 10, aspdMax: 10, mergePer: 0, mergeMax: 0 });
  assert.deepEqual(mkSelf(['p36']).relicEliteRules(),
    { hp: 0, atk: 0, def: 0, aspdPer: 0, aspdMax: 0, mergePer: 0.4, mergeMax: 4 });
  assert.equal(mkSelf([]).relicEliteRules(), null, '没有精锐类藏品时返回 null');
  for (const id of ['p32', 'p35', 'p36']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('五条外围 rule：aspdPerNegative / hpPerTier4Buy / kingVessel / probe / recruitTopBond', () => {
  const mkSelf = (ps, round = 1) => ({
    gd: { raw: { relics: RELICS } }, round, isRogue: false,
    players: new Map([[ps.playerId, ps]]),
    relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
    relicNegativeCount: MatchMeltdown.prototype.relicNegativeCount,
    relicAllyMul: MatchMeltdown.prototype.relicAllyMul,
    relicEnemyMul: MatchMeltdown.prototype.relicEnemyMul,
  });
  const base = (relics, extra = {}) => Object.assign({ playerId: 'p0', relics: relics.slice(), bonds: {} }, extra);

  // p10 刀光剑影：每个负面藏品 +35 攻速（数自己持有的 negative 藏品）
  const one = mkSelf(base(['p10', 'n03']));
  assert.equal(one.relicNegativeCount(base(['p10', 'n03'])), 1);
  assert.deepEqual(one.relicAllyMul(base(['p10', 'n03'])), { atkMul: 1, hpMul: 1, aspdAdd: 35 });
  const two = base(['p10', 'n03', 'n04']);
  assert.equal(mkSelf(two).relicAllyMul(two).aspdAdd, 70);

  // p24 知识之桥：每买一次 4 阶以上干员 +5% 生命，封顶 10 层
  assert.equal(mkSelf(base(['p24'], { relicTier4Buys: 4 })).relicAllyMul(base(['p24'], { relicTier4Buys: 4 })).hpMul, 1.2);
  assert.equal(mkSelf(base(['p24'], { relicTier4Buys: 99 })).relicAllyMul(base(['p24'], { relicTier4Buys: 99 })).hpMul, 1.5, '最多 10 层');

  // p27 魔王的祭器：上一回合没掉生命 +80%；连 3 回合 +200%
  assert.equal(mkSelf(base(['p27'], { relicNoLossStreak: 0 })).relicAllyMul(base(['p27'], { relicNoLossStreak: 0 })), null);
  assert.equal(mkSelf(base(['p27'], { relicNoLossStreak: 1 })).relicAllyMul(base(['p27'], { relicNoLossStreak: 1 })).hpMul, 1.8);
  assert.equal(mkSelf(base(['p27'], { relicNoLossStreak: 3 })).relicAllyMul(base(['p27'], { relicNoLossStreak: 3 })).hpMul, 3);

  // n38 探测先锋：每过 2 回合敌方 攻/生 +10%
  const probe = base(['n38']);
  assert.deepEqual(mkSelf(probe, 1).relicEnemyMul(), { hp: 0, atk: 0, speed: 0 });
  const r5 = mkSelf(probe, 5).relicEnemyMul();
  assert.ok(Math.abs(r5.hp - 0.2) < 1e-9 && Math.abs(r5.atk - 0.2) < 1e-9, `round5 应为 +20%：${JSON.stringify(r5)}`);

  // 五条都算已实装；recruitTopBond 的 +1 部署来自 effect.deployCap（这里只验证 rule 被认账）
  for (const id of ['p10', 'p24', 'p27', 'n38', 'p41']) {
    const def = RELICS.relics.find((r) => r.id === id);
    assert.equal(relicEffectApplied(def.effect), true, `${id} 应算已实现`);
  }
});

test('一次性道具两条 rule：consumableFree 按目录价退款 / consumableRefund 每回合最多 3 次', () => {
  const ITEMS = {
    freebie: { kind: 'consume_on_equip_x', itemType: 'EQUIP', price: 4 },
    art: { kind: 'art', itemType: 'MAGIC', price: 2 },
    normal: { kind: 'equip', itemType: 'EQUIP', price: 3 },
  };
  const mkSelf = (relics, round = 2) => {
    const gained = [];
    const funds = [];
    const ps = {
      playerId: 'p0', relics: relics.slice(), relicRuleState: {},
      addFunds: (n) => funds.push(n),
      acquireItem: (id) => gained.push(id),
    };
    const self = {
      round, gd: { raw: { relics: RELICS, items: ITEMS }, itemPrice: (id) => (ITEMS[id] ? ITEMS[id].price : 2) },
      players: new Map([[ps.playerId, ps]]),
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      relicIsConsumable: MatchMeltdown.prototype.relicIsConsumable,
      relicRandomConsumableId: MatchMeltdown.prototype.relicRandomConsumableId,
      relicConsumableUsed: MatchMeltdown.prototype.relicConsumableUsed,
    };
    return { self, ps, gained, funds };
  };

  // 判据与 items.js 的两个消耗点一致
  const { self } = mkSelf([]);
  assert.equal(self.relicIsConsumable(ITEMS.freebie), true);
  assert.equal(self.relicIsConsumable(ITEMS.art), true);
  assert.equal(self.relicIsConsumable(ITEMS.normal), false);
  // 随机只从一次性道具里挑
  for (let i = 0; i < 12; i++) {
    const id = self.relicRandomConsumableId();
    assert.ok(id === 'freebie' || id === 'art', `只该发一次性道具，实得 ${id}`);
  }

  // p44 果腹：用掉一次性道具后按目录价退款
  const free = mkSelf(['p44']);
  free.self.relicConsumableUsed(free.ps, 'freebie');
  assert.deepEqual(free.funds, [4]);
  assert.equal(free.gained.length, 0, '果腹不额外发道具');

  // p43 复得之轮：用掉后发一件，每回合最多 3 次；换回合重新计
  const ref = mkSelf(['p43'], 5);
  for (let i = 0; i < 5; i++) ref.self.relicConsumableUsed(ref.ps, 'freebie');
  assert.equal(ref.gained.length, 3, '每回合封顶 3 次');
  ref.self.round = 6;
  ref.self.relicConsumableUsed(ref.ps, 'freebie');
  assert.equal(ref.gained.length, 4, '新回合重新计数');

  // 两条都算已实装
  for (const id of ['p43', 'p44']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('迷彩类：camoRanged 只看远程 / camoAura 按覆盖人数叠攻，范围旋转与引擎一致', () => {
  const mkSelf = (relics) => {
    const ps = { playerId: 'p0', relics: relics.slice() };
    return {
      gd: { raw: { relics: RELICS } }, round: 1, isRogue: false,
      players: new Map([[ps.playerId, ps]]),
      relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
      relicCamoRules: MatchMeltdown.prototype.relicCamoRules,
    };
  };
  assert.equal(mkSelf([]).relicCamoRules(), null);
  assert.deepEqual(mkSelf(['p14']).relicCamoRules(), { rangedAtk: 0.5, auraAtk: 0 });
  assert.deepEqual(mkSelf(['p40']).relicCamoRules(), { rangedAtk: 0, auraAtk: 0.1 });
  assert.deepEqual(mkSelf(['p14', 'p40']).relicCamoRules(), { rangedAtk: 0.5, auraAtk: 0.1 });

  // 范围旋转：[[0,1]] = 面朝方向的「正前方一格」（与 sim/dir.js rotateOffset 同规则，row 0 在下）
  assert.deepEqual([...rangeTileKeys([[0, 1]], 3, 3, 'RIGHT')], ['3,4']);
  assert.deepEqual([...rangeTileKeys([[0, 1]], 3, 3, 'LEFT')], ['3,2']);
  assert.deepEqual([...rangeTileKeys([[0, 1]], 3, 3, 'UP')], ['4,3']);
  assert.deepEqual([...rangeTileKeys([[0, 1]], 3, 3, 'DOWN')], ['2,3']);
  assert.equal(rangeTileKeys([[0, 1], ['x', 2]], 3, 3, 'RIGHT').size, 1, '脏格子被忽略');

  for (const id of ['p14', 'p40']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('hpIfDp 按部署费用合计给生命；survivor 只强化攻击最高的那一名并按场数叠', () => {
  const CHESS = {
    a: { position: 'MELEE', stats: { atk: 900, cost: 12 } },
    b: { position: 'RANGED', stats: { atk: 300, cost: 20 } },
  };
  const mkSelf = (relics, boardIds, extra = {}) => {
    const board = new Map(boardIds.map((id, i) => [i, { kind: 'chess', id }]));
    const ps = Object.assign({ playerId: 'p0', relics: relics.slice(), board }, extra);
    return {
      self: {
        gd: { raw: { relics: RELICS }, chess: (id) => CHESS[id] || null }, round: 1, isRogue: false,
        players: new Map([[ps.playerId, ps]]),
        relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
        relicAllyMul: MatchMeltdown.prototype.relicAllyMul,
        relicSurvivorRule: MatchMeltdown.prototype.relicSurvivorRule,
      },
      ps,
    };
  };

  // p20 黑洞协议：费用 12+20=32 < 50 ⇒ 不生效；补到 ≥50 ⇒ +150% 生命（按 desc，不用 params 的 0.5）
  assert.equal(mkSelf(['p20'], ['a']).self.relicAllyMul(mkSelf(['p20'], ['a']).ps), null);
  const big = mkSelf(['p20'], ['a', 'b', 'b', 'b']);
  const hp = big.self.relicAllyMul(big.ps);
  assert.ok(hp && Math.abs(hp.hpMul - 2.5) < 1e-9, `费用 72 应 +150%（hpMul 2.5）：${JSON.stringify(hp)}`);

  // p12 生还者合约：per 0.2，stacks = 1 + 已打场数（首战 1 层 ⇒ +20%，打完 2 场 ⇒ 3 层 ⇒ +60%）
  const s0 = mkSelf(['p12'], ['a'], { relicBattles: 0 });
  assert.deepEqual(s0.self.relicSurvivorRule(s0.ps), { per: 0.2, stacks: 1 });
  const s2 = mkSelf(['p12'], ['a'], { relicBattles: 2 });
  assert.deepEqual(s2.self.relicSurvivorRule(s2.ps), { per: 0.2, stacks: 3 });
  assert.equal(mkSelf([], ['a']).self.relicSurvivorRule(mkSelf([], ['a']).ps), null);

  for (const id of ['p12', 'p20']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('技力类：spInit + spOnDeploy 合并成 initSp；lpDrainRest 低血时 spRegenMul=0.8', () => {
  const mkSelf = (relics, lp = 20) => {
    const ps = { playerId: 'p0', relics: relics.slice(), lp };
    return {
      self: {
        gd: { raw: { relics: RELICS } }, round: 1, isRogue: false, players: new Map([[ps.playerId, ps]]),
        relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
        relicAllyMul: MatchMeltdown.prototype.relicAllyMul,
      },
      ps,
    };
  };

  // n30 spInit「初始技力 −10」 + n10 spOnDeploy「部署时失去 15 点技力」 ⇒ initSp −25（引擎夹到 0 以上）
  const both = mkSelf(['n30', 'n10']);
  assert.equal(both.self.relicAllyMul(both.ps).initSp, -25);

  // n06 lpDrainRest：「关卡生命低于 10 时，我方技力回复速度 −20%」
  const lowLp = mkSelf(['n06'], 5);
  assert.equal(lowLp.self.relicAllyMul(lowLp.ps).spRegenMul, 0.8);
  const highLp = mkSelf(['n06'], 20);
  assert.equal(highLp.self.relicAllyMul(highLp.ps), null, 'LP 够高时这条不生效');

  for (const id of ['n30', 'n10']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('庇护与部署晕眩：shelter 静态 10%；stunOnDeploy 人数按回合涨、封顶 4', () => {
  const mkSelf = (relics, round = 1) => {
    const ps = { playerId: 'p0', relics: relics.slice(), lp: 20 };
    return {
      self: {
        gd: { raw: { relics: RELICS } }, round, isRogue: false, seed: 42, players: new Map([[ps.playerId, ps]]),
        relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
        relicAllyMul: MatchMeltdown.prototype.relicAllyMul,
        relicStunRule: MatchMeltdown.prototype.relicStunRule,
      },
      ps,
    };
  };
  // p11 佣兵保单：所有我方单位 10% 庇护（低血 +35% 那半句要战斗内 HP，未接）
  const sh = mkSelf(['p11']);
  assert.equal(sh.self.relicAllyMul(sh.ps).shelter, 0.1);

  // n19 “未尽的生命”：R1 = 1 人、R3 = 3 人、R9 = 封顶 4 人，时长 10s
  const r1 = mkSelf(['n19'], 1);
  assert.deepEqual(r1.self.relicStunRule(r1.ps), { count: 1, dur: 10 });
  const r3 = mkSelf(['n19'], 3);
  assert.deepEqual(r3.self.relicStunRule(r3.ps), { count: 3, dur: 10 });
  const r9 = mkSelf(['n19'], 9);
  assert.deepEqual(r9.self.relicStunRule(r9.ps), { count: 4, dur: 10 }, '最多 +3（含初始 1 人）');

  for (const id of ['p11', 'n19']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('敌方 spawn 级三条 + removeTemp：参数聚合与置旗', () => {
  const mkSelf = (relics, round = 1) => {
    const ps = { playerId: 'p0', relics: relics.slice(), lp: 20, funds: 5, temp: [{ uid: 1, kind: 'item', id: 'x' }] };
    return {
      self: {
        gd: { raw: { relics: RELICS } }, round, isRogue: false, players: new Map([[ps.playerId, ps]]),
        relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
        relicEnemyMods: MatchMeltdown.prototype.relicEnemyMods,
        relicAllyMul: MatchMeltdown.prototype.relicAllyMul,
        relicGrantInstant: MatchMeltdown.prototype.relicGrantInstant,
      },
      ps,
    };
  };

  // n27 戈渎不语：敌方防御 +3000，每次受击 −100、最多 30 次
  const def = mkSelf(['n27']);
  assert.deepEqual(def.self.relicEnemyMods(), { defAdd: 3000, defShredPerHit: -100, defShredMax: 30 });
  // n42 生命蓝图：精英/领袖登场 30 秒内受伤 ×0.5
  const elite = mkSelf(['n42']);
  const em = elite.self.relicEnemyMods();
  assert.equal(em.eliteDmgTakenMul, 0.5);
  assert.equal(em.eliteDmgDur, 30);
  // p29 精神治疗录像带：异常时长 +150% ⇒ ×2.5
  assert.equal(mkSelf(['p29']).self.relicEnemyMods().statusDurationMul, 2.5);
  assert.equal(mkSelf([]).self.relicEnemyMods(), null);

  // p13 养育者：庇护 35% + 无视双防 35%（走己方 per-unit 通道）
  const sh = mkSelf(['p13']);
  assert.equal(sh.self.relicAllyMul(sh.ps).debuffShelter, 0.35);

  // n23 维度流质：拿到即移除临时部署区（置旗 + 清空）
  const rt = mkSelf(['n23']);
  const defN23 = RELICS.relics.find((r) => r.id === 'n23');
  rt.self.relicGrantInstant(rt.ps, defN23);
  assert.equal(rt.ps.relicNoTemp, true);
  assert.equal(rt.ps.temp.filter(Boolean).length, 0, '已在临时部署区里的东西被清掉');

  for (const id of ['n27', 'n42', 'p29', 'p13', 'n23']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});

test('非 rule 藏品 7 类：ally / allyElite / allyPerBench / income / price / refreshLimit / hand', () => {
  const mkSelf = (relics, extra = {}) => {
    const ps = Object.assign({ playerId: 'p0', relics: relics.slice(), funds: 10, hand: [], temp: [], board: new Map() }, extra.ps || {});
    return {
      self: Object.assign({
        gd: { raw: { relics: RELICS }, tierOf: (id) => (extra.tierOf ? extra.tierOf(id) : 0) },
        round: 1, isRogue: false, players: new Map([[ps.playerId, ps]]),
        relicRuleParams: MatchMeltdown.prototype.relicRuleParams,
        relicEffectList: MatchMeltdown.prototype.relicEffectList,
        relicAllyMul: MatchMeltdown.prototype.relicAllyMul,
        relicAllyEliteMul: MatchMeltdown.prototype.relicAllyEliteMul,
        relicChessPriceDelta: MatchMeltdown.prototype.relicChessPriceDelta,
        relicRefreshCap: MatchMeltdown.prototype.relicRefreshCap,
        applyRelicRoundEconomy: MatchMeltdown.prototype.applyRelicRoundEconomy,
      }, extra.self || {}),
      ps,
    };
  };

  // ally：p02 攻+35% 防+35% 生命+45%；n20 攻/生命 −30%
  const good = mkSelf(['p02']);
  const m1 = good.self.relicAllyMul(good.ps);
  assert.ok(Math.abs(m1.atkMul - 1.35) < 1e-9 && Math.abs(m1.hpMul - 1.45) < 1e-9 && Math.abs(m1.defMul - 1.35) < 1e-9, JSON.stringify(m1));
  const bad = mkSelf(['n20']);
  const m2 = bad.self.relicAllyMul(bad.ps);
  assert.ok(Math.abs(m2.atkMul - 0.7) < 1e-9 && Math.abs(m2.hpMul - 0.7) < 1e-9, JSON.stringify(m2));

  // allyPerBench：p19 待部署区每有一名干员 生命/攻击 +16%（最多 160%）
  const bench = mkSelf(['p19'], { ps: { hand: [{ kind: 'chess', id: 'a' }, null], temp: [{ kind: 'chess', id: 'b' }] } });
  const m3 = bench.self.relicAllyMul(bench.ps);
  assert.ok(Math.abs(m3.atkMul - 1.32) < 1e-9 && Math.abs(m3.hpMul - 1.32) < 1e-9, JSON.stringify(m3));

  // allyElite：n31 精锐攻击 ×0.7
  const elite = mkSelf(['n31']);
  assert.ok(Math.abs(elite.self.relicAllyEliteMul(elite.ps) - 0.7) < 1e-9);

  // income：p01 进入休整期 +1
  const income = mkSelf(['p01']);
  const funds = [];
  income.ps.addFunds = (n) => funds.push(n);
  income.self.applyRelicRoundEconomy();
  assert.deepEqual(funds, [1], `income 应 +1（实得 ${JSON.stringify(funds)}）`);

  // price：p01 干员 −1；n28 五阶以上 +1；n13 首个干员 +2（economy 侧算，这里验 delta）
  assert.equal(mkSelf(['p01']).self.relicChessPriceDelta(mkSelf(['p01']).ps, 'x'), -1);
  const t5 = mkSelf(['n28'], { tierOf: () => 5 });
  assert.equal(t5.self.relicChessPriceDelta(t5.ps, 'y'), 1);
  const t3 = mkSelf(['n28'], { tierOf: () => 3 });
  assert.equal(t3.self.relicChessPriceDelta(t3.ps, 'y'), 0);

  // refreshLimit：n15 最多 5 次；hand：n21 −4 能在 effectList 里读到
  const cap = mkSelf(['n15']);
  assert.equal(cap.self.relicRefreshCap(cap.ps), 5);
  const hand = mkSelf(['n21']);
  assert.deepEqual(hand.self.relicEffectList(hand.ps, 'hand'), [-4], 'hand 是标量 −4');

  for (const id of ['p02', 'n20', 'p19', 'n31', 'p01', 'n28', 'n15', 'n21']) {
    assert.equal(relicEffectApplied(RELICS.relics.find((r) => r.id === id).effect), true, `${id} 应算已实现`);
  }
});
