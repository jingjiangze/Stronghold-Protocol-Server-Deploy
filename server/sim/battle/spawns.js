import {absorbEventSummon} from '../roundEvents.js';
import {registerEventActor} from '../eventTeams.js';
import {isHuntEntry} from '../../../shared/huntProgression.js';
import {fixedLeader,FIXED_LEADER_WARNING} from '../../../shared/leaderSpawns.js';
import {isCentralLeaderSpawn,selectCentralLeaderSpawn} from '../centralLeaderSpawn20261101.js';
// server/sim/battle/spawns.js — Battle methods: enemies: the spawn queue (counted in `total` up front), routes and the
// owner of a tile, spawnEnemy, and the enemies on the field — hidden ones, the shared boss pool sync, the field clamp
// and the list compaction.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { MAX_ALIVE_ENEMIES, FIELD_EDGE_INSET } from '../constants.js';
import { Unit } from '../units.js';
import { compileRoute } from '../ai.js';
import { unitInfo } from '../snapshot.js';
import { normalizeRoute, normalizeEnemy } from '../simdata.js';
import { fin } from './util.js';

const FALLBACK_ENEMY = Object.freeze({
  type: 'enemy', id: 'enemy_unknown', key: 'enemy_unknown', name: '未知敌人', rank: 'NORMAL', maxHp: 2000, atk: 200, def: 100, res: 0,
  aspd: 100, bat: 2, rangeRadius: 0, moveSpeed: 1, massLevel: 1, lpr: 1, motion: 'WALK', applyWay: 'MELEE', dmgType: 'phys',
  immune: new Set(), tauntLevel: 0, blockCnt: 1, epResistance: 0, epDamageResistance: 0, hpRecoveryPerSec: 0, notCountInTotal: false,
  tags: [], abilities: [], skills: [], talent: {}, spine: 'unknown', avatar: 'unknown', raw: {},
});

// A genuinely unplaceable actor stays accounted for until normal field end, but is never rescanned.
const spawnOrder=(a,b)=>Number(!!a.centerPlacementFailed)-Number(!!b.centerPlacementFailed)||a.time-b.time||a.seq-b.seq;

export class BattleSpawns {
  _queueSpawn(s, precount) {
    if (Number(s.time) === Infinity) return; // "never" — not scheduled, not counted
    // capped: a bogus count (Infinity, 1e9) would otherwise hang the constructor / exhaust memory
    const count = Math.min(MAX_ALIVE_ENEMIES, Math.max(1, Math.floor(fin(s.count ?? 1, 1)) || 1));
    const interval = Math.max(0, fin(s.interval, 0));
    const def = this.data.getEnemy(s.enemyKey);
    for (let i = 0; i < count; i++) {
      const p = {
        time: Math.max(0, fin(s.time, 0)) + i * interval, enemyKey: s.enemyKey, routeIndex: s.routeIndex ?? 0, route: s.route ?? null,
        mods: s.mods ?? null, sourcePlayerId: s.sourcePlayerId ?? null, bounty: s.bounty ?? null, tag: s.tag ?? null,
        ownerPlayerId: s.ownerPlayerId ?? null, pos: s.pos ?? null, seq: ++this._spawnSeq, countInTotal: s.countInTotal,
        centerLeader:isCentralLeaderSpawn(def?.raw),centerLeaderWarning:this.kind!=='unite'&&fixedLeader(def?.raw),
      };
      if(p.centerLeader&&p.ownerPlayerId==null)p.ownerPlayerId=this._ownerForTile(p.pos??this._routeFor(p.routeIndex,p.route)?.start);
      p.counted = p.countInTotal ?? (!(def && def.notCountInTotal) && p.tag !== 'boss' && p.tag !== 'part');
      // inTotal: the enemies THIS STAGE scheduled that count — the HUD capsule's own set (DESIGN §14 "顶栏胶囊"). A
      // runtime spawn (a split child, a summon, a part, a form change) is never in it, so the capsule's denominator stays
      // the stage's own enemies while `counted` keeps counting them all. What a 联防 field adds on top is about billing
      // only (`uniteRuntime` in spawnEnemy): it moves no counter.
      p.inTotal = !!p.counted;
      if (precount && p.inTotal) {
        this.total++;
        const owner = p.ownerPlayerId ?? this._ownerForTile(p.pos ?? this._routeFor(p.routeIndex, p.route)?.start);
        const pp = this._pp(owner);
        if (pp) pp.total++;
        p.precounted = true;
      }
      this._pending.push(p);
      if(this._centralPlacementBlocked)this._pending.sort(spawnOrder);
    }
  }

