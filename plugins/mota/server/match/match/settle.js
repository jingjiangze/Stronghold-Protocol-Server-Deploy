import { flushMatchLineups } from '../../lineupLibrary.js';
// server/match/match/settle.js — Match methods: SETTLE (the LP loss — a leaker's 联防 survivors —, stats, bounty coins,
// the IN_BATTLE layer gains clamped by layerGainRoom, CHAR_DAMAGE tickers, eliminations, the 联防 outcome the SETTLE
// view carries) and RESULT (finish: m.result to every human still here, onEnd).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

const REVIVAL_WINDOW_MS = 30_000; // 救援窗口（业主 2026-10-17：固定 30 秒，期间冻结推进）

import { PHASE, layerGainRoom } from '../../../shared/constants.js';
import { uniteSurvivors } from '../unite.js';
import { buildResult } from '../results.js';
import { FLOW_TICKER_PRIORITY, DELAYS } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onSettle, resetRoundCounters } from '../botEmotes.js';
import { creditedKillsOf } from '../../sim/spec.js';

export class MatchSettle {
  settle(plan, uniteResult) {
    this.phase = PHASE.SETTLE;
    this.runner = null;
    this._stopClientCombat();
    // the pending in-battle gains the views showed become persistent below (alive players) or lapse (DESIGN §20.15)
    for (const ps of this.order) if (ps.pendingLayerGains) { ps.pendingLayerGains = null; ps.dirty(); }
    const cap = this.gd.lpCapPerRound;
    // a 联防 battle that could not run at all (synthetic result) must not wipe the leakers' losses: charge their own leaks
    const uniteRan = !!(plan && uniteResult && !uniteResult.synthetic);
    const survivors = uniteRan ? uniteSurvivors(plan, uniteResult) : null;
    // The 联防's outcome as data for the SETTLE view (m.public.uniteResult, views.js; GitHub #235, PR #112 by @Convey123):
    // each client pops the official result box from it (ui/gameLogic/phases.js uniteResultBox) — `through` = the leakers'
    // enemies that still got through (uncapped; only decides whether 「全员无伤！」 is true), `losses` = every alive
    // player's own LP charge of this round, the same `loss` deducted below, so the box and the LP bar never disagree. A
    // leaker's own battle leaks are not its charge in a 联防 round, which is why the client cannot work the number out
    // itself. No ticker line: the official reports the outcome in the one dialog. null when no 联防 resolved.
    this.uniteResultView = uniteRan && plan.leakers.length ? {
      through: plan.leakers.reduce((n, lk) => n + Math.max(0, survivors.get(lk.playerId) || 0), 0),
      helpers: plan.helpers.map((p) => p.playerId),
      leakers: plan.leakers.map((p) => p.playerId),
      losses: {},
    } : null;
    // 救援 (促融共竞 / DESIGN §29): the settle window is opened here — 其余全体存活队友各自表态同意（`consents`），
    // 全票到齐才从共享池扣款放人。谁在窗口里、谁还不能被救，由 revival.js 自己判定。
    if (this.revivalEnabled) {
      this.revival = { round: this.round, windowOpen: false, consents: new Map() };
    }
    const alive = this.alivePlayers();
    for (const ps of alive) {
      const r = this.lastResults.get(ps.playerId) || { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 };
      const counted = (r.leaked || []).filter((l) => l && l.counted !== false).length;
      const loss = uniteRan && plan.leakers.includes(ps) ? Math.min(cap, survivors.get(ps.playerId) || 0) : Math.min(cap, counted);
      if (this.uniteResultView) this.uniteResultView.losses[ps.playerId] = loss;
      ps.lp -= loss;
      ps.stats.lpLost += loss;
      ps.stats.leaks += counted;
      ps.stats.kills += Number(r.killed) || 0;
      ps.stats.dmgDealt += Number(r.damageDealt) || 0;
      ps.stats.healing += Number(r.healingDone) || 0;
      // Per-unit totals for the settlement's MVP (results.js mvpOf; owner's rule 2026-10-06: the result screen speaks
      // with each player's OWN team MVP). The verified battle report (fields.js `unitStats`) is the only place per-unit
      // damage/kills exist, so they are summed per defId here — and never leave the server except as the chosen MVP.
      const mergeUnits = (list) => {
        for (const u of Array.isArray(list) ? list : []) {
          if (!u || typeof u.defId !== 'string') continue;
          const cur = ps.stats.unitStats.get(u.defId) || { dmg: 0, kills: 0, heal: 0 };
          cur.dmg += Math.max(0, Number(u.dmg) || 0);
          cur.kills += Math.max(0, Math.trunc(Number(u.kills) || 0));
          cur.heal += Math.max(0, Number(u.heal) || 0);
          ps.stats.unitStats.set(u.defId, cur);
        }
      };
      mergeUnits(r.unitStats);
      if (r.perfect !== false && counted === 0) ps.stats.perfectRounds++;
      // bounty coins (own battle + unite kills) are credited to the next prep
      let coins = Math.max(0, Math.trunc(Number(r.coins) || 0));
      const up = uniteResult && uniteResult.perPlayer && uniteResult.perPlayer[ps.playerId];
      if (up) {
        coins += Math.max(0, Math.trunc(Number(up.coins) || 0));
        ps.stats.dmgDealt += Number(up.damageDealt) || 0;
        ps.stats.kills += Number(up.killed) || 0;
        mergeUnits(up.unitStats);   // 联防 kills count for the MVP too
      }
      ps.creditedKills += creditedKillsOf(r) + creditedKillsOf(up);
      // perfect-payout bounties (战术特训): own phase perfect
      for (const b of ps.bounties) if (b.card.payout === 'perfect' && counted === 0 && r.perfect !== false) coins += b.card.coin;
      if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
      for (const b of ps.bounties) b.roundsLeft--;
      ps.bounties = ps.bounties.filter((b) => b.roundsLeft > 0);
      // IN_BATTLE layer gains (normal battles only), at most the room left under BOND_LAYER_CAP (999, as the battle's
      // live copy: Battle.addLayers); a bond at the cap gains nothing and dispatches nothing
      for (const [bondId, n] of Object.entries(r.layerGains || {})) {
        if (!this.gd.bond(bondId) || !(n > 0)) continue;
        const before = ps.layers[bondId] || 0;
        const add = layerGainRoom(before, Math.floor(n));
        if (!(add > 0)) continue;
        ps.layers[bondId] = before + add;
        this.dispatch(ps, 'onLayers', { bondId, from: before, to: ps.layers[bondId], reason: 'battle' });
      }
      this._charDamageTickers(ps, r);
      this.dispatch(ps, 'onBattleResult', { result: r, lpLoss: loss, perfect: counted === 0 && r.perfect !== false, unite: uniteResult || null });
      ps.recompute();
    }
    // 联防奖励（业主 2026-10-18）：自家阵地与联防都没有穿透才发钱。
    //   全员都防住（没有任何一家漏）→ 高的一档；有人漏但联防 0 穿透 → 低的一档；联防也漏了 → 不发。
    if (this.teamEcon && !this.teamEcon.borrowOnly) {
      const ownLeak = alive.some((ps) => {
        const r = this.lastResults.get(ps.playerId);
        return ((r && r.leaked) || []).some((l) => l && l.counted !== false);
      });
      const through = this.uniteResultView ? this.uniteResultView.through : 0;
      const uniteRanWithLeakers = !!(uniteRan && plan && Array.isArray(plan.leakers) && plan.leakers.length);
      if (!ownLeak && through === 0) this.econDefenceReward({ full: true });
      else if (uniteRanWithLeakers && through === 0) this.econDefenceReward({ full: false });
    }
    for (const ps of alive) {
      if (ps.lp <= 0) {
        // 救援 (促融共竞 / DESIGN §29): 模式开着且这局还有别人能投票时，不淘汰，把人按在 0 LP 开窗口
        // （revival.js revivalDefer —— 它自己负责 toast、consents 与 bot 的自动同意）。否则才是当场淘汰。
        // 单席 / 无投票人 / 池子付不起满票这几种救不回来的情形， revivalDefer 之后仍由 revivalFinalizeAll
        // 在 afterSettle 收口，原因记在玩家身上给 UI 说明。
        if (this.revivalEnabled) {
          this.revivalDefer(ps);
          continue;
        }
        ps.lp = 0;
        ps.eliminate(this.round);
        this.toast(ps, 'error', '你的目标生命值耗尽，已被淘汰');
        this.tickerText(msg('{name}博士的目标生命值已耗尽', { name: ps.name }), FLOW_TICKER_PRIORITY);
      }
    }
    this.eliminateBroken();
    this.fields = [];
    this.watchers.clear();
    this.markPublic();
    onSettle(this); // one emote per alive AI per round (enabled by default; SP_BOT_EMOTES=0 silences it)
    this.setDeadline(DELAYS.SETTLE / 1000, () => this.afterSettle(), { silent: this.soloUntimed });
  }

