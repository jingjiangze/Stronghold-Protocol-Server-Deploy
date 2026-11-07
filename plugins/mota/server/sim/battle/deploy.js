import {isHuntEntry} from '../../../shared/huntProgression.js';
import {carrySpyInvestigation} from '../../../shared/spyInvestigation.js';
// server/sim/battle/deploy.js — Battle methods: deployment, death and redeploy: _deploy (home, landing or rest tile; 联防
// carry), kill / retreat and the removal bookkeeping (_remove, hooks of removed units released at step end), redeploy /
// automatic redeploys, leaks.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { COLS } from '../constants.js';
import { unitInfo } from '../snapshot.js';
import { fin } from './util.js';

/** Placement class of a deployed ally ('melee' | 'high' | 'ranged' | 'all'), from its chess record's `position`.
 * Mirrors server/match/board.js positionClass without the 可以放置于远程位 trait exception (a melee chess with that
 * trait is melee-only here for now — the battle grid has no trait-text parser). Used by deployLive's canStand gate. */
function deployPosClass(u) {
  const rec = (u && u.def && (u.def.raw ?? u.def)) || null;
  const pos = rec && typeof rec.position === 'string' ? rec.position.toUpperCase() : 'ALL';
  if (rec && rec.rangedTilesOnly === true) return 'high';
  if (pos === 'MELEE') return 'melee';
  if (pos === 'HIGH') return 'high';
  return 'ranged';
}

/**
 * 对抗投放（2V2 对称血量）：把一只投放怪记到它的投放席位上 —— `counts[seat]++`（只数，老形状不变）并把它的
 * 阶位阶梯价累进 `values[seat]`（settle 按价值扣血 / 发奖）。价格来自 spawn spec 的 `confrontPrice`
 * （match/confront.js 写入）；缺价 ⇒ 一只 1 点，与 settle.js 的 `monsterPriceOf` 取不到时回落 1 同一口径。
 * 与 server/sim/battle/deploy.js 的同名函数逐字一致（两棵 sim 必须同源，业主报障「扣血逻辑完全混乱」）。
 */
function tallySeat(seat, counts, values, price) {
  const k = String(seat);
  counts[k] = (counts[k] || 0) + 1;
  values[k] = (values[k] || 0) + (Number.isFinite(price) && price > 0 ? price : 1);
}

