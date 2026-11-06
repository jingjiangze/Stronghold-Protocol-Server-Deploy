// 失与得（官方「1 件换 1 件」，2026-11-06）：`relicRevoke` 的逆运算 + `relicSwap` 的换牌与稀有度门。
//
// 直接调实现（不复制逻辑）：这些方法都在 `MatchMeltdown.prototype` 上，用一个最小 `this` + 最小玩家就能跑。
// 数据分两套：
//   · 自定义小池（CUSTOM）—— 让「换到哪一张」可复现，也方便构造蓝/红两档；
//   · 真实 relics-87 —— 验证 p41（deployCap +1）这种真数据上的 grant → revoke 往返。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MatchMeltdown } from '../../plugins/mota/server/match/match/meltdown.js';
// 事件侧（不期而遇的「失与得」选项）在独立插件 rogue 的叠加层里，用它的原型一起测
import { Mixin as RogueMixin } from '../../plugins/rogue/server/match/RogueMixin.js';

const REAL = JSON.parse(fs.readFileSync(new URL('../../plugins/relics-87/data/relics.json', import.meta.url), 'utf8'));

/** 自定义小池：red 两张（一张带 deployCap、一张纯 enemy）、blue 两张（纯 enemy）。 */
const CUSTOM = { relics: [
  { id: 'r_cap', tier: 'red', kind: 'positive', name: '红色·部署上限+1', desc: 'deployCap +1', effect: { deployCap: 1 } },
  { id: 'r_plain', tier: 'red', kind: 'positive', name: '红色·纯敌人修正', desc: 'enemy atk+10%', effect: { enemy: { atk: 0.1 } } },
  { id: 'b_plain', tier: 'blue', kind: 'positive', name: '蓝色·纯敌人修正', desc: 'enemy atk+5%', effect: { enemy: { atk: 0.05 } } },
  { id: 'b_other', tier: 'blue', kind: 'positive', name: '蓝色·另一件', desc: 'enemy hp+5%', effect: { enemy: { hp: 0.05 } } },
] };

/** 最小玩家：资金 / 生命 / 部署上限 / 手上与待部署区的槽位（够 relicGrantInstant + relicRevoke 跑）。 */
function mkPs(extra = {}) {
  return {
    playerId: 'p_0', alive: true, isBot: false,
    lp: 10, funds: 0, deployCapBonus: 0,
    relics: [], relicLedger: {},
    relicOffer: null, relicOfferCards: null, relicOfferMode: null, relicSwapGive: null,
    hand: new Array(10).fill(null), temp: new Array(10).fill(null),
    addFunds(n) {
      const v = Math.trunc(Number(n) || 0);
      const before = this.funds;
      this.funds = Math.max(0, this.funds + v);
      return this.funds - before;
    },
    spend(n) { const v = Math.max(0, Math.trunc(Number(n) || 0)); if (v > this.funds) return false; this.funds -= v; return true; },
    acquireItem(id) { const piece = { uid: (this._uid = (this._uid || 0) + 1), kind: 'item', id }; this.hand[this.hand.findIndex((p) => !p)] = piece; return piece; },
    releaseItemStock() { return 0; },
    dirty() {},
    ...extra,
  };
}

/** 最小 `this`：把被测方法逐个挂上（不复制实现）。 */
function mkSelf({ relics = CUSTOM, round = 3, seed = 20261106 } = {}) {
  const errors = [];
  const self = {
    gd: { raw: { relics } },
    round, seed, isRogue: true,
    relicPool: MatchMeltdown.prototype.relicPool,
    relicDraftPool: MatchMeltdown.prototype.relicDraftPool,
    relicTierOf: MatchMeltdown.prototype.relicTierOf,
    relicTierRank: MatchMeltdown.prototype.relicTierRank,
    relicGrantInstant: MatchMeltdown.prototype.relicGrantInstant,
    relicGrant: MatchMeltdown.prototype.relicGrant,
    relicRevoke: MatchMeltdown.prototype.relicRevoke,
    relicRevokeEntry: MatchMeltdown.prototype.relicRevokeEntry,
    relicRevokeItem: MatchMeltdown.prototype.relicRevokeItem,
    relicRestoreTemp: MatchMeltdown.prototype.relicRestoreTemp,
    relicSwapOffer: MatchMeltdown.prototype.relicSwapOffer,
    relicSwap: MatchMeltdown.prototype.relicSwap,
    relicSwapPick: MatchMeltdown.prototype.relicSwapPick,
    relicPick: MatchMeltdown.prototype.relicPick,
    markPrivate() {}, markPublic() {},
    toast() {},
    reportError(where, e) { errors.push([where, e && e.message]); },
  };
  return { self, errors };
}

