// plugins/mota/server/versusLobby.js — 对抗房（2V2/4V4）的**房间层**逻辑，纯插件实现。
//
// 挂载面：manifest 2 的 `code.lobby`（server/plugins/lobbyModules.js）。它只做三件核心不认识的事：
//   1. roomInit：给 versus 房补一个默认分边人数（2 = 4 席，4 = 8 席）；
//   2. matchOptions：把分边人数交给对局（plugins/mota/server/match 的 teamOfSeat 按它分边）；
//   3. beforeStart：开局前按分边人数收窄座位表、补满 AI 席 —— 缺这一步就是「开局只有 1 个真人、没有对手」。
//
// 座位表在核心里固定是 MAX_SEATS 长、空位为 null；这里只把前 want 个位置填上，超出的位置保持 null 并在有人占位时拒绝开局，
// 因此不需要核心认识「对抗房座位上限」。

// 业主 2026-10-27：分边人数从「只认 2 / 4」放开到 1..10（总人数 2..20 偶数自定义）。
const TEAM_MIN = 1;
const TEAM_MAX = 10;
const validTeam = (n) => Number.isInteger(n) && n >= TEAM_MIN && n <= TEAM_MAX;

/** 分边人数的规范值：1..10 原样，其余回落 2。 */
const teamSizeOf = (room) => (validTeam(room?.teamSize) ? room.teamSize : 2);

/**
 * @param {{ roomInit: Function, matchOptions: Function, beforeStart: Function }} api
 */
export function setup(api) {
  api.roomInit((room) => {
    if (room && room.mode === 'versus' && !validTeam(room.teamSize)) room.teamSize = 2;
  });

  // 规则档（业主 2026-10-26 / 2026-11-04 定两档）：「赏金」= 当前线上那套（官方波次 + 替换份额，每回合轮换攻守）；
  // 「对抗」= 完全由玩家控制出怪，攻守固定（不换边）。第三档「AI 对抗」已撤（它就是「对抗」+ AI 补席，由 beforeStart 补满）。
  // 走 room.variant（客户端 room.create 带过来），不进 modeId —— 避免动 data/config.json 的模式表。
  const RULES = new Set(['bounty', 'confront']);
  const ruleOf = (room) => (RULES.has(room && room.variant) ? room.variant : 'bounty');
  api.matchOptions((room) => {
    if (!room || room.mode !== 'versus') return null;
    // 只走 versusRule（经 MatchProxy 的 wireOptions 白名单转发给子进程）。
    // 不走 modeId 前缀：实测 mode_confront_* 会让 GameData 找不到该模式，波次价值塌成 0。
    const rule = ruleOf(room);
    return { teamSize: teamSizeOf(room), versusRule: rule,
      // 赏金档强制每回合轮换攻守；对抗档强制固定（服务端兜底，不信客户端传来的 versusAlt）。
      versusAlt: rule === 'bounty',
      // 赏金档倍速（业主 2026-10-31）：1 / 1.5 / 2，只在赏金档透传；对抗档恒 1。
      versusSpeed: rule === 'bounty' && (room.versusSpeed === 1.5 || room.versusSpeed === 2) ? room.versusSpeed : 1,
      // 怪物形态（业主 2026-11-04 / 2026-11-06）：「共有出怪」= 'shared'（默认）/「单人怪物」= 'solo' /
      // 「单人掌握」= 'master'（资源仍是队级，只有每队第一位存活攻方操作怪物）。房间没声明就按 shared，
      // 与 confront.js 的 monsterMode 判定同口径；经 MatchProxy 的 wireOptions 白名单下发给子进程。
      monsterMode: room.monsterMode === 'solo' || room.monsterMode === 'master' ? room.monsterMode : 'shared' };
  });

  api.beforeStart((room, session, lobby) => {
    if (!room || room.mode !== 'versus') return null;
    if (!lobby || typeof lobby.addBot !== 'function') return { error: 'INTERNAL', detail: 'lobby.addBot is not available' };
    const want = teamSizeOf(room) * 2;
    // 分边之外的座位上有人：不静默踢人，直接把话说明白（房主可以先把人移走）
    if (room.seats.slice(want).some(Boolean)) {
      return { error: 'BAD_MSG', detail: `seats beyond the team size are taken (2V2 keeps 4, 4V4 keeps 8)` };
    }
    // AI 席按分边人数补满（对抗档的对手队本来就是 AI，由这里补齐）
    for (let i = 0; i < want; i++) {
      if (room.seats[i]) continue;
      const added = lobby.addBot(session);
      if (added && added.error) return added;
    }
    return null;
  });
}
