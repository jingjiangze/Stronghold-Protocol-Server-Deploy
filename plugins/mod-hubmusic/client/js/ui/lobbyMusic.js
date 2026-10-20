import { PHASE } from '../../../shared/constants.js';
import { h, Fragment, Button, Modal } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute } from '../store.js';
import { audio, bgmKeyFor } from '../audio.js';
import { PLATFORMS, platformInfo, coverUrl, musicTime, ping, search as searchOnline, playlist as importPlaylist, resolve as resolveOnline } from './musicProviders.js';
import { mountMusicOverlay } from './lobbyPlayer.js';

// 大厅音乐（mod: hubmusic）— 本机文件和在线平台共用同一个面板。
//
// 本机音乐：一个 ≤20MB 的音频文件存在浏览器 IndexedDB 里，blob URL 经 Web Audio 接进 bgmGain。
// 在线音乐：只保存曲目元数据（平台 / id / 歌名 / 歌手 / 封面），播放时才向 /lobby-music/resolve
// 要一个同源流地址（服务端 token，30 分钟有效），所以刷新后不需要重新选歌。
// 两条路径最后都进同一个 <audio> 和同一个 customGain → bgmGain，音量和静音完全沿用游戏设置。
export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
const listeners = new Set();
let record = null, fileUrl = null, media = null, source = null, customGain = null, revision = 0, installed = false, dbPromise;
let status = '默认大厅音乐', busy = false, lastRoute;
let videoAudible = false;
const online = { stream: '', at: 0, loading: false, error: '', failed: false, retry: false, request: 0 };
let musicGain = null;
let volume = 0.8, muted = false, mode = 'single';
let queue = [], queueIndex = -1;
let playerOpen = true, lyricsOpen = false, queueOpen = false, transOpen = true;
let focus = false, videoPausedByMusic = false;
let dirHandle = null, dirName = '';

function readPref(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : v; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, String(value)); } catch { /* private mode */ }
}
function readBool(key, fallback) { const v = readPref(key, null); return v == null ? fallback : v === '1' || v === 'true'; }
function readNumber(key, fallback) { const n = Number(readPref(key, '')); return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : fallback; }
function readMode(key, fallback) { const v = readPref(key, ''); return ['single', 'list', 'shuffle'].includes(v) ? v : fallback; }
volume = readNumber('sp.lobbyMusic.volume', 0.8);
muted = readBool('sp.lobbyMusic.muted', false);
mode = readMode('sp.lobbyMusic.mode', 'single');
playerOpen = readBool('sp.lobbyMusic.player', true);
lyricsOpen = readBool('sp.lobbyMusic.lyrics', true);
queueOpen = readBool('sp.lobbyMusic.queue', false);
transOpen = readBool('sp.lobbyMusic.trans', true);

const notify = () => listeners.forEach(fn => fn(music.snapshot()));
const inMusicArea = () => { const s=store.get(),route=selectRoute(s);return ['lobby','room'].includes(route)||(route==='game'&&[PHASE.INFO_CHECK,PHASE.BAND_DRAFT,PHASE.BATTLE_CHECK].includes(s.match?.public?.phase)); };
let fadeTarget=0,fadeTimer,handoff=false,handoffTimer;
const areaKey = () => selectRoute(store.get()) + ':' + inMusicArea();

