// transportPolicy.mjs — the DECLARATIVE half: a pack says what it wants, the process gets one option set.
//
// This file is the fusion of two things that grew apart:
//
//   1. the MOD manager's `pack.json.server.transport` (Stronghold Protocol Forge 0.3.1, DESIGN §28.30) —
//      a closed field set, bounded integers, "the smaller pack id wins", and the resolved value is NAMED
//      in the startup log instead of being inferred. That model is the source of the shape below; the
//      field names, the bounds and the error codes are kept byte-for-byte so a host can swap parsers
//      without a migration.
//   2. this package's measured option sets (`src/wsCompression.mjs`): context takeover left undeclared,
//      no pinned window, 64-byte threshold. Those numbers are the baseline a declaration overlays — a
//      declaration is a delta, not a second copy of the whole option set.
//
// WHY THE MERGER IS NOT A SPREAD
// ------------------------------
// A declaration speaks a different language than `ws`'s options. Three translations matter, and each of
// them is the difference between "a pack asked for something" and "every client is now refused":
//
//   * `serverNoContextTakeover: false` in a DECLARATION means "do not require dropping the server
//     context" — i.e. negotiate. In `ws` options a literal `false` means "REQUIRE context takeover":
//     `acceptAsServer` rejects any offer carrying `server_no_context_takeover` and the handshake becomes
//     HTTP 400. The merger therefore DROPS a declared `false` instead of forwarding it. Forwarding it is
//     the kind of bug that only shows up on clients that ask for the safer thing.
//   * `serverMaxWindowBits` / `clientMaxWindowBits` are honoured when a pack declares them, but they are
//     the two fields that can turn an acceptable offer into a rejected one (a client offering a smaller
//     window than the server pinned). They are not part of any shipped preset, and the merger emits a
//     warning naming the risk instead of quietly pinning them.
//   * `level` / `memLevel` MERGE into the baseline's `zlibDeflateOptions`. Replacing the whole object
//     (the obvious `options.zlibDeflateOptions = {...}`) would drop the baseline's other field and
//     silently move the preset.
//
// The winner rule is the MOD manager's: the smallest pack id declares the process-level value, every
// other declaration is named as ignored. Comparison is by code unit, not `localeCompare` — two hosts
// with different locales must resolve the same set of packs to the same winner.

import { resolveWsCompression } from './wsCompression.mjs';

/** The declared field set. `deflate` is the switch; every other field is an override. */
export const TRANSPORT_FIELDS = Object.freeze([
  'deflate', 'threshold', 'level', 'memLevel', 'concurrencyLimit',
  'serverNoContextTakeover', 'clientNoContextTakeover', 'serverMaxWindowBits', 'clientMaxWindowBits',
]);

/** Closed integer ranges for every non-boolean field, `deflate` excluded. */
export const TRANSPORT_BOUNDS = Object.freeze({
  threshold: [0, 1048576],
  level: [0, 9],
  memLevel: [1, 9],
  concurrencyLimit: [1, 1000],
  serverMaxWindowBits: [8, 15],
  clientMaxWindowBits: [8, 15],
});

/** `ws`'s own `perMessageDeflate.threshold` default. Only used to REPORT a threshold when the baseline
 *  does not set one; the merger never copies it into the option set (a second default is a second thing
 *  that can drift). */
export const WS_LIBRARY_THRESHOLD = 1024;

const DECLARED_PARAM_ORDER = Object.freeze([
  'threshold', 'concurrencyLimit', 'serverMaxWindowBits', 'clientMaxWindowBits',
  'serverNoContextTakeover', 'clientNoContextTakeover',
]);

const fail = (error, detail) => ({ ok: false, error, detail });

/**
 * Validate and normalise one `pack.json.server.transport` block.
 *
 * Normalisation has exactly two rules, both from the MOD manager:
 *   * `deflate` MUST be present and boolean — a block without the switch says nothing, so it is refused
 *     rather than read as "on" or "off";
 *   * the remaining fields are optional and omitted means "leave the baseline alone" (this package does
 *     not copy `ws`'s defaults into its own output).
 * Key order is normalised to `TRANSPORT_FIELDS` so two packs that differ only in field order produce the
 * same bytes — the declaration is an input to the pack's identity hash.
 *
 * @param {unknown} raw
 * @returns {{ ok: true, decl: { transport: object } } | { ok: false, error: string, detail: string }}
 */