  /**
   * CHAR_DAMAGE tickers: one per board unit of the battle (its highest threshold); units created in battle (summons,
   * no board uid) count once per unit type (the highest of them) — a result can never announce more units than the
   * lineup has kinds of.
   */
  _charDamageTickers(ps, r) {
    const steps = (Array.isArray(this.gd.config.broadcasts) ? this.gd.config.broadcasts : []).filter((b) => b.type === 'CHAR_DAMAGE' && Array.isArray(b.params)).map((b) => Number(b.params[0])).filter((n) => n > 0).sort((a, b) => b - a);
    if (!steps.length) return;
    const board = new Set();
    for (const p of ps.board.values()) board.add(p.uid);
    const best = new Map();
    for (const u of r.unitStats || []) {
      if (!u) continue;
      const key = Number.isInteger(u.uid) && board.has(u.uid) ? `uid:${u.uid}` : `def:${u.defId}`;
      const cur = best.get(key);
      if (!cur || (Number(u.dmg) || 0) > (Number(cur.dmg) || 0)) best.set(key, u);
    }
    for (const u of best.values()) {
      const hit = steps.find((s) => (u.dmg || 0) >= s);
      if (hit) this.tickerFor('CHAR_DAMAGE', [ps.name, u.name || u.defId, String(hit)], { playerId: ps.playerId, param: String(hit) });
    }
  }

