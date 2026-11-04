// [ASSUMED] Scene target HP, geometry, caps and timing use the ordinary-field adaptations in
// tools/data/additional-leaders.mjs and docs/ADDITIONAL-LEADERS-20261021.md; no map script is implicitly enabled.
import {COLS} from '../../constants.js';
import {nativeObjectivePosition,nativeObjectiveFacing,configureNativeBountyObjective} from './native-bounty-objectives-20261101.js';
import {hurt, areaAllies, targetsNear, byPriority, spawnChildren, stayRoute, remainingRoute, setForm} from './helpers.js';

export const alive = u => !!(u?.alive && u.deployed && !u.removed);
export const friends = (b, e) => b.enemies.filter(u => alive(u) && u !== e && !u.mem.leaderObjective);
export const phase2 = e => !!e.mem.additionalPhase2;
export const ranged = (e, radius = 4, type = 'arts') => {
  e.profile.melee = false; e.profile.dmgType = type; e.base.rangeRadius = radius; e.markDirty();
};
export const target = (b, e, key = null, reverse = true) => {
  const list = byPriority(e, targetsNear(b, e, 99));
  if (key) list.sort((a, z) => (reverse ? -1 : 1) * (a.s[key] - z.s[key]));
  return list[0];
};
export const stop = (b, e) => { e.mem.additionalRoute ||= remainingRoute(e); b.restoreEnemyRoute(e, b._routeFor(0, stayRoute(e))); b._unblock(e); };
export const barrier = (b, e, amount, key, duration = 30) => b.addBuff(e, {
  key, duration, shield: Math.max(1, amount), shieldType: ['phys', 'arts'], visible: true,
});
export function strike(b, e, u, scale = 1, radius = 0, type = 'arts') {
  if (!alive(u)) return;
  const units = radius > 0 ? areaAllies(b, e, u.x, u.y, radius) : [u];
  for (const v of units) hurt(b, e, v, e.s.atk * scale, type);
  b.fx('explode', {id: e.id, x: u.x, y: u.y, r: radius || .5, kind: type});
}
export function pulse(b, e, scale = 1, type = 'arts') {
  for (const u of targetsNear(b, e, 99)) hurt(b, e, u, e.s.atk * scale, type);
  b.fx('explode', {id: e.id, x: e.x, y: e.y, r: 4, kind: type});
}
export function dot(b, e, u, {key, duration = 10, amount = 0, type = 'arts', mods = {}, interval = 1}) {
  if (!alive(u)) return;
  b.addBuff(u, {key: `${key}:${e.id}`, duration, interval, mods, visible: true,
    onTick: () => { if (alive(u) && alive(e)) hurt(b, e, u, typeof amount === 'function' ? amount() : amount, type); },
  });
}
// A support target has no bounty, leak cost or inherited boss HP. It is always destroyable, even after a revive.
export function objective(b, e, {key, name, pos = null, hp = 3000, onBreak = null, onClear = null, attack = false, link = null} = {}) {
  if(!key||!b.data.getEnemy(key))throw Error('Native objective requires an explicit registered identity');
  const owned = e.mem.leaderObjectives ||= [];
  if (owned.filter(alive).length >= 6) return null;
  const index = owned.filter(alive).length;
  const r = Math.max(b.rect.r0, Math.min(b.rect.r1, Math.round(e.y) + (index % 2 ? -1 : 1)));
  const c = Math.max(b.rect.c0, Math.min(b.rect.c1, Math.round(e.x) - 1 - Math.floor(index / 2)));
  const location=nativeObjectivePosition(b,e,key,pos||[r,c],owned);if(!location)return null;
  const unit = spawnChildren(b, e, key, 1, {pos: location,dir:nativeObjectiveFacing(b,e,key,location), countInTotal: false, tag: 'part', mods: {}, route: stayRoute(e)})[0];
  if (!unit) return null;
  unit.mem.leaderObjective = {parent: e.id, onBreak, onClear}; unit.name = name || unit.name;
  unit.bounty = null; unit.mods = {}; unit.base.maxHp = hp; unit.base.def = 100; unit.base.res = 10;
  unit.base.lpr = 0; unit.lpr = 0; unit.base.moveSpeed = 0; unit.base.atk = e.s.atk * .4;
  unit.base.immunities = new Set(); unit.buffs = []; unit.profile.noAttack = !attack;
  unit.profile.dmgType = 'phys'; unit.profile.melee = false; unit.base.rangeRadius = 4;
  // Neutral scene targets do not run the original enemy actor's kit.
  if (unit.mem.ab) unit.mem.ab.list = [];
  configureNativeBountyObjective(b,e,unit,key,attack,link);
  if(!unit.alive)return null;
  unit.markDirty(); unit.hp = unit.s.maxHp; stop(b, unit); owned.push(unit);
  if (!b._additionalObjectiveHooks) {
    b._additionalObjectiveHooks = true;
    b.on('death', ({unit: dead, reason, killer}) => {
      if (reason !== 'killed' || dead.mem.leaderObjective?.cleanup) return;
      const meta = dead.mem.leaderObjective;
      if (meta?.onBreak) meta.onBreak(killer);
    });
    const cleanup = parent => {
      for (const child of parent.mem.leaderObjectives || []) if (alive(child)) {
        child.mem.leaderObjective.cleanup = true; child.mem.leaderObjective.onClear?.(); b.kill(child, null);
      }
    };
    b.on('death', ({unit: dead}) => cleanup(dead));
    b.on('enemyLeak', ({enemy}) => cleanup(enemy));
  }
  b.fx('telegraph', {id: unit.id, x: unit.x, y: unit.y, r: .5, dur: 1, kind: 'target'});
  return unit;
}
export const objectives = e => (e.mem.leaderObjectives || []).filter(alive);
export function adds(b, e, key, count = 1, cap = 8) {
  const living = b.enemies.filter(u => alive(u) && u.mem.additionalParent === e.id).length;
  const spawned = spawnChildren(b, e, key, Math.min(count, Math.max(0, cap - living)), {route: e.mem.additionalRoute || remainingRoute(e)});
  for (const u of spawned) { u.mem.additionalParent = e.id; u.bounty = null; }
  return spawned;
}
export function nextForm(b, e, index, mods = {}) {
  e.mem.additionalPhase2 = index > 1; e.mem.additionalPhase = index;
  b.addBuff(e, {key: 'additional:phase', persist: true, mods});
  setForm(b, e, index === 2 ? 'form2' : `form${index}`);
}
export function seal(b, r, c, source) {
  (b._sealedDeployTiles ||= new Set()).add(r * COLS + c);
  b.fx('zone', {id: source.id, x: c, y: r, r: .45, dur: 180, kind: 'seal'});
}
// Rebirth uses the native dispatcher: the interim KO never pays a bounty or records a kill.
export function lives({count = 2, delay = 5, onPhase = null, hpRatio = 1} = {}) {
  return {
    spawn(b, e, a) { a.phase = 1; },
    killed(c, b, e, a) {
      if (a.phase >= count) return false;
      a.phase++; e.hp = 1; e.mem.additionalRebirthing = true; e.profile.noAttack = true;
      b._unblock(e); setForm(b, e, 'reborn');
      b.addBuff(e, {key: 'additional:reborn', duration: delay, persist: true, visible: true,
        flags: {invulnerable: true, untargetable: true, unblockable: true, noMove: true},
        onExpire: () => {
          if (!alive(e)) return;
          e.mem.additionalRebirthing = false; e.profile.noAttack = false;
          nextForm(b, e, a.phase); if (onPhase) onPhase(b, e, a.phase, c.killer);
          e.hp = Math.max(1, e.s.maxHp * hpRatio);
        },
      });
      return true;
    },
  };
}
