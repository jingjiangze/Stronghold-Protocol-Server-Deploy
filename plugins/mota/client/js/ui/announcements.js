// Versioned lobby notices (公告板): a floating window on the lobby, plus the thin bar that opens it.
//
// WHY THE DATA IS OPTIONAL: the board is decoration, never part of readiness. `data.load('announcements')` may be
// 404 (no source configured, or the gateway never answered) and the lobby must still work — so every entry point
// here accepts 'missing' as 暂无公告 rather than as an error.
//
// WHY A REVISION AND NOT A TIMER: an announcement should pop up once per *content*, not once per session. The
// revision is a content hash, so editing the notice (or publishing the next one) pops the window again, and a
// player who read it stays undisturbed until something actually changed.
//
// MAINTENANCE (2026-10-18, owner): the board exists mainly to announce maintenance BEFORE it happens. An entry
// may carry `startsAt` / `endsAt` (ms epoch): before `startsAt` it shows 距维护开始 …; after `startsAt` it reads
// 维护进行中; after `endsAt` it disappears on its own. `level` (info / warning / critical) tints both the bar and
// the entry, so a 维护提醒 is not read as an ordinary news item.

import { html, Button, Icon, Modal, Spinner } from './components.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

/** The three levels the gateway's /admin offers; anything else reads as info. */
const LEVELS = new Set(['info', 'warning', 'critical']);
const LEVEL_RANK = { info: 1, warning: 2, critical: 3 };

/** Content caps: mirrors the gateway's own limits, so a hostile or broken source cannot blow up the lobby. */
const MAX_ENTRIES = 50;
const MAX_TITLE = 120;
const MAX_DATE = 40;
const MAX_PARAGRAPHS = 40;
const MAX_PARAGRAPH_CHARS = 10000;
const MAX_TOTAL_CHARS = 200000;

/**
 * Validate the whole editorial list; never silently truncate or turn malformed content into an empty board.
 * Returns null when the shape is wrong (the caller distinguishes that from an empty list).
 * @param {any} value the parsed JSON of /data/announcements.json
 */
export function parseAnnouncements(value) {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) return null;
  const entries = [];
  let chars = 0;
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') return null;
    const { title, date, paragraphs, level, startsAt, endsAt } = entry;
    if (typeof title !== 'string' || !title.trim() || title.length > MAX_TITLE) return null;
    if (date != null && (typeof date !== 'string' || !date.trim() || date.length > MAX_DATE)) return null;
    if (!Array.isArray(paragraphs) || !paragraphs.length || paragraphs.length > MAX_PARAGRAPHS) return null;
    if (paragraphs.some((p) => typeof p !== 'string' || !p.trim() || p.length > MAX_PARAGRAPH_CHARS)) return null;
    const at = (v) => (Number.isFinite(v) && v > 0 ? Number(v) : null);
    chars += title.length + (date?.length || 0) + paragraphs.reduce((n, p) => n + p.length, 0);
    if (chars > MAX_TOTAL_CHARS) return null;
    entries.push({
      title: title.trim(),
      date: date?.trim() || '',
      paragraphs: [...paragraphs],
      level: LEVELS.has(level) ? level : 'info',
      startsAt: at(startsAt),
      endsAt: at(endsAt),
    });
  }
  return entries;
}

let dismissedInPage = null;

/** Content identity, independent of the browser build and editorial object key order. */
export async function announcementRevision(value, crypto = globalThis.crypto) {
  const entries = parseAnnouncements(value);
  if (!entries?.length) return null;
  const text = JSON.stringify(entries);
  try {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return 'ann1:' + [...new Uint8Array(digest)].map((n) => n.toString(16).padStart(2, '0')).join('');
  } catch {
    // Compatibility identity only, not a security hash. No network dependency on optional crypto.
    let a = 2166136261, b = 0x9e3779b9;
    for (let i = 0; i < text.length; i++) { a = Math.imul(a ^ text.charCodeAt(i), 16777619); b = Math.imul(b ^ text.charCodeAt(i), 2246822519); }
    return `ann1:${text.length.toString(16)}:${(a >>> 0).toString(16)}:${(b >>> 0).toString(16)}`;
  }
}

