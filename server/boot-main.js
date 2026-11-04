// server/index.js — process entry & boot (DESIGN §1, §2). Plain node:http + ws, no framework: startServer() below
// wires the modules under server/http/, in this order —
//
//   http/config.js     ROOT, the served directories, the environment (PORT 3000, HOST '::' dual-stack, TRUST_PROXY auto, DEBUG),
//                      which startServer() options go to net.js / lobby.js, the console logger, the official versions
//                      this server offers (SP_VERSIONS / SP_VERSION_DEFAULT / SP_MAX_VERSION_HOSTS — versions.js below)
//   versions.js        the official versions (DESIGN §35.23, M1): each enabled one's cs, data, manifest
//                      (/cs/<cs16>/index.json) and data directory (/data/versions/<slug>/); their matches run in match
//                      hosts of their own (match/host/, kind 'version') — the pool exists when another version is
//                      enabled (the default: all four) and forks a process on the first match of one, never at boot;
//                      none when only 第二期下半 is enabled
//   http/websocket.js  session wiring (SessionRegistry → Lobby → Network) and the WebSocket at /ws (maxPayload 64 KB,
//                      permessage-deflate from 1 KB; refused at upgrade with 404 / 429 per network / 503)
//   http/static.js     the static mounts (/ → public/, /data/, /shared/, /sim/ `.js` only), the /data.js browser stand-in,
//                      the language packs (/packs/index.json, /packs/<id>/<file>), the plugin catalogue
//                      (/plugins/index.json — the registry is plugins/registry.js), the vanilla content set's manifest
//                      (/cs/<cs16>/index.json — plugins/identity.js: the content hash `cs`, DESIGN §32), the visual sets
//                      of cosmetic plugins (/vs/<vs16>/…, plugins/visualSet.js) and their files (/p/<id>/<hash8>/…),
//                      the content sets of gameplay plugins (/cs/<cs16>/…, plugins/contentSets.js — DESIGN §32.6; the
//                      server owner's plugins/config.json: plugins/policy.js; a room's plugins: plugins/roomSets.js; its
//                      match then runs in that set's worker: match/host/)
//   http/media.js      /media/bgm/act1 → public/assets/audio/bgm/act1.mp3 (audio addressed without its extension)
//   http/files.js      one file → response: MIME, brotli / gzip + memory cache, ETag / Last-Modified / 304, Cache-Control, ranges
//   http/assetIndex.js the content hashes of public/assets and public/fonts (built in the background, cached in
//                      .cache/asset-hashes.json by path + size + mtime; Spine models share one hash)
//   http/assetViews.js the served /data/assets.json, /data/local-assets.json and /data/local-fx.json: every art URL with
//                      its hash segment (/assets/~<hash>/…, immutable when the hash matches); the files stay unchanged
//   http/buildTag.js   the build tag of the served browser runtime (/healthz `build`, public/js/ui/buildGuard.js)
//   http/routes.js     the request listener: security headers, 414 / 400, the plugin studio (/studio/, studio/index.js —
//                      this machine and the local network only), 405, GET /healthz → JSON status, else static
//   http/traffic.js    the traffic counters: bytes sent per category (assets / audio / code / data) and on the
//                      WebSocket, since the start (GET /healthz?traffic=1)
//   http/common.js     what every answer shares: security headers, URL split, error page, JSON replies, bare 400
//   http/boot.js       a pending update package first (update.js: old files deleted, the install verified against
//                      MANIFEST.json), banner (Local / LAN / tunnel URLs), port-in-use hint, graceful shutdown on SIGINT /
//                      SIGTERM
//
// Per-network limits for internet clients (see net.js clientAddress; local/LAN peers are exempt): open sockets
// (maxConnectionsPerAddr, refused at upgrade with 429), rooms and running matches (lobby.js).
//
// Programmatic use (tests): `const srv = await startServer({ port: 0, quiet: true }); … await srv.close();`
// The server only auto-listens when this file is the process entry point.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { getData, loadData } from './data.js';
import { getBotStrategy } from './match/botStrategies.js';
import { noteLlmIgnored, releaseIgnoresExternalAi, validateExternalConfig } from './match/llmGate.js';
import { ROOT, listenAddress, bindCandidates, serveDirs, makeLogger, parseTrustProxy, assetIndexOptionsFrom, versionsFrom, parseRoomCode } from './http/config.js';
import { WS_MAX_PAYLOAD, createSessionStack, attachWebSocket } from './http/websocket.js';
import { siteCsp } from './http/csp.js';
import { DATA_SHIM_JS, createStaticHandler } from './http/static.js';
import { createPluginRegistry } from './plugins/registry.js';
import { computeVanillaContent } from './plugins/identity.js';
import { createVisualSets } from './plugins/visualSet.js';
import { createContentSets } from './plugins/contentSets.js';
import { createPluginPolicy } from './plugins/policy.js';
import { createRoomSets } from './plugins/roomSets.js';
import { mountLobbyPlugins } from './plugins/lobbyModules.js';
import { createStaticModules } from './plugins/staticModules.js';
import { createMatchHosts } from './match/host/index.js';
import { createVersionSets } from './versions.js';
import { versionById } from '../shared/versions.js';
import { t } from '../shared/i18n.js';
import { createTrustedRuntime } from './plugins/trustedRuntime.js';
import { trustedHostAllowed } from './plugins/trusted.js';
import { createStudio } from './studio/index.js';
import { MIME, COMPRESSIBLE, acceptsGzip, pickEncoding, parseRange } from './http/files.js';
import { BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag } from './http/buildTag.js';
import { createRequestHandler } from './http/routes.js';
import { createMods } from './mods/index.js';
import { openAccounts } from './accounts/store.js';
import { createAccountsApi } from './accounts/api.js';
import { createTrafficCounter } from './http/traffic.js';
import { createAssetIndex } from './http/assetIndex.js';
import { createManifestViews } from './http/assetViews.js';
import { answerClientError } from './http/common.js';
import { createEventLoopMonitor } from './health/eventLoop.js';
import { createRoomWorkerPool } from './workers/roomPool.js';
import { lanUrls, displayHost, isProcessEntry, runMain } from './http/boot.js';

