// Test encounter extensions requested by the owner; all times are game seconds.
import { MAX_ALIVE_ENEMIES } from '../../constants.js';
import {straightClear} from '../../grid.js';
import {BLACKSNAKE_KEY,BLACKSNAKE_NORMALS,BLACKSNAKE_ELITES} from '../../../../shared/blacksnakeRoster.js';
export {BLACKSNAKE_KEY,BLACKSNAKE_NORMALS,BLACKSNAKE_ELITES};
export const BLACKSNAKE_TUNING = Object.freeze({
  firstLifeShare: 0.5, firstHpMultiplier: 1.35, poolMultiplier: 1.08,
  atk: 542, rageAtk: 825, def: 700, rangeRadius: 6,
  burnFrom: 20, burnTo: 200, burnAtkCut: 0.3, igniteCd: 23,
  heavyDamage: 825, rageHeavyDamage: 1021, heavyCd: 20,
  barrageDamage: 328, rageBarrageDamage: 685, barrageCd: 35,
  periodicFire: 8, rowFireDamage: 632.6, finalFireDuration: 60, finalFireWaves: 13, finalFireGap: 4, finalRowFireDamage: 495.96,
  crystalHp: 6500, crystalDef: 220, crystalRes: 20, crystalDamage: 1500,
  // Owner requested a large reduction; 35% is [ASSUMED], once per 30 active battle seconds.
  blinkFirst: 30, blinkCooldown: 30, blinkChance: 0.35, blinkWindup: 0.6, blinkRecovery: 0.7,
  // [ASSUMED] Owner requested a relative short jump: at most two map tiles, with clear ground between both ends.
  blinkDistance: 2,
  // Opening events keep their original delays; only the recurring wave intervals gain 8 game seconds.
  addGap: 0.2, firstSummonInit: 15, secondSummonInit: 25,
  firstSummonGap: 23, secondSummonGap: 33, transitionSummonGap: 18, finalSummonGap: 18,
});
const S = 'enemy_1002_nsabr', A = 'enemy_1003_ncbow', M = 'enemy_1011_wizard', G = 'enemy_1015_litamr';
const H = 'enemy_10124_uashld', C = 'enemy_10124_uashld_2', D = 'enemy_1112_emppnt_2';
const HC = 'enemy_10122_uacann_2', LC = 'enemy_10122_uacann', U = 'enemy_1111_ucommd';
const I = 'enemy_10120_uaghst', X = 'enemy_10121_uasnip';
const pools = values => Object.freeze(values.map(group => Object.freeze(group.map(pair => Object.freeze(pair)))));
export const BLACKSNAKE_SUMMON_POOLS = Object.freeze({
  first: pools([[[S,4],[A,2]], [[G,2],[M,1]], [[S,3],[G,2]], [[A,3],[M,2]]]),
  firstStrong: pools([[[S,8],[G,4],[A,4],[M,2]], [[G,6],[M,4],[A,2]], [[S,12],[A,6]], [[G,8],[M,3]]]),
  second: pools([
    [[I,4]], [[H,2],[X,2]], [[H,3],[C,1]], [[H,2],[LC,1]],
    [[I,2],[X,1],[LC,1]], [[U,6]], [[U,4],[X,2]], [[U,4],[LC,1]],
  ]),
  secondStrong: pools([
    [[C,3]], [[H,2],[HC,1]], [[H,2],[D,1]], [[I,4],[D,1]], [[U,4],[LC,2]], [[U,6]],
  ]),
  transition: pools([[[S,3],[M,1],[LC,1],[G,2],[A,2]]]),
  final: pools([[[H,3],[HC,1]]]),
});

export function blackSnakeSide(battle, unit = null) {
  if (battle.players.length === 1) return battle.players[0].half === 'R' || battle.players[0].side === 'R' ? 'R' : 'L';
  return unit?.x > (battle.rect.c0 + battle.rect.c1) / 2 ? 'R' : 'L';
}
export const blackSnakeLeader = (battle, unit) => !battle.enemies.some(e => e.alive && e.defId === BLACKSNAKE_KEY && e.id < unit.id);
export function blackSnakeFireRows(battle) {
  const r = battle.rect, trim = battle.players.length > 1 && r.r1 - r.r0 >= 2 ? 1 : 0;
  return Array.from({ length: r.r1 - r.r0 + 1 - trim * 2 }, (_, i) => r.r0 + trim + i);
}
export const blackSnakeFireSides = battle => battle.players.length > 1 ? ['L', 'R'] : [blackSnakeSide(battle)];

