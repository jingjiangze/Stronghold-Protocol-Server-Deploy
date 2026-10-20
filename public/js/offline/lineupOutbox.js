// public/js/offline/lineupOutbox.js — 离线局的布阵「本地待传队列」。
//
// 为什么需要它：离线单人打完一局，棋盘是学习库最有价值的东西，但那一刻没有服务器可写。服务端自己的 outbox
// （plugins/mota/server/lineupOutbox.js）做「先本地、后补传」，这一格是它在页面侧的对应物，判据一致：
//   1. 先落本地（localStorage），一次成功写入才算收下；
//   2. 补传只由在线会话触发，失败按指数退避重试，绝不阻塞对局；
//   3. 补传成功才删除（服务端 outbox 也是 confirmDelete 语义）。
//
// 记录形状与服务端学习库一致（plugins/mota/server/lineupLibrary.js:330-339）：
//   t / at / modeId / stageId / difficulty / round / sig / cells[{id,golden,row,col,dir}]
//
// 存储：localStorage['sp.offline.lineups.v1'] = { entries: [...], at }。上限 200 条，超出按最早淘汰。

const KEY = 'sp.offline.lineups.v1';
const MAX = 200;

/**
 * 学习库的规范化签名，逐字同源于 plugins/mota/server/lineupLibrary.js:223-228（补传时服务端要它）。
 * 本模块不 import localLobby.js：那边 import 这里，反过来会成环。
 * @param {Array<object>} cells
 * @returns {string}
 */
export const sigOf = (cells) => (cells || []).map((c) => `${c.id}:${c.golden ? 1 : 0}:${c.row}:${c.col}:${c.dir}`).sort().join('|');

/** 读全部待传条目（永不抛出：隐私模式 / 坏 JSON 都当空队列）。 */
export function readOfflineLineups() {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    if (!raw) return [];
    const doc = JSON.parse(raw);
    const arr = doc && Array.isArray(doc.entries) ? doc.entries : [];
    return arr.filter((e) => e && typeof e === 'object' && Array.isArray(e.cells) && e.cells.length >= 2);
  } catch { return []; }
}

/** 写回队列（裁剪到上限）。 @param {Array<object>} entries */
function writeOfflineLineups(entries) {
  try {
    globalThis.localStorage?.setItem(KEY, JSON.stringify({ entries: entries.slice(-MAX), at: new Date().toISOString() }));
    return true;
  } catch { return false; /* 隐私模式 / 配额满：本条不入队，对局照常 */ }
}

/**
 * 入队一条布阵。同一条（同 modeId+难度+轮次+指纹）不重复入队。
 * @param {object} entry 学习库记录形状
 * @returns {boolean} 是否真的入队
 */
export function enqueueOfflineLineup(entry) {
  if (!entry || typeof entry !== 'object') return false;
  if (!Array.isArray(entry.cells) || entry.cells.length < 2) return false;
  const sig = typeof entry.sig === 'string' && entry.sig ? entry.sig : sigOf(entry.cells);
  const row = { ...entry, sig };
  const all = readOfflineLineups();
  const dup = all.some((e) => e.sig === row.sig && e.modeId === row.modeId && e.difficulty === row.difficulty && e.round === row.round);
  if (dup) return false;
  return writeOfflineLineups([...all, row]);
}

/** 取走若干条（不超过 limit）交给补传。 */
export function takeOfflineLineups(limit = 20) {
  return readOfflineLineups().slice(0, Math.max(1, limit));
}

/** 删除已成功补传的条目（按 sig + modeId + difficulty + round 定位）。 */
export function dropOfflineLineups(sent) {
  if (!Array.isArray(sent) || !sent.length) return readOfflineLineups().length;
  const keys = new Set(sent.map((e) => `${e.modeId}|${e.difficulty || ''}|${e.round}|${e.sig}`));
  const left = readOfflineLineups().filter((e) => !keys.has(`${e.modeId}|${e.difficulty || ''}|${e.round}|${e.sig}`));
  writeOfflineLineups(left);
  return left.length;
}

/** 队列条目数（诊断用）。 */
export function offlineLineupCount() {
  return readOfflineLineups().length;
}
