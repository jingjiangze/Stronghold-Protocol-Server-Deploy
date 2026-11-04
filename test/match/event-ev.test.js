// test/match/event-ev.test.js — 事件期 AI 估值升级（2026-11-01 P1，审计 I2/I3/I5）：
//   ① 剩余生效回合折现（词条持续 EVENT_DURATION_ROUNDS 回合；E3 在 R13 只剩 1 回合）；
//   ② used 排除已抽走的词条（均值只在剩余池上算）；
//   ③ opponentMul 给对手目标加权（打强对手收益/送弱对手代价按威胁放大）。
// 实现在 plugins/mota/server/match/match/event.js（eventEvFor 导出），本测试 import 同一份代码。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_CARDS, EVENT_DURATION_ROUNDS } from '../../plugins/mota/shared/constants.js';
import { eventEvFor } from '../../plugins/mota/server/match/match/event.js';

test('折现：剩余回合越少 EV 越小（线性），满回合等于基线', () => {
  const full = eventEvFor('self', 1); // E1 的 self EV 为正
  const one = eventEvFor('self', 1, { roundsLeft: 1 });
  assert.ok(Number.isFinite(full) && full > 0);
  assert.ok(Math.abs(one - full / EVENT_DURATION_ROUNDS) < 1e-9, '1 回合 = 满值 / 4');
  assert.equal(eventEvFor('self', 1, { roundsLeft: EVENT_DURATION_ROUNDS }), full, '满回合不折现');
  assert.equal(eventEvFor('self', 1, { roundsLeft: 0 }), 0, '0 回合归零');
  // E3 的 self EV 为负（审计原样：E3 自吃是亏的）——折现同样成立：|EV| 随剩余回合缩小
  const e3 = eventEvFor('self', 3);
  assert.ok(e3 < 0);
  assert.ok(Math.abs(eventEvFor('self', 3, { roundsLeft: 1 }) - e3 / EVENT_DURATION_ROUNDS) < 1e-9);
});

test('used：已抽走的词条不再计入均值', () => {
  const base = eventEvFor('self', 1);
  const ups = EVENT_CARDS.filter((c) => c.kind === 'up');
  assert.ok(ups.length >= 2, '池里至少两张正词条');
  const used = new Set(ups.map((c) => c.id));
  const filtered = eventEvFor('self', 1, { used });
  assert.notEqual(filtered, base, '抽空正词条后均值应变化');
  // 抽走全部「正」词条后，raw 只剩 down/mid 的平均（均 ≤ 0），self EV 不应高于基线
  assert.ok(filtered <= base + 1e-9);
});

test('opponentMul：对手目标按威胁加权，self/mate 不受影响', () => {
  const baseOpp = eventEvFor('oppA', 1);
  const strong = eventEvFor('oppA', 1, { opponentMul: 2 });
  const weak = eventEvFor('oppA', 1, { opponentMul: 0.5 });
  assert.ok(strong < baseOpp && baseOpp < weak, '打强对手（负收益更大）优于打弱对手');
  assert.equal(eventEvFor('self', 1, { opponentMul: 2 }), eventEvFor('self', 1), 'self 不受对手系数影响');
  assert.equal(eventEvFor('mate', 1, { opponentMul: 2 }), eventEvFor('mate', 1));
});

test('序列行仍按真实 eventIndex 估值（P0 修复保持）', () => {
  // E1 与 E3 的赔率不同 ⇒ EV 不同；且与显式 sequence 一致
  assert.equal(eventEvFor('self', 1), eventEvFor('self', 1, {}));
  assert.notEqual(eventEvFor('self', 1), eventEvFor('self', 3));
});