  /** Re-plan from the current position; used by the owner-adapted returning bounty. */
  rerouteEnemy(e,end){
    const route=normalizeRoute({motion:e.motion,start:[e.y,e.x],end,checkpoints:[]});
    this.restoreEnemyRoute(e,route);e.swing=false;e.swingTargets=null;e.atkStandUntil=-Infinity;
  }
  restoreEnemyRoute(e,route){e.route={legs:compileRoute(route,this.rect),legIdx:0,pts:null,ptIdx:0,suffix:null,version:-1,waitLeft:null};}

  _processSpawns() {
    const now = this.time + 1e-9;
    while (this._pending.length && !this._pending[0].centerPlacementFailed && this._pending[0].time <= now) { // loop-cap: pending spawn queue
      const p = this._pending.shift();
      if(p.centerLeader){
        const pos=selectCentralLeaderSpawn(this,p.pos);
        if(!pos){
          p.centerPlacementFailed=true;this._centralPlacementBlocked=true;
          this._handlerError('fixedLeaderPlacement',null,new Error('No legal current-group low-ground tile for '+p.enemyKey));
          // Preserve original schedule time/source/counts for the existing timeout/unspawned accounting.
          // Invalid maps do not consume this boss, block later ordinary spawns, or trigger endless retries.
          this._pending.push(p);this._pending.sort(spawnOrder);continue;
        }
        if(!p.centerWarned||!p.pos||pos[0]!==p.pos[0]||pos[1]!==p.pos[1]){
          const warn=p.centerLeaderWarning&&!p.centerWarned;
          p.pos=pos;p.centerWarned=true;
          // Preserve the old warning delay only for sources that already had it; no new unite/host spawn delay.
          if(warn){p.time=this.time+FIXED_LEADER_WARNING;
            this.fx('fixedLeaderWarning',{x:p.pos[1],y:p.pos[0],dur:FIXED_LEADER_WARNING,r:1.2});
            this._pending.push(p);this._pending.sort(spawnOrder);continue;
          }
        }
      }
      this._safe(() => this.spawnEnemy(p.enemyKey, { ...p, _precounted: p.precounted, _scheduled: true }), 'spawnEnemy');
    }
  }

  _routeFor(idx, explicit = null) {
    if (explicit) return normalizeRoute(explicit);
    return this.routes[idx] ?? this.routes[0] ?? this._defaultRoute();
  }

  _defaultRoute() {
    if (this._defRoute !== undefined) return this._defRoute;
    const starts = this.grid.specialTiles('start');
    const ends = this.grid.specialTiles('end');
    this._defRoute = starts.length && ends.length ? { motion: 'WALK', start: starts[0], end: ends[0], checkpoints: [] } : null;
    return this._defRoute;
  }

  _ownerForTile(tile) {
    if (!this.players.length) return null;
    if (this.players.length === 1 || !tile) return this.players[0].playerId;
    const c = Array.isArray(tile) ? tile[1] : tile.c;
    const half = c >= 11 ? 'R' : 'L';
    return (this.players.find((p) => p.half === half) ?? this.players[0]).playerId;
  }