export class BattleDeploy {
  /**
   * Deploy `u` on its home tile, or on `tile` ([r, c]: a one-off landing tile — the home stays the board tile; an
   * operator that left the field comes back on its body tile, restTile). `keepSp` = { sp, charges }
   * restored right after the skill reset, before the `deploy` hook fires.
   */
  _deploy(u, { initial = false, carry = null, tile = null, keepSp = null, preBattleAggroSeq = null } = {}) {
    if ((u.alive && u.deployed) || u._removing) return false;
    const R0 = tile ? tile[0] : u.homeR, C0 = tile ? tile[1] : u.homeC;
    if (!this.grid.inRect(R0, C0)) {
      this.log(`${u} at ${R0},${C0} is outside the field rect; not deployed`);
      if (!tile) u.removed = true;
      return false;
    }
    const k = R0 * COLS + C0;
    if (this._sealedDeployTiles?.has(k)) return false;
    const occ = this._occ[k];
    if (occ && occ !== u && occ.alive && occ.deployed) { this.log(`tile ${R0},${C0} occupied; ${u} not deployed`); return false; }
    // "倒地干员所在地块视为可部署，但所有我方单位在此处的部署行为将被阻止" (PRTS 卫戍协议/帮助 §作战阶段 单位部署)
    if (this.downOn(R0, C0, u)) { this.log(`a knocked-out operator lies on ${R0},${C0}; ${u} not deployed`); return false; }
    const first = u.deploySeq === 0;
    u.alive = true;
    u.deployed = true;
    u.removed = false;
    u.hidden = false;
    u.body = null;
    u.countdown = null; // a countdown summon's content starts its new life in the deploy hook (content/tokens.js startCountdown)
    u.downAtHome = false; // a new deployment: a later knock-out lies where it falls again (Battle._layBody)
    u.x = C0; u.y = R0; u.tileR = R0; u.tileC = C0;
    u.blocking = [];
    u.deploySeq = ++this._deploySeq;
    // A prepared map character is instantiated after the board deployment but keeps an earlier target order.
    // Its deploySeq remains the identity of this actual deployment for scheduled effects and redeploy checks.
    u.aggroSeq = preBattleAggroSeq ?? u.deploySeq;
    u.deployedAt = this.time;
    u.atkCd = 0;
    u.lastAttackAt = -Infinity;
    u.elem.burn = u.elem.neural = u.elem.necrosis = u.elem.apoptosis = u.elem.erosion = 0;
    u.ground = this.grid.isLow(R0, C0) && !this._elevated?.has(k);
    u.markDirty();
    u.hp = u.s.maxHp;
    // 联防 carry (PRTS 卫戍协议/帮助 §联防阶段 "将对应单位的生命比例、技力修改至与上一阶段结束时相同（召唤物仅修改技力…）"):
    // an operator restores HP/SP, a summon SP only; actual 联防 opening restoration is deferred until Battle.start ends
    const cs = initial || (first && this._startDeploying) ? (carry ?? u.carry) : null;
    // 联防 reconstructs deployment/battle-start effects first, then restores HP/SP once in Battle.start.
    const restoreLater = this.kind === 'unite' && this._startDeploying;
    if (!restoreLater && cs && u.kind === 'op' && Number.isFinite(cs.hpPct) && cs.hpPct > 0) u.hp = u.s.maxHp * Math.min(1, cs.hpPct);
    this._occ[k] = u;
    this._refreshRange(u); // also rebuilds baseRangeKeys (initial range incl. permanent rangeExtend)
    if (!u.skill) this._setupUnit(u);
    u.skill.reset(restoreLater ? null : cs);
    const sk = u.skill;
    // "自动操作具有3s冷却，在完成一次操作或作战开始时部署的单位将进入冷却" (PRTS 卫戍协议/帮助; skills.js)
    if (initial) sk.opReadyAt = this.time + this.flags.startOpCooldown;
    if (keepSp && !sk.noSkill && sk.kind !== 'passive' && !sk.active) {
      sk.charges = Math.max(0, Math.min(sk.maxCharges, Math.floor(fin(keepSp.charges, 0))));
      sk.sp = Math.max(0, Math.min(sk.spCost, fin(keepSp.sp, 0)));
      if (sk.charges >= sk.maxCharges) sk.sp = sk.spCost;
    }
    // 藏品通道 (relicMods)：开战限时 debuff / 部署晕眩 / DoT / 负面庇护 —— 无 relicMods 时整段空转
    this._relicOnDeploy(u, { initial });
    if (first) this._ev(['spawn', unitInfo(u)]);
    this._ev(['deploy', u.id]);
    if (this._hooks.deploy) this.emit('deploy', { unit: u, initial });
    // Explicit carry outside the 联防 opening follows this one deployment. The opening itself restores at the end
    // of Battle.start, so deployment/battle-start gifts do not come on top of it; later redeploys keep their gifts.
    if (!restoreLater && cs && Number.isFinite(cs.sp) && u.alive && u.skill) u.skill.setSpTotal(cs.sp);
    return true;
  }

