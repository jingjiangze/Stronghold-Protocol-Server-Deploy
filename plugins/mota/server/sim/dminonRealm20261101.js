// One native realm, legal map mask, and Battle-owned boss-side projection. No caster-position side guessing.
import { GEO } from '../../shared/constants.js';
import { COLS } from './constants.js';

function bossRegion(b, u) {
  const ps = b.getPlayer(u.ownerId);
  if (!ps || !b.players.includes(ps) || !['L', 'R'].includes(ps.half)) return () => false;
  const cache = b._dminonRealmRegions ??= new Map();
  if (cache.has(ps)) return cache.get(ps);
  let contains;
  if (b.players.some(p => p.half !== ps.half)) {
    // The same per-field ownership rule used for enemy accounting/bounties. Both actual halves are present.
    contains = (r, c) => b.getPlayer(b._ownerForTile([r, c]))?.half === ps.half;
  } else {
    // _ownerForTile deliberately assigns the whole map to a lone player. For this narrower realm rule,
    // obtain that side's inner edge from the engine's mapped deployment board, not a fixed x or the unit's x.
    const columns = [];
    for (const p of b.players) if (p.half === ps.half) for (let c = GEO.FIELD.c0; c <= GEO.FIELD.c1; c++) {
      const mapped = b._boardTile(p, GEO.FIELD.r0, c)[1];
      if (Number.isInteger(mapped) && mapped >= 0 && mapped < COLS) columns.push(mapped);
    }
    if (!columns.length) contains = () => false;
    else {
      const edge = ps.half === 'R' ? Math.min(...columns) : Math.max(...columns);
      contains = (_r, c) => ps.half === 'R' ? c >= edge : c <= edge;
    }
  }
  cache.set(ps, contains);
  return contains;
}
export function dminonRealmTileAllowed(b, u, r, c) {
  if (!u || !b.grid.inBounds(r, c) || !b.grid.groundPassable(r, c)) return false;
  return b.kind !== 'boss' && b.kind !== 'hidden' || bossRegion(b, u)(r, c);
}
export function dminonRealmSeedAllowed(b, u, r, c) {
  if (!u || !b.grid.inBounds(r, c) || !b.grid.inRect(r, c)) return false;
  const tile = b.grid.tile(r, c);
  // Preserve genuine native ranged-platform seeds; do not turn forbidden/void tiles into territory.
  const exists = b.grid.groundPassable(r, c) || tile.build === 'RANGED' && !b.grid.obstacle[r * COLS + c];
  return !!exists && (b.kind !== 'boss' && b.kind !== 'hidden' || bossRegion(b, u)(r, c));
}
export function dminonRealmKeys(b, u) {
  return new Set([...(u.rangeKeys || []), ...(u.mem.dminonTiles || [])].filter(k => dminonRealmSeedAllowed(b, u, Math.floor(k / COLS), k % COLS)));
}
/** Keep the existing Set. Preserve valid initial/skill-range seeds before a native targeting range is withdrawn. */
export function retainDminonRealm(b, u) {
  const tiles = u.mem.dminonTiles ??= new Set();
  let changed = false;
  for (const k of tiles) if (!dminonRealmSeedAllowed(b, u, Math.floor(k / COLS), k % COLS)) { tiles.delete(k); changed = true; }
  for (const k of u.rangeKeys || []) if (!tiles.has(k) && dminonRealmSeedAllowed(b, u, Math.floor(k / COLS), k % COLS)) { tiles.add(k); changed = true; }
  if (changed) u.mem.dminonRevision = (u.mem.dminonRevision || 0) + 1;
  return tiles;
}
