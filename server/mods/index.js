// server/mods/index.js — the mod manager's HTTP surface: GET /mod (the page), GET /mod/status.json and the two writes
// (POST /mod/upload, POST /mod/fetch). It is a thin layer over upstream's own import path — `server/plugins/forgeImport.js`
// for a Forge pack, `server/plugins/install.js` for a plugin zip — so there is exactly one loading chain and one place
// that decides "what does this room run" (plugins[] → contentSet → cs → room.setPlugins).
//
// Who may use it: the same gate as the studio (server/studio/gate.js) — this machine or the local network, a local Host,
// and for a write the owner's key (`plugins/.studio-key`, header `X-SP-Mod`). A read needs no key. Nothing here is
// enabled by default: an import installs a plugin folder, and a room still has to switch it on.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { PLUGIN_LIMITS } from '../../shared/plugins/manifest.js';
import { sendError, sendJson } from '../http/common.js';
import { studioAllowed } from '../studio/gate.js';
import { loadStudioKey, sameKey } from '../studio/key.js';
import { fetchHttps, readDownloadAllow } from '../plugins/install.js';
import { importArchive } from './import.js';
import { startInbox } from './inbox.js';
import { modPage } from './page.js';

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

/** The status rows the page lists: what is installed and whether the registry loaded it. */
function statusRows(registry, pluginsDir) {
  let list = [];
  try { list = registry ? registry.plugins() : []; } catch { list = []; }
  // plugins/config.json 的 default / required：房间开局的插件集合，以及关不掉的那几个。
  let policy = {};
  try { policy = JSON.parse(fs.readFileSync(path.join(pluginsDir, 'config.json'), 'utf8')) || {}; } catch { policy = {}; }
  const enabled = new Set(Array.isArray(policy.default) ? policy.default : []);
  const required = new Set(Array.isArray(policy.required) ? policy.required : []);
  const rows = list.filter((p) => p && p.id && !String(p.id).startsWith('_')).map((p) => ({
    id: p.id,
    name: (p.manifest && p.manifest.name) || p.name || p.id,
    version: (p.manifest && p.manifest.version) || p.version || '',
    class: p.class || (p.manifest && p.manifest.class) || '',
    status: p.status || '',
    supported: p.supported !== false,
    enabled: enabled.has(p.id),
    required: required.has(p.id),
    ...(p.disabled ? { disabled: p.disabled } : {}),
  })).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  let inbox = null;
  try { inbox = fs.readdirSync(path.join(path.dirname(pluginsDir), 'mod-inbox')).filter((n) => n.endsWith('.zip')).length; } catch { inbox = null; }
  return { plugins: rows, inbox, default: [...enabled], required: [...required] };
}

/**
 * @param {{ root: string, pluginsDir: string, dataDir: string, registry?: any, vanilla?: object|null, log?: any,
 *   inboxDir?: string, autoInbox?: boolean, fetch?: typeof fetch, platform?: { status: () => any } | null }} opts
 */
export function createMods({ root, pluginsDir, dataDir, registry = null, vanilla = null, log = console, inboxDir = null, autoInbox = true, fetch: fetchImpl = null, platform = null }) {
  const { key } = loadStudioKey(pluginsDir, { log });
  let inboxPath = path.resolve(inboxDir || process.env.SP_MOD_INBOX || path.join(root, 'mod-inbox'));
  const allow = readDownloadAllow(pluginsDir);

  const importFile = async (file) => importArchive(fs.readFileSync(file), { root, pluginsDir, dataDir, vanilla });
  // 容器的 /app 可能是只读的（ModelScope 创空间就是这样）：拖目录即装的 watcher 建不出目录时
  // **不能让整个服务器起不来**——退回一个可写的临时目录，再失败就干脆不装 watcher。
  const openInbox = () => {
    if (!autoInbox) return null;
    const fallback = path.join(process.env.TMPDIR || process.env.TEMP || '/tmp', 'sp-mod-inbox');
    for (const dir of [...new Set([inboxPath, fallback])]) {
      try { const w = startInbox({ dir, importFile, log }); inboxPath = dir; return w; } catch (e) {
        log?.warn?.(`[mods] inbox unavailable at ${dir} (${e?.code || e?.message || e}) — trying the next writable location`);
      }
    }
    log?.warn?.('[mods] inbox disabled: no writable directory (drop-in installs need a writable dir; /mod upload still works)');
    return null;
  };
  const inbox = openInbox();

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

      if (rawPath === '/mod/status.json') {
        if (method !== 'GET') { sendError(req, res, 405, '不支持的请求方法 · Method not allowed'); return; }
        sendJson(req, res, 200, { ok: true, inbox: inboxPath, platform: platform ? platform.status() : { enabled: false }, ...statusRows(registry, pluginsDir) });
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

      // 启用 / 停用（房间开局集合 = plugins/config.json 的 default）。required 的插件关不掉。
      // 策略文件按 mtime 自动重读（server/plugins/policy.js），所以新房间立刻生效，已开的房间保持原集合。
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
        if (!id || typeof on !== 'boolean') { sendError(req, res, 400, '需要 { id, on } · id and on are required'); return; }
        let known = [];
        try { known = (registry ? registry.plugins() : []).map((p) => p && p.id).filter(Boolean); } catch { known = []; }
        if (!known.includes(id)) { sendJson(req, res, 404, { ok: false, error: 'PLUGIN_UNKNOWN', detail: id }); return; }
        const file = path.join(pluginsDir, 'config.json');
        let cfg = {};
        try { cfg = JSON.parse(fs.readFileSync(file, 'utf8')) || {}; } catch { cfg = {}; }
        const required = new Set(Array.isArray(cfg.required) ? cfg.required : []);
        if (!on && required.has(id)) { sendJson(req, res, 400, { ok: false, error: 'PLUGIN_BLOCKED', detail: `this server requires: ${id}` }); return; }
        const current = Array.isArray(cfg.default) ? cfg.default : [];
        const next = on ? [...new Set([...current, id])] : current.filter((x) => x !== id);
        const saved = { ...cfg, default: next };
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, `${JSON.stringify(saved, null, 2)}\n`);
        fs.renameSync(tmp, file);
        sendJson(req, res, 200, { ok: true, default: next, required: [...required] });
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