export function announcementDismissed(revision) {
  return !!revision && revision === (dismissedInPage ?? loadPref('announcements.dismissed', null));
}

export function dismissAnnouncement(revision) {
  if (typeof revision !== 'string' || !revision.startsWith('ann1:')) return;
  dismissedInPage = revision;
  savePref('announcements.dismissed', revision);
}

/**
 * What an entry is *doing* right now.
 *   'upcoming' — a maintenance that has not started yet (startsAt in the future)
 *   'live'     — maintenance under way (startsAt passed, endsAt not yet)
 *   'notice'   — an ordinary notice with no schedule
 *   null       — over (endsAt passed), and therefore not shown at all
 * @param {{ startsAt: number|null, endsAt: number|null }} entry
 * @param {number} now ms epoch
 */
export function announcementPhase(entry, now) {
  if (entry.endsAt != null && now >= entry.endsAt) return null;
  if (entry.startsAt == null) return 'notice';
  return now >= entry.startsAt ? 'live' : 'upcoming';
}

/** The entries the lobby should show right now (expired ones dropped, order kept). */
export function liveAnnouncements(entries, now) {
  return (entries || []).filter((e) => announcementPhase(e, now) !== null);
}

/** `MM-DD HH:mm` in the reader's own timezone — the editor writes epochs, the reader reads their own clock. */
export function formatWhen(ms) {
  if (!Number.isFinite(ms)) return '';
  const d = new Date(ms);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 距离 startsAt 还有多久（粗粒度，秒级更新也只在分钟刻度上变化）。 */
export function countdownText(startsAt, now) {
  const left = Math.max(0, startsAt - now);
  const days = Math.floor(left / 86400000);
  const hours = Math.floor((left % 86400000) / 3600000);
  const mins = Math.floor((left % 3600000) / 60000);
  if (days > 0) return t('{d} 天 {h} 小时后', { d: days, h: hours });
  if (hours > 0) return t('{h} 小时 {m} 分后', { h: hours, m: mins });
  if (mins > 0) return t('{m} 分钟后', { m: mins });
  return t('即将开始');
}

/**
 * The one entry the lobby bar should lead with: maintenance being under way beats one that is coming, which beats
 * a plain notice; within a phase the louder level wins. Authored order breaks ties.
 */
export function headlineEntry(entries, now) {
  const live = liveAnnouncements(entries, now);
  if (!live.length) return null;
  const weight = (e) => {
    const phase = announcementPhase(e, now);
    const base = phase === 'live' ? 30 : phase === 'upcoming' ? 20 : 10;
    return base + (LEVEL_RANK[e.level] || 1);
  };
  return live.reduce((best, e) => (weight(e) > weight(best) ? e : best), live[0]);
}

/** One line of status for an entry's schedule, or '' when it has none. */
export function scheduleLine(entry, now) {
  const phase = announcementPhase(entry, now);
  if (phase === 'upcoming') return t('距维护开始 {left}（{when}）', { left: countdownText(entry.startsAt, now), when: formatWhen(entry.startsAt) });
  if (phase === 'live') return entry.endsAt ? t('维护进行中 · 预计 {when} 结束', { when: formatWhen(entry.endsAt) }) : t('维护进行中');
  if (entry.endsAt) return t('有效期至 {when}', { when: formatWhen(entry.endsAt) });
  return '';
}

/**
 * The lobby's thin bar: one line, clickable, tinted by level. Renders nothing without a live entry, so a server
 * that never configured a board is indistinguishable from one without this feature.
 */
export function AnnouncementBar({ entries, now, onOpen }) {
  const head = headlineEntry(entries, now);
  if (!head) return null;
  const phase = announcementPhase(head, now);
  const tag = phase === 'live' ? t('维护中') : phase === 'upcoming' ? t('维护预告') : head.level === 'critical' ? t('重要') : t('公告');
  return html`<button type="button" data-testid="announcement-bar" data-level=${head.level} data-phase=${phase}
    class=${`announce-bar announce-bar--${head.level} is-${phase}`} onClick=${onOpen}>
    <${Icon} name=${phase === 'upcoming' || phase === 'live' ? 'warn' : 'info'} />
    <span class="announce-bar__tag">${tag}</span>
    <span class="announce-bar__title">${head.title}</span>
    <span class="announce-bar__more">${scheduleLine(head, now) || t('查看公告')}<${Icon} name="chevronRight" /></span>
  </button>`;
}

/**
 * The board itself. Presentation only: the lobby owns loading and retry, so this component adds no in-match data
 * dependency (and is safe to mount from any screen that passes a status).
 */
export function AnnouncementBoard({ status = 'idle', value, onRetry, onClose }) {
  const entries = status === 'ready' ? parseAnnouncements(value) : status === 'missing' ? [] : null;
  const loading = status === 'idle' || status === 'loading';
  const [now, setNow] = useState(() => Date.now());
  const visible = entries ? liveAnnouncements(entries, now) : null;
  const scrollRef = useRef(null);
  const [scroll, setScroll] = useState({ more: true, scrollable: true, percent: 0 });

  // A countdown has to move while the window is open. One second, and only while this component is mounted.
  useEffect(() => {
    if (!entries) return undefined;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [entries]);

  const measure = () => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollHeight - el.clientHeight;
    const next = { more: max > 2 && el.scrollTop < max - 2, scrollable: max > 2, percent: max > 2 ? Math.round(Math.min(1, el.scrollTop / max) * 100) : 100 };
    setScroll((prev) => (prev.more === next.more && prev.scrollable === next.scrollable && prev.percent === next.percent ? prev : next));
  };
  useEffect(() => {
    measure();
    const el = scrollRef.current;
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (el) { observer?.observe(el); if (el.firstElementChild) observer?.observe(el.firstElementChild); }
    window.addEventListener('resize', measure);
    return () => { observer?.disconnect(); window.removeEventListener('resize', measure); };
  }, [status, value, visible?.length]);

  return html`<${Modal} open=${true} title=${t('公告板')} micro="BULLETIN BOARD"
      closeOnBackdrop=${false} class="announcement-board lobby-dialog" onClose=${onClose}
      actions=${html`<${Button} icon="close" onClick=${onClose} data-autofocus>${t('关闭公告')}<//>`}>
    ${loading ? html`<div class="announcement-state" role="status"><${Spinner} label="LOADING" /><p>${t('正在读取公告…')}</p></div>`
      : entries === null ? html`<div class="announcement-state" role="status">
        <${Icon} name="warn" /><h3>${t('暂时无法显示公告')}</h3>
        <p>${t('公告内容格式有误，请稍后再试。')}</p>
        <${Button} icon="refresh" onClick=${onRetry}>${t('重试公告')}<//>
      </div>`
      : !visible.length ? html`<div class="announcement-state" role="status"><${Icon} name="info" /><h3>${t('暂无公告')}</h3>
        <p>${t('新的公告会在这里显示。')}</p></div>`
      : html`<div ref=${scrollRef} class="announcement-scroll" role="region" tabindex="0" onScroll=${measure}>
        <div class="announcement-list">${visible.map((entry, i) => html`<article key=${i}
            class=${`announcement-entry announcement-entry--${entry.level}`} data-level=${entry.level} data-phase=${announcementPhase(entry, now)}>
          <header><h3>${entry.title}</h3>${entry.date ? html`<span class="announcement-date num">${entry.date}</span>` : null}</header>
          ${scheduleLine(entry, now) ? html`<p class="announcement-schedule"><${Icon} name="warn" />${scheduleLine(entry, now)}</p>` : null}
          ${entry.paragraphs.map((text, j) => html`<p key=${j}>${text}</p>`)}
        </article>`)}</div>
      </div>`}
    ${visible?.length ? html`<div class=${`announcement-reading${scroll.more ? ' has-more' : ''}`}>
      <div class="announcement-reading__track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow=${scroll.percent}>
        <i style=${`transform:scaleX(${scroll.percent / 100})`} />
      </div><span>${scroll.more ? html`<${Icon} name="chevronRight" />${t('向下滑动查看剩余公告')}` : scroll.scrollable ? t('已到公告末尾') : t('内容已完整显示')}</span>
    </div>` : null}
  <//>`;
}
