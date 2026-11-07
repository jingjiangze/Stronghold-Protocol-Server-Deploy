// test/plugins/versus-room.test.js — 对抗房（2026-11-01 立项）的房间层接线：
//   规则档只有两档（业主 2026-11-04）：'bounty'（赏金，每回合换边、可倍速）与 'confront'（对抗，固定攻守、恒 1 倍速）；
//   旧的第三档 'ai' 已撤（= 对抗 + AI 补席，由 beforeStart 补满），客户端再传 'ai' 一律回落 bounty。
//   matchOptions 只转发白名单字段（versusRule / versusAlt / versusSpeed），versusAlt 由服务端兜底；beforeStart 按分边人数补满 AI 席、不拒绝 team1 里的真人。
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

test("两档规则：'ai' 已撤，回落 bounty；bounty 透传倍速；confront 固定攻守且恒 1 倍速", () => {
  const h = apiOf();
  // 第三档 'ai' 已删除（versusLobby.js RULES = ['bounty','confront']）：未知档一律回落赏金。
  const ai = h.matchOptions({ mode: 'versus', variant: 'ai', teamSize: 2, versusAlt: false, versusSpeed: 2 });
  assert.equal(ai.versusRule, 'bounty', "'ai' 不再是规则档，回落赏金");
  assert.equal(ai.versusAlt, true, '赏金档每回合轮换攻守（服务端按规则档重写）');
  assert.equal(ai.versusSpeed, 2, '回落赏金后倍速按赏金档透传');
  const bounty = h.matchOptions({ mode: 'versus', variant: 'bounty', teamSize: 2 });
  assert.equal(bounty.versusRule, 'bounty');
  assert.equal(bounty.versusAlt, true, '赏金档换边');
  assert.equal(bounty.versusSpeed, 1, '未指定倍速时默认 1');
  assert.equal(h.matchOptions({ mode: 'versus', variant: 'bounty', teamSize: 2, versusSpeed: 1.5 }).versusSpeed, 1.5, '赏金档透传 1.5');
  assert.equal(h.matchOptions({ mode: 'versus', variant: 'bounty', teamSize: 2, versusSpeed: 3 }).versusSpeed, 1, '白名单外倍速回落 1');
  const confront = h.matchOptions({ mode: 'versus', variant: 'confront', teamSize: 2, versusAlt: true, versusSpeed: 2 });
  assert.equal(confront.versusRule, 'confront');
  assert.equal(confront.versusAlt, false, '对抗档固定攻守：不信任客户端传来的 versusAlt');
  assert.equal(confront.versusSpeed, 1, '对抗档恒 1 倍速');
  const unknown = h.matchOptions({ mode: 'versus', variant: 'nope', teamSize: 2 });
  assert.equal(unknown.versusRule, 'bounty', '未知规则回落赏金');
  assert.equal(h.matchOptions({ mode: 'coop' }), null, '非对抗房不参与');
});

test("beforeStart（'ai'）：team1 有真人不再被拒（与 bounty 同行为），空位补 AI", () => {
  const h = apiOf();
  const room = { mode: 'versus', variant: 'ai', teamSize: 2, seats: seatsOf([[0, false], [2, false]]) };
  const lobby = lobbyOf(room);
  const ok = h.beforeStart(room, {}, lobby);
  assert.equal(ok, null, "'ai' 已不是规则档：不再校验 team1 必须是 AI");
  assert.ok(room.seats[0] && !room.seats[0].isBot, '真人保持 team0');
  assert.ok(room.seats[2] && !room.seats[2].isBot, 'team1 的真人保持原位');
  assert.ok(room.seats[1] && room.seats[1].isBot, 'team0 空位由 AI 补（攻方队友）');
  assert.ok(room.seats[3] && room.seats[3].isBot, 'team1 空位由 AI 补（对手）');
  assert.ok(room.seats.slice(4).every((s) => !s), '分边之外不补人');
});

test('beforeStart（bounty / confront）：行为不变（不拒绝 team1 里的真人，前四席补满）', () => {
  for (const variant of ['bounty', 'confront']) {
    const h = apiOf();
    const room = { mode: 'versus', variant, teamSize: 2, seats: seatsOf([[0, false], [2, false]]) };
    const lobby = lobbyOf(room);
    assert.equal(h.beforeStart(room, {}, lobby), null, `${variant}：team1 的真人放行`);
    assert.ok(room.seats.slice(0, 4).every((s) => s), `${variant}：前四个席位补满`);
    assert.ok(!room.seats[2].isBot, `${variant}：team1 的真人没有被 AI 顶掉`);
  }
});
