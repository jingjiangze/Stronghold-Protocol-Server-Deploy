// Ordinary air drops have no native lifetime. The former 25 s removal hid a WAIT-only route, rather than
// completing an attack/landing state. Native summons, self-destructs and other enemy kits keep their own timers.
import { canTargetAlly } from '../../targeting.js';
import { ALLY_COLLIDER_RADIUS, COLS, MAX_BATTLE_TIME } from '../../constants.js';

export const AMBUSH_RULES = Object.freeze({ warning: .6 });
const legal = (b, r, c) => b.grid.groundPassable(r, c) && b.grid.tile(r, c).height !== 'HIGH'
  && b.grid.tile(r, c).key !== 'tile_achand';
const defenders = b => b.units.some(u => u.alive && u.deployed && !u.hidden && u.kind !== 'device'
  && (u.side === 'ally' || u.mods?.eventTeam === 1));
const distance2 = (x, y, p) => (p[1] - x) * (p[1] - x) + (p[0] - y) * (p[0] - y);

function ground(b) {
  const out = [];
  for (let r = b.rect.r0; r <= b.rect.r1; r++) for (let c = b.rect.c0; c <= b.rect.c1; c++) {
    if (legal(b, r, c)) out.push([r, c]);
  }
  return out;
}

function route(e, legs) {
  // Do not use rerouteEnemy here: it cancels an in-flight swing and its attack stand every time a target moves.
  e.route = { legs, legIdx: 0, pts: null, ptIdx: 0, suffix: null, version: -1, waitLeft: null };
  e.mem.ambush.route = e.route;
}
const idleLeg = () => ({ t: 'wait', time: MAX_BATTLE_TIME });

function recoverGround(b, e) {
  const r = Math.round(e.y), c = Math.round(e.x);
  // Crates are valid walking/blocking terrain even though an initial drop may not land on one.
  if (b.grid.walkable(r, c) && b.grid.tile(r, c).height !== 'HIGH') return;
  const tiles = ground(b).sort((a, z) => distance2(e.x, e.y, a) - distance2(e.x, e.y, z)
    || a[0] - z[0] || a[1] - z[1]);
  // An entirely closed field waits for terrain to reopen; it never kills a living drop as a pathing fallback.
  if (!tiles.length) return;
  b._unblock(e);
  [e.y, e.x] = tiles[0]; e.moving = false; e.mem.ambush.planKey = null;
}

function navigate(b, e, empty, force = false) {
  const s = e.mem.ambush;
  if (s.escaping !== empty) {
    s.escaping = empty; e.mods = { ...e.mods, ambushEscaping: empty ? 1 : 0 };
    e.lpr = empty ? Math.max(1, e.def.lpr || 1) : 0;
    force = true;
  }
  // A valid block belongs to the core AI. Target changes must not free the blocker or interrupt normal attacks.
  if (e.blockedBy && !empty) return;
  const targets = empty ? [] : b.allies().filter(u => canTargetAlly(e, u, !e.profile.melee)
    && (!e.profile.canTarget || e.profile.canTarget(u)));
  const sr = Math.round(e.y), sc = Math.round(e.x);
  const reach = e.base.rangeRadius + ALLY_COLLIDER_RADIUS, reach2 = reach * reach;
  const inRange = targets.some(u => distance2(e.x, e.y, [u.y, u.x]) <= reach2 + 1e-9);
  const idleOrigin = e.route?.legs[e.route.legIdx]?.t === 'wait' ? `${sr},${sc}` : '';
  const key = `${empty}:${b.grid.version}:${inRange}:${idleOrigin}:${targets.map(u => `${u.id},${u.x},${u.y}`).join(';')}`;
  if (!force && key === s.planKey && e.route === s.route && !e.route.stalled) return;
  s.planKey = key;
  if (!legal(b, sr, sc)) { route(e, [idleLeg()]); return; }
  const field = b.grid.flowField(sr, sc);
  const reachable = p => legal(b, p[0], p[1]) && field.dist[p[0] * COLS + p[1]] >= 0;
  let goal;
  if (empty) {
    const gates = b.grid.specialTiles('end').filter(reachable);
    gates.sort((a, z) => field.dist[a[0] * COLS + a[1]] - field.dist[z[0] * COLS + z[1]]
      || a[0] - z[0] || a[1] - z[1]);
    goal = gates[0];
  } else {
    // The existing drop attack range/type stays unchanged. Stop within its real attack radius, including raised
    // targets; select only reachable LOW firing tiles. [ASSUMED] Use the nearest reachable firing tile, row/col ties.
    if (inRange) {
      route(e, [idleLeg()]); e.moving = false; return;
    }
    const goals = ground(b).filter(p => reachable(p) && targets.some(u => distance2(u.x, u.y, p) <= reach2 + 1e-9));
    goals.sort((a, z) => field.dist[a[0] * COLS + a[1]] - field.dist[z[0] * COLS + z[1]]
      || a[0] - z[0] || a[1] - z[1]);
    goal = goals[0];
  }
  // Finishing a pursuit is a combat/idle state, never a gate leak. A future deploy, reveal, swap or terrain version
  // changes the plan key and resumes movement. Only the empty-field gate route has a final/leak leg.
  route(e, goal ? [{ t: 'move', r: goal[0], c: goal[1], ...(empty ? { final: true } : {}) }, ...(!empty ? [idleLeg()] : [])]
    : [idleLeg()]);
}

