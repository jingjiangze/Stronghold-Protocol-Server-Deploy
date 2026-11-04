import { drainCosmeticSkillHits } from '../cosmeticSkillHits20261102.js';
import { webLayerView } from '../content/garrisons/webTraits20261101.js';
// server/sim/battle/events.js — Battle methods: client events (DESIGN §8.2 tuples, bounded buffer), the snapshot, field
// meta, fx and the sim log.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { EVENT_BUFFER_CAP } from '../constants.js';
import {incomingRoutePoints} from '../ai.js';
import {predictBossRoutes} from '../routePrediction.js';
import {fixedLeader} from '../../../shared/leaderSpawns.js';
import { elementView } from '../damage.js';
import { unitInfo, snapshotUnits, ammoView, wolfView, negView, coinView, mysticView, layerView, chargeView } from '../snapshot.js';

export class BattleEvents {
  /** Selected route inspection can refresh without serialising units or touching lazy combat stats. */
  routePredictions() { return predictBossRoutes(this); }
  fx(kind, params = {}) {
    if (!this.recordEvents) return;
    const { x = 0, y = 0, ...extra } = params || {};
    this._ev(['fx', kind, Math.round(x * 100) / 100, Math.round(y * 100) / 100, extra]);
  }

  log(msg) {
    const k = 'log:' + msg;
    if (this._errKeys.has(k)) return;
    this._errKeys.add(k);
    if (this.opts.verbose) this.logger.warn?.(`[sim] ${msg}`);
  }

  _ev(tuple) {
    if (!this.recordEvents) return;
    this._evq.push(tuple);
    if (this._evq.length > EVENT_BUFFER_CAP) this._evq.splice(0, this._evq.length - EVENT_BUFFER_CAP / 2);
  }

  /** Client-facing events since the last drain (DESIGN §8.2 tuples). */
  drainEvents() {
    const ev = this._evq;
    this._evq = [];
    return drainCosmeticSkillHits(this, ev);
  }

  /**
   * Record that an enemy's attack recovery (atkStandUntil) is cut or ignored now — snapshot `standCut`, display metadata
   * (render/interp.js); never changes the attack's timing or state.
   *
   * 谁在切它:眩晕 / 冻结 / 沉睡 / 恐惧 / 失衡 / 离场(ai.js updateEnemy),以及失衡本身(displacement.js `_unbalance`)。
   */
  _cutAttackStand(unit) {
    if (unit.side === 'enemy' && Number.isFinite(unit.atkStandUntil) && unit.atkStandUntil > this.time) {
      unit.atkStandCutAt = this.time;
    }
  }

