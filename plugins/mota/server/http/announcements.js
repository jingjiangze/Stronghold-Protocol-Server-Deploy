// server/http/announcements.js — the lobby notice board, sourced from outside this install.
//
// WHY THIS EXISTS: `data/announcements.json` would be baked into the image, so editing a notice would mean a
// commit, a push and a redeploy — on ModelScope studios that is a console click, not a push. This module lets the
// game answer that same path from a URL it polls, so publishing a notice stops being a deploy.
//
// WHY IT PROXIES INSTEAD OF LETTING THE BROWSER FETCH: the client reads the board through its own data store
// (public/js/data.js → `/data/announcements.json`), which is same-origin and has no notion of a second host.
// Answering that path from a fetched body keeps the client untouched — no CORS, no second origin, no client
// build to ship. It also keeps the editor's host out of the page.
//
// THE DEFAULT IS THE OWNER'S GATEWAY (2026-10-18): `SP_ANNOUNCEMENTS_URL` was the only switch, and a studio
// rebuilt by `reset_restart` does not reliably get its environment back — the game then silently polls nothing.
// A baked-in default makes a redeploy unable to lose the board; the variable is now an override and an off-switch.
//
// FAILURE IS SILENT BY DESIGN, AND HAS A FLOOR: a notice is optional decoration, never part of readiness. A source
// that is down, slow or malformed must not fail the request, must not delay it, and must NOT be cached — an absent
// body is answered as a plain 404 by the static mount, which the client renders as 暂无公告. A source that recovers
// is picked up on the next poll without a restart; the last good body survives a short outage (STALE_GRACE).

import { createHash } from 'node:crypto';
import { noopLog } from './config.js';

/** The path this module answers (the client's data name is `announcements`, → /data/announcements.json). */
export const ANNOUNCEMENTS_PATH = '/data/announcements.json';
/** The startServer() option / environment variable overriding the source. */
export const ANNOUNCEMENTS_URL_OPT = 'announcementsUrl';
export const ANNOUNCEMENTS_URL_ENV = 'SP_ANNOUNCEMENTS_URL';
/** The owner's notice backend (`PUT /api/announcements`, password-gated) — this GET reads it back. */
export const DEFAULT_ANNOUNCEMENTS_URL = 'https://strongholdprotocol.jiangjiangze.icu/api/announcements';

/** Values that read as "switch the board off" rather than as a URL. */
const OFF_VALUES = new Set(['off', 'none', 'false', '0']);
/** An answer too big to be a notice board. parseAnnouncements() (public/js/ui/announcements.js) caps at 200k chars. */
const MAX_BYTES = 2 * 1024 * 1024;
/** How long one fetch may hang before we give up and serve the previous body (or nothing). */
const FETCH_TIMEOUT_MS = 8000;
/** Re-check the source this often. The lobby reads the file on entry and on retry, so this bounds staleness. */
export const POLL_MS = 60_000;
/** A source this slow is not "down", it is slow: keep serving the last good body for this long. */
const STALE_GRACE_MULTIPLIER = 6;

const isAbsoluteHttp = (v) => typeof v === 'string' && /^https?:\/\//i.test(v);
/** Whether this process is a test runner's child (`node --test` sets NODE_TEST_CONTEXT in every child). */
const underTest = () => !!process.env.NODE_TEST_CONTEXT || process.env.NODE_ENV === 'test';

/**
 * Resolve the source URL: the startServer() option wins, then the environment, then the baked-in gateway.
 * `off` (or any non-http value) reads as "not configured" — a notice board is never a hard requirement.
 * @param {{ announcementsUrl?: string }} [opts]
 * @param {{ log?: any }} [deps]
 * @returns {string | null}
 */
export function announcementsUrlFrom(opts = {}, { log = noopLog } = {}) {
  // An empty option or environment value reads as unset (the same rule as PORT in config.js), so a script that
  // passes an empty string does not switch the feature off by accident.
  const pick = (v) => (v == null || v === '' ? undefined : v);
  const fromOpts = pick(opts[ANNOUNCEMENTS_URL_OPT]);
  const fromEnv = pick(process.env[ANNOUNCEMENTS_URL_ENV]);
  const raw = fromOpts ?? fromEnv;
  // The baked-in default is a real network address: a test suite that starts a server must not poll it. Tests that
  // exercise this module pass `announcementsUrl` explicitly (a stub URL), which still wins over the default.
  // NODE_TEST_CONTEXT is what `node --test` sets in every child; NODE_ENV is honoured too for CI wrappers.
  if (raw === undefined) return underTest() ? null : DEFAULT_ANNOUNCEMENTS_URL;
  const v = typeof raw === 'string' ? raw.trim() : '';
  if (OFF_VALUES.has(v.toLowerCase())) return null;
  if (isAbsoluteHttp(v)) return v;
  // An explicit value that is neither a URL nor off is a configuration mistake: say so once, serve the disk copy.
  log.warn(`[announcements] ${ANNOUNCEMENTS_URL_ENV}="${v}" is not an absolute http(s) URL — the board is off`);
  return null;
}