// The public API of this module (tests and tools import it from here); the code lives in ./http/.
export {
  ROOT, WS_MAX_PAYLOAD, DATA_SHIM_JS, MIME, COMPRESSIBLE, BUILD_INPUTS, computeBuildTag, buildTag, resetBuildTag,
  acceptsGzip, pickEncoding, parseRange, createStaticHandler, lanUrls, parseTrustProxy,
};

/**
 * Build and start the HTTP + WebSocket server.
 * @param {{
 *   port?: number, host?: string, quiet?: boolean, log?: object,
 *   publicDir?: string, dataDir?: string, sharedDir?: string, packsDir?: string, pluginsDir?: string,
 *   MatchClass?: Function, seedFn?: () => number,
 *   lobbyGraceMs?: number, reconnectWindowMs?: number, heartbeatMs?: number, helloTimeoutMs?: number,
 *   ratePerSec?: number, rateBurst?: number, maxConnections?: number, maxRooms?: number,
 *   maxConnectionsPerAddr?: number, maxRoomsPerAddr?: number, maxMatchesPerAddr?: number, resyncMinGapMs?: number,
 *   heavyPerSec?: number, heavyBurst?: number, trustProxy?: 'auto' | boolean, soloReconnectWindowMs?: number,
 *   versionVoteMs?: number, versionRetryMs?: number,
 *   roomCode?: string | null,
 *   assetIndex?: boolean | { cacheFile?: string | null, delayMs?: number }, studio?: boolean,
 *   matchHost?: object, versions?: { enabled?: 'all' | string[], default?: string, maxHosts?: number },
 * }} [opts]
 *   assetIndex: the content-hash index (default on; false or SP_ASSET_INDEX=0: off — config.js assetIndexOptionsFrom);
 *   studio: the plugin studio at /studio/ (default on for this machine and the local network — SP_STUDIO=local|off;
 *   false: none);
 *   matchHost: options of the match hosts (server/match/host/index.js — watchdogMs, matchOptions …; tests) — the
 *   version hosts' too; versions: the official versions this server offers (http/config.js versionsFrom; DESIGN §35.23);
 *   versionVoteMs / versionRetryMs: the version vote's answer window and the guard after a declined or expired vote (tests;
 *   server/lobby.js header "Official versions")
 *   roomCode: a fixed alliance key for every new room (--room-code; four letters or digits — config.js parseRoomCode);
 * @returns {Promise<{ port: number, host: string, url: string, server: http.Server, wss: import('ws').WebSocketServer,
 *                     lobby: import('./lobby.js').Lobby, network: import('./net.js').Network,
 *                     registry: import('./net.js').SessionRegistry, packs: ReturnType<typeof createPluginRegistry>,
 *                     content: import('./plugins/identity.js').VanillaContent, visual: ReturnType<typeof createVisualSets>,
 *                     contents: ReturnType<typeof createContentSets>, hosts: ReturnType<typeof createMatchHosts>,
 *                     versions: ReturnType<typeof createVersionSets>, versionHosts: ReturnType<typeof createMatchHosts> | null,
 *                     traffic: ReturnType<typeof createTrafficCounter>, assetIndex: ReturnType<typeof createAssetIndex> | null,
 *                     views: ReturnType<typeof createManifestViews> | null, studio: ReturnType<typeof createStudio> | null,
 *                     close: () => Promise<void> }>}
 */
