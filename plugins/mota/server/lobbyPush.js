// server/lobbyPush.js — 把本服的公开房间推到联机大厅站（sp-lobby）。
//
// 为什么是「推」而不是「拉」：游戏服跑在 ModelScope 创空间上，平台对非浏览器访问一律 403
// （`当前接口不支持通过SDK Token直接访问`），所以外站**读不到**我们的 /api/rooms。
// 反过来我们能出网，而外站的 `POST /api/rooms` 本来就是为服务器上报设计的（`{ok, added, token}`，600s TTL）。
//
// 策略（业主 2026-10-18：1 分钟一发也行）：
//   · 每 60 秒把所有**公开房**POST 一遍 —— 这就是心跳，续期 TTL；
//   · 关掉的房不发，600 秒后自然从外站消失（不依赖 DELETE，也就不需要追踪 token 的持久化）；
//   · 失败只记一次日志、下一轮继续；任何异常都吞掉，绝不影响游戏本身；
//   · `SP_LOBBY_PUSH=off` 可整体关掉；测试环境（NODE_ENV=test）默认不推。
const defaultLog = console; // 只在没有注入 log 时用；调用方一般传 server/index.js 的 log

export const LOBBY_PUSH_DEFAULT_URL = 'https://sp-lobby.jiangjiangze.icu/api/rooms';
const PUSH_INTERVAL_MS = 60_000;
const PUSH_TIMEOUT_MS = 8_000;

/**
 * 一行的上报体（外站 `POST /api/rooms` 的形状）。只报公开房，私密房不进任何公开列表。
 * @param {{ code: string, difficulty: string, humans: number, private?: boolean, variant?: string|null }} r
 * @param {{ serverId: string, serverName: string, url: string }} meta
 */
export function pushPayload(r, meta) {
  return {
    code: r.code,
    serverId: meta.serverId,
    serverName: meta.serverName,
    url: meta.url,
    difficulty: r.difficulty,
    note: r.variant === 'xie' ? '协同共竞' : '',
  };
}

/** 这一轮要推哪些房间：公开、未满员、未开局。 */
export function roomsToPush(payload) {
  return (payload?.rooms || []).filter((r) => r && r.private !== true && r.inMatch !== true && typeof r.code === 'string');
}

/**
 * 启动推送循环。返回 `{ stop() }`，`stop()` 幂等。
 * @param {{ lobby: { roomsPayload: () => any }, url?: string, serverId?: string, serverName?: string,
 *   publicUrl?: string, log?: any, fetch?: typeof fetch, intervalMs?: number }} opts
 */
export function startLobbyPush(opts) {
  const url = opts.url || process.env.SP_LOBBY_PUSH || LOBBY_PUSH_DEFAULT_URL;
  const off = process.env.SP_LOBBY_PUSH === 'off' || process.env.NODE_ENV === 'test' || !url || url === 'off';
  const log = opts.log || defaultLog;
  if (off) return { stop() {} };

  const meta = {
    serverId: opts.serverId || 'jingjiangze-stronghold',
    serverName: opts.serverName || '卫戍协议：盟约',
    url: opts.publicUrl || 'https://superbig.jiangjiangze.icu/',
  };
  const doFetch = opts.fetch || globalThis.fetch;
  if (typeof doFetch !== 'function' || typeof opts.lobby?.roomsPayload !== 'function') return { stop() {} };

  let timer = null;
  let stopped = false;
  let warned = false;

  const tick = async () => {
    if (stopped) return;
    let rows = [];
    try { rows = roomsToPush(opts.lobby.roomsPayload()); } catch { rows = []; }
    if (!rows.length) return;
    for (const r of rows) {
      if (stopped) return;
      try {
        const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
        const t = ctrl ? setTimeout(() => ctrl.abort(), PUSH_TIMEOUT_MS) : null;
        const res = await doFetch(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(pushPayload(r, meta)),
          ...(ctrl ? { signal: ctrl.signal } : {}),
        });
        if (t) clearTimeout(t);
        if (!res || !res.ok) throw new Error(`HTTP ${res ? res.status : 'no response'}`);
        warned = false;
      } catch (e) {
        if (!warned) { warned = true; log.warn?.(`[lobby-push] ${r.code} 上报失败（后续静默重试）：${e && e.message}`); }
      }
    }
  };

  const first = setTimeout(() => { void tick(); }, 3_000);
  timer = setInterval(() => { void tick(); }, opts.intervalMs || PUSH_INTERVAL_MS);
  if (typeof timer.unref === 'function') timer.unref();
  if (typeof first.unref === 'function') first.unref();

  return {
    stop() {
      stopped = true;
      clearTimeout(first);
      if (timer) clearInterval(timer);
      timer = null;
    },
  };
}