  /**
   * Compact full snapshot of this field (DESIGN §8.2 b.snap), plus (only when non-empty):
   *   down: [[id, respawnAt, respawnTime, state, row, col]] — operators that left the field waiting to redeploy (isDown): the
   *         game time their respawn timer ends, its length (s), constants.js DOWN_STATE and the tile they lie on (and
   *         come back on: _layBody — where they fell, or their home);
   *   elem: [[id, element, fill, cooldownEnd, cooldown]] — the element gauge each unit shows (damage.js elementView);
   *   ammo: [[id, rounds left, rounds in the magazine]] — a running ammo skill, whole rounds (snapshot.js ammoView): the segmented bar;
   *   wolves: [[id, 狼影 left, the talent's maximum]] — 伺夜's 狼群 (snapshot.js wolfView): the pips under the HP bar;
   *   neg: [[id, fill]] — the share of its cap a negative-HP pool holds (snapshot.js negView; 斩业星熊's 我执): the red bar;
   *   energy: [[id, stored, the trait's maximum]] — a 秘术师's stored attack energies (snapshot.js mysticView): the
   *         count under the HP bar;
   *   layers: [[id, n]] — the hit-negating 护盾 layers a unit holds (snapshot.js layerView: 泥岩's): the official layer
   *         effect it shows;
   *   charges: [[id, stored, maximum]] — the charges an ally's charge skill stores (snapshot.js chargeView: 卡涅利安's): the
   *         official sand armour of her charges;
   *   stand: [[id, until]] — when each enemy's attack recovery ends (atkStandUntil; alive, deployed, visible, not
   *         feared or stunned) — display metadata (render/interp.js holds the position until then);
   *   standCut: [[id, at]] — the latest time each listed enemy's recovery was cut or ignored (_cutAttackStand), the
   *         dying ones in their death window included.
   * ammo / wolves / neg / energy / layers / charges / stand / standCut are display only: no sim state reads them, and the
   * nine-field unit tuples are unchanged.
   */
  snapshot() {
    const snap = {
      fieldId: this.fieldId,
      t: Math.round(this.time * 1000) / 1000,
      units: snapshotUnits(this.units, this.time),
      dp: this.players.length ? Math.floor(this.players[0].dp) : 0,
      dpProgress:this.players.length?Math.max(0,Math.min(1,this.players[0].dp>=this.flags.dpMax?1:this.players[0].dp-Math.floor(this.players[0].dp))):0,
      killed: this.killed,
      total: this.total,
    };
    const web = webLayerView(this);
    if (Object.keys(web).length) snap.webLayers = web;
    if (this.players.length > 1) {
      snap.dps = {};snap.dpProgressByPlayer={};
      for (const p of this.players){snap.dps[p.playerId]=Math.floor(p.dp);snap.dpProgressByPlayer[p.playerId]=Math.max(0,Math.min(1,p.dp>=this.flags.dpMax?1:p.dp-Math.floor(p.dp)));}
    }
    if (this.sharedBoss) snap.boss = { hp: Math.max(0, Math.round(this.sharedBoss.hp)), max: Math.round(this.sharedBoss.maxHp) };
    if(this._sui)snap.sui={phase:this._sui.phase,cards:Object.fromEntries([...this._sui.hands].map(([id,h])=>[id,{sword:h.sword,fire:h.fire,readyAt:Math.round(h.readyAt*1000)/1000}]))};
    const r2 = (v) => Math.round(v * 100) / 100;
    let down = null;
    for (const u of this.allyUnits) {
      if (!this.isDown(u)) continue;
      (down || (down = [])).push([u.id, r2(u.respawnAt), r2(Math.max(0, u.respawnAt - u.deathAt)), this._downState(u), ...this.restTile(u)]);
    }
    if (down) snap.down = down;
    let elem = null, ammo = null, wolves = null, neg = null, energy = null, stand = null, standCut = null;
    let listed = null;   // the ids in snap.units, built for the first enemy with a cut to report
    for (const u of this.units) {
      if (u.side === 'enemy' && u.atkStandCutAt >= 0) {
        const cutAt = Math.round(u.atkStandCutAt * 1000) / 1000;
        // 只报**这一帧快照里也有**的单位,否则客户端拿不到对应的视图(它可能已经离场)
        if (cutAt <= snap.t && (listed || (listed = new Set(snap.units.map((x) => x[0])))).has(u.id)) (standCut || (standCut = [])).push([u.id, cutAt]);
      }
      if (!u.alive || !u.deployed || u.hidden) continue;
      if(Number.isFinite(u.mem.investigation)&&u.mem.investigation<600)(snap.investigation||=[]).push([u.id,u.mem.investigation,600]);
      const until = Math.round(u.atkStandUntil * 1000) / 1000;
      if (u.side === 'enemy' && !u.s.flags.fear && !u.s.flags.stun && Number.isFinite(until) && until > snap.t) {
        (stand || (stand = [])).push([u.id, until]);
      }
      const v = elementView(u, this.time);
      if (v) (elem || (elem = [])).push([u.id, v[0], v[1], v[2], v[3]]);
      const am = ammoView(u);
      if (am) (ammo || (ammo = [])).push([u.id, am[0], am[1]]);
      const wv = wolfView(u);
      if (wv) (wolves || (wolves = [])).push([u.id, wv[0], wv[1]]);
      const ng = negView(u);
      if (ng) (neg || (neg = [])).push([u.id, ng]);
      const purse = coinView(u);
      if (purse) (snap.coins || (snap.coins = [])).push([u.id, ...purse]);
      const en = mysticView(u);
      if (en) (energy || (energy = [])).push([u.id, en[0], en[1]]);
      const ly = layerView(u);
      if (ly) (snap.layers || (snap.layers = [])).push([u.id, ly]);
      const ch = chargeView(u);
      if (ch) (snap.charges || (snap.charges = [])).push([u.id, ch[0], ch[1]]);
    }
    if (elem) snap.elem = elem;
    if (ammo) snap.ammo = ammo;
    if (wolves) snap.wolves = wolves;
    if (neg) snap.neg = neg;
    if (energy) snap.energy = energy;
    if (stand) snap.stand = stand;
    if (standCut) snap.standCut = standCut;
    return snap;
  }

  /**
   * Field meta for m.field: { fieldId, kind, rect, stageId, units: UnitInfo[] } — the units on the field, knocked-out
   * operators waiting to redeploy included (a client joining mid-battle shows them down).
   */
  fieldMeta({preview=false}={}) {
    if(!this._incomingRoutes||this._incomingRoutesVersion!==this.grid.version){
      const routes=new Map();
      for(const s of this.opts.spawns||[]){
        const def=this.data.getEnemy(s.enemyKey);if(!def||s.tag==='boss'||s.tag==='part'||fixedLeader(def.raw)||!(def.moveSpeed>0)||!Number.isFinite(Number(s.time??0)))continue;
        const route=this._routeFor(s.routeIndex,s.route);if(!route?.start)continue;
        const key=JSON.stringify(route),time=Math.max(0,Number(s.time||0)-2),old=routes.get(key);
        if(old){old.time=Math.min(old.time,time);continue;}if(routes.size>=16)continue;
        const segments=incomingRoutePoints(this,route);if(segments.length)routes.set(key,{id:'route:'+routes.size,time,segments});
      }
      this._incomingRoutes=[...routes.values()].sort((a,b)=>a.time-b.time);this._incomingRoutesVersion=this.grid.version;
    }
    return {
      fieldId: this.fieldId, kind: this.kind, rect: { ...this.rect }, stageId: this.stageId,
      units: !this.started&&this._openingUnits?this._openingUnits:this.units.filter((u) => (u.alive && u.deployed && !u.hidden) || this.isDown(u)).map(unitInfo),
      ...(this.opts.incomingPreviewDone?{openingAlreadyShown:true}:{}),
      incomingRoutes:!preview&&this.opts.incomingPreviewDone?[]:this._incomingRoutes,
      routePredictions:predictBossRoutes(this,{live:false}),
    };
  }
}
