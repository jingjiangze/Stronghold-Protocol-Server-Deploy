// plugins/room-chat/server/lobby.js — 同盟通讯（房间聊天）与「随机地图」开关的 lobby 级实现。
//
// 挂载面：manifest 2 的 `code.lobby`（server/plugins/lobbyModules.js）—— 2026-10-23 新增的 lobby 级插件钩子。
// 它提供：C2S 处理（room.chat / room.chat.history）、房间事件（joined/resync 补发历史、disposed 清理）。
// 2026-10-30「插件拆细」：随机地图开关已拆到独立插件 `random-stage`（只用 code.lobby，不碰对局引擎）。
//
// 边界与原来写在宿主里时一致：消息只活在房间内存（环形缓冲）；旁观者收得到、说不了；文本按码点截断。
import { ERR, ROOM_CODE_LEN } from '../../../shared/constants.js';
import { sendSession } from '../../../server/net.js';

/**
 * 聊天限额与 C2S 校验都留在插件里：`api.protocol()` 是宿主给的**新增**协议键入口（已存在的键不覆盖），
 * 所以这套东西完全不需要核心 `shared/protocol.js` 认识它。
 */
const CHAT_LIMITS = Object.freeze({
  text: 200,           // 清洗后的长度（Unicode 码点）
  inbound: 1024,       // 入站原文上限（清洗前就拒）
  history: 80,         // 每房间保留并补发的条数
  perSec: 2, burst: 6, // 每会话令牌桶（chat 与 history 共用）
});
const isStr = (v, max = 64) => typeof v === 'string' && v.length <= max;
const optional = (check) => (v) => v === undefined || check(v);
const chatEmoteId = (v) => typeof v === 'string' && v.length <= 64 && /^[A-Za-z0-9_]+$/.test(v);
const chatStickerFile = (v) => typeof v === 'string' && v.length <= 80 && /^[A-Za-z0-9._-]+$/.test(v);
/** 本插件新增的 C2S 键（宿主协议表里没有同名键，否则会被忽略）。 */
const CHAT_PROTOCOL = {
  'room.chat': {
    text: optional((v) => isStr(v, CHAT_LIMITS.inbound)),
    emote: optional(chatEmoteId),
    sticker: optional(chatStickerFile),
  },
  'room.chat.history': { code: (v) => isStr(v, ROOM_CODE_LEN + 2) && /^[A-Za-z0-9]+$/.test(v) },
};

const OK = Object.freeze({ ok: true });
const fail = (code, detail) => (detail ? { error: code, detail } : { error: code });

/** 聊天文本清洗：按 Unicode 码点截断、控制字符换空格、连续空白压成一个、去首尾空白。 */
function chatText(raw) {
  if (typeof raw !== 'string' || !raw) return '';
  let out = '';
  for (const ch of raw) {
    const cp = ch.codePointAt(0);
    out += (cp < 0x20 || cp === 0x7f) ? ' ' : ch;
    if (out.length > CHAT_LIMITS.inbound) break;
  }
  return Array.from(out.replace(/\s+/g, ' ').trim()).slice(0, CHAT_LIMITS.text).join('');
}

export function setup(api) {
  // 自己把 C2S 键登记进协议表（宿主已有同名键时忽略，以引擎为准）
  try { api.protocol(CHAT_PROTOCOL); } catch { /* 老宿主没有 api.protocol：下面 api.on 仍会挂处理函数 */ }
  /** 每会话令牌桶（chat 与 history 共用）。 */
  const allowed = (session, now) => {
    const b = session.chatBucket || (session.chatBucket = { at: now, tokens: CHAT_LIMITS.burst });
    const dt = Math.max(0, now - b.at) / 1000;
    b.at = now;
    b.tokens = Math.min(CHAT_LIMITS.burst, b.tokens + dt * CHAT_LIMITS.perSec);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  };

  const sendHistory = (room, session) => {
    if (!room.chat || !room.chat.length || !session || !session.connected) return;
    sendSession(session, { t: 'room.chat.history', code: room.code, messages: room.chat });
  };

  const sayInRoom = (lobby, room, seat, payload) => {
    const out = {
      t: 'room.chat', id: ++room.chatSeq, code: room.code, playerId: seat.playerId, from: seat.playerId,
      name: seat.name, seat: seat.seat, time: lobby.now(), at: lobby.now(), ...payload,
    };
    room.chat.push(out);
    if (room.chat.length > CHAT_LIMITS.history) room.chat.splice(0, room.chat.length - CHAT_LIMITS.history);
    lobby.broadcastRoom(room, out);
    return out;
  };

  // ---- C2S ----
  api.on('room.chat', (session, msg, ctx, lobby) => {
    const room = lobby.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (room.spectatorOf(session.playerId)) return fail(ERR.SPECTATOR);
    const seat = room.seatOf(session.playerId);
    if (!seat || seat.isBot) return fail(ERR.NOT_IN_ROOM);
    if (!allowed(session, lobby.now())) return fail(ERR.RATE, 'slow down');
    const text = chatText(msg && msg.text);
    const emote = msg && typeof msg.emote === 'string' ? msg.emote : null;
    const sticker = msg && typeof msg.sticker === 'string' ? msg.sticker : null;
    if (!text && !emote && !sticker) return OK;
    sayInRoom(lobby, room, seat, { ...(text ? { text } : {}), ...(emote ? { emote } : {}), ...(sticker ? { sticker } : {}) });
    return OK;
  });

  api.on('room.chat.history', (session, msg, ctx, lobby) => {
    const room = lobby.roomOf(session);
    if (!room) return fail(ERR.NOT_IN_ROOM);
    if (String(msg.code || '').toUpperCase() !== room.code) return fail(ERR.NOT_IN_ROOM, 'that is not your room');
    if (!allowed(session, lobby.now())) return fail(ERR.RATE, 'slow down');
    sendHistory(room, session);
    return OK;
  });

  // ---- 房间字段 ----
  api.roomInit((room) => {
    if (!Array.isArray(room.chat)) room.chat = [];
    if (!Number.isInteger(room.chatSeq)) room.chatSeq = 0;
  });

  // ---- 房间事件 ----
  api.onRoom('joined', (room, session) => { sendHistory(room, session); });
  api.onRoom('resync', (room, session) => { sendHistory(room, session); });
  api.onRoom('disposed', (room) => { room.chat = []; room.chatSeq = 0; });

  return () => { /* nothing to tear down beyond the host dropping ext */ };
}
