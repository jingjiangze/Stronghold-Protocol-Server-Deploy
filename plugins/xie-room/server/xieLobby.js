// plugins/xie-room/server/xieLobby.js — 协同共竞（房间规则集 `variant: 'xie'`）的房间层，纯插件实现。
//
// 挂载面：manifest 2 的 `code.lobby`（server/plugins/lobbyModules.js）。它做三件事：
//   1. roomInit：记住这个房间的规则集（房主建房时带 `variant: 'xie'`）；
//   2. roomState：把规则集平铺进 room.state，客户端据此切到协同共竞的房间页；
//   3. matchOptions：把对局 id 映射成数据表里的 `mode_xie_<difficulty>`（核心的 modeIdFor 只认识
//      single/multi 两种，映射规则属于本玩法，所以放在插件里；核心 opts 已允许插件覆盖 modeId）。
//
// 对局本体（共竞规则）仍在 mota 的 code.match 里 —— manifest 2 的 code.match 是单入口，拆开会丢一个。

const VARIANTS = new Set(['xie']);

/** 规则集是否本插件认识的；返回规范值或 null。 */
const variantOf = (room) => (room && VARIANTS.has(room.variant) ? room.variant : null);

export function setup(api) {
  api.roomInit((room) => {
    if (!room) return;
    // 建房时核心已把合法字符串存到 room.variant；这里只做默认值兜底（协同共竞默认 xie）
    if (room.mode === 'coop' && room.variant == null && room.xieDefault === true) room.variant = 'xie';
  });

  api.roomState((room) => {
    const v = variantOf(room);
    return v ? { variant: v } : null;
  });

  api.matchOptions((room) => {
    if (!room || room.mode !== 'coop') return null;
    const v = variantOf(room);
    if (!v) return null;
    const diff = String(room.difficulty || 'NORMAL').toLowerCase();
    return { modeId: `mode_${v}_${diff}` };
  });
}
