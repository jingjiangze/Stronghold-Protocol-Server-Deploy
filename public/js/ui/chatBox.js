// public/js/ui/chatBox.js — 局内文字聊天 (room.chat, shared/protocol.js · plugins/room-chat/server/lobby.js `chat`):
// the log, the input and the trigger button of the room's text channel.
//
// The server broadcasts every line to the whole room (its lobby and its running match alike, players and spectators
// both) and stores nothing beyond the room's own tail, so this component keeps the tail of what it has seen (a ring
// buffer of CHAT_KEEP, fed by net 'room.chat' / 'room.chat.history') — a client that joins later sees only the lines it
// asks the history for. Every string here goes through t() (public/i18n/en.json carries the translations;
// test/i18n.test.js fails on an unwrapped Han literal).
//
// Two ways in, matching the two places it can mount (screens/room.js, screens/game.js):
//   controlled  (`active` given) — the parent owns the open state; the caller draws its own trigger (the game HUD's
//               corner 对话唤出 key, data-testid="hud-chat"), so no trigger button is rendered here;
//   uncontrolled (`active` undefined) — the panel carries its own trigger and its own state (the room screen).
// Two visible states: 收起 (`is-collapsed`) = 只留约三条日志的窄框，常显、点穿到棋盘；展开 (`is-active`) =
// 标题栏 + 最多五条日志 + 发言框，底边不动、**向上展开**。角落的「对话唤出」键就是这两态之间的开关。
// `hidden` 是第三个、临时的态：**打开表情盘挑表情时整块让开**（否则表情盘会压在聊天框上），表情盘一关就回到原来的态。
// Esc closes the input. Enter does NOT open the panel (the corner key is the one trigger — a bare Enter used to race the
// facing wheel's confirm); inside the input Enter submits. A line that cannot reach the server (offline / a single-player
// dev page) is echoed locally instead of vanishing, so the log still works without a room.
// Styles: plugins/room-chat/client/css/room-chat.css (`chatbox` 段, injected on first use when the page does not link it).

import { html } from './components.js';
import { useState, useEffect, useRef } from '../../vendor/hooks.module.js';
import { net } from '../net.js';
import { store } from '../store.js';
import { toast } from './toasts.js';
import { t } from '../../../shared/i18n.js';

/** Seat colours, one per player seat (the spectator gets its own class). */
const SEAT_CLASS = Object.freeze(['seat-0', 'seat-1', 'seat-2', 'seat-3']);
/** Lines kept in the log (the panel shows the last few; older ones scroll away). */
const CHAT_KEEP = 60;
const CHAT_CSS_HREF = '/css/room-chat.css';

