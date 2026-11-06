// server/match/match/combat.js — Match methods: the battles of a normal round — Battle construction (newBattle, the
// spawn list sanitised, a player's normal field after the onBattleStart handlers), the COMBAT phase in both modes
// (server-run streaming, client-side combat), the per-field results and the sim-error log, then 联防 or SETTLE.
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { TICK } from '../../sim/constants.js';
import { withBounties } from '../waves.js';
import { planUnite } from '../unite.js';
import { FieldRunner, DeadBattle } from '../fields.js';
import { OK, fail, DELAYS } from './common.js';
import { previewPlayer } from '../preview.js';
import { morphBattleOpt } from '../../../shared/plugins/rules.js';

export class MatchCombat {
  /**
   * 危机合约 (shared/contractEffects.js) as the Battle options server/sim/Battle.js reads: `contractOpStatMul`,
   * `contractHealMul`, `contractLayerCap` (copied onto the battle's data view — players.js / damage.js /
   * economy.js read them from there). Only non-neutral keys go out: a room without contracts (or with contracts that
   * touch none of the three) passes exactly the options it always passed, and Battle grows no data key.
   */
  _contractOpts() {
    const fx = this.fx;
    if (!fx) return {};
    const op = fx.opStatMul;
    return {
      ...(op && (op.atk !== 1 || op.def !== 1 || op.hp !== 1) ? { contractOpStatMul: { ...op } } : {}),
      ...(fx.healMul !== 1 ? { contractHealMul: fx.healMul } : {}),
      ...(fx.bondLayerCap != null ? { contractLayerCap: { cap: fx.bondLayerCap } } : {}),
    };
  }

  /** Construct a battle; a constructor failure yields a finished stand-in (clean result) and is logged. */
  newBattle(opts, { preview = false } = {}) {
    const full = { data: this.ds, content: this.battleContent, logger: this.log, ...opts, ...this._contractOpts(), ...morphBattleOpt(this.rules),
      ...(preview ? { logger: {}, quiet: true } : {}) };
    try {
      return new this.BattleClass(full);
    } catch (e) {
      if (!preview) this.reportError(`battle ${opts.fieldId} construct`, e);
      return new DeadBattle(full, 'forced');
    }
  }

  /**
   * Spawn list of a field after the onBattleStart handlers (which may edit `ev.spawns`): malformed entries are dropped
   * and a kill bounty is copied into `mods.bountyCoins`, so a leaked bounty enemy keeps paying its killer in 联防.
   */
  /**
   * 本场战斗的 DP flags：在 `gd.dp` 之上叠加熔毁商店的「部署回复」代价（debt.deploy）。
   * sim 每帧用 flags.dpPerSec 回复 DP（sim/battle/lifecycle.js:81），所以压这里即可。
   * @returns {{ dpInit:number, dpPerSec:number, dpMax:number }}
   */
  dpFlags() {
    const base = this.gd.dp;
    if (typeof this.meltDeployMul !== 'function') return base;
    try {
      const mul = this.meltDeployMul();
      if (!(mul < 1)) return base;
      return { ...base, dpPerSec: Math.max(0, Number(base.dpPerSec) * mul) };
    } catch (e) { this.reportError('melt deploy', e); return base; }
  }