/**
 * The external notice board: the body of the last successful fetch, or null while none has succeeded.
 *
 * The body is kept as TEXT, not parsed: this layer does not own the schema (public/js/ui/announcements.js does,
 * and it rejects malformed content itself). Handing back bytes also means a source serving valid JSON with fields
 * this server has never heard of still works. The one check made here is content-type, because serving an HTML
 * error page as application/json would make the board unreadable in a way that looks like a code bug.
 * @param {{ url: string, fetch?: typeof fetch, setTimeout?: typeof setTimeout, log?: object }} opts
 */
export function createAnnouncementSource({ url, fetch: doFetch, setTimeout: armTimer, log = noopLog }) {
  const load = doFetch || ((...a) => globalThis.fetch(...a));
  const timer = armTimer || ((fn, ms) => setTimeout(fn, ms));
  /** @type {string | null} */
  let body = null;
  /** @type {string | null} */
  let hash = null;
  let lastOkAt = 0;
  let inFlight = null;
  let failures = 0;
  let staleSince = 0;
  let stopHandle = null;
  let running = false;

  async function refresh() {
    if (inFlight) return inFlight;
    const controller = new AbortController();
    let handle = null;
    // The deadline is a RACE, not just the signal: a fetch that ignores `signal` (a proxy, a stub, a badly
    // behaved source) must still not hold a refresh open forever. The signal is passed too, so a well-behaved
    // source releases its socket instead of leaving it to time out on its own.
    let onTimeout;
    const deadline = new Promise((_, reject) => {
      onTimeout = () => reject(Object.assign(new Error('source timed out'), { timedOut: true }));
    });
    handle = timer(onTimeout, FETCH_TIMEOUT_MS);
    // The timer MUST be cleared on the success path too: a pending setTimeout keeps the Node event loop
    // alive (and would fire `onTimeout` into an already-settled promise), which shows up as the process
    // hanging for the full timeout after every refresh.
    inFlight = (async () => {
      try {
        const res = await Promise.race([
          load(url, { signal: controller.signal, headers: { accept: 'application/json' }, redirect: 'follow' }),
          deadline,
        ]);
        if (!res.ok) throw new Error(`source answered ${res.status}`);
        // A JSON content-type is required; a bare one (`text/plain`) is tolerated because a static host may
        // not map .json. Anything else (an HTML error page, a directory listing) is refused.
        const type = String(res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
        if (type && type !== 'application/json' && type !== 'text/json' && type !== 'text/plain') {
          throw new Error(`source content-type "${type}" is not JSON`);
        }
        const text = await res.text();
        if (Buffer.byteLength(text, 'utf8') > MAX_BYTES) throw new Error(`source body too large (${text.length} chars)`);
        JSON.parse(text); // Refuse a body every client would fail to parse: fail here, not in every browser.
        if (text !== body) hash = createHash('sha1').update(text, 'utf8').digest('hex').slice(0, 16);
        body = text;
        lastOkAt = Date.now();
        staleSince = 0;
        if (failures) log.warn(`[announcements] source recovered after ${failures} failure(s)`);
        failures = 0;
      } catch (err) {
        failures += 1;
        if (!staleSince) staleSince = Date.now();
        // The first failure is worth a line (a wrong URL is a configuration mistake); a source that stays
        // down must not log on every poll, or the log becomes the outage.
        if (failures === 1 || failures % 10 === 0) log.warn(`[announcements] source unreachable: ${err?.message || err}`);
      } finally {
        clearTimer(handle);
        controller.abort(); // a race the fetch lost must not keep its socket
        inFlight = null;
      }
    })();
    return inFlight;
  }

  /**
   * One poll, then arm the next — AFTER this one settles, so a slow source can never stack requests.
   * (The first version armed a single timer without re-arming: the board was fetched twice and then frozen
   * for the life of the process, which is the one bug this whole file must not have.)
   */
  async function tick() {
    stopHandle = null;
    if (!running) return;
    await refresh();
    if (!running) return;
    stopHandle = timer(() => { void tick(); }, POLL_MS);
    stopHandle?.unref?.();
  }

  return {
    /** The last good body, or null when the source has never answered (→ the static mount answers 404). */
    body: () => body,
    /** The body's content hash, for the ETag of the served copy (null while there is no body). */
    hash: () => hash,
    /** Whether the last good body is still fresh enough to prefer over nothing. */
    fresh: () => body !== null && (Date.now() - lastOkAt) < POLL_MS * STALE_GRACE_MULTIPLIER,
    refresh,
    /** Start polling. Returns this source, so the caller keeps the handle it then passes to the static mount. */
    start() {
      if (running) return this;
      running = true;
      void tick();
      return this;
    },
    /** Stop polling (a boot that failed after this point must not leave a timer behind). */
    stop() {
      running = false;
      clearTimer(stopHandle);
      stopHandle = null;
    },
    /** Test seam: what the last attempt did. */
    stats: () => ({ url, failures, lastOkAt, hasBody: body !== null, polling: running }),
  };
}

/** clearTimeout on whatever the injected timer returned; an injected timer that cannot be cleared is the caller's. */
function clearTimer(handle) {
  if (handle == null) return;
  try { clearTimeout(handle); } catch { /* nothing to clear */ }
}
