// shared/matchSnapshot.mjs — the match snapshot a client keeps so a restarted server can rebuild the run.
//
// The server is the only side that can serialise a PlayerState, so it hands each human a snapshot at every round
// start (`b.snapshot`); the page keeps the last one in memory. A ModelScope container keeps nothing across a
// redeploy, but the player's tab survives it — on reconnect the server asks for the snapshot (`b.snapshotRequest`)
// and the page sends it back (`b.snapshot`), and the match is rebuilt at that round.
//
// Pure functions only: no imports, no I/O. Bounds are hard, so a hostile or stale client cannot make the server
// allocate: at most SNAPSHOT_MAX_PLAYERS players, SNAPSHOT_MAX_PIECES pieces each, and pieces are plain JSON.

export const SNAPSHOT_VERSION = 1;
export const SNAPSHOT_MAX_BYTES = 512 * 1024;
export const SNAPSHOT_MAX_PLAYERS = 40;
export const SNAPSHOT_MAX_PIECES = 64;
export const SNAPSHOT_MAX_ROUND = 200;

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi) => (Number.isInteger(v) && v >= lo && v <= hi ? v : null);

/** JSON-safe copy of a board/hand piece; anything that does not survive a round trip is dropped. */
export function plainPiece(piece) {
  if (!isObj(piece)) return null;
  try {
    const out = JSON.parse(JSON.stringify(piece));
    if (!isObj(out) || !Number.isInteger(out.uid) || typeof out.kind !== 'string' || !Number.isInteger(out.id)) return null;
    return out;
  } catch { return null; }
}

/**
 * @param {{ round:number, phase:string, players: Record<string, any> }} o players keyed by playerId, each
 *   `{ lp, funds, bandId, board: [key, piece][], hand: piece[], temp: piece[], shop: { level, upgradePrice } }`
 * @returns {object|null} the snapshot, or null when the payload is too large to send
 */
export function makeSnapshot({ round, phase, players, at = Date.now() }) {
  const out = { v: SNAPSHOT_VERSION, at, round, phase, players: {} };
  for (const [id, p] of Object.entries(players || {})) {
    if (Object.keys(out.players).length >= SNAPSHOT_MAX_PLAYERS) break;
    if (!isObj(p)) continue;
    const board = [];
    for (const entry of Array.isArray(p.board) ? p.board : []) {
      if (board.length >= SNAPSHOT_MAX_PIECES) break;
      if (!Array.isArray(entry) || typeof entry[0] !== 'string') continue;
      const piece = plainPiece(entry[1]);
      if (piece) board.push([entry[0], piece]);
    }
    const list = (v) => (Array.isArray(v) ? v.slice(0, SNAPSHOT_MAX_PIECES).map((x) => plainPiece(x)) : []);
    out.players[id] = {
      lp: int(p.lp, 0, 999), funds: int(p.funds, 0, 1e6), bandId: typeof p.bandId === 'string' ? p.bandId.slice(0, 32) : null,
      board, hand: list(p.hand), temp: list(p.temp),
      shop: isObj(p.shop) ? { level: int(p.shop.level, 1, 12), upgradePrice: int(p.shop.upgradePrice, 0, 1e5) } : null,
    };
  }
  const json = JSON.stringify(out);
  return json.length > SNAPSHOT_MAX_BYTES ? null : out;
}

/**
 * Validate what a client sent back. Returns a normalised snapshot or `{ error }` — never throws.
 * @param {unknown} raw
 * @returns {{ ok: true, snapshot: object } | { ok: false, code: string }}
 */
export function checkSnapshot(raw) {
  if (!isObj(raw)) return { ok: false, code: 'BAD_SNAPSHOT' };
  if (raw.v !== SNAPSHOT_VERSION) return { ok: false, code: 'SNAPSHOT_VERSION' };
  const round = int(raw.round, 1, SNAPSHOT_MAX_ROUND);
  if (round == null) return { ok: false, code: 'BAD_SNAPSHOT' };
  if (!isObj(raw.players) || !Object.keys(raw.players).length) return { ok: false, code: 'BAD_SNAPSHOT' };
  if (Object.keys(raw.players).length > SNAPSHOT_MAX_PLAYERS) return { ok: false, code: 'BAD_SNAPSHOT' };
  let bytes = 0;
  try { bytes = JSON.stringify(raw).length; } catch { return { ok: false, code: 'BAD_SNAPSHOT' }; }
  if (bytes > SNAPSHOT_MAX_BYTES) return { ok: false, code: 'SNAPSHOT_TOO_BIG' };
  const phase = typeof raw.phase === 'string' && raw.phase.length <= 32 ? raw.phase : 'ROUND_START';
  const players = {};
  for (const [id, p] of Object.entries(raw.players)) {
    if (typeof id !== 'string' || !isObj(p)) continue;
    const board = [];
    for (const entry of Array.isArray(p.board) ? p.board : []) {
      if (board.length >= SNAPSHOT_MAX_PIECES) break;
      if (!Array.isArray(entry) || typeof entry[0] !== 'string' || entry[0].length > 16) continue;
      const piece = plainPiece(entry[1]);
      if (piece) board.push([entry[0], piece]);
    }
    const list = (v) => (Array.isArray(v) ? v.slice(0, SNAPSHOT_MAX_PIECES).map((x) => plainPiece(x)) : []);
    players[id] = {
      lp: int(p.lp, 0, 999), funds: int(p.funds, 0, 1e6), bandId: typeof p.bandId === 'string' ? p.bandId.slice(0, 32) : null,
      board, hand: list(p.hand), temp: list(p.temp),
      shop: isObj(p.shop) ? { level: int(p.shop.level, 1, 12), upgradePrice: int(p.shop.upgradePrice, 0, 1e5) } : null,
    };
  }
  if (!Object.keys(players).length) return { ok: false, code: 'BAD_SNAPSHOT' };
  return { ok: true, snapshot: { v: SNAPSHOT_VERSION, at: Number(raw.at) || Date.now(), round, phase, players } };
}
