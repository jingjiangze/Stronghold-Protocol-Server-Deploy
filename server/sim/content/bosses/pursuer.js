import {normalizeRoute} from '../../simdata.js';
import { hypot } from '../../detmath.js';
import { dirVec } from '../../dir.js';
import { canTargetAlly } from '../../targeting.js';
import { hurt, setForm, spawnChildren } from '../enemies/helpers.js';
import { present } from '../enemies/compatibility-helpers.js';
import { pursuerPatrolRoute, pursuerArmyRoute,fitPursuerRoute } from '../../../../shared/pursuerRoutes.js';
import {pursuerArmyForWave} from '../../../../shared/leaderEscorts.js';
import { PURSUER_KEY, PURSUER_RULES, pursuerBodySlots, pursuerFieldSides } from '../../../../shared/pursuerEncounter.js';
import { pursuerRealmCells, pursuerRealmContains } from '../../../../shared/pursuerRealm.js';

export { PURSUER_KEY, PURSUER_RULES };
const raidOf = (b, e) => b._pursuerRaids?.get(e.mods?.pursuerRoot ?? e.id);
export const pursuerOwns = (raid, side, unit) => side < 0 ? unit.x <= raid.center.x : unit.x > raid.center.x;
const targets = (b, raid, e) => b.allies().filter(u => present(u) && pursuerOwns(raid, e.mem.pursuer.sign, u) && canTargetAlly(e, u, true));
const inRealm = (raid, side, u, time) => raid.realms.some(r => r.side === side && pursuerRealmContains(r, u, time));
const regionPoint = (b, raid, side, x, y) => ({
  x: Math.max(side < 0 ? b.rect.c0 : raid.center.x + .05, Math.min(side < 0 ? raid.center.x : b.rect.c1, x)),
  y: Math.max(b.rect.r0, Math.min(b.rect.r1, y)),
});
function routeToGate(b, raid, side, e) {
  const end = b.routes.find(r => r.end && (r.end[1] - raid.center.x) * side > 0)?.end
    || [1, side < 0 ? b.rect.c0 + 3 : b.rect.c1 - 3];
  return { motion: 'WALK', start: [e.y, e.x], end, checkpoints: [] };
}
function moveTo(b, raid, e, x, y) {
  const p = regionPoint(b, raid, e.mem.pursuer.sign, x, y);
  b._unblock(e); e.swing = false; e.swingTargets = null; e.atkStandUntil = -Infinity;
  b.fx('blink', { id: e.id, x: e.x, y: e.y, tx: p.x, ty: p.y, dur: .18 });
  e.x = p.x; e.y = p.y;
  if (e.route) { e.route.pts = null; e.route.ptIdx = 0; e.route.version = -1; }
  b.fx('appear', { id: e.id, x: e.x, y: e.y });
}
function cue(b, e, clip, duration, slot = null) {
  e.skillAnimUntil = b.time + duration;
  b.fx('enemyCue', { id: e.id, x: e.x, y: e.y, clip });
  if (slot != null) b._ev(['cast', e.id, slot, duration]);
}
function knockDown(b, e, u, mul = 1) {
  if (!present(u)) return false;
  const old = u.persist?.redeployMul ?? 1;
  if (u.persist) u.persist.redeployMul = old * mul;
  // Forced knock-out bypasses fatal-damage savers, while retaining normal death/revive hooks.
  try { b._remove(u, 'killed', e); } finally { if (u.persist) u.persist.redeployMul = old; }
  return !u.alive;
}
function cloak(b, e, duration, key) {
  b._unblock(e); e.swing = false; e.swingTargets = null;
  b.addBuff(e, { key, duration, flags: { stealth: true, camou: true, untargetable: true,
    unblockable: true }, visible: true });
  const invKey=key+':invulnerable',invDuration=Math.min(duration,PURSUER_RULES.dodgeDuration);
  b.addBuff(e,{key:invKey,duration:invDuration,flags:{invulnerable:true},visible:true});
  (e.mem.pursuer.cloakEnds||={})[invKey]=b.time+invDuration;
  (e.mem.pursuer.cloakEnds||={})[key]=b.time+duration;
  b.fx('pursuerCloak', { id: e.id, x: e.x, y: e.y, dur: duration });
}
function dodge(b, raid, e) {
  const s = e.mem.pursuer;
  if (s.phase === 1 || b.time < s.dodgeReady) return false;
  s.dodgeReady = b.time + PURSUER_RULES.dodgeEvery;
  s.flashesUntil=b.time+PURSUER_RULES.flashCount*PURSUER_RULES.flashStep;
  cloak(b, e, PURSUER_RULES.cloakDuration, 'pursuer:dodge');
  for (let i = 0; i < PURSUER_RULES.flashCount; i++) {
    const flash = () => {
      if (!present(e) || e.mem.pursuer.phase === 1) return;
      const x = e.x + b.rng.range(-.35, .35), y = e.y + b.rng.range(-.3, .3);
      moveTo(b, raid, e, x, y); s.flashes++;
    };
    if (i === 0) flash(); else b.after(i * PURSUER_RULES.flashStep, flash, { owner: e });
  }
  b.after(PURSUER_RULES.flashCount*PURSUER_RULES.flashStep,()=>{if(present(e)&&s.phase===0&&!s.anchor){moveTo(b,raid,e,s.home.x,s.home.y);e.facing=s.sign;e.moving=false;}},{owner:e});
  return true;
}
function showRealmCell(b, raid, realm, cell) {
  const [y, x] = cell, key = `pursuerRealm:${raid.id}:${realm.side}:${y},${x}`;
  const old = raid.realmFxUntil.get(key) ?? -Infinity;
  if (old >= realm.until) return;
  raid.realmFxUntil.set(key, realm.until);
  b.fx('pursuerRealm', { x, y, r: .5, tile: [y, x], dur: realm.until - b.time,
    key, refresh: old > b.time });
}
function addRealm(b, raid, e, x, y) {
  const side = e.mem.pursuer.sign, footprint = pursuerRealmCells(x, y, side, b.rect, raid.center.x).slice(0, PURSUER_RULES.realmMaxTiles);
  const [row, col] = footprint[0], own = raid.realms.filter(r => r.side === side && r.until > b.time);
  // Repeated placement on the same origin neither stacks nor refreshes its lifetime.
  if (own.some(r => r.x === col && r.y === row) || own.length >= PURSUER_RULES.realmLiveCap) return;
  const realm = { x: col, y: row, side, bornAt: b.time, until: b.time + PURSUER_RULES.realmDuration,
    id: ++raid.realmId, footprint, cells: [footprint[0]], nextSpread: b.time + PURSUER_RULES.realmSpreadEvery };
  raid.realms.push(realm); showRealmCell(b, raid, realm, footprint[0]);
}
function advanceRealms(b, raid) {
  raid.realms = raid.realms.filter(r => r.until > b.time);
  for (const [key, until] of raid.realmFxUntil) if (until <= b.time) raid.realmFxUntil.delete(key);
  // [ASSUMED] One cell every 2 seconds, clockwise; all cells expire 40 seconds after the original strike.
  for (const realm of raid.realms) while (realm.cells.length < realm.footprint.length && b.time >= realm.nextSpread) {
    const cell = realm.footprint[realm.cells.length]; realm.cells.push(cell);
    realm.nextSpread += PURSUER_RULES.realmSpreadEvery; showRealmCell(b, raid, realm, cell);
  }
}
function priority(u) {
  const high = !u.ground, arts = u.profile?.dmgType === 'arts', sniper = u.def.profession === 'SNIPER';
  return (high ? 0 : 3) + (arts ? 0 : sniper ? 1 : 2);
}
function assassinate(b, raid, e) {
  const s = e.mem.pursuer;
  if (s.phase === 1 || !present(e) || s.anchor || b.time < (s.castUntil || 0)) return false;
  const candidates = targets(b, raid, e).filter(u => u.kind === 'op');
  if (!candidates.length) return false;
  const best = Math.min(...candidates.map(priority)), target = b.rng.pick(candidates.filter(u => priority(u) === best));
  const [dr, dc] = dirVec(target.dir), life = target.deploySeq;
  const anchor = { x: s.phase===0?s.home.x:e.x, y: s.phase===0?s.home.y:e.y, route: e.route ? structuredClone(e.route) : null }; s.anchor = anchor;
  s.nextAssassination = b.time + PURSUER_RULES.assassinationEvery; s.lastTarget = target.id;
  moveTo(b, raid, e, target.x - dc * .7, target.y - dr * .7);
  e.facing=dc|| (target.x>=e.x?1:-1);
  s.castUntil = b.time + 1.767;
  if (s.phase === 2) setForm(b, e, 'pursuerPhase2');
  b.addBuff(e, { key: 'pursuer:strike', duration: 1.767, flags: { noMove: true, disarm: true } });
  cue(b, e, 'Skill_01', 1.767, s.phase === 0 ? 0 : 1);
  b.fx('lock', { id: target.id, src: e.id, x: target.x, y: target.y, dur: PURSUER_RULES.strikeDelay });
  b.after(PURSUER_RULES.strikeDelay, () => {
    if (!present(e) || s.phase === 1 || s.anchor !== anchor) return;
    if (present(target) && target.deploySeq === life && pursuerOwns(raid, s.sign, target) && canTargetAlly(e, target, true)) {
      const { x, y } = target;
      knockDown(b, e, target, PURSUER_RULES.redeployMul);
      addRealm(b, raid, e, x, y);
      b.fx('pursuerExecution', { id: e.id, x, y, target: target.id, r: 1.2 });
    }
    moveTo(b, raid, e, anchor.x, anchor.y); if (anchor.route) e.route = anchor.route; s.anchor = null;
  }, { owner: e });
  return true;
}
function summonArmy(b, raid) {
  const living = b.enemies.filter(u => u.alive && u.mem.pursuerArmy === raid.id).length;
  const remaining = Math.min(PURSUER_RULES.armyLiveCap - living, PURSUER_RULES.armyTotalCap - raid.summoned);
  const list = pursuerArmyForWave(raid.armyWave++);
  const round=b.round>0?b.round:14;
  let guns=b.enemies.filter(u=>u.alive&&/^enemy_10122_uacann/.test(u.defId)).length;
  let count = 0;
  for (let i = 0; i < Math.min(remaining, list.length); i++) {
    const side = raid.bodies.length > 1 ? (i < list.length/2 ? -1 : 1) : raid.bodies[0].mem.pursuer.sign;
    const body = raid.bodies.find(u => present(u) && u.mem.pursuer.sign === side);
    if (!body) continue;
    const p = { x: raid.center.x + side * .8, y: raid.center.y + (i % 3 - 1) * .7 };
    let key=list[i];
    if(round<=8&&/^enemy_10121_uasnip/.test(key)&&i===4)key='enemy_10120_uaghst';
    if(/^enemy_10122_uacann/.test(key)){
      if(round<9||guns>=(round<=16?1:2))key='enemy_10120_uaghst'+(round>=13?'_2':'');
      else{key=round>=13?'enemy_10122_uacann_2':'enemy_10122_uacann';guns++;}
    }
    const route=fitPursuerRoute(pursuerArmyRoute(side,b.rng.chance(.5),[p.y,p.x],raid.center.x),b.grid,b.rect,side,raid.center.x);
    if(/^enemy_1112_emppnt/.test(key))route.motion='FLY';
    const child = spawnChildren(b, body, key, 1, { pos: route.start, route,
      countInTotal: false, mods: { ...(body.mods || {}), pursuerArmySide: side } })[0];
    if (!child) continue;
    child.mem.pursuerArmy = raid.id; child.mem.pursuerArmySide = side; child.bounty = null;
    const own = child.profile.canTarget;
    child.profile.canTarget = u => pursuerOwns(raid, side, u) && (!own || own(u));
    raid.summoned++; count++;
  }
  raid.nextArmy = b.time + PURSUER_RULES.armyEvery;
  return count;
}
function startRebirth(b, raid) {
  if (raid.phase !== 0) return;
  raid.phase = 1;
  if (raid.pool && raid.pool.hp > raid.boundary) raid.pool.damage(null, raid.pool.hp - raid.boundary);
  for (const e of raid.bodies) if (e.alive && e.deployed) {
    b._setHidden(e, false);
    const s = e.mem.pursuer; s.phase = 1; s.rebirthUntil = b.time + PURSUER_RULES.rebirth;
    if (s.anchor) { moveTo(b, raid, e, s.anchor.x, s.anchor.y); if (s.anchor.route) e.route = s.anchor.route; s.anchor = null; }
    e.hp = 1; e.profile.noAttack = true; e.swing = false; e.swingTargets = null; b._unblock(e);
    b.addBuff(e, { key: 'pursuer:rebirth', duration: PURSUER_RULES.rebirth,
      flags: { invulnerable: true, untargetable: true, unblockable: true, noMove: true }, visible: true });
    setForm(b, e, 'pursuerReborn', 'phase', { dur: PURSUER_RULES.rebirth });
    b.after(PURSUER_RULES.rebirthDelay, () => {
      if (!present(e)) return;
      for (const u of b.allies()) if (present(u) && pursuerOwns(raid, s.sign, u)) {
        const execute = inRealm(raid, s.sign, u, b.time) && canTargetAlly(e, u, true);
        hurt(b, e, u, e.s.atk, 'arts', { ignoreSelect: true, tags: ['pursuerRebirth'] });
        if (execute && present(u)) knockDown(b, e, u);
        b.fx('pursuerExecution', { x: u.x, y: u.y, r: .65 });
      }
    }, { owner: e });
  }
  b.after(PURSUER_RULES.rebirth, () => {
    raid.phase = 2;
    for (const e of raid.bodies) if (e.alive && e.deployed) {
      const s = e.mem.pursuer; s.phase = 2; e.profile.noAttack = false;
      b.removeBuff(e, 'pursuer:rebirth');b.removeBuff(e,'pursuer:stationary');
      b.addBuff(e, { key: 'pursuer:phase2', persist: true, mods: { atkPct: .5 } });
      if (raid.pool) { e.bossHpWindow = { min: 0, max: raid.boundary }; b._syncBossHp(e); }
      else e.hp = e.s.maxHp;
      setForm(b, e, 'pursuerPhase2');
      b.restoreEnemyRoute(e,normalizeRoute(fitPursuerRoute(pursuerPatrolRoute(s.sign,s.upper,[e.y,e.x],raid.center.x),b.grid,b.rect,s.sign,raid.center.x)));
      b.fx('pursuerAwake', { id: e.id, x: e.x, y: e.y });
    }
  });
}
function install(b) {
  if (b._pursuerInstalled) return; b._pursuerInstalled = true;
  b.on('hit', c => {
    const e = c.target, raid = e?.defId === PURSUER_KEY && raidOf(b, e);
    if (raid && present(e) && c.dmg.amount > 0 && !c.dmg.tags?.includes('hpLoss') && dodge(b, raid, e)) c.dmg.cancel = true;
    if (raid && c.source?.side === 'ally' && ['phys', 'arts'].includes(c.dmg.type)
      && inRealm(raid, e.mem.pursuer.sign, c.source, b.time)) c.dmg.mul *= 1 - PURSUER_RULES.realmResistance;
    const src = c.source, ownRaid = src?.defId === PURSUER_KEY ? raidOf(b, src)
      : src?.mem.pursuerArmy && b._pursuerRaids.get(src.mem.pursuerArmy);
    const side = src?.mem.pursuer?.sign ?? src?.mem.pursuerArmySide;
    if (ownRaid && c.target?.side === 'ally' && !pursuerOwns(ownRaid, side, c.target)) c.dmg.cancel = true;
  }, { priority: 100 });
  b.on('attack', ({ attacker: e, targets: list, isSkill }) => {
    if (e?.defId !== PURSUER_KEY || isSkill) return;
    const raid = raidOf(b, e), s = e.mem.pursuer;
    if (!raid || s.phase === 1) return;
    const melee = s.phase === 2 && !!e.blockedBy;
    for (const u of list || []) {
      const hit = target => {
        if (!present(target) || !present(e) || !pursuerOwns(raid, s.sign, target)) return;
        b.dealDamage(e, target, { amount: e.s.atk * (melee ? 2.5 : 1), type: 'phys', isAttack: true, isProjectile: !melee });
      };
      if (melee) hit(u);
      else b.addProjectile({ from: e, target: u, source: e, speed: 12, visual: 'none', onHit: c => hit(c.target) });
    }
  });
  b.on('death', ({ unit, reason }) => {
    if (unit?.defId !== PURSUER_KEY || reason !== 'killed') return;
    const raid = raidOf(b, unit);
    if (!raid || raid.bodies.some(present)) return;
    for (const child of b.enemies) if (child.alive && child.mem.pursuerArmy === raid.id) b._remove(child, 'expired');
  });
  b.on('beforeEnemyLeak', c => {
    const e = c.enemy, raid = e?.defId === PURSUER_KEY && raidOf(b, e);
    if (!raid) return;
    c.cancelled = true; const s = e.mem.pursuer; s.upper = b.rng.chance(.5); s.patrols = (s.patrols || 0) + 1;
    b.restoreEnemyRoute(e,normalizeRoute(fitPursuerRoute(pursuerPatrolRoute(s.sign,s.upper,[e.y,e.x],raid.center.x),b.grid,b.rect,s.sign,raid.center.x)));
  });
}