function ensureCss() {
  if (typeof document === 'undefined' || document.querySelector('link[data-mod="hubmusic"]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = new URL('../../../css/screens/lobby-music.css', import.meta.url).href;
  link.dataset.mod = 'hubmusic';
  document.head.appendChild(link);
}
function db() {
  return dbPromise ||= new Promise((resolve, reject) => {
    const req = indexedDB.open('sp-lobby-music', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('tracks');
    req.onsuccess = () => { const result = req.result; result.onversionchange = () => result.close(); resolve(result); };
    req.onerror = () => { dbPromise = null; reject(Error('浏览器无法保存音乐，请检查可用空间')); };
  });
}
async function saved(write, value) {
  const database = await db();
  return new Promise((resolve, reject) => {
    const tx = database.transaction('tracks', write ? 'readwrite' : 'readonly'), table = tx.objectStore('tracks');
    const req = write ? value ? table.put(value, 'lobby') : table.delete('lobby') : table.get('lobby');
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = tx.onabort = () => reject(Error('音乐保存失败，可能是浏览器存储空间不足'));
  });
}
function savedDirectory(handle) {
  return db().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction('tracks', 'readwrite');
    const req = handle ? tx.objectStore('tracks').put(handle, 'dir') : tx.objectStore('tracks').delete('dir');
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(Error('目录记录保存失败'));
  }));
}
function loadDirectory() {
  return db().then((database) => new Promise((resolve, reject) => {
    const tx = database.transaction('tracks', 'readonly');
    const req = tx.objectStore('tracks').get('dir');
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(Error('目录记录读取失败'));
  }));
}
async function validate(file) {
  if (!file || file.size <= 0) throw Error('请选择有效的音频文件');
  if (file.size > MAX_MUSIC_BYTES) throw Error('音乐不能超过 20MB，请选择较小的文件');
  if (!/\.(mp3|wav|ogg|m4a|aac|flac|webm)$/i.test(file.name || '') || (file.type && !file.type.startsWith('audio/') && file.type !== 'video/webm' && file.type !== 'application/ogg')) throw Error('请选择 MP3、M4A、OGG、WAV 等音频文件');
  const objectUrl = URL.createObjectURL(file), probe = new Audio(); probe.preload = 'metadata';
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('音频读取超时，请尝试其他文件')), 10000);
      probe.onloadedmetadata = () => { clearTimeout(timer); Number.isFinite(probe.duration) && probe.duration > 0 ? resolve() : reject(Error('音频文件无效')); };
      probe.onerror = () => { clearTimeout(timer); reject(Error('浏览器无法播放该音频，请尝试 MP3 或 M4A')); };
      probe.src = objectUrl;
    });
  } finally { probe.onloadedmetadata = probe.onerror = null; probe.removeAttribute('src'); probe.load(); URL.revokeObjectURL(objectUrl); }
}
function replace(next) {
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  if (fileUrl) URL.revokeObjectURL(fileUrl);
  fileUrl = null;
  record = next || null;
  online.stream = ''; online.at = 0; online.loading = false; online.error = ''; online.failed = false; online.retry = false; ++online.request;
  if (record?.kind === 'file' && record.blob) {
    fileUrl = URL.createObjectURL(record.blob);
    if (media) media.src = fileUrl;
  }
}
function stored(next) {
  if (!next) return saved(true, null);
  if (next.kind === 'file') {
    return saved(true, { kind: 'file', blob: next.blob, name: next.name, enabled: next.enabled !== false, paused: !!next.paused });
  }
  return saved(true, {
    kind: 'online', platform: next.platform, id: next.id, title: next.title || '', artist: next.artist || '',
    album: next.album || '', cover: next.cover || '', duration: Number(next.duration) || 0,
    enabled: next.enabled !== false, paused: !!next.paused,
  });
}
function fadeCustom(on, immediate = false) {
  const target = on ? 1 : 0;
  if (target === fadeTarget && !immediate) return;
  clearTimeout(fadeTimer);fadeTarget = target;
  if (!customGain || !audio.ctx || immediate) { if (!on) media?.pause();if(customGain)customGain.gain.value=target;return; }
  const t=audio.ctx.currentTime,g=customGain.gain;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(t);
  else {g.cancelScheduledValues(t);g.setValueAtTime(g.value,t);}
  g.linearRampToValueAtTime(target,t+0.9);
  if (!on) fadeTimer=setTimeout(()=>{if(fadeTarget===0){media.pause();notify();}},1000);
}
function clearHandoff() { clearTimeout(handoffTimer);handoff=false; }
function ensureSource() {
  if (source || !media || !audio.ctx || !audio.bgmGain) return;
  try {
    source = audio.ctx.createMediaElementSource(media);
    customGain = audio.ctx.createGain();
    customGain.gain.value = 0;
    source.connect(customGain);
    musicGain = audio.ctx.createGain();
    musicGain.gain.value = muted ? 0 : volume;
    customGain.connect(musicGain);
    musicGain.connect(audio.bgmGain);
  } catch { source = null; customGain = null; }
}
function attachAudio() {
  if (!media || !record) return false;
  const want = record.kind === 'file' ? fileUrl : online.stream;
  if (!want) return false;
  if (media.getAttribute('src') !== want) {
    media.pause();
    media.src = want;
    media.load();
  }
  return true;
}
function applyVolume() {
  if (!musicGain || !audio.ctx) return;
  const g = musicGain.gain;
  if (g.setTargetAtTime) g.setTargetAtTime(muted ? 0 : volume, audio.ctx.currentTime, 0.03);
  else g.value = muted ? 0 : volume;
}
/** Duck the game's SFX / voice buses while the lobby music plays (audio.js's setLobbyMusicFocus hook). */
function setFocus(on) {
  if (focus === on) return;
  focus = on;
  try { audio.setLobbyMusicFocus?.(on); } catch { /* older target without the hook */ }
}
/** The lobby video background owns the speakers only until the music starts; pause it while we play. */
function guardVideo(pause) {
  const v = document.querySelector('.hub-bg__video');
  if (!v) return;
  if (pause) {
    if (!v.paused) {
      try { v.pause(); videoPausedByMusic = true; } catch { /* ignore */ }
    }
    return;
  }
  if (!videoPausedByMusic) return;
  videoPausedByMusic = false;
  if (selectRoute(store.get()) === 'lobby') {
    try { const p = v.play(); if (p && typeof p.catch === 'function') p.catch(() => { /* autoplay blocked */ }); } catch { /* ignore */ }
  }
}
function sync() {
  if (!media || !record) { setFocus(false); guardVideo(false); return; }
  const route = selectRoute(store.get());
  if ((videoAudible && route === 'lobby') || !record.enabled || record.paused || document.hidden || audio.bgmSilent) {
    setFocus(false); guardVideo(false); clearHandoff(); fadeCustom(false, true); return;
  }
  if (!inMusicArea()) {
    setFocus(false); guardVideo(false);
    // Keep the old music while the next game's BGM buffer is loading.
    if (route === 'game' && !media.paused && fadeTarget > 0) {
      if (!handoff) { handoff = true; handoffTimer = setTimeout(() => { clearHandoff(); fadeCustom(false); }, 10000); }
    } else fadeCustom(false);
    return;
  }
  clearHandoff();
  if (record.kind === 'online' && !online.stream) { ensureStream(); return; }
  if (!attachAudio()) return;
  if (!audio.ctx) return;
  ensureSource();
  fadeCustom(true);
  guardVideo(route === 'lobby');
  setFocus((route === 'lobby' || route === 'room') && !media.paused);
  if (!media.paused) return;
  media.play().then(() => {
    status = record.kind === 'online' ? '正在播放 · 在线音乐' : '正在播放 · 单曲循环';
    setFocus(route === 'lobby' || route === 'room');
    notify();
  }, () => { status = '点击“播放”开始音乐'; notify(); });
}
async function ensureStream() {
  if (!record || record.kind !== 'online' || online.stream || online.loading || online.failed) return;
  const rec = record;
  const req = ++online.request;
  online.loading = true; online.error = ''; status = '正在连接在线音乐…'; notify();
  try {
    const got = await resolveOnline(rec.platform, rec.id, rec.duration);
    if (record !== rec || req !== online.request) return;
    online.stream = got.stream; online.at = Date.now(); online.retry = false; online.error = '';
    status = '正在播放 · 在线音乐'; notify();
    if (inMusicArea() && !document.hidden) sync();
  } catch (e) {
    if (record !== rec || req !== online.request) return;
    online.error = e.message || '在线音乐加载失败';
    online.failed = true;
    rec.enabled = false;
    status = online.error;
    notify();
    refresh();
  } finally {
    if (record === rec) { online.loading = false; notify(); }
  }
}
function refresh() {
  const s = store.get(); audio.playBgm(bgmKeyFor(selectRoute(s), s.match?.public)); sync(); notify();
}
function sameQueueItem(a, b) {
  if (!a || !b) return false;
  if (a.kind === 'local' || b.kind === 'local') {
    return a.kind === 'local' && b.kind === 'local' && (a.file === b.file || (!!a.id && a.id === b.id));
  }
  return a.platform === b.platform && String(a.id) === String(b.id);
}
function currentMatches(item) {
  if (!record || !item) return false;
  if (record.kind === 'online') return item.platform === record.platform && String(item.id) === String(record.id);
  if (record.kind === 'file') return item.kind === 'local' && (item.title || '') === (record.name || '');
  return false;
}
function randomQueueIndex() {
  if (queue.length < 2) return 0;
  let i = queueIndex;
  while (i === queueIndex) i = Math.floor(Math.random() * queue.length);
  return i;
}
async function playQueueAt(index, tries = 0) {
  if (busy || !record || !queue.length) return;
  const i = ((index % queue.length) + queue.length) % queue.length;
  const item = queue[i];
  try {
    if (item.kind === 'local' || item.file) await music.pickLocal(item);
    else await music.pickOnline(item);
    queueIndex = i;
  } catch {
    if (tries + 1 < queue.length) { await playQueueAt(mode === 'shuffle' ? randomQueueIndex() : i + 1, tries + 1); return; }
    status = '队列里的歌都放不了，换一首试试'; notify();
  }
}
function advance() {
  if (!media || !record) return;
  if (queue.length > 1 && mode !== 'single') {
    playQueueAt(mode === 'shuffle' ? randomQueueIndex() : queueIndex + 1);
    return;
  }
  try { media.currentTime = 0; } catch { /* ignore */ }
  if (record.enabled && !record.paused) media.play().catch(() => { /* blocked */ });
}
function install() {
  if (installed) return; installed = true;
  ensureCss();
  media = new Audio(); media.loop = false; media.preload = 'none';
  media.onended = () => advance();
  media.onerror = () => {
    if (!record) return;
    if (record.kind === 'online' && online.stream && !online.retry) {
      online.retry = true; online.stream = ''; ++online.request; status = '音乐连接中断，正在重新连接…'; notify();
      ensureStream();
      return;
    }
    record.enabled = false;
    status = record.kind === 'online' ? (online.error || '在线音乐播放失败，已恢复默认音乐') : '音乐播放失败，已恢复默认音乐';
    refresh();
  };
  audio.lobbyMusicOverride = key => {
    const override = key === 'lobby' && ((videoAudible&&selectRoute(store.get())==='lobby') || (record?.enabled&&inMusicArea()));
    sync();
    return !!override;
  };
  audio.lobbyMusicBgmStarted = () => { if (!inMusicArea()) {clearHandoff();fadeCustom(false);} };
  window.addEventListener('sp:lobby-video-audio', e => {videoAudible=!!e.detail?.active;refresh();});
  mountMusicOverlay(music);
  loadDirectory().then((handle) => {
    if (!handle) return;
    dirHandle = handle;
    dirName = readPref('sp.lobbyMusic.dirName', '');
    notify();
  }).catch(() => { /* no stored directory */ });
  lastRoute = areaKey();
  store.subscribe(s => { const route = areaKey(); if (route !== lastRoute) { lastRoute = route; refresh(); } else sync(); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointerdown', () => { if (record?.enabled) { audio._unlock(); sync(); } }, { passive: true });
  const initialRevision = revision;
  saved(false).then(value => {
    if (revision !== initialRevision || !value) return;
    if (value.kind === 'online') {
      if (!value.platform || !value.id) return;
      const next = { kind: 'online', platform: value.platform, id: value.id, title: value.title || '', artist: value.artist || '', album: value.album || '', cover: value.cover || '', duration: Number(value.duration) || 0, enabled: value.enabled !== false, paused: value.paused !== false };
      replace(next);
      status = !next.enabled ? '已关闭' : next.paused ? '已暂停' : '正在连接在线音乐…';
      refresh();
      return;
    }
    if (!value.blob || value.blob.size > MAX_MUSIC_BYTES) return;
    const next = { kind: 'file', blob: value.blob, name: value.name, enabled: value.enabled !== false, paused: !!value.paused };
    replace(next);
    status = next.paused ? '已暂停' : '点击“播放”开始音乐';
    refresh();
  }).catch(() => { status = '浏览器暂不能保存音乐，可稍后重试'; notify(); });
}
export const music = {
  snapshot: () => ({
    kind: record ? record.kind : 'default',
    name: record?.kind === 'file' ? record.name : '',
    size: record?.blob?.size || 0,
    platform: record?.kind === 'online' ? record.platform : '',
    id: record?.kind === 'online' ? record.id : '',
    title: record?.kind === 'online' ? record.title : '',
    artist: record?.kind === 'online' ? record.artist : '',
    album: record?.kind === 'online' ? record.album : '',
    cover: record?.kind === 'online' && record.cover ? coverUrl(record.cover) : '',
    duration: record?.kind === 'online' ? Number(record.duration) || 0 : 0,
    enabled: record ? record.enabled !== false : false,
    paused: record ? record.paused !== false : false,
    playing: !!media && !media.paused,
    onlineLoading: online.loading,
    onlineError: online.error,
    volume, muted, mode, playerOpen, lyricsOpen, queueOpen, transOpen,
    dirName, dirAvailable: !!dirHandle,
    queueLength: queue.length, queueIndex,
    status, busy,
  }),
  directory() { return { handle: dirHandle, name: dirName }; },
  async setDirectory(handle, name) {
    dirHandle = handle || null;
    dirName = String(name || '').slice(0, 120);
    if (dirName) writePref('sp.lobbyMusic.dirName', dirName);
    try { await savedDirectory(dirHandle); } catch { /* a browser that cannot clone the handle still has it in memory */ }
    notify();
  },
  async pickLocal(item, list) {
    if (busy) return;
    if (!item?.file) throw Error('目录里的文件读不到了，请重新扫描');
    install(); ++revision; busy = true; notify();
    try {
      if (Array.isArray(list)) {
        queue = list.filter((x) => x && x.kind === 'local' && x.file);
        queueIndex = queue.findIndex((x) => x.id === item.id);
      }
      await validate(item.file);
      const next = { kind: 'file', blob: item.file, name: (item.title || item.file.name).slice(0, 180), enabled: true, paused: false };
      await stored(next); replace(next); status = '正在播放 · 单曲循环'; audio._unlock(); refresh();
    } catch (e) { status = e.message || '这首歌读不出来'; throw e; }
    finally { busy = false; notify(); }
  },
  async upload(file) {
    if (busy) return; install(); ++revision; busy = true; notify();
    try {
      await validate(file);
      queue = []; queueIndex = -1;
      const next = { kind: 'file', blob: file, name: file.name.slice(0, 180), enabled: true, paused: false };
      await stored(next); replace(next); status = '已保存音乐'; audio._unlock(); refresh();
    } catch (e) { status = e.message || '音乐导入失败'; throw e; }
    finally { busy = false; notify(); }
  },
  async toggle() {
    if (!record || busy) return;
    ++revision;
    const rejoin = record.kind === 'online' && (online.failed || !online.stream);
    const playNow = !record.enabled || record.paused || rejoin;
    if (record.kind === 'online' && playNow) { online.failed = false; online.error = ''; online.retry = false; if (!online.stream) ++online.request; }
    const next = { ...record, enabled: true, paused: !playNow };
    await stored(next);
    record = next;
    status = next.paused ? '已暂停' : (record.kind === 'online' ? '正在连接在线音乐…' : '正在播放 · 单曲循环');
    audio._unlock(); refresh();
  },
  async pickOnline(item, list) {
    if (busy) return;
    if (!item?.platform || !item?.id) throw Error('曲目信息不完整');
    if (Array.isArray(list)) {
      queue = list.filter((x) => x && x.platform && x.id);
      queueIndex = queue.findIndex((x) => sameQueueItem(x, item));
    } else if (!queue.length) {
      queue = [item];
      queueIndex = 0;
    } else {
      const at = queue.findIndex((x) => sameQueueItem(x, item));
      if (at >= 0) queueIndex = at;
      else {
        const pos = queueIndex >= 0 ? queueIndex + 1 : queue.length;
        queue.splice(pos, 0, item);
        queueIndex = pos;
      }
    }
    install(); ++revision; busy = true; online.error = ''; const previous = status; status = '正在连接在线音乐…'; notify();
    try {
      const got = await resolveOnline(item.platform, item.id, item.duration);
      const next = { kind: 'online', platform: item.platform, id: item.id, title: item.title || '', artist: item.artist || '', album: item.album || '', cover: item.cover || '', duration: Number(item.duration) || 0, enabled: true, paused: false };
      await stored(next);
      replace(next);
      online.stream = got.stream; online.at = Date.now(); online.failed = false; online.retry = false;
      status = '正在播放 · 在线音乐';
      audio._unlock(); refresh();
    } catch (e) { online.error = e.message || '这首歌现在播不了'; status = previous; notify(); throw e; }
    finally { busy = false; notify(); }
  },
  async retryOnline() {
    if (!record || record.kind !== 'online' || busy) return;
    ++revision; online.failed = false; online.error = ''; online.retry = false; online.stream = ''; ++online.request;
    record = { ...record, enabled: true, paused: false };
    await stored(record);
    status = '正在连接在线音乐…'; notify(); audio._unlock(); refresh();
  },
  async reset() { if (busy) return; ++revision; queue = []; queueIndex = -1; await saved(true, null); replace(null); status = '默认大厅音乐'; refresh(); },
  subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  playback() {
    const duration = Number.isFinite(media?.duration) && media.duration > 0 ? media.duration : (Number(record?.duration) || 0);
    return { time: Number(media?.currentTime) || 0, duration, playing: !!media && !media.paused };
  },
  seek(value) {
    if (!media) return;
    const d = Number.isFinite(media.duration) && media.duration > 0 ? media.duration : (Number(record?.duration) || 0);
    const t = Math.max(0, Number(value) || 0);
    try { media.currentTime = d > 0 ? Math.min(d, t) : t; } catch { /* not seekable yet */ }
    notify();
  },
  setVolume(value) {
    const v = Math.min(1, Math.max(0, Number(value) || 0));
    volume = v;
    if (v > 0) muted = false;
    writePref('sp.lobbyMusic.volume', v);
    writePref('sp.lobbyMusic.muted', muted ? '1' : '0');
    applyVolume(); notify();
  },
  toggleMuted() {
    muted = !muted;
    writePref('sp.lobbyMusic.muted', muted ? '1' : '0');
    applyVolume(); notify();
  },
  setMode(next) {
    if (!['single', 'list', 'shuffle'].includes(next)) return;
    mode = next;
    writePref('sp.lobbyMusic.mode', mode);
    notify();
  },
  cycleMode() {
    const order = ['single', 'list', 'shuffle'];
    mode = order[(order.indexOf(mode) + 1) % order.length];
    writePref('sp.lobbyMusic.mode', mode);
    notify();
  },
  queueItems() {
    return queue.map((item, i) => ({
      index: i,
      key: (item.platform || item.kind || 'x') + ':' + (item.id || item.title || i),
      current: i === queueIndex,
      kind: item.kind || 'online',
      platform: item.platform || '',
      title: item.title || item.name || item.file?.name || '未知曲目',
      artist: item.artist || '',
      album: item.album || '',
      size: Number(item.size) || Number(item.file?.size) || 0,
      duration: Number(item.duration) || 0,
    }));
  },
  addToQueue(item) {
    if (!item) return false;
    if (queue.some((x) => sameQueueItem(x, item))) return false;
    queue.push(item);
    if (queueIndex < 0 && currentMatches(item)) queueIndex = queue.length - 1;
    notify();
    return true;
  },
  playAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= queue.length) return;
    if (index === queueIndex) {
      if (record?.paused || record?.enabled === false) { void music.toggle(); return; }
      audio._unlock(); refresh(); return;
    }
    playQueueAt(index);
  },
  removeAt(index) {
    if (!Number.isInteger(index) || index < 0 || index >= queue.length || index === queueIndex) return;
    queue.splice(index, 1);
    if (queueIndex > index) queueIndex--;
    notify();
  },
  moveAt(index, delta) {
    const j = index + delta;
    if (!Number.isInteger(index) || !Number.isInteger(j) || index < 0 || index >= queue.length || j < 0 || j >= queue.length) return;
    const [item] = queue.splice(index, 1);
    queue.splice(j, 0, item);
    if (queueIndex === index) queueIndex = j;
    else if (index < queueIndex && j >= queueIndex) queueIndex--;
    else if (index > queueIndex && j <= queueIndex) queueIndex++;
    notify();
  },
  clearQueue() { queue = []; queueIndex = -1; notify(); },
  setQueueOpen(open) { queueOpen = !!open; writePref('sp.lobbyMusic.queue', queueOpen ? '1' : '0'); notify(); },
  next() { if (!queue.length || busy) return; playQueueAt(mode === 'shuffle' ? randomQueueIndex() : queueIndex + 1); },
  prev() { if (!queue.length || busy) return; playQueueAt(mode === 'shuffle' ? randomQueueIndex() : queueIndex - 1); },
  setPlayerOpen(open) { playerOpen = !!open; writePref('sp.lobbyMusic.player', playerOpen ? '1' : '0'); notify(); },
  setLyricsOpen(open) { lyricsOpen = !!open; writePref('sp.lobbyMusic.lyrics', lyricsOpen ? '1' : '0'); notify(); },
  setTransOpen(open) { transOpen = !!open; writePref('sp.lobbyMusic.trans', transOpen ? '1' : '0'); notify(); },
};

