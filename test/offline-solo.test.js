// test/offline-solo.test.js — 纯浏览器独立模拟（offline-solo 插件）的 Node 侧验证。
//
// 这些断言钉住「不连服务器也能玩」成立的前提，全部可在 Node 跑（浏览器专属的 e2e 留给 SP_E2E 套件）：
//   1. /match/**.js 对页面可服务，而 /match/host/** 永远 404（那一层是 Node-only：child_process / worker_threads）；
//   2. /data.js 垫片导出 Match 引擎从 `../data.js` 导入的全部名字（getData / getConfig / getMode）——
//      缺任何一个，浏览器 import /match/Match.js 直接失败；
//   3. loopback WebSocket ⇄ LocalLobby ⇄ **真 Match** 的整条握手与阶段推进（solo 建房 → INFO_CHECK → … → PREP），
//      离线局与联机局跑的是同一个引擎；
//   4. 布阵采集的结算门控（只收 victory / defeat）与 localStorage 队列的重试语义；
//   5. /api/offline-lineup 永远 200（fail-open），未配置学习库时 accepted=0 且条目不丢。
//
// localStorage 在 Node 里没有：测试注入一个内存替身（客户端代码只走 getItem/setItem/removeItem 三个方法）。

import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mod = (rel) => import(pathToFileURL(path.join(ROOT, rel)).href);

// ---- browser stand-ins -------------------------------------------------------------------------

function installLocalStorageStub() {
  const mem = new Map();
  globalThis.localStorage = {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
    __mem: mem,
  };
  return mem;
}
if (!globalThis.crypto) {
  const { webcrypto } = await import('node:crypto');
  globalThis.crypto = webcrypto;
}

// ---- 1 & 2: 服务层（/match/ 挂载 + /data.js 垫片） ------------------------------------------------

async function boot() {
  const { startServer } = await mod('server/index.js');
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
  return srv;
}

test('/match/ serves the engine modules a page loads for an offline match (and never /match/host/)', async () => {
  const srv = await boot();
  try {
    const get = (u) => fetch(srv.url + u);
    for (const u of ['/match/Match.js', '/match/board.js', '/match/gamedata.js', '/match/match/platform.js']) {
      const res = await get(u);
      assert.equal(res.status, 200, u);
      assert.match(res.headers.get('content-type') || '', /javascript/, u);
      assert.ok((await res.text()).length > 0, u);
    }
    for (const u of ['/match/host/index.js', '/match/host/entry.js', '/match/host/childHost.js', '/match/host/']) {
      assert.equal((await get(u)).status, 404, u); // the Node-only match host stays off the wire
    }
    assert.equal((await get('/match/Match.json')).status, 404, 'only .js is served');
    assert.equal((await get('/match/nope.js')).status, 404, 'a file that does not exist');
  } finally { await srv.close(); }
});

test('/data.js exports every name the match engine imports from ../data.js', async () => {
  const srv = await boot();
  try {
    const res = await fetch(srv.url + '/data.js');
    assert.equal(res.status, 200);
    const src = await res.text();
    // server/match/gamedata.js: import { getConfig, getMode } from '../data.js'; server/match/builtinMeta.js: getData
    for (const name of ['getData', 'getConfig', 'getMode']) {
      assert.ok(new RegExp(`export function ${name}\\(`).test(src), `/data.js must export ${name}()`);
    }
    // 行为与 server/data.js 逐字一致：own-property 查找、缺 config 给 null、未知 mode 给 null
    const shim = await import(/* @vite-ignore */ `data:text/javascript,${encodeURIComponent(src.replace(
      "import { getSimData } from './sim/simdata.js';",
      'const getSimData = () => globalThis.__sp_shim_data__ || null;',
    ))}`);
    globalThis.__sp_shim_data__ = null;
    assert.deepEqual(shim.getData(), {});
    assert.equal(shim.getConfig(), null);
    assert.equal(shim.getMode('mode_single_normal'), null);
    globalThis.__sp_shim_data__ = { config: { modes: { mode_single_normal: { type: 'SINGLE' } } } };
    assert.deepEqual(shim.getConfig(), { modes: { mode_single_normal: { type: 'SINGLE' } } });
    assert.deepEqual(shim.getMode('mode_single_normal'), { type: 'SINGLE' });
    assert.equal(shim.getMode('constructor'), null, 'inherited names never resolve');
    delete globalThis.__sp_shim_data__;
  } finally { await srv.close(); }
});

