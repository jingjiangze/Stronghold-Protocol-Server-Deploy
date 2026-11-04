// server/mods/index.js — the mod manager's HTTP surface: GET /mod (the page), GET /mod/status.json and the two writes
// (POST /mod/upload, POST /mod/fetch). It is a thin layer over upstream's own import path — `server/plugins/forgeImport.js`
// for a Forge pack, `server/plugins/install.js` for a plugin zip — so there is exactly one loading chain and one place
// that decides "what does this room run" (plugins[] → contentSet → cs → room.setPlugins).
//
// Who may use it: the same gate as the studio (server/studio/gate.js) — this machine or the local network, a local Host,
// and for a write the owner's key (`plugins/.studio-key`, header `X-SP-Mod`). A read needs no key. Nothing here is
// enabled by default: an import installs a plugin folder, and a room still has to switch it on.
//
// (i18n-ignore-file: the answers are bilingual by design, 中文 · English — the same rule server/http/common.js carries,
// docs/I18N.md. The page itself (page.js) is bilingual for the same reason.)
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';
import { pluginCompatibility } from '../../shared/plugins/compat.js';
import { sendError, sendJson } from '../http/common.js';
import { studioAllowed } from '../studio/gate.js';
import { loadStudioKey, sameKey } from '../studio/key.js';
import { fetchHttps, readDownloadAllow } from '../plugins/install.js';
import { importArchive } from './import.js';
import { startInbox } from './inbox.js';
import { modPage } from './page.js';
import { MOD_PAGE_SCRIPT } from './pageScript.js';

const MAX_JSON_BYTES = 64 * 1024;