test('失与得：换牌后藏品数量不变，换入的在、换出的没了', () => {
  const { self } = mkSelf();
  const ps = mkPs();
  self.relicGrant(ps, 'r_cap');
  assert.deepEqual(ps.relics, ['r_cap']);

  assert.equal(self.relicSwapOffer(ps, 'r_cap'), true, '要能发出换入候选');
  const take = ps.relicOffer[0];
  assert.ok(take && take !== 'r_cap', `候选不能是换出的那一件（实得 ${take}）`);
  assert.equal(ps.relicOfferMode, 'swap');
  assert.ok(ps.relicOfferCards.every((c) => c.mode === 'swap' && c.swapGive === 'r_cap'), '卡面标 swap + 换出 id');

  const res = self.relicSwap(ps, 'r_cap', take);
  assert.equal(res && res.ok, true, JSON.stringify(res));
  assert.equal(ps.relics.length, 1, '1 件换 1 件：数量不变');
  assert.deepEqual(ps.relics, [take]);
  assert.equal(ps.relicOffer, null, '换完清掉 offer');
  assert.equal(ps.relicSwapGive, null);
});

test('失与得：换出的那件的 deployCap 加成被回退（回到换前）', () => {
  const { self } = mkSelf();
  const ps = mkPs();
  const capBefore = ps.deployCapBonus;
  self.relicGrant(ps, 'r_cap');
  assert.equal(ps.deployCapBonus, capBefore + 1, '下发 +1 部署上限');
  assert.deepEqual(ps.relicLedger.r_cap, [{ deployCap: 1 }], '账本只记真的改过的字段');

  self.relicSwapOffer(ps, 'r_cap');
  // 定向换一张不带 deployCap 的（r_plain 在候选里就一定用它，保证断言与抽卡顺序无关）
  const take = ps.relicOffer.includes('r_plain') ? 'r_plain' : ps.relicOffer.find((id) => id !== 'r_cap');
  assert.equal(self.relicSwap(ps, 'r_cap', take).ok, true);
  assert.equal(ps.deployCapBonus, capBefore, '部署上限加成随藏品一起回退');
  assert.equal(ps.relicLedger.r_cap, undefined, '账本随藏品一起出栈');
});

test('失与得：稀有度门 —— 投入 blue 只能换 blue，不能换 red', () => {
  const { self } = mkSelf();
  const ps = mkPs({ relics: ['b_plain'], relicOffer: ['r_plain'], relicOfferMode: 'swap', relicSwapGive: 'b_plain' });
  const res = self.relicSwap(ps, 'b_plain', 'r_plain');
  assert.ok(res && res.error, 'blue → red 必须被拒绝');
  assert.deepEqual(ps.relics, ['b_plain'], '被拒绝时藏品不发生变化');

  // 同档可以换：blue → blue
  const ok = mkPs({ relics: ['b_plain'], relicOffer: ['b_other'], relicOfferMode: 'swap', relicSwapGive: 'b_plain' });
  assert.equal(self.relicSwap(ok, 'b_plain', 'b_other').ok, true);
  assert.deepEqual(ok.relics, ['b_other']);

  // red → red 也可以（投高得高）
  const red = mkPs({ relics: ['r_cap'], relicOffer: ['r_plain'], relicOfferMode: 'swap', relicSwapGive: 'r_cap' });
  assert.equal(self.relicSwap(red, 'r_cap', 'r_plain').ok, true);
});

test('失与得：池里没有同档候选时降档，并在卡面标注', () => {
  const { self } = mkSelf();
  // 手上是红，池里只剩蓝（红都被自己拿了）
  const ps = mkPs({ relics: ['r_cap', 'r_plain'] });
  assert.equal(self.relicSwapOffer(ps, 'r_cap'), true);
  assert.ok(ps.relicOffer.every((id) => id.startsWith('b_')), `应降档到蓝：${JSON.stringify(ps.relicOffer)}`);
  assert.ok(ps.relicOfferCards.every((c) => c.downgraded === true), '降档要在卡面标注');
});

test('失与得：giveId 不在自己手里 → 拒绝', () => {
  const { self } = mkSelf();
  const ps = mkPs({ relics: ['b_plain'], relicOffer: ['b_other'], relicOfferMode: 'swap' });
  const res = self.relicSwap(ps, 'r_cap', 'b_other');
  assert.ok(res && res.error, JSON.stringify(res));
  assert.deepEqual(ps.relics, ['b_plain'], '不白给也不白扣');
});

