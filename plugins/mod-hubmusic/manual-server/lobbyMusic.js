// server/lobbyMusic.js — 大厅在线音乐（mod: hubmusic）
//
// Why a server module at all: the lobby page runs under `default-src 'self'` (server/http/csp.js), so
// <audio> may only play same-origin URLs and <img> may only load same-origin covers. This file is that
// one same-origin door:
//
//   GET /lobby-music/ping                       -> { ok, platforms } — the panel probes this first
//   GET /lobby-music/search?platform=&q=&page=  -> { ok, platform, total, items[] }
//   GET /lobby-music/resolve?platform=&id=&duration= -> { ok, stream: '/lobby-music/s/<token>' }
//   GET /lobby-music/s/<token>                  -> the bytes (Range / HEAD forwarded)
//   GET /lobby-music/cover?u=...                -> an album cover (the three platform image hosts)
//
// Three adapters, one shape: QQ音乐, 网易云音乐, 酷我音乐. Only free / non-VIP tracks resolve — QQ
// answers an empty purl for paid songs, NetEase answers url=null, Kuwo serves an 11-second clip —
// and the panel is told which songs are marked 会员 in the search result, so it can hide them.
//
// Nothing is written to disk. Search answers sit in a small in-memory map for ten minutes; a stream
// token (30 min) is minted only from a URL one of these adapters just returned, and only after the
// URL's host is checked against that platform's own CDN. Redirects are followed by hand so a 30x
// cannot lead the proxy off the platform.
//
// (i18n-ignore-file: server diagnostics are Chinese by design)

import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { sendError, sendJson } from './http/common.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PLATFORMS = Object.freeze({ qq: 'QQ音乐', netease: '网易云音乐', kuwo: '酷我音乐' });
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 30;
const PAGE_MAX = 50;
const QUERY_MAX = 80;
const ID_MAX = 32;
const TIMEOUT_MS = 12000;
const STREAM_TIMEOUT_MS = 20000;
const TOKEN_TTL = 30 * 60 * 1000;
const LYRIC_TTL = 6 * 60 * 60 * 1000;
const LYRIC_CACHE_MAX = 300;
const TOKEN_MAX = 3000;
const SEARCH_TTL = 10 * 60 * 1000;
const SEARCH_CACHE_MAX = 240;
const JSON_MAX = 4 * 1024 * 1024;
const COVER_MAX = 4 * 1024 * 1024;

/** An error whose message is fit for the panel. `code` tells the client what kind of refusal it was. */
class MusicError extends Error {
  constructor(message, code = 'UPSTREAM') { super(message); this.name = 'MusicError'; this.code = code; }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(n) ? n : lo));

/** Plain text out of a platform field: tags stripped, the handful of entities those APIs use decoded. */
export function plainText(value, max = 200) {
  return String(value ?? '')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

/** Is `raw` an http(s) URL on one of `suffixes` ('.qqmusic.qq.com' matches a.qqmusic.qq.com)? */
export function hostAllowed(raw, suffixes) {
  let u;
  try { u = new URL(String(raw)); } catch { return false; }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return false;
  const host = u.hostname.toLowerCase();
  if (!host || net.isIP(host)) return false;
  return (suffixes || []).some((s) => {
    const bare = String(s).replace(/^\./, '');
    return host === bare || host.endsWith(String(s));
  });
}

/** The URL an <audio> element can be given: https-only, on the platform's CDN. */
function safeMediaUrl(raw, suffixes) {
  let u;
  try { u = new URL(String(raw)); } catch { throw new MusicError('播放地址无效，换一首试试', 'BAD_URL'); }
  if (u.protocol === 'http:') u.protocol = 'https:';
  if (!hostAllowed(u.href, suffixes)) throw new MusicError('播放地址不在平台白名单内，已拒绝', 'BAD_HOST');
  return u.href;
}

// -------------------------------------------------------------------------------------------------
// upstream plumbing
// -------------------------------------------------------------------------------------------------

/** Read a whole upstream body as text, with a timeout and a hard size cap. */
async function readText(url, headers, timeout = TIMEOUT_MS) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeout);
  try {
    const res = await fetch(url, { headers, signal: ac.signal, redirect: 'follow' });
    const declared = Number(res.headers.get('content-length') || 0);
    if (declared > JSON_MAX) { try { res.body?.cancel(); } catch { /* already gone */ } throw new MusicError('平台返回的数据太大', 'TOO_BIG'); }
    const body = Buffer.from(await res.arrayBuffer());
    if (body.length > JSON_MAX) throw new MusicError('平台返回的数据太大', 'TOO_BIG');
    return { status: res.status, ok: res.ok, text: body.toString('utf8') };
  } catch (e) {
    if (e instanceof MusicError) throw e;
    if (e?.name === 'AbortError') throw new MusicError('连接音乐平台超时，稍后再试', 'TIMEOUT');
    throw new MusicError('连不上音乐平台，请检查服务器网络', 'NETWORK');
  } finally {
    clearTimeout(timer);
  }
}

/** Read a JSON endpoint; a platform that answers HTML (WAF page) becomes one readable error. */
async function readJson(url, headers, timeout = TIMEOUT_MS) {
  const { ok, status, text } = await readText(url, headers, timeout);
  if (!ok) throw new MusicError('音乐平台暂时不可用（HTTP ' + status + '）', 'HTTP_' + status);
  try { return JSON.parse(text); } catch { throw new MusicError('音乐平台返回了无法解析的数据', 'BAD_JSON'); }
}

// -------------------------------------------------------------------------------------------------
// adapters
// -------------------------------------------------------------------------------------------------

const QQ_HEADERS = Object.freeze({ 'User-Agent': UA, Referer: 'https://y.qq.com/', 'Accept-Language': 'zh-CN,zh;q=0.9' });
const NE_HEADERS = Object.freeze({ 'User-Agent': UA, Referer: 'https://music.163.com/' });
const KW_HEADERS = Object.freeze({ 'User-Agent': UA, Referer: 'https://www.kuwo.cn/', 'Accept-Language': 'zh-CN,zh;q=0.9' });

/** One song from QQ's musicu playlist payload (the public share API). */
function qqPlaylistItem(s) {
  const albumMid = String(s?.album?.mid || s?.album?.pmid || '').replace(/_1$/, '');
  const singers = Array.isArray(s?.singer) ? s.singer : [];
  return {
    id: String(s?.mid || ''),
    title: plainText(s?.name || s?.title, 90),
    artist: singers.map((x) => plainText(typeof x === 'string' ? x : x?.name, 60)).filter(Boolean).join(' / '),
    album: plainText(s?.album?.name, 80),
    duration: Number(s?.interval) || 0,
    cover: albumMid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + encodeURIComponent(albumMid) + '.jpg' : '',
    restricted: Number(s?.pay?.pay_play) === 1,
  };
}

