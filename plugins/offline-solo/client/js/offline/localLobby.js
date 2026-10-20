// public/js/offline/localLobby.js — 页内「假大厅」：不连服务器时，替服务器答话的那半条连接。
//
// 分工（整个离线路径的核心设计；参考 himobrine/Stronghold-Protocol-pure-web 的 host/entry.js，
// 但把「真 Lobby 搬进浏览器」换成「一层薄应答 + 真 Match」——solo 不需要大厅的全部功能，
// 这样 net.js / 界面 / 引擎全部零改动，决策记录见 _tmp/offline-solo-audit-2026-10-20/findings.md）：
//
//   public/js/net.js 的 Net（一行未改；opts.WebSocket 注入点接 offline/localSocket.js 的 loopback）
//        │ JSON 文本帧（与线上同格式）
//        ▼
//   LocalLobby（本文件）：hello→welcome、ping→pong、room.*（solo 建房 / ready / start / 设置类应答）、
//        g.* 与 b.* → 交给**真 Match**（/match/Match.js），按 server/net.js 的管线形状回 ok / error。
//        ▼
//   真 Match：阶段机、经济、波次、结算、clientCombat 授权全部是服务端那套引擎在页面里跑。
//
// Match 经注入的 send/broadcast/onEnd 发帧（server/match/Match.js:269-272 强制要求这三个回调，
// m.* / b.* 全部经它们出口，room.* 属于平台层——server/match/Match.js 头注释），本类把这三者接回
// loopback 的服务器端 ep；界面收到的帧与联机时逐字段相同。room.state 由本类按 Room.toState 的形状
// （server/lobby.js:355）合成：1 个真人座位、hostId=本机、inMatch 随对局切换。
//
// 布阵采集（用户要求「模拟完后如果连着服务器就上传布阵数据」的离线半区）：
//   服务器每回合 endPrep 时 recordPrepLineups 暂存、结算 finish 按 victory/defeat 门控落库
//   （plugins/mota/server/lineupLibrary.js:319-391）。离线用同一判据的页面版：广播里 PREP→COMBAT 的
//   跳变即「这一回合的板子进战斗」= 暂存；m.result 帧带 victory/reason（server/match/results.js:139-143），
//   reason ∈ {victory, defeat} 才把暂存批次入队 localStorage（lineupOutbox），否则丢弃——半途退出的局
//   和服务器一样不进学习库。入队的条目由 online 路径的 lineupSync 补传到 /api/offline-lineup。
//
// v1 边界（写进 PR 描述）：不做独立模拟 24h 断线续局（参考仓的 PRD M3 快照链）、不做观战/房间列表/
// 插件房——这些没有服务器就没有语义，一律回错误码，界面有现成提示。

import { ERR, ERR_TEXT, PROTOCOL_VERSION, modeIdFor } from '../../../shared/constants.js';
import { validateC2S } from '../../../shared/protocol.js';
import { makeLoopbackClass } from './localSocket.js';
import { enqueueOfflineLineup, sigOf } from './lineupOutbox.js';

/** 本机固定会话（没有服务器就没有 token 协商；固定 id 让离线补传不串号）。 */
export const LOCAL_PLAYER_ID = 'local';

/** 服务端同一条门控：只有打到 victory / defeat 的局值得学（plugins/mota/server/lineupLibrary.js:62）。 */
const USABLE_REASONS = new Set(['victory', 'defeat']);

const encode = (msg) => { try { return JSON.stringify(msg); } catch { return null; } };

/** 一个回合的棋盘 → 学习库 cells 形状（{id,golden,row,col,dir}，lineupLibrary.js:327 同源）。 */
function boardCells(m, ps) {
  const out = [];
  const board = ps?.board;
  if (!board || typeof board.forEach !== 'function') return out;
  const pieceDir = m._pieceDir || ((p) => p?.dir || 'RIGHT');
  board.forEach((piece, key) => {
    if (!piece || piece.kind !== 'chess') return;
    const [r, c] = String(key).split(',').map(Number);
    if (!Number.isFinite(r) || !Number.isFinite(c)) return;
    out.push({
      id: piece.id,
      golden: !!(m.gd && typeof m.gd.isGolden === 'function' && m.gd.isGolden(piece.id)),
      row: r, col: c, dir: pieceDir(piece),
    });
  });
  return out;
}

