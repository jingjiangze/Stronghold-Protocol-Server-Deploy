// 藏品投放的门（`MatchMeltdown.relicOffer` / `relicDraftRound`）：协同共竞与**肉鸽**都发，其它模式一件都不发。
//
// 回归来源（2026-10-30）：`relicOffer()` 以前只认 `modeId` 前缀 `mode_xie_`，而肉鸽房的 modeId 是
// `mode_multi_*` ⇒ 肉鸽**一件藏品都发不出来**。这里直接调实现（不复制一份逻辑）。
// 2026-11-06 业主裁决把肉鸽节奏从「开局 + 每 2 回合」改成**按节点给**（事件 / 首领），协同仍是 R4/R8/R12。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MatchMeltdown } from '../../plugins/mota/server/match/match/meltdown.js';

const RELICS = JSON.parse(fs.readFileSync(new URL('../../plugins/relics-87/data/relics.json', import.meta.url), 'utf8'));

/** 一个只够 `relicOffer` 跑起来的最小 self（`this`）。 */
function fakeMatch({ modeId, isRogue, round = 1, relics = RELICS, owned = [], nodeType = null }) {
  const ps = { playerId: 'p_0', alive: true, relics: owned.slice(), relicOffer: null, relicOfferCards: null };
  const timers = [];
  const self = {
    modeId, isRogue, round, seed: 20261030,
    gd: { raw: { relics } },
    alivePlayers: () => [ps],
    relicPool: MatchMeltdown.prototype.relicPool,
    relicDraftPool: MatchMeltdown.prototype.relicDraftPool,
    relicDraftRound: MatchMeltdown.prototype.relicDraftRound,
    // 肉鸽节奏按「本回合落地的节点类型」判（meltdown.relicDraftRound → NodeMixin.rogueNodeTypeFor）
    rogueNodeTypeFor: () => nodeType,
    markPrivate() {}, markPublic() {}, reportError() {},
    later(ms, fn) { timers.push({ ms, fn }); return timers.length; },
  };
  MatchMeltdown.prototype.relicOffer.call(self);
  return { ps, timers };
}

test('肉鸽房（mode_multi_* + isRogue）在**事件节点**发 3 选 1 —— 不再是死门', () => {
  const { ps } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, round: 3, nodeType: 'event' });
  assert.ok(Array.isArray(ps.relicOffer) && ps.relicOffer.length === 3, 'event 节点必须发到 3 张');
  assert.equal(ps.relicOfferCards.length, 3, '卡面数据一并带上');
  assert.equal(ps.relicOfferRound, 3);
});

test('自动选卡的兜底是 **20 秒**，不是 20 毫秒（`later()` 收毫秒）', () => {
  const { timers } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, round: 3, nodeType: 'event' });
  assert.equal(timers.length, 1, '只排一个兜底定时器');
  assert.equal(timers[0].ms, 20000, '曾经写成 later(20, …) ⇒ 20ms 后自动取第一张，弹窗不可见');
});

test('普通合作模式（无 isRogue）一件都不发', () => {
  const { ps } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: false, round: 1 });
  assert.equal(ps.relicOffer, null);
});

test('协同共竞（mode_xie_*）照旧发，节奏由 relicDraftRound 决定', () => {
  const { ps } = fakeMatch({ modeId: 'mode_xie_normal', isRogue: false, round: 4 });
  assert.equal(ps.relicOffer.length, 3);
});

test('节奏：肉鸽 = 事件 / 首领节点；协同 = R4 / R8 / R12', () => {
  const rogue = (nodeType) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: true, rogueNodeTypeFor: () => nodeType }, 5);
  const xie = (r) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: false }, r);
  assert.equal(rogue('wish'), true, '得偿所愿节点给藏品');
  assert.equal(rogue('event'), false, '事件节点不再自动发（改成事件选项里带代价换）');
  assert.equal(rogue('boss'), true, '首领节点给藏品');
  assert.equal(rogue('battle'), false, '战斗节点不给');
  assert.equal(rogue('elite'), false, '精英节点不给');
  assert.equal(rogue('shop'), true, '商店节点发的是标价购买（relicOffer 会带 price）');
  assert.equal(rogue('rest'), false, '休整节点不给');
  assert.deepEqual([1, 2, 3, 4, 8, 12, 13].map(xie), [false, false, false, true, true, true, false]);
});

test('没有藏品数据时静默不发（不抛错）', () => {
  const { ps } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, relics: { relics: [] } });
  assert.equal(ps.relicOffer, null);
});

test('肉鸽不设「每人 3 件」上限：已拿 3 件仍然发（官方没有这条）', () => {
  const { ps } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, round: 4, nodeType: 'event', owned: ['p40', 'p45', 'n06'] });
  assert.ok(Array.isArray(ps.relicOffer) && ps.relicOffer.length === 3, '肉鸽拿满 3 件后照样发');
});

test('协同共竞仍是每人本局 3 件：已拿满就不再发', () => {
  const { ps } = fakeMatch({ modeId: 'mode_xie_normal', isRogue: false, round: 8, owned: ['p40', 'p45', 'n06'] });
  assert.equal(ps.relicOffer, null);
});
