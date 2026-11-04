// public/js/ui/pluginSlots.js — 槽位宿主：把 ui 插件贡献的**同源模块**挂到页面锚点上（DESIGN §32.8 的扩展）。
//
// 为什么不走 sandbox frame：现有 ui 插件只能以 `<iframe sandbox="allow-scripts">` 进 4 个固定槽位
// （public/js/ui/pluginFrame.js 的 hud.right / result.tab / stats.tab / room.panel），iframe 是不透明源、
// 没有 storage、CSP 也不许它打本站接口；而首页登录卡必须读写本站账号令牌，frame 做不到。
//
// 所以给 ui 类加了第二种形态：模块贡献。插件把模块列进 `code.client`（例如
// `js/plugins/<id>/title.login.js`，导出 `mount(el)` / 可选 `unmount(el)`），由本文件挂进槽位。
// 依据：`server/boot-main.js` 的 clientOverlay 按 `status === 'loaded'` 收集 code.client，不区分类别，
// 所以 ui 类插件（不需要 lock / trusted pin）也能把自己的模块以应用路径下发。
//
// 信任面：同源模块与应用同等权限。能被加载的前提仍是「服主自己把插件目录放进 plugins/」，与 trusted 类
// 相同的部署前提；这不是玩家可自助安装的能力（玩家侧的界面插件仍是 sandbox frame + 本机开关）。
//
// 这个文件在核心 `public/js/` 下且不在任何插件的 `code.client` 清单里——它是所有插件 UI 的宿主，
// 不能被插件顶替。

const SLOT = 'title.login';
const SLOT_ATTR = 'data-ui-slot';
const BODY_CLASS = 'title-plugin-slot';

/** @type {string[]} 请求了本槽位、且已启用的 ui 插件 id */
let pluginIds = [];
/** @type {Map<string, { mod: any, host: HTMLElement }>} */
const mounted = new Map();

const log = (...a) => { try { console.debug('[plugins]', ...a); } catch { /* no console */ } };

async function loadPluginIds() {
  try {
    const res = await fetch('/plugins/index.json', { cache: 'no-store' });
    if (!res.ok) return [];
    const body = await res.json();
    const list = Array.isArray(body?.plugins) ? body.plugins : [];
    return list
      .filter((p) => p && p.class === 'ui' && !p.disabled && typeof p.id === 'string'
        && Array.isArray(p.slots) && p.slots.includes(SLOT))
      .map((p) => p.id);
  } catch {
    return [];
  }
}

/** 找到（必要时创建）首页登录卡里的槽位容器。 */
function slotOf() {
  const card = document.querySelector('.title-login');
  if (!card) return null;
  let slot = card.querySelector(`[${SLOT_ATTR}="${SLOT}"]`);
  if (slot) return slot;
  slot = document.createElement('div');
  slot.className = BODY_CLASS;
  slot.setAttribute(SLOT_ATTR, SLOT);
  // 放主按钮（开始）后面，没有主按钮就放到连接状态行前面
  const primary = card.querySelector('.btn--primary');
  const before = card.querySelector('.title-conn');
  if (primary && primary.parentElement === card) primary.insertAdjacentElement('afterend', slot);
  else if (before) card.insertBefore(slot, before);
  else card.appendChild(slot);
  return slot;
}

function unmount(id) {
  const entry = mounted.get(id);
  if (!entry) return;
  mounted.delete(id);
  try { entry.mod.unmount?.(entry.host); } catch (e) { log(id, 'unmount threw', e); }
  entry.host.remove();
}

/** 正在 import/mount 的插件：ensure() 是异步的，start() 与 observer 同时进来会各建一个 host（页面上出现两份）。 */
const pending = new Set();

async function ensure() {
  if (!pluginIds.length) return;
  const slot = slotOf();
  for (const id of pluginIds) {
    if (!slot) { unmount(id); pending.delete(id); continue; }
    const entry = mounted.get(id);
    if (entry && entry.host.isConnected && entry.host.parentElement === slot) continue;
    if (pending.has(id)) continue;
    unmount(id);
    // 同一插件只留一个宿主（上一轮可能留下孤儿节点）
    for (const stale of slot.querySelectorAll(`[data-plugin="${id}"]`)) stale.remove();
    pending.add(id);
    const host = document.createElement('div');
    host.className = 'title-plugin-slot__body';
    host.setAttribute('data-plugin', id);
    slot.appendChild(host);
    try {
      const mod = await import(`/js/plugins/${id}/title.login.js`);
      if (typeof mod.mount !== 'function') throw new Error('the module exports no mount()');
      await mod.mount(host);
      mounted.set(id, { mod, host });
    } catch (e) {
      host.remove();
      log(`${id} did not mount into ${SLOT}`, e);
    } finally {
      pending.delete(id);
    }
  }
}

let timer = 0;
function schedule() {
  // 只有首页或房间页在的时候才值得干活：对局里 DOM 每帧都在变，别让 observer 把这里拖成热点。
  if (!document.querySelector('.title-login')) {
    if (mounted.size) for (const id of [...mounted.keys()]) unmount(id);
    return;
  }
  clearTimeout(timer);
  // 自己的插入也会触发 observer；ensure() 幂等，两三个周期内就稳定下来
  timer = setTimeout(() => { ensure(); }, 120);
}

async function start() {
  pluginIds = await loadPluginIds();
  if (!pluginIds.length) return;
  ensure();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
  window.addEventListener('pageshow', schedule);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
