import { createChatScroll } from './chatScroll.js';
import { decorateOwnerName } from './ownerName.js';
import { installRoomStickers, showBattleSticker, stickerManifest, stickerImage } from './communityChat.js';
import { createRoomDanmaku } from './roomDanmaku.js';
import { outlineIcon } from './voiceIcons.js';
import { net } from '../net.js';
import { store } from '../store.js';

const CHAT_CSS_HREF = '/css/room-chat.css';
function ensureCss() {
  if (document.querySelector(`link[href="${CHAT_CSS_HREF}"]`)) return;
  const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = CHAT_CSS_HREF; document.head.append(l);
}

export function mountRoomChat() {
  ensureCss();
  const danmaku = createRoomDanmaku();
  const root = document.createElement('div');
  root.className = 'spchat';
  root.hidden = true;

  function make(tag, cls, text = '') {
    const el = document.createElement(tag);
    el.className = cls;
    el.textContent = text;
    return el;
  }

  const panel = make('section', 'spchat__panel');
  panel.setAttribute('aria-label', '同盟聊天');
  const header = make('header', 'spchat__header');
  const title = make('span', 'spchat__title', '同盟通讯');
  const fold = make('button', 'spchat__fold', '−');
  fold.type = 'button';
  fold.setAttribute('aria-label', '折叠聊天');
  const danmakuButton = make('button', 'spchat__danmaku');
  danmakuButton.type = 'button';
  Object.assign(danmakuButton.style, { color: 'inherit', background: 'transparent', border: '1px solid currentColor', fontSize: '11px', minHeight: '28px', cursor: 'pointer' });
  function updateDanmakuButton() { danmakuButton.textContent = danmaku.enabled ? '弹幕开' : '弹幕关';danmakuButton.setAttribute('aria-pressed', String(danmaku.enabled)); }
  updateDanmakuButton();
  header.append(title, danmakuButton, fold);

  const log = make('div', 'spchat__log');
  log.setAttribute('role', 'log');
  log.setAttribute('aria-live', 'polite');
  const hint = make('div', 'spchat__hint', '同盟通讯已连接');
  const form = make('form', 'spchat__form');
  const input = make('input', 'spchat__input');
  input.type = 'text';
  input.maxLength = 200;
  input.placeholder = '输入消息…';
  input.autocomplete = 'off';
  input.setAttribute('aria-label', '聊天消息');
  const sendButton = make('button', 'spchat__send', '发送');
  sendButton.type = 'submit';
  form.append(input, sendButton);
  panel.append(header, log, hint, form);

  const toggle = make('button', 'spchat__toggle');
  const unreadBadge = make('span', 'spchat__badge');
  unreadBadge.hidden = true;
  toggle.append(outlineIcon('chat'), unreadBadge);
  toggle.type = 'button';
  toggle.setAttribute('aria-label', '展开或折叠聊天');
  root.append(panel, toggle);
  document.body.append(root);
  const disposeStickers = installRoomStickers(root, input, form, message => { hint.textContent = message; });

  let identity = null, expanded = true, pending = false, inMatch = false, lastPhase = null;
  let composing = false, unread = 0, desired = null, position = null;
  let dragging = null, alive = true;
  let historyRequest = null;
  const received = new Map();
  const scroll = createChatScroll(log);
  let batchingHistory = false;
  const cleanup = [];

  function listen(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    cleanup.push(() => target.removeEventListener(type, fn, options));
  }

  function viewport() {
    const v = window.visualViewport;
    return {
      x: v?.offsetLeft || 0,
      y: v?.offsetTop || 0,
      w: v?.width || window.innerWidth,
      h: v?.height || window.innerHeight,
    };
  }

  function clamp(point, v, w, h) {
    return {
      x: Math.max(v.x + 8, Math.min(point.x, Math.max(v.x + 8, v.x + v.w - w - 8))),
      y: Math.max(v.y + 8, Math.min(point.y, Math.max(v.y + 8, v.y + v.h - h - 8))),
    };
  }

  // SPCHAT_DRAGGABLE_TOGGLE_V1
  let fabRatio = null, fabPosition = null, fabDrag = null, blockClickUntil = 0;
  try {
    const saved = JSON.parse(localStorage.getItem('sp.chat.toggle.position.v1'));
    if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y) &&
        saved.x >= 0 && saved.x <= 1 && saved.y >= 0 && saved.y <= 1)
      fabRatio = saved;
  } catch {}

  // 局内避让左下角的「交流」轮盘：它就在 .gm__corner 里（left/bottom 各 .24rem，
  // plugins/mota/client/css/screens/game.css:708），按钮高 .56rem，展开面板从按钮左上角再向左 .15rem、
  // 向上 .02rem + 2.31rem 溢出（public/css/emotes.css:50-57）。这里量它的实际盒子，不写死像素：
  // 根字号会随 HUD 缩放变（1rem = 100 设计 px），写死 px 换个屏幕就不准了。
  function wheelGuard() {
    const wheel = document.querySelector('.gm__corner .ewheel') || document.querySelector('.ewheel');
    const corner = wheel?.closest('.gm__corner') || wheel;
    if (!corner) return null;
    const box = corner.getBoundingClientRect();
    if (!box.width || !box.height) return null;   // 还没布局出来（HUD 未挂上/被隐藏）：算没量到，交给 settleLayout 的限时重试 + HUD 观察器
    const btn = (wheel || corner).getBoundingClientRect();
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    return {
      left: Math.min(box.left, btn.left - 0.15 * rem),
      right: Math.max(box.right, btn.left + 2.98 * rem),   // 面板 3.13rem 宽，左移 .15rem 后的右边界
      top: Math.min(box.top, btn.top - 2.33 * rem),        // .02rem 间隙 + 2.31rem 面板高
      bottom: box.bottom,
    };
  }

  const guardKey = g => `${Math.round(g.left)},${Math.round(g.top)},${Math.round(g.right)},${Math.round(g.bottom)}`;
  let measuredGuardKey = '';   // 上一次 layout() 用到的「真实量到」的轮盘盒子（观察器据此判断是否要重排）

  // 轮盘还没挂进 DOM（HUD 晚于 room.state、或在挂载窗口期被隐藏）时的保底禁区，按 CSS 常量估：
  //   高：底距 .24rem + 面板 2.31rem（粗指针下 scale:1.3，public/css/devices.css:95）+ .56rem 按钮 + .02rem 间隙 ≈ 3.3rem，
  //       窄屏 wrap-reverse 折行（public/css/devices.css:128）最多再叠两行 .56rem + 间隙，仍在 3.4rem 之内。
  //   宽：交流按钮最小 1.51rem + 最多 4 个 .gm__gear 各 .56rem + 4 个 .1rem 间隙 ≈ 4.15rem（public/css/emotes.css:19-25、
  //       public/css/screens/game.css:624-628）；角区还可能再多一个「肉鸽」/配装按钮，所以这里只当「别停在这块」的下界，
  //       真正的落点用高度判定（抬到禁区上方），与角区实际宽度无关。
  // 只用于「量不到」的那段窗口：宁可把左侧下沿整块让出去，也不能像旧默认落点那样正好落在「交流」按钮上。
  const WHEEL_ZONE_W_REM = 4.15, WHEEL_ZONE_H_REM = 3.4;
  function estimatedWheelGuard(v) {
    const rem = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
    const bottom = v.y + v.h - 0.24 * rem;
    const left = v.x + 0.24 * rem - 0.15 * rem;
    return { left, right: left + WHEEL_ZONE_W_REM * rem, top: bottom - WHEEL_ZONE_H_REM * rem, bottom };
  }

  function hits(guard, x, y, w, h) {
    return x < guard.right + 8 && x + w > guard.left - 8 &&
      y < guard.bottom + 8 && y + h > guard.top - 8;
  }

  function layout() {
    if (!alive || !identity) return;
    const v = viewport();
    const w = Math.max(1, Math.min(230, v.w - 16));
    const h = Math.max(1, Math.min(220, v.h - 16));
    const sx = Math.max(0, v.w - 52), sy = Math.max(0, v.h - 52);
    const measured = inMatch ? wheelGuard() : null;
    measuredGuardKey = measured ? guardKey(measured) : '';
    // 局内量不到真实盒子时用估算禁区顶替（默认落点因此不会再压在左下角）。
    const guard = measured || (inMatch ? estimatedWheelGuard(v) : null);
    let fabHome = fabRatio
      ? { x: v.x + 8 + fabRatio.x * sx, y: v.y + 8 + fabRatio.y * sy }
      : { x: v.x + 16, y: v.y + v.h - 52 };
    if (guard && hits(guard, fabHome.x, fabHome.y, 36, 36))
      // 轮盘展开盒右侧放得下就横移过去（默认落点正好压在「交流」按钮上），放不下就叠到它上方；
      // 量不到真实盒子时一律抬到估算禁区上方（横向判定依赖角区宽度，估算给不出上界）。
      fabHome = measured && guard.right + 44 <= v.x + v.w - 8
        ? { x: guard.right + 8, y: v.y + v.h - 52 }
        : { x: guard.left, y: guard.top - 44 };
    fabPosition = clamp(fabHome, v, 36, 36);
    Object.assign(toggle.style, {
      left: fabPosition.x + 'px', top: fabPosition.y + 'px',
    });
    let initial = { x: v.x + 16, y: v.y + v.h - h - 170 };   // 抬高：不压住左下角的「交流」按钮（面板可拖）
    if (measured) {
      // 局内：整块面板放到轮盘展开盒的右侧（纵向沿用抬高的落点），右侧放不下就放到它上方。
      initial = measured.right + 8 + w <= v.x + v.w - 8
        ? { x: measured.right + 8, y: Math.max(v.y + 8, v.y + v.h - h - 170) }
        : { x: Math.max(v.x + 8, measured.left), y: measured.top - 8 - h };
    } else if (guard) {
      // 量不到轮盘：面板也抬到估算禁区上方，不与角区抢位置。
      initial = { x: v.x + 16, y: Math.max(v.y + 8, guard.top - 8 - h) };
    } else if (fabRatio) {
      initial = { x: fabPosition.x + 44, y: fabPosition.y - h + 36 };
      if (initial.x + w > v.x + v.w - 8)
        initial.x = fabPosition.x - w - 8;
    }
    const target = desired || initial;
    position = clamp(guard && desired && hits(guard, desired.x, desired.y, w, h) ? initial : target, v, w, h);
    Object.assign(panel.style, {
      left: position.x + 'px', top: position.y + 'px',
      width: w + 'px', height: h + 'px',
    });
  }

  // 局内 HUD（.gm__corner 里的「交流」轮盘）由 Preact 在 room.state 之后才挂进 DOM。旧做法是「补 30 帧（约 .5s）」，
  // HUD 晚到就没有第二次重排机会：线上实测 1600×900 时聊天浮标停在默认落点 {x:16, y:h-52}，与轮盘按钮 (20,834)
  // 完全重合，浮标中心 (34,866) 的顶层元素就是 toggle 自己，点击被吃掉。现在双保险：
  //   ① MutationObserver 盯 body 子树里 .gm__corner / .ewheel 的增删（只在局内挂），HUD 一出现或角区内部变化就在下一帧重排；
  //   ② 限时重试兜底：观察不到的变化（盒子先以 0 尺寸存在、靠 class 切换显示）用 16→250ms 退避追，总时限 8s，量到立即停。
  // 不用 setInterval：观察器负责「出现即重排」，退避链只在量不到的那段窗口里跑，量到就彻底收工。
  const GUARD_DEADLINE_MS = 8000;
  let guardTimer = 0, guardStartedAt = 0, guardDelay = 0;
  let hudObserver = null, hudRaf = 0;

  function guardMissing() { return inMatch && !wheelGuard(); }

  function stopGuardRetry() { clearTimeout(guardTimer); guardTimer = 0; }

  function retryGuard() {
    guardTimer = 0;
    if (!alive || !identity || !inMatch) return;
    layout();                                  // 重试本身就是重排（HUD 可能刚好挂上）
    if (!guardMissing()) return;
    if (performance.now() - guardStartedAt >= GUARD_DEADLINE_MS) return;
    guardDelay = guardDelay ? Math.min(guardDelay * 2, 250) : 16;
    guardTimer = setTimeout(retryGuard, guardDelay);
  }

  function settleLayout() {
    if (!alive) return;
    stopGuardRetry();
    layout();
    if (!guardMissing()) return;
    guardStartedAt = performance.now();
    guardDelay = 0;
    guardTimer = setTimeout(retryGuard, 16);
  }

  // 只认「HUD 角区」的变化：`.gm__corner` 整体增删（HUD 挂上 / 拆掉）、角区内部子节点增删（齿轮按钮增减会改变换行与尺寸）、
  // `.ewheel` 自身增删。其它 body 子树变化（战斗 HUD 每帧重绘）一概不计，避免重排风暴。
  function hudTouched(records) {
    const relevant = node => node.nodeType === 1 &&
      (node.matches?.('.gm__corner, .ewheel') || node.querySelector?.('.gm__corner, .ewheel'));
    for (const record of records) {
      if (record.target?.nodeType === 1 && record.target.closest?.('.gm__corner')) return true;
      for (const node of record.addedNodes) if (relevant(node)) return true;
      for (const node of record.removedNodes) if (relevant(node)) return true;
    }
    return false;
  }

  function scheduleHudCheck() {
    if (hudRaf || !alive) return;
    hudRaf = requestAnimationFrame(() => {
      hudRaf = 0;
      if (!alive || !identity || !inMatch) return;
      const measured = wheelGuard();
      if ((measured ? guardKey(measured) : '') === measuredGuardKey) return;   // 轮盘没出现 / 没动：不重排
      layout();
    });
  }

  function observeHud(on) {
    if (!on || typeof MutationObserver !== 'function') {
      if (hudObserver) { hudObserver.disconnect(); hudObserver = null; }
      cancelAnimationFrame(hudRaf); hudRaf = 0;
      return;
    }
    if (hudObserver) return;
    hudObserver = new MutationObserver(records => { if (hudTouched(records)) scheduleHudCheck(); });
    hudObserver.observe(document.body, { childList: true, subtree: true });
  }

  function controls() {
    input.disabled = !identity || net.status !== 'online';
    sendButton.disabled = pending || input.disabled;
    hint.textContent = net.status === 'online' ? '同盟通讯已连接' : '等待连接恢复…';
  }

  function requestHistory() {
    if (!identity || net.status !== 'online' || historyRequest) return;
    const key = { ...identity };
    const request = net.request('room.chat.history', { code: key.code });
    historyRequest = request;
    request.catch(() => {}).finally(() => {
      if (historyRequest === request) historyRequest = null;
    });
  }

  function open(value) {
    expanded = value;
    panel.hidden = !value;
    toggle.setAttribute('aria-expanded', String(value));
    if (value) {
      unread = 0;
      unreadBadge.hidden = true;
      scroll.bottom();
    } else input.blur();
    layout();
  }

  function sync() {
    const state = store.get();
    const room = state.room;
    const playerId = state.me?.playerId;
    const seat = room?.seats?.find(s => s?.playerId === playerId);
    const spectator = room?.spectators?.find(s => s?.playerId === playerId);
    const member = (seat && !seat.isBot && !seat.left) || spectator;
    // 相位来自比赛推送（m.public.phase）；房间状态本身不带 phase，插件若通过 ext.state 平铺了同名键也认。
    const phase = state.match?.public?.phase || room?.phase || null;
    const phaseChanged = phase !== lastPhase;
    lastPhase = phase;
    // 身份在局内也保留（弹幕要照常收）；房间聊天是「房间级」能力（服务端 plugins/room-chat/server/lobby.js 不按模式过滤）。
    // 2026-11-05 去掉 mode 白名单：原先只放行 coop / versus，`mode:'rogue'` 的肉鸽房整个 root 常驻 hidden（线上实测
    // BSKR 房 PREP 阶段 chat rect 0×0、data-in-match="0"），将来新增的房型也会同样哑掉。只要「已进入 + 在房里 + 有座位」即可。
    // `member` 仍保留：不在座位的旁观第三人没有身份（服务端也按座位校验 sender），`entered` 判断同样保留。
    const next = state.session?.entered && room && playerId && member
      ? { code: room.code, playerId } : null;
    const match = !!(next && room.inMatch === true);

    if (next?.code === identity?.code && next?.playerId === identity?.playerId) {
      // 同一间房进出局内（身份不变）也要重新定位：局内要避让左下角「交流」轮盘。
      if (match !== inMatch) {
        inMatch = match;
        root.dataset.inMatch = match ? '1' : '0';
        desired = null;
        dragging = null;
        observeHud(match);
        settleLayout();
      } else if (inMatch && phaseChanged) {
        // 相位切换（如 ROUND_START → PREP）会重挂局内 HUD 角区，轮盘可能整体换节点：再排一次。
        settleLayout();
      }
      return;
    }

    identity = next;
    inMatch = match;
    root.dataset.inMatch = match ? '1' : '0';
    // 局内不再藏面板（原先 `|| room.inMatch === true` 把整个 root 连悬浮按钮一起藏了，玩家以为聊天没了）。
    // 现在靠 layout() 按「交流」轮盘的实测盒子把面板 / 悬浮按钮挪到它右侧（放不下则挪到上方），
    // 容器只做命中避让（.spchat pointer-events: none，见 room-chat.css），不再靠隐藏躲避点击冲突。
    root.hidden = !next;
    received.clear();
    danmaku.clear();
    historyRequest = null;
    for (const row of log.children) scroll.unwatch(row);
    log.replaceChildren(); scroll.bottom();
    input.value = '';
    desired = null;
    dragging = null;
    title.textContent = next ? `同盟通讯 · ${next.code}` : '同盟通讯';
    controls();
    open(true);
    requestHistory();
    observeHud(inMatch);
    if (inMatch) settleLayout();
    else stopGuardRetry();
  }

  function receive(msg, historical = false) {
    if (!identity || msg.code !== identity.code ||
        typeof msg.playerId !== 'string' || typeof msg.name !== 'string' ||
        typeof msg.text !== 'string' || msg.text.length > 200 ||
        !Number.isFinite(msg.time)) return;

    const key = Number.isSafeInteger(msg.id) ? msg.id : `${msg.playerId}:${msg.time}:${msg.text}`;
    if (received.has(key)) return;
    received.set(key, msg);
    while (received.size > 80) received.delete(received.keys().next().value);

    const mine = msg.playerId === identity.playerId;
    if (!historical) {
      showBattleSticker(msg).catch(() => {});
      const stickerId = /^\[表情:(s\d{2,4})\]$/.exec(msg.text || '')?.[1];
      if (stickerId) stickerManifest().then(m => { const media = stickerImage(stickerId, m); danmaku.show(media ? { ...msg, media } : { ...msg, text: '发送了表情' }, mine); }).catch(() => danmaku.show({ ...msg, text: '发送了表情' }, mine));
      else danmaku.show(msg, mine);
    }
    const anchor = batchingHistory ? null : scroll.snapshot();
    const row = make('div', `spchat__row${mine ? ' spchat__row--mine' : ''}`);
    row.dataset.chatKey = String(key);
    const time = new Date(msg.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    row.append(
      decorateOwnerName(make('div', 'spchat__name'), msg.name, ` · ${time}`),
      make('div', 'spchat__bubble', msg.text),
    );
    log.append(row);
    scroll.watch(row);
    while (log.childElementCount > 80) { scroll.unwatch(log.firstElementChild); log.firstElementChild.remove(); }
    if (anchor) scroll.restore(anchor, mine && !historical);
    if (!historical && !expanded && !mine) {
      unread++;
      unreadBadge.textContent = unread > 9 ? '9+' : String(unread);
      unreadBadge.hidden = false;
    }
  }

  function receiveHistory(msg) {
    if (!identity || msg.code !== identity.code || !Array.isArray(msg.messages)) return;
    // A live message can arrive while the history request is in flight. Merge by server id.
    const all = [...msg.messages.slice(-80), ...received.values()].filter(m => m && typeof m === 'object')
      .sort((a, b) => (a.id || 0) - (b.id || 0) || a.time - b.time);
    const anchor = scroll.snapshot();
    received.clear();
    for (const row of log.children) scroll.unwatch(row);
    log.replaceChildren(); batchingHistory = true;
    try { for (const message of all) receive(message, true); }
    finally { batchingHistory = false; scroll.restore(anchor); }
  }

  async function send(event) {
    event.preventDefault();
    if (!identity || pending || net.status !== 'online') return;
    composing = false; // A button submit is valid even if the IME omitted compositionend.
    const original = input.value;
    const text = original.trim();
    if (!text || text.length > 200) return;
    const key = { ...identity };
    pending = true;
    controls();
    try {
      await net.request('room.chat', { code: key.code, text });
      if (alive && identity?.code === key.code && identity?.playerId === key.playerId &&
          input.value === original) input.value = '';
    } catch (error) {
      if (alive && identity?.code === key.code)
        hint.textContent = error.message || '发送失败，请重试';
    } finally {
      pending = false;
      if (alive) {
        input.disabled = !identity || net.status !== 'online';
        sendButton.disabled = input.disabled;
      }
    }
  }

  listen(form, 'submit', send);
  listen(input, 'compositionstart', () => { composing = true; });
  listen(input, 'compositionend', () => { composing = false; });
  // Some mobile keyboards omit compositionend when closed or when the input loses focus.
  // Keep the battlefield backing canvas stable while the keyboard animates; only the chat
  // panel follows visualViewport, avoiding repeated WebGL buffer clears/reprojections.
  let frozenField = null, fieldStyles = null, restoreFieldTimer = 0;
  function restoreField() {
    clearTimeout(restoreFieldTimer);
    if (frozenField && fieldStyles) {
      for (const [name, value, priority] of fieldStyles) {
        if (value) frozenField.style.setProperty(name, value, priority);
        else frozenField.style.removeProperty(name);
      }
    }
    frozenField = fieldStyles = null;
  }
  listen(input, 'focus', () => {
    composing = false;
    clearTimeout(restoreFieldTimer);
    if (frozenField || !matchMedia('(any-pointer: coarse)').matches) return;
    const field = document.querySelector('.gm__field');
    if (!field || !field.clientWidth || !field.clientHeight) return;
    fieldStyles = ['width', 'height'].map(name => [name, field.style.getPropertyValue(name), field.style.getPropertyPriority(name)]);
    const { width, height } = field.getBoundingClientRect();
    frozenField = field;
    field.style.setProperty('width', width + 'px', 'important');
    field.style.setProperty('height', height + 'px', 'important');
  });
  listen(input, 'blur', () => {
    composing = false;
    clearTimeout(restoreFieldTimer);
    restoreFieldTimer = setTimeout(restoreField, 500);
  });
  listen(window, 'orientationchange', restoreField);
  cleanup.push(restoreField);

  listen(input, 'keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      open(false);
      return;
    }
    if (event.key === 'Enter' && !event.isComposing && event.keyCode !== 229 && !composing) {
      event.preventDefault();
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    }
  });
  listen(toggle, 'click', event => {
    const pointerClick = event.detail > 0 || !!event.pointerType;
    if (pointerClick && performance.now() < blockClickUntil) {
      event.preventDefault();
      blockClickUntil = 0;
      return;
    }
    blockClickUntil = 0;
    open(!expanded);
  });

  listen(toggle, 'pointerdown', event => {
    if (!event.isPrimary || event.button !== 0 || !fabPosition) return;
    blockClickUntil = 0;
    fabDrag = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      start: { ...fabPosition }, moved: false,
    };
    toggle.setPointerCapture(event.pointerId);
  });

  listen(toggle, 'pointermove', event => {
    if (fabDrag?.id !== event.pointerId) return;
    const dx = event.clientX - fabDrag.x, dy = event.clientY - fabDrag.y;
    if (!fabDrag.moved && Math.hypot(dx, dy) < 6) return;
    fabDrag.moved = true;
    if (event.cancelable) event.preventDefault();
    const v = viewport();
    const p = clamp({
      x: fabDrag.start.x + dx, y: fabDrag.start.y + dy,
    }, v, 36, 36);
    fabRatio = {
      x: (p.x - v.x - 8) / Math.max(1, v.w - 52),
      y: (p.y - v.y - 8) / Math.max(1, v.h - 52),
    };
    desired = null;
    layout();
  });

  function finishFabDrag(event) {
    if (fabDrag?.id !== event.pointerId) return;
    const moved = fabDrag.moved;
    fabDrag = null;
    if (moved) {
      blockClickUntil = performance.now() + 400;
      try {
        localStorage.setItem('sp.chat.toggle.position.v1', JSON.stringify(fabRatio));
      } catch {}
    }
    if (toggle.hasPointerCapture(event.pointerId))
      toggle.releasePointerCapture(event.pointerId);
  }

  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(toggle, type, finishFabDrag);

  listen(danmakuButton, 'click', () => { danmaku.toggle();updateDanmakuButton(); });
  listen(fold, 'click', () => open(false));

  listen(header, 'pointerdown', event => {
    if ((event.target === fold || event.target === danmakuButton) || !event.isPrimary || event.button !== 0 || !position) return;
    event.preventDefault();
    dragging = {
      id: event.pointerId, x: event.clientX, y: event.clientY,
      start: { ...position },
    };
    header.setPointerCapture(event.pointerId);
  });
  listen(header, 'pointermove', event => {
    if (dragging?.id !== event.pointerId) return;
    desired = {
      x: dragging.start.x + event.clientX - dragging.x,
      y: dragging.start.y + event.clientY - dragging.y,
    };
    layout();
  });
  function finishDrag(event) {
    if (dragging?.id !== event.pointerId) return;
    dragging = null;
    desired = { ...position };
    if (header.hasPointerCapture(event.pointerId)) header.releasePointerCapture(event.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture'])
    listen(header, type, finishDrag);

  for (const type of [
    'keydown', 'keyup', 'keypress', 'pointerdown', 'pointermove',
    'pointerup', 'touchstart', 'touchmove', 'touchend', 'click', 'wheel',
  ]) listen(root, type, event => event.stopPropagation());

  listen(window, 'resize', layout);
  if (window.visualViewport) {
    listen(window.visualViewport, 'resize', layout);
    listen(window.visualViewport, 'scroll', layout);
  }
  cleanup.push(net.on('room.chat', msg => receive(msg)), net.on('room.chat.history', receiveHistory),
    net.on('status', () => { controls(); requestHistory(); }), store.subscribe(sync));
  sync();

  return () => {
    alive = false;
    stopGuardRetry();
    observeHud(false);   // 断开 MutationObserver 并取消挂起的那一帧重排
    scroll.dispose();
    for (const fn of cleanup) fn();
    disposeStickers();
    danmaku.dispose();
    root.remove();
  };
}
