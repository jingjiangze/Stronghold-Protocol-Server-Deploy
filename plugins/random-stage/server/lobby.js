// plugins/random-stage/server/lobby.js — 「随机地图」开关的房间层实现（code.lobby）。
//
// 从 room-chat 拆出来（业主 2026-10-30「插件拆细」）：聊天/贴纸与「换不换图」是两件事，
// 原来硬绑在同一个插件里。本插件只做四件事，都不碰 code.match：
//   ① C2S：room.setRandomStage（房主、开局前）
//   ② 房间字段：randomStage 缺省 = false（**默认关**）
//   ③ room.state：只在**开**时带 randomStage:true（默认房间字节不变）
//   ④ Match opts：只在**开**时带 randomStage:true
// 换图的执行在 mota 的 Match 里（plugins/mota/server/match/Match.js 读这个选项）—— 对局引擎不拆，
// 拆的只是「谁提供这个房间选项」。
import { ERR } from '../../../shared/constants.js';

const OK = Object.freeze({ ok: true });
const fail = (code) => ({ error: code });

export function setup(api) {
  // 宿主协议表里没有这个键（核心不认识房间选项），由插件自己登记；宿主已有同名键时以引擎为准。
  try { api.protocol({ 'room.setRandomStage': { randomStage: (v) => typeof v === 'boolean' } }); } catch { /* 老宿主没有 api.protocol */ }

  api.on('room.setRandomStage', (session, msg, ctx, lobby) => {
    const room = lobby.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.hostId !== session.playerId) return fail(ERR.NOT_HOST);
    if (room.match) return fail(ERR.ROOM_STARTED);
    const next = msg.randomStage === true;
    if (room.randomStage === next) return OK;
    room.randomStage = next;
    lobby.broadcastState(room);
    return OK;
  });

  api.roomInit((room) => {
    if (room.randomStage === undefined) room.randomStage = false;
  });

  api.roomState((room) => (room.randomStage === true ? { randomStage: true } : null));

  api.matchOptions((room) => (room.randomStage === true ? { randomStage: true } : {}));

  return () => { /* nothing to tear down beyond the host dropping ext */ };
}