/** One QQ song (search result or playlist entry) -> the panel's item shape. */
function qqItem(s) {
  return {
    id: String(s.songmid || ''),
    title: plainText(s.songname),
    artist: (s.singer || []).map((x) => plainText(x.name, 60)).filter(Boolean).join(' / '),
    album: plainText(s.albumname, 80),
    duration: Number(s.interval) || 0,
    cover: s.albummid ? 'https://y.gtimg.cn/music/photo_new/T002R300x300M000' + encodeURIComponent(String(s.albummid)) + '.jpg' : '',
    restricted: !!(s.pay && Number(s.pay.payplay) === 1),
  };
}

async function searchQQ(term, page, limit) {
  const url = 'https://c.y.qq.com/soso/fcgi-bin/search_for_qq_cp?w=' + encodeURIComponent(term)
    + '&p=' + page + '&n=' + limit + '&format=json&inCharset=utf8&outCharset=utf-8';
  const j = await readJson(url, QQ_HEADERS);
  const song = j?.data?.song;
  if (!song || !Array.isArray(song.list)) throw new MusicError('QQ 音乐没有返回搜索结果', 'EMPTY');
  return { total: Number(song.totalnum) || 0, items: song.list.map(qqItem) };
}

async function resolveQQ(id) {
  const payload = {
    req_0: {
      module: 'vkey.GetVkeyServer', method: 'CgiGetVkey',
      param: { guid: '10000', songmid: [id], songtype: [0], uin: '0', loginflag: 1, platform: '20' },
    },
    comm: { uin: 0, format: 'json', ct: 24, cv: 0 },
  };
  const j = await readJson('https://u.y.qq.com/cgi-bin/musicu.fcg?format=json&data=' + encodeURIComponent(JSON.stringify(payload)), QQ_HEADERS);
  const info = j?.req_0?.data?.midurlinfo?.[0];
  const purl = info?.purl ? String(info.purl) : '';
  if (!purl) {
    if (Number(info?.result) === 104003) throw new MusicError('这首歌需要会员或已被版权限制，换一首免费曲目试试', 'PAID');
    throw new MusicError('QQ 音乐没有给出播放地址，换一首试试', 'NO_URL');
  }
  const raw = /^https?:/i.test(purl) ? purl : 'https://ws.stream.qqmusic.qq.com/' + purl.replace(/^\/+/, '');
  const url = safeMediaUrl(raw, ['.qqmusic.qq.com', '.gtimg.cn']);
  return { url, hosts: ['.qqmusic.qq.com', '.gtimg.cn'], type: /\.m4a(?:$|[?&])/i.test(url) ? 'audio/mp4' : 'audio/mpeg' };
}

/** NetEase's search payload has no cover URL; one batched detail call fills the gaps and is cached. */
const nePics = new Map();
async function neteasePics(ids) {
  const out = new Map();
  const missing = [];
  for (const id of ids) {
    const hit = nePics.get(String(id));
    if (hit) out.set(String(id), hit);
    else missing.push(id);
  }
  if (!missing.length) return out;
  try {
    const j = await readJson('https://music.163.com/api/song/detail?ids=[' + missing.map((x) => Number(x) || 0).join(',') + ']', NE_HEADERS, 8000);
    for (const s of j?.songs || []) {
      const pic = String(s?.album?.picUrl || '').replace(/^http:/, 'https:');
      if (pic) {
        nePics.set(String(s.id), pic);
        out.set(String(s.id), pic);
      }
    }
    while (nePics.size > 600) nePics.delete(nePics.keys().next().value);
  } catch { /* covers are decoration; a search must not fail for them */ }
  return out;
}

/** One NetEase song (search / playlist / detail) -> the panel's item shape. */
function neItem(s, pics) {
  const artists = s.ar || s.artists || [];
  const pic = (pics && pics.get(String(s.id))) || String(s.album?.picUrl || '').replace(/^http:/, 'https:');
  return {
    id: String(s.id || ''),
    title: plainText(s.name),
    artist: artists.map((x) => plainText(x.name, 60)).filter(Boolean).join(' / '),
    album: plainText(s.album?.name, 80),
    duration: Math.round((Number(s.duration ?? s.dt) || 0) / 1000),
    cover: pic || '',
    restricted: [1, 4].includes(Number(s.fee ?? s.privilege?.fee ?? 0)),
  };
}

async function searchNetEase(term, page, limit) {
  const offset = (page - 1) * limit;
  const url = 'https://music.163.com/api/search/get/web?s=' + encodeURIComponent(term)
    + '&type=1&offset=' + offset + '&limit=' + limit;
  const j = await readJson(url, NE_HEADERS);
  const songs = j?.result?.songs;
  if (!Array.isArray(songs)) throw new MusicError('网易云音乐没有返回搜索结果', 'EMPTY');
  const pics = await neteasePics(songs.map((s) => s.id));
  return { total: Number(j?.result?.songCount) || 0, items: songs.map((s) => neItem(s, pics)) };
}

async function resolveNetEase(id) {
  for (const br of [320000, 192000, 128000]) {
    const j = await readJson('https://music.163.com/api/song/enhance/player/url?ids=[' + encodeURIComponent(id) + ']&br=' + br, NE_HEADERS);
    const d = j?.data?.[0];
    if (d?.url) {
      const url = safeMediaUrl(String(d.url), ['.music.126.net']);
      return { url, hosts: ['.music.126.net'], type: /\.flac(?:$|[?&])/i.test(url) ? 'audio/flac' : 'audio/mpeg' };
    }
    // -110 / null means the account-less caller may not have it at any bitrate; lower ones will not help
    if (d && (d.url === null || Number(d.code) === -110 || Number(d.code) === 404)) break;
  }
  throw new MusicError('这首歌需要会员，或已下架；换一首免费曲目试试', 'PAID');
}