// ---- 3: 整条离线握手 + 阶段推进（真 Match） -------------------------------------------------------

test('the offline chain drives a real Match: loopback hello → welcome → solo room → INFO_CHECK → PREP', async () => {
  installLocalStorageStub();
  const { Net } = await mod('public/js/net.js');
  const { createLocalLobby } = await mod('public/js/offline/localLobby.js');
  const { getData } = await mod('server/data.js');
  const engine = await mod('server/match/Match.js');
  const boardMod = await mod('server/match/board.js');
  const data = getData({ log: { warn() {}, error() {}, info() {} } });

  const lobby = createLocalLobby({
    log: { info() {}, warn() {}, error: (m) => console.error(m), debug() {} },
    loadMatch: async () => ({ Match: engine.Match, pieceDir: boardMod.pieceDir }),
    engineData: () => data,
  });
  const net = new Net({ WebSocket: lobby.WebSocket, url: 'loopback:solo' });
  let pub = null;
  net.on('m.public', (m) => { pub = m; });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = async (pred, label, ms = 30000) => {
    const t0 = Date.now();
    while (!pred()) {
      assert.ok(Date.now() - t0 < ms, `${label} timed out (phase=${pub?.phase})`);
      await sleep(100);
    }
  };

  try {
    net.setName('博士');
    await until(() => net.status === 'online', 'loopback hello → welcome', 5000);
    assert.equal(net.playerId, 'local', 'offline welcome names the local seat');

    await net.request('room.create', { mode: 'solo', difficulty: 'NORMAL' });
    await net.request('room.ready', { ready: true });
    await net.request('room.start', {});
    await until(() => pub && pub.phase === 'INFO_CHECK', 'INFO_CHECK through the wire path', 10000);

    await net.request('g.infoReady', { setupRevision: pub?.setupRevision ?? 0 });
    await until(() => pub && pub.phase === 'BAND_DRAFT', 'BAND_DRAFT after the briefing', 10000);

    await net.request('g.band', { bandId: Object.keys(data.bands)[0] });
    await until(() => pub && pub.phase === 'PREP' && pub.round >= 1, 'PREP round 1 after the draft', 30000);
    // 引擎真跑了：m.private 带来经济（休整期 income 生效）
    await until(() => pub && pub.phase === 'PREP', 'still PREP', 100);
  } finally {
    net.close();
    lobby.reset();
    await new Promise((r) => setTimeout(r, 200)); // 让 Match 的 timer 全部拆掉再退出测试
  }
});

// ---- 4: 布阵采集与门控（不需要整局，直接对函数下结论） -------------------------------------------

test('offline lineup capture: usable reasons gate, dedupe holds, the queue survives reload', async () => {
  const mem = installLocalStorageStub();
  const { enqueueOfflineLineup, readOfflineLineups, sigOf, takeOfflineLineups, dropOfflineLineups, offlineLineupCount } = await mod('public/js/offline/lineupOutbox.js');

  const cells = [
    { id: 'char_003_kalts', golden: false, row: 10, col: 4, dir: 'RIGHT' },
    { id: 'char_013_surtr', golden: false, row: 11, col: 5, dir: 'LEFT' },
  ];
  const rec = { t: 'lineup', at: new Date().toISOString(), modeId: 'mode_single_normal', stageId: 'act1autochess_m01', difficulty: 'NORMAL', round: 3, sig: sigOf(cells), cells };

  assert.equal(enqueueOfflineLineup(rec), true, 'a lineup queues');
  assert.equal(enqueueOfflineLineup(rec), false, 'the same lineup never doubles');
  assert.equal(enqueueOfflineLineup({ ...rec, cells: [cells[0]] }), false, 'cells<2 never queues');
  assert.equal(offlineLineupCount(), 1);

  // 「补传成功才删」：drop 只删交出去的那批
  const took = takeOfflineLineups(10);
  assert.equal(took.length, 1);
  assert.equal(dropOfflineLineups([]), 1, 'nothing dropped when the server accepted 0');
  assert.equal(dropOfflineLineups(took), 0, 'accepted entries leave the queue');
  assert.equal(readOfflineLineups().length, 0);

  // 坏 JSON / 缺字段：读侧全部当空队列，永不抛
  mem.set('sp.offline.lineups.v1', 'not json');
  assert.deepEqual(readOfflineLineups(), []);
});

