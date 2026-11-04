// plugins/mota/server/protocol.js — 把引擎自己那套 C2S 键登记进宿主的协议表。
//
// 背景：manifest 2 的 `shared/**` 只进**客户端** overlay（server/index.js 的 clientOverlay），
// 服务端的协议表始终是核心 `shared/protocol.js`。于是插件里新增的 `g.confront` / `g.econ.*` /
// `room.setTeam` / `b.snapshot` 等键，客户端发了服务端不认识 —— 实测表现是 `NetError: 无效的请求 (BAD_MSG)`
// （对抗期狩猎面板点目标刷出一串）。
//
// 修法：`code.lobby` 的 `api.protocol(spec)` 是宿主给的「新增协议键」入口（已存在的键不覆盖，引擎优先），
// 这里把插件协议表里**核心没有的那些键**整份登记进去 —— 校验规则仍来自插件自己的 shared/protocol.js，
// 核心不需要认识任何一个玩法键。

import { C2S as CORE_C2S } from '../../../shared/protocol.js';
import { C2S as MOTA_C2S } from '../shared/protocol.js';

export function setup(api) {
  const extra = {};
  for (const [key, spec] of Object.entries(MOTA_C2S || {})) {
    if (Object.hasOwn(CORE_C2S, key)) continue;   // 引擎自己的键以核心为准
    extra[key] = spec;
  }
  try { api.protocol(extra); } catch { /* 老宿主没有 api.protocol：协议键缺失只影响这些玩法消息 */ }
  const n = Object.keys(extra).length;
  if (n) api.log?.info?.(`[mota] protocol: registered ${n} gameplay C2S keys`);
}
