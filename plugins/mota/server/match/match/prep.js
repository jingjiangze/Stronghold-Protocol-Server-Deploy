import { recordPrepLineups } from '../../lineupLibrary.js';
// server/match/match/prep.js — Match methods: the PREP phase — its start (deferred item merges, onPrepStart), the AI
// seats' sliced preps (scheduleBotPrep: economy + layout, rehearsal, Ready), Ready and the deadline, and its end
// (onPrepEnd, PlayerState.endPrep, then COMBAT or the Final Assault / Hidden Core).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE } from '../../../shared/constants.js';
import { botPrepBeginSteps, botPrepEndSteps } from '../bot.js';
import { testSlice } from '../testTrace.js';
import { DELAYS } from './common.js';

export class MatchPrep {
  /** 本回合参加休整的玩家：攻防回合只有守方（攻方只投放）；普通回合全体存活玩家。 */
  prepPlayers() {
    if (typeof this.isRoleRound !== 'function' || !this.isRoleRound()) return this.alivePlayers();
    return this.defenders();
  }

  enterPrep() {
    this.phase = PHASE.PREP;
    this.sp = null;
    const prep = this.prepPlayers();
    for (const ps of prep) {
      ps.ready = false;
      // Items gained as the previous prep ended waited unmerged (acquireItem deferMerge). Merge them now, before
      // this prep's onPrepStart grants and before the player acts — not in endPrep, which runs in the same prep
      // that granted them and would take an equipped copy off for the fight about to start.
      ps.checkItemMerges();
      ps.recompute();
      this.dispatch(ps, 'onPrepStart', { round: this.round });
      ps.recompute();
    }
    // 攻方本回合没有战场：不进入休整，只做待合并装备的清理并直接 Ready，等待守方开打。
    for (const ps of this.alivePlayers()) {
      if (prep.includes(ps)) continue;
      try { ps.checkItemMerges(); } catch { /* ignore */ }
      ps.recompute();
      ps.ready = true;
      ps.dirty();
    }
    // 只有一个真人的房（独立模拟 / 单人肉鸽 / 「1 真人 + N AI」）没有休整倒计时：没有第二个玩家会来按准备，
    // 倒计时只是逼自己 —— 与 `soloUntimed` 同一条规则（docs/PS100-MIGRATION.md §5，user playtest #4 item 3）。
    // AI 席位会立刻 Ready，所以不计时也不会把 `maybeEndPrep` 卡住。
    //
    // 其余房间仍由数据决定：本回合声明了 `prepTime` 就用它；声明为 null 就是不计时（config 是权威 ——
    // `verification-slices.test.js` 的零延迟顺序依赖这一点）。`infoCheck` 25 s 兜底只给 `prepFallbackGuard`
    // （没有单人豁免的多真人房），且从不给一个数据里本就不计时的回合加表。
    this.setDeadline(this.prepDeadlineSeconds(), () => this.prepDeadline());
    let i = 0;
    for (const ps of prep) if (ps.botControlled) this.scheduleBotPrep(ps, i++);
    this.markPublic();
    this.maybeEndPrep();
  }

  /**
   * Seconds of this round's prep deadline (null = untimed). The SINGLE definition of the rule, so the prep and the
   * `attachAudit` check can never drift apart:
   *
   *   * solo, and any room with only ONE human seat (loneHuman: 独立模拟 or a 同盟 / 肉鸽 room started alone or with
   *     AI teammates only) → null: nobody waits on anybody, and a lone human's silence cannot stall anything — the
   *     AI seats press Ready at once. Same rule as `soloUntimed` (docs/PS100-MIGRATION.md §5, user playtest #4 item 3);
   *   * the round declares a `prepTime` → that value (today's behaviour, unchanged);
   *   * the round declares none, but this is the lone-human co-op room (`prepFallbackGuard`) → the official
   *     `timers.infoCheck` guard, so that human's silence can never stall the match;
   *   * otherwise → null: the data left this round untimed and it stays untimed.
   *
   * @returns {number|null}
   */
  prepDeadlineSeconds() {
    // 独立模拟与「只有一个真人」的房（含单人肉鸽）都不计时 —— 没有第二个玩家会来按准备，倒计时只是逼自己。
    if (this.isSolo || this.loneHuman === true) return null;
    const declared = this.gd.prepTime(this.round);
    if (declared != null) return declared;
    return this.prepFallbackGuard ? this.gd.timer('infoCheck') : null;
  }

