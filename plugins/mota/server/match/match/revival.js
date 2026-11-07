// server/match/match/revival.js — 救援 (促融共竞 / DESIGN §29).
//
// LP 归零不再当场淘汰：结算期开一个窗口，**其余全体存活队友各自表态同意**（bot 席位延迟一小段自动同意），
// 全票到齐后一次性从**共享池**按人头扣款（每人 = costPer + step × 已复活次数，即 5 / 10 / 15…），
// 把目标带 1 点 LP 救回战场。池子不够则救援不成立，窗口一关就真正淘汰，并把原因记在玩家身上供 UI 说明。
//
// 规则随模式开启（GameData.revival ← mode.revival.enabled），不是房间选项：促融共竞自带，别的模式没有。
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR, REVIVAL_COST_PER, REVIVAL_COST_STEP, REVIVAL_UNAVAILABLE_REASONS } from '../../../shared/constants.js';
import { msg } from '../../../shared/i18n.js';
import { FLOW_TICKER_PRIORITY, OK, fail } from './common.js';

export class MatchRevival {
  /** Called from the Match constructor once the seed and GameData exist (like econInit). */
  revivalInit() {
    this.revivalRule = this.gd.revival;                    // { costPer, step } or null
    this.revivalEnabled = !!this.revivalRule;
    this.revivalCostPer = this.revivalRule && Number.isInteger(this.revivalRule.costPer) ? this.revivalRule.costPer : REVIVAL_COST_PER;
    this.revivalStep = this.revivalRule && Number.isInteger(this.revivalRule.step) ? this.revivalRule.step : REVIVAL_COST_STEP;
    /** 已经成功复活过几次：费用 = costPer + step × 次数（5 / 10 / 15…，依次叠加）。 */
    this.reviveCount = 0;
    /** @type {{ round: number, windowOpen: boolean, consents: Map<string, Set<string>> } | null} */
    this.revival = null;
  }

  /** 本次复活**每人**要从共享池付多少。 */
  revivalCostFor() {
    return this.revivalCostPer + this.revivalStep * this.reviveCount;
  }

  /** Opened for the round a death was deferred in, and only while the settle phase (and the match) is still going. */
  revivalWindowOpen() {
    const state = this.revival;
    return !!(this.revivalEnabled && !this.ended && !this.disposed && this.phase === PHASE.SETTLE
      && this.teamLp == null && state && state.windowOpen && state.round === this.round);
  }

  /** 需要同意的人：除被救者以外的**全体存活席位**（bot 也算；由服务器代它们自动同意）。 */
  revivalVoters(target) {
    return this.order.filter((p) => p !== target && p.alive && !p.left && this.players.get(p.playerId) === p);
  }

  /** A downed player still in the window: LP spent, not yet eliminated, and not rescued before. */
  revivalTargetEligible(ps) {
    return !!(ps && !ps.left && !ps.alive && ps.pendingDeath && !ps.revived);
  }

  /** Why this downed player cannot be rescued right now (one of REVIVAL_UNAVAILABLE_REASONS). */
  revivalDeathReason(ps) {
    if (ps.left) return 'left';
    if (ps.revived) return 'already-used';
    if (!this.revivalEnabled) return 'disabled';
    if (this.teamLp != null || this.ended || this.disposed) return 'match-ended';
    const voters = this.revivalVoters(ps);
    if (!voters.length) return 'no-voter';
    // 共享池不够付满票（每人 costPer + step × 已复活次数）时，窗口到期也救不回来——原因要说「池子不够」，
    // 而不是笼统的「窗口关了」。这两个状态在客户端各有自己的文案。
    const pool = Number.isFinite(this.teamReserve) ? this.teamReserve : 0;
    if (pool < this.revivalCostFor() * voters.length) return 'pool';
    return 'window-closed';
  }

