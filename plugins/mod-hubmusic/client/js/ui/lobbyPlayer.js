import { h, Fragment } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute } from '../store.js';
import { render } from '../../vendor/preact.module.js';
import { platformInfo, musicTime, lyric as fetchLyric } from './musicProviders.js';

// 大厅音乐的悬浮层（mod: hubmusic）— 专辑 + 播放控件、歌词，两块都能拖动。
//
// Mounted once by ui/lobbyMusic.js into <body>, not into the lobby screen: the widgets must survive
// the lobby → room transition. They render only on the lobby / room routes; in a match the music keeps
// playing without covering the board. Positions and visibility live in localStorage.

const PLAYER_POS = 'sp.lobbyMusic.playerPos';
const LYRIC_POS = 'sp.lobbyMusic.lyricsPos';
const QUEUE_POS = 'sp.lobbyMusic.queuePos';
const MODE_LABEL = { single: '单曲循环', list: '列表循环', shuffle: '随机播放' };
const bytes = (n) => { const b = Number(n) || 0; return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB'; };
const MODE_MARK = { single: '↻', list: '≡', shuffle: '⇄' };

const LRC_STYLE_KEY = 'sp.lobbyMusic.lyricsStyle';
const LRC_FONTS = {
  game: 'inherit',
  sans: '"Microsoft YaHei", "PingFang SC", "Noto Sans SC", sans-serif',
  serif: '"Songti SC", "SimSun", "Noto Serif SC", serif',
  kai: '"KaiTi", "Kaiti SC", "STKaiti", serif',
  mono: '"Cascadia Mono", "Consolas", monospace',
};
const LRC_DEFAULTS = { width: 640, size: 26, font: 'game', active: '#ffd76a', trans: '#ffffff', next: '#9fd0ff', nextTr: '#7fa8c9', locked: false };
const lrcHex = (v, fallback) => (/^#[0-9a-f]{6}$/i.test(String(v || '')) ? v : fallback);
function readLrcStyle() {
  let raw = {};
  try { raw = JSON.parse(localStorage.getItem(LRC_STYLE_KEY) || '{}') || {}; } catch { raw = {}; }
  return {
    width: Math.min(1100, Math.max(320, Number(raw.width) || LRC_DEFAULTS.width)),
    size: Math.min(42, Math.max(16, Number(raw.size) || LRC_DEFAULTS.size)),
    font: LRC_FONTS[raw.font] ? raw.font : LRC_DEFAULTS.font,
    active: lrcHex(raw.active, LRC_DEFAULTS.active),
    trans: lrcHex(raw.trans, LRC_DEFAULTS.trans),
    next: lrcHex(raw.next, LRC_DEFAULTS.next),
    nextTr: lrcHex(raw.nextTr, LRC_DEFAULTS.nextTr),
    locked: !!raw.locked,
  };
}
function saveLrcStyle(style) {
  try { localStorage.setItem(LRC_STYLE_KEY, JSON.stringify(style)); } catch { /* private mode */ }
}

let host = null;

/** Create the fixed layer and render <Overlay> into it. Safe to call more than once. */
export function mountMusicOverlay(api) {
  if (host || typeof document === 'undefined') return;
  host = document.createElement('div');
  host.id = 'hubmusic-layer';
  host.className = 'hm-layer';
  document.body.appendChild(host);
  render(h(Overlay, { api }), host);
}

function readPos(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const p = JSON.parse(raw);
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) return p;
    }
  } catch { /* private mode / bad JSON */ }
  return fallback();
}
function writePos(key, pos) {
  try { localStorage.setItem(key, JSON.stringify({ x: Math.round(pos.x), y: Math.round(pos.y) })); } catch { /* ignore */ }
}
function clampPos(pos, w, h) {
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  const maxX = Math.max(6, vw - (w || 340) - 6);
  const maxY = Math.max(6, vh - (h || 180) - 6);
  return { x: Math.min(Math.max(6, pos.x), maxX), y: Math.min(Math.max(6, pos.y), maxY) };
}
const playerDefault = () => ({ x: 18, y: Math.max(90, (window.innerHeight || 800) - 220) });
const lyricDefault = () => ({ x: Math.max(8, ((window.innerWidth || 1200) - 640) / 2), y: 96 });
const queueDefault = () => ({ x: 18, y: Math.max(90, (window.innerHeight || 800) - 580) });