  /**
   * 藏品通道的部署时效果（`relicMods`，spec.js sanitizeUnitLoadout；生产侧 server/match/match/meltdown.js
   * relicAllyMul）。字段缺省时每一步都是空转，所以召唤物 / 装置 / 无藏品的干员行为完全不变。
   */
  _relicOnDeploy(u, { initial = false } = {}) {
    if (!u) return;
    // 开战限时 debuff（startDebuff「战斗开始时我方攻击 −20%、攻速 −20、技力回复 −20%，持续 N 秒」）：只作用于战斗
    // 开始的那次部署，用 buff 的到期实现「到期自动恢复」
    const start = u.relicStart;
    if (initial && start && start.dur > 0) {
      const mods = {};
      if (start.atkPct) mods.atkPct = start.atkPct;
      if (start.aspd) mods.aspd = start.aspd;
      if (start.spMul !== 1) mods.spRecoveryMul = start.spMul;
      if (Object.keys(mods).length) this.addBuff(u, { key: 'relic:startDebuff', duration: start.dur, mods });
    }
    // 部署即晕眩（stunOnDeploy / openingDebuff，本引擎用晕眩代表那一组负面状态）
    if (u.relicStunOnDeploy > 0) {
      this.applyStatus(u, 'stun', { duration: u.relicStunOnDeploy, ignoreSelect: true });
    }
    // 每秒固定伤害（neuralDps）：整场一次，persist 跨倒地保留，重新部署不会叠第二层
    if (u.relicFlatDps > 0 && !u.findBuff('relic:dps')) {
      const dps = u.relicFlatDps;
      this.addBuff(u, {
        key: 'relic:dps', interval: 1, persist: true,
        onTick: ({ battle, unit }) => battle.loseHp(unit, dps, { sourceless: true, tags: ['relic:dps'] }),
      });
    }
    // 部署后限时按最大生命百分比掉血（fogOnDeploy）：每次部署重新计时，到期即停
    if (u.relicDot) {
      const { pct, dur } = u.relicDot;
      this.addBuff(u, {
        key: 'relic:dot', duration: dur > 0 ? dur : Infinity, interval: 1,
        onTick: ({ battle, unit }) => battle.loseHp(unit, pct * unit.s.maxHp, { sourceless: true, tags: ['relic:dot'] }),
      });
    }
    // 负面庇护（shelterOnDebuff）：该玩家已触发过就常驻（status.js `_relicOnStatusApplied`），之后部署的单位也吃到
    if (this._relicDebuffActive && this._relicDebuffActive.has(u.ownerId ?? '')) this._relicApplyTeamDebuff(u);
  }

  /** Mark `unit` dead (hp reached 0). Fires `kill` then `death`. */
  kill(unit, killer = null) {
    if (!unit || !unit.alive) return;
    unit.hp = 0;
    if (this._hooks.kill) this.emit('kill', { killer, victim: unit });
    // a nested kill/retreat inside the handlers already removed it: a later handler's hp write must not stick
    if (!unit.alive) { if (!unit.bossPool) unit.hp = 0; return; }
    if (unit.hp > 0 && (!unit.bossPool || unit.bossHpWindow && unit.bossPool.hp > 0)) { // a staged shared leader may revive within its reserved life
      unit.hp = Math.min(unit.hp, unit.s.maxHp);
      return;
    }
    unit.hp = 0; // NaN / negative writes from handlers
    this._remove(unit, 'killed', killer);
  }

  /**
   * Withdraw an ally without a kill (it may redeploy after its respawn time): an operator lies down where it stood and
   * comes back there (isDown, GitHub #60) — unless `permanent`, or the 突袭 retreat ('raid') that redeploys it at once.
   * `dying`: a forced exit that plays the operator's death animation — a knock-out put off by its own effect (史尔特尔's
   * 余烬, 骑士戒律 + 竞技旗); the `death` hook carries it (Touch's 超脱 counts such an exit: content/tokens.js).
   */
  retreat(unit, { reason = 'retreat', permanent = false, dying = false } = {}) {
    if (!unit || !unit.alive || unit.side !== 'ally') return;
    this._remove(unit, reason, null, permanent, dying);
  }