  /**
   * LP ran out while 救援 is on: hold the player at 0 instead of eliminating them, and open the window. The settle
   * loop calls this; `afterSettle` finalises whatever is still pending.
   */
  revivalDefer(ps) {
    ps.revivalUnavailableReason = null;
    ps.lp = 0;
    ps.alive = false;
    ps.pendingDeath = true;
    ps.dirty();
    this.toast(ps, 'warn', '你的目标生命值耗尽，等待救援（需要全体队友同意）');
    if (!this.revival) this.revival = { round: this.round, windowOpen: true, consents: new Map() };
    this.revival.round = this.round;
    this.revival.windowOpen = true;
    if (!this.revival.consents.has(ps.playerId)) this.revival.consents.set(ps.playerId, new Set());
    this._scheduleBotConsents(ps);
  }

  /** bot 席位像在思考：延迟一小段后自动同意（业主：「ai 自动同意」）。 */
  _scheduleBotConsents(target) {
    const rng = this.rngEcon || null;
    for (const bot of this.revivalVoters(target)) {
      if (!bot.isBot) continue;
      // 业主 2026-10-17「ai 默认复活队友」：不再随机等 0.5–1.2 秒，AI 席位**默认同意**，只留一点点延迟让
      // 人类看清票数在涨；窗口仍开着且这一票没落地（比如当时共享池不够、之后补上了）就再试一次。
      const delay = 150 + (rng ? rng.int(150) : 0);
      const targetId = target.playerId;
      this.later(delay, () => {
        if (!this.revivalWindowOpen()) return;
        if (this.players.get(bot.playerId) !== bot || !bot.alive) return;
        const r = this.reviveConsent(bot, targetId, { byServer: true });
        if (r && r.error && this.revivalWindowOpen()) {
          this.later(900, () => {
            if (!this.revivalWindowOpen()) return;
            if (this.players.get(bot.playerId) !== bot || !bot.alive) return;
            this.reviveConsent(bot, targetId, { byServer: true });
          });
        }
      });
    }
  }

  /** Eliminate a held player for real (window closed, match over, or they left) — same path as a normal elimination. */
  revivalFinalize(ps, { notify = true, reason = null } = {}) {
    if (ps.alive || !ps.pendingDeath) return false;
    const why = reason || this.revivalDeathReason(ps);
    if (ps.revivalUnavailableReason == null) {
      ps.revivalUnavailableReason = REVIVAL_UNAVAILABLE_REASONS.includes(why) ? why : 'window-closed';
    }
    ps.lp = 0;
    ps.pendingDeath = false;
    // 淘汰本体在 PlayerState.eliminate (server/match/player/round.js:53)：它把棋盘/手牌/暂存/商店全部回收进池子、
    // 置 eliminatedRound 并 recompute。settle.js 的常规淘汰、platform.js 的退场淘汰走的都是它——救援到期也走同一条，
    // 不另造一条淘汰路径（否则池子会凭空多出或漏掉一份拷贝）。
    ps.eliminate(this.round);
    if (notify) {
      this.toast(ps, 'error', '你的目标生命值耗尽，已被淘汰');
      this.tickerText(msg('{name}博士的目标生命值已耗尽', { name: ps.name }), FLOW_TICKER_PRIORITY);
    }
    return true;
  }

  /** The window is over: everyone still pending is eliminated, with the reason recorded for the UI. */
  revivalFinalizeAll({ notify = true, reason = null } = {}) {
    if (this.revival) this.revival.windowOpen = false;
    const base = reason || (this.ended || this.disposed ? 'match-ended'
      : this.teamLp != null ? 'match-ended' : 'window-expired');
    let n = 0;
    for (const ps of this.order) {
      if (!ps.pendingDeath) continue;
      // 窗口**正常到期**时把原因细化到人：没有可同意的人 → `no-voter`；池子付不起满票 → `pool`；其余才是
      // 笼统的 `window-closed`（即「有人能救，但谁都没表态」）。比赛已结束/离场那几类仍用上面的 `base`。
      const why = base === 'window-expired' ? this.revivalDeathReason(ps) : base;
      n += this.revivalFinalize(ps, { notify, reason: why }) ? 1 : 0;
    }
    if (n) this.markPublic();
    return n;
  }

