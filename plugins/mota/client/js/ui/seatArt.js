// 名片干员: the portrait a doctor shows on the room's seat card (screens/room.js) and on the strategy draft's name-card rows
// (screens/bandDraft.js) — the operator the player picked (room.card; room.state seats[].card), else one of the 5★/6★
// operators chosen by the player id, the same on every client.
import { chessPortraitUrl } from './assetUrls.js';
import { createStore, loadPref, savePref } from '../store.js';

/** FNV-1a of a string (the portrait pick: the same operator for a player on every client). */
function hash32(s) {
  let h = 0x811c9dc5;
  for (const ch of String(s)) { h ^= ch.codePointAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
}

/** 名片干员: the player's own pick (localStorage; sent as room.card where the server knows it). */
export const CARD_PREF = 'room.card';

/**
 * The operators a seat card can show: one record per charId (the elite form for its E2 art), 6★ first.
 * @param {any[]} chessList chess.json records
 * @returns {any[]}
 */
export function cardOperators(chessList) {
  const by = new Map();
  for (const c of Array.isArray(chessList) ? chessList : []) {
    if (!c || c.isDiy || c.visible === false || typeof c.charId !== 'string') continue;
    const prev = by.get(c.charId);
    if (!prev || (c.isGolden && !prev.isGolden)) by.set(c.charId, c);
  }
  return [...by.values()].sort((a, b) => ((b.rarity ?? 0) - (a.rarity ?? 0)) || String(a.name).localeCompare(String(b.name), 'zh'));
}

/**
 * The seat card's portrait: the operator the player picked (room.state seats[].card, or one's own pick), else one of
 * the 5★/6★ operators chosen by the player id — the same on every client (null before the data loads).
 * @param {any} seat room.state seat @param {{ pool: any[], byChar: Map<string, any>, m: any, myId: any, myCard: string }} ctx
 */
export function seatPortrait(seat, { pool, byChar, m, myId, myCard }) {
  if (!seat || seat.playerId == null) return null;
  const pick = (seat.playerId === myId && myCard) || seat.card;
  const rec = pick && byChar ? byChar.get(pick) : null;
  if (rec) return chessPortraitUrl(m, rec);
  if (!Array.isArray(pool) || !pool.length) return null;
  return chessPortraitUrl(m, pool[hash32(seat.playerId) % pool.length]);
}

// ── 名片同步的 store（上游 v0.3.2 的 ui/seatArt.js 提供；本插件自己写过 seatArt，这里只补 store 这几项） ──
// 谁在用：ui/loadoutSync.js 顶部 `import { cardStore, CARD_KEY, CARD_SYNC_KEY, cardOperators }` —— 缺任何一个都是
// ES 模块链接期失败（整图加载不起来），所以即便不启用 installCardSync 也必须存在。
// 现状：本插件的名片 picker 走 screens/room.js 的 savePref + 直发 room.card（唯一发送源），**不**调 installCardSync。

/** The store field of the pick (ui/loadoutSync.js installCardSync `key`) and its sync state field. */
export const CARD_KEY = 'card';
export const CARD_SYNC_KEY = 'cardSync';

/** A stored pick as the store holds it: a charId string, '' for none (默认). */
export function parseStoredCard(v) {
  return typeof v === 'string' ? v : '';
}

/** This browser's pick and its sync state (survives room / match resets like ui/skins.js' store). */
export const cardStore = createStore({ [CARD_KEY]: parseStoredCard(loadPref(CARD_PREF, '')), [CARD_SYNC_KEY]: 'idle' });

/**
 * Pick the 名片干员 ('' = 默认): persisted at once. Not wired into a sync engine here — screens/room.js sends room.card.
 * @param {string} charId
 */
export function setCard(charId) {
  const next = parseStoredCard(charId);
  try { savePref(CARD_PREF, next); } catch { /* private mode: the session keeps it */ }
  cardStore.set({ [CARD_KEY]: next });
}
