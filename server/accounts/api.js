// server/accounts/api.js — the account HTTP surface (业主 2026-11-01)。
// (i18n-ignore-file: the answers are JSON codes and the error pages are bilingual by design, 中文 · English — docs/I18N.md)
//
// 为什么是 REST 而不是塞进 WS：账号是「进游戏之前 / 与游戏无关」的事，走 `/api/*` 才能被管理后台、脚本和
// 将来的独立前端共用；游戏实时协议 `/ws` 一个字不动。
//
// 端点：
//   POST /api/auth/register {qq,password}      建号（QQ 号即登录名）
//   POST /api/auth/login    {qq,password}      登录 → 无状态令牌
//   POST /api/auth/bind     {qq,password}      **游客绑定**：Authorization: Bearer <现在的 WS 令牌>
//   GET  /api/account/me                       当前账号（头像 URL 由 QQ 头像 API 现拼，不存图）
//   POST /api/account/profile {name,nameStyle,card}  名片 / 昵称样式
//   GET  /api/announcements                    公告（管理后台写、玩家读）
//   /api/admin/*                               X-Admin-Key 口令；没配钥匙时整段回 404（不暴露存在）
//
// 存储上限：请求体 8 KiB；公告 64 KiB；名片 1 KiB（store.js 里再卡）。失败一律 JSON，不抛。

import fs from 'node:fs';
import path from 'node:path';
import { sendError, sendJson } from '../http/common.js';
import { ADMIN_HTML } from './adminPage.js';

const BODY_MAX = 8 * 1024;
const ANNOUNCE_MAX = 64 * 1024;