export function parseTransportDecl(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return fail('TRANSPORT_BAD_SHAPE', 'server.transport must be an object: { deflate, threshold?, level?, memLevel?, concurrencyLimit?, serverNoContextTakeover?, clientNoContextTakeover?, serverMaxWindowBits?, clientMaxWindowBits? }');
  }
  for (const key of Object.keys(raw)) {
    if (!TRANSPORT_FIELDS.includes(key)) {
      return fail('TRANSPORT_UNKNOWN_FIELD', `server.transport: "${key}" is not a declared field (${TRANSPORT_FIELDS.join(', ')})`);
    }
  }
  if (typeof raw.deflate !== 'boolean') {
    return fail('TRANSPORT_BAD_DEFLATE', 'server.transport.deflate must be true or false — it is the switch itself, and a block without it says nothing');
  }
  /** @type {Record<string, any>} */
  const out = { deflate: raw.deflate };
  for (const [key, [lo, hi]] of Object.entries(TRANSPORT_BOUNDS)) {
    if (raw[key] === undefined) continue;
    if (!Number.isInteger(raw[key]) || raw[key] < lo || raw[key] > hi) {
      return fail('TRANSPORT_BAD_VALUE', `server.transport.${key} must be an integer between ${lo} and ${hi}, got ${JSON.stringify(raw[key])}`);
    }
    out[key] = raw[key];
  }
  for (const key of ['serverNoContextTakeover', 'clientNoContextTakeover']) {
    if (raw[key] === undefined) continue;
    if (typeof raw[key] !== 'boolean') {
      return fail('TRANSPORT_BAD_VALUE', `server.transport.${key} must be true or false, got ${JSON.stringify(raw[key])}`);
    }
    out[key] = raw[key];
  }
  /** @type {Record<string, any>} */
  const ordered = {};
  for (const key of TRANSPORT_FIELDS) if (out[key] !== undefined) ordered[key] = out[key];
  return { ok: true, decl: { transport: ordered } };
}

/** Deterministic pack-id ordering: code units, never locale. */
function byPackId(a, b) {
  return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
}

/**
 * Resolve every pack's declaration into ONE process-level `perMessageDeflate` plus the read-only
 * `transport` shape the MOD manager puts on `welcome` (`{ deflate, params, maxPayload, threshold }`).
 *
 * No declaration returns the baseline untouched, including `false`: the default belongs to the host,
 * not to this function. A pack that declares `deflate: true` while the baseline is off gets the shipped
 * `on` preset as its base — declaring the switch on must actually turn it on, otherwise the declaration
 * is the "validated but ineffective" shape this whole change exists to remove.
 *
 * @param {Map<string, object> | Record<string, object> | null | undefined} policies
 *   pack id → already-normalised `server.transport` (see `parseTransportDecl`).
 * @param {{
 *   mode?: string,               // baseline preset when `baseline` is omitted: off | on | safe
 *   baseline?: false | object,   // explicit option set; overrides `mode`
 *   maxPayload?: number,         // the server's inbound limit, reported not changed
 *   log?: { warn?: Function, info?: Function } | null,
 * }} [opts]
 * @returns {{
 *   perMessageDeflate: false | object,
 *   transport: { deflate: boolean, params: string | null, maxPayload: number, threshold: number | null },
 *   policy: { source: 'baseline' | 'pack', packId: string | null, baseline: string,
 *     ignored: string[], normalized: string[], warnings: string[] },
 * }}
 */