  /**
   * Drop every alive player whose LP is already gone. Settlement calls this after the round's LP loss.
   * An accepted test round jump calls the same helper before the next round starts, so LP 0 cannot be
   * written back into a new prep. The LP command itself stays a raw write.
   */
  eliminateBroken() {
    for (const ps of this.alivePlayers()) {
      if (ps.lp <= 0) {
        // 促融共竞 / 救援 (revival.js): 只有开启复活的玩法（魔塔/协同）才会 defer；其余玩法与上游一致直接淘汰。
        if (this.revivalEnabled) { this.revivalDefer(ps); continue; }
        ps.lp = 0;
        ps.eliminate(this.round);
        this.toast(ps, 'error', '你的目标生命值耗尽，已被淘汰');
        this.tickerText(msg('{name}博士的目标生命值已耗尽', { name: ps.name }), FLOW_TICKER_PRIORITY);
      }
    }
  }

  afterSettle() {
    // 救援 (促融共竞 / DESIGN §29): 业主 2026-10-17 —— 窗口固定 **30 秒**并在此期间冻结推进（以前窗口寿命就是
    // SETTLE 的展示时长，一眨眼就过去了，所以「直接被跳过」）。第一趟只开窗并挂起，到点再回来走第二趟收尾。
    if (this.revivalEnabled && !this._revivalHeld && this.order.some((ps) => ps.pendingDeath)) {
      this._revivalHeld = true;
      if (this.revival) this.revival.windowOpen = true;
      this.markPublic();
      this.tickerText(msg('救援窗口：{n} 秒内可以救回队友', { n: Math.round(REVIVAL_WINDOW_MS / 1000) }), FLOW_TICKER_PRIORITY);
      this.later(REVIVAL_WINDOW_MS, () => {
        // **不要**在这里清 _revivalHeld：清了之后 afterSettle 会重新看到 pendingDeath，又挂起 30 秒 ——
        // 无限续窗、永远不淘汰（冒烟测试抓到过）。标记留到下一回合的 startRound 再重置。
        if (this.ended || this.disposed) return;
        this.afterSettle();
      });
      return;
    }
    // 到点还挂着的人（没人投票、池子付不起、或票没凑齐）在这里真正淘汰，原因由 revivalFinalizeAll 细化到人。
    if (this.revivalEnabled) this.revivalFinalizeAll();
    if (!this.alivePlayers().length) { this.finish({ victory: false, reason: 'eliminated' }); return; }
    resetRoundCounters(this); // AI bot merge-counter resets each round (server/match/botEmotes.js)
    this.startRound(this.round + 1);
  }