const HINT = 'color:var(--muted,#8a948f);font-size:12px;line-height:1.6';
const INTRO = 'margin:0;color:var(--muted,#8a948f);font-size:13px;line-height:1.7';
const ROW = 'display:flex;gap:8px;flex-wrap:wrap';

const AUDIO_RE = /\.(mp3|m4a|ogg|wav|aac|flac|webm)$/i;
const SCAN_MAX = 300;

function formatBytes(n) {
  const b = Number(n) || 0;
  return b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
}
function localItemFromFile(file, index) {
  return {
    kind: 'local',
    id: 'local:' + index + ':' + file.name + ':' + file.size,
    title: file.name.replace(/\.[^.]+$/, ''),
    file,
    size: file.size,
    duration: 0,
    restricted: false,
    cover: '',
  };
}
/** Walk a FileSystemDirectoryHandle for audio files (metadata only; no file contents are read). */
async function scanDirectoryHandle(handle) {
  const items = [];
  let skipped = 0;
  let capped = false;
  const walk = async (dir, depth) => {
    if (depth > 6 || capped) return;
    for await (const entry of dir.values()) {
      if (capped || items.length >= SCAN_MAX) { capped = true; return; }
      if (!entry || typeof entry.name !== 'string' || entry.name.startsWith('.')) continue;
      if (entry.kind === 'directory') { await walk(entry, depth + 1); continue; }
      if (!AUDIO_RE.test(entry.name)) continue;
      try {
        const file = await entry.getFile();
        if (file.size <= 0 || file.size > MAX_MUSIC_BYTES) { skipped++; continue; }
        items.push(localItemFromFile(file, items.length));
      } catch { skipped++; }
    }
  };
  await walk(handle, 0);
  items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  return { items, skipped, capped };
}
/** The <input webkitdirectory> fallback: same rules, one flat FileList. */
function scanFileList(files) {
  const items = [];
  let skipped = 0;
  let capped = false;
  for (const file of files) {
    if (!AUDIO_RE.test(file.name)) continue;
    if (!file.size || file.size > MAX_MUSIC_BYTES) { skipped++; continue; }
    if (items.length >= SCAN_MAX) { capped = true; break; }
    items.push(localItemFromFile(file, items.length));
  }
  items.sort((a, b) => a.title.localeCompare(b.title, 'zh-CN'));
  return { items, skipped, capped };
}