  /**
   * C2S `g.revive { playerId, round }` — 一个队友的同意。**全票到齐才结算**：钱在最后一张同意落地时一次性从
   * 共享池扣（`costPer + step × 已复活次数` × 同意人数），在此之前不落账、也就不需要退款。
   */
  reviveConsent(ps, targetId, { byServer = false, round = null } = {}) {
    if (!this.revivalEnabled) return fail(ERR.WRONG_PHASE, 'revival-disabled');
    if (!this.revivalWindowOpen()) return fail(ERR.WRONG_PHASE, 'revival-window-closed');
    // 旧窗口排队的那一下点击：客户端带的 round 必须与当前回合一致（bot 的自动同意由服务器代发，无 round）
    if (!byServer && (!Number.isInteger(round) || round !== this.round)) return fail(ERR.WRONG_PHASE, 'stale-round');
    if (!ps || ps.left) return fail(ERR.NOT_IN_ROOM);
    if (ps.isBot && !byServer) return fail(ERR.NOT_IN_ROOM);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const target = this.players.get(targetId);
    if (!target || target === ps || !this.revivalTargetEligible(target)) return fail(ERR.BAD_TARGET, 'revival-target-ineligible');
    const voters = this.revivalVoters(target);
    if (!voters.some((v) => v.playerId === ps.playerId)) return fail(ERR.BAD_TARGET, 'revival-not-voter');
    const set = this.revival.consents.get(target.playerId) || new Set();
    if (set.has(ps.playerId)) return fail(ERR.ALREADY, 'revival-already-consented');
    const missing = voters.filter((v) => v.playerId !== ps.playerId && !set.has(v.playerId));
    if (missing.length) {
      set.add(ps.playerId);
      this.revival.consents.set(target.playerId, set);
      this.markPublic();
      this.markPrivate(ps);
      this.toast(ps, 'info', msg('已同意救援 {name}（还差 {n} 人）', { name: target.name, n: missing.length }));
      return OK;
    }
    // 最后一张同意：现在结算
    const per = this.revivalCostFor();
    const total = per * voters.length;
    const pool = Number.isFinite(this.teamReserve) ? this.teamReserve : 0;
    if (pool < total) return fail(ERR.NO_FUNDS, 'revival-pool-insufficient');
    this.teamReserve -= total;
    set.add(ps.playerId);
    this.revival.consents.set(target.playerId, set);
    this.reviveCount += 1;
    target.revived = true;
    target.alive = true;
    target.pendingDeath = false;
    target.revivalUnavailableReason = null;
    target.lp = 1;
    target.dirty();
    this.markPublic();
    for (const v of voters) this.markPrivate(v);
    this.toast(target, 'ok', msg('全体队友同意：你被救了回来（共享池支付 {total}）', { total }));
    this.tickerText(msg('{n} 人同意，救援了 {target}', { n: voters.length, target: target.name }), FLOW_TICKER_PRIORITY);
    return OK;
  }

  /** The 救援 block of the public view, or null while the mode has no 救援 or nothing is pending. */
  revivalView() {
    if (!this.revivalEnabled) return null;
    const state = this.revival;
    const targets = this.order.filter((ps) => ps.pendingDeath).map((ps) => {
      const voters = this.revivalVoters(ps);
      const need = voters.map((v) => v.playerId);
      // `agreed` 只算**还在名单里**的人：同意的队友中途离场后，那一票不该再计入「同意 n/总数」，
      // 否则会数出「同意 2/1」这种比总数还大的读数（扣款金额按当次重算的 voters 走，不受影响）。
      const agreed = (state && state.consents.get(ps.playerId) ? [...state.consents.get(ps.playerId)] : [])
        .filter((id) => need.includes(id));
      // 总花费 = 每人费用 × 同意人数（服务端扣款就是按这个算的，UI 不再自己猜）
      return { playerId: ps.playerId, name: ps.name, need, agreed, total: this.revivalCostFor() * need.length };
    });
    if (!state && !targets.length) return null;
    return {
      open: this.revivalWindowOpen(),
      round: state ? state.round : this.round,
      costPer: this.revivalCostFor(),
      costNext: this.revivalCostPer + this.revivalStep * (this.reviveCount + 1),
      revives: this.reviveCount,
      pool: Number.isFinite(this.teamReserve) ? this.teamReserve : 0,
      targets,
    };
  }
}