async function searchKuwo(term, page, limit) {
  const url = 'https://search.kuwo.cn/r.s?client=kt&all=' + encodeURIComponent(term)
    + '&pn=' + (page - 1) + '&rn=' + limit
    + '&uid=0&ver=kwplayer_ar_9.2.2.1&vipver=1&show_copyright_off=1&newver=1&ft=music&cluster=0&strategy=2012'
    + '&encoding=utf8&rformat=json&vermerge=1&mobi=1';
  const j = await readJson(url, KW_HEADERS);
  const list = j?.abslist;
  if (!Array.isArray(list)) throw new MusicError('酷我音乐没有返回搜索结果', 'EMPTY');
  return {
    total: Number(j?.TOTAL) || 0,
    items: list.map((s) => {
      const pic = String(s.web_albumpic_short || '').replace(/^\/+/, '');
      const safePic = /^[\w./-]+$/.test(pic) ? pic : '';
      return {
        id: String(s.MUSICRID || '').replace(/^MUSIC_/, ''),
        title: plainText(s.SONGNAME),
        artist: plainText(s.ARTIST, 80),
        album: plainText(s.ALBUM, 80),
        duration: Number(s.DURATION) || 0,
        cover: safePic ? 'https://img1.kuwo.cn/star/albumcover/' + safePic : '',
        // 16711935 is the flag 酷我 puts on a track the web player only previews (11 s)
        restricted: String(s.PAY) === '16711935',
      };
    }),
  };
}

/** Total byte size of a media URL; 0 when the upstream does not say (that is not an error). */
async function probeSize(url, headers) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 8000);
  try {
    const res = await fetch(url, { headers: { ...headers, Range: 'bytes=0-0' }, signal: ac.signal });
    const range = res.headers.get('content-range') || '';
    const total = Number(/\/(\d+)\s*$/.exec(range)?.[1] || res.headers.get('content-length') || 0);
    try { res.body?.cancel(); } catch { /* already gone */ }
    return Number.isFinite(total) ? total : 0;
  } catch { return 0; } finally { clearTimeout(timer); }
}

async function resolveKuwo(id, duration) {
  let url = '';
  try {
    const j = await readJson('https://antiserver.kuwo.cn/anti.s?type=convert_url3&rid=' + encodeURIComponent(id) + '&format=mp3&response=url', KW_HEADERS);
    url = String(j?.url || '');
  } catch { /* the redirect form below is the fallback */ }
  if (!url) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const res = await fetch('https://antiserver.kuwo.cn/anti.s?type=convert_url&rid=MUSIC_' + encodeURIComponent(id) + '&format=mp3&response=url', { headers: KW_HEADERS, redirect: 'manual', signal: ac.signal });
      url = res.headers.get('location') || '';
      try { res.body?.cancel(); } catch { /* already gone */ }
    } catch { /* handled below */ } finally { clearTimeout(timer); }
  }
  if (!url) throw new MusicError('这首歌暂时拿不到播放地址（可能需要会员）', 'PAID');
  const safe = safeMediaUrl(url, ['.kuwo.cn']);
  const size = await probeSize(safe, KW_HEADERS);
  // 128 kbps ≈ 16 kB/s; a 30 s track is ~480 kB, the 11 s preview clip is ~180 kB.
  const expected = Number(duration) > 30 ? Number(duration) * 16000 : 0;
  if (expected && size && size < expected * 0.25) throw new MusicError('这是会员曲目的试听片段，换一首免费曲目试试', 'PREVIEW');
  return { url: safe, hosts: ['.kuwo.cn'], type: 'audio/mpeg' };
}

/**
 * LRC text -> [{ t: seconds, text }]. Metadata tags ([ti:] …) have no timestamp and are skipped; a line
 * carrying several tags (a chorus repeated at different times) yields one entry per tag. Duplicate
 * timestamps are merged with ' / ', and the result is capped at 300 lines.
 * @param {unknown} raw
 * @returns {{ t: number, text: string, tr?: string }[]}
 */
export function parseLrc(raw) {
  const rows = [];
  for (const line of String(raw || '').split(/\r?\n/)) {
    const tags = [...line.matchAll(/\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g)];
    if (!tags.length) continue;
    const text = line.replace(/\[[^\]]*\]/g, '').trim().slice(0, 240);
    if (!text) continue;
    for (const m of tags) {
      const fraction = String(m[3] || '');
      const ms = fraction ? Number(fraction) * (fraction.length === 1 ? 100 : fraction.length === 2 ? 10 : 1) : 0;
      rows.push({ t: Math.max(0, Number(m[1]) * 60 + Number(m[2]) + ms / 1000), text });
    }
  }
  rows.sort((a, b) => a.t - b.t);
  const out = [];
  for (const row of rows) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.t - row.t) < 0.02) last.text = (last.text + ' / ' + row.text).slice(0, 260);
    else out.push(row);
  }
  return out.slice(0, 300);
}

function isCreditLine(text) {
  return /^(作词|作詞|作曲|编曲|編曲|制作人|製作人|词|曲|OP|SP|混音|母带|母帶|吉他|贝斯|鼓|和声|和聲|录音|錄音|监制|監製|出品|发行|發行|统筹|企划|封面|设计|经纪|版权)\s*[:：]/i.test(String(text || '').trim());
}

/**
 * Attach translated LRC lines to the original ones.
 * Translations often start at the first lyric while the original has credit lines first, so a raw
 * timestamp match puts the translation on "作词 : …". Drop credits on both sides, then align by index
 * when the counts are close (the usual case), otherwise by nearest timestamp.
 */
function withTranslation(lines, raw) {
  const trans = parseLrc(raw).filter((x) => !isCreditLine(x.text));
  if (!lines.length || !trans.length) return lines;
  const orig = lines.filter((x) => !isCreditLine(x.text));
  if (!orig.length) return lines;
  const map = new Map();
  if (Math.abs(orig.length - trans.length) <= 2) {
    for (let i = 0; i < Math.min(orig.length, trans.length); i++) map.set(orig[i], trans[i].text);
  } else {
    for (const line of orig) {
      let best = '';
      let gap = 2;
      for (const x of trans) {
        const d = Math.abs(x.t - line.t);
        if (d <= gap) { gap = d; best = x.text; }
      }
      if (best) map.set(line, best);
    }
  }
  return lines.map((line) => {
    const tr = map.get(line);
    return tr && tr !== line.text ? { ...line, tr } : line;
  });
}

