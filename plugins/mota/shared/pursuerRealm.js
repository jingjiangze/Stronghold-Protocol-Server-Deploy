/** Map rows increase upward: centre, then clockwise from the upper cell. No RNG or wall clock. */
const OFFSETS = Object.freeze([[0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]]);

/** Clip a fixed 3x3 footprint to the field and its assigned half. Coordinates are [row, col]. */
export function pursuerRealmCells(x, y, side, rect, center) {
  const col = Math.max(rect.c0, Math.min(rect.c1, Math.max(side > 0 ? Math.floor(center) + 1 : rect.c0,
    Math.min(side < 0 ? Math.floor(center) : rect.c1, Math.floor(x + .5)))));
  const row = Math.max(rect.r0, Math.min(rect.r1, Math.floor(y + .5)));
  return OFFSETS.map(([dr, dc]) => [row + dr, col + dc]).filter(([r, c]) =>
    r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1 && (side < 0 ? c <= center : c > center));
}

/** Grid membership, rather than a circular radius; even diagonal cell corners are in the cell. */
export function pursuerRealmContains(realm, unit, time) {
  if (!(realm.until > time)) return false;
  const row = Math.floor(unit.y + .5), col = Math.floor(unit.x + .5);
  return realm.cells.some(([r, c]) => row === r && col === c);
}