test('失与得：takeId 不在 offer 里 → 拒绝', () => {
  const { self } = mkSelf();
  const ps = mkPs({ relics: ['b_plain'], relicOffer: ['b_other'], relicOfferMode: 'swap', relicSwapGive: 'b_plain' });
  const res = self.relicSwap(ps, 'b_plain', 'r_plain');
  assert.ok(res && res.error, '候选外的 id 一律拒绝');
  assert.deepEqual(ps.relics, ['b_plain']);
  assert.deepEqual(ps.relicOffer, ['b_other'], '被拒绝时 offer 保留，玩家可以改选');
});

test('失与得：没有账本的老藏品（历史存档）换出时不崩、只移除', () => {
  const { self, errors } = mkSelf();
  // 模拟本次改动前发出的藏品：只有 relics，没有 relicLedger
  const ps = mkPs({ relics: ['legacy_owned'], relicLedger: {}, relicOffer: ['b_plain'], relicOfferMode: 'swap', relicSwapGive: 'legacy_owned' });
  const res = self.relicSwap(ps, 'legacy_owned', 'b_plain');
  assert.equal(res && res.ok, true, `不该抛错：${JSON.stringify(res)}`);
  assert.deepEqual(ps.relics, ['b_plain'], '老藏品被移除、新藏品到手');
  assert.ok(errors.some(([where, msg]) => where === 'relic revoke' && /no ledger/.test(String(msg))), '缺账本要留一条日志');
});

test('失与得：两阶段都复用 g.relicPick（先定换出、再选换入），不新增意图', () => {
  const { self } = mkSelf();
  const ps = mkPs({ relics: ['r_cap'] });
  assert.equal(self.relicSwapOffer(ps, null), true, '事件选中后先发一份全档候选');
  assert.equal(ps.relicSwapGive, null);

  // 阶段①：传自己的藏品 id → 记下换出、按档位重发候选
  const first = self.relicPick(ps, 'r_cap');
  assert.equal(first && first.ok, true, JSON.stringify(first));
  assert.equal(ps.relicSwapGive, 'r_cap');
  assert.ok(ps.relicOfferCards.every((c) => c.swapGive === 'r_cap' && c.tier === 'red'), '重发后全是同档（红）候选');
  assert.equal(ps.relicOfferMode, 'swap', '重发后仍然是 swap 模式');

  // 阶段②：传候选里的 takeId → 结算
  const take = ps.relicOffer[0];
  assert.equal(self.relicPick(ps, take).ok, true);
  assert.deepEqual(ps.relics, [take]);
  assert.equal(ps.relicOffer, null);
});

test('失与得：真数据往返 —— p41（deployCap +1）grant → revoke 回到原值', () => {
  const { self } = mkSelf({ relics: REAL });
  const ps = mkPs();
  self.relicGrant(ps, 'p41'); // 似曾相识棋盒：可同时部署人数 +1
  assert.equal(ps.deployCapBonus, 1);
  assert.ok(Array.isArray(ps.relicLedger.p41) && ps.relicLedger.p41.length === 1, '真数据也要记上账');
  assert.equal(self.relicRevoke(ps, 'p41').ok, true);
  assert.equal(ps.deployCapBonus, 0, '回退到 grant 前');
  assert.deepEqual(ps.relics, [], '藏品已移除');
});

test('失与得：n09（deployCap −3）grant → revoke 也能回退（负向加成同样可逆）', () => {
  const { self } = mkSelf({ relics: REAL });
  const ps = mkPs();
  self.relicGrant(ps, 'n09');
  assert.equal(ps.deployCapBonus, -3);
  self.relicRevoke(ps, 'n09');
  assert.equal(ps.deployCapBonus, 0);
});