export function installAmbush(b, e) {
  if (e.mods?.ambushDrop !== 1 || e.mem.ambush) return;
  const gates = [...b.grid.specialTiles('end'), ...b.grid.specialTiles('start')];
  const tiles = ground(b), dropTiles = tiles.filter(p => !gates.some(g => g[0] === p[0] && g[1] === p[1])
    && !b.allies().some(u => u.alive && Math.round(u.y) === p[0] && Math.round(u.x) === p[1]));
  const allies = b.allies().filter(u => u.kind === 'op' && canTargetAlly(e, u, true));
  const anchor = allies.length ? b.rng.pick(allies) : { x: (b.rect.c0 + b.rect.c1) / 2, y: (b.rect.r0 + b.rect.r1) / 2 };
  const distance = p => Math.abs(p[0] - anchor.y) + Math.abs(p[1] - anchor.x);
  const ordered = dropTiles.sort((a, z) => distance(a) - distance(z) || a[0] - z[0] || a[1] - z[1]);
  const near = ordered.filter(p => distance(p) <= distance(ordered[0]) + .01 && distance(p) >= .7);
  const point = ordered.length ? b.rng.pick((near.length ? near : ordered).slice(0, 8)) : null;
  if (point) { b._unblock(e); e.x = e.spawnX = point[1]; e.y = e.spawnY = point[0]; }
  // Keep the pre-existing adaptation's attack range/type. This fix changes route/lifetime ownership only.
  e.profile.melee = false; e.profile.blockFree = true;
  e.base.rangeRadius = Math.max(e.base.rangeRadius, Math.min(2.5, Math.max(1.5, point ? distance(point) + .1 : 1.5)));
  e.markDirty();
  e.mem.ambush = { home: point || [e.y, e.x], phase: point ? 'landing' : 'active', landAt: b.time + (point ? AMBUSH_RULES.warning : 0) };
  navigate(b, e, !defenders(b), true);
  if (point) {
    b.addBuff(e, { key: 'ambush:landing', duration: AMBUSH_RULES.warning, flags: { noMove: true, disarm: true }, visible: true });
    b.fx('ambushDrop', { id: e.id, x: e.x, y: e.y, t: AMBUSH_RULES.warning });
    b.after(AMBUSH_RULES.warning, () => {
      if (!e.alive) return;
      e.mem.ambush.phase = 'active'; b.fx('ambushLand', { id: e.id, x: e.x, y: e.y });
    }, { owner: e });
  }
  const units = b._ambushUnits ||= new Set(); units.add(e);
  if (b._ambushInstalled) return;
  b._ambushInstalled = true;
  b.on('beforeEnemyLeak', c => {
    const u = c.enemy;
    if (!u.mem.ambush || u.mods?.ambushDrop !== 1) return;
    const empty = !defenders(b);
    if (!empty) c.cancelled = true;
    navigate(b, u, empty, !empty);
  });
  b.on('tick', () => {
    const empty = !defenders(b);
    for (const u of units) {
      if (!u.alive) { units.delete(u); continue; }
      recoverGround(b, u); navigate(b, u, empty);
    }
  }, { priority: -100 });
}