  finish({ victory, hiddenCleared = false, reason = 'defeat' }) {
    // 布阵学习库：只有成功结算的对局才落盘（未结算对局由 dropStagedLineups 丢弃）。
    try { flushMatchLineups(this, { victory: !!victory, reason }); } catch { /* 库关闭时静默 */ }

    // A command that ends a test match must be audited/counted before publishing its result.
    if (this.test && this._testApplying) { this._testOutcome = { victory, hiddenCleared, reason }; return; }
    if (this.ended || this.disposed) return;
    this.offersDispose();
    this.ended = true;
    if (this.runner) { try { this.runner.stop(); } catch { /* ignore */ } this.runner = null; }
    this._stopClientCombat();
    this.cancel(this._phaseTimer);
    this.cancel(this._turnTimer);
    for (const h of this._timers) { try { this.sched.clearTimeout(h); } catch { /* ignore */ } }
    this._timers.clear();
    this.phase = PHASE.RESULT;
    this.deadline = 0;
    for (const f of this.fields) f.live = false;
    this.outcome = { victory: !!victory, hiddenReached: this.hiddenReached, hiddenCleared: !!hiddenCleared, reason };
    let result;
    try {
      result = buildResult(this, this.outcome);
    } catch (e) {
      this.reportError('buildResult', e);
      result = { t: 'm.result', victory: !!victory, roundsPassed: 0, reason, modeId: this.modeId, difficulty: this.difficulty, players: [] };
    }
    if (this.test) {
      result.test = true;
      result.testActions = this.testActions;
      if (this.testReplayable === false) result.testReplayable = false;
    }
    this.lastResultMsg = result;
    // the match's LAST m.public is sent in full: the lobby keeps that frame and replays it to a resume / reload that
    // comes back to the result screen without a baseline to merge into (a delta there could not be applied — DESIGN
    // §8.2, incremental frame)
    this.markPublicFull();
    this.markPublic();
    try { this.flush(true); } catch (e) { this.reportError('flush', e); }
    // every human still here gets the settlement — the spectator seats the same public rows (none of them their own)
    for (const ps of this._viewers()) this.sendTo(ps.playerId, { ...result, playerId: ps.playerId });
    const { t, ...summary } = result;
    void t;
    summary.errors = this.errorCount;
    // 走的是哪条路径，不许静默 (业主裁令 2026-10-12): 参与人数决定超容变体（每人独立池 / 分小队联防），
    // 所以结算日志里必须看得到人数与闸门状态。
    this.log?.info?.(`[match] ${this.roomCode} settled (${summary.reason}) participants=${this.participants} variant=${this.variant === true}`);
    try { this.onEndFn(summary); } catch (e) { this.reportError('onEnd', e); }
  }
}