/** Fixed walkable nodes use the engine's ordinary flow-field routing between them. */
export function blackSnakeZone(battle, side) {
  const r = battle.rect, mid = (r.c0 + r.c1) / 2;
  return { ...r, c0: side === 'R' ? mid : r.c0, c1: side === 'R' ? r.c1 : mid };
}
/** Keep legal authored spawns; repair an invalid mirror/landing within its own half, deterministically. */
export function blackSnakeGroundStart(battle, pos, side) {
  const z = blackSnakeZone(battle, side), [row, col] = pos, tiles = [];
  if (battle.grid.groundPassable(Math.round(row), Math.round(col))
    && col >= z.c0 && col <= z.c1) return pos.slice();
  for (let r = z.r0; r <= z.r1; r++) for (let c = z.c0; c <= z.c1; c++) {
    if (battle.grid.groundPassable(r, c) && battle.grid.tile(r, c).special !== 'end') tiles.push([r, c]);
  }
  tiles.sort((a,b) => Math.abs(a[0]-row)+Math.abs(a[1]-col)-Math.abs(b[0]-row)-Math.abs(b[1]-col) || a[0]-b[0] || a[1]-b[1]);
  return tiles[0] || pos.slice();
}
export function blackSnakePatrolNodes(battle, side, start = null) {
  const r = battle.rect, mid = (r.c0 + r.c1) / 2;
  const tiles = [];
  for (let row = r.r0; row <= r.r1; row++) for (let col = r.c0; col <= r.c1; col++) {
    if (side === 'R' ? col <= mid : col >= mid) continue;
    if (battle.grid.groundPassable(row, col) && !['start', 'end'].includes(battle.grid.tile(row, col)?.special)) {
      const unit = start && { x: start[1], y: start[0], profile: { zoneBounds: blackSnakeZone(battle, side) } };
      if (!unit || blackSnakeRoute(battle, unit, {r: row, c: col}).length) tiles.push([row, col]);
    }
  }
  if (!tiles.length) return [];
  const c0 = side === 'R' ? mid + 1 : r.c0 + 1, c1 = side === 'R' ? r.c1 - 1 : mid - 1;
  const desired = [[r.r0 + 2, c1 - 1], [r.r1 - 1, c1 - 2], [r.r1 - 1, c0 + 2], [r.r0 + 2, c0 + 1]];
  const nodes = [];
  for (const [row, col] of desired) {
    const choices = tiles.filter(t => !nodes.some(p => p[0] === t[0] && p[1] === t[1]));
    choices.sort((a, b) => (Math.abs(a[0] - row) + Math.abs(a[1] - col)) - (Math.abs(b[0] - row) + Math.abs(b[1] - col)) || a[0] - b[0] || a[1] - b[1]);
    if (choices[0]) nodes.push(choices[0]);
  }
  return nodes;
}
export function installBlackSnakePatrol(battle, unit) {
  const side = blackSnakeSide(battle, unit), start = blackSnakeGroundStart(battle, [unit.y, unit.x], side);
  unit.y = start[0]; unit.x = start[1]; unit.tileR = Math.round(unit.y); unit.tileC = Math.round(unit.x);
  const nodes = blackSnakePatrolNodes(battle, side, start);
  unit.mem.bsSide = side;
  unit.profile.zoneBounds = blackSnakeZone(battle, side);
  unit.profile.canTarget = target => target.x >= unit.profile.zoneBounds.c0 && target.x <= unit.profile.zoneBounds.c1;
  unit.profile.routePlanner = blackSnakeRoute;
  unit.profile.zoneOwnerId = (battle.players.find(p => p.half === side || p.side === side) || battle.players[0])?.playerId;
  if (nodes.length < 2) return nodes;
  unit.route = { legs: [...nodes, nodes[0]].map(([r, c]) => ({ t: 'move', r, c, final: false })),
    legIdx: 0, pts: null, ptIdx: 0, suffix: null, version: -1, waitLeft: null };
  return nodes;
}
export function blackSnakeSummonTiles(battle) {
  const r = battle.rect, col = Math.round((r.c0 + r.c1) / 2), row = Math.round((r.r0 + r.r1) / 2);
  return [row - 1, row, row + 1].filter(v => v >= r.r0 && v <= r.r1).map(v => [v, col]);
}
/**
 * 楼梯 (the map's `telin` / `telout` pair): the detour every other boss's minions walk before their gate — they walk to
 * the stairs at the far end of the lane, DISAPPEAR, wait 3 s and APPEAR at the exit the official routes use
 * (`act1autochess_h07_02` route 0: move [1,17] → disappear → wait 3 s → appear [5,10] → gate [1,3]), and only then
 * enter the blue gate. Returns `{ stair, exit }` in [row, col], or null on a field without both pairs (the direct route
 * stands). Owner 2026-10-20: the Black Snake's summons must read like the other boss waves, not walk the short way.
 */