  /**
   * Spawn an enemy now. opts: { routeIndex, route, pos:[r,c], mods:{hpMul,atkMul,defMul,resMul,speedMul}, tag,
   * sourcePlayerId, ownerPlayerId, bounty:{coins,ownerPlayerId}, countInTotal }
   */
  spawnEnemy(enemyKey, opts = {}) {
    if(this._eventActor?.mods?.eventTeam&&opts.mods?.eventTeam==null)opts={...opts,mods:{...opts.mods,eventTeam:this._eventActor.mods.eventTeam},ownerPlayerId:this._eventActor.ownerId,countInTotal:false,tag:'eventSupport'};
    if (this.enemies.length >= MAX_ALIVE_ENEMIES && this.aliveEnemies().length >= MAX_ALIVE_ENEMIES) {
      this._handlerError('spawnEnemy', null, new Error(`more than ${MAX_ALIVE_ENEMIES} living enemies; spawn of ${enemyKey} refused`));
      return null;
    }
    // opts.def: an inline record (data/enemies.json shape, or an already normalised EnemyDef) for keys absent from data
    let def = null;
    if (opts.def && typeof opts.def === 'object') {
      try { def = opts.def.type === 'enemy' && opts.def.immune instanceof Set ? opts.def : normalizeEnemy(enemyKey, opts.def); } catch (e) { this._handlerError('spawnEnemy.def', null, e); }
    }
    if (!def) def = this.data.getEnemy(enemyKey);
    if (!def) { this.log(`unknown enemy ${enemyKey}`); def = { ...FALLBACK_ENEMY, id: enemyKey, key: enemyKey }; }
    const ov = this.enemyOverrides[def.key] ?? this.enemyOverrides[enemyKey];
    if (ov && ov.stats) {
      const st = ov.stats;
      def = { ...def,
        maxHp: Math.max(1, fin(st.maxHp ?? st.hp, def.maxHp)), atk: Math.max(0, fin(st.atk, def.atk)), def: Math.max(0, fin(st.def, def.def)),
        res: Math.max(0, fin(st.res, def.res)), moveSpeed: Math.max(0, fin(st.moveSpeed, def.moveSpeed)),
        bat: Math.max(0.1, fin(st.bat, def.bat)), aspd: fin(st.aspd, def.aspd) || def.aspd,
        rangeRadius: Math.max(0, fin(st.rangeRadius, def.rangeRadius)), massLevel: fin(st.massLevel, def.massLevel),
        lpr: fin(st.lpr, def.lpr), blockCnt: Math.max(1, fin(st.blockCnt, def.blockCnt)) };
    }
    const route = opts.route ? normalizeRoute(opts.route) : this._routeFor(opts.routeIndex ?? 0);
    let start = opts.pos ?? route?.start ?? [this.rect.r0, this.rect.c1];
    if (!Array.isArray(start) || !Number.isFinite(start[0]) || !Number.isFinite(start[1])) start = route?.start ?? [this.rect.r0, this.rect.c1];
    const R = this.rect; // spawn inside the field (same bounds as _clampPos)
    start = [Math.max(R.r0 - 0.5, Math.min(R.r1 + 0.5, start[0])), Math.max(R.c0 - 0.5, Math.min(R.c1 + 0.5, start[1]))];
    // multipliers: finite and ≥ 0 (hp > 0), anything else counts as 1
    const mm = (v, pos = false) => { const n = fin(v, 1); return n < 0 || (pos && n <= 0) ? 1 : n; };
    const m0 = opts.mods || {};
    const m = { hpMul: mm(m0.hpMul, true), atkMul: mm(m0.atkMul), defMul: mm(m0.defMul), resMul: mm(m0.resMul), speedMul: mm(m0.speedMul) };
    const scaledRes=def.res*(m.resMul??1),resAdd=fin(m0.resAdd,0);
    const contractRes=resAdd>0?Math.max(scaledRes,Math.min(90,scaledRes+resAdd)):scaledRes+resAdd;
    const e = new Unit({
      id: ++this._idSeq, side: 'enemy', kind: ['trap','sceneMarker'].includes(def.raw?.nativeActorType)?'device':'enemy', def, defId: def.key ?? enemyKey, name: def.name,
      x: start[1], y: start[0], motion: def.motion, dir: def.raw?.nativeBountySummonV4?(opts.dir??def.raw.nativeFacing):undefined,
      base: {
        maxHp: def.maxHp * (m.hpMul ?? 1), atk: def.atk * (m.atkMul ?? 1), def: def.def * (m.defMul ?? 1), res: contractRes,
        aspd: def.aspd + fin(m0.aspdAdd,0), bat: def.bat, blockCnt: 0, moveSpeed: def.moveSpeed * (m.speedMul ?? 1), spRecovery: 0,
        tauntLevel: def.tauntLevel, massLevel: def.massLevel, hpRecoveryPerSec: def.hpRecoveryPerSec + def.maxHp*(m.hpMul??1)*Math.max(0,fin(m0.hpRegenRatio,0)), rangeRadius: def.rangeRadius,
      },
    });
    e.alive = true;
    e.deployed = true;
    const baseWeight=def.blockCnt??1,addedWeight=baseWeight+Math.max(0,fin(m0.blockWeightAdd,0));
    e.blockWeight=Number.isFinite(m0.blockWeightMax)?Math.max(baseWeight,Math.min(m0.blockWeightMax,addedWeight)):addedWeight;
    e.hitArea = def.hitArea ?? null;   // 巨型单位 hit rectangle (body.js); null = a point
    e.lpr = def.lpr;
    if(opts.mods?.fixedLeaderChild)e.lpr=0;
    e.mods = opts.mods ?? null;
    e.tag = opts.tag ?? null;
    e.bounty = opts.bounty ?? null;
    e.sourcePlayerId = opts.sourcePlayerId ?? null;
    e.ownerId = opts.ownerPlayerId ?? this._ownerForTile(start);
    e.spawnX = e.x; e.spawnY = e.y;
    if(def.raw?.returnsToOwnField||m0.contractBossLoop){
      e.returningId=opts.returningId||m0.returningId||m0.bountyId||'return:'+e.id;
      e.returnSpawn={route,routeIndex:opts.routeIndex||0,mods:opts.mods?{...opts.mods}:null,bounty:e.bounty,sourcePlayerId:e.sourcePlayerId,ownerPlayerId:e.ownerId,tag:e.tag,countInTotal:e.counted,def:opts.def};
      if(def.raw?.returnsToOwnField&&this.kind==='unite'&&Number.isFinite(m0.returnLpDebt))e.lpr=Math.max(0,Math.min(10,m0.returnLpDebt));
    }
    e.spawnSeq = ++this._spawnSeq;
    if(isHuntEntry(e))e.lpr=0;
    e.deploySeq = ++this._deploySeq;
    e.deployedAt = this.time;
    e.atkCd = 0;
    e.pauseUntil = -Infinity;      // content holds (暴鸰's drop)
    e.atkStandUntil = -Infinity;   // standing for its attack clip (ai.js attackStand)
    e.atkStandCutAt = -Infinity;   // display metadata: when its stand was last cut or ignored (snapshot standCut, battle/events.js)
    e.unbalanceUntil = -Infinity;  // 失衡 (UNBALANCE) after a push / pull (battle/displacement.js _unbalance, ai.js updateEnemy)
    e.swing = false;               // a normal attack swung, its damage frame not reached yet (ai.js enemyAttack)
    // every enemy profile starts with the same fields (stable object shapes keep the hot loop's property reads fast);
    // `dmgType` null = the data's (content may arm a data-unarmed enemy: ai.js enemyAttack); `blockFree` = its 索敌不受阻挡
    // 影响 (content: 自制投石机 — targeting.js canTargetAlly / sortAllyTargets, ai.js attackTargets)
    e.profile = { noAttack: def.dmgType === 'none', maxTargets: 1, atkScale: 1, dmgType: null, blockFree: false };
    e.route = { legs: route ? compileRoute(route, this.rect) : [], legIdx: 0, pts: null, ptIdx: 0, suffix: null, version: -1, waitLeft: null };
    if (!e.route.legs.length) {
      const end = this.grid.specialTiles('end')[0];
      if (end) e.route.legs.push({ t: 'move', r: end[0], c: end[1], final: true });
    }
    e.counted = opts.countInTotal ?? (!def.notCountInTotal && e.tag !== 'boss' && e.tag !== 'part');
    // 联防 (player report, 2026-10-16): on a 联防 field only the enemies the escaped wave SENT IN are billable. An enemy
    // that appears while the field runs — a split child (磨砻's 木制瑞印, 沉沙's 断刃), a summon, a 变身 copy, a boss
    // phantom — never crossed the leaker's own goal, so it must raise neither the HUD's ×N nor the LP the round settles
    // (unite.js uniteSurvivors / spec.js uniteLeft filter exactly this flag). It is a real enemy of the fight like any
    // other: `counted` (kills, 破坏完美作战) reads as on every field. `_scheduled` is the stage's own queue above, the
    // wave itself.
    if (this.kind === 'unite' && !opts._scheduled) e.uniteRuntime = true;
    // inTotal (the HUD capsule's own counter, DESIGN §14): only an enemy the stage scheduled (`_queueSpawn`, which
    // pre-counts it) — or, for future content, an explicit `opts.inTotal: true` — and that counts. Everything spawned
    // while the battle runs (a split child, a summon — bosses included —, a part, a 变身 copy) stays out of the capsule's
    // numerator and denominator, while `counted` (LP, 破坏完美作战, `killed`) keeps counting it as before (`uniteRuntime`
    // above is a billing flag only: it moves no counter).
    e.inTotal = opts.inTotal === true && e.counted;
    if (e.inTotal && !opts._precounted) {
      this.total++;
      const pp = this._pp(e.ownerId);
      if (pp) pp.total++;
    }
    if (e.tag === 'boss') {
      e.isBoss = true;
      if (this.sharedBoss) { e.bossPool = this.sharedBoss; this._syncBossHp(e); }
    }
    if(m0.damageTakenMul>0&&m0.damageTakenMul<1)this.addBuff(e,{key:'contract:hunt',mods:{dmgTakenMul:m0.damageTakenMul},persist:true});
    e.hp = e.bossPool ? e.hp : e.s.maxHp;
    if(def.raw?.returnsToOwnField){const ratio=Number.isFinite(opts.returnHpPct)?opts.returnHpPct:Number.isFinite(m0.returnHpPct)?m0.returnHpPct:null;if(ratio!=null)e.hp=Math.max(1,e.s.maxHp*Math.max(0,Math.min(1,ratio)));}
    if(absorbEventSummon(this,e))return e;
    if(e.mods?.eventFusion===1)this._eventFusionCarrier=e;
    this.units.push(e);
    this.enemies.push(e);
    registerEventActor(this,e);
    this._ev(['spawn', unitInfo(e)]);
    if (this._hooks.deploy) this.emit('deploy', { unit: e, initial: false });
    if (this._hooks.enemySpawn) this.emit('enemySpawn', { enemy: e });
    return e;
  }

