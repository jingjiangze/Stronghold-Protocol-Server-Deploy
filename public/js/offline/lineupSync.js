// public/js/offline/lineupSync.js — 把离线局攒下的布阵补传给服务器（只在连着真服务器时传）。
//
// 这条链补的是「离线期间不上传、联网后补传」的后半句（用户要求）。判据：
//   * 离线模式（globalThis.__SP_OFFLINE__ 在）**绝不**尝试 —— 那一刻根本没有服务器；
//   * 在线会话 welcome 之后，把 localStorage 队列（offline/lineupOutbox.js）分批 POST 到 /api/offline-lineup；
//   * 服务端返回 accepted（真正写进学习库的条数），只删被接收的那些，其余留队列等下次；
//   * 永远不阻塞界面：所有失败只记一条 warn，离线/断网/服务器没开学习库都只是「队列不变」。
//
// 学习库门控在服务端（server/http/offlineLineup.js → plugins/mota/server/lineupLibrary.js:acceptOfflineLineups）：
// 形状 / validCells / isFarm / 库是否开启，一条都不交给客户端说了算。

import { net } from '../net.js';
import { takeOfflineLineups, dropOfflineLineups, offlineLineupCount } from './lineupOutbox.js';

/** 补传端点（与 server/http/offlineLineup.js 的路径必须一致）。 */
export const OFFLINE_LINEUP_URL = '/api/offline-lineup';
/** 一次最多传几条（服务端单批上限 MAX_ENTRIES=40，这里留余量）。 */
export const BATCH = 20;

let inflight = false;

/** 是否在线（有真服务器）：离线模式 __SP_OFFLINE__ 在，或 net 没连上，都不算。 */
const reallyOnline = () => !globalThis.__SP_OFFLINE__ && net.status === 'online';

/**
 * 推一批待传布阵给服务器。可安全重复调用（并发时直接返回）。
 * @param {{ fetch?: Function, log?: object }} [opts]
 * @returns {Promise<{ ok: boolean, sent: number, skipped?: string, error?: string }>}
 */
export async function flushOfflineLineups({ fetch: doFetch = null, log = console } = {}) {
  if (inflight) return { ok: false, sent: 0, skipped: 'inflight' };
  if (!reallyOnline()) return { ok: false, sent: 0, skipped: 'offline' };
  const pending = takeOfflineLineups(BATCH);
  if (!pending.length) return { ok: true, sent: 0 };

  const fetchImpl = doFetch || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, sent: 0, error: 'NO_FETCH' };

  inflight = true;
  try {
    const res = await fetchImpl(OFFLINE_LINEUP_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ entries: pending }),
    });
    let doc = null;
    try { doc = await res.json(); } catch { doc = null; }
    // 服务端永远 200 + fail-open；accepted 是它真正收下的条数
    if (!res.ok || !doc || doc.ok !== true) {
      log.warn?.('[offline] lineup upload refused', res.status);
      return { ok: false, sent: 0, error: `HTTP ${res.status}` };
    }
    const accepted = Number.isFinite(doc.accepted) ? doc.accepted : 0;
    const took = accepted >= pending.length ? pending : pending.slice(0, Math.max(0, accepted));
    dropOfflineLineups(took);
    if (doc.dropped === 'rate') return { ok: false, sent: took.length, skipped: 'rate' };
    return { ok: true, sent: took.length };
  } catch (err) {
    log.warn?.('[offline] lineup upload failed', err);
    return { ok: false, sent: 0, error: String((err && err.message) || err) };
  } finally {
    inflight = false;
  }
}

/**
 * 接线：每次 net 进入 online（welcome / 重连恢复）就尝试补传，直到队列空。断网自动停（skipped:'offline'）。
 * 由 main.js 在 boot 末尾调用一次；不绑定任何 UI，纯后台。
 * @param {{ log?: object }} [opts]
 * @returns {() => void} 解绑
 */
export function installOfflineLineupSync({ log = console } = {}) {
  const kick = () => {
    // 队列非空且在线才动；一次传一批，传完若仍有剩就继续（微任务里递归，避开同步长循环）
    if (offlineLineupCount() <= 0 || !reallyOnline()) return;
    void flushOfflineLineups({ log }).then((r) => {
      if (r.ok && r.sent > 0 && offlineLineupCount() > 0 && reallyOnline()) queueMicrotask(kick);
    });
  };
  const off = net.on('welcome', kick);
  kick(); // 安装时已在线（离线局→联网重开的同一会话里通常不在线，但兜底）
  return off;
}