  _remove(unit, reason, killer = null, permanent = false, dying = false) {
    if(this._hooks.beforeUnitExit)this.emit('beforeUnitExit',{unit,reason,killer,permanent,dying});
    this._cutAttackStand(unit); // display metadata: death can precede the next AI update
    unit.alive = false;
    unit.removeReason = reason;
    unit.deployed = false;
    unit.deathAt = this.time;
    // while the removal bookkeeping runs, a skill onEnd handler must not redeploy the unit (it would come back
    // alive but without its tile in _occ, its buffs wiped and a respawn timer pending) — redeploy from `death` instead
    unit._removing = true;
    if (unit.skill && unit.skill.active) {
      this._safe(() => unit.skill.end('death'), 'skill.end', unit);
      unit.skill.active = false;
    }
    unit._removing = false;
    if (unit.side === 'ally') {
      this.releaseBlocked(unit);
      const k = unit.tileR * COLS + unit.tileC;
      if (this._occ[k] === unit) this._occ[k] = null;
      // keep persistent buffs only
      const kept = [];
      for (const b of unit.buffs) {
        if (b.persist) kept.push(b);
        else if (b.visible || b.status) this._ev(['status', unit.id, b.status ?? b.key, 0]);
      }
      unit.buffs = kept;
      unit.markDirty();
      if (unit.kind === 'op' && !permanent) {
        if (reason === 'killed') { const pp = this._pp(unit.ownerId); if (pp) pp.deaths++; }
        const mul = unit.persist.redeployMul * unit.s.redeployMul;
        unit.respawnAt = this.time + Math.max(0, unit.base.respawnTime * mul);
        if (this.isDown(unit)) this._layBody(unit); // before `die` / `death`: the body's tile is final for them
      } else {
        unit.removed = true;
      }
      if (unit.kind === 'device' && unit.obstacle) this.grid.setObstacle(unit.tileR, unit.tileC, false, unit.obstacleKind);
    } else {
      unit.removed = true;
      this._unblock(unit);
      this._enemiesDirty = true;
      if (reason === 'killed') {
        if (unit.counted) {
          this.killed++;
          const pp = this._pp(unit.ownerId);
          if (pp) pp.killed++;
        }
        /*
         * HUD 进度胶囊的分子:只数**本关自己排的**那些(`unit.inTotal`)。
         * 分裂孩子 / 召唤物 / 部位 / 变身副本在这里被击倒不算"已解决",所以它们不动胶囊进度。
         * ⚠ 上游 0.2.4 就有、fork 移植时漏了;官方测试基架的 checkInvariants 会校验。
         */
        if (unit.inTotal) {
          this.killedInTotal++;
          const pp = this._pp(unit.ownerId);
          if (pp) pp.killedInTotal++;
        }
        // 对抗投放：这只怪是某位攻方放过来的 —— 它的死记在那位攻方头上（settle 据此扣攻方队伍的共享池）
        if (unit.confrontSeat != null) tallySeat(unit.confrontSeat, this.confrontKills, this.confrontKillValue, unit.confrontPrice);
        if (killer) killer.stats.kills++;
        if (unit.bounty && unit.bounty.coins > 0) this.addCoins(this._bountyPayee(unit, killer), unit.bounty.coins);
      }
    }
    // the reason ('killed' | 'retreat' | 'expired' | …) lets the client keep the knock-down sound for real knock-outs
    if (reason !== 'leak') this._ev(['die', unit.id, reason]);
    if (this._hooks.death) this.emit('death', { unit, reason, killer, dying: !!dying });
    if (unit.removed) this._toRelease.push(unit);
  }