  /**
   * The bot plays a prep in three stages, every one in slices of ≤ botSliceMs wall-clock ms (one scheduler callback
   * each, so other rooms' battles and every player's requests keep flowing): economy + the default layout
   * (bot.js botPrepBeginSteps — shop decisions and layout planning, 50–120 ms late in a 4-bot match), the layout
   * rehearsal (whole simulated battles, 0.2–1 s of CPU per bot late in a match), then botPrepEndSteps (the rehearsed
   * layout, temp, Ready). The step generators run the same actions in the same order as the one-shot routine (same
   * rng draws, same decisions); in virtual time (botSliceMs unbounded) each stage runs at once. The prep ending first
   * (deadline) or a newer schedule for the seat drops the job (a step never leaves a transient board behind).
   * A rehearsal offered to the host's browser (botRehearsalDelegate, DESIGN §14 — AI teammates only) is not stepped
   * here: the job stays `pending` until MatchRehearsal accepts the host's pick (`done`, the layout ready to apply) or
   * takes it over, and only a takeover runs `job.run` — the server's slices, never a second simulation of what the host
   * already ran; a pick accepted before this driver subscribed to the job is applied just the same (`job.done`). Either
   * outcome is applied once the generator that offered the task has finished — it still places the default layout after
   * the delegation — which is why the continuation is installed here and not with the frame.
   */
  scheduleBotPrep(ps, i = 0) {
    const round = this.round;
    const token = (ps._botPrepToken = (ps._botPrepToken || 0) + 1);
    const valid = () => this.phase === PHASE.PREP && this.round === round && ps.alive && !ps.ready && ps.botControlled && ps._botPrepToken === token;
    const bounded = Number.isFinite(this.botSliceMs);
    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
    // Test replay ignores the wall clock and stops after the journalled step count (testSlice).
    const sliceCtl = testSlice(this);
    /** Step a generator until done or the slice budget is used; `then(value)` once it is done (null on an error). */
    const drive = (gen, label, then) => {
      const t0 = now();
      let r = null;
      try {
        do {
          r = gen.next();
          if (sliceCtl) sliceCtl.note(1);
        } while (!r.done && !(sliceCtl ? sliceCtl.wall(now() - t0, this.botSliceMs) : (bounded && now() - t0 >= this.botSliceMs))); // loop-cap: generator and the bot time slice
      } catch (e) {
        this.reportError(`bot ${ps.playerId}${label}`, e);
        then(null);
        return;
      }
      if (r.done) { then(r.value); return; }
      this.later(0, () => { if (valid()) drive(gen, label, then); });
    };
    const ready = () => {
      if (!ps.ready) {
        this.autoPickPersonalChoice(ps, 'random');
        ps.resolveTemp();
        ps.setReady(true);
      }
    };
    const end = (job) => {
      let gen = null;
      try { gen = botPrepEndSteps(this, ps, job); } catch (e) { this.reportError(`bot ${ps.playerId}`, e); }
      if (!gen) { ready(); return; }
      drive(gen, '', ready);
    };
    /** The layout the finished job chose is applied in a callback of its own (bounded slices end one stage per call). */
    const finish = (job) => {
      if (bounded) this.later(0, () => { if (valid()) end(job); });
      else end(job);
    };
    /** The rehearsal's slices, once the job simulates locally (nobody answered, or the server took it over). */
    const runJob = (job) => {
      const slice = () => {
        if (!valid()) return;
        let done = true;
        try { done = job.run(this.botSliceMs, sliceCtl); } catch (e) { this.reportError(`bot ${ps.playerId} rehearsal`, e); }
        if (done) finish(job);
        else this.later(0, slice);
      };
      // bounded slices start in a callback of their own (the economy + default layout above already used this one)
      if (bounded) this.later(0, slice);
      else slice();
    };
    this.later(this.scaled(DELAYS.BOT_ACTION + i * DELAYS.BOT_STAGGER), () => {
      if (!valid()) return;
      drive(botPrepBeginSteps(this, ps, { delegate: this.botRehearsalDelegate }), '', (job) => {
        if (!job) { end(null); return; }
        // A job is finished when it has nothing left to simulate: the server's own run over the candidates, or — with a
        // delegated one — the host's pick, which MatchRehearsal accepts as soon as it arrives, possibly while the
        // generator above was still placing the default layout (its `done` is already true here). Either way the layout
        // is ready: it is applied, never simulated again, and a later local run cannot overwrite the accepted pick.
        if (job.done) { finish(job); return; }
        // delegated and unanswered: MatchRehearsal calls back here — `done`, the pick already in `job.best`, nothing
        // left to simulate — or after the server took the job over, whose own slices follow; never once the prep ended.
        // The continuation is installed here rather than when the frame went out: the generator that offered the task
        // still places the default layout after the delegation returns (`applyPlanSteps`), so an outcome applied earlier
        // would set the seat Ready and drop those steps — an answer that arrived in the meantime is the `done` above.
        if (job.pending) {
          job.onSettled = () => {
            if (!valid()) return;
            if (job.done) finish(job);
            else { job.takeOver(); runJob(job); }
          };
          return;
        }
        runJob(job);
      });
    });
  }