async function lyricQQ(id, title, artist, duration) {
  const url = 'https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=' + encodeURIComponent(id)
    + '&format=json&nobase64=1&g_tk=5381';
  const j = await readJson(url, QQ_HEADERS, 8000);
  const lines = withTranslation(parseLrc(j?.lyric || ''), j?.trans || '');
  if (lines.some((x) => x.tr) || !title) return lines;
  // QQ rarely carries a translation in this payload; borrow the same song's NetEase lyric.
  try {
    const ne = await neteaseLyricByMeta(title, artist, duration);
    if (ne.length && (!lines.length || ne.some((x) => x.tr))) return ne;
  } catch { /* keep QQ's own lines */ }
  return lines;
}

async function lyricNetEase(id) {
  const url = 'https://music.163.com/api/song/lyric?id=' + encodeURIComponent(id) + '&lv=1&kv=1&tv=-1';
  const j = await readJson(url, NE_HEADERS, 8000);
  return withTranslation(parseLrc(j?.lrc?.lyric || ''), j?.tlyric?.lyric || '');
}

/** Lower-case, drop spaces / punctuation / brackets: "晴天 (Live)" and "晴天（Live）" compare equal. */
function nameKey(value) {
  return String(value || '').toLowerCase().replace(/[\s\-_.·'",，。！？!?()[\]【】《》<>/\\]+/g, '');
}

/**
 * Kuwo's own lyric endpoints need a browser signature these days. Fall back to the same song on
 * NetEase, matched by title + artist + length; a cover with the same duration still carries the right
 * words, which is all the lyrics panel needs.
 */
/** Find the same song on NetEase (title + artist + length) and return its lyric, translation included. */
async function neteaseLyricByMeta(title, artist, duration) {
  const term = [plainText(title, 80), plainText(artist, 60)].filter(Boolean).join(' ').trim();
  if (!term) return [];
  let found;
  try { found = await searchNetEase(term, 1, 10); } catch { return []; }
  const wantTitle = nameKey(title);
  const wantArtist = nameKey(artist);
  let best = null;
  let bestScore = -1;
  for (const item of found.items) {
    let score = 0;
    if (wantTitle && nameKey(item.title) === wantTitle) score += 3;
    else if (wantTitle && (nameKey(item.title).includes(wantTitle) || wantTitle.includes(nameKey(item.title)))) score += 1;
    if (wantArtist && (nameKey(item.artist).includes(wantArtist) || wantArtist.includes(nameKey(item.artist)))) score += 2;
    if (duration > 0 && item.duration > 0 && Math.abs(item.duration - duration) <= 3) score += 2;
    if (score > bestScore) { bestScore = score; best = item; }
  }
  if (!best || bestScore < 3) return [];
  try { return await lyricNetEase(best.id); } catch { return []; }
}

async function lyricKuwo(id, title, artist, duration) {
  try {
    const j = await readJson('https://m.kuwo.cn/newh5/singles/songinfoandlrc?musicId=' + encodeURIComponent(id) + '&httpsStatus=1', KW_HEADERS, 6000);
    const list = j?.data?.lrclist;
    if (Array.isArray(list) && list.length) {
      const lines = list
        .map((x) => ({ t: Number(x.time) || 0, text: plainText(x.lineLyric, 240) }))
        .filter((x) => x.text)
        .sort((a, b) => a.t - b.t)
        .slice(0, 300);
      if (lines.length) {
        if (title) {
          try {
            const ne = await neteaseLyricByMeta(title, artist, duration);
            if (ne.some((x) => x.tr)) return ne;
          } catch { /* keep Kuwo's own lines */ }
        }
        return lines;
      }
    }
  } catch { /* fall through to the NetEase match */ }
  return neteaseLyricByMeta(title, artist, duration);
}

// -------------------------------------------------------------------------------------------------
// playlists (导入歌单)
// -------------------------------------------------------------------------------------------------

/** Split a JS argument list on top-level commas (strings and brackets respected). */
function splitTopLevel(text) {
  const out = [];
  let depth = 0;
  let start = 0;
  let quote = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') depth--;
    else if (ch === ',' && depth === 0) { out.push(text.slice(start, i)); start = i + 1; }
  }
  out.push(text.slice(start));
  return out.map((s) => s.trim()).filter(Boolean);
}

/** A JS literal as it appears in Kuwo's Nuxt payload (never executed, only parsed). */
function jsLiteral(raw) {
  const t = String(raw || '').trim();
  if (!t) return undefined;
  if (t[0] === '"') {
    try { return JSON.parse(t); } catch { return t.slice(1, -1); }
  }
  if (t[0] === "'") return t.slice(1, -1).replace(/\\'/g, "'");
  if (/^-?\d+(?:\.\d+)?$/.test(t)) return Number(t);
  if (t === 'true' || t === '!0') return true;
  if (t === 'false' || t === '!1') return false;
  if (t === 'null' || t === 'void 0') return null;
  return undefined;
}

/** Value of one field in a Kuwo song object; nested objects keep payInfo etc. out of the way. */
function kuwoField(object, key) {
  const re = new RegExp('(?:^|[,{])' + key + ':');
  const m = re.exec(object);
  if (!m) return { raw: '', value: undefined };
  let p = m.index + m[0].length;
  while (p < object.length && /\s/.test(object[p])) p++;
  if (object[p] === '"' || object[p] === "'") {
    const quote = object[p];
    let i = p + 1;
    while (i < object.length) {
      if (object[i] === '\\') i += 2;
      else if (object[i] === quote) break;
      else i++;
    }
    const raw = object.slice(p, i + 1);
    return { raw, value: jsLiteral(raw) };
  }
  let i = p;
  while (i < object.length && !/[,}]/.test(object[i])) i++;
  const raw = object.slice(p, i).trim();
  return { raw, value: jsLiteral(raw) };
}

/**
 * Kuwo's playlist page is server-rendered Nuxt: a function (function(a,b,...){...}(args))
 * where song fields refer to the arguments by letter. Parse the argument list into a map and
 * resolve those names — parsing literals, never evaluating the payload.
 * Only the first page (~20 songs) is in the HTML; the rest is fetched by the website's signed API.
 * @param {string} html
 */
function parseKuwoPlaylist(html) {
  const from = html.indexOf('__NUXT__=');
  const to = html.indexOf('</script>', from);
  if (from < 0 || to < 0) throw new MusicError('酷我歌单页面解析失败', 'PARSE');
  const nuxt = html.slice(from, to);
  const params = (/function\(([^)]*)\)/.exec(nuxt)?.[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
  const call = nuxt.lastIndexOf('}(');
  if (call < 0 || !params.length) throw new MusicError('酷我歌单页面解析失败', 'PARSE');
  const argsText = nuxt.slice(call + 2, nuxt.lastIndexOf(')'));
  const args = splitTopLevel(argsText);
  const env = new Map();
  params.forEach((name, i) => env.set(name, jsLiteral(args[i])));
  const at = nuxt.indexOf('musicList:[');
  if (at < 0) throw new MusicError('这个酷我歌单是空的，或需要登录才能查看', 'EMPTY');
  const objects = [];
  let depth = 0;
  let quote = '';
  let start = -1;
  for (let i = at + 'musicList:['.length; i < nuxt.length; i++) {
    const ch = nuxt[i];
    if (quote) {
      if (ch === '\\') i++;
      else if (ch === quote) quote = '';
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === '{') { if (depth === 0) start = i; depth++; }
    else if (ch === '}') { depth--; if (depth === 0 && start >= 0) { objects.push(nuxt.slice(start, i + 1)); start = -1; } }
    else if (ch === ']' && depth === 0) break;
  }
  const value = (key, object) => {
    const f = kuwoField(object, key);
    if (f.value !== undefined) return f.value;
    const name = String(f.raw || '').trim();
    return /^[A-Za-z_$][\w$]*$/.test(name) ? env.get(name) : undefined;
  };
  const items = objects.map((object) => {
    const rid = /musicrid:"MUSIC_(\d+)"/.exec(object)?.[1] || String(value('rid', object) || '');
    return {
      id: String(rid),
      title: plainText(value('name', object), 90),
      artist: plainText(value('artist', object), 80),
      album: plainText(value('album', object), 80),
      duration: Number(value('duration', object)) || 0,
      cover: String(value('pic120', object) || '').replace(/^http:/, 'https:'),
      restricted: String(value('pay', object) ?? '') === '16711935',
    };
  }).filter((x) => x.id);
  const head = nuxt.slice(0, at);
  const headValue = (key) => { const f = kuwoField(head, key); if (f.value !== undefined) return f.value; const name = String(f.raw || '').trim(); return /^[A-Za-z_$][\w$]*$/.test(name) ? env.get(name) : undefined; };
  const titleTag = /<title>([^<]+)<\/title>/.exec(html)?.[1] || '';
  const name = plainText(headValue('name'), 80) || plainText(titleTag.replace(/_酷我音乐$/, '').split('_')[0], 80);
  const cover = String(headValue('img700') || headValue('img300') || items[0]?.cover || '').replace(/^http:/, 'https:');
  const total = Number(headValue('total')) || items.length;
  return { name: name || '酷我歌单', cover, total, items, limited: true };
}

async function playlistQQ(id) {
  // The old fcg_ucc_getcdinfo endpoint privacy-checks guest requests even for public share
  // playlists ("check privacy error!"), which looked like a login wall. The musicu endpoint
  // used by the share page returns public playlists without a cookie.
  const body = JSON.stringify({
    comm: { ct: 24, cv: 0, uin: '0' },
    req_1: {
      module: 'music.srfDissInfo.aiDissInfo',
      method: 'uniform_get_Dissinfo',
      param: { disstid: Number(id) || 0, enc_host_uin: '', tag: 1, userinfo: 1, song_begin: 0, song_num: 300 },
    },
  });
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15000);
  let j;
  try {
    const res = await fetch('https://u.y.qq.com/cgi-bin/musicu.fcg', {
      method: 'POST',
      headers: { ...QQ_HEADERS, 'Content-Type': 'application/json' },
      body,
      signal: ac.signal,
    });
    if (!res.ok) throw new MusicError('QQ 音乐接口暂时不可用（HTTP ' + res.status + '）', 'HTTP_' + res.status);
    j = await res.json();
  } catch (e) {
    if (e instanceof MusicError) throw e;
    throw new MusicError('QQ 音乐接口连接失败，稍后再试', 'NETWORK');
  } finally { clearTimeout(timer); }
  const data = j?.req_1?.data;
  const songs = Array.isArray(data?.songlist) ? data.songlist : [];
  if (!songs.length) {
    const msg = String(j?.req_1?.msg || data?.msg || '');
    if (/privacy|login|登录/i.test(msg)) throw new MusicError('这个 QQ音乐歌单不是公开歌单；在 QQ音乐里设为公开后再导入', 'PRIVATE');
    throw new MusicError('QQ 音乐没有返回这个歌单（可能已删除，或不是公开歌单）', 'EMPTY');
  }
  const items = songs.slice(0, 300).map(qqPlaylistItem).filter((x) => x.id);
  if (!items.length) throw new MusicError('这个 QQ音乐歌单里没有可播放的曲目', 'EMPTY');
  const total = Number(data?.dirinfo?.songnum) || Number(data?.total_song_num) || items.length;
  return {
    name: plainText(data?.dirinfo?.title, 80) || 'QQ音乐歌单',
    cover: items[0].cover,
    total,
    items,
    limited: total > items.length,
  };
}

async function playlistNetEase(id) {
  const j = await readJson('https://music.163.com/api/v6/playlist/detail?id=' + encodeURIComponent(id) + '&n=1000&s=0', NE_HEADERS, 15000);
  const p = j?.playlist;
  if (!p) throw new MusicError('网易云音乐没有返回这个歌单（私密歌单请先在网易云里设为公开）', 'EMPTY');
  let tracks = Array.isArray(p.tracks) ? p.tracks.slice() : [];
  const allIds = (Array.isArray(p.trackIds) ? p.trackIds : []).map((x) => Number(x?.id) || 0).filter(Boolean);
  if (tracks.length < allIds.length && tracks.length < 300) {
    const have = new Set(tracks.map((t) => Number(t.id) || 0));
    const missing = allIds.filter((x) => !have.has(x)).slice(0, 300 - tracks.length);
    for (let i = 0; i < missing.length; i += 100) {
      const d = await readJson('https://music.163.com/api/song/detail?ids=[' + missing.slice(i, i + 100).join(',') + ']', NE_HEADERS, 10000);
      if (Array.isArray(d?.songs)) tracks = tracks.concat(d.songs);
    }
  }
  const chosen = tracks.slice(0, 300);
  const pics = await neteasePics(chosen.map((s) => s.id));
  const items = chosen.map((s) => neItem(s, pics)).filter((x) => x.id);
  if (!items.length) throw new MusicError('这个网易云歌单是空的，或需要登录才能查看', 'EMPTY');
  return {
    name: plainText(p.name, 80) || '网易云歌单',
    cover: String(p.coverImgUrl || '').replace(/^http:/, 'https:'),
    total: Number(p.trackCount) || items.length,
    items,
    limited: Number(p.trackCount) > items.length,
  };
}

async function playlistKuwo(id) {
  const page = await readText('https://m.kuwo.cn/h5app/playlist/' + encodeURIComponent(id), { 'User-Agent': MOBILE_UA, Referer: 'https://m.kuwo.cn/' }, 15000);
  if (!page.ok) throw new MusicError('这个酷我歌单打不开（HTTP ' + page.status + '）', 'HTTP_' + page.status);
  return parseKuwoPlaylist(page.text);
}

/** A share link / bare id -> { platform, id }, or null when it is not a playlist link. */
export function playlistRef(raw, platformHint) {
  const s = String(raw || '').trim().slice(0, 500);
  if (!s) return null;
  const hint = ['qq', 'netease', 'kuwo'].includes(platformHint) ? platformHint : '';
  if (/^\d{5,}$/.test(s)) return hint ? { platform: hint, id: s } : null;
  // A share sheet often pastes a sentence around the link; pull the first URL out of it.
  const link = /^https?:/i.test(s) ? s : (/(https?:\/\/[^\s"'<>]+)/.exec(s)?.[1] || 'https://' + s);
  let host = '';
  try { host = new URL(link).hostname.toLowerCase(); } catch { host = ''; }
  let platform = hint;
  if (!platform) {
    if (/(^|\.)kuwo\.cn$/.test(host)) platform = 'kuwo';
    else if (/(^|\.)(music\.163\.com|163\.com|163cn\.tv)$/.test(host)) platform = 'netease';
    else if (/(^|\.)(y\.qq\.com|qq\.com|c6\.y\.qq\.com)$/.test(host)) platform = 'qq';
  }
  if (!platform) return null;
  const pick = (re) => re.exec(link)?.[1] || '';
  let id = '';
  if (platform === 'kuwo') id = pick(/playlist_detail\/(\d{5,})/) || pick(/h5app\/playlist\/(\d{5,})/) || pick(/[?&](?:pid|id)=(\d{5,})/);
  else if (platform === 'netease') id = pick(/[?&#]id=(\d{5,})/) || pick(/playlist\/(\d{5,})/);
  else id = pick(/playlist\/(\d{5,})/) || pick(/[?&](?:id|disstid)=(\d{5,})/);
  return id ? { platform, id } : null;
}

/** NetEase / QQ share short links: follow up to three hops, staying on those two hosts. */
async function expandPlaylistLink(raw) {
  let u;
  try { u = new URL(raw); } catch { return raw; }
  if (!/(^|\.)(163cn\.tv|c6\.y\.qq\.com)$/.test(u.hostname.toLowerCase())) return raw;
  let current = u.href;
  for (let hop = 0; hop < 5; hop++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    let res;
    try { res = await fetch(current, { headers: { 'User-Agent': UA }, redirect: 'manual', signal: ac.signal }); }
    catch { return current; }
    finally { clearTimeout(timer); }
    const loc = res.headers.get('location');
    try { res.body?.cancel(); } catch { /* ignore */ }
    if (!loc) return current;
    current = new URL(loc, current).href;
    let next;
    try { next = new URL(current); } catch { return current; }
    if (!/(^|\.)(163cn\.tv|music\.163\.com|c6\.y\.qq\.com|y\.qq\.com)$/.test(next.hostname.toLowerCase())) return current;
  }
  return current;
}

const SEARCHERS = Object.freeze({ qq: searchQQ, netease: searchNetEase, kuwo: searchKuwo });
const RESOLVERS = Object.freeze({ qq: resolveQQ, netease: resolveNetEase, kuwo: resolveKuwo });
const REFERERS = Object.freeze({ qq: 'https://y.qq.com/', netease: 'https://music.163.com/', kuwo: 'https://www.kuwo.cn/' });

// -------------------------------------------------------------------------------------------------
// search cache, rate limit, stream tokens
// -------------------------------------------------------------------------------------------------

const searchCache = new Map();
const lyricCache = new Map();
const playlistCache = new Map();
function cacheGet(key) {
  const hit = searchCache.get(key);
  if (!hit) return null;
  if (hit.expires <= Date.now()) { searchCache.delete(key); return null; }
  searchCache.delete(key);
  searchCache.set(key, hit);
  return hit.value;
}
function cacheSet(key, value) {
  searchCache.set(key, { value, expires: Date.now() + SEARCH_TTL });
  while (searchCache.size > SEARCH_CACHE_MAX) searchCache.delete(searchCache.keys().next().value);
}

const buckets = new Map();
/** Small per-address token bucket: a person clicks slower than this, a loop does not. */
function allow(ip, rate = 4, burst = 16) {
  const now = Date.now();
  let b = buckets.get(ip);
  if (!b) { b = { tokens: burst, at: now }; buckets.set(ip, b); }
  b.tokens = Math.min(burst, b.tokens + ((now - b.at) / 1000) * rate);
  b.at = now;
  if (buckets.size > 4000) for (const [k, v] of buckets) if (now - v.at > 10 * 60 * 1000) buckets.delete(k);
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

const tokens = new Map();
function pruneTokens(now = Date.now()) {
  for (const [k, v] of tokens) if (v.expires <= now) tokens.delete(k);
  while (tokens.size > TOKEN_MAX) tokens.delete(tokens.keys().next().value);
}
function putToken(entry) {
  pruneTokens();
  const token = randomBytes(18).toString('hex');
  tokens.set(token, { ...entry, expires: Date.now() + TOKEN_TTL });
  return token;
}

// -------------------------------------------------------------------------------------------------
// handlers
// -------------------------------------------------------------------------------------------------

const ipOf = (req) => String(req.socket?.remoteAddress || '');

async function handleSearch(req, res, q) {
  const platform = String(q.get('platform') || '');
  if (!SEARCHERS[platform]) { sendJson(req, res, 200, { ok: false, error: 'PLATFORM', message: '不认识这个音乐平台' }); return; }
  const term = String(q.get('q') || '').replace(/\s+/g, ' ').trim().slice(0, QUERY_MAX);
  if (!term) { sendJson(req, res, 200, { ok: true, platform, page: 1, total: 0, items: [] }); return; }
  const page = clamp(parseInt(q.get('page'), 10) || 1, 1, PAGE_MAX);
  const limit = clamp(parseInt(q.get('limit'), 10) || DEFAULT_LIMIT, 1, MAX_LIMIT);
  const key = platform + '|' + term.toLowerCase() + '|' + page + '|' + limit;
  const cached = cacheGet(key);
  if (cached) { sendJson(req, res, 200, cached); return; }
  if (!allow(ipOf(req))) {
    sendJson(req, res, 200, { ok: false, error: 'RATE', message: '搜索太频繁了，稍等几秒再试' });
    return;
  }
  try {
    const out = await SEARCHERS[platform](term, page, limit);
    const body = { ok: true, platform, page, limit, total: out.total, items: out.items.filter((x) => x.id) };
    cacheSet(key, body);
    sendJson(req, res, 200, body);
  } catch (e) {
    sendJson(req, res, 200, {
      ok: false, error: e?.code || 'UPSTREAM', platform,
      message: e instanceof MusicError ? e.message : '搜索失败，稍后再试',
    });
  }
}

async function handleResolve(req, res, q) {
  const platform = String(q.get('platform') || '');
  const resolver = RESOLVERS[platform];
  if (!resolver) { sendJson(req, res, 200, { ok: false, error: 'PLATFORM', message: '不认识这个音乐平台' }); return; }
  const id = String(q.get('id') || '').trim().slice(0, ID_MAX);
  const idOk = platform === 'qq' ? /^[0-9A-Za-z]{10,24}$/.test(id) : /^\d{1,20}$/.test(id);
  if (!idOk) { sendJson(req, res, 200, { ok: false, error: 'ID', message: '曲目编号无效' }); return; }
  if (!allow(ipOf(req))) {
    sendJson(req, res, 200, { ok: false, error: 'RATE', message: '操作太频繁了，稍等几秒再试' });
    return;
  }
  const duration = clamp(parseInt(q.get('duration'), 10) || 0, 0, 7200);
  try {
    const out = await resolver(id, duration);
    const token = putToken({
      url: out.url,
      hosts: out.hosts,
      type: out.type,
      headers: { Referer: REFERERS[platform] },
    });
    sendJson(req, res, 200, { ok: true, platform, stream: '/lobby-music/s/' + token, type: out.type });
  } catch (e) {
    sendJson(req, res, 200, {
      ok: false, error: e?.code || 'RESOLVE', platform,
      message: e instanceof MusicError ? e.message : '拿不到播放地址，换一首试试',
    });
  }
}

async function handleLyric(req, res, q) {
  const platform = String(q.get('platform') || '');
  if (!RESOLVERS[platform]) { sendJson(req, res, 200, { ok: false, error: 'PLATFORM', message: '不认识这个音乐平台' }); return; }
  const id = String(q.get('id') || '').trim().slice(0, ID_MAX);
  const idOk = platform === 'qq' ? /^[0-9A-Za-z]{10,24}$/.test(id) : /^\d{1,20}$/.test(id);
  if (!idOk) { sendJson(req, res, 200, { ok: false, error: 'ID', message: '曲目编号无效' }); return; }
  const key = platform + ':' + id;
  const hit = lyricCache.get(key);
  if (hit && hit.expires > Date.now()) { sendJson(req, res, 200, hit.value); return; }
  if (!allow(ipOf(req), 3, 12)) {
    sendJson(req, res, 200, { ok: false, error: 'RATE', message: '操作太频繁了，稍等几秒再试' });
    return;
  }
  const title = String(q.get('title') || '').slice(0, 80);
  const artist = String(q.get('artist') || '').slice(0, 80);
  const duration = clamp(parseInt(q.get('duration'), 10) || 0, 0, 7200);
  try {
    const lines = platform === 'qq' ? await lyricQQ(id, title, artist, duration)
      : platform === 'netease' ? await lyricNetEase(id)
        : await lyricKuwo(id, title, artist, duration);
    const body = { ok: true, platform, lines };
    lyricCache.set(key, { value: body, expires: Date.now() + LYRIC_TTL });
    while (lyricCache.size > LYRIC_CACHE_MAX) lyricCache.delete(lyricCache.keys().next().value);
    sendJson(req, res, 200, body);
  } catch (e) {
    sendJson(req, res, 200, { ok: false, error: e?.code || 'LYRIC', message: '暂时取不到歌词' });
  }
}

async function handlePlaylist(req, res, q) {
  const platformHint = String(q.get('platform') || '');
  const raw = String(q.get('url') || q.get('id') || '').trim().slice(0, 500);
  if (!raw) { sendJson(req, res, 200, { ok: false, error: 'EMPTY', message: '请粘贴歌单链接' }); return; }
  if (!allow(ipOf(req), 2, 6)) {
    sendJson(req, res, 200, { ok: false, error: 'RATE', message: '导入太频繁了，稍等几秒再试' });
    return;
  }
  let expanded = raw;
  try { expanded = await expandPlaylistLink(raw); } catch { /* keep the original */ }
  const ref = playlistRef(expanded, platformHint);
  if (!ref) {
    sendJson(req, res, 200, { ok: false, error: 'LINK', message: '没有认出歌单链接：支持 QQ音乐 / 网易云 / 酷我的歌单分享链接' });
    return;
  }
  const key = ref.platform + ':' + ref.id;
  const hit = playlistCache.get(key);
  if (hit && hit.expires > Date.now()) { sendJson(req, res, 200, hit.value); return; }
  try {
    const out = ref.platform === 'qq' ? await playlistQQ(ref.id)
      : ref.platform === 'netease' ? await playlistNetEase(ref.id)
        : await playlistKuwo(ref.id);
    const body = { ok: true, platform: ref.platform, name: out.name, cover: out.cover, total: out.total, items: out.items, limited: !!out.limited };
    playlistCache.set(key, { value: body, expires: Date.now() + 10 * 60 * 1000 });
    while (playlistCache.size > 120) playlistCache.delete(playlistCache.keys().next().value);
    sendJson(req, res, 200, body);
  } catch (e) {
    sendJson(req, res, 200, {
      ok: false, error: e?.code || 'PLAYLIST', platform: ref.platform,
      message: e instanceof MusicError ? e.message : '这个歌单暂时打不开，确认链接是公开歌单后再试',
    });
  }
}

function copyStreamHeaders(up, res, fallbackType) {
  const raw = up.headers.get('content-type');
  const type = !raw || /octet-stream/i.test(raw) ? (fallbackType || raw) : raw;
  const len = up.headers.get('content-length');
  const range = up.headers.get('content-range');
  const ranges = up.headers.get('accept-ranges');
  if (type) res.setHeader('Content-Type', type);
  if (len && !up.headers.get('content-encoding')) res.setHeader('Content-Length', len);
  if (range) res.setHeader('Content-Range', range);
  res.setHeader('Accept-Ranges', ranges || 'bytes');
  res.setHeader('Cache-Control', 'private, max-age=0');
}

/** fetch that follows redirects by hand, so every hop is checked against the platform's own hosts. */
async function safeFetch(raw, headers, hosts, maxHops, timeout = STREAM_TIMEOUT_MS) {
  let current = raw;
  for (let hop = 0; hop <= maxHops; hop++) {
    if (!hostAllowed(current, hosts)) throw new MusicError('平台跳转到了不允许的地址', 'BAD_HOST');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeout);
    let up;
    try {
      up = await fetch(current, { headers, redirect: 'manual', signal: ac.signal });
    } finally {
      clearTimeout(timer);
    }
    if (up.status >= 300 && up.status < 400) {
      const loc = up.headers.get('location');
      try { up.body?.cancel(); } catch { /* already gone */ }
      if (!loc) throw new MusicError('平台跳转没有目标地址', 'BAD_HOST');
      current = new URL(loc, current).href;
      continue;
    }
    return up;
  }
  throw new MusicError('平台跳转次数太多', 'BAD_HOST');
}

async function handleStream(req, res, token) {
  const entry = tokens.get(token);
  if (!entry || entry.expires <= Date.now()) {
    tokens.delete(token);
    sendError(req, res, 404, '音乐地址已过期 · Music URL expired', '重新选一次这首歌即可');
    return;
  }
  const headers = { 'User-Agent': UA, 'Accept-Encoding': 'identity', ...entry.headers };
  if (req.headers.range) headers.Range = req.headers.range;
  if (req.headers['if-range']) headers['If-Range'] = req.headers['if-range'];
  let up;
  try {
    up = await safeFetch(entry.url, headers, entry.hosts, 3);
  } catch (e) {
    sendError(req, res, 502, '取不到音乐流 · Upstream failed', e?.name === 'AbortError' ? '上游超时' : (e?.message || '上游没有响应'));
    return;
  }
  if (!up.ok && up.status !== 206) {
    try { up.body?.cancel(); } catch { /* ignore */ }
    sendError(req, res, 502, '音乐流被上游拒绝 · Upstream HTTP ' + up.status, '可能已过期，重新选一次这首歌即可');
    return;
  }
  res.statusCode = up.status;
  copyStreamHeaders(up, res, entry.type);
  if (req.method === 'HEAD' || !up.body) {
    try { up.body?.cancel(); } catch { /* ignore */ }
    res.end();
    return;
  }
  const stream = Readable.fromWeb(up.body);
  const stop = () => { try { stream.destroy(); } catch { /* ignore */ } };
  res.on('close', stop);
  stream.on('error', () => { try { res.destroy(); } catch { /* ignore */ } });
  stream.pipe(res);
}

const COVER_HOSTS = Object.freeze(['.gtimg.cn', '.music.126.net', '.kuwo.cn']);
const coverReferer = (host) => (/gtimg\.cn$/.test(host) ? 'https://y.qq.com/' : /kuwo\.cn$/.test(host) ? 'https://www.kuwo.cn/' : 'https://music.163.com/');

async function handleCover(req, res, q) {
  let u;
  try { u = new URL(String(q.get('u') || '')); } catch { sendError(req, res, 400, '封面地址无效 · Bad cover'); return; }
  if (!hostAllowed(u.href, COVER_HOSTS)) { sendError(req, res, 403, '封面地址不在白名单 · Cover host not allowed'); return; }
  if (u.protocol === 'http:') u.protocol = 'https:';
  // NetEase serves the original upload unless asked for a size; 300x300 is plenty for every card here.
  if (/(^|\.)music\.126\.net$/i.test(u.hostname) && !u.searchParams.has('param')) u.searchParams.set('param', '300y300');
  let up;
  try {
    up = await safeFetch(u.href, { 'User-Agent': UA, Referer: coverReferer(u.hostname) }, COVER_HOSTS, 2, TIMEOUT_MS);
  } catch {
    sendError(req, res, 502, '取不到封面 · Cover failed');
    return;
  }
  const type = up.headers.get('content-type') || '';
  const declared = Number(up.headers.get('content-length') || 0);
  if (!up.ok || !/^image\//i.test(type) || declared > COVER_MAX) {
    try { up.body?.cancel(); } catch { /* ignore */ }
    sendError(req, res, 502, '取不到封面 · Cover failed');
    return;
  }
  let buf;
  try { buf = Buffer.from(await up.arrayBuffer()); } catch { sendError(req, res, 502, '取不到封面 · Cover failed'); return; }
  if (buf.length > COVER_MAX) { sendError(req, res, 502, '封面太大 · Cover too large'); return; }
  res.writeHead(200, {
    'Content-Type': type.split(';')[0], 'Content-Length': buf.length,
    'Cache-Control': 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff',
  });
  res.end(req.method === 'HEAD' ? undefined : buf);
}

/**
 * The /lobby-music/… dispatcher, called from server/http/routes.js before the static files.
 * @returns {Promise<void>}
 */
export async function handleLobbyMusic(req, res, parts) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.setHeader('Allow', 'GET, HEAD');
    sendError(req, res, 405, '不支持的请求方法 · Method not allowed');
    return;
  }
  const path = parts.rawPath;
  if (path === '/lobby-music/ping') {
    sendJson(req, res, 200, { ok: true, service: 'lobby-music', version: 1, platforms: Object.keys(PLATFORMS) });
    return;
  }
  if (path === '/lobby-music/search') { await handleSearch(req, res, new URLSearchParams(parts.query)); return; }
  if (path === '/lobby-music/resolve') { await handleResolve(req, res, new URLSearchParams(parts.query)); return; }
  if (path === '/lobby-music/lyric') { await handleLyric(req, res, new URLSearchParams(parts.query)); return; }
  if (path === '/lobby-music/playlist') { await handlePlaylist(req, res, new URLSearchParams(parts.query)); return; }
  if (path.startsWith('/lobby-music/s/')) {
    const token = path.slice('/lobby-music/s/'.length);
    if (!/^[0-9a-f]{36}$/.test(token)) { sendError(req, res, 404, '音乐地址无效 · Bad music URL'); return; }
    await handleStream(req, res, token);
    return;
  }
  if (path === '/lobby-music/cover') { await handleCover(req, res, new URLSearchParams(parts.query)); return; }
  sendError(req, res, 404, '没有这个音乐接口 · Not found');
}