export function blackSnakeStairs(battle, side, goal) {
  if (!goal) return null;
  const g = battle.grid, r = battle.rect, mid = (r.c0 + r.c1) / 2;
  const own = (p) => (side === 'R' ? p[1] > mid : p[1] < mid);
  const dist = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
  const stairs = g.specialTiles('telin').filter(own), exits = g.specialTiles('telout');
  if (!stairs.length || !exits.length) return null;
  // the stairs at the far end of the lane (nearest the gate): where the official boss maps put the ladder
  const stair = stairs.slice().sort((a, b) => dist(a, goal) - dist(b, goal) || a[0] - b[0] || a[1] - b[1])[0];
  // reappear at the exit farthest from the gate (m01's bottom-centre [5,10], the official routes' appear tile; the other
  // one sits in the gate's own row), ties → nearest the field centre
  const cy = (r.r0 + r.r1) / 2, cx = (r.c0 + r.c1) / 2;
  const exit = exits.slice().sort((a, b) => dist(b, goal) - dist(a, goal)
    || (Math.abs(a[0] - cy) + Math.abs(a[1] - cx)) - (Math.abs(b[0] - cy) + Math.abs(b[1] - cx))
    || a[0] - b[0] || a[1] - b[1])[0];
  return { stair, exit };
}
export function blackSnakeTargets(battle, source, targets) {
  const zone = source.profile.zoneBounds;
  return targets.filter(u => !zone || (u.x >= zone.c0 && u.x <= zone.c1))
    .sort((a, b) => Number(b.ownerId === source.profile.zoneOwnerId) - Number(a.ownerId === source.profile.zoneOwnerId) || a.id - b.id);
}
/** The actual summon route, shared by the skill and its read-only prediction. */
export function blackSnakeAddRoute(battle, side, at, motion = 'WALK') {
  const r = battle.rect, mid = (r.c0+r.c1)/2;
  const goal = battle.grid.specialTiles('end').find(p => side === 'R' ? p[1]>mid : p[1]<mid);
  if (!goal) return null;
  const stairs = blackSnakeStairs(battle,side,goal);
  const checkpoints = stairs ? [{type:'MOVE',pos:stairs.stair},{type:'DISAPPEAR'},
    {type:'WAIT',time:3},{type:'APPEAR',pos:stairs.exit}] : [];
  return {motion,start:at,end:goal,checkpoints};
}
export function summonBlackSnakeAdds(battle, source, kind = 'first', forced = null) {
  const choices = BLACKSNAKE_SUMMON_POOLS[kind];
  if (!choices) throw new Error(`Unknown Black Snake summon pool ${kind}`);
  const normal = kind === 'first' || kind === 'second';
  const epoch = source.mem.bsNormalWaveEpoch || 0;
  const group = forced || battle.rng.pick(choices), tiles = blackSnakeSummonTiles(battle);
  const side = source.mem.bsSide || blackSnakeSide(battle, source);
  const owner = source.profile.zoneOwnerId || battle.players[0]?.playerId;
  const keys = group.flatMap(([key, count]) => Array.from({ length: count }, () => key));
  battle.fx('bsSummonWave', { x: source.x, y: source.y, id: source.id, kind: 'bsSummonWave', pool: kind, count: keys.length, side });
  for (const [i, key] of keys.entries()) {
    const spawn = () => {
      if (battle.finished || !source.alive || !battle.data.getEnemy(key)
        || (normal && epoch !== (source.mem.bsNormalWaveEpoch || 0))) return;
      // Capacity skips this scheduled member; a later free slot must never release an old wave backlog.
      if (battle.aliveEnemies().length >= MAX_ALIVE_ENEMIES - 4) return;
      const at = tiles[i % tiles.length], route = blackSnakeAddRoute(battle,side,at,battle.data.getEnemy(key).motion || 'WALK');
      if (!route) return;
      const e = battle.spawnEnemy(key, { pos: at,
        route,
        tag: 'bsAdd', countInTotal: true, inTotal: true, ownerPlayerId: owner, sourcePlayerId: owner });
      if (e) {
        e.mem.bsAdd = true; e.mem.bsSource = source.id; e.mem.bsSide = side; e.mem.bsWave = kind;
        e.profile.zoneOwnerId = owner; e.profile.zoneBounds = { ...source.profile.zoneBounds };
        if (e.motion !== 'FLY') e.profile.routePlanner = blackSnakeRoute;
        e.profile.canTarget = target => target.x >= e.profile.zoneBounds.c0 && target.x <= e.profile.zoneBounds.c1;
        battle.fx('bsAddSpawn', { x: e.x, y: e.y, id: e.id, kind: 'bsAddSpawn' });
      }
    };
    battle.after(i * BLACKSNAKE_TUNING.addGap, spawn, { owner: source });
  }
  return keys.length;
}

