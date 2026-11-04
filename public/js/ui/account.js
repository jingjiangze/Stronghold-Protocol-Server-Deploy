// public/js/ui/account.js — 账号入口已经搬进插件 `plugins/accounts`（ui 类 · 首页 `title.login` 槽位）。
//
// 这里只留一个 no-op 的 `AccountDock`：mota 的 `client/js/main.js` 仍然
// `render(html`<${App}/><${AccountDock}/>`)`，删掉这个导出会让整页直接报错。
// 真正的账号条/面板在 `plugins/accounts/client/js/plugins/accounts/title.login.js`，
// 由 `public/js/ui/pluginSlots.js` 挂到首页登录卡上。

/** 已迁移到 accounts 插件：核心不再渲染任何账号 UI。 */
export function AccountDock() {
  return null;
}