export function transportPolicy(policies, {
  mode = 'off',
  baseline,
  maxPayload = 64 * 1024,
  log = null,
} = {}) {
  const base = baseline === undefined ? resolveWsCompression(mode) : baseline;
  const baselineLabel = baseline === undefined ? mode : 'custom';
  const entries = (policies && typeof policies.entries === 'function'
    ? [...policies.entries()]
    : Object.entries(policies || {}))
    .filter(([id, decl]) => id && decl && typeof decl.deflate === 'boolean')
    .sort(byPackId);

  if (!entries.length) {
    return {
      perMessageDeflate: base === false ? false : freezeOptions(base),
      transport: readoutFor(base, maxPayload),
      policy: { source: 'baseline', packId: null, baseline: baselineLabel, ignored: [], normalized: [], warnings: [] },
    };
  }

  const [winnerId, winner] = entries[0];
  const ignored = entries.slice(1).map(([id]) => String(id));
  for (const id of ignored) {
    log?.warn?.(`[transport] server.transport declared by "${id}" is ignored: "${winnerId}" declares it too and the smaller pack id wins`);
  }

  if (winner.deflate !== true) {
    for (const key of Object.keys(winner)) {
      if (key !== 'deflate') {
        log?.warn?.(`[transport] "${winnerId}" declares deflate: false, so server.transport.${key} has no effect`);
      }
    }
    return {
      perMessageDeflate: false,
      transport: { deflate: false, params: null, maxPayload, threshold: null },
      policy: { source: 'pack', packId: String(winnerId), baseline: baselineLabel, ignored, normalized: [], warnings: [] },
    };
  }

  // `deflate: true` with an off baseline turns the shipped preset on. With an object baseline it is a
  // delta on that object.
  const options = base && typeof base === 'object' ? { ...base } : { ...resolveWsCompression('on') };
  if (options.zlibDeflateOptions && typeof options.zlibDeflateOptions === 'object') {
    options.zlibDeflateOptions = { ...options.zlibDeflateOptions };
  }

  /** @type {string[]} */
  const normalized = [];
  /** @type {string[]} */
  const warnings = [];
  /** @type {string[]} */
  const params = [];

  for (const key of DECLARED_PARAM_ORDER) {
    if (winner[key] === undefined) continue;
    if (key === 'serverNoContextTakeover' && winner[key] === false) {
      // Declaration language: false = "do not require it" = negotiate. ws option language: false =
      // "require it" = reject clients that ask for no-context. Drop it.
      delete options.serverNoContextTakeover;
      normalized.push('serverNoContextTakeover=false -> negotiated (not forwarded: ws reads false as REQUIRE takeover and answers 400)');
      continue;
    }
    if (key === 'serverNoContextTakeover' && winner[key] === true) {
      options.serverNoContextTakeover = true;
      params.push('serverNoContextTakeover=true');
      continue;
    }
    if (key === 'clientNoContextTakeover') {
      if (winner[key] === true) {
        options.clientNoContextTakeover = true;
        params.push('clientNoContextTakeover=true');
      } else {
        delete options.clientNoContextTakeover;
        normalized.push('clientNoContextTakeover=false -> negotiated');
      }
      continue;
    }
    options[key] = winner[key];
    params.push(`${key}=${winner[key]}`);
    if (key === 'serverMaxWindowBits') {
      warnings.push(`serverMaxWindowBits=${winner[key]} is pinned by the declaration: a client that offers a smaller server_max_window_bits is REJECTED with HTTP 400, not degraded`);
    }
    if (key === 'clientMaxWindowBits') {
      warnings.push(`clientMaxWindowBits=${winner[key]} is pinned by the declaration: a client that does not offer client_max_window_bits (or offers a larger one) is REJECTED with HTTP 400, not degraded`);
    }
  }

  if (winner.level !== undefined || winner.memLevel !== undefined) {
    const zlib = options.zlibDeflateOptions ?? {};
    if (winner.level !== undefined) { zlib.level = winner.level; params.push(`level=${winner.level}`); }
    if (winner.memLevel !== undefined) { zlib.memLevel = winner.memLevel; params.push(`memLevel=${winner.memLevel}`); }
    options.zlibDeflateOptions = zlib;
  }

  for (const warning of warnings) log?.warn?.(`[transport] "${winnerId}": ${warning}`);
  for (const note of normalized) log?.info?.(`[transport] "${winnerId}": ${note}`);

  const frozen = freezeOptions(options);
  const effectiveThreshold = typeof frozen.threshold === 'number' ? frozen.threshold : WS_LIBRARY_THRESHOLD;
  return {
    perMessageDeflate: frozen,
    transport: {
      deflate: true,
      params: params.length ? params.join(' ') : null,
      maxPayload,
      threshold: effectiveThreshold,
    },
    policy: { source: 'pack', packId: String(winnerId), baseline: baselineLabel, ignored, normalized, warnings },
  };
}

/** Deep-freeze the two levels an option set has (the rest of `ws`'s fields are primitives). */
function freezeOptions(options) {
  const copy = { ...options };
  if (copy.zlibDeflateOptions && typeof copy.zlibDeflateOptions === 'object') {
    copy.zlibDeflateOptions = Object.freeze({ ...copy.zlibDeflateOptions });
  }
  return Object.freeze(copy);
}

/** The read-only `welcome.transport` shape for a baseline with no pack declaration. */
function readoutFor(options, maxPayload) {
  if (options === false) return { deflate: false, params: null, maxPayload, threshold: null };
  const threshold = typeof options?.threshold === 'number' ? options.threshold : WS_LIBRARY_THRESHOLD;
  return { deflate: true, params: null, maxPayload, threshold };
}