/** Invalidate queued normal adds too, including capacity-delayed callbacks. */
export function cancelBlackSnakeNormalWave(source) {
  source.mem.bsNormalWaveEpoch = (source.mem.bsNormalWaveEpoch || 0) + 1;
}

/** Four-neighbour paths remain inside the snake's assigned half, including after an obstacle change. */
export function blackSnakeRoute(battle, unit, leg) {
  const z = unit.profile.zoneBounds;
  if (!z) return null;
  const sr = Math.round(unit.y), sc = Math.round(unit.x), dest = `${leg.r},${leg.c}`;
  const start = `${sr},${sc}`, queue = [[sr, sc]], prev = new Map([[start, null]]);
  for (let i = 0; i < queue.length && !prev.has(dest); i++) {
    const [r, c] = queue[i];
    for (const [nr, nc] of [[r + 1,c],[r,c + 1],[r - 1,c],[r,c - 1]]) {
      const key = `${nr},${nc}`;
      if (nr < z.r0 || nr > z.r1 || nc < z.c0 || nc > z.c1 || prev.has(key) || !battle.grid.groundPassable(nr,nc)) continue;
      // Never cut the blue gate on the way to the stairs / a patrol node: only the final leg may reach it (its `end`).
      if (key !== dest && battle.grid.tile(nr, nc)?.special === 'end') continue;
      prev.set(key, `${r},${c}`); queue.push([nr,nc]);
    }
  }
  if (!prev.has(dest)) return [];
  const points = [];
  for (let key = dest; key !== start; key = prev.get(key)) {
    const [y,x] = key.split(',').map(Number); points.push({x,y});
  }
  return points.reverse();
}

/** Pure, RNG-free short-jump prediction. Advance along the current leg; no forward ground means no jump. */
export function blackSnakeBlinkTarget(battle, unit) {
  const leg = unit.route?.legs?.[unit.route.legIdx];
  if (!leg || leg.t !== 'move') return null;
  const path = blackSnakeRoute(battle, unit, leg), next = path[0];
  if (!next) return null;
  const dx = next.x-unit.x, dy = next.y-unit.y, z = unit.profile.zoneBounds || battle.rect;
  const limit = BLACKSNAKE_TUNING.blinkDistance, candidates = [];
  for (let r = Math.max(z.r0, Math.ceil(unit.y-limit)); r <= Math.min(z.r1, Math.floor(unit.y+limit)); r++) {
    for (let c = Math.max(z.c0, Math.ceil(unit.x-limit)); c <= Math.min(z.c1, Math.floor(unit.x+limit)); c++) {
      const x = c-unit.x, y = r-unit.y, distance = x*x+y*y, progress = x*dx+y*dy;
      if (distance < .25 || distance > limit*limit+1e-9 || progress <= 1e-9
        || !battle.grid.groundPassable(r,c) || battle.grid.tile(r,c).special === 'end'
        || !straightClear(battle.grid,unit.x,unit.y,{x:c,y:r})) continue;
      if (!blackSnakeRoute(battle, {x:c,y:r,profile:unit.profile}, leg).length && (c!==leg.c || r!==leg.r)) continue;
      candidates.push({r,c,progress,distance});
    }
  }
  candidates.sort((a,b) => b.progress-a.progress || a.distance-b.distance || a.r-b.r || a.c-b.c);
  return candidates.length ? [candidates[0].r,candidates[0].c] : null;
}