  _sanitizeSpawns(list, ownerPlayerId = null) {
    const out = [];
    for (const s of Array.isArray(list) ? list : []) {
      if (!s || typeof s !== 'object' || typeof s.enemyKey !== 'string' || !this.gd.enemy(s.enemyKey)) continue;
      const spec = { ...s, mods: s.mods && typeof s.mods === 'object' ? { ...s.mods } : {} };
      // 藏品对敌人的修正（防御/受击衰减/精英限时减伤/异常时长）：交给 spec.enemyMods，引擎在生成敌人时施加
      if (typeof this.relicEnemyMods === 'function') {
        try { const em = this.relicEnemyMods(); if (em) spec.enemyMods = em; } catch { /* 尽力而为 */ }
      }
      // 熔毁商店的代价（业主 2026-10-26 接线）：allStats/growth → 全属性；dmg → 等效血量。
      // 复审计 2026-10-27：只在**还没贴过**时才乘 —— 普通场的 mods 会随漏怪带进联防、再随接力带进下一段，
      // 每次 _sanitizeSpawns 都乘一遍会让联防 ×2、接力 ×3（与「漏怪保持同属性」的设计冲突）。
      // 藏品（业主 2026-10-27）：只接「敌方 hp/atk」这一档（引擎有 hpMul/atkMul 通道）；幂等标记防联防/接力重复乘。
      if (typeof this.relicEnemyMul === 'function' && !spec.mods.relicApplied) {
        try {
          const rm = this.relicEnemyMul();
          if (rm && (rm.hp || rm.atk || rm.speed)) {
            spec.mods.hpMul = (Number(spec.mods.hpMul) || 1) * (1 + Number(rm.hp || 0));
            spec.mods.atkMul = (Number(spec.mods.atkMul) || 1) * (1 + Number(rm.atk || 0));
            if (rm.speed) spec.mods.speedMul = (Number(spec.mods.speedMul) || 1) * (1 + Number(rm.speed || 0));
            spec.mods.relicApplied = true;
          }
        } catch (e) { this.reportError('relic mods', e); }
      }
      if (typeof this.meltMul === 'function' && typeof this.meltHpMul === 'function' && !spec.mods.meltApplied) {
        try {
          const gm = this.meltMul();
          const hm = this.meltHpMul();
          if (gm !== 1 || hm !== 1) {
            const mul = (k, f) => { const v = Number(spec.mods[k]); return (Number.isFinite(v) && v > 0 ? v : 1) * f; };
            spec.mods.hpMul = mul('hpMul', gm * hm);
            spec.mods.atkMul = mul('atkMul', gm);
            spec.mods.speedMul = mul('speedMul', gm);
            // allStats = 「全属性」：sim 也消费 defMul / resMul（sim/battle/spawns.js:114,119），一并乘上
            spec.mods.defMul = mul('defMul', gm);
            spec.mods.resMul = mul('resMul', gm);
          }
          spec.mods.meltApplied = true;
        } catch (e) { this.reportError('melt wiring', e); }
      }
      if (ownerPlayerId && spec.ownerPlayerId == null) spec.ownerPlayerId = ownerPlayerId;
      const coins = spec.bounty && typeof spec.bounty === 'object' ? Math.trunc(Number(spec.bounty.coins) || 0) : 0;
      if (coins > 0 && spec.mods.bountyId == null && spec.mods.bountyCoins == null) spec.mods.bountyCoins = coins;
      out.push(spec);
    }
    return out;
  }

  _normalBattle(ps) { return this.newBattle(this._normalOpts(ps)); }