/** Drag a fixed card by its handle; the position is clamped to the viewport and kept in localStorage. */
function useDrag(key, fallback) {
  const [pos, setPos] = useState(() => clampPos(readPos(key, fallback), 360, 220));
  const [dragging, setDragging] = useState(false);
  const ref = useRef(null);
  const drag = useRef(null);
  const bind = {
    onPointerDown: (e) => {
      if (e.button !== 0) return;
      const el = e.target;
      if (el && typeof el.closest === 'function' && el.closest('button, input, a, .hm-nodrag')) return;
      if (!ref.current) return;
      const rect = ref.current.getBoundingClientRect();
      drag.current = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
      setDragging(true);
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
      e.preventDefault();
    },
    onPointerMove: (e) => {
      if (!drag.current || !ref.current) return;
      setPos(clampPos({ x: e.clientX - drag.current.dx, y: e.clientY - drag.current.dy }, ref.current.offsetWidth, ref.current.offsetHeight));
    },
    onPointerUp: (e) => {
      if (!drag.current) return;
      drag.current = null;
      setDragging(false);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
      setPos((p) => { writePos(key, p); return p; });
    },
    onPointerCancel: (e) => {
      if (!drag.current) return;
      drag.current = null;
      setDragging(false);
      try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    },
  };
  useEffect(() => {
    const onResize = () => setPos((p) => clampPos(p, ref.current ? ref.current.offsetWidth : 360, ref.current ? ref.current.offsetHeight : 220));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return { pos, ref, dragging, bind };
}

const lyricMemo = new Map();
function loadLyric(platform, id, track) {
  const key = platform + ':' + id;
  const hit = lyricMemo.get(key);
  if (hit) return hit;
  const p = fetchLyric(platform, id, { title: track.title, artist: track.artist, duration: track.duration })
    .then((lines) => { lyricMemo.set(key, Promise.resolve(lines)); return lines; })
    .catch((e) => { lyricMemo.delete(key); throw e; });
  lyricMemo.set(key, p);
  return p;
}

function Player({ api, state, time, duration }) {
  const { pos, ref, dragging, bind } = useDrag(PLAYER_POS, playerDefault);
  const info = platformInfo(state.platform);
  const dur = Number(duration) || Number(state.duration) || 0;
  const now = dur > 0 ? Math.min(time, dur) : time;
  return h('div', { ref, class: 'hm-player' + (dragging ? ' is-drag' : ''), style: 'left:' + pos.x + 'px;top:' + pos.y + 'px' },
    h('div', { class: 'hm-grab', ...bind },
      h('div', { class: 'hm-cover' }, state.cover
        ? h('img', { src: state.cover, alt: '', draggable: false, onError: (e) => { e.currentTarget.style.display = 'none'; } })
        : h('span', { 'aria-hidden': 'true' }, '♫')),
      h('div', { class: 'hm-meta' },
        h('b', { class: 'hm-title', title: state.kind === 'online' ? state.title : state.name }, state.kind === 'online' ? (state.title || '在线音乐') : (state.name || '本机音乐')),
        h('span', { class: 'hm-sub' },
          h('em', { class: 'hm-plat', style: state.kind === 'online' ? '--pc:' + info.color : '' }, state.kind === 'online' ? info.short : '本机'),
          state.kind === 'online' ? ' · ' + (state.artist || '未知歌手') : '')),
      h('button', { class: 'hm-x', title: '收起播放器', 'aria-label': '收起播放器', onClick: () => api.setPlayerOpen(false) }, '✕')),
    h('div', { class: 'hm-progress' },
      h('span', { class: 'hm-time' }, musicTime(now)),
      h('input', {
        type: 'range', min: 0, max: Math.max(1, Math.round(dur * 10)), step: 1, value: Math.round(now * 10),
        class: 'hm-range', 'aria-label': '播放进度',
        onInput: (e) => api.seek(Number(e.currentTarget.value) / 10),
      }),
      h('span', { class: 'hm-time' }, musicTime(dur))),
    h('div', { class: 'hm-controls' },
      h('button', { class: 'hm-btn', title: '上一首', 'aria-label': '上一首', disabled: state.queueLength < 2, onClick: () => api.prev() }, '«'),
      h('button', { class: 'hm-btn', title: '快退 10 秒', 'aria-label': '快退 10 秒', onClick: () => api.seek(Math.max(0, now - 10)) }, '−10'),
      h('button', { class: 'hm-btn hm-play', title: state.playing ? '暂停' : '播放', 'aria-label': state.playing ? '暂停' : '播放', onClick: () => api.toggle() }, state.playing ? '❚❚' : '▶'),
      h('button', { class: 'hm-btn', title: '快进 10 秒', 'aria-label': '快进 10 秒', onClick: () => api.seek(now + 10) }, '+10'),
      h('button', { class: 'hm-btn', title: '下一首', 'aria-label': '下一首', disabled: state.queueLength < 2, onClick: () => api.next() }, '»'),
      h('button', { class: 'hm-btn' + (state.queueOpen ? ' is-on' : ''), title: '播放列表', 'aria-label': '播放列表', onClick: () => api.setQueueOpen(!state.queueOpen) }, '队列'),
      h('button', { class: 'hm-btn' + (state.lyricsOpen ? ' is-on' : ''), title: '歌词', 'aria-label': '歌词', onClick: () => api.setLyricsOpen(!state.lyricsOpen) }, '词'),
      h('button', { class: 'hm-btn', title: MODE_LABEL[state.mode], 'aria-label': '播放方式：' + MODE_LABEL[state.mode], onClick: () => api.cycleMode() }, MODE_MARK[state.mode]),
      h('button', { class: 'hm-btn', title: state.muted ? '取消静音' : '静音', 'aria-label': state.muted ? '取消静音' : '静音', onClick: () => api.toggleMuted() }, state.muted ? '静' : '♪'),
      h('input', {
        type: 'range', min: 0, max: 100, step: 1, value: Math.round((state.muted ? 0 : state.volume) * 100),
        class: 'hm-vol', 'aria-label': '音乐音量',
        onInput: (e) => api.setVolume(Number(e.currentTarget.value) / 100),
      })),
    state.onlineError ? h('div', { class: 'hm-error' }, state.onlineError) : null);
}

function Lyrics({ api, state, lines, loading, error, activeLine }) {
  const { pos, ref, dragging, bind } = useDrag(LYRIC_POS, lyricDefault);
  const [style, setStyle] = useState(readLrcStyle);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const patch = (p) => {
    setStyle((oldStyle) => {
      const next = { ...oldStyle, ...p };
      saveLrcStyle(next);
      return next;
    });
  };
  const font = LRC_FONTS[style.font] || 'inherit';
  const size = Number(style.size) || LRC_DEFAULTS.size;
  const width = Math.round(Number(style.width) || LRC_DEFAULTS.width);
  const maxWidth = Math.max(320, Math.min(1100, (window.innerWidth || 1280) - pos.x - 16));
  const setWidth = (v) => patch({ width: Math.round(Math.max(320, Math.min(maxWidth, Number(v) || LRC_DEFAULTS.width))) });
  const startResize = (e) => {
    if (style.locked) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = width;
    const move = (ev) => setWidth(startW + ev.clientX - startX);
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const resetStyle = () => {
    const next = { ...LRC_DEFAULTS };
    setStyle(next);
    saveLrcStyle(next);
  };
  const empty = state.kind !== 'online' ? '本机音乐没有内嵌歌词' : error || (loading ? '歌词加载中…' : '这首歌暂时没有歌词');
  const idx = activeLine >= 0 ? activeLine : (lines.length ? 0 : -1);
  const active = idx >= 0 ? lines[idx] : null;
  const next = idx >= 0 ? lines[idx + 1] : null;
  const showTr = state.transOpen !== false;
  const activeTr = showTr && active?.tr ? active.tr : '';
  const nextTr = showTr && next?.tr ? next.tr : '';
  const seek = (line) => { if (line) api.seek(line.t + 0.02); };
  const colorRow = (label, key) => h('label', { class: 'hm-lrc-field' },
    h('span', null, label),
    h('input', { type: 'color', value: style[key], onInput: (e) => patch({ [key]: e.currentTarget.value }) }));
  return h('div', {
    ref,
    class: 'hm-lyrics' + (dragging ? ' is-drag' : '') + (settingsOpen ? ' is-open' : '') + (style.locked ? ' is-locked' : ''),
    style: 'left:' + pos.x + 'px;top:' + pos.y + 'px;width:' + width + 'px;max-width:calc(100vw - ' + (pos.x + 8) + 'px)',
  },
  style.locked ? null : h('div', { class: 'hm-lrc-grip', ...bind, title: '拖动歌词' }, h('span', { 'aria-hidden': 'true' }, '⠿')),
  h('div', { class: 'hm-lrc-tools' },
    h('button', { class: 'hm-lrc-tool' + (style.locked ? ' is-on' : ''), title: style.locked ? '解锁歌词位置和大小' : '锁定歌词位置和大小', onClick: () => patch({ locked: !style.locked }) }, '锁'),
    h('button', { class: 'hm-lrc-tool' + (settingsOpen ? ' is-on' : ''), title: '歌词设置', onClick: () => setSettingsOpen((v) => !v) }, '⚙'),
    h('button', {
      class: 'hm-lrc-tool' + (showTr ? ' is-on' : ''), title: showTr ? '隐藏翻译' : '显示翻译', 'aria-label': showTr ? '隐藏翻译' : '显示翻译',
      onClick: () => api.setTransOpen(!showTr),
    }, '译'),
    h('button', { class: 'hm-lrc-tool', title: '关闭歌词', 'aria-label': '关闭歌词', onClick: () => api.setLyricsOpen(false) }, '✕')),
  settingsOpen ? h('div', {
    class: 'hm-lrc-settings',
    style: (pos.y > (window.innerHeight || 800) / 2 ? 'bottom:calc(100% + 6px);top:auto;' : 'top:calc(100% + 6px);') + 'right:0',
  },
    h('strong', null, '歌词样式'),
    colorRow('主句', 'active'),
    colorRow('译文', 'trans'),
    colorRow('下句', 'next'),
    colorRow('下句译文', 'nextTr'),
    h('label', { class: 'hm-lrc-field' }, h('span', null, '字体'),
      h('select', { value: style.font, onChange: (e) => patch({ font: e.currentTarget.value }) },
        h('option', { value: 'game' }, '游戏默认'),
        h('option', { value: 'sans' }, '黑体'),
        h('option', { value: 'serif' }, '宋体'),
        h('option', { value: 'kai' }, '楷体'),
        h('option', { value: 'mono' }, '等宽'))),
    h('label', { class: 'hm-lrc-field hm-lrc-range' }, h('span', null, '字号'),
      h('input', { type: 'range', min: 16, max: 42, step: 1, value: style.size, onInput: (e) => patch({ size: Number(e.currentTarget.value) }) }),
      h('em', null, style.size + 'px')),
    h('label', { class: 'hm-lrc-field hm-lrc-range' }, h('span', null, '宽度'),
      h('input', { type: 'range', min: 320, max: maxWidth, step: 20, value: width, disabled: style.locked, onInput: (e) => setWidth(e.currentTarget.value) }),
      h('em', null, width + 'px')),
    h('button', { class: 'hm-btn', onClick: resetStyle }, '恢复默认')) : null,
  !style.locked ? h('div', { class: 'hm-lrc-resize', title: '拖动调整宽度', onPointerDown: startResize }) : null,
  active
    ? h('div', { class: 'hm-lrc' },
      h('p', {
        class: 'hm-lrc-on' + (activeLine < 0 ? ' is-idle' : ''), style: { color: style.active, fontFamily: font, fontSize: size + 'px' },
        onClick: () => seek(active),
      }, active.text),
      activeTr ? h('p', {
        class: 'hm-lrc-tr', style: { color: style.trans, fontFamily: font, fontSize: Math.round(size * 0.62) + 'px' },
        onClick: () => seek(active),
      }, activeTr) : null,
      next ? h('p', {
        class: 'hm-lrc-next', style: { color: style.next, fontFamily: font, fontSize: Math.round(size * 0.7) + 'px' },
        onClick: () => seek(next),
      }, next.text) : null,
      nextTr ? h('p', {
        class: 'hm-lrc-nexttr', style: { color: style.nextTr, fontFamily: font, fontSize: Math.round(size * 0.5) + 'px' },
        onClick: () => seek(next),
      }, nextTr) : null)
    : h('p', { class: 'hm-lrc-empty', style: { fontFamily: font } }, empty));
}

function Queue({ api, state }) {
  const { pos, ref, dragging, bind } = useDrag(QUEUE_POS, queueDefault);
  const items = api.queueItems ? api.queueItems() : [];
  const listRef = useRef(null);
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const el = list.querySelector('.hm-qrow.is-on');
    if (!el) return;
    try { list.scrollTo({ top: el.offsetTop - list.clientHeight / 2 + el.offsetHeight / 2, behavior: 'smooth' }); } catch { /* older browser */ }
  }, [state.id, state.queueLength, state.queueOpen]);
  return h('div', { ref, class: 'hm-queue' + (dragging ? ' is-drag' : ''), style: 'left:' + pos.x + 'px;top:' + pos.y + 'px' },
    h('div', { class: 'hm-lyrics__bar', ...bind },
      h('b', null, '播放列表'),
      h('span', { class: 'hm-lyrics__title' }, items.length ? items.length + ' 首' : '空'),
      h('button', { class: 'hm-x', title: '关闭播放列表', 'aria-label': '关闭播放列表', onClick: () => api.setQueueOpen(false) }, '✕')),
    h('div', { class: 'hm-queue__list', ref: listRef },
      items.length
        ? items.map((it) => h('div', { key: it.key + ':' + it.index, class: 'hm-qrow' + (it.current ? ' is-on' : '') },
          h('button', { class: 'hm-qplay', title: '播放这首', onClick: () => api.playAt(it.index) },
            h('span', { class: 'hm-qtitle' }, it.title),
            h('span', { class: 'hm-qsub' }, it.kind === 'local' ? '本机 · ' + bytes(it.size) : platformInfo(it.platform).short + ' · ' + (it.artist || '未知歌手'))),
          h('span', { class: 'hm-qacts' },
            h('button', { title: '上移', 'aria-label': '上移', disabled: it.index === 0, onClick: () => api.moveAt(it.index, -1) }, '↑'),
            h('button', { title: '下移', 'aria-label': '下移', disabled: it.index === items.length - 1, onClick: () => api.moveAt(it.index, 1) }, '↓'),
            h('button', { title: it.current ? '正在播放的曲目不能移除' : '从播放列表移除', 'aria-label': '移除', disabled: it.current, onClick: () => api.removeAt(it.index) }, '✕'))))
        : h('p', { class: 'hm-empty', style: 'padding:12px 14px' }, '播放列表是空的。搜索、导入歌单或扫描目录后，整个队列会出现在这里。')),
    h('div', { class: 'hm-queue__foot' },
      h('span', null, '点一首直接播放；↑↓ 调整顺序'),
      h('button', { class: 'hm-btn', disabled: !items.length, onClick: () => api.clearQueue() }, '清空')));
}

function Overlay({ api }) {
  const [state, setState] = useState(() => api.snapshot());
  const [route, setRoute] = useState(() => selectRoute(store.get()));
  const [time, setTime] = useState(0);
  const [lyric, setLyric] = useState({ lines: [], loading: false, error: '', key: '' });
  useEffect(() => {
    const off = api.subscribe(setState);
    const offStore = store.subscribe((s) => setRoute(selectRoute(s)));
    return () => { off(); offStore(); };
  }, []);
  useEffect(() => {
    const id = setInterval(() => { setTime(api.playback().time); }, 250);
    return () => clearInterval(id);
  }, []);
  useEffect(() => {
    const key = state.kind === 'online' && state.id ? state.platform + ':' + state.id : '';
    if (!key) { setLyric({ lines: [], loading: false, error: '', key: '' }); return undefined; }
    let dead = false;
    setLyric((l) => ({ lines: l.key === key ? l.lines : [], loading: true, error: '', key }));
    loadLyric(state.platform, state.id, state).then((lines) => {
      if (!dead) setLyric({ lines, loading: false, error: '', key });
    }).catch((e) => {
      if (!dead) setLyric({ lines: [], loading: false, error: e.message || '取不到歌词', key });
    });
    return () => { dead = true; };
  }, [state.kind, state.platform, state.id]);

  const routeOk = route === 'lobby' || route === 'room';
  if (!routeOk || state.kind === 'default') return null;
  const lines = state.kind === 'online' ? lyric.lines : [];
  let activeLine = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].t <= time + 0.15) activeLine = i;
    else break;
  }
  const playback = api.playback();
  return h(Fragment, null,
    state.playerOpen ? h(Player, { api, state, time, duration: playback.duration }) : null,
    state.lyricsOpen ? h(Lyrics, { api, state, lines, loading: lyric.loading, error: lyric.error, activeLine }) : null,
    state.queueOpen ? h(Queue, { api, state }) : null);
}