  // =============================================================================================================
  // enemies on the field: hidden, boss pool, clamp, compaction

  _setHidden(e, on) {
    if (e.hidden === on) return;
    e.hidden = on;
    if (on) this._unblock(e);
    this.fx(on ? 'disappear' : 'appear', { x: e.x, y: e.y, id: e.id });
  }

  _syncBossHp(e) {
    const pool = e.bossPool;
    if (!pool) return;
    const window = e.bossHpWindow, maxHp = window ? window.max - window.min : pool.maxHp;
    if (Number.isFinite(maxHp) && maxHp > 0 && e.base.maxHp !== maxHp) { e.base.maxHp = maxHp; e.markDirty(); }
    // a broken pool (NaN hp) must not leak NaN into the unit: show it full until the pool is sane again
    const ratio = maxHp > 0 ? (Number.isFinite(pool.hp) ? Math.max(0, pool.hp - (window?.min || 0)) / maxHp : 1) : 0;
    e.hp = e.s.maxHp * Math.min(1, ratio);
  }

  _bossSync() {
    if (!this.sharedBoss) return;
    for (const e of this.enemies) if (e.alive && e.bossPool) {
      this._syncBossHp(e);
      if (e.bossPool.hp <= 0) this.kill(e, null);
    }
  }

  _clampPos(e) {
    const R = this.rect, m = 0.5 - FIELD_EDGE_INSET; // inside the edge: on the edge tile, never halfway (body.js)
    if (e.x < R.c0 - m) e.x = R.c0 - m;
    if (e.x > R.c1 + m) e.x = R.c1 + m;
    if (e.y < R.r0 - m) e.y = R.r0 - m;
    if (e.y > R.r1 + m) e.y = R.r1 + m;
  }

  _compactEnemies() {
    if (!this._enemiesDirty) return;
    this.enemies = this.enemies.filter((e) => e.alive);
    this._enemiesDirty = false;
  }
}
