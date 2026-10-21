import { PHASE } from '../../../shared/constants.js';
import { html, Button, Modal } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { store, selectRoute } from '../store.js';
import { audio, bgmKeyFor } from '../audio.js';

export const MAX_MUSIC_BYTES = 20 * 1024 * 1024;
/** Meting 兼容端点：播放首个不通时换下一个。搜索/歌单只有第一个实现了，其余返回 HTML。 */
export const MUSIC_APIS = ['https://api.qijieya.cn/meting/', 'https://api.injahow.cn/meting/'];
const listeners = new Set();
let record = null, url = null, media = null, source = null, revision = 0, installed = false, dbPromise, retriedRemote = false;
let status = '默认大厅音乐', busy = false, lastRoute;
let lyrics = [], lyricAt = -1, coverUrl = null;
// 公共 Meting 端点对短时高频会返回空数组（不是 429），所以同一关键词缓存 5 分钟、两次请求至少隔 2.5 秒。
const searchCache = { query: '', at: 0, list: [] };
const notify = () => listeners.forEach(fn => fn(music.snapshot()));
let videoAudible=false;
const inMusicArea = () => { const s=store.get(),route=selectRoute(s);return ['lobby','room'].includes(route)||(route==='game'&&[PHASE.INFO_CHECK,PHASE.BAND_DRAFT,PHASE.BATTLE_CHECK].includes(s.match?.public?.phase)); };
let customGain=null,fadeTarget=0,fadeTimer,handoff=false,handoffTimer;
const areaKey = () => selectRoute(store.get()) + ':' + inMusicArea();

/** 网易云播放地址：端点回 302，浏览器跟随到 CDN 并带签名；签名有时效，所以只保存 id，播放时现拼。 */
const remoteSrc = (id, api = MUSIC_APIS[0]) => `${api}?server=netease&type=url&id=${encodeURIComponent(id)}`;

