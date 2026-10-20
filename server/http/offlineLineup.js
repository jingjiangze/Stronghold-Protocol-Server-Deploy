// server/http/offlineLineup.js — 接收离线局补传的布阵：POST /api/offline-lineup
//
// 为什么另开一个端点（而不是复用 /api/lineup-score）：那个端点收的是**评分**（{sig, modeId, difficulty, results}），
// 且服务端只 JSON.parse 一下、永远回 200、**不落盘**（server/http/routes.js:104-116）。学习库要的是**棋盘本身**
// （cells），字段集不同（见 plugins/mota/server/lineupLibrary.js:330-339 的记录形状）。
//
// 信任模型（与 /api/lineup-score 同一立场，见 docs/AI-SCORING-CONTRACT.md）：
//   * 永远 200 —— 上传失败绝不能影响玩家的本地数据或对局；客户端按 `accepted` 决定删不删本地队列；
//   * 服务端自己判真伪：形状（validCells）、结算原因、农场速率（isFarm）、库是否开启，一条都不交给客户端说了算；
//   * 有界：单请求体上限 256 KB，单批条目上限 40，每 IP 限速。超限的那部分**不计入 accepted**，客户端会留着。
//
// 未开启学习库（SP_LINEUP_LIBRARY 未设）时 accepted 恒为 0，但仍是 200：客户端因此把条目留在队列里，
// 等这台服务器哪天开了库再传 —— 比丢掉好。

import { acceptOfflineLineups } from '../../plugins/mota/server/lineupLibrary.js';

/** 这个端点唯一的路径。 */
export const OFFLINE_LINEUP_PATH = '/api/offline-lineup';
/** 单请求体上限（字节）。一条布阵通常 1–3 KB，40 条远在 256 KB 之下。 */
export const MAX_BODY_BYTES = 256 * 1024;
/** 单批最多接受的条目数。 */
export const MAX_ENTRIES = 40;
/** 每 IP 每分钟最多几次请求。 */
export const RATE_LIMIT_PER_MIN = 10;

const CORS = Object.freeze({
  'Content-Type': 'application/json; charset=utf-8',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'content-type',
  'Cache-Control': 'no-store',
});

/** 极简每 IP 计数（进程级；与 routes.js 里评分端点那个 scoreBucket 同一风格，够用即可）。 @type {Map<string, number[]>} */
const hits = new Map();

/**
 * @param {string} addr 客户端地址（已按 trustProxy 归一）
 * @param {number} now
 * @returns {boolean} true = 放行
 */
function allow(addr, now) {
  const key = String(addr || '?');
  const win = hits.get(key) || [];
  const fresh = win.filter((t) => now - t < 60_000);
  if (fresh.length >= RATE_LIMIT_PER_MIN) { hits.set(key, fresh); return false; }
  fresh.push(now);
  hits.set(key, fresh);
  if (hits.size > 5000) {
    // 防无界增长：一次性清掉过期的桶（正常的服务器不会同时有 5000 个活跃客户端）
    for (const [k, v] of hits) if (!v.length || now - v[v.length - 1] > 60_000) hits.delete(k);
  }
  return true;
}

/**
 * 处理一条 /api/offline-lineup 请求。调用方（routes.js）已确认路径；这里只管方法与体。
 * @param {import('node:http').IncomingMessage} req
 * @param {import('node:http').ServerResponse} res
 * @param {{ log?: object, clientAddr?: string, now?: () => number, accept?: Function }} [opts]
 * @returns {Promise<void>}
 */
export async function handleOfflineLineup(req, res, opts = {}) {
  const { log = console, clientAddr = '', now = () => Date.now(), accept = acceptOfflineLineups } = opts;
  const reply = (body) => {
    res.writeHead(200, CORS);
    res.end(JSON.stringify(body));
  };

  if (req.method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    reply({ ok: true, accepted: 0, dropped: 'method' });
    return;
  }
  if (!allow(clientAddr, now())) {
    reply({ ok: true, accepted: 0, dropped: 'rate' });
    return;
  }

  // 按**字节**累计（MAX_BODY_BYTES 是字节）：body += chunk 会把 Buffer 转成 UTF-16 字符串，
  // 既让上限随内容丰富度浮动，也会在 UTF-8 多字节字符跨块时切坏它。收块、按字节判、最后一次性解码。
  const chunks = [];
  let bytes = 0;
  let tooBig = false;
  try {
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_BODY_BYTES) { tooBig = true; break; }
      chunks.push(chunk);
    }
  } catch (e) {
    log.warn?.('[offline-lineup] body read failed', e && e.message);
    reply({ ok: true, accepted: 0, dropped: 'body' });
    return;
  }
  if (tooBig) {
    // 不 destroy 连接：客户端要拿到这个 200 才会停止重试（它按 accepted 决定留不留本地队列）
    reply({ ok: true, accepted: 0, dropped: 'size' });
    return;
  }
  const body = Buffer.concat(chunks).toString('utf8');

  let doc;
  try { doc = JSON.parse(body); } catch { doc = null; }
  const entries = doc && Array.isArray(doc.entries) ? doc.entries : null;
  if (!entries) { reply({ ok: true, accepted: 0, dropped: 'shape' }); return; }
  if (entries.length > MAX_ENTRIES) {
    // 多出来的不收：客户端按 accepted 只删收下的那部分
    entries.length = MAX_ENTRIES;
  }

  let result;
  try {
    result = await accept(entries);
  } catch (e) {
    log.error?.('[offline-lineup] accept failed', e);
    reply({ ok: true, accepted: 0, dropped: 'error' });
    return;
  }
  const accepted = result && Number.isFinite(result.accepted) ? result.accepted : 0;
  const rejected = result && Number.isFinite(result.rejected) ? result.rejected : 0;
  if (accepted) log.info?.(`[offline-lineup] accepted ${accepted} lineup(s) from ${clientAddr || '?'} (${rejected} rejected)`);
  reply({ ok: true, accepted, rejected });
}
