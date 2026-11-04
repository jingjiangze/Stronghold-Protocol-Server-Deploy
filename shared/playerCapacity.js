// Capacity rules shared by the server and browser.
//
// Ported from the `feat/IncreasePlayerCapacity` fork (LongQianChen/Stronghold-Protocol, docs/PLAYER_CAPACITY.md). The
// guiding idea is that FOUR players stay the baseline: everything the original game scaled to a full room is expressed
// per BASE_SEATS here, so a 4-seat room behaves exactly as before and a larger one scales proportionally instead of
// falling off a cliff.
//
// Nothing in this file touches match state: it is arithmetic over a participant count, which is what lets the server
// (room capacity, shop pools, unite rounds) and the browser (capacity buttons, draft card count) share one answer.

import { BASE_SEATS, MAX_SEATS, MAX_DRAFT_CARDS } from './constants.js';

/** A draft always offers at least this many cards, however small the room. */
export const MIN_COOP_DRAFT_CARDS = 6;
/** Cards offered on top of the live player count, so a pick is a choice rather than a formality. */
export const DRAFT_SPARE_CARDS = 2;
/** From this many players the shop pool is split (below it everyone shares one, as the original game did). */
export const GROUPED_POOL_MIN_PLAYERS = 5;

/**
 * 分队人数表 (v0.2.2 基准,取自 `feat/IncreasePlayerCapacity` 的 `POOL_GROUP_LAYOUTS`)。
 *
 * 为什么是**固定表**而不是均分公式 —— 这是「牌库不够分」的根因。
 *
 * 商店池的份数按 `poolCopyScale = size / BASE_SEATS` 缩放,**只有 5 人组会扩容(1.25×)**。均分公式
 * 永远算出 3 或 4 人组,于是 scale 恒为 1:20 人分成五组,每组拿的都是**同一份原始 4 人池** ——
 * 组越多,同样的池被越多组各拿一遍,组内一抢就空。
 *
 * 固定表只在 9 / 13 / 17 人时派出一个 5 人组,让那一组拿到扩容池;其余人数刻意让组**尽量少、尽量满**
 * (14 人 4 组而不是 5 组),避免把池切碎。
 *
 * 表里的顺序就是座位分配顺序。
 */
const POOL_GROUP_LAYOUTS = Object.freeze({
  /*
   * ⚠ 5 人也在表里:owner 的规则是 5 人房就分队([3,2]),不是"一人一队 5 人共享"。
   *
   * 分队**不缩小**牌库 —— `poolCopyScale = max(1, size/4)`,3 人和 2 人的队都是 scale 1,各自拿到与 4 人房
   * 完全相同的**完整**牌库。全房份数因此高于旧的「一队 5 人 scale 1.25」:旧做法给 1.25 份,新做法给 2 份。
   * 这也是注释开头说的"固定表而非均分公式"的由来 —— 均分在 5 人时同样给 [3,2],所以两种算法在这里一致;
   * 分歧从 9 / 13 / 17 人开始(那里刻意派一个 5 人组去拿扩容池)。
   */
  5: [3, 2],
  6: [3, 3],
  7: [4, 3],
  8: [4, 4],
  9: [4, 5],
  10: [4, 3, 3],
  11: [4, 4, 3],
  12: [4, 4, 4],
  13: [5, 4, 4],
  14: [4, 4, 3, 3],
  15: [4, 4, 4, 3],
  16: [4, 4, 4, 4],
  17: [5, 4, 4, 4],
  18: [4, 4, 4, 3, 3],
  19: [4, 4, 4, 4, 3],
  20: [4, 4, 4, 4, 4],
});

/**
 * How many draft cards this many live participants are offered.
 *
 * One card each plus a couple of spares, clamped into [MIN_COOP_DRAFT_CARDS, MAX_DRAFT_CARDS]. `players` is the live
 * participant count (never empty slots, never spectators).
 * @param {number} players
 */
export function coopDraftCardCount(players) {
  return Math.min(MAX_DRAFT_CARDS, Math.max(MIN_COOP_DRAFT_CARDS, Math.trunc(players || 0) + DRAFT_SPARE_CARDS));
}

/**
 * 分队人数上限。
 *
 * 4 是原版牌库经济的设计基准(BASE_SEATS),但**不是硬上限** —— 5 人组是刻意的:它让 `poolCopyScale`
 * 变成 1.25,那一组才能拿到扩容池(见 POOL_GROUP_LAYOUTS)。所以这里报的是"基准",不是"不得超过"。
 */
export const MAX_SQUAD_SIZE = BASE_SEATS;

/**
 * 分队人数(BASE_SEATS 上限,小于 GROUPED_POOL_MIN_PLAYERS 时不再单独成队)。
 *
 * **5 人起就分队**(owner:「目前5个人6个人都会进入a分队 不会多个b分队」)—— 5 → [3,2],6 → [3,3],7 起查上面那张表。
 *
 * @param {number} players 1..MAX_SEATS
 * @returns {number[]} e.g. 5 players → [3, 2], 9 → [4, 5], 20 → [4, 4, 4, 4, 4]
 */
export function poolGroupSizes(players) {
  if (!Number.isInteger(players) || players < 1 || players > MAX_SEATS) throw new RangeError('invalid player count');
  if (players < GROUPED_POOL_MIN_PLAYERS) return [players];
  /*
   * 返回**副本**:调用方(`Match`、`pool.js`)会把结果存下来,共享同一个数组迟早被谁就地改掉。
   */
  return POOL_GROUP_LAYOUTS[players].slice();
}

/**
 * How much a shared pool's contents are multiplied by.
 *
 * A group of exactly BASE_SEATS keeps the complete original pool; a group of three keeps it too (the original game
 * already worked at three), and only a group larger than four expands — otherwise five players would share the copies
 * four players used to, and the shop would run dry.
 * @param {number} groupSize
 */
export const poolCopyScale = (groupSize) => Math.max(1, groupSize / BASE_SEATS);

/**
 * Unite rounds a room gets. A large room gets a second one: with 8+ seats a single unite round would decide too much
 * of the match for the players who were not in it.
 * @param {number} livingPlayers
 */
export const uniteRoundLimit = (livingPlayers) => (livingPlayers >= 8 ? 2 : 1);

/**
 * A hidden-core threshold scaled to the room.
 *
 * The original ≤4-player unlock requirement is kept exactly; a larger room needs proportionally more, because the
 * whole room contributes to the same counter.
 * @param {number} baseline the original threshold
 * @param {number} players
 */
export const coopHiddenLayerThreshold = (baseline, players) => Math.ceil(baseline * Math.max(1, players / BASE_SEATS));

/**
 * The maximum number of players one 联防 group may take.
 *
 * The owner's rule: the old cap of every unite group being at most 2 was fine for four players and crushing for a large
 * room, so the cap grows with the room — 4 players → 2, 8 → 3, 12 → 4, 16 → 5, 20 → 6.
 *
 * `ceil(players / BASE_SEATS) + 1`: at the baseline that is exactly the original 2, and each further full group of four
 * adds one more helper.
 * @param {number} players
 */
export const maxUniteHelpers = (players) => Math.ceil(Math.max(1, players) / BASE_SEATS) + 1;