/** 从网易云网页链接或纯歌曲 ID 取 {type,id}；短链 163cn.tv 需跨域跳转，浏览器端不支持。 */
export function parseNeteaseLink(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const hit = raw.match(/(song|playlist|album|artist)\/?\?[^#]*?\bid=(\d{4,})/i);
  if (hit) return { type: hit[1].toLowerCase(), id: hit[2] };
  const bare = raw.match(/^(\d{4,})$/);
  return bare ? { type: 'song', id: bare[1] } : null;
}

/** LRC → [{t,text}]；只留带时间戳且有文字的行。 */
export function parseLrc(text) {
  return String(text || '').split(/\r?\n/).map(line => {
    const hit = line.match(/^\[(\d+):(\d+(?:\.\d+)?)\](.*)$/);
    if (!hit) return null;
    const body = hit[3].trim();
    return body ? { t: Number(hit[1]) * 60 + Number(hit[2]), text: body } : null;
  }).filter(Boolean);
}

/** Meting 列表项 → 本地曲目；id 从 url 的 id= 参数取，pic 直接留 URL。 */
const toTrack = item => ({
  id: String(item?.url || '').match(/[?&]id=(\d+)/)?.[1] || '',
  name: String(item?.name || item?.title || '').slice(0, 180),
  artist: String(item?.artist || item?.author || '').slice(0, 120),
  cover: String(item?.pic || '').slice(0, 300) || null,
});

/**
 * ffapi.cn 的网易云解析接口：签名是 md5(秒级时间戳 + 固定密钥)，与参数无关。
 * 浏览器没有 MD5 的 WebCrypto，所以这里内嵌一份（Node crypto 交叉验证过，含 UTF-8）。
 */
function md5(str) {
  const rotl = (x, c) => (x << c) | (x >>> (32 - c));
  const bytes = new TextEncoder().encode(str);
  const len = bytes.length, bitLen = len * 8;
  const withPad = new Uint8Array((((len + 8) >> 6) + 1) * 64);
  withPad.set(bytes); withPad[len] = 0x80;
  const dv = new DataView(withPad.buffer);
  dv.setUint32(withPad.length - 8, bitLen >>> 0, true);
  dv.setUint32(withPad.length - 4, Math.floor(bitLen / 0x100000000), true);
  let a0 = 0x67452301, b0 = 0xefcdab89, c0 = 0x98badcfe, d0 = 0x10325476;
  const K = new Int32Array(64);
  const S = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
  for (let i = 0; i < 64; i++) K[i] = Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0;
  for (let off = 0; off < withPad.length; off += 64) {
    const M = new Int32Array(16);
    for (let j = 0; j < 16; j++) M[j] = dv.getInt32(off + j * 4, true);
    let A = a0, B = b0, C = c0, D = d0;
    for (let i = 0; i < 64; i++) {
      let F, g;
      if (i < 16) { F = (B & C) | (~B & D); g = i; }
      else if (i < 32) { F = (D & B) | (~D & C); g = (5 * i + 1) & 15; }
      else if (i < 48) { F = B ^ C ^ D; g = (3 * i + 5) & 15; }
      else { F = C ^ (B | ~D); g = (7 * i) & 15; }
      F = (F + A + K[i] + M[g]) | 0;
      A = D; D = C; C = B; B = (B + rotl(F, S[i])) | 0;
    }
    a0 = (a0 + A) | 0; b0 = (b0 + B) | 0; c0 = (c0 + C) | 0; d0 = (d0 + D) | 0;
  }
  const out = new Uint8Array(16), odv = new DataView(out.buffer);
  odv.setInt32(0, a0, true); odv.setInt32(4, b0, true); odv.setInt32(8, c0, true); odv.setInt32(12, d0, true);
  return [...out].map(b => b.toString(16).padStart(2, '0')).join('');
}

/** ffapi.cn：搜索/解析都走一个 POST，返回 {code,data} 或 {code,...,url}。 */
const FFAPI = {
  endpoint: 'https://www.ffapi.cn/tool/163_music/api/api.php',
  secret: 'kxz_163music_secret_key_2024',
  level: 'standard',
};
async function ffapiPost(params) {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const body = new URLSearchParams({ ...params, timestamp, signature: md5(timestamp + FFAPI.secret) });
  const r = await fetch(FFAPI.endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  const j = await r.json();
  if (j.code !== 200) throw Error(j.msg || j.error || 'ffapi 返回异常');
  return j;
}
async function ffapiSearch(q) {
  const j = await ffapiPost({ action: 'search', name: q, limit: '20' });
  return (j.data || []).map(item => ({
    id: String(item?.id || ''),
    name: String(item?.name || '').slice(0, 180),
    artist: (item?.artists || []).map(a => a?.name).filter(Boolean).join('/').slice(0, 120),
    cover: String(item?.picUrl || '').slice(0, 300) || null,
  })).filter(t => t.id);
}
async function ffapiMusic(id, level = FFAPI.level) {
  const j = await ffapiPost({ action: 'music', url: String(id), level, type: 'json' });
  if (!j.url) throw Error('这首拿不到播放地址');
  return { url: String(j.url), name: String(j.name || ''), artist: String(j.ar_name || ''), cover: String(j.pic || '') || null };
}

async function fetchList(query) {
  const r = await fetch(`${MUSIC_APIS[0]}?server=netease&${query}`, { headers: { accept: 'application/json' } });
  if (!r.ok) throw Error(`HTTP ${r.status}`);
  const list = await r.json();
  if (!Array.isArray(list)) throw Error('返回格式异常');
  return list.map(toTrack).filter(t => t.id);
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
async function loadLyrics(track) {
  lyrics = []; lyricAt = -1;
  if (!track || track.kind !== 'remote' || !track.id) { notify(); return; }
  try {
    const r = await fetch(`${MUSIC_APIS[0]}?server=netease&type=lrc&id=${encodeURIComponent(track.id)}`);
    if (!r.ok) return;
    const parsed = parseLrc(await r.text());
    if (record?.id === track.id) { lyrics = parsed; lyricAt = -1; notify(); }
  } catch { /* 没有歌词就不显示，不影响播放 */ }
}
function replace(next, directUrl = null) {
  if (media) { media.pause(); media.removeAttribute('src'); media.load(); }
  if (url && url.startsWith('blob:')) URL.revokeObjectURL(url);
  record = next; retriedRemote = false;
  lyrics = []; lyricAt = -1; coverUrl = next?.cover || null;
  url = directUrl || (next?.blob ? URL.createObjectURL(next.blob)
    : next?.kind === 'remote' && next.id ? remoteSrc(next.id)
    : null);
  if (media) {
    media.loop = !next?.queue?.length;
    if (url) { media.src = url; loadLyrics(next); }
  }
}
/** 队列第 i 首（越界自动回绕）。整条 record 保留 queue，只换当前曲目。 */
function playQueueAt(i) {
  if (!record?.queue?.length) return;
  const len = record.queue.length, idx = ((i % len) + len) % len, t = record.queue[idx];
  const next = { ...record, kind: 'remote', blob: undefined, id: String(t.id), name: t.name, artist: t.artist, cover: t.cover || null, index: idx, enabled: true, paused: false };
  saved(true, next).catch(() => {});
  replace(next);
  status = `正在播放 · ${idx + 1}/${len}`;
  audio._unlock(); refresh();
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
function sync() {
  if (!media || !record) return;
  if ((videoAudible&&selectRoute(store.get())==='lobby') || !record.enabled || record.paused || document.hidden || audio.bgmSilent) {clearHandoff();fadeCustom(false,true);return;}
  if (!inMusicArea()) {
    // Keep the old music while the next game's BGM buffer is loading.
    if (selectRoute(store.get())==='game' && !media.paused && fadeTarget>0) {
      if (!handoff) {handoff=true;handoffTimer=setTimeout(()=>{clearHandoff();fadeCustom(false);},10000);}
    } else fadeCustom(false);
    return;
  }
  clearHandoff();
  if (!audio.ctx) return;
  if (!source) {source=audio.ctx.createMediaElementSource(media);customGain=audio.ctx.createGain();customGain.gain.value=0;source.connect(customGain);customGain.connect(audio.bgmGain);}
  fadeCustom(true);
  if (!media.paused) return;
  media.play().then(()=>{status=record?.queue?.length?`正在播放 · ${(record.index||0)+1}/${record.queue.length}`:'正在播放 · 单曲循环';notify();},()=>{status='点击“播放”开始音乐';notify();});
}

function refresh() {
  const s = store.get(); audio.playBgm(bgmKeyFor(selectRoute(s), s.match?.public)); sync(); notify();
}
function install() {
  if (installed) return; installed = true;
  media = new Audio(); media.loop = true; media.preload = 'none';
  // Remote (netease CDN) tracks are decoded through Web Audio; without this the element is
  // tainted and the whole chain goes silent instead of failing loudly. The CDN sends `ACAO: *`.
  media.crossOrigin = 'anonymous';
  media.onerror = () => {
    // 换端点重试一次：签名过期、端点抖动、或第一个端点限流都能被这一下盖住。
    if (record?.kind === 'remote' && record.id && !retriedRemote) {
      retriedRemote = true; media.src = remoteSrc(record.id, MUSIC_APIS[1]);
      if (record.enabled && !record.paused) media.play().catch(() => {});
      return;
    }
    // 两个端点都拿不到音频：多半是这首没有版权/需要会员（端点用 0 字节 HTML 作答）。
    if (record?.kind === 'remote') {
      record.enabled = false; status = '这首暂时无法播放（可能无版权或需要会员），换一首试试';
      notify(); refresh(); return;
    }
    record && (record.enabled = false); status = '音乐播放失败，已恢复默认音乐'; refresh();
  };
  media.onended = () => { if (record?.queue?.length) playQueueAt((record.index || 0) + 1); };
  media.ontimeupdate = () => {
    if (!lyrics.length) return;
    const t = media.currentTime;
    let i = lyrics.length - 1;
    while (i >= 0 && lyrics[i].t > t) i--;
    if (i !== lyricAt) { lyricAt = i; notify(); }
  };
  audio.lobbyMusicOverride = key => {
    const override = key === 'lobby' && ((videoAudible&&selectRoute(store.get())==='lobby') || (record?.enabled&&inMusicArea()));
    sync();
    return !!override;
  };
  audio.lobbyMusicBgmStarted = () => { if (!inMusicArea()) {clearHandoff();fadeCustom(false);} };
  window.addEventListener('sp:lobby-video-audio', e => {videoAudible=!!e.detail?.active;refresh();});
  lastRoute = areaKey();
  store.subscribe(s => { const route = areaKey(); if (route !== lastRoute) { lastRoute = route; refresh(); } else sync(); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('pointerdown', () => { if (record?.enabled) { audio._unlock(); sync(); } }, { passive: true });
  const initialRevision = revision;
  saved(false).then(value => {
    if (revision !== initialRevision || !value) return;
    if (value.kind === 'remote' && value.id) {
      replace(value); status = value.paused ? '已暂停' : '点击“播放”开始音乐'; refresh(); return;
    }
    if (!value.blob || value.blob.size > MAX_MUSIC_BYTES) return;
    replace(value); status = value.paused ? '已暂停' : '点击“播放”开始音乐'; refresh();
  }).catch(() => { status = '浏览器暂不能保存音乐，可稍后重试'; notify(); });
}
export const music = {
  snapshot: () => ({
    name: record?.name || '', artist: record?.artist || '', kind: record?.kind || 'local',
    size: record?.blob?.size || 0, enabled: !!record?.enabled, paused: !!record?.paused,
    playing: !!media && !media.paused, status, busy,
    cover: coverUrl || '', lyric: lyricAt >= 0 && lyrics[lyricAt] ? lyrics[lyricAt].text : '',
    queue: record?.queue?.length || 0, index: record?.index || 0,
  }),
  async upload(file) {
    if (busy) return; install(); ++revision; busy = true; notify();
    try { await validate(file); const next = { kind: 'local', blob: file, name: file.name.slice(0,180), enabled: true, paused: false }; await saved(true, next); replace(next); status = '已保存音乐'; audio._unlock(); refresh(); }
    catch(e) { status = e.message || '音乐导入失败'; throw e; }
    finally { busy = false; notify(); }
  },
  /** Play a netease track (id only — the CDN URL is signed and expires). Clears any queue. */
  async playRemote(track) {
    if (busy) return; install(); ++revision; busy = true; notify();
    try {
      // 先让 ffapi 解析出直链（顺带补封面/歌手），失败就退回 Meting 的 302。
      let direct = null, extra = null;
      try { extra = await ffapiMusic(track.id); direct = extra.url; } catch { /* Meting fallback */ }
      const next = {
        kind: 'remote', id: String(track.id),
        name: String(extra?.name || track.name || `网易云 ${track.id}`).slice(0, 180),
        artist: String(extra?.artist || track.artist || '').slice(0, 120),
        cover: extra?.cover || track.cover || null,
        enabled: true, paused: false,
      };
      await saved(true, next); replace(next, direct); status = '正在播放 · 网易云'; audio._unlock(); refresh();
    } catch(e) { status = e.message || '播放失败'; throw e; }
    finally { busy = false; notify(); }
  },
  /** Play a list as a queue, starting at the first track. */
  async playAll(list) {
    const queue = (Array.isArray(list) ? list : []).map(t => ({ id: String(t.id), name: String(t.name||'').slice(0,180), artist: String(t.artist||'').slice(0,120), cover: t.cover || null })).filter(t => t.id);
    if (!queue.length) throw Error('列表为空，没有可播放的歌曲');
    install(); ++revision; busy = true; notify();
    try {
      const first = queue[0];
      record = { kind: 'remote', queue, index: 0, id: first.id, name: first.name, artist: first.artist, cover: first.cover, enabled: true, paused: false };
      await saved(true, record);
      playQueueAt(0);
    } catch(e) { status = e.message || '播放失败'; throw e; }
    finally { busy = false; notify(); }
  },
  /** Paste a music.163.com song / playlist link or a bare song id. */
  async playLink(text) {
    const hit = parseNeteaseLink(text);
    if (!hit) throw Error('只支持 music.163.com 的歌曲/歌单链接或歌曲 ID');
    if (hit.type === 'song') return music.playRemote({ id: hit.id });
    if (hit.type === 'playlist' || hit.type === 'album') {
      const list = await fetchList(`type=${hit.type}&id=${encodeURIComponent(hit.id)}`);
      if (!list.length) throw Error('这个歌单里没有可播放的歌曲');
      return music.playAll(list);
    }
    throw Error('暂不支持歌手页面链接');
  },
  /** Search netease. Only MUSIC_APIS[0] implements `type=search`; the others answer with HTML. */
  async search(keyword) {
    const q = String(keyword || '').trim();
    if (!q) return [];
    if (q === searchCache.query && Date.now() - searchCache.at < 5 * 60 * 1000) return searchCache.list;
    // 首选 ffapi（签名接口，封面/歌手更全）；它挂了再回退 Meting。
    try {
      const list = await ffapiSearch(q);
      if (list.length) { searchCache.query = q; searchCache.at = Date.now(); searchCache.list = list; return list; }
    } catch { /* fall through to Meting */ }
    const wait = 2500 - (Date.now() - searchCache.at);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    let lastError, empty = false;
    for (const api of MUSIC_APIS) {
      try {
        const r = await fetch(`${api}?server=netease&type=search&limit=20&id=${encodeURIComponent(q)}`, { headers: { accept: 'application/json' }, cache: 'no-store' });
        if (!r.ok) throw Error(`HTTP ${r.status}`);
        const list = await r.json();
        if (!Array.isArray(list)) throw Error('返回格式异常');
        if (!list.length) { empty = true; continue; }
        const out = list.map(toTrack).filter(t => t.id).slice(0, 20);
        searchCache.query = q; searchCache.at = Date.now(); searchCache.list = out;
        return out;
      } catch (err) { lastError = err; }
    }
    throw Error(empty ? '暂时没有结果（公共接口可能限流），请稍后再试' : (lastError?.message || '搜索失败，请稍后重试'));
  },
  async toggle() {
    if (!record || busy) return; ++revision;
    const next = { ...record, enabled: true, paused: !!record.enabled && !media.paused };
    await saved(true,next); record=next; status=next.paused?'已暂停':(next.queue?.length?`正在播放 · ${(next.index||0)+1}/${next.queue.length}`:'正在播放 · 单曲循环'); audio._unlock(); refresh();
  },
  async reset() { if (busy) return; ++revision; await saved(true,null); replace(null); status='默认大厅音乐'; refresh(); },
};
export function LobbyMusicButton() {
  const [open,setOpen]=useState(false),[state,setState]=useState(music.snapshot),[error,setError]=useState(''),[link,setLink]=useState('');
  const [query,setQuery]=useState(''),[results,setResults]=useState([]),[searching,setSearching]=useState(false);
  const input=useRef(null);
  useEffect(()=>{install();const fn=s=>setState(s);listeners.add(fn);fn(music.snapshot());return()=>listeners.delete(fn);},[]);
  const action=async fn=>{setError('');try{await fn();}catch(e){setError(e.message||'操作失败');}};
  const playLink=()=>action(async()=>{await music.playLink(link);setLink('');});
  const doSearch=async()=>{const q=query.trim();if(!q||searching)return;setSearching(true);setError('');try{setResults(await music.search(q));}catch(e){setResults([]);setError(e.message||'搜索失败');}finally{setSearching(false);}};
  return html`<${Button} variant="secondary" size="sm" square=${true} class="hub-music-btn" title="大厅音乐" aria-label="大厅音乐" onClick=${()=>setOpen(true)}><span style="font-size:22px;line-height:1" aria-hidden="true">♫</span><//>
    <style>.lobby-music-panel .modal__head{padding:14px 16px 4px}.lobby-music-panel .modal__title{font-size:18px}.lobby-music-panel .modal__head>:first-child{font-size:10px}.lobby-music-panel .modal__body{padding:12px 16px 16px}.lobby-music-panel .modal__actions{padding:10px 16px}.lobby-music-panel button{font-size:13px;min-height:36px;padding:8px 12px}.lobby-music-panel .lobby-music-link{flex:1;min-width:0;background:rgba(0,0,0,.35);border:1px solid rgba(88,217,181,.35);color:inherit;padding:8px 10px;font-size:13px;line-height:1.4;outline:none}.lobby-music-panel .lobby-music-link:focus{border-color:var(--mint,#58d9b5)}.lobby-music-panel .lobby-music-list{max-height:184px;overflow:auto;border:1px solid rgba(88,217,181,.25);background:rgba(0,0,0,.18)}.lobby-music-panel .lobby-music-list button{display:block;width:100%;text-align:left;background:transparent;border:0;border-bottom:1px solid rgba(255,255,255,.06);padding:7px 10px;color:inherit;cursor:pointer;font-size:13px;min-height:0}.lobby-music-panel .lobby-music-list button:hover{background:rgba(88,217,181,.1)}</style>
    <${Modal} class="lobby-music-panel" open=${open} title="大厅音乐" micro="LOBBY MUSIC" width="min(560px, calc(100vw - 32px))" onClose=${()=>setOpen(false)} actions=${html`<${Button} variant="secondary" onClick=${()=>setOpen(false)}>关闭<//>`}>
      <div style="display:grid;gap:14px;padding:8px 0;min-width:0">
        <p style="margin:0;color:var(--muted);font-size:13px;line-height:1.7">选择你喜欢的大厅音乐：上传本地文件（每首最大 20MB，只存在当前浏览器），或搜索网易云 / 粘贴歌曲·歌单链接。房间、战前信息和选人时继续播放，进入战场淡出并切换游戏音乐。</p>
        <div style="display:flex;gap:12px;align-items:center;padding:14px;border:1px solid var(--mint,#58d9b5);background:rgba(30,90,75,.12);min-width:0">
          ${state.cover?html`<img src=${state.cover} alt="" width="48" height="48" loading="lazy" style="width:48px;height:48px;object-fit:cover;flex:none;border:1px solid rgba(88,217,181,.3)" />`:null}
          <div style="min-width:0;flex:1">
            <strong style="display:block;font-size:15px;overflow-wrap:anywhere">${state.name||'默认大厅音乐'}</strong>
            ${state.artist?html`<small style="display:block;font-size:12px;margin-top:4px;color:var(--muted);overflow-wrap:anywhere">${state.artist}</small>`:null}
            <small style="display:block;font-size:12px;margin-top:8px;color:var(--mint,#58d9b5)">${state.status}${state.queue?` · ${state.index+1}/${state.queue}`:''}${state.size?` · ${(state.size/1024/1024).toFixed(1)} MB`:''}</small>
            ${state.lyric?html`<em style="display:block;font-size:12px;margin-top:6px;color:var(--mint,#58d9b5);font-style:normal;overflow-wrap:anywhere;opacity:.85">${state.lyric}</em>`:null}
          </div>
        </div>
        <div style="display:flex;gap:8px;min-width:0">
          <input class="lobby-music-link" value=${query} onInput=${e=>setQuery(e.currentTarget.value)} onKeyDown=${e=>{if(e.key==='Enter')doSearch();}} placeholder="搜索网易云歌曲" aria-label="搜索网易云歌曲" />
          <${Button} disabled=${!query.trim()||searching} onClick=${doSearch}>${searching?'搜索中…':'搜索'}<//>
        </div>
        ${results.length?html`<div class="lobby-music-list" role="list">
          ${results.map(r=>html`<button key=${r.id} role="listitem" type="button" disabled=${state.busy}
            onClick=${()=>action(()=>music.playRemote(r))}>
            <span style="display:block;overflow-wrap:anywhere">${r.name}</span>
            <small style="display:block;color:var(--muted);font-size:11px;margin-top:2px;overflow-wrap:anywhere">${r.artist}</small>
          </button>`)}
        </div>`:null}
        <div style="display:flex;gap:8px;min-width:0">
          <input class="lobby-music-link" value=${link} onInput=${e=>setLink(e.currentTarget.value)} onKeyDown=${e=>{if(e.key==='Enter')playLink();}} placeholder="粘贴网易云歌曲/歌单链接或 ID" aria-label="网易云链接" />
          <${Button} disabled=${!link.trim()||state.busy} onClick=${playLink}>播放链接<//>
        </div>
        <input ref=${input} type="file" accept="audio/*,.mp3,.m4a,.ogg,.wav,.aac,.flac,.webm" hidden onChange=${e=>{const file=e.currentTarget.files?.[0];e.currentTarget.value='';if(file)action(()=>music.upload(file));}} />
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <${Button} disabled=${state.busy} onClick=${()=>input.current?.click()}>${state.busy?'正在导入…':'上传音乐'}<//>
          <${Button} disabled=${!state.name||state.busy} onClick=${()=>action(()=>music.toggle())}>${state.playing?'暂停':'播放'}<//>
          ${results.length?html`<${Button} variant="secondary" disabled=${state.busy} onClick=${()=>action(()=>music.playAll(results))}>顺序播放全部<//>`:null}
          <${Button} disabled=${!state.name||state.busy} variant="secondary" onClick=${()=>action(()=>music.reset())}>恢复默认<//>
        </div>
        <small style="color:var(--muted);font-size:12px;line-height:1.6">音量和静音沿用游戏设置。本地音乐刷新后保留；网易云曲目只记住 ID，播放时重新取地址（地址带签名会过期）。清理浏览器数据会删除本地音乐。</small>
        ${error?html`<p role="alert" style="margin:0;color:#ff9393;overflow-wrap:anywhere">${error}</p>`:null}
      </div>
    <//>`;
}