function SongRow({ item, busy, playing, onPick, onAdd }) {
  const local = item.kind === 'local';
  const p = local ? { short: '本机' } : platformInfo(item.platform);
  return h('div', { class: 'lm-rowline' },
    h('button', {
      type: 'button', class: 'lm-row' + (playing ? ' is-playing' : ''), disabled: busy, title: '选用《' + (item.title || '') + '》', onClick: () => onPick(item),
    },
    h('span', { class: 'lm-art' }, item.cover
      ? h('img', { src: coverUrl(item.cover), alt: '', loading: 'lazy', onError: e => { e.currentTarget.style.display = 'none'; } })
      : h('i', { 'aria-hidden': 'true' }, '♫')),
    h('span', { class: 'lm-meta' },
      h('span', { class: 'lm-title' }, item.title || '未知曲目', !local && item.restricted ? h('em', { class: 'lm-badge' }, '会员') : null),
      h('span', { class: 'lm-sub' }, local ? '本机文件' : p.short + ' · ' + (item.artist || '未知歌手') + (item.album ? ' · ' + item.album : ''))),
    h('span', { class: 'lm-time' }, local ? formatBytes(item.size) : musicTime(item.duration))),
    onAdd ? h('button', {
      type: 'button', class: 'lm-add', title: '把《' + (item.title || '') + '》加入播放列表', 'aria-label': '加入播放列表', onClick: () => onAdd(item),
    }, '＋') : null);
}