test('the server gate: acceptOfflineLineups stores nothing without SP_LINEUP_LIBRARY and never throws', async () => {
  const { acceptOfflineLineups } = await mod('plugins/mota/server/lineupLibrary.js');
  delete process.env.SP_LINEUP_LIBRARY;
  const cells = [
    { id: 'char_003_kalts', golden: false, row: 10, col: 4, dir: 'RIGHT' },
    { id: 'char_013_surtr', golden: false, row: 11, col: 5, dir: 'LEFT' },
  ];
  const r = await acceptOfflineLineups([{ t: 'lineup', modeId: 'mode_single_normal', difficulty: 'NORMAL', round: 1, cells }]);
  assert.equal(r.accepted, 0, 'library off: nothing stored');
  assert.equal(r.rejected, 1);
  assert.deepEqual(await acceptOfflineLineups('garbage'), { accepted: 0, rejected: 0 }, 'a non-array never throws');
});

// ---- 5: /api/offline-lineup 端点 -----------------------------------------------------------------

test('POST /api/offline-lineup always answers 200 (fail-open) and never stores without the library', async () => {
  const srv = await boot();
  try {
    const post = (body) => fetch(srv.url + '/api/offline-lineup', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body,
    });
    const opt = await fetch(srv.url + '/api/offline-lineup', { method: 'OPTIONS' });
    assert.equal(opt.status, 204);
    assert.equal(opt.headers.get('access-control-allow-origin'), '*');

    for (const body of ['', 'not json', '{}', '{"entries":5}', '[]', '{"entries":[{"t":"lineup","cells":[]}]}']) {
      const res = await post(body);
      assert.equal(res.status, 200, body || '(empty)');
      const doc = await res.json();
      assert.equal(doc.ok, true, body || '(empty)');
      assert.equal(doc.accepted, 0, body || '(empty)');
    }
    // GET 也是 200 + dropped:'method'：客户端永不因形状失败
    const g = await fetch(srv.url + '/api/offline-lineup');
    assert.equal(g.status, 200);
    assert.equal((await g.json()).dropped, 'method');
  } finally { await srv.close(); }
});

// ---- 探测判据（decideOffline）--------------------------------------------------------------------

test('decideOffline: ?host= forces win, an alive /healthz keeps the socket, failure means offline', async () => {
  const { decideOffline } = await mod('public/js/offline/index.js');
  const alive = async () => ({ ok: true, status: 200 });
  const gone = async () => { throw new Error('ECONNREFUSED'); };
  const notFound = async () => ({ ok: false, status: 404 });

  assert.deepEqual(await decideOffline('?host=1', gone), { offline: true, forced: '1' }, '?host=1 = explicit offline');
  assert.deepEqual(await decideOffline('?host=0', alive), { offline: false }, '?host=0 = explicit online, no probe');
  assert.deepEqual(await decideOffline('?server=1', gone), { offline: false }, '?server=1 pins the socket');
  assert.deepEqual(await decideOffline('', alive), { offline: false }, 'a real /healthz keeps the normal path');
  assert.equal((await decideOffline('', gone)).offline, true, 'unreachable server = offline');
  assert.equal((await decideOffline('', notFound)).offline, true, 'a static host (404) = offline');
});