  onReadyChanged(ps) {
    this.markPublic();
    void ps;
    this.maybeEndPrep();
  }

  maybeEndPrep() {
    if (this.phase !== PHASE.PREP || this._prepEndQueued) return;
    const allReady = () => { const alive = this.prepPlayers(); return alive.every((p) => p.ready); };
    if (!allReady()) return;
    const round = this.round;
    this._prepEndQueued = true;
    // the prep deadline stays armed until the phase really ends: a player may un-ready before this runs
    this.later(0, () => {
      this._prepEndQueued = false;
      if (this.phase === PHASE.PREP && this.round === round && allReady()) this.endPrep();
    });
  }

  prepDeadline() {
    if (this.phase !== PHASE.PREP) return;
    for (const ps of this.prepPlayers()) {
      if (ps.ready) continue;
      this.autoPickPersonalChoice(ps, 'random');
      ps.resolveTemp();
      ps.ready = true;
      ps.dirty();
    }
    this.endPrep();
  }

  endPrep() {
    // 布阵学习库：整备真正结束时记录各席位布阵（未结算则不落盘）。
    try { recordPrepLineups(this); } catch { /* 库关闭时静默 */ }

    if (this.phase !== PHASE.PREP) return;
    // rehearsals still waiting for a host's answer die with the prep: their bots place the default layout, a late answer
    // is ignored (Match._takeOverRehearsal / MatchRehearsal) and nothing of them runs after the phase ended
    this._cancelRehearsal();
    this.setDeadline(0);
    const alive = this.alivePlayers();
    for (const ps of this.prepPlayers()) this.dispatch(ps, 'onPrepEnd', { round: this.round });
    // 协同经济 (DESIGN §28): the prep end closes every request, then the leftovers convert (坎诺特 bands skip it)
    if (this.teamEcon) {
      this.econCloseAll('prep-end');
      for (const ps of alive) this.econConvertLeftover(ps);
    }
    for (const ps of alive) ps.endPrep();
    const r = this.round;
    // 肉鸽（mode_rogue_*，2026-11-03）：Boss / 隐藏回合仍按**普通战斗**打 —— 官方图在 Boss 半场（rows 0–5）没有部署格，
    // Boss 本体由该图的出怪表带 `tag:'boss'` 出场（tools/build-rogue-maps-v2.mjs），phases.js startRound 同样用
    // `isRogue !== true` 排除这两关的 boss 出怪计划。所以这两条 Final Assault / Hidden Core 分支对肉鸽不成立，肉鸽
    // R14 照常走 startCombat（普通战斗准备）。其它模式逐字不变。
    if (r === this.gd.bossRound && this.isRogue !== true) {
      this.hiddenLayerSum = alive.reduce((s, p) => s + p.activatedLayers(), 0);
      this.startFinalAssault(false);
    } else if (r === this.gd.hiddenRound && this.isRogue !== true) {
      this.startFinalAssault(true);
    } else if (this.isRoleRound && this.isRoleRound() && this._confrontDoneRound !== this.round) {
      // 防御性兜底：攻防回合若还没投放，先回到攻方投放，再进守方休整
      this.enterConfront();
    } else {
      this.startCombat();
    }
  }

  /** 攻方投放结束后的守方休整（与 enterPrep 同一套逻辑，仅参战名单不同）。 */
  enterDefenderPrep() { this.enterPrep(); }
}
