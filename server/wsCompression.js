// server/wsCompression.js — this server's binding of the vendored WebSocket transport layer.
//
// The option sets, the declarative `server.transport` policy and the compressible-type whitelist
// are the upstream source of truth: `server/ws-compression/*` (jingjiangze/stronghold-ws-compression,
// MIT — see `server/ws-compression/SOURCE.md`). This file binds them to THIS process and nothing else:
//
//   * the environment names — `WS_COMPRESSION` (off | on | safe) is the upstream name; the historical
//     `SP_WS_COMPRESSION` is still accepted so an existing deployment keeps working;
//   * the process default. This engine compressed by default before this layer existed (the old
//     `WS_DEFLATE` in http/websocket.js), so an unset variable means `on`, not `off`: switching the
//     default to off here would silently trade bandwidth for nothing an operator asked for;
//   * the single resolve step: `transportPolicy()` with an empty declaration map. The ENGINE's Forge
//     importer refuses `pack.json.server` (server/plugins/forgeImport.js), so no engine-level pack can
//     declare transport; the declaration path is used by hosts that do load such packs (the mota
//     server's own workshop). Keeping the call here means one code path, not two.
//
// Do not re-declare the option set here. `on` is context takeover with zlib's default window and a
// 64-byte threshold; `safe` turns only the context takeover off; `off` sends plain frames. The reasons
// (and the HTTP 400 trap of a pinned window) are in the vendored module's header.

import {
  resolveWsCompression as upstreamResolve,
  createCompressFilter,
  describeWsCompression as upstreamDescribe,
  compressibleTypes as upstreamCompressibleTypes,
  parseExtraCompressibleTypes,
  WS_COMPRESSION_MODES,
  STRONGHOLD_COMPRESSIBLE_TYPES,
  DEFAULT_EXTRA_COMPRESSIBLE_TYPES,
} from './ws-compression/wsCompression.mjs';
import { transportPolicy as upstreamTransportPolicy } from './ws-compression/transportPolicy.mjs';

export {
  WS_COMPRESSION_MODES, STRONGHOLD_COMPRESSIBLE_TYPES, DEFAULT_EXTRA_COMPRESSIBLE_TYPES,
  parseExtraCompressibleTypes, upstreamTransportPolicy as transportPolicy,
};

/** The mode an operator asked for: `WS_COMPRESSION` first, then the historical `SP_WS_COMPRESSION`. */
export function wsCompressionMode(env = process.env) {
  return env.WS_COMPRESSION ?? env.SP_WS_COMPRESSION ?? 'on';
}

/** The `perMessageDeflate` value for a mode — the vendored option set, unchanged. */
export function resolveWsCompression(mode = 'off') {
  return upstreamResolve(mode);
}

/** What will actually reach the wire, including the options left undeclared on purpose. */
export function describeWsCompression(mode) {
  return upstreamDescribe(mode);
}

/**
 * The process's transport decision: the option set for `WebSocketServer` plus the read-only shape the
 * client reads back from `welcome.transport` (`ctx.net.transport()`).
 *
 * @param {{ mode?: string, maxPayload?: number, log?: object | null }} [opts]
 * @returns {{
 *   mode: string,
 *   perMessageDeflate: false | object,
 *   transport: { deflate: boolean, params: string | null, maxPayload: number, threshold: number | null },
 *   describe: object,
 * }}
 */
export function resolveWsTransport({ mode = wsCompressionMode(), maxPayload = 64 * 1024, log = null } = {}) {
  // The vendored policy also validates; doing it here makes an unknown value fail at boot with the
  // accepted list in the message, instead of reaching WebSocketServer as an accidental default.
  if (!WS_COMPRESSION_MODES.includes(mode)) {
    throw new TypeError(`WS compression mode must be one of ${WS_COMPRESSION_MODES.join(', ')} (got ${JSON.stringify(mode)})`);
  }
  const r = upstreamTransportPolicy(new Map(), { mode, maxPayload, log });
  return Object.freeze({
    mode,
    perMessageDeflate: r.perMessageDeflate,
    transport: Object.freeze({ ...r.transport }),
    describe: upstreamDescribe(mode),
  });
}

/**
 * Engine-specific additions to the vendored whitelist. `room.state` is a full public snapshot (no
 * credentials), re-sent on every join / ready / bot change; it was compressed before this layer existed,
 * so keeping it compressed is not a new exposure. `welcome` stays out on purpose: it carries the session
 * token, and the vendored set excludes credential-bearing frames.
 */
const ENGINE_EXTRA_TYPES = Object.freeze(['room.state']);

/** The resolved list for this process: vendored base ∪ `WS_COMPRESS_EXTRA` ∪ the engine's own additions. */
const RESOLVED_TYPES = Object.freeze([
  ...STRONGHOLD_COMPRESSIBLE_TYPES,
  ...parseExtraCompressibleTypes(process.env.WS_COMPRESS_EXTRA ?? process.env.SP_WS_COMPRESS_EXTRA),
  ...ENGINE_EXTRA_TYPES,
]);

/**
 * True for the message types this process compresses. `welcome` and every control/credential frame stay
 * uncompressed on purpose.
 */
export const isCompressibleType = createCompressFilter(RESOLVED_TYPES);

/** The resolved type list for the current process, observably (not inferred). */
export function compressibleTypes() {
  return [...RESOLVED_TYPES];
}

// `upstreamCompressibleTypes` is kept exported for callers that want the vendored list alone (a test or a
// status page that distinguishes "upstream" from "this engine").
export { upstreamCompressibleTypes as vendoredCompressibleTypes };
