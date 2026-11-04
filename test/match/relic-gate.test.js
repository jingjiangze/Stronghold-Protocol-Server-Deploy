// 藏品投放的门（`MatchMeltdown.relicOffer` / `relicDraftRound`）：协同共竞与**肉鸽**都发，其它模式一件都不发。
//
// 回归来源（2026-10-30）：`relicOffer()` 以前只认 `modeId` 前缀 `mode_xie_`，而肉鸽房的 modeId 是
// `mode_multi_*` ⇒ 肉鸽节奏上每 2 回合该发，实际上**一件藏品都发不出来**（业主「肉鸽并入协同」时发现）。
// 这里直接调实现（不复制一份逻辑），顺带钉住「肉鸽 R1 就发、协同 R4/R8/R12」的节奏。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { MatchMeltdown } from '../../plugins/mota/server/match/match/meltdown.js';

const RELICS = JSON.parse(fs.readFileSync(new URL('../../plugins/relics-87/data/relics.json', import.meta.url), 'utf8'));

/** 一个只够 `relicOffer` 跑起来的最小 self（`this`）。 */
function fakeMatch({ modeId, isRogue, round = 1, relics = RELICS, owned = [] }) {
  const ps = { playerId: 'p_0', alive: true, relics: owned.slice(), relicOffer: null, relicOfferCards: null };
  const timers = [];
  const self = {
    modeId, isRogue, round, seed: 20261030,
    gd: { raw: { relics } },
    alivePlayers: () => [ps],
    relicPool: MatchMeltdown.prototype.relicPool,
    relicDraftPool: MatchMeltdown.prototype.relicDraftPool,
    relicDraftRound: MatchMeltdown.prototype.relicDraftRound,
    markPrivate() {}, markPublic() {}, reportError() {},
    later(ms, fn) { timers.push({ ms, fn }); return timers.length; },
  };
  MatchMeltdown.prototype.relicOffer.call(self);
  return { ps, timers };
}

test('肉鸽房（mode_multi_* + isRogue）第 1 回合就发 3 选 1 —— 不再是死门', () => {
  const { ps } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, round: 1 });
  assert.ok(Array.isArray(ps.relicOffer) && ps.relicOffer.length === 3, 'rogue R1 必须发到 3 张');
  assert.equal(ps.relicOfferCards.length, 3, '卡面数据一并带上');
  assert.equal(ps.relicOfferRound, 1);
});

test('自动选卡的兜底是 **20 秒**，不是 20 毫秒（`later()` 收毫秒）', () => {
  const { timers } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, round: 1 });
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

test('节奏：肉鸽 = R1 + 每 2 回合；协同 = R4 / R8 / R12', () => {
  const rogue = (r) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: true }, r);
  const xie = (r) => MatchMeltdown.prototype.relicDraftRound.call({ isRogue: false }, r);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map(rogue), [true, true, false, true, false, true]);
  assert.deepEqual([1, 2, 3, 4, 8, 12, 13].map(xie), [false, false, false, true, true, true, false]);
});

test('没有藏品数据时静默不发（不抛错）', () => {
  const { ps } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, relics: { relics: [] } });
  assert.equal(ps.relicOffer, null);
});

test('每人本局最多 3 件：已拿满就不再发', () => {
  const { ps } = fakeMatch({ modeId: 'mode_multi_normal', isRogue: true, round: 2, owned: ['p40', 'p45', 'n06'] });
  assert.equal(ps.relicOffer, null);
});