  /**
   * 本场战斗的模拟场地 rect（Battle 寻路 / 部署的边界）。
   *
   * 肉鸽（mode_rogue_*）：官方图就是棋盘，用该图 `rogueFrame` 的**完整边界**（clamp 到 19×21）——
   * rows 9–12 的窗口只覆盖官方图的一部分，路线端点会被吸附、传送 steps 失效（2026-11-03 审计）。
   * 其它模式（含非肉鸽的 `randomStage` / `isXie` / boss 回合）逐字保持 `GEO.NORMAL_RECT`。
   * @returns {{r0:number,r1:number,c0:number,c1:number}}
   */
  _fieldRect() {
    if (this.isRogue === true) {
      const frame = this.gd && typeof this.gd.stage === 'function' ? this.gd.stage(this.stageId)?.rogueFrame : null;
      if (frame && Number.isFinite(Number(frame.row)) && Number.isFinite(Number(frame.col))) {
        const clampI = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.trunc(v)));
        const r0 = clampI(Number(frame.row), 0, GEO.ROWS - 1);
        const c0 = clampI(Number(frame.col), 0, GEO.COLS - 1);
        const h = Math.max(1, Math.trunc(Number(frame.h)) || 1);
        const w = Math.max(1, Math.trunc(Number(frame.w)) || 1);
        return { r0, r1: clampI(r0 + h - 1, r0, GEO.ROWS - 1), c0, c1: clampI(c0 + w - 1, c0, GEO.COLS - 1) };
      }
    }
    return { ...GEO.NORMAL_RECT };
  }

  /** Battle options of a player's normal field (after the onBattleStart handlers). */
  _normalOpts(ps, { preview = false, board = ps.board } = {}) {
    const wave = preview ? structuredClone(this.wave) : this.wave;
    if (preview) ps = previewPlayer(ps, board);
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    // the client's list: bounty units inserted among their host action's own units, which are re-timed around them
    let spawns = withBounties(this.gd, this.round, wave, ps.bounties, ps.playerId).map((s) => ({ ...s, ownerPlayerId: ps.playerId }));
    // 2V2 事件期: the monster card + the 强力属性 subset apply to the round's NORMAL wave only (not the 狩猎期
    // placements, whose bounty stays untouched). Applied after withBounties so the host-action re-timing is untouched.
    spawns = this.foeWaveSpawns(spawns);
    // 赏金档倍速（业主 2026-10-31）：只放大官方波次，且只在对战·赏金档生效；控怪档恒 1（那边是固定 1.5× 口径）。
    if (typeof this.applyVersusSpeed === 'function') spawns = this.applyVersusSpeed(spawns);
    // rule 藏品：spawnHpChance（无度）「每个敌人有 p 概率生命 +extra」——逐 spawn 掷一次（用波次 rng，可复现）
    if (typeof this.relicRuleParams === 'function' && Array.isArray(spawns)) {
      const rolls = this.relicRuleParams('spawnHpChance');
      if (rolls.length) {
        const rng = this.rngWaves && typeof this.rngWaves === 'function' ? this.rngWaves : null;
        for (const ru of rolls) {
          const p = Math.max(0, Math.min(1, Number(ru.p) || 0));
          const extra = Math.max(0, Number(ru.extra) || 0);
          if (!(p > 0) || !(extra > 0)) continue;
          spawns = spawns.map((sp) => {
            const roll = rng ? rng() : Math.random();
            return roll < p ? { ...sp, mods: { ...(sp.mods || {}), hpMul: (Number((sp.mods || {}).hpMul) || 1) * (1 + extra) } } : sp;
          });
        }
      }
    }
    // rule 藏品：`enemyCount.mul` 是**百分比增量**（desc：不赦「敌人数量 +50%」），按 spawn 的 count 等比放大
    if (typeof this.relicRuleParams === 'function' && Array.isArray(spawns)) {
      const cnt = this.relicRuleParams('enemyCount');
      const add = cnt.reduce((n, r) => n + (Number(r.mul) || 0), 0);
      if (add > 0) spawns = spawns.map((s) => ({ ...s, count: Math.max(1, Math.min(50, Math.round((Number(s.count) || 1) * (1 + add)))) }));
    }
    // 2V2 对抗期: every intervention aimed at this player replaces a share of this wave (confront.js; one per attacker).
    // 移植时漏了这一段 ⇒ 玩家派出的怪只记在 subs 里、从不进对手波次（「操控怪物」完全不生效）。
    // A preview (the bot rehearsal) must not move the match's rngConfront — applyConfront shuffles with it, and the real
    // battle draws it after the rehearsal — so the preview draws from a clone.
    const savedConfront = preview ? this.rngConfront : null;
    if (preview && savedConfront && typeof savedConfront.clone === 'function') this.rngConfront = savedConfront.clone();
    try {
      const subs = typeof this.confrontFor === 'function' ? this.confrontFor(ps) : [];
      for (const sub of subs || []) spawns = this.applyConfront(spawns, sub, ps);
    } finally {
      if (savedConfront) this.rngConfront = savedConfront;
    }
    // 同盟狩猎: the system's prey is INSERTED after the event card / 强力属性, so its bounty stays the plan's own value
    if (this.coopHuntActive()) spawns = this.applyCoopHunt(spawns, ps);
    const ev = { input, kind: 'normal', round: this.round, spawns, ...(preview ? { preview: true } : {}) };
    // Preview construction failures go to the rehearsal's discard path, never Match.dispatch's live error sink.
    if (preview) this.dispatcher.dispatch(ps, 'onBattleStart', ev);
    else this.dispatch(ps, 'onBattleStart', ev);
    return {
      seed: deriveSeed(this.seed, `n:${this.round}:${ps.seat}`),
      kind: 'normal',
      modeId: this.modeId,
      round: this.round,
      stageId: this.stageId,
      rect: this._fieldRect(),
      timeLimit: wave.timeLimit,
      players: [ev.input && typeof ev.input === 'object' ? ev.input : input],
      spawns: this._sanitizeSpawns(Array.isArray(ev.spawns) ? ev.spawns : spawns, ps.playerId),
      routes: wave.routes,
      sharedBoss: null,
      // 战斗中实时部署 (方案 A, flags.liveDeploy): the opening deployment is skipped and the player places their board
      // during COMBAT (g.deploy → liveDeploy). The match enables it explicitly (Match.liveDeployOn: SP_LIVE_DEPLOY=0 or
      // opts.liveDeploy — on by default, so a room keeps today's outcome only with SP_LIVE_DEPLOY=0), it needs
      // client-side combat, and only a HUMAN seat gets the flag: an AI seat's field is simulated by the server and would
      // open with no operator on the field at all, while a preview (bot rehearsal / g.unitStats) must still measure the
      // board as deployed. A 联防 / boss / versus field never comes through here, so those keep the opening deployment
      // untouched.
      flags: { layerGainsEnabled: true, ...this.dpFlags(), ...(this.liveDeployOn && !preview && ps && !ps.isBot ? { liveDeploy: true } : null) },
      fieldId: `n:${ps.playerId}`,
      enemyOverrides: wave.overrides,
      waveId: wave.templateId,
      // 危机合约 (shared/contractEffects.js): the room-wide battle modifiers — this object is also what the
      // client-side field's BattleSpec is built from (clientCombat._ccField), so the browser sim reads them too
      ...this._contractOpts(),
    };
  }

  startCombat() {
    if (this.clientCombat) { this._startCombatClient(); return; }
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    // 攻防回合：只有守方有战场；攻方本回合只投放，观战。
    const fighters = this.isRoleRound() ? alive.filter((ps) => this.isDefender(ps)) : alive;
    this.lastResults = new Map();
    this.fields = fighters.map((ps) => ({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], battle: this._normalBattle(ps), live: true }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._defaultWatch();
    this.markPublic();
    this.runner = new FieldRunner(this, this.fields, { onDone: (runner) => this.combatDone(runner) });
    this.runner.start();
  }

  _startCombatClient() {
    this.phase = PHASE.COMBAT;
    const alive = this.alivePlayers();
    const fighters = this.isRoleRound() ? alive.filter((ps) => this.isDefender(ps)) : alive;
    this.lastResults = new Map();
    this.watchers.clear();
    const fields = fighters.map((ps) => this._ccField({ fieldId: `n:${ps.playerId}`, kind: 'normal', players: [ps.playerId], opts: this._normalOpts(ps) }));
    const limit = this.wave ? this.wave.timeLimit : 60;
    this.deadline = this.sched.instant ? 0 : this.sched.now() + Math.round((limit / this.gameSpeed) * 1000);
    this._launch(fields);
    // every fighting human runs its own field; eliminated humans (and spectator seats) keep watching (research 09 §3.1
    // "Keep-watching auto-observes the first available field", switching freely with 前往查看): a replica of the field
    // of the player they follow — the one they last watched, else the first player still in (item 56) — else the first
    for (const f of fields) for (const pid of f.players) {
      const ps = this.players.get(pid);
      if (!ps || ps.isBot || ps.left) continue;
      this.watchers.set(pid, f.fieldId);
      this._sendStart(pid, f);
    }
    const first = fields.find((f) => f.mode === 'client') || fields[0] || null;
    if (first) {
      for (const ps of this._viewers()) {
        // 攻方本回合没有自己的 field（alive 但 fieldOf 为空）——也要给他们 b.start watch，看守方作战
        if (this.fieldOf(ps) || this.watchers.has(ps.playerId)) continue;
        const f = this._watchTargetField(ps, fields) || first;
        this.watchers.set(ps.playerId, f.fieldId);
        this._sendStart(ps.playerId, f, { watch: true });
      }
    }
    this.markPublic();
  }

  /** Aggregate a finished field's content/engine errors (battle.errors: unique records) for diagnostics. */
  _collectSimErrors(f, res) {
    this.simErrors += Number(res && res.errors) || 0;
    const list = f && f.battle && Array.isArray(f.battle.errors) ? f.battle.errors : [];
    for (const e of list) {
      if (!e || typeof e !== 'object') continue;
      const key = `${e.label}|${e.who || ''}|${e.message}`;
      let rec = this.simErrorLog.get(key);
      if (!rec) {
        if (this.simErrorLog.size >= 500) continue;
        rec = { label: String(e.label), who: String(e.who || ''), message: String(e.message), stack: e.stack ? String(e.stack) : null, battles: 0, count: 0 };
        this.simErrorLog.set(key, rec);
      }
      rec.battles++;
      rec.count++;
    }
  }

  combatDone(runner) { this._finishCombat((f) => runner.resultOf(f)); }

  /** Every normal field has its result: record them, then 联防 or SETTLE. */
  _finishCombat(resultOf) {
    if (this.phase !== PHASE.COMBAT) return;
    this._stopClientCombat();
    for (const f of this.fields) {
      const res = resultOf(f);
      this._collectSimErrors(f, res);
      for (const pid of f.players) {
        const pp = res.perPlayer && res.perPlayer[pid];
        this.lastResults.set(pid, pp || { killed: 0, total: 0, leaked: [], perfect: true, layerGains: {}, coins: 0, damageDealt: 0, unitsEnd: [], unitStats: [] });
        // the views show the layers the battle reached until settle() makes them persistent (DESIGN §20.15)
        const ps = this.players.get(pid);
        const gains = pp && pp.layerGains && typeof pp.layerGains === 'object' ? pp.layerGains : null;
        if (ps && gains && Object.keys(gains).length) { ps.pendingLayerGains = { ...gains }; ps.dirty(); }
      }
    }
    for (const f of this.fields) f.live = false;
    this.deadline = 0;
    this.markPublic();
    this.later(this.scaled(DELAYS.COMBAT_END), () => this._afterCombat());
  }

  /**
   * After the COMBAT_END pause: 联防 or SETTLE. The plan is made now, from the players still in — a player who quit
   * during the last field or the pause (中途退出 = eliminated, board cleared) is neither a helper nor a leaker whose
   * enemies re-enter.
   */
  _afterCombat() {
    if (this.phase !== PHASE.COMBAT) return;
    const plan = planUnite(this, this.lastResults);
    if (plan) this.startUnite(plan);
    else this.settle(null, null);
  }

  // ---- 战斗中实时部署 (方案 A) ------------------------------------------------------------------------------------
  // g.deploy / g.retreat (intents.js): the player places / withdraws one of their OWN board operators while COMBAT
  // runs. The rules are the engine's (server/sim/battle/deploy.js deployLive / retreatLive): a retreat refunds no DP,
  // a redeploy costs `base.cost` with no penalty multiplier. A client-authoritative field (the default) has NO Battle
  // on the server — the browser is the authority and applies the order itself — so the server only validates the seat
  // and the uid, records the order in `spec.cmds` (a takeover re-simulation replays it) and answers m.deploy; a field
  // the server took over runs its own Battle, which answers with the real DP / geometry verdict.
  // Watch replicas and teammate bots are not chased (方案 A): a bot's board is never held (no liveDeploy flag), and a
  // watcher's replica simply replays the recorded cmds from t = 0.

  /** 战斗中实时部署: g.deploy — one of the player's own operators onto the tapped tile (or its board tile). */
  liveDeploy(ps, { uid, row, col } = {}) {
    return this._liveDeployOrder(ps, { uid, row, col }, 'deploy');
  }

  /** 战斗中实时部署: g.retreat — withdraw a standing operator (its redeploy timer arms; no DP refund). */
  liveRetreat(ps, { uid } = {}) {
    return this._liveDeployOrder(ps, { uid }, 'retreat');
  }

  /** The shared gate of liveDeploy / liveRetreat; see the block comment above for the two paths. */
  _liveDeployOrder(ps, { uid, row, col } = {}, action) {
    if (this.phase !== PHASE.COMBAT) return fail(ERR.WRONG_PHASE, 'live deploy runs in combat');
    if (!ps || ps.spectator || !ps.alive) return fail(ERR.ELIMINATED);
    if (!Number.isSafeInteger(uid) || uid <= 0) return fail(ERR.BAD_TARGET, 'which unit');
    const f = this._liveDeployField(ps);
    if (!f) return fail(ERR.WRONG_PHASE, 'live deploy is a client-side normal field');
    // 归属: the piece must be one of THIS player's own board operators — a foreign uid never reaches an engine
    if (!this._liveOwnsUid(f, ps.playerId, uid)) return fail(ERR.BAD_TARGET, 'not your operator');
    const tile = Number.isInteger(row) && Number.isInteger(col) ? [row, col] : null;
    const b = f.mode === 'server' && f.battle ? f.battle : null;
    if (b && typeof b.deployLive === 'function') {
      const out = action === 'retreat' ? b.retreatLive(ps.playerId, uid) : b.deployLive(ps.playerId, uid, tile);
      this._sendDeployReply(ps.playerId, action, out);
      if (out.ok) this.markPublic();
      return OK;
    }
    // the browser is the authority and has already applied this order to its own Battle: record it for a takeover
    this._liveCmdRecord(f, ps.playerId, action, uid, tile);
    this._sendDeployReply(ps.playerId, action, { ok: true, uid });
    return OK;
  }

  _sendDeployReply(playerId, action, out) {
    const ok = !!(out && out.ok);
    const base = { t: 'm.deploy', ok, ...(ok ? { uid: out.uid } : { error: (out && out.error) || 'unknown' }) };
    if (ok && action === 'retreat') base.retreat = true;
    else if (ok && Number.isFinite(out.dp)) base.dp = out.dp;
    this.sendTo(playerId, base);
  }

  /**
   * The field a live deployment may touch: the player's own normal field, and only when its spec runs in live-deploy
   * mode (the flag server/match/match/combat.js _normalOpts injects for a human client-authoritative field). Null under
   * a non-COMBAT state, a spectator / eliminated seat, an observer of someone else's field, or any other field kind.
   */
  _liveDeployField(ps) {
    if (!ps || ps.spectator || !ps.alive) return null;
    const list = Array.isArray(this.fields) ? this.fields : [];
    return list.find((f) => f && !f.done && f.spec && f.spec.flags && f.spec.flags.liveDeploy === true
      && Array.isArray(f.players) && f.players.includes(ps.playerId)) || null;
  }

  /** Whether `uid` is one of `playerId`'s own operators in the field's spec (a board chess, not a summon). */
  _liveOwnsUid(f, playerId, uid) {
    const list = f && f.spec && Array.isArray(f.spec.players) ? f.spec.players : [];
    const p = list.find((x) => x && x.playerId === playerId);
    if (!p || !Array.isArray(p.units)) return false;
    return p.units.some((u) => u && u.uid === uid && (u.kind === 'chess' || u.kind === 'op'));
  }

  /**
   * Record one player order in the field's `spec.cmds` — `[tick, playerId, 'deploy' | 'retreat', uid, row?, col?]`,
   * ascending by tick — which a takeover re-simulation replays at that tick (server/sim/battle/deploy.js _applyCmds).
   * `tick` is the field clock's tick: the browser's local battle is paced by the same clock (b.start `elapsed`), so a
   * takeover reproduces the player's timing within one tick. Bounded (max 512 entries): a spec is sent to every watcher,
   * and a battle does not hold more orders than that.
   */
  _liveCmdRecord(f, playerId, action, uid, tile) {
    if (!f || !f.spec) return 0;
    if (!Array.isArray(f.spec.cmds)) f.spec.cmds = [];
    const tick = Math.max(0, Math.round((Number(this._fieldElapsed(f)) || 0) / TICK));
    if (f.spec.cmds.length >= 512) return tick;
    f.spec.cmds.push(action === 'retreat' ? [tick, playerId, 'retreat', uid] : [tick, playerId, 'deploy', uid, ...(tile || [])]);
    return tick;
  }
}