  /**
   * Drop hooks and periodic timers (`every`) owned by permanently removed units (killed/leaked enemies, expired
   * tokens, destroyed devices). Runs at the end of the step, so the unit's own death/leak handlers still fire;
   * one-shot `after` callbacks are kept (they run once and are gone). Without this, per-enemy content hooks pile up
   * and every emit walks the handlers of every enemy that ever spawned.
   */
  _releaseRemoved() {
    const set = new Set();
    for (const u of this._toRelease) if (u.removed && !u.alive) set.add(u);
    this._toRelease = [];
    if (!set.size) return;
    for (const name of Object.keys(this._hooks)) {
      const list = this._hooks[name];
      let w = 0;
      for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.owner != null && set.has(h.owner)) h.removed = true;
        else list[w++] = h;
      }
      list.length = w;
      if (!w) delete this._hooks[name];
    }
    for (const sc of this._sched) if (sc.interval > 0 && sc.owner != null && set.has(sc.owner)) sc.cancelled = true;
  }

  /**
   * Immediately redeploy a dead (or retreated) ally on its rest tile (restTile: where an operator that left the field
   * lies, else its home tile). opts:
   *   free=true   no DP cost (false: pays `base.cost`, refused when the player lacks the DP)
   *   tile=[r,c]  land on this in-rect tile instead (the home stays the board tile); refused (false) when the tile is
   *               outside the rect, a living unit stands there or another knocked-out operator lies there — no fallback
   *   keepSp      keep the SP / charges the unit had (保留技力): restored before the `deploy` hook fires
   * Returns true when the unit was deployed (full HP, `deploy {initial:false}` fires).
   */
  redeploy(unit, { free = true, tile = null, keepSp = false } = {}) {
    if (!unit || unit.side !== 'ally' || unit.alive || unit.removed) return false;
    let at = null;
    if (tile != null) {
      if (!Array.isArray(tile) || !Number.isInteger(tile[0]) || !Number.isInteger(tile[1]) || !this.grid.inRect(tile[0], tile[1])) return false;
      at = [tile[0], tile[1]];
    } else {
      const rest = this.restTile(unit);
      if (rest[0] !== unit.homeR || rest[1] !== unit.homeC) at = rest;
    }
    const k = at ? at[0] * COLS + at[1] : unit.homeR * COLS + unit.homeC;
    const occ = this._occ[k];
    if (occ && occ.alive && occ !== unit) return false;
    if (at && this.downOn(at[0], at[1], unit)) return false;
    const ps = this.getPlayer(unit.ownerId);
    const cost = unit.base.cost;
    let paid = 0;
    if (!free) {
      if (!ps || ps.dp + 1e-9 < cost) return false;
      paid = Math.min(ps.dp, cost);
      ps.dp = Math.max(0, ps.dp - cost); // paid before `deploy` fires (handlers see the new DP)
    }
    const sk = unit.skill;
    const keep = keepSp && sk && !sk.noSkill && sk.kind !== 'passive' ? { sp: sk.sp, charges: sk.charges } : null;
    if (this._deploy(unit, { initial: false, tile: at, keepSp: keep })) return true;
    if (paid > 0 && ps) ps.dp = Math.min(this.flags.dpMax, ps.dp + paid);
    return false;
  }

  /**
   * Automatic redeploys (DESIGN §5.5): an operator that left the field and whose timer is done comes back on its rest
   * tile — where it lies ("满足再部署条件时，移除场上的该倒地干员并自动部署至该位置", PRTS 卫戍协议/帮助) — when that tile
   * is free and its player has the DP.
   */
  _checkRedeploys() {
    // 战斗中实时部署 (flags.liveDeploy，方案 A): redeployment is the PLAYER's order (g.deploy → deployLive — tile and
    // timing are theirs), so the automatic home-tile redeploy never runs; a downed operator waits for its player.
    if (this.flags.liveDeploy === true) return;
    for (const u of this.allyUnits) {
      if (u.alive || u.removed || u.kind !== 'op') continue;
      if (this.time + 1e-9 < u.respawnAt) continue;
      // the DP first: an operator past its timer mostly waits for DP, and the tile checks scan every ally
      const ps = this.getPlayer(u.ownerId);
      const cost = u.base.cost;
      if (!ps || ps.dp + 1e-9 < cost) continue;
      const [r, c] = this.restTile(u);
      if (this._sealedDeployTiles?.has(r * COLS + c)) continue;
      const occ = this._occ[r * COLS + c];
      if (occ && occ.alive && occ !== u) continue;
      if (this.downOn(r, c, u)) continue;
      ps.dp = Math.max(0, ps.dp - cost);
      this._deploy(u, { initial: false, tile: r === u.homeR && c === u.homeC ? null : [r, c] });
    }
  }

  /** Leak: an enemy reached its goal. */
  leak(e) {
    if (!e || !e.alive || e.side !== 'enemy') return;
    if(this._hooks.beforeEnemyLeak){const ctx={enemy:e,cancelled:false};this.emit('beforeEnemyLeak',ctx);if(ctx.cancelled||!e.alive)return;}
    if(e.def.raw?.returnsToOwnField&&(this.kind==='unite'||e.mem.returningBoss?.state!=='flee')){e.moving=false;return;}
    if(e.isBoss&&e.mods?.contractBossLoop&&e.returnSpawn){this._unblock(e);e.x=e.spawnX;e.y=e.spawnY;this.restoreEnemyRoute(e,e.returnSpawn.route);e.atkStandUntil=-Infinity;this.fx('appear',{id:e.id,x:e.x,y:e.y});return;}
    if(e.def.raw?.returnsToOwnField)e.returnHpPct=Math.max(0,Math.min(1,e.hp/e.s.maxHp));
    this._recordLeak(e, false);
    this._remove(e, 'leak');
    this._ev(['leak', e.id]);
    if (this._hooks.enemyLeak) this.emit('enemyLeak', { enemy: e });
  }

  _recordLeak(e, timeout) {
    const owner = e.def.raw?.returnsToOwnField?e.ownerId:timeout ? e.ownerId : this._ownerForTile([Math.round(e.y), Math.round(e.x)]) ?? e.ownerId;
    const pp = this._pp(owner) ?? this._pp(e.ownerId);
    if (pp) {
      const entry = { enemyKey: e.defId, mods: carrySpyInvestigation(e.defId,e.mods,{spyInvestigation:e.mem.investigation??e.mods?.spyInvestigation??0,spyStrikeSpent:e.mem.spyStrikeSpent??e.mods?.spyStrikeSpent??false}), lpr: e.lpr ?? 1, sourcePlayerId: e.sourcePlayerId ?? e.ownerId, tag: e.tag ?? null, counted: !!e.counted || e.isBoss, boss: e.isBoss || undefined, spawned: true };
      if(e.def.raw?.returnsToOwnField){
        const key=e.sourcePlayerId||e.ownerId||'',used=(this._returningLpSpent||={})[key]||0;
        entry.lpr=Math.max(0,Math.min(e.lpr??3,10-used));e.lastLeakLpr=entry.lpr;this._returningLpSpent[key]=used+entry.lpr;
        entry.returningId=e.returningId;entry.returnHpPct=Number.isFinite(e.returnHpPct)?e.returnHpPct:Math.max(0,Math.min(1,e.hp/e.s.maxHp));
      }
      if(isHuntEntry(e)){entry.lpr=0;e.lastLeakLpr=0;}
      // born while a 联防 field ran (spawns.js): the leaker never sent it in, so it costs nobody LP and raises no ×N —
      // unite.js uniteSurvivors / spec.js uniteLeft filter it; every other reading keeps counting it as usual
      if (e.uniteRuntime) entry.uniteRuntime = true;
      // 对抗投放：这条漏怪是某位攻方放过来的 ⇒ settle 把它从「官方漏怪」那笔里排除（否则 counted 与 confrontLeaks
      // 各扣一次），改由投放怪那一笔按阶位阶梯价扣守方
      if (e.confrontSeat != null) entry.confrontSeat = e.confrontSeat;
      pp.leaked.push(entry);
      if (e.counted || e.isBoss) pp.perfect = false;
    }
    // 对抗投放：投放怪没被杀死而是漏过去了 —— 记在投放者席位上（settle 按阶梯价扣守方队伍的共享池）
    if (e.confrontSeat != null) tallySeat(e.confrontSeat, this.confrontLeaks, this.confrontLeakValue, e.confrontPrice);
    if (e.counted) this.leakedCount++;
    // of the stage's own list, so the capsule's numerator does not move for it. On a 联防 field it is no LP charge either:
    // such a leak carries `uniteRuntime` (spawns.js), and the 联防's billing reads that flag instead of this counter.
    if (e.inTotal) {
      this.leakedInTotal++;
      if (pp) pp.leakedInTotal++;
    }
  }

  /**
   * 战斗中实时部署 (flags.liveDeploy，方案 A): deploy one of the player's OWN board pieces — created at battle start but
   * held off the field (`flags.liveDeploy` skips the opening deployment in lifecycle.start) — on the tapped tile, paying
   * `base.cost` DP. A retreat refunds nothing and no penalty multiplier applies (方案 A: 撤退不退 DP、再部署按 base.cost 平价).
   *
   * Returns `{ ok: true, uid, dp }` or `{ ok: false, error }` — `error` is a stable reason the client shows:
   * 'finished' | 'mode' | 'player' | 'unknown' | 'deployed' | 'removed' | 'respawn' | 'tile' | 'occupied' | 'down' | 'dp'.
   * @param {string} playerId @param {number} uid @param {number[]|null} [tile] @returns {object}
   */
  deployLive(playerId, uid, tile = null) {
    if (this.finished) return { ok: false, error: 'finished' };
    if (this.flags.liveDeploy !== true) return { ok: false, error: 'mode' };
    const ps = this.getPlayer(playerId);
    if (!ps) return { ok: false, error: 'player' };
    const u = ps.units.find((x) => x.uid === uid && x.kind === 'op');
    if (!u) return { ok: false, error: 'unknown' };
    if (u.alive && u.deployed) return { ok: false, error: 'deployed' };
    if (u.removed) return { ok: false, error: 'removed' };
    // a never-deployed piece has respawnAt = Infinity (no window armed): only a FINITE window gates
    const armed = Number.isFinite(u.respawnAt) ? u.respawnAt : -Infinity;
    if (this.time + 1e-9 < armed) return { ok: false, error: 'respawn' };
    // `tile` = the field tile the player tapped (stage coordinates); absent = the piece's own board tile (its home,
    // the tile the spec deployment would have used). A landing tile does not move the home: a later redeploy still
    // returns to the board tile.
    const at = Array.isArray(tile) && Number.isInteger(tile[0]) && Number.isInteger(tile[1]) ? [tile[0], tile[1]] : [u.homeR, u.homeC];
    if (!this.grid.inRect(at[0], at[1])) return { ok: false, error: 'tile' };
    if (this._sealedDeployTiles?.has(at[0] * COLS + at[1])) return { ok: false, error: 'tile' }; // _deploy would refuse it
    if (!this.grid.canStand(at[0], at[1], { ranged: deployPosClass(u) !== 'melee' })) return { ok: false, error: 'tile' };
    const occ = this._occ[at[0] * COLS + at[1]];
    if (occ && occ.alive && occ !== u) return { ok: false, error: 'occupied' };
    if (this.downOn(at[0], at[1], u)) return { ok: false, error: 'down' };
    // redeploy carries the whole DP path (check, pay before the deploy hook, refund when the deploy refuses)
    if (!this.redeploy(u, { free: false, tile: at })) return { ok: false, error: 'dp' };
    return { ok: true, uid: u.uid, dp: ps.dp };
  }

  /**
   * 战斗中实时部署 (flags.liveDeploy，方案 A): withdraw a standing operator. `retreat` removes it and arms the redeploy
   * timer (`base.respawnTime` — _remove); no DP is refunded (a retreat costs the deployment, the operator comes back
   * after the cooldown), and `_checkRedeploys` stays out of the way: the player chooses when and where to bring it back.
   * @param {string} playerId @param {number} uid @returns {{ ok: boolean, uid?: number, error?: string }}
   */
  retreatLive(playerId, uid) {
    if (this.finished) return { ok: false, error: 'finished' };
    if (this.flags.liveDeploy !== true) return { ok: false, error: 'mode' };
    const ps = this.getPlayer(playerId);
    if (!ps) return { ok: false, error: 'player' };
    const u = ps.units.find((x) => x.uid === uid && x.kind === 'op');
    if (!u) return { ok: false, error: 'unknown' };
    if (!u.alive || !u.deployed) return { ok: false, error: 'notdeployed' };
    this.retreat(u);
    return { ok: true, uid: u.uid };
  }

  /**
   * 方案 A 的一致性：重放玩家指令。`cmds` (spec.cmds) is an ascending list of `[tick, playerId, type, uid, row?, col?]`
   * — one entry per accepted g.deploy / g.retreat — replayed at its tick so a takeover re-simulation (or a display
   * replica built later) reproduces the deployments the player made in their browser. Only a battle created from a spec
   * that carried `cmds` has `_cmds`; every other battle skips this phase entirely (lifecycle.step).
   * @private
   */
  _applyCmds() {
    const list = this._cmds;
    const now = this.tickCount;
    for (let guard = 0; this._cmdI < list.length && guard < 256; guard++) {
      const c = list[this._cmdI];
      if (!Array.isArray(c) || !(Number(c[0]) <= now)) break;
      this._cmdI++;
      try {
        if (c[2] === 'retreat') this.retreatLive(c[1], c[3]);
        else this.deployLive(c[1], c[3], Number.isInteger(c[4]) && Number.isInteger(c[5]) ? [c[4], c[5]] : null);
      } catch (e) {
        this._internalError?.('cmds', e);
      }
    }
  }
}
