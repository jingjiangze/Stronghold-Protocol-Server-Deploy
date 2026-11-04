// server/plugins/lobbyModules.js — lobby 级插件面（2026-10-23）。
//
// 背景：manifest 2 的 `code.*` 一直只有 `match` / `client` / `data` —— 对局与客户端都能由插件提供，
// 但**房间（lobby）级**能力（自定义 C2S 消息、room.state 字段、match opts、房间生命周期）只能写进宿主
// server/lobby.js。这份文件补上这条缝：`code.lobby` 指向插件里的一个 JS 模块，导出 `setup(api)`。
//
// 边界（与 `server.modules` 同一条安全线）：
//   * 只有 **trusted** 类（服主显式启用 + 钉住 lock）能挂；`script` / `ui` / `cosmetic` 一律不读。
//   * `api.protocol(spec)` 只**新增** C2S 键，不覆盖已存在的（引擎的协议表是权威）。
//   * `api.roomState(fn)` 返回的对象**平铺**进 room.state（插件的键必须与引擎的不冲突；冲突时插件的值会盖掉）。
//   * 任何钩子抛错都只记日志，不拖垮房间或连接。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { C2S } from '../../shared/protocol.js';

const ROOM_EVENTS = ['created', 'joined', 'left', 'disposed', 'resync', 'started'];

/**
 * Mount every loaded trusted plugin that declares `code.lobby`.
 * @param {{ setExtensions?: (ext: any) => void }} lobby
 * @param {{ plugins?: () => any[] } | null} registry
 * @param {{ log?: any }} [opts]
 * @returns {Promise<() => void>} dispose
 */
export async function mountLobbyPlugins(lobby, registry, { log = null } = {}) {
  const all = typeof registry?.plugins === 'function' ? registry.plugins() : [];
  const plugins = all.filter((p) => p && p.status === 'loaded' && p.manifest?.class === 'trusted'
    && p.manifest?.code && typeof p.manifest.code.lobby === 'string' && p.manifest.code.lobby);

  const handlers = new Map();
  const inits = [];
  const states = [];
  const matchOptions = [];
  const beforeStarts = [];
  const events = new Map(ROOM_EVENTS.map((e) => [e, []]));
  const disposers = [];

  for (const p of plugins) {
    const rel = p.manifest.code.lobby;
    if (rel.includes('..') || rel.startsWith('/')) { log?.warn?.(`[lobby] ${p.id}: code.lobby must be a relative path`); continue; }
    const abs = path.join(p.dir, ...rel.split('/'));
    if (!fs.existsSync(abs)) { log?.warn?.(`[lobby] ${p.id}: code.lobby ${rel} not found`); continue; }
    try {
      const mod = await import(pathToFileURL(abs).href);
      if (typeof mod.setup !== 'function') { log?.warn?.(`[lobby] ${p.id}: code.lobby exports no setup()`); continue; }
      const api = {
        id: p.id,
        /** 新增 C2S 键（已存在的键不覆盖：引擎协议表是权威）。 */
        protocol(spec) {
          for (const [k, v] of Object.entries(spec || {})) {
            if (typeof k !== 'string' || Object.hasOwn(C2S, k)) continue;
            C2S[k] = v;
          }
        },
        /** 一条 C2S 消息的处理函数：`(session, msg, ctx, lobby) => result`（与 handleMessage 同形）。 */
        on(type, fn) { if (typeof type === 'string' && typeof fn === 'function') handlers.set(type, fn); },
        /** 房间刚建好（座位/房主已就位、尚未广播）时调用：给 room 加默认字段。 */
        roomInit(fn) { if (typeof fn === 'function') inits.push(fn); },
        /** 往 room.state 里平铺字段：返回对象或 null。 */
        roomState(fn) { if (typeof fn === 'function') states.push(fn); },
        /** 开局前（房主已校验、Match 还没建）跑一遍：可以补 AI 席、挡掉非法座位；返回 {error} 会中止开局。 */
        beforeStart(fn) { if (typeof fn === 'function') beforeStarts.push(fn); },
        /** 合并进 Match opts：返回对象或 null。 */
        matchOptions(fn) { if (typeof fn === 'function') matchOptions.push(fn); },
        /** 房间事件：created / joined / left / disposed / resync / started。 */
        onRoom(event, fn) { if (events.has(event) && typeof fn === 'function') events.get(event).push(fn); },
        log,
      };
      const d = await mod.setup(api);
      if (typeof d === 'function') disposers.push(d);
      log?.info?.(`[lobby] plugin ${p.id}: lobby hooks mounted`);
    } catch (e) {
      log?.error?.(`[lobby] plugin ${p.id}: code.lobby failed`, e);
    }
  }

  const ext = {
    handlers,
    init(room) {
      for (const fn of inits) { try { fn(room); } catch (e) { log?.error?.('[lobby] roomInit failed', e); } }
    },
    state(room) {
      let out = null;
      for (const fn of states) {
        try {
          const v = fn(room);
          if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) out = { ...(out || {}), ...v };
        } catch (e) { log?.error?.('[lobby] roomState failed', e); }
      }
      return out;
    },
    beforeStart(room, session, lobby) {
      for (const fn of beforeStarts) {
        try { const r = fn(room, session, lobby); if (r && r.error) return r; } catch (e) { log?.error?.('[lobby] beforeStart failed', e); }
      }
      return null;
    },
    options(room) {
      let out = null;
      for (const fn of matchOptions) {
        try { const v = fn(room); if (v && typeof v === 'object' && Object.keys(v).length) out = { ...(out || {}), ...v }; }
        catch (e) { log?.error?.('[lobby] matchOptions failed', e); }
      }
      return out;
    },
    emit(event, ...args) {
      for (const fn of events.get(event) || []) {
        try { fn(...args); } catch (e) { log?.error?.(`[lobby] room event ${event} failed`, e); }
      }
    },
  };

  lobby.setExtensions?.(plugins.length ? ext : null);
  return () => {
    for (const d of disposers) { try { d(); } catch { /* ignore */ } }
    lobby.setExtensions?.(null);
  };
}
