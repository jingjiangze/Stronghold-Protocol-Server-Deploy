// public/js/offline/index.js — 纯浏览器独立模拟的入口：探测、装载、引擎数据拼合。
//
// 判据（对齐参考仓 himobrine/Stronghold-Protocol-pure-web 的 ?host= / HEAD /healthz 探测设计）：
//   1. ?host=1 / ?host=solo —— 显式离线（静态站 / 演示 / 断网自查），不探测；
//   2. ?host=0 / ?server=1 —— 显式联机，不探测；
//   3. 其它 —— 一次 HEAD /healthz：404 / 网络失败 / 非服务器应答 ⇒ 离线。离线是退路，不是另一套玩法：
//      探测成功（有真服务器）时一切行为与今天完全一致，本模块的代码一行都不执行。
//
// 离线后整条 net 链（握手、心跳、重连、rid 应答、界面）走的是未改的 public/js/net.js —— 只是 connect()
// 用的 WebSocket 类换成了 offline/localSocket.js 的 loopback（Net 的 `this.WS || globalThis.WebSocket`
// 是现成注入点），服务器端由 offline/localLobby.js 的页内大厅应答，对局本体是**真 Match**（/match/Match.js，
// 服务端那套引擎在页面里跑），离线局与联机局同规则。
//
// 双树约定（与本仓 econ/skins 线同一纪律）：本目录逐字节镜像到 plugins/mota/client/js/offline/
// （mota 覆盖 /js/main.js 时离线模块随 contentSet 一起出现在同一路径），改一处必须同步另一处。

import { net } from '../net.js';

/** 引擎要的 data 文件（server/data.js DATA_FILES 去掉纯展示的 assets/local-*）；缺 config 会让全局数值走默认。 */
export const ENGINE_FILES = Object.freeze(['config', 'chess', 'bonds', 'garrisons', 'items', 'bands', 'effects', 'choices', 'enemies', 'factions', 'waves', 'stages', 'bosses', 'tokens', 'backups']);

/**
 * 要不要进离线模式（纯判定，不装载任何离线代码）。
 * @param {string} search location.search
 * @param {() => Promise<{ ok: boolean }>} probe 注入：HEAD /healthz 的 fetch（测试可换）
 * @returns {Promise<{ offline: boolean, forced?: string }>}
 */
export async function decideOffline(search, probe) {
  let params;
  try { params = new URLSearchParams(search); } catch { return { offline: false }; }
  const host = params.get('host');
  if (host === '0' || params.get('server') === '1') return { offline: false };
  if (host) return { offline: true, forced: host };
  try {
    const res = await probe();
    // 200/304/401… 任何「服务器活着」的应答都算在线；只有 404/5xx/网络失败才是「这里没有服务器」。
    return { offline: !(res && (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 404) || res.status === 405)) };
  } catch {
    return { offline: true };
  }
}

/** 拼引擎数据：读浏览器 data store 的原始 JSON（不经本地化视图——引擎要数据本身，不是译文）。 */
export function assembleEngineData(store) {
  const raw = {};
  for (const name of ENGINE_FILES) {
    const v = typeof store.getRaw === 'function' ? store.getRaw(name) : store.get(name);
    if (v !== null && v !== undefined) raw[name] = v;
  }
  return raw;
}

/** 还没下齐的引擎文件。 */
export const missingEngineFiles = (raw) => ENGINE_FILES.filter((n) => !raw[n] || typeof raw[n] !== 'object');

/**
 * 装载离线：建页内大厅（内含真 Match 的全部编排），把 net 的传输换成 loopback。
 * 只设 `net.WS` 与 `net.url` 两个构造期字段——connect() 里现成读这两个字段，之后的一切不变。
 * main.js 照常 net.connect()/setName()：hello→welcome、状态事件、请求应答全部经 localLobby。
 * @param {{ log?: object }} [opts]
 * @returns {Promise<{ lobby: any, missingFiles: () => string[] }>}
 */
export async function bootOffline({ log = console } = {}) {
  const { createLocalLobby } = await import('./localLobby.js');
  const { data } = await import('../data.js');
  // 先把引擎数据下齐：main.js 的 warmGameData 是「进房间才预热」的后台下载，离线建房到开赛可能只差几毫秒，
  // 缺 chess/config 的 Match 会直接以 reason:'error' 终局——这里把「数据没齐」变成「开赛前等齐」。
  await data.loadAll(ENGINE_FILES).catch(() => { /* 缺项由开赛时的 DATA 检查点名 */ });

  const lobby = createLocalLobby({
    log,
    // 引擎模块惰性引：在线路径永远不会下载 /match/ 这套代码
    loadMatch: async () => {
      const [m, b] = await Promise.all([import('/match/Match.js'), import('/match/board.js')]);
      if (!m || typeof m.Match !== 'function') throw new Error('match engine unavailable: /match/Match.js');
      return { Match: m.Match, pieceDir: b.pieceDir };
    },
    engineData: () => assembleEngineData(data),
    // 把浏览器已下载的 /data/*.json 同时灌给 sim 的浏览器替身（/data.js 垫片读 getSimData）
    primeSimData: async (raw) => { const sd = await import('/sim/simdata.js'); sd.setSimData(raw); },
  });

  net.WS = lobby.WebSocket;
  net.url = 'loopback:solo';
  globalThis.__SP_OFFLINE__ = lobby;
  log.info?.('[offline] 本机独立模拟就绪（未连接服务器）');

  return { lobby, missingFiles: () => missingEngineFiles(assembleEngineData(data)) };
}
