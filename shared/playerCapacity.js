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
/**
 * From this many players the shop pool is split into groups (below it everyone shares one, as the original game did).
 *
 * Kept as the published "is the pool split at all" threshold; `poolGroupSizes` no longer branches on it, because the
 * 4-player chunking loop yields the single group [players] on its own for 4 players and fewer.
 */
export const GROUPED_POOL_MIN_PLAYERS = 5;

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
 * 4 是原版牌库经济的设计基准(BASE_SEATS),自 owner 2026-11-05「每四人一个分组牌库」起也是分队的实际人数上限:
 * 每队最多 4 人,所以每队都拿**完整的一份原始 4 人池**,没有队伍会因为人多而要扩容。
 */
export const MAX_SQUAD_SIZE = BASE_SEATS;

/**
 * 分队人数(按 seat 顺序每 4 人一队,保序切块,最后一块是余数)。
 *
 * owner 2026-11-05「每四人一个分组牌库」:20 人房 = 5 队各 4 人,5 人房 = [4, 1],6 人房 = [4, 2],
 * 8 人房 = [4, 4]。4 人及以下只有一队 —— 全场共享原版牌库,行为与旧版一致。
 *
 * 每队都不超过 BASE_SEATS,所以 `poolCopyScale` 恒为 1:每队各拿一份完整 4 人份牌库,组与组之间不共用库存。
 *
 * @param {number} players 1..MAX_SEATS
 * @returns {number[]} e.g. 5 players → [4, 1], 8 → [4, 4], 20 → [4, 4, 4, 4, 4]
 */
export function poolGroupSizes(players) {
  if (!Number.isInteger(players) || players < 1 || players > MAX_SEATS) throw new RangeError('invalid player count');
  const out = [];
  for (let left = players; left > 0; left -= BASE_SEATS) out.push(Math.min(BASE_SEATS, left));
  return out;
}

/**
 * How much a shared pool's contents are multiplied by.
 *
 * A group of BASE_SEATS or fewer keeps the complete original pool; only a group larger than four expands — otherwise
 * five players would share the copies four players used to, and the shop would run dry. Grouped pools chunk every
 * room into ≤4-player groups (`poolGroupSizes`), so this is 1 for every group today.
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