/** 事件侧最小 `this`：mota 的藏品通道 + rogue 叠加层的事件方法，挂在同一个对象上（与真机一致）。 */
function mkEventSelf({ ps }) {
  const self = {
    gd: { raw: { relics: CUSTOM } },
    round: 3, seed: 20261106, isRogue: true,
    players: new Map([[ps.playerId, ps]]),
    alivePlayers: () => [ps],
    relicPool: MatchMeltdown.prototype.relicPool,
    relicDraftPool: MatchMeltdown.prototype.relicDraftPool,
    relicTierOf: MatchMeltdown.prototype.relicTierOf,
    relicTierRank: MatchMeltdown.prototype.relicTierRank,
    relicGrantInstant: MatchMeltdown.prototype.relicGrantInstant,
    relicGrant: MatchMeltdown.prototype.relicGrant,
    relicRevoke: MatchMeltdown.prototype.relicRevoke,
    relicRevokeEntry: MatchMeltdown.prototype.relicRevokeEntry,
    relicRevokeItem: MatchMeltdown.prototype.relicRevokeItem,
    relicRestoreTemp: MatchMeltdown.prototype.relicRestoreTemp,
    relicSwapOffer: MatchMeltdown.prototype.relicSwapOffer,
    relicSwap: MatchMeltdown.prototype.relicSwap,
    relicSwapPick: MatchMeltdown.prototype.relicSwapPick,
    relicPick: MatchMeltdown.prototype.relicPick,
    rogueEvents: RogueMixin.prototype.rogueEvents,
    rogueChoiceAffordable: RogueMixin.prototype.rogueChoiceAffordable,
    rogueRelicChannelOk: RogueMixin.prototype.rogueRelicChannelOk,
    rogueSwapChannelOk: RogueMixin.prototype.rogueSwapChannelOk,
    rogueChoiceSelectable: RogueMixin.prototype.rogueChoiceSelectable,
    roguePick: RogueMixin.prototype.roguePick,
    markPrivate() {}, markPublic() {}, reportError() {},
  };
  self.recompute = () => {};
  return self;
}

test('事件表：不期而遇里有「失与得」，选项标 relicSwap', () => {
  const table = RogueMixin.prototype.rogueEvents.call({});
  const ev = table.find((e) => e.id === 'ev_exchange');
  assert.ok(ev, '事件表里必须有失与得');
  assert.equal(ev.name, '失与得');
  const swap = ev.choices.find((c) => c.relicSwap);
  assert.ok(swap, '失与得的选项要带 relicSwap 字段');
  assert.equal(swap.relicSwap.rarity, 'own', '稀有度跟自己换出的那件走');
});

test('事件表：没有藏品 / 没有新候选时，失与得选项不可选（超时也不会替玩家选中）', () => {
  const noRelic = mkPs({ relics: [] });
  const selfEmpty = mkEventSelf({ ps: noRelic });
  const swapChoice = { id: 'a', label: 'x', relicSwap: { rarity: 'own' } };
  assert.equal(selfEmpty.rogueSwapChannelOk(noRelic), false, '一件都没有时通道不可用');
  assert.equal(selfEmpty.rogueChoiceSelectable(noRelic, swapChoice), false);

  // 手上有了（且池里还有没拥有过的）→ 可选
  noRelic.relics.push('r_cap');
  assert.equal(selfEmpty.rogueSwapChannelOk(noRelic), true);
  assert.equal(selfEmpty.rogueChoiceSelectable(noRelic, swapChoice), true);
});

test('事件结算：roguePick 选中失与得 → 发一份 swap offer（mode=swap、卡面带 tier）', () => {
  const ps = mkPs({ relics: ['r_cap'] });
  const self = mkEventSelf({ ps });
  ps.rogueOffer = { round: 3, eventId: 'ev_exchange', name: '失与得', desc: '', choices: [{ id: 'a', label: '换' }, { id: 'b', label: '不换' }] };
  ps.rogueOfferTable = { id: 'ev_exchange', name: '失与得', desc: '', choices: [
    { id: 'a', label: '拿 1 件藏品换他的 1 件（投高得高）', relicSwap: { rarity: 'own' } },
    { id: 'b', label: '不换，谢过他离开', funds: 1 },
  ] };

  const res = self.roguePick(ps, 'a');
  assert.equal(res && res.ok, true, JSON.stringify(res));
  assert.equal(ps.rogueOffer, null, '事件弹窗关闭');
  assert.equal(ps.relicOfferMode, 'swap');
  assert.ok(Array.isArray(ps.relicOffer) && ps.relicOffer.length === 3, '3 件候选');
  assert.ok(ps.relicOfferCards.every((c) => c.mode === 'swap' && typeof c.tier === 'string'), '卡面标 swap 并带 tier');
  assert.equal(ps.relicSwapGive, null, '还没选换出');
  assert.deepEqual(ps.relics, ['r_cap'], '结算事件本身不动藏品');

  // 之后走同一个 g.relicPick：先定换出、再选换入
  assert.equal(self.relicPick(ps, 'r_cap').ok, true);
  const take = ps.relicOffer[0];
  assert.equal(self.relicPick(ps, take).ok, true);
  assert.deepEqual(ps.relics, [take], '1 件换 1 件完成');
});
