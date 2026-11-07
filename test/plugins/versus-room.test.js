// test/plugins/versus-room.test.js — AI 对抗（2026-11-01 立项）的房间层接线：
//   versus-room 插件的 RULES 认识 'ai'、matchOptions 强制固定攻守（versusAlt=false，服务端兜底）、
//   beforeStart 对 'ai' 拒绝「真人坐进 team1」并补满 AI 席。
// 实现在 plugins/versus-room/server/versusLobby.js；本测试用 stub api 直接驱动插件钩子。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setup } from '../../plugins/versus-room/server/versusLobby.js';

function apiOf() {
  const h = {};
  setup({ roomInit: (f) => { h.roomInit = f; }, matchOptions: (f) => { h.matchOptions = f; }, beforeStart: (f) => { h.beforeStart = f; } });
  return h;
}

/** 8 席（MAX_SEATS）的空座位表，按 [席号, 是否 AI] 放人。 */
function seatsOf(entries) {
  const seats = new Array(8).fill(null);
  for (const [seat, isBot] of entries) seats[seat] = { seat, playerId: isBot ? `ai_${seat}` : `p_${seat}`, isBot };
  return seats;
}

/** addBot stub：与核心一致（最低空位）。 */
function lobbyOf(room) {
  return {
    addBot() {
      const idx = room.seats.findIndex((s) => !s);
      if (idx < 0) return { error: 'ROOM_FULL' };
      room.seats[idx] = { seat: idx, playerId: `ai_${idx}`, isBot: true, ready: true, connected: true, left: false };
      return {};
    },
  };
}

test("RULES 认识 'ai'：matchOptions 传 versusRule=ai 且强制 versusAlt=false（固定攻守）", () => {
  const h = apiOf();
  const ai = h.matchOptions({ mode: 'versus', variant: 'ai', teamSize: 2, versusAlt: true });
  assert.equal(ai.versusRule, 'ai');
  assert.equal(ai.versusAlt, false, '服务端兜底：不信任客户端传来的 versusAlt');
  assert.equal(ai.versusSpeed, 1);
  const bounty = h.matchOptions({ mode: 'versus', variant: 'bounty', teamSize: 2 });
  assert.equal(bounty.versusRule, 'bounty');
  assert.equal(bounty.versusAlt, true, '赏金档不受影响');
  const unknown = h.matchOptions({ mode: 'versus', variant: 'nope', teamSize: 2 });
  assert.equal(unknown.versusRule, 'bounty', '未知规则回落赏金');
  assert.equal(h.matchOptions({ mode: 'coop' }), null, '非对抗房不参与');
});

test("beforeStart（ai）：team1 坐真人 ⇒ 拒绝开局；team1 全空 ⇒ 用 AI 补满", () => {
  const h = apiOf();
  const room = { mode: 'versus', variant: 'ai', teamSize: 2, seats: seatsOf([[0, false], [2, false]]) };
  const lobby = lobbyOf(room);
  const bad = h.beforeStart(room, {}, lobby);
  assert.equal(bad.error, 'BAD_MSG', 'team1（席 2）的真人要被拦住');
  room.seats[2] = null; // 把真人请回 team0 或移走
  const ok = h.beforeStart(room, {}, lobby);
  assert.equal(ok, null);
  assert.ok(room.seats[0] && !room.seats[0].isBot, '真人保持 team0');
  assert.ok(room.seats[1] && room.seats[1].isBot, 'team0 空位由 AI 补（攻方队友）');
  assert.ok(room.seats[2] && room.seats[2].isBot && room.seats[3] && room.seats[3].isBot, 'team1 全是 AI');
  assert.ok(room.seats.slice(4).every((s) => !s), '分边之外不补人');
});

test('beforeStart（bounty）：行为不变（不拒绝 team1 里的真人）', () => {
  const h = apiOf();
  const room = { mode: 'versus', variant: 'bounty', teamSize: 2, seats: seatsOf([[0, false], [2, false]]) };
  const lobby = lobbyOf(room);
  assert.equal(h.beforeStart(room, {}, lobby), null);
  assert.ok(room.seats.slice(0, 4).every((s) => s), '前四个席位补满');
});