/** Read a JSON body with a hard cap (the route only accepts POST). */
function readJson(req) {
  return new Promise((resolve) => {
    let size = 0, dead = false;
    const chunks = [];
    req.on('data', (c) => {
      if (dead) return;
      size += c.length;
      if (size > BODY_MAX) { dead = true; resolve(null); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (dead) return;
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { resolve(null); }
    });
    req.on('error', () => resolve(null));
  });
}

/**
 * 全服布阵库的真实占用。口径与 `plugins/mota/server/lineupLibrary.js` 的 `globalLibraryBytes()` 一致：
 * `SP_LINEUP_LIBRARY` 是目录 ⇒ 目录下所有 `*.jsonl`（排除 `outbox*`）之和；是单文件 ⇒ 该文件大小；
 * 未配置 / 读不到 ⇒ 0。
 *
 * 为什么不直接 import 插件模块：`test/package.test.js` 的打包门禁不允许 `server/**` 依赖 `plugins/**`
 * （插件不进 npm 包）。远端库（remote spec）不在这里统计，显示 0。
 */
function libraryUsage() {
  const quota = Number(process.env.SP_LINEUP_QUOTA_BYTES) || Number(process.env.SP_ACCOUNT_LINEUP_QUOTA_BYTES) || 20 * 1024 ** 3;
  const raw = String(process.env.SP_LINEUP_LIBRARY || '').trim();
  if (!raw) return { libraryBytes: 0, libraryQuotaBytes: quota };
  let total = 0;
  try {
    const st = fs.statSync(raw);
    if (st.isDirectory()) {
      for (const name of fs.readdirSync(raw)) {
        if (!name.endsWith('.jsonl') || name.startsWith('outbox')) continue;
        try { total += fs.statSync(path.join(raw, name)).size; } catch { /* a file may vanish mid-scan */ }
      }
    } else total = st.size;
  } catch { total = 0; }
  return { libraryBytes: total, libraryQuotaBytes: quota };
}

const bearer = (req) => {
  const h = String(req.headers?.authorization || '');
  return h.toLowerCase().startsWith('bearer ') ? h.slice(7).trim() : '';
};

/**
 * @param {{ store: ReturnType<typeof import('./store.js').openAccounts>, dataDir: string,
 *   registry?: { byToken: (t: string) => any }, log?: object, adminKey?: string | null }} o
 *   registry: the WebSocket session registry — 游客绑定用它把「现在的 WS 令牌」换成 playerId。
 *   adminKey: SP_ADMIN_KEY；null/空 ⇒ 管理端点整段 404。
 */
export function createAccountsApi({ store, dataDir, registry = null, log = console, adminKey = process.env.SP_ADMIN_KEY || null }) {
  const annFile = path.join(dataDir, 'announcements.json');

  const readAnnouncements = () => {
    try {
      const raw = fs.readFileSync(annFile, 'utf8');
      const body = JSON.parse(raw);
      return Array.isArray(body?.items) ? { items: body.items } : { items: [] };
    } catch { return { items: [] }; }
  };

  const sameKey = (given) => {
    const a = Buffer.from(String(given || ''));
    const b = Buffer.from(String(adminKey || ''));
    return a.length === b.length && a.length > 0 && a.length === b.length && a.equals(b);
  };

  function accountFor(req, res) {
    const qq = store.verifyToken(bearer(req));
    if (!qq) { sendJson(req, res, 401, { ok: false, error: 'UNAUTHORIZED' }); return null; }
    return qq;
  }

  return {
    handles: (rawPath) => rawPath === '/api' || rawPath.startsWith('/api/') || rawPath === '/admin' || rawPath === '/admin/',

    async handle(req, res, rawPath, query = '') {
      const post = req.method === 'POST';
      const isAdmin = rawPath.startsWith('/api/admin/');

      // 管理后台页面（P3）：没配钥匙时与 /api/admin/* 一样当作不存在
      if (rawPath === '/admin' || rawPath === '/admin/') {
        if (!adminKey) { sendError(req, res, 404, '未找到 · Not found'); return; }
        res.statusCode = 200;
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('cache-control', 'no-store');
        res.end(ADMIN_HTML);
        return;
      }

      // 管理端点：没配钥匙就当作不存在（不告诉扫描者「这里有个后台」）
      if (isAdmin) {
        if (!adminKey) { sendError(req, res, 404, '未找到 · Not found'); return; }
        if (!sameKey(req.headers['x-admin-key'])) { sendJson(req, res, 403, { ok: false, error: 'FORBIDDEN' }); return; }
      }

      if (rawPath === '/api/announcements' && (req.method === 'GET' || req.method === 'HEAD')) {
        sendJson(req, res, 200, { ok: true, ...readAnnouncements() });
        return;
      }

      if (rawPath === '/api/auth/register' && post) {
        const body = await readJson(req);
        if (!body) { sendJson(req, res, 400, { ok: false, error: 'BAD_BODY' }); return; }
        const r = store.register(body.qq, body.password);
        sendJson(req, res, r.ok ? 200 : r.error === 'EXISTS' ? 409 : 400, r.ok ? { ok: true, token: r.token, account: r.account } : { ok: false, error: r.error });
        return;
      }

      if (rawPath === '/api/auth/login' && post) {
        const body = await readJson(req);
        if (!body) { sendJson(req, res, 400, { ok: false, error: 'BAD_BODY' }); return; }
        const r = store.login(body.qq, body.password);
        sendJson(req, res, r.ok ? 200 : 401, r.ok ? { ok: true, token: r.token, account: r.account } : { ok: false, error: r.error });
        return;
      }

      // 游客绑定：Bearer = 浏览器当前的 WS 令牌（sp.token），用 registry 换成 playerId 后挂到 QQ 账号上。
      if (rawPath === '/api/auth/bind' && post) {
        const body = await readJson(req);
        if (!body) { sendJson(req, res, 400, { ok: false, error: 'BAD_BODY' }); return; }
        const wsToken = bearer(req);
        // 游客绑定只是「有 WS 会话就顺手记一次 playerId」：刚打开页面/没进房间时没有会话，
        // 不该因此挡住建号与登录（线上实测过：标题页直接绑定会 401 NO_GUEST_SESSION）。
        const session = wsToken && registry ? registry.byToken(wsToken) : null;
        const r = store.bind(body.qq, body.password, session ? session.playerId : '');
        sendJson(req, res, r.ok ? 200 : r.error === 'BAD_CREDENTIALS' ? 401 : 400, r.ok ? { ok: true, token: r.token, account: r.account } : { ok: false, error: r.error });
        return;
      }

      if (rawPath === '/api/account/me' && (req.method === 'GET' || req.method === 'HEAD')) {
        const qq = accountFor(req, res);
        if (!qq) return;
        sendJson(req, res, 200, { ok: true, account: store.view(qq) });
        return;
      }

      if (rawPath === '/api/account/profile' && post) {
        const qq = accountFor(req, res);
        if (!qq) return;
        const body = await readJson(req);
        if (!body) { sendJson(req, res, 400, { ok: false, error: 'BAD_BODY' }); return; }
        const r = store.setProfile(qq, body);
        sendJson(req, res, r.ok ? 200 : r.error === 'NOT_FOUND' ? 404 : 400, r.ok ? { ok: true, account: r.account } : { ok: false, error: r.error });
        return;
      }

      if (rawPath === '/api/admin/accounts' && (req.method === 'GET' || req.method === 'HEAD')) {
        // 布阵占用的真源是布阵库（全服一份），不在账号表里；这里按需现读，读不到就是 0。
        const usage = libraryUsage();
        sendJson(req, res, 200, { ok: true, accounts: store.list(), quotaBytes: store.quotaBytes, ...usage });
        return;
      }

      if (rawPath === '/api/admin/account' && post) {
        const body = await readJson(req);
        if (!body) { sendJson(req, res, 400, { ok: false, error: 'BAD_BODY' }); return; }
        const r = store.adminPatch(body.qq, body);
        sendJson(req, res, r.ok ? 200 : r.error === 'NOT_FOUND' ? 404 : 400, r.ok ? { ok: true, account: r.account } : { ok: false, error: r.error });
        return;
      }

      if (rawPath === '/api/admin/announcements') {
        if (req.method === 'GET' || req.method === 'HEAD') { sendJson(req, res, 200, { ok: true, ...readAnnouncements() }); return; }
        if (post) {
          const body = await readJson(req);
          const items = Array.isArray(body?.items) ? body.items.slice(0, 50) : null;
          if (!items) { sendJson(req, res, 400, { ok: false, error: 'BAD_BODY' }); return; }
          const text = JSON.stringify({ items }, null, 2);
          if (Buffer.byteLength(text) > ANNOUNCE_MAX) { sendJson(req, res, 413, { ok: false, error: 'TOO_LARGE' }); return; }
          try {
            fs.mkdirSync(dataDir, { recursive: true });
            const tmp = `${annFile}.tmp`;
            fs.writeFileSync(tmp, `${text}\n`, 'utf8');
            fs.renameSync(tmp, annFile);
            log.info?.(`[accounts] announcements written (${items.length})`);
          } catch (e) { log.error?.('[accounts] cannot write announcements', e); sendJson(req, res, 500, { ok: false, error: 'WRITE_FAILED' }); return; }
          sendJson(req, res, 200, { ok: true, items });
          return;
        }
      }

      sendJson(req, res, 404, { ok: false, error: 'NOT_FOUND' });
    },
  };
}