/**
 * @param {{
 *   loadMatch: () => Promise<{ Match: Function, pieceDir: Function }>,  // 惰性引 /match/（在线路径永不下载）
 *   engineData: () => Record<string, any>,                              // /data/*.json 拼出的 raw（server/data.js 形状）
 *   primeSimData?: (raw: object) => Promise<void> | void,               // 灌 /sim/simdata.js 的浏览器替身
 *   log?: object,
 * }} opts
 */
export function createLocalLobby({ loadMatch, engineData, primeSimData = null, log = console }) {
  /** 当前绑定的服务器端 endpoint。 */
  let ep = null;
  /** 当前对局与房间。 */
  let match = null;
  let room = null; // { difficulty, name, ready, inMatch, settings }
  /** 每回合定型的板子（服务端 staged 的页面版）：结算门控后才入队。 */
  let staged = [];
  let lastPhase = null;
  let roomClosedSent = false;

  const sendToClient = (msg) => { const s = encode(msg); if (s && ep?.readyState === 1) ep.send(s); };
  const replyOk = (rid) => { if (Number.isInteger(rid)) sendToClient({ t: 'ok', rid }); };
  const replyErr = (code, rid, detail) => {
    if (!Number.isInteger(rid)) return;
    sendToClient({ t: 'error', code: code || ERR.INTERNAL, msg: ERR_TEXT[code] || code, rid, ...(detail ? { detail: String(detail).slice(0, 120) } : {}) });
  };

  /** 合成 room.state（形状对齐 server/lobby.js Room.toState，只留界面会读的字段）。 */
  function broadcastRoomState() {
    if (!room) return;
    sendToClient({
      t: 'room.state',
      code: 'SOLO',
      hostId: LOCAL_PLAYER_ID,
      mode: 'solo',
      difficulty: room.difficulty,
      aiPicksLast: false,
      inMatch: !!room.inMatch,
      private: true,
      seatCap: 1,
      seats: [{ seat: 0, playerId: LOCAL_PLAYER_ID, name: room.name, isBot: false, ready: room.inMatch ? true : !!room.ready, connected: true, team: null, card: null }],
      spectators: [],
    });
  }

  function closeRoom(reason = 'ended') {
    if (roomClosedSent) return;
    roomClosedSent = true;
    sendToClient({ t: 'room.closed', reason });
  }

  /** 拆局：停引擎、清暂存（未结算的局不入库，与服务器 dropStagedLineups 同语义）。 */
  function teardown() {
    if (match) { try { match.dispose(); } catch { /* already gone */ } match = null; }
    staged = [];
    lastPhase = null;
    if (room) { room.inMatch = false; }
  }

  /** 盯 m.public 的 phase 跳变：PREP→COMBAT = 这一回合的布阵定型（服务端在 endPrep 里 recordPrepLineups）。 */
  function watchLineups(msg) {
    const phase = msg?.phase;
    if (!match || !phase) return;
    if (lastPhase === 'PREP' && (phase === 'COMBAT' || phase === 'UNITE')) {
      try {
        const ps = match.players?.get(LOCAL_PLAYER_ID);
        const cells = boardCells(match, ps);
        if (cells.length >= 2) { // 近乎空盘教不了什么（服务端同判据 lineupLibrary.js:334）
          staged.push({
            t: 'lineup', at: new Date().toISOString(), modeId: match.modeId,
            stageId: match.stageId || null, difficulty: match.difficulty || null,
            round: match.round, sig: sigOf(cells), cells,
          });
        }
      } catch (e) { log.warn?.('[offline] lineup capture failed', e); }
    }
    lastPhase = phase;
  }

  /** m.result = 结算：与服务器 flushMatchLineups 同一道门控（victory / defeat 才入库）。 */
  function settleFromResult(msg) {
    const reason = msg?.reason || (msg?.victory ? 'victory' : 'defeat');
    if (USABLE_REASONS.has(reason)) {
      let n = 0;
      for (const rec of staged) { if (enqueueOfflineLineup(rec)) n++; }
      if (n) log.info?.(`[offline] ${n} 条布阵已留在本地待传（联网后自动补传）`);
    }
    staged = [];
  }

  /** 统一的发帧出口（单播/广播在离线里都是「发给本页那条 loopback」）：m.public 看布阵、m.result 走结算门控。 */
  const emit = (msg) => {
    if (msg?.t === 'm.public') watchLineups(msg);
    if (msg?.t === 'm.result') settleFromResult(msg);
    sendToClient(msg);
  };

  async function startMatch() {
    if (room?.inMatch) return;
    const raw = engineData();
    if (primeSimData) await primeSimData(raw);
    const { Match, pieceDir } = await loadMatch();
    const seed = (globalThis.crypto?.getRandomValues(new Uint32Array(1))[0]) >>> 0 || 1;
    room.ready = false;
    room.inMatch = true;
    roomClosedSent = false;
    match = new Match({
      roomCode: 'SOLO', mode: 'solo', difficulty: room.difficulty,
      modeId: modeIdFor('solo', room.difficulty),
      seats: [{
        seat: 0, playerId: LOCAL_PLAYER_ID, name: room.name, isBot: false, connected: true,
        loadout: room.settings.loadout ?? null, ops: room.settings.ops ?? null,
        notOwned: room.settings.notOwned ?? null, diy: room.settings.diy ?? null, skins: room.settings.skins ?? null,
      }],
      spectators: [], hostId: LOCAL_PLAYER_ID, seed, matchNo: 1,
      data: raw, log, now: () => Date.now(),
      // 三个注入回调 = 服务端 lobby 给 Match 的那三个（server/lobby.js:1531-1533 同款接线）；
      // 单播与广播在离线里都是「发给本页那条 loopback」，统一走 emit（看 m.public 布阵、m.result 结算）。
      send: (_pid, msg) => { emit(msg); return true; },
      broadcast: (msg) => { emit(msg); },
      onEnd: () => { setTimeout(() => { teardown(); broadcastRoomState(); }, 0); },
    });
    match._pieceDir = pieceDir;
    broadcastRoomState();
    match.start();
  }

  /** 一条来自页面的协议帧（Net 侧已 validateC2S 过一次，这里与 server/net.js 同管线再校验）。 */
  async function handleMessage(msg) {
    const t = msg.t;
    const rid = msg.rid;
    const answer = (res) => { if (res && res.error) replyErr(res.error, rid, res.detail); else replyOk(rid); };
    try {
      switch (t) {
        case 'ping': {
          const pong = { t: 'pong', c: msg.c, s: Date.now() };
          if (Number.isInteger(rid)) pong.rid = rid;
          sendToClient(pong);
          return;
        }
        case 'hello': {
          sendToClient({
            t: 'welcome', playerId: LOCAL_PLAYER_ID, token: 'offline', name: msg.name || '博士',
            serverNow: Date.now(), version: PROTOCOL_VERSION, resumed: false,
            content: { vanilla: 'offline' }, // 离线没有服务器插件：catalogue 与「本服务器有 N 个插件」都不出现
            ...(Number.isInteger(rid) ? { rid } : {}),
          });
          return;
        }
        case 'room.create': {
          if (msg.mode !== 'solo') { replyErr(ERR.ROOM_NOT_FOUND, rid, 'offline: solo only'); return; }
          teardown();
          room = { difficulty: msg.difficulty || 'NORMAL', name: '博士', ready: false, inMatch: false, settings: {} };
          roomClosedSent = false;
          broadcastRoomState();
          replyOk(rid);
          return;
        }
        case 'room.ready': {
          if (!room) { replyErr(ERR.NOT_IN_ROOM, rid); return; }
          room.ready = !!msg.ready;
          broadcastRoomState();
          replyOk(rid);
          return;
        }
        case 'room.start': {
          if (!room) { replyErr(ERR.NOT_IN_ROOM, rid); return; }
          if (room.inMatch) { replyErr(ERR.ROOM_STARTED, rid); return; }
          await startMatch();
          replyOk(rid);
          return;
        }
        case 'g.leave': {
          // 服务器语义：真人退出 = 永久离开；界面文案「放弃模拟将立即结束本局并返回大厅」——照做：
          // 拆局、不结算（未定型的局不进学习库，与服务器 abandoned 门控一致）、关房间。
          teardown();
          room = null;
          closeRoom('ended');
          replyOk(rid);
          return;
        }
        case 'room.leave': {
          teardown();
          room = null;
          closeRoom('ended');
          replyOk(rid);
          return;
        }
        // 设置类：存进座位设置，room.start 时带进 Match（字段集与 lobby.seatSettings 一致）
        case 'room.loadout': if (room) { room.settings.loadout = msg.entries ?? null; if (msg.ops !== undefined) room.settings.ops = msg.ops ?? null; } replyOk(rid); return;
        case 'room.ownership': if (room) room.settings.notOwned = msg.notOwned ?? null; replyOk(rid); return;
        case 'room.diy': if (room) room.settings.diy = msg.picks ?? null; replyOk(rid); return;
        case 'room.skins': if (room) room.settings.skins = msg.skins ?? null; replyOk(rid); return;
        case 'room.setDifficulty': if (room && !room.inMatch) room.difficulty = msg.difficulty || room.difficulty; broadcastRoomState(); replyOk(rid); return;
        // 只有真实服务器才有语义的操作：明确拒绝（界面有现成提示文案）
        case 'room.join': case 'room.spectate': case 'room.list': case 'room.addBot': case 'room.removeBot':
        case 'room.kick': case 'room.setPlugins': case 'room.setMode': case 'room.setMaxSeats': case 'room.setSeatCap':
          replyErr(ERR.ROOM_NOT_FOUND, rid, 'offline'); return;
        default: {
          // g.* 与 b.*：真 Match 处理（clientCombat 的 b.progress / b.result 走这里——
          // 与 server/lobby.js routeGame 同一入口形状；Match.handle 自带校验与错误码）
          if (match && (t.startsWith('g.') || t.startsWith('b.'))) {
            let res;
            try { res = match.handle(LOCAL_PLAYER_ID, msg); } catch (e) { log.error?.(`[offline] match.handle(${t}) failed`, e); res = { error: ERR.INTERNAL }; }
            answer(res);
            return;
          }
          if (t.startsWith('g.')) { replyErr(ERR.WRONG_PHASE, rid, 'no match'); return; }
          // 其它未知帧（b.snapshot 之类）：应答 ok 不作动作，界面只在乎不报错
          replyOk(rid);
        }
      }
    } catch (e) {
      log.error?.(`[offline] lobby failed on ${t}`, e);
      replyErr(ERR.INTERNAL, rid, String((e && e.message) || e));
    }
  }

  const host = {
    open(endpoint) {
      ep = endpoint;
      endpoint.onmessage = (evt) => {
        let msg;
        try { msg = JSON.parse(evt.data); } catch { return; }
        if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return;
        const bad = validateC2S(msg); // 与 server/net.js 同一道闸：坏帧不进大厅/引擎
        if (bad) { replyErr(ERR.BAD_MSG, msg.rid, bad); return; }
        void handleMessage(msg);
      };
      endpoint.onclose = () => { if (ep === endpoint) ep = null; };
    },
    close(endpoint) { if (ep === endpoint) ep = null; },
  };

  return {
    host,
    WebSocket: makeLoopbackClass(host),
    state: () => ({ inRoom: !!room, inMatch: !!room?.inMatch, phase: match?.phase ?? null, round: match?.round ?? null, staged: staged.length }),
    /** 页面级兜底（如离线局中途关页）；界面退出经 g.leave/room.leave 触发即可。 */
    reset() { teardown(); room = null; roomClosedSent = true; },
  };
}