export function LobbyMusicButton() {
  const [open,setOpen]=useState(false),[state,setState]=useState(music.snapshot),[error,setError]=useState('');
  const [tab,setTab]=useState(() => (music.snapshot().kind === 'online' ? 'online' : 'local'));
  const [platform,setPlatform]=useState('all');
  const [query,setQuery]=useState('');
  const [results,setResults]=useState([]);
  const [searching,setSearching]=useState(false);
  const [searched,setSearched]=useState(false);
  const [searchError,setSearchError]=useState('');
  const [notice,setNotice]=useState('');
  const [hidePaid,setHidePaid]=useState(false);
  const [onlineOk,setOnlineOk]=useState(null);
  const [pinging,setPinging]=useState(false);
  const [importOpen,setImportOpen]=useState(false);
  const [importUrl,setImportUrl]=useState('');
  const [importing,setImporting]=useState(false);
  const [playlist,setPlaylist]=useState(null);
  const [library,setLibrary]=useState([]);
  const [libraryName,setLibraryName]=useState('');
  const [scanning,setScanning]=useState(false);
  const [scanNote,setScanNote]=useState('');
  const input=useRef(null);
  const dirInput=useRef(null);
  const lastKind=useRef(null);
  useEffect(() => { if (state.kind === 'online' && lastKind.current !== 'online') setTab('online'); lastKind.current = state.kind; }, [state.kind]);
  useEffect(() => {
    document.body.classList.toggle('hm-modal-open', open);
    return () => document.body.classList.remove('hm-modal-open');
  }, [open]);
  useEffect(()=>{install();const fn=s=>setState(s);listeners.add(fn);fn(music.snapshot());return()=>listeners.delete(fn);},[]);
  useEffect(() => {
    if (!open || onlineOk !== null || pinging) return;
    setPinging(true);
    ping().then(() => setOnlineOk(true)).catch(e => { setOnlineOk(false); setNotice(e.message || '在线音乐服务不可用'); }).finally(() => setPinging(false));
  }, [open, onlineOk, pinging]);
  const applyScan=(out,name)=>{
    setLibrary(out.items);
    setLibraryName(name||'歌曲目录');
    if(out.items.length){
      setScanNote('已添加 '+out.items.length+' 首'+(out.skipped?'，跳过 '+out.skipped+' 个（超过 20MB 或读不了）':'')+(out.capped?'（最多 '+SCAN_MAX+' 首）':''));
    } else {
      setScanNote('目录里没有找到可用音频（支持 mp3 / m4a / ogg / wav / aac / flac / webm，单个 ≤ 20MB）');
    }
  };
  const scanHandle=async(handle,name)=>{
    if(!handle) return;
    setScanning(true);setScanNote('');
    try {
      let perm='granted';
      try { perm=await handle.queryPermission?.({mode:'read'}) || 'prompt'; } catch { perm='granted'; }
      if(perm!=='granted'){
        try { perm=await handle.requestPermission?.({mode:'read'}) || 'denied'; } catch { perm='denied'; }
      }
      if(perm!=='granted') throw Error('浏览器没有给这个目录读取权限');
      const out=await scanDirectoryHandle(handle);
      applyScan(out,name||handle.name);
      await music.setDirectory(handle,name||handle.name);
    } catch(e) { if(e?.name!=='AbortError') setScanNote(e.message||'目录扫描失败'); }
    finally { setScanning(false); }
  };
  const scanFolder=async()=>{
    if(scanning) return;
    if(window.isSecureContext && typeof window.showDirectoryPicker==='function'){
      try {
        const handle=await window.showDirectoryPicker({mode:'read',id:'hubmusic'});
        await scanHandle(handle,handle.name);
      } catch(e) {
        if(e?.name==='AbortError') return;
        // A secure context can still refuse the picker (permissions policy, embedded frame …):
        // fall back to <input webkitdirectory>, which works everywhere a file dialog does.
        setScanNote('这个页面不能直接读取目录，已改用文件夹选择（刷新后需要重新选）');
        dirInput.current?.click();
      }
    } else {
      setScanNote('当前页面不是 HTTPS / localhost，不能记住目录；选文件夹后只在本页有效');
      dirInput.current?.click();
    }
  };
  const restoreFolder=async()=>{ const d=music.directory?.(); if(d?.handle) await scanHandle(d.handle,d.name); else setScanNote('浏览器没有记住上次的目录，请重新扫描'); };
  const onDirFiles=e=>{
    const files=[...(e.currentTarget.files||[])];
    e.currentTarget.value='';
    if(!files.length) return;
    const out=scanFileList(files);
    const first=files[0];
    const folder=(first.webkitRelativePath||'').split('/')[0]||'手动选择的目录';
    applyScan(out,folder);
    music.setDirectory(null,folder);
    if(out.items.length) setScanNote('已添加 '+out.items.length+' 首（这个浏览器/页面不能记住目录，刷新后要重新扫描）');
  };
  const chooseLocal=async item=>{ setScanNote(''); try{ await music.pickLocal(item,library); }catch(e){ setScanNote(e.message||'这首歌读不出来'); } };
  const action=async fn=>{setError('');try{await fn();}catch(e){setError(e.message||'操作失败');}};
  const runSearch=async e=>{
    e?.preventDefault?.();
    const term=query.trim();
    if (!term) { setNotice('输入歌名、歌手或专辑再搜索'); return; }
    if (searching) return;
    if (onlineOk === false) { setNotice('服务器没有安装在线音乐组件'); return; }
    setPlaylist(null);
    setSearching(true);setNotice('');setSearchError('');setError('');
    try {
      const targets=platform==='all'?PLATFORMS:PLATFORMS.filter(p=>p.id===platform);
      const settled=await Promise.allSettled(targets.map(p=>searchOnline(p.id,term)));
      const merged=[];
      const longest=Math.max(0,...settled.map(r=>r.status==='fulfilled'?r.value.items.length:0));
      for(let i=0;i<longest;i++) for(const r of settled) if(r.status==='fulfilled'&&r.value.items[i]) merged.push(r.value.items[i]);
      const failed=settled.map((r,i)=>r.status==='rejected'?targets[i].short+'：'+(r.reason?.message||'搜索失败'):'').filter(Boolean);
      setResults(merged);setSearched(true);setSearchError(failed.join('；'));
      if(!merged.length&&!failed.length) setNotice('没有找到相关曲目，换个关键词试试');
    } catch (e2) { setNotice(e2.message||'搜索失败，稍后再试'); }
    finally { setSearching(false); }
  };
  const doImport=async e=>{
    e?.preventDefault?.();
    const link=importUrl.trim();
    if (!link) { setNotice('粘贴歌单链接再导入'); return; }
    if (importing || searching) return;
    if (onlineOk !== true) { setNotice('服务器没有安装在线音乐组件'); return; }
    setImporting(true);setNotice('');setSearchError('');setError('');
    try {
      const out=await importPlaylist('', link);
      setPlaylist({name:out.name,cover:out.cover,total:out.total,limited:out.limited,platform:out.platform,count:out.items.length});
      setResults(out.items);setSearched(true);setPlatform(out.platform);setImportOpen(false);setImportUrl('');
      const first=out.items.find(x=>!x.restricted)||out.items[0];
      if (first) { try { await music.pickOnline(first,out.items); } catch(e2){ setNotice(e2.message||'歌单第一首暂时播不了，换一首试试'); } }
      else setNotice('这个歌单里没有曲目');
    } catch (e2) { setNotice(e2.message||'歌单导入失败，确认是公开歌单链接'); }
    finally { setImporting(false); }
  };
  const clearPlaylist=()=>{ setPlaylist(null);setResults([]);setSearched(false);setNotice(''); };
  const choose=async item=>{ setNotice(''); try { await music.pickOnline(item); } catch(e){ setNotice(e.message||'这首歌现在播不了，换一首试试'); } };
  const addToQueue=item=>{
    const ok=music.addToQueue(item);
    setNotice(ok ? '已加入播放列表：'+(item.title||'这首') : '《'+(item.title||'这首')+'》已经在播放列表里了');
  };
  const addLocalToQueue=item=>{
    const ok=music.addToQueue(item);
    setScanNote(ok ? '已加入播放列表：'+(item.title||'这首') : '《'+(item.title||'这首')+'》已经在播放列表里了');
  };
  const isOnline=state.kind==='online';
  const info=platformInfo(state.platform);
  const visible=hidePaid?results.filter(x=>!x.restricted):results;
  const hiddenCount=results.length-visible.length;

  const current=h('div',{class:'lm-current'},
    isOnline&&state.cover?h('img',{class:'lm-cover',src:state.cover,alt:'','onerror':e=>{e.currentTarget.style.display='none';}}):null,
    h('div',{class:'lm-what'},
      h('strong',{class:'lm-name'},isOnline?(state.title||'在线音乐'):(state.name||'默认大厅音乐')),
      h('small',{class:'lm-state'},
        isOnline?h('span',{class:'lm-plat',style:'--pc:'+info.color},info.name):null,
        isOnline?' · '+(state.artist||'未知歌手')+' · ':'',
        state.status,
        state.size?' · '+formatBytes(state.size):'')));

  const tabs=h('div',{class:'lm-tabs',role:'tablist','aria-label':'音乐来源'},
    h('button',{type:'button',role:'tab','aria-selected':tab==='local',class:'lm-tab'+(tab==='local'?' is-on':''),onClick:()=>setTab('local')},'本机音乐'),
    h('button',{type:'button',role:'tab','aria-selected':tab==='online',class:'lm-tab'+(tab==='online'?' is-on':''),onClick:()=>setTab('online')},'在线音乐'));

  const localBody=h('div',{style:'display:grid;gap:10px'},
    h('input',{ref:input,type:'file',accept:'audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac,.webm',hidden:true,onChange:e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)action(()=>music.upload(file));}}),
    h('input',{ref:dirInput,type:'file',multiple:true,webkitdirectory:true,directory:true,hidden:true,onChange:onDirFiles}),
    h('div',{style:ROW},
      h(Button,{disabled:state.busy,onClick:()=>input.current?.click()},state.busy?'正在导入…':'上传音乐'),
      h(Button,{disabled:scanning,onClick:scanFolder},scanning?'扫描中…':'扫描歌曲目录'),
      state.dirAvailable&&!library.length?h(Button,{disabled:scanning,variant:'secondary',onClick:restoreFolder,title:state.dirName?'上次目录：'+state.dirName:'恢复上次扫描的目录'},'恢复目录'):null,
      h(Button,{disabled:!state.name||state.busy,onClick:()=>action(()=>music.toggle())},state.playing?'暂停':'播放'),
      h(Button,{disabled:state.kind==='default'||state.busy,variant:'secondary',onClick:()=>action(()=>music.reset())},'恢复默认')),
    state.dirAvailable&&!library.length?h('small',{style:HINT},'上次扫描的目录：'+(state.dirName||'（未命名）')+'。点「恢复目录」浏览器会重新请求读取权限。'):null,
    scanNote?h('small',{style:HINT},scanNote):null,
    library.length?h('div',{class:'lm-playlist'},
      h('span',{class:'lm-playlist__meta'},h('b',{title:libraryName},libraryName),h('small',null,library.length+' 首 · 点一首播放，播放器可上一首 / 下一首')),
      h('button',{type:'button',class:'lm-x',title:'清空目录列表',onClick:()=>setLibrary([])},'✕')):null,
    library.length?h('div',{class:'lm-list lm-local',role:'list'},library.map(item=>h(SongRow,{key:item.id,item,busy:state.busy,playing:state.kind==='file'&&state.name===item.title,onPick:chooseLocal,onAdd:addLocalToQueue}))):null,
    h('small',{style:HINT},'扫描只读目录里的音频文件名与大小，不读取文件内容；点到哪首才载入哪首。音量和静音沿用游戏设置。'));

  const importBlock=h('div',{class:'lm-import'},
    h('button',{type:'button',class:'lm-import__toggle'+(importOpen?' is-on':''),onClick:()=>setImportOpen(v=>!v)},importOpen?'取消导入':'＋ 导入歌单'),
    playlist?h('div',{class:'lm-playlist'},
      playlist.cover?h('img',{src:coverUrl(playlist.cover),alt:'',onError:e=>{e.currentTarget.style.display='none';}}):null,
      h('span',{class:'lm-playlist__meta'},
        h('b',{title:playlist.name},playlist.name),
        h('small',null,playlist.count+' 首'+(playlist.total>playlist.count?' / 共 '+playlist.total+' 首':'')+(playlist.limited?' · 只导入前 '+playlist.count+' 首':''))),
      h('button',{type:'button',class:'lm-x',title:'清除歌单',onClick:clearPlaylist},'✕')):null);
  const importForm=importOpen?h('div',{class:'lm-import__box'},
    h('form',{class:'lm-import__form',onSubmit:doImport},
      h('input',{class:'lm-input',value:importUrl,placeholder:'粘贴公开歌单链接（QQ音乐 / 网易云 / 酷我）','aria-label':'歌单链接',onInput:e=>setImportUrl(e.currentTarget.value),disabled:importing}),
      h(Button,{disabled:importing||onlineOk!==true,onClick:doImport},importing?'导入中…':'导入')),
    h('small',{class:'lm-import__hint'},'只支持公开歌单；私密歌单先在平台里设为公开。')):null;

  const chips=h('div',{class:'lm-chips',role:'group','aria-label':'音乐平台'},
    h('button',{type:'button',class:'lm-chip'+(platform==='all'?' is-on':''),onClick:()=>setPlatform('all')},'全部平台'),
    PLATFORMS.map(p=>h('button',{key:p.id,type:'button',class:'lm-chip'+(platform===p.id?' is-on':''),onClick:()=>setPlatform(p.id)},p.name)));

  const form=h('form',{class:'lm-search',onSubmit:runSearch},
    h('input',{class:'lm-input',value:query,placeholder:'搜索歌名、歌手或专辑','aria-label':'搜索在线音乐',onInput:e=>setQuery(e.currentTarget.value),onFocus:e=>e.currentTarget.select(),disabled:searching}),
    h(Button,{disabled:searching||onlineOk!==true,onClick:runSearch},searching?'搜索中…':'搜索'));

  const rowOf=item=>h(SongRow,{key:item.platform+':'+item.id,item,busy:state.busy,playing:state.kind==='online'&&state.platform===item.platform&&state.id===item.id,onPick:choose,onAdd:addToQueue});
  const empty=hidePaid
    ? '结果里都是标「会员」的曲目：取消上面的勾选可以看到它们，或者换一个关键词。'
    : '没有找到可用的曲目，换个关键词试试。';
  const list=h('div',{class:'lm-list',role:'list'},visible.length?visible.map(rowOf):h('p',{class:'lm-note',style:'padding:10px 8px'},empty));

  const onlineBody=h('div',{style:'display:flex;flex-direction:column;gap:10px;min-height:0;flex:1 1 auto;min-width:0'},
    onlineOk===false?h('div',{class:'lm-warn'},h('p',{style:'margin:0 0 6px'},'这个服务器没有安装「在线音乐」服务端组件，暂时只能使用本机音乐。把 mod-hubmusic 的 server/lobbyMusic.js 放进游戏目录、按 README 接上 /lobby-music/ 路由并重启服务器后，再点重试。'),h(Button,{size:'sm',disabled:pinging,onClick:()=>{setOnlineOk(null);setPinging(false);setNotice('');}},'重试')):null,
    onlineOk===null?h('p',{class:'lm-note'},'正在连接在线音乐服务…'):null,
    chips,importBlock,importForm,form,
    notice?h('p',{class:notice.startsWith('已')?'lm-ok':'lm-error'},notice):null,
    searchError?h('p',{class:'lm-warn'},searchError):null,
    h('div',{class:'lm-tools'},
      h('label',{class:'lm-check'},h('input',{type:'checkbox',checked:hidePaid,onChange:e=>setHidePaid(e.currentTarget.checked)}),'隐藏标「会员」的曲目'),
      h('span',{class:'lm-count'},searched?(visible.length+' 首'+(hiddenCount?'（已隐藏 '+hiddenCount+' 首）':'')):'')),
    searched?list:h('p',{class:'lm-note'},'搜索后会列出三个平台的结果；点一首即可设为大厅音乐。标「会员」的曲目通常只能试听或无法播放，可以换一首免费曲目，或改用本机上传。'),
    isOnline?h('div',{style:ROW},
      h(Button,{disabled:state.busy||state.onlineLoading,onClick:()=>action(()=>music.toggle())},state.playing?'暂停':'播放'),
      state.enabled===false?h(Button,{disabled:state.busy,onClick:()=>action(()=>music.retryOnline())},'重新连接'):null,
      h(Button,{disabled:state.busy,variant:'secondary',onClick:()=>action(()=>music.reset())},'恢复默认')):null,
    searched?null:h('small',{class:'lm-foot',style:'color:var(--muted,#8a948f);font-size:11px;line-height:1.6'},'在线曲目只保存歌名和封面，播放时经本机服务器取流；会员 / 版权曲目无法直接播放。请遵守各音乐平台的使用条款，仅供个人在大厅听歌。'));

  const body=h('div',{style:'display:flex;flex-direction:column;gap:12px;padding:6px 0;min-width:0;min-height:0;flex:1 1 auto'},
    h('p',{class:'lm-intro',style:INTRO},'可上传本机音频（每首最大 20MB，存本机），或搜索 QQ音乐 / 网易云 / 酷我的免费曲目。选好歌会出现可拖动的悬浮播放器和歌词卡；播放时大厅视频背景暂停、游戏音效让位。房间、战前信息和选人时继续播放，进入战场自动切回游戏音乐。'),
    current,
    state.kind!=='default'?h('div',{class:'lm-viewers'},
      h('button',{type:'button',class:'lm-viewer',onClick:()=>music.setPlayerOpen(!state.playerOpen)},state.playerOpen?'收起播放器':'显示播放器'),
      h('button',{type:'button',class:'lm-viewer',onClick:()=>music.setQueueOpen(!state.queueOpen)},state.queueOpen?'隐藏播放列表':'显示播放列表'),
      h('button',{type:'button',class:'lm-viewer',onClick:()=>music.setLyricsOpen(!state.lyricsOpen)},state.lyricsOpen?'隐藏歌词':'显示歌词')):null,
    tabs,tab==='local'?localBody:onlineBody,
    error?h('p',{role:'alert',style:'margin:0;color:#ff9393;overflow-wrap:anywhere'},error):null);

  return h(Fragment,null,
    h(Button,{variant:'secondary',size:'sm',square:true,class:'hub-music-btn',title:'大厅音乐','aria-label':'大厅音乐',onClick:()=>setOpen(true)},
      h('span',{style:'font-size:22px;line-height:1','aria-hidden':'true'},'♫')),
    h(Modal,{class:'lobby-music-panel',open,title:'大厅音乐',micro:'LOBBY MUSIC',width:'min(560px, calc(100vw - 32px))',onClose:()=>setOpen(false),
      actions:h(Button,{variant:'secondary',onClick:()=>setOpen(false)},'关闭')},body));
}