export async function startServer(opts = {}) {
  // A release ignores external-AI settings (one log line) and keeps the built-in bot (§35.66).
  // An unknown strategy id still fails here, before data is loaded or the port is opened.
  const log = opts.log || makeLogger(!!opts.quiet);
  if (releaseIgnoresExternalAi()) noteLlmIgnored(log);
  try {
    const strategy = getBotStrategy(process.env.SP_BOT_STRATEGY);
    if (strategy.id === 'external') validateExternalConfig();
  } catch (cause) {
    throw new Error(`Invalid SP_BOT_STRATEGY: ${cause.message}. Unset SP_BOT_STRATEGY to use the original bot (legacy).`, { cause });
  }
  const { port, host } = listenAddress(opts);
  const { publicDir, dataDir, sharedDir, packsDir, pluginsDir } = serveDirs(opts);
  const simDir = path.join(ROOT, 'server', 'sim');

  // The process-wide singleton serves the default data dir; a custom dir (tests) gets its own copy.
  const data = opts.dataDir ? loadData(dataDir, { log }) : getData({ dir: dataDir, log });
  // the vanilla content hash `cs` (DESIGN §32): the bytes of the served sim, shared code and game data, read once now —
  // like the data the matches use and the build tag below
  const content = computeVanillaContent({ simDir, sharedDir, dataDir, shim: DATA_SHIM_JS, log });
  log.info(`[content] vanilla ${content.cs.slice(0, 16)} (${Object.keys(content.simFiles).length} code files, ${Object.keys(content.data).length} data files)`);
  // language packs and plugins (docs/PACKS.md, docs/PLUGINS.md): scanned now — the start log names them — and again
  // whenever their folders change
  const scriptMode = process.env.SP_PLUGIN_SCRIPTS;
  const packs = createPluginRegistry({ publicDir, dataDir, packsDir, pluginsDir }, { log, scriptHost:host, scriptMode });
  packs.refresh(true);
  // the content hashes of the art (built in the background once listening) and the manifests served with them
  const indexOptions = assetIndexOptionsFrom(opts, publicDir);
  const assetIndex = indexOptions ? createAssetIndex({ publicDir, log, ...indexOptions }) : null;
  const views = createManifestViews({ dataDir, index: assetIndex, log });
  // the visual sets of the cosmetic plugins (DESIGN §32 P1a): what a room's host switches on, served at /vs/ and /p/
  const visual = createVisualSets({ registry: packs, log });
  // the server owner's policy (plugins/config.json), the content sets of the gameplay plugins (served at /cs/<cs16>/…),
  // what a room's plugins make of both, and the match hosts a room with gameplay plugins plays in (DESIGN §32.6)
  const policy = createPluginPolicy({ pluginsDir, log });
  const contents = createContentSets({ registry: packs, vanillaData: data, log, maxSets: () => policy.get().maxSets });
  const roomSets = createRoomSets({ registry: packs, visual, contents, policy });
  // a child process per content set; SP_MATCH_HOST=worker asks for a worker thread instead (match/host/index.js header:
  // an out-of-memory abort in a worker thread ends the whole server)
  const transport = String(process.env.SP_MATCH_HOST || '').trim().toLowerCase() === 'worker' ? 'worker' : 'process';
  const hosts = createMatchHosts({ contents, log, options: { transport, maxWorkers: Math.max(1, policy.get().maxSets), ...(opts.matchHost || {}) } });
  // the official versions (DESIGN §35.23, M1): which ones (the option, else SP_VERSIONS …), their content, and — only
  // when one beyond 第二期下半 is enabled — the match hosts their rooms play in (counted apart from the plugin hosts)
  const versionCfg = versionsFrom(opts, log);
  const versions = createVersionSets({ enabled: versionCfg.enabled, defaultId: versionCfg.default, dataDir, vanilla: content, defaultData: data, log });
  // (the test options of matchHost apply to both pools, but never the version pool's kind or its own SP_MAX_VERSION_HOSTS)
  const versionHosts = versions.nonDefault.length
    ? createMatchHosts({ contents: versions, log, options: { transport, ...(opts.matchHost || {}), kind: 'version', maxWorkers: Math.max(1, versionCfg.maxHosts) } })
    : null;
  log.info(`[versions] enabled: ${versions.ids.map((id) => `${id} (${t(/** @type {any} */ (versionById(id)).label)}${id === versions.defaultId ? ', default' : ''})`).join(', ')}`);
  const simPool = createRoomWorkerPool({ data });
  const { registry, lobby, network } = createSessionStack(opts, { data, log, content, plugins: roomSets, hosts, versions, versionHosts, simPool });


  // Main-thread event-loop delay sampling (server/health/eventLoop.js): opt-in with SP_LOOP_SAMPLE=1, no worker pool involved, and a
  // LOCAL log line per window (`[loop] p50=… p95=… p99=… max=… cpu=… mem=… rooms=… humans=… phase=…`) — deliberately not
  // part of /healthz. This is what tells an operator whether a stall is the rehearsal / battle slice or something else.
  const eventLoop = createEventLoopMonitor({
    log,
    windowMs: opts.loopSample?.windowMs,
    counts: () => {
      const s = lobby.stats();
      const phases = new Set();
      let rehearsals = 0;
      for (const room of lobby.rooms.values()) {
        if (room.match?.phase) phases.add(room.match.phase);
        rehearsals += room.match?._rehearsalTasks?.size || 0;
      }
      return { rooms: s.rooms, matches: s.matches, humans: s.humans, spectators: s.spectators,
        phase: [...phases].sort().join('+') || 'idle', rehearsals };
    },
  });
  // 大厅级插件面（插件的 code.lobby）：自定义 C2S、room.state 字段、房间生命周期。只有 loaded 的 trusted 插件能挂。
  const disposeLobbyPlugins = await mountLobbyPlugins(lobby, packs, { log });
  // 素材 302 门牌：本机没有的 /assets /fonts /media 转给 CDN（部署形态需要；本机有素材时不会走到）。
  const { assetJump, csp: cspExtra } = await createStaticModules(packs, { log });

  // manifest 2 的 csp 字段：插件声明式放行素材/样式源（`csp: { img: [...], media: [...], connect: [...] }`）。
  // 只接受 https 源与 localhost http，和 siteCsp 的口径一致；重复项自动去重。
  try {
    const addTo = (bucket, list) => { for (const o of list || []) if (typeof o === 'string' && /^https:\/\/(\*\.)?[a-z0-9.-]+$/i.test(o) && !bucket.includes(o)) bucket.push(o); };
    for (const p of (typeof packs.plugins === 'function' ? packs.plugins() : [])) {
      if (!p || p.status !== 'loaded') continue;
      const c = p.manifest && p.manifest.csp;
      if (!c || typeof c !== 'object') continue;
      const dirs = c.directives && typeof c.directives === 'object' ? c.directives : c;
      for (const k of ['img', 'media', 'connect', 'style', 'font']) addTo(cspExtra[k] || (cspExtra[k] = []), dirs[k]);
    }
  } catch (e) { log.warn?.('[csp] plugin directives failed', e); }
  // 插件客户端 overlay：只允许 **loaded** 的插件按同路径顶替页面资源（被 owner gate 拒掉的插件不得改页面）。
  const clientOverlay = new Map();
  try {
    const loadedPlugins = new Set((typeof packs.plugins === 'function' ? packs.plugins() : [])
      .filter((p) => p && p.status === 'loaded')
      .map((p) => p.id));
    const order = [];
    for (const id of (fs.existsSync(pluginsDir) ? fs.readdirSync(pluginsDir) : [])) {
      if (!loadedPlugins.has(id)) continue;
      const man = path.join(pluginsDir, id, 'plugin.json');
      if (!fs.existsSync(man)) continue;
      let m; try { m = JSON.parse(fs.readFileSync(man, 'utf8')); } catch { continue; }
      if (m && m.code) order.push({ id, m });
    }
    order.sort((x, y) => (Number(x.m.loadOrder) || 0) - (Number(y.m.loadOrder) || 0) || x.id.localeCompare(y.id));
    for (const { id, m } of order) {
      const c = m.code;
      if (!c || !Array.isArray(c.client)) continue;
      for (const rel of c.client) {
        const abs = path.join(pluginsDir, id, 'client', ...rel.split('/'));
        if (!fs.existsSync(abs)) continue;
        clientOverlay.set(rel, { body: fs.readFileSync(abs), type: MIME[path.extname(rel)] || 'application/octet-stream' });
      }
      // 插件自带的 shared/**（引擎插件独有的 shared 模块）也按同路径顶替。
      const sharedDirP = path.join(pluginsDir, id, 'shared');
      if (fs.existsSync(sharedDirP)) {
        const walkShared = (d, rel) => {
          for (const e of fs.readdirSync(d, { withFileTypes: true })) {
            const child = rel ? rel + '/' + e.name : e.name;
            if (e.isDirectory()) walkShared(path.join(d, e.name), child);
            else clientOverlay.set('shared/' + child, { body: fs.readFileSync(path.join(d, e.name)), type: MIME[path.extname(child)] || 'application/octet-stream' });
          }
        };
        walkShared(sharedDirP, '');
      }
    }
  } catch (e) { log.warn?.(`[plugins] client overlay: ${e.message}`); }
  if (clientOverlay.size) log.info?.(`[plugins] client overlay: ${clientOverlay.size} files`);
  const serveStatic = createStaticHandler({ publicDir, dataDir, sharedDir, simDir, packsDir, pluginsDir, packs, content, log, assetIndex, views, visual, contents, versions, assetJump, clientOverlay });
  // the plugin studio (DESIGN §32.9): its page and API for this machine and the local network; it watches plugins/ only
  // once it is used (hot reload), and rooms whose host is the author or alone follow a plugin's changes by themselves
  const studio = opts.studio === false ? null : createStudio({ publicDir, pluginsDir, dataDir, registry: packs, lobby, sessions: registry, log, fetch: opts.fetch });
  // 模组管理器（server/mods/）：/mod 页面与投递目录。导入走插件系统自己的 forgeImport / installPluginBytes ——
  // 只有一条装载链，没有第二条。opts.mods === false 或 SP_MODS=off 关闭。
  const mods = opts.mods === false || String(process.env.SP_MODS || '').toLowerCase() === 'off' ? null : createMods({
    // lobby：/mod 开关后让在线房间也跟上（server/lobby.js 的 pluginsReloaded）
    root: ROOT, pluginsDir, dataDir, registry: packs, log, fetch: opts.fetch, lobby,
    vanilla: (() => { try { return packs.vanillaAssets?.() || null; } catch { return null; } })(),
  });
  const trustedRuntime = await createTrustedRuntime({registry:packs,log});
  lobby.trustedRuntime = trustedRuntime;
  // 账号 / 公告 / 管理后台（server/accounts/，业主 2026-11-01）：QQ 号当账号、头像走 QQ 头像 API、只存名片与
  // 布阵数据用量。opts.accounts === false 或 SP_ACCOUNTS=off 关闭；公告走 /api/announcements（管理后台写文件）。
  const accounts = opts.accounts === false || String(process.env.SP_ACCOUNTS || '').toLowerCase() === 'off' ? null : createAccountsApi({
    store: openAccounts({ dataDir, log }), dataDir, registry, log,
  });
  const startedAt = Date.now();
  // The tag is per process (see buildTag): read the browser runtime once, here, not on every /healthz.
  resetBuildTag();
  buildTag(ROOT, { servedVersionDirs: versions.servedDirs() });

  const traffic = createTrafficCounter();
  const server = http.createServer(createRequestHandler({ serveStatic, csp: process.env.SP_CSP === 'off' ? null : siteCsp(publicDir, cspExtra), health: { startedAt, network, registry, lobby, content, traffic, assetIndex, views, trusted:trustedRuntime?.health, versions, versionHosts }, log, trustProxy: network.opts.trustProxy, studio, mods, accounts, trustedRuntime }));
  server.on('clientError', answerClientError);
  const wss = attachWebSocket(server, { network, log, traffic });

  // The address actually bound. The default may fall back to IPv4; the returned host and url follow that.
  let boundHost;
  try {
    // A host with IPv6 switched off refuses '::'. Fall back to IPv4 rather than not booting. Only the default is
    // retried: an explicit HOST is literal (server/http/config.js bindCandidates).
    let bound = null;
    let lastError = null;
    const candidates = bindCandidates(host);
    for (let i = 0; i < candidates.length; i++) {
      const candidate = candidates[i];
      try {
        await new Promise((resolve, reject) => {
          const onError = (e) => { server.off('listening', onListening); reject(e); };
          const onListening = () => { server.off('error', onError); resolve(); };
          server.once('error', onError);
          server.once('listening', onListening);
          server.listen(port, candidate);
        });
        bound = candidate;
        break;
      } catch (e) {
        lastError = e;
        const retry = ['EAFNOSUPPORT', 'EADDRNOTAVAIL', 'EINVAL'].includes(e.code) && i < candidates.length - 1;
        if (!retry) break;
        log.warn(`[boot] cannot bind ${candidate} (${e.code}) — falling back to IPv4 only`);
      }
    }
    if (bound === null) throw lastError;
    boundHost = bound;

    // 内容集预热：默认插件集首次构建要现算（~6-9 s）。放在**端口打开之后**异步做 ——
    // 容器平台按端口就绪判断启动成功，监听前的同步预热会被判成启动失败。
    setTimeout(() => {
      try {
        const warmIds = policy.get().default || [];
        if (!warmIds.length) return;
        const t0 = Date.now();
        const warmed = roomSets.resolve(warmIds, { scope: 'room' });
        const took = Date.now() - t0;
        if (warmed && warmed.ok) log.info(`[plugins] warm-up: default content set ready in ${took} ms`);
        else log.info(`[plugins] warm-up: default content set not warmable (${(warmed && (warmed.error || warmed.detail)) || '?'})`);
      } catch (e) { log.warn?.('[plugins] warm-up failed', e); }
    }, 500).unref?.();
    // Check the kernel's address too: aliases/DNS and bind fallback cannot weaken the owner gate.
    const actual = server.address();
    const scriptHost = actual && typeof actual === 'object' ? actual.address : '';
    packs.setScriptHost(scriptHost);
    const testGate = lobby.setTestHost(scriptHost);
    if (testGate.warn) log.warn(`[test-mode] ${testGate.warn}`);
    else if (testGate.enabled) log.info('[test-mode] test rooms enabled');
    if (!trustedHostAllowed(scriptHost, scriptMode)) {
      lobby.trustedRuntime = null;
      await trustedRuntime?.close();
    }
  } catch (e) {
    network.close(); // stop heartbeat/sweep timers of the half-built server
    hosts.close();
    versionHosts?.close();
    assetIndex?.close();
    studio?.close();
    eventLoop?.close();
    await simPool?.close();
    await trustedRuntime?.close();
    throw e;
  }
  server.on('error', (e) => log.error('[http] server error', e));
  assetIndex?.start();
  // started only once the server is listening: the first window then reports real counts, not a half-built hall
  eventLoop?.start();

  const addr = server.address();
  const actualPort = typeof addr === 'object' && addr ? addr.port : port;
  const url = `http://${displayHost(boundHost)}:${actualPort}`;

  let closing = null;
  async function close() {
    if (closing) return closing;
    closing = (async () => {
      try { lobby.shutdown('shutdown'); } catch (e) { log.error('[shutdown] lobby', e); }
      try { hosts.close(); } catch (e) { log.error('[shutdown] match hosts', e); }
      try { versionHosts?.close(); } catch (e) { log.error('[shutdown] version hosts', e); }
      try { disposeLobbyPlugins?.(); } catch (e) { log.error('[shutdown] lobby plugins', e); }
      // after the lobby: every room is gone, so no rehearsal can still be waiting on a thread
      try { await simPool?.close(); } catch (e) { log.error('[shutdown] simulation pool', e); }
      eventLoop?.close();
      network.close();
      assetIndex?.close();
      mods?.close();
      studio?.close();
      await trustedRuntime?.close();
      await new Promise((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections?.();
        setTimeout(() => { server.closeAllConnections?.(); }, 500).unref();
      });
      try { wss.close(); } catch { /* ignore */ }
    })();
    return closing;
  }

  return { port: actualPort, host: boundHost, url, server, wss, lobby, network, registry, packs, content, visual, contents, hosts, versions, versionHosts, traffic, assetIndex, views, studio, eventLoop, simPool, close };
}

/**
 * The `--room-code ABCD` / `--room-code=ABCD` argument of this process entry, or null when it is absent. The value is
 * read once at startup and lives only in this server instance: there is no environment variable and nothing is
 * persisted, so stopping the server and starting it again without the argument is random again. A missing or invalid
 * value throws (the boot helper reports it and exits) instead of silently starting random.
 * @param {string[]} [argv]
 * @returns {string | null}
 */
export function roomCodeFromArgv(argv = process.argv.slice(2)) {
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--room-code') {
      const v = argv[i + 1];
      if (v == null || v.startsWith('-') || !v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
    if (a.startsWith('--room-code=')) {
      const v = a.slice('--room-code='.length);
      if (!v.trim()) throw new RangeError('--room-code needs 4 letters or digits');
      return parseRoomCode(v);
    }
  }
  return null;
}

// `node server/index.js` / npm start: listen, print the banner, stop on SIGINT / SIGTERM (http/boot.js).
if (isProcessEntry(import.meta.url)) runMain(() => startServer({ roomCode: roomCodeFromArgv() }));

/** 由 server/index.js（自举入口）调用：方便把「顶层 import 失败」也纳入诊断。 */
export function main() { return runMain(() => startServer({ roomCode: roomCodeFromArgv() })); }