/** A body as a Buffer, refusing one over `limit` before it is buffered. */
function readBody(req, limit) {
  return new Promise((resolve, reject) => {
    const len = Number(req.headers['content-length']);
    if (Number.isFinite(len) && len > limit) {
      const e = new Error(`body is larger than ${Math.round(limit / 1048576)} MB`);
      e.code = 'SIZE';
      req.resume();
      reject(e);
      return;
    }
    const chunks = [];
    let n = 0;
    req.on('data', (c) => {
      n += c.length;
      if (n > limit) {
        const e = new Error(`body is larger than ${Math.round(limit / 1048576)} MB`);
        e.code = 'SIZE';
        chunks.length = 0;
        req.resume();
        reject(e);
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** The policy file (`plugins/config.json`, server/plugins/policy.js) as an object: a missing, broken or non-object one is {}. */
function readPolicy(pluginsDir) {
  try {
    const json = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'config.json'), 'utf8'));
    return json && typeof json === 'object' && !Array.isArray(json) ? json : {};
  } catch { return {}; }
}

/**
 * The `default` list after switching one plugin on or off — the set a new room starts with (policy.js `default`, the
 * one the manager's toggle writes). On adds once; off removes; anything that is not a plugin id is kept as it was.
 * @param {unknown} current @param {string} id @param {boolean} on
 * @returns {string[]}
 */
export function nextDefault(current, id, on) {
  const list = Array.isArray(current) ? current.filter((x) => typeof x === 'string') : [];
  return on ? [...new Set([...list, id])] : list.filter((x) => x !== id);
}

/** The status rows the page lists: what is installed and whether the registry loaded it. */
function statusRows(registry, pluginsDir, inboxPath) {
  let list = [];
  try { list = registry ? registry.plugins() : []; } catch { list = []; }
  const policy = readPolicy(pluginsDir);
  const enabled = new Set(Array.isArray(policy.default) ? policy.default : []);
  const rows = list.filter((p) => p && p.id && !String(p.id).startsWith('_')).map((p) => ({
    id: p.id,
    name: (p.manifest && p.manifest.name) || p.name || p.id,
    version: (p.manifest && p.manifest.version) || p.version || '',
    class: p.class || (p.manifest && p.manifest.class) || '',
    status: p.status || '',
    // 0.3.1 的 registry `supported` 只对语言包为 true（玩法插件 false）；这里用 compat 自己判，
    // 否则管理器会把所有玩法插件标成「不支持」并禁用开关。语言包的 unknown 不算 incompatible。
    supported: (() => {
      try { return pluginCompatibility(p.manifest || {}, {}).status !== 'incompatible'; }
      catch { return p.supported !== false; }
    })(),
    enabled: enabled.has(p.id),
    ...(p.disabled ? { disabled: p.disabled } : {}),
  })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  // The count is reported as `inboxCount`: `inbox` is the handler's path, and spreading this object after it
  // used to knock the path out with a number (the caller could never learn where the drop folder is).
  // It counts the folder the manager actually watches (inboxPath), not `dirname(pluginsDir)/mod-inbox`.
  let inboxCount = null;
  try { inboxCount = fs.readdirSync(inboxPath).filter((n) => n.endsWith('.zip')).length; } catch { inboxCount = null; }
  return { plugins: rows, inboxCount, default: [...enabled] };
}

/**
 * @param {{ root: string, pluginsDir: string, dataDir: string, registry?: any, vanilla?: object|null, log?: any,
 *   inboxDir?: string, autoInbox?: boolean, fetch?: typeof fetch, platform?: { status: () => any } | null }} opts
 */
export function createMods({ root, pluginsDir, dataDir, registry = null, vanilla = null, log = console, inboxDir = null, autoInbox = true, fetch: fetchImpl = null, platform = null, lobby = null }) {
  const { key } = loadStudioKey(pluginsDir, { log });
  const inboxPath = path.resolve(inboxDir || path.join(root, 'mod-inbox'));
  const allow = readDownloadAllow(pluginsDir);

  const importFile = async (file) => importArchive(fs.readFileSync(file), { root, pluginsDir, dataDir, vanilla });
  // 投递目录（mod-inbox）：容器里根目录可能是只读的（实测创空间 /app 报 EACCES），建不出来就禁用，
  // 绝不能让一条 mkdir 失败把整个服务打挂；/mod 页面与 /mod/upload 不依赖它。
  let inbox = null;
  if (autoInbox) {
    try {
      inbox = startInbox({ dir: inboxPath, importFile, log });
    } catch (e) {
      inbox = null;
      log?.warn?.(`[mods] inbox disabled: ${e?.code || e?.message || e} (${inboxPath})`);
    }
  }

  const keyOk = (req, query) => {
    const fromHeader = req.headers['x-sp-mod'] || req.headers['x-sp-studio'];
    const fromQuery = (() => { try { return new URLSearchParams(query || '').get('key'); } catch { return null; } })();
    return sameKey(String(fromHeader || fromQuery || ''), key);
  };
  const changeAllowed = (req) => {
    const site = req.headers['sec-fetch-site'];
    if (site !== undefined && site !== 'same-origin' && site !== 'none') return false;
    const origin = req.headers.origin;
    if (origin === undefined) return true;
    try { return new URL(String(origin)).host.toLowerCase() === String(req.headers.host || '').toLowerCase(); } catch { return false; }
  };

  async function handle(req, res, rawPath, query) {
    try {
      const gate = studioAllowed(req);
      if (!gate.ok) { sendError(req, res, 404, '未找到该页面 · Not found'); return; }
      const method = req.method === 'HEAD' ? 'GET' : req.method;

      if (rawPath === '/mod' || rawPath === '/mod/') {
        if (method !== 'GET') { sendError(req, res, 405, '不支持的请求方法 · Method not allowed'); return; }
        const body = Buffer.from(modPage({ inbox: inboxPath, keyHint: path.join(pluginsDir, '.studio-key') }), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      // The page's script, served as a file: the site CSP hashes only import maps, so an inline
      // <script> on /mod is blocked and the table would stay empty. `script-src 'self'` covers this.
      if (rawPath === '/mod/page.js') {
        if (method !== 'GET') { sendError(req, res, 405, '不支持的请求方法 · Method not allowed'); return; }
        const body = Buffer.from(MOD_PAGE_SCRIPT, 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store', 'Content-Length': body.length });
        res.end(req.method === 'HEAD' ? undefined : body);
        return;
      }

      if (rawPath === '/mod/status.json') {
        if (method !== 'GET') { sendError(req, res, 405, '不支持的请求方法 · Method not allowed'); return; }
        sendJson(req, res, 200, { ok: true, inbox: inboxPath, platform: platform ? platform.status() : { enabled: false }, ...statusRows(registry, pluginsDir, inboxPath) });
        return;
      }

      if (rawPath === '/mod/upload') {
        if (method !== 'POST') { sendError(req, res, 405, '不支持的请求方法 · Method not allowed'); return; }
        if (!changeAllowed(req)) { sendError(req, res, 403, '拒绝跨站写入 · cross-site write refused'); return; }
        if (!keyOk(req, query)) { sendError(req, res, 403, '缺少或错误的 X-SP-Mod 钥匙 · missing or wrong key'); return; }
        const force = (() => { try { return new URLSearchParams(query || '').get('force') === '1'; } catch { return false; } })();
        let body;
        try { body = await readBody(req, PLUGIN_LIMITS.pluginBytes); } catch (e) {
          sendError(req, res, e.code === 'SIZE' ? 413 : 400, String(e.message || e).slice(0, 200));
          return;
        }
        const r = await importArchive(body, { root, pluginsDir, dataDir, vanilla, force });
        registry?.rescan?.();
        sendJson(req, res, r.ok ? 200 : 400, r);
        return;
      }

      if (rawPath === '/mod/fetch') {
        if (method !== 'POST') { sendError(req, res, 405, '不支持的请求方法 · Method not allowed'); return; }
        if (!changeAllowed(req)) { sendError(req, res, 403, '拒绝跨站写入 · cross-site write refused'); return; }
        if (!keyOk(req, query)) { sendError(req, res, 403, '缺少或错误的 X-SP-Mod 钥匙 · missing or wrong key'); return; }
        let body;
        try { body = await readBody(req, MAX_JSON_BYTES); } catch (e) { sendError(req, res, 413, String(e.message || e)); return; }
        let parsed;
        try { parsed = JSON.parse(body.toString('utf8') || '{}'); } catch { sendError(req, res, 400, '请求体不是 JSON · body is not JSON'); return; }
        const url = typeof parsed?.url === 'string' ? parsed.url.trim() : '';
        const sha256 = typeof parsed?.sha256 === 'string' ? parsed.sha256.trim().toLowerCase() : '';
        if (!url) { sendError(req, res, 400, '缺少 url · missing url'); return; }
        if (sha256 && !/^[0-9a-f]{64}$/.test(sha256)) { sendError(req, res, 400, 'sha256 必须是 64 位十六进制 · sha256 must be 64 lowercase hex digits'); return; }
        let buf;
        try {
          buf = await fetchHttps(url, { fetch: fetchImpl, maxBytes: PLUGIN_LIMITS.pluginBytes, timeoutMs: 60000, kind: 'zip', allowDownloadHosts: allow, pluginsDir });
        } catch (e) {
          sendJson(req, res, 400, { ok: false, error: e?.code || 'DOWNLOAD', detail: String(e?.message || e).slice(0, 300) });
          return;
        }
        if (sha256) {
          const got = createHash('sha256').update(buf).digest('hex');
          if (got !== sha256) { sendJson(req, res, 400, { ok: false, error: 'SHA256', detail: `got ${got}` }); return; }
        }
        const r = await importArchive(buf, { root, pluginsDir, dataDir, vanilla, force: parsed?.force === true });
        registry?.rescan?.();
        sendJson(req, res, r.ok ? 200 : 400, r);
        return;
      }

      if (rawPath === '/mod/enable') {
        if (method !== 'POST') { sendError(req, res, 405, '不支持的请求方法 · Method not allowed'); return; }
        if (!changeAllowed(req)) { sendError(req, res, 403, '拒绝跨站写入 · cross-site write refused'); return; }
        if (!keyOk(req, query)) { sendError(req, res, 403, '缺少或错误的 X-SP-Mod 钥匙 · missing or wrong key'); return; }
        let body;
        try { body = await readBody(req, MAX_JSON_BYTES); } catch (e) { sendError(req, res, 413, String(e.message || e)); return; }
        let parsed;
        try { parsed = JSON.parse(body.toString('utf8') || '{}'); } catch { sendError(req, res, 400, '请求体不是 JSON · body is not JSON'); return; }
        const id = typeof parsed?.id === 'string' ? parsed.id.trim() : '';
        const on = parsed?.on;
        if (!id || typeof on !== 'boolean') { sendError(req, res, 400, '需要 { id, on } · needs { id, on }'); return; }
        let known = [];
        try { known = (registry ? registry.plugins() : []).map((p) => p && p.id).filter(Boolean); } catch { known = []; }
        if (!known.includes(id)) { sendJson(req, res, 404, { ok: false, error: 'PLUGIN_UNKNOWN', detail: id }); return; }
        // The switch is the policy's own `default` (server/plugins/policy.js): the plugins a NEW room starts with. Its
        // other fields (rooms, allow, classes, limits …) are the owner's and are written back untouched.
        const file = path.join(pluginsDir, 'config.json');
        const policy = readPolicy(pluginsDir);
        const next = nextDefault(policy.default, id, on);
        const tmp = file + '.' + process.pid + '.tmp';
        try {
          fs.writeFileSync(tmp, JSON.stringify({ ...policy, default: next }, null, 2) + '\n');
          fs.renameSync(tmp, file);
        } catch (e) {
          try { fs.rmSync(tmp, { force: true }); } catch { /* nothing to remove */ }
          sendJson(req, res, 500, { ok: false, error: 'WRITE', detail: String(e?.message || e).slice(0, 300) });
          return;
        }
        sendJson(req, res, 200, { ok: true, id, on, default: next, rooms: policy.rooms || 'host' });
        // 业主 2026-10-30「通过 mod 管理器加载」：改完默认插件集后，让**在线房间**也跟上 ——
        // 纯外观房间就地重应用（refreshPlugins），含玩法插件的房间只能通知房主（换 cs 必须重载）。
        // 必须在响应之后做，且失败不能影响这次开关的结果。
        try { registry?.rescan?.(); } catch { /* 扫描失败不影响已写入的开关 */ }
        try { lobby?.pluginsReloaded?.([id]); } catch (e) { try { log.warn?.(`[mods] live rooms not notified: ${e && e.message}`); } catch { /* log must never throw */ } }
        return;
      }

      sendError(req, res, 404, '未找到该页面 · Not found');
    } catch (e) {
      log?.warn?.(`[mods] ${req.method} ${rawPath}: ${e?.message || e}`);
      try { sendError(req, res, 500, '导入失败 · import failed'); } catch { /* headers already sent */ }
    }
  }

  return {
    handles: (rawPath) => rawPath === '/mod' || rawPath === '/mod/' || rawPath.startsWith('/mod/'),
    handle,
    inbox,
    inboxDir: inboxPath,
    close() { inbox?.close(); },
  };
}
