// public/js/ui/musicProviders.js — the online half of the lobby music panel (mod: hubmusic)
//
// The page is served under §default-src 'self'§, so this module talks to the game server's own
// /lobby-music/… door (server/lobbyMusic.js) and never to a music platform directly. Every call
// answers JSON; a 404/HTML body means the server module is not installed, which the panel reports
// as one readable sentence instead of a stack trace.

export const PLATFORMS = Object.freeze([
  { id: 'qq', name: 'QQ音乐', short: 'QQ', color: '#31c27c' },
  { id: 'netease', name: '网易云音乐', short: '网易云', color: '#ec4141' },
  { id: 'kuwo', name: '酷我音乐', short: '酷我', color: '#f0c419' },
]);

const BASE = '/lobby-music';
const TIMEOUT_MS = 15000;

/** The display name / short name / accent colour of a platform id. */
export function platformInfo(id) {
  return PLATFORMS.find((p) => p.id === id) || { id, name: String(id || ''), short: String(id || ''), color: '#58d9b5' };
}
const platformOf = platformInfo;

async function call(path, params) {
  const query = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== '') query.set(k, String(v));
  const suffix = query.toString();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(BASE + path + (suffix ? '?' + suffix : ''), {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: ac.signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('连接服务器超时，请稍后再试');
    throw new Error('连不上服务器，请检查网络');
  } finally {
    clearTimeout(timer);
  }
  const type = res.headers.get('content-type') || '';
  if (!type.includes('application/json')) throw new Error('服务器没有安装「在线音乐」服务端组件');
  let body;
  try { body = await res.json(); } catch { throw new Error('服务器返回了无法解析的数据'); }
  if (!body || body.ok !== true) throw new Error(body?.message || '在线音乐服务暂时不可用');
  return body;
}

/** Is the server half installed and reachable? Resolves to the platform list. */
export async function ping() {
  const body = await call('/ping', {});
  return Array.isArray(body.platforms) ? body.platforms : [];
}

/**
 * One page of one platform's search.
 * @param {'qq'|'netease'|'kuwo'} platform
 * @param {string} q
 * @param {number} [page]
 * @returns {Promise<{total:number, items:Array<object>}>}
 */
export async function search(platform, q, page = 1) {
  const body = await call('/search', { platform, q, page });
  return {
    total: Number(body.total) || 0,
    items: (body.items || []).map((item) => ({ ...item, platform })),
  };
}

/** A playable same-origin URL for one track (a short-lived token; re-resolve when playback fails). */
export async function resolve(platform, id, duration = 0) {
  const body = await call('/resolve', { platform, id, duration });
  return { stream: body.stream, type: body.type || 'audio/mpeg' };
}

/** Same-origin cover URL (the server proxies the three platform image hosts). */
export const coverUrl = (raw) => (raw ? BASE + '/cover?u=' + encodeURIComponent(raw) : '');

/**
 * Import a playlist from a share link (or bare id with a platform).
 * @param {'qq'|'netease'|'kuwo'|''} platform
 * @param {string} url
 * @returns {Promise<{platform:string,name:string,cover:string,total:number,limited:boolean,items:Array<object>}>}
 */
export async function playlist(platform, url) {
  const body = await call('/playlist', { platform, url });
  return {
    platform: body.platform,
    name: body.name || '未命名歌单',
    cover: body.cover || '',
    total: Number(body.total) || 0,
    limited: !!body.limited,
    items: (body.items || []).map((item) => ({ ...item, platform: body.platform })),
  };
}

/** Synced lyric lines for a track: [{ t: seconds, text }] (empty when the platform has none). */
export async function lyric(platform, id, track = {}) {
  const body = await call('/lyric', { platform, id, title: track.title, artist: track.artist, duration: track.duration });
  return Array.isArray(body.lines) ? body.lines : [];
}

export { platformOf };

/** 271 -> "4:31"; 0/unknown -> "--:--". */
export function musicTime(seconds) {
  const s = Math.round(Number(seconds) || 0);
  if (!s) return '--:--';
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}