/** Link public/css/room-chat.css once when the host page does not (the room-chat plugin's own mount does it too). */
function ensureChatCss() {
  if (typeof document === 'undefined' || !document.head) return;
  if (document.querySelector(`link[href="${CHAT_CSS_HREF}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = CHAT_CSS_HREF;
  document.head.append(link);
}

/** The room code the chat belongs to (null outside a room). */
const roomCode = () => {
  const code = store.get().room?.code;
  return typeof code === 'string' && code ? code : null;
};

/** The player's own seat in the match, else in the room's seats (0 when unknown). */
function ownSeat() {
  const state = store.get();
  const myId = state.me?.playerId;
  const players = state.match?.public?.players;
  if (Array.isArray(players)) {
    const idx = players.findIndex((p) => p && p.playerId === myId);
    if (idx >= 0) return players[idx].seat ?? idx;
  }
  const seats = state.room?.seats;
  if (Array.isArray(seats)) {
    const idx = seats.findIndex((s) => s && s.playerId === myId);
    if (idx >= 0) return seats[idx].seat ?? idx;
  }
  return 0;
}

/**
 * A wire line (`room.chat` / `room.chat.history`, plugins/room-chat/server/lobby.js sayInRoom) as the log draws it:
 * `{ key, playerId, name, seat, isSpectator, text, at }`.
 * @param {any} msg
 */
function normalize(msg) {
  const at = Number.isFinite(msg.at) ? msg.at : (Number.isFinite(msg.time) ? msg.time : Date.now());
  const seat = Number.isFinite(msg.seat) ? msg.seat : 0;
  return {
    key: Number.isSafeInteger(msg.id) ? `i${msg.id}` : `${msg.playerId || '?'}:${at}:${msg.text || ''}`,
    playerId: msg.playerId || null,
    name: typeof msg.name === 'string' ? msg.name : '',
    seat,
    isSpectator: msg.isSpectator === true,
    text: typeof msg.text === 'string' ? msg.text : '',
    at,
  };
}

/**
 * @param {{ active?: boolean, onToggle?: (v: boolean) => void, showTrigger?: boolean, hidden?: boolean }} props
 */
export function ChatBox({ active: controlledActive, onToggle, showTrigger = controlledActive === undefined, hidden = false }) {
  const [messages, setMessages] = useState([]);
  const [internalActive, setInternalActive] = useState(false);
  const active = controlledActive !== undefined ? controlledActive : internalActive;
  const setActive = onToggle || setInternalActive;
  const [draft, setDraft] = useState('');
  const [unread, setUnread] = useState(0);
  const inputRef = useRef(null);
  const logRef = useRef(null);
  const panelRef = useRef(null);
  const seenRef = useRef(0);

  useEffect(() => { ensureChatCss(); }, []);

  // The lines: the room's own channel, filtered by its code (a stale line of a room we left is not drawn).
  useEffect(() => {
    const push = (msg) => {
      if (!msg || typeof msg !== 'object' || typeof msg.text !== 'string' || !msg.text) return;
      const code = roomCode();
      if (code && typeof msg.code === 'string' && msg.code !== code) return;
      const line = normalize(msg);
      setMessages((cur) => (cur.some((m) => m.key === line.key) ? cur : [...cur, line].slice(-CHAT_KEEP)));
    };
    const offs = [
      net.on('room.chat', push),
      net.on('room.chat.history', (msg) => {
        if (Array.isArray(msg?.messages)) for (const m of msg.messages) push(m);
      }),
    ];
    // the tail of what the room already said (a client that joins mid-match sees the last lines, not only new ones)
    const code = roomCode();
    if (code && net.status === 'online') net.request('room.chat.history', { code }).catch(() => {});
    return () => { for (const off of offs) off(); };
  }, []);

  // 手机键盘：面板是 position:fixed，软键盘只会缩 visualViewport，不会动 fixed 元素的原点 —— 发言框会被键盘挡住。
  // 这里把「键盘高度」写成 --chat-kb（css/room-chat.css 的 bottom 加上它），键盘弹出时整块向上让开，收起时回 0。
  // 桌面 / 无软键盘时这个值恒为 0；room-chat.css 只在 .gm 那一份里消费它。
  useEffect(() => {
    const el = panelRef.current;
    if (!el) return undefined;
    const vv = window.visualViewport;
    const apply = () => {
      const covered = vv ? Math.max(0, window.innerHeight - (vv.height + vv.offsetTop)) : 0;
      el.style.setProperty('--chat-kb', `${Math.round(covered)}px`);
    };
    apply();
    window.addEventListener('resize', apply);
    window.addEventListener('orientationchange', apply);
    vv?.addEventListener('resize', apply);
    vv?.addEventListener('scroll', apply);
    return () => {
      window.removeEventListener('resize', apply);
      window.removeEventListener('orientationchange', apply);
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
    };
  }, []);

  // 角落块的真实高度（--gm-corner-h）：窄屏时 .gm__corner 折成两行（惊变 / 词条 / 统计多出来的键），聊天框要跟着往上抬，
  // 否则会被上面那一行键压住。面板是 fixed，量不到 .gm__corner 时退回 CSS 的 .56rem 一行键。
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver !== 'function') return undefined;
    let corner = null;
    const measure = () => {
      const next = document.querySelector('.gm__corner');
      if (next !== corner) {
        corner = next;
        observer.disconnect();
        if (corner) observer.observe(corner);
      }
      if (!corner) return;
      const h = corner.getBoundingClientRect().height;
      if (h > 0) el.style.setProperty('--gm-corner-h', `${Math.round(h)}px`);
    };
    const observer = new ResizeObserver(measure);
    measure();
    const id = setInterval(measure, 1000);   // the HUD mounts later than this panel in some phases
    return () => { observer.disconnect(); clearInterval(id); };
  }, []);

  // Keep the newest line in view.
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [messages.length]);

  // 未读数：面板关着时累计新消息，展开后清零（按钮与标题上各显示一次，最多 9+）。
  useEffect(() => {
    if (active) { seenRef.current = messages.length; setUnread(0); return; }
    setUnread(Math.max(0, messages.length - seenRef.current));
  }, [messages.length, active]);

  useEffect(() => {
    if (active) setTimeout(() => inputRef.current?.focus(), 40);
  }, [active]);

  // Escape closes; **Enter does not open** it: in a match the panel is opened by the corner's 对话唤出 key
  // (screens/game.js data-testid="hud-chat"), so a bare Enter stays with the match's own bindings (the facing wheel
  // confirms with Enter — chat used to win that race by listener order). Inside the input Enter submits the form.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && active) { setActive(false); inputRef.current?.blur(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, setActive]);

  const send = async (e) => {
    e?.preventDefault?.();
    const text = draft.trim();
    setDraft('');
    setActive(false);
    if (!text) return;
    const state = store.get();
    const me = state.me;
    const localMsg = {
      playerId: me?.playerId || 'me',
      name: me?.name || t('博士'),
      seat: ownSeat(),
      isSpectator: false,
      text,
      at: Date.now(),
    };
    const code = roomCode();
    try {
      if (net.status !== 'online' || !code) {
        // 离线 / 单人开发页：立即本地回显，否则这一行看起来「发出去了却不见了」
        setMessages((cur) => [...cur, normalize(localMsg)].slice(-CHAT_KEEP));
        return;
      }
      await net.request('room.chat', { code, text });
    } catch (err) {
      console.warn('[chat] send failed', err);
      if (err?.code === 'RATE') { toast(t('发言过于频繁，请稍候'), 'warn'); return; }
      if (net.status !== 'online' || !roomCode()) {
        setMessages((cur) => [...cur, normalize(localMsg)].slice(-CHAT_KEEP));
        return;
      }
      toast(err?.message ? t(err.message) : t('发送失败，请重试'), 'warn');
    }
  };

  const timeOf = (m) => {
    const v = Number(m?.at);
    if (!Number.isFinite(v)) return '';
    const d = new Date(v);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  // 收起 / 展开 / 选表情时让开 —— 三个都是视觉态，用类名切换（样式在 css/room-chat.css 的 `.gm .chat-panel` 段）：
  //   is-collapsed 只留约三条日志（点穿到棋盘）；is-active 是带发言框的完整面板；is-hid 是打开表情盘时的临时让开；
  //   is-empty 是「还没有任何消息」—— 空的一条窄框没有意义，不画。
  const empty = !active && messages.length === 0;
  return html`
    <div id="match-chat-panel" ref=${panelRef}
      class=${`chat-panel ${active ? 'is-active' : 'is-collapsed'} ${empty ? 'is-empty' : ''} ${hidden ? 'is-hid' : ''}`}>
      <div class="chat-header-bar">
        <span class="chat-title">
          ${unread > 0 ? html`<b class="chat-unread">${unread > 9 ? '9+' : unread}</b>` : null}
        </span>
        <span class="chat-actions">
          ${/* 收起 = 回到三条日志的窄框（与角落「对话唤出」键同一个动作）。 */ null}
          <button
            type="button"
            class="chat-collapse-btn"
            onClick=${() => setActive(false)}
            title=${t('收起')}
            aria-label=${t('收起')}
          >
            <span class="chat-collapse-icon" aria-hidden="true">▾</span>
          </button>
        </span>
      </div>
      <div class="chat-log" ref=${logRef}>
        ${messages.map((m) => {
          const seatLabel = m.isSpectator ? t('观战') : `P${(m.seat ?? 0) + 1}`;
          const colorCls = m.isSpectator ? 'seat-spec' : (SEAT_CLASS[m.seat] || '');
          return html`
            <div key=${m.key} class="chat-item">
              <span class=${`chat-seat ${colorCls}`}>[${seatLabel}]</span>
              <span class="chat-name">${m.name || t('博士')}</span>
              <span class="chat-time">${timeOf(m)}</span>
              <span class="chat-text">${m.text}</span>
            </div>
          `;
        })}
      </div>

      ${active ? html`
        <form class="chat-form" onSubmit=${send}>
          <input
            ref=${inputRef}
            type="text"
            class="chat-input"
            maxlength="200"
            placeholder=${t('输入对话 (Enter发送, Esc取消)...')}
            value=${draft}
            onInput=${(e) => setDraft(e.target.value)}
            onKeyDown=${(e) => e.stopPropagation()}
          />
          <button type="submit" class="chat-send-btn">${t('发送')}</button>
        </form>
      ` : (showTrigger ? html`
        <button type="button" class="chat-trigger-btn" title=${t('打开对话')} aria-label=${t('打开对话')}
          onClick=${() => { setActive(true); setTimeout(() => inputRef.current?.focus(), 30); }}>
          <span aria-hidden="true">💬</span>
          ${unread > 0 ? html`<b class="chat-trigger-badge">${unread > 9 ? '9+' : unread}</b>` : null}
        </button>
      ` : null)}
    </div>
  `;
}