/** User-designed dual-region raid. Timers and selection use only the deterministic battle clock/RNG. */
export function pursuerKit(_ab, e, b) {
  install(b);
  const raids = b._pursuerRaids ||= new Map(), root = e.mods?.pursuerRoot ?? e.id;
  let raid = raids.get(root);
  if (!raid) {
    const pool = e.bossPool;
    raid = { id: root, phase: 0, pool, boundary: pool ? pool.maxHp / 2 : null,
      center: { x: (b.rect.c0 + b.rect.c1) / 2, y: 3 }, bodies: [], realms: [], realmId: 0, realmFxUntil: new Map(),
      nextArmy: b.time + PURSUER_RULES.armyEvery, armyWave: 0, summoned: 0, tickAt: -1 };
    raids.set(root, raid);
  }
  raid.bodies.push(e);
  return [{
    spawn(b, e, s) {
      const sides = pursuerFieldSides(b.players);
      e.mem.pursuer = s; s.phase = 0;
      s.sign = sides.includes(e.mods?.pursuerSign) ? e.mods.pursuerSign : sides[0];
      const slot = pursuerBodySlots(b.players, b.rect).find(slot => slot.side === s.sign);
      s.home={x:slot.start[1],y:slot.start[0]};moveTo(b,raid,e,s.home.x,s.home.y);e.facing=s.sign;
      s.nextAssassination = b.time + PURSUER_RULES.assassinationEvery;
      s.nextCloak = b.time + PURSUER_RULES.cloakEvery; s.dodgeReady = b.time; s.flashes = 0;
      s.upper = b.rng.chance(.5); s.patrols = 0;
      e.profile.canTarget = u => pursuerOwns(raid, s.sign, u);
      e.profile.melee = false; e.profile.deferHit = true; e.profile.shot = 'enemy'; e.base.rangeRadius = 2; e.markDirty();
      if (raid.pool) { e.bossHpWindow = { min: raid.boundary, max: raid.pool.maxHp }; b._syncBossHp(e); }
      setForm(b, e, 'pursuerPhase1');
      b.addBuff(e,{key:'pursuer:stationary',persist:true,flags:{noMove:true}});e.moving=false;
      if (!e.mods?.pursuerTwin) for (const side of sides) {
        if (raid.bodies.some(body => body.mem.pursuer?.sign === side)) continue;
        const p = { x: raid.center.x + side, y: s.home.y };
        b.spawnEnemy(PURSUER_KEY, { pos: [p.y, p.x], route: routeToGate(b, raid, side, p), tag: 'boss',
          countInTotal: false, mods: { ...(e.mods || {}), pursuerRoot: root, pursuerTwin: 1, pursuerSign: side } });
      }
    },
    tick(b, e, s) {
      if(s.phase===0&&!s.anchor&&b.time>=(s.flashesUntil||0)){if(hypot(e.x-s.home.x,e.y-s.home.y)>1e-6)moveTo(b,raid,e,s.home.x,s.home.y);e.facing=s.sign;e.moving=false;}
      for(const[key,until]of Object.entries(s.cloakEnds||{}))if(b.time>=until){b.removeBuff(e,key);delete s.cloakEnds[key];}
      if (s.phase === 0 && raid.pool?.hp <= raid.boundary) startRebirth(b, raid);
      const p = regionPoint(b, raid, s.sign, e.x, e.y);
      if (e.x !== p.x || e.y !== p.y) { b._unblock(e); e.x = p.x; e.y = p.y; }
      if (raid.tickAt !== b.time) {
        raid.tickAt = b.time; advanceRealms(b, raid);
        for (const u of b.allies()) if (present(u)) {
          const side = u.x <= raid.center.x ? -1 : 1;
          if (inRealm(raid, side, u, b.time)) b.addBuff(u, { key: 'pursuer:realm', duration: .1,
            mods: { aspd: PURSUER_RULES.realmAspd }, visible: true });
          else b.removeBuff(u, 'pursuer:realm');
        }
        if (b.time >= raid.nextArmy) summonArmy(b, raid);
      }
      if (s.phase === 1 || e.hidden) return;
      const melee = s.phase === 2 && !!e.blockedBy;
      e.profile.melee = melee; e.profile.shot = melee ? 'none' : 'enemy';
      if (s.phase === 2 && b.time >= (s.castUntil || 0) && e.form !== (melee ? 'pursuerMelee' : 'pursuerPhase2')) setForm(b, e, melee ? 'pursuerMelee' : 'pursuerPhase2');
      if (b.time >= s.nextCloak) { s.nextCloak = b.time + PURSUER_RULES.cloakEvery; cloak(b, e, PURSUER_RULES.cloakDuration, 'pursuer:cloak'); }
      if (b.time >= s.nextAssassination && !assassinate(b, raid, e)) s.nextAssassination = b.time + 1;
    },
    killed(_ctx, b, e, s) {
      if (s.phase === 2) return false;
      startRebirth(b, raid); e.hp = 1; return true;
    },
  }];
}

/** Same controller paths used by the isolated skill demo; these are never match protocol commands. */
export function demoPursuerSkill(b, e, kind) {
  const raid = raidOf(b, e); if (!raid || !present(e)) return false;
  if (kind === 'assassinate') return assassinate(b, raid, e);
  if (kind === 'cloak') { cloak(b, e, PURSUER_RULES.cloakDuration, 'pursuer:cloak'); e.mem.pursuer.nextCloak = b.time + PURSUER_RULES.cloakEvery; return true; }
  if (kind === 'army') return summonArmy(b, raid);
  return false;
}
