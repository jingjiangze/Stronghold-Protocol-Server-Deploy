import { flushMatchLineups } from '../../lineupLibrary.js';
// server/match/match/settle.js — Match methods: SETTLE (the LP loss — a leaker's 联防 survivors —, stats, bounty coins,
// the IN_BATTLE layer gains clamped by layerGainRoom, CHAR_DAMAGE tickers, eliminations, the 联防 outcome the SETTLE
// view carries) and RESULT (finish: m.result to every human still here, onEnd).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

const REVIVAL_WINDOW_MS = 30_000; // 救援窗口（业主 2026-10-17：固定 30 秒，期间冻结推进）

/**
 * 怪物资金的奖励**按单价**发（2026-11-06「价值同源」，业主报障「扣血量与价值完全脱钩」）：
 *   击杀 = max(只数, monsterKillReward(Σ阶梯价))、漏过 = max(只数, monsterLeakReward(Σ阶梯价)) ——
 *   两个函数在 `../monsterShop.js`（单只口径 `max(1, round(price × 0.25 / 0.5))`，与 monsterBonds.js 的「回收」
 *   盟约同一个函数）。按**合计价**套用同一条式子是刻意的：sim 只按席位汇总 Σ价 与只数（sim/battle/deploy.js
 *   tallySeat），不逐只回传单价；混批时与「逐只求和」相差不超过几只 1 元保底，方向一致。
 *   漏过给得比击杀多（×0.5 vs ×0.25）：漏怪对攻方是「达成本回合目的」（守方掉血），击杀是「被防住」但仍然是消耗。
 * 改这些口径不影响价格 / 军费（价格在 monsterShop.js 的 monsterPriceOf / MONSTER_PRICE_BY_TIER，军费在
 * confront.js 的 CONFRONT_VOLUME_SHARE）。
 * @deprecated 下面是旧口径的定额常量（一杀 1 / 一漏 2），2026-11-06 起奖励按单价 —— 保留导出只为老调用方不炸，
 * 新代码请用 monsterShop.monsterKillReward / monsterLeakReward。
 */
export const MONSTER_KILL_REWARD = 1;
export const MONSTER_LEAK_REWARD = 2;

/**
 * 一个战场结果里「投放怪战果」的来源（settle 与战役结算读同一份）：优先 `f.result`，没有就问 battle.result()。
 * 对抗模式的 confrontKills / confrontLeaks 就挂在这份结果上（sim/battle/lifecycle.js）。
 * @param {any} f field
 * @returns {object|null}
 */
function placedFieldResult(f) {
  let fr = f && f.result;
  if (!fr && f && f.battle && typeof f.battle.result === 'function') { try { fr = f.battle.result(); } catch { fr = null; } }
  return fr && typeof fr === 'object' ? fr : null;
}

/**
 * 一张按席位汇总的 map（`{ [seat]: 只数 }`）⇒ 合计正整数；坏值按 0。
 * 结果里有四张：confrontKills / confrontLeaks（只数）与 confrontKillValue / confrontLeakValue（同批怪按阶位阶梯价
 * 合计，sim/battle/deploy.js tallySeat）。老页面 / 服务端老 sim 只发前两张 —— 那时价值项回落为只数（一只 1 点）。
 */
function seatTotal(map) {
  let n = 0;
  for (const v of Object.values(map || {})) n += Math.max(0, Number(v) || 0);
  return n;
}

/** 只数 + 价值：`value` 不小于 `count`（每只至少 1 点），缺价值表 ⇒ value = count。 */
function seatBatch(counts, values) {
  const count = seatTotal(counts);
  return { count, value: Math.max(count, seatTotal(values)) };
}

/** 单个席位（同一张只数表 + 价值表）：只数 + 价值。 */
function seatPair(counts, values, seatStr) {
  const count = Math.max(0, Number(counts && counts[seatStr]) || 0);
  return { count, value: Math.max(count, Math.max(0, Number(values && values[seatStr]) || 0)) };
}

import { PHASE, layerGainRoom } from '../../../shared/constants.js';
import { uniteSurvivors } from '../unite.js';
import { buildResult } from '../results.js';
import { FLOW_TICKER_PRIORITY, DELAYS } from './common.js';
import { msg } from '../../../shared/i18n.js';
import { onSettle, resetRoundCounters } from '../botEmotes.js';
import { creditedKillsOf } from '../../sim/spec.js';
import { monsterKillReward, monsterLeakReward } from '../monsterShop.js';

export class MatchSettle {
  settle(plan, uniteResult) {
    this.phase = PHASE.SETTLE;
    // rule 藏品：每场战斗结束的资金奖励（至宝指环 postBattleFunds）
    try { if (typeof this.applyRelicPostBattle === 'function') this.applyRelicPostBattle(); } catch (e) { this.reportError?.('relic post battle', e); }
    // rule 藏品：kingCrystal「战斗结束后使目标生命 −2（不会低于 1）」
    try { if (typeof this.applyRelicLpDrain === 'function') this.applyRelicLpDrain('battle'); } catch (e) { this.reportError?.('relic lp drain', e); }
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
    // 对抗模式（业主 2026-11-03）：对称血量。两笔扣血都按「投放席位」统计，而这份统计挂在**场的顶层结果**上
    // （sim Battle._buildResult → compactResult 透传）。注意 this.lastResults 只存 perPlayer（combat.js _finishCombat），
    // 顶层字段到不了那里 —— 所以这里读 this.fields 的结果，而不是 lastResults。
    //
    // 2026-11-06 口径统一（业主报障「扣血逻辑完全混乱」，审计 8 类问题的 2/6/7 类）：
    //   ① 逐队封顶：每队整回合只吃一次 min(cap, Σ本回合损失)。旧码守方按「逐人 counted + 本场投放怪」各扣一次，
    //      2V2 守方因此最多掉 2×cap；攻方本来就是整队一次 —— 现在两边同口径。
    //   ② 不双计：带 `confrontSeat` 的漏怪只算「投放怪」那一笔（confrontLeaks），官方 `counted` 那一笔把它排除。
    //   ③ 不免费：官方 `countInTotal:false`（unharmful / part）漏过也扣 1 点 —— 旧码 0 扣，还记「完美作战」。
    //   ④ 按价值：投放怪按阶位阶梯价扣（sim 逐只带 spawn spec 的 `confrontPrice`，结果里按席位给出只数 +
    //      Σ价 两张表：confrontKills / confrontLeaks 与 confrontKillValue / confrontLeakValue），
    //      不再是「一漏 1 点、一杀 1 点」。缺价值表（老页面）时价值回落为只数。
    const versusLossByTeam = new Map();     // team → 本回合该队的损失（点数，未封顶）
    const addTeamLoss = (t, n) => { if (n > 0) versusLossByTeam.set(t, (versusLossByTeam.get(t) || 0) + n); };
    const placedLeaksByPlayer = new Map();  // 守方 playerId → 自己场上漏过去的投放怪只数（stats / 完美作战用）
    // 攻方奖励的归属（业主 2026-11-04：发给**投放者本人**）：键都是投放席位 String(seat)，用 this.order 查回 playerId。
    // playerId → { killed, killValue, leaked, leakValue }，value 按阶梯价（与扣血同一份 confrontKills / Leaks）。
    const placedRewardsByPlayer = new Map();
    const rewardOf = (owner) => {
      let r = placedRewardsByPlayer.get(owner.playerId);
      if (!r) { r = { killed: 0, killValue: 0, leaked: 0, leakValue: 0 }; placedRewardsByPlayer.set(owner.playerId, r); }
      return r;
    };
    if (this.isVersus) {
      for (const f of this.fields || []) {
        const fr = placedFieldResult(f);
        if (!fr) continue;
        // 守方：这块场漏过去的投放怪。按「场」记一次 —— 同场多名守方只给队伍记一次损失（逐队封顶的前提），
        // 玩家只数各记一份（stats.leaks / 完美作战要逐人看）。
        const leaks = seatBatch(fr.confrontLeaks, fr.confrontLeakValue);
        if (leaks.count > 0) {
          const teams = new Set();
          for (const pid of new Set(f.players || [])) {
            const ps = this.order.find((x) => x && x.playerId === pid);
            if (!ps) continue;
            teams.add(this.teamIdOf(ps));
            placedLeaksByPlayer.set(pid, (placedLeaksByPlayer.get(pid) || 0) + leaks.count);
          }
          for (const t of teams) addTeamLoss(t, leaks.value);
        }
        // 攻方：自己投放的怪被击杀。**不再** `!owner.alive` 就整条跳过 —— 被淘汰的攻方所属队伍可能还有池血，
        // 这一笔仍然记到队上（奖励照样不发：发放在下面按 ps.alive 过滤）。
        for (const seatStr of Object.keys(fr.confrontKills || {})) {
          const owner = this.order.find((x) => x && x.seat === Number(seatStr));
          if (!owner) continue;
          const kill = seatPair(fr.confrontKills, fr.confrontKillValue, seatStr);
          addTeamLoss(this.teamIdOf(owner), kill.value);
          const r = rewardOf(owner);
          r.killed += kill.count;
          r.killValue += kill.value;
        }
        // 漏过的投放怪同样按席位归到投放者（上面那段是「守方掉血」，这里是「攻方领钱」，两份互不影响）
        for (const seatStr of Object.keys(fr.confrontLeaks || {})) {
          const owner = this.order.find((x) => x && x.seat === Number(seatStr));
          if (!owner) continue;
          const leak = seatPair(fr.confrontLeaks, fr.confrontLeakValue, seatStr);
          const r = rewardOf(owner);
          r.leaked += leak.count;
          r.leakValue += leak.value;
        }
      }
    }
    // 发奖（业主 2026-11-04；2026-11-06 改为**按阶梯价**）：击杀 = max(只数, monsterKillReward(Σ价))、
    // 漏过 = max(只数, monsterLeakReward(Σ价))（`../monsterShop.js` 的两个函数，与 monsterBonds 的「回收」盟约同源），
    // 直接进投放者的**怪物资金**账户（跨回合结转，玩家可以留到下回合用）。一只最低 1 元，32 价的大怪按价值给钱。
    // 只在商店开着时发 —— `opts.monsterShop === false` 时整段不跑；席位查不到人 / 本人已淘汰就不发。
    if (this.monsterShopOn === true) {
      for (const [playerId, r] of placedRewardsByPlayer) {
        const ps = this.order.find((x) => x && x.playerId === playerId);
        if (!ps || !ps.alive || typeof ps.addMonsterFunds !== 'function') continue;
        const pay = Math.max(r.killed, monsterKillReward(r.killValue)) + Math.max(r.leaked, monsterLeakReward(r.leakValue));
        if (!(pay > 0)) continue;
        ps.monsterEarned = Math.max(0, Number(ps.monsterEarned) || 0) + pay;
        ps.addMonsterFunds(pay);
      }
    }
    const alive = this.alivePlayers();
    // 每名玩家自己场上「漏过去」的怪：官方 counted + 官方「不计数」怪（unharmful / part —— 旧码 0 扣，是
    // 「怪物方赢了对面不扣血」的另一半）。带 confrontSeat 的条目属于投放怪那一笔，这里排除（见上 ②，否则双计）。
    const ownLeaks = new Map();
    for (const ps of alive) {
      const r = this.lastResults.get(ps.playerId) || null;
      const leaked = (r && Array.isArray(r.leaked) ? r.leaked : []).filter((l) => l && l.confrontSeat == null && l.uniteRuntime !== true);
      const counted = leaked.filter((l) => l.counted !== false).length;
      ownLeaks.set(ps.playerId, { counted, free: leaked.length - counted, units: leaked.length });
      // 对抗：官方漏怪（含「不计数」怪）记到队上；投放怪的漏过已在上面按价值记过
      if (this.isVersus && this.teamLps) addTeamLoss(this.teamIdOf(ps), leaked.length);
    }
    // 对抗：两队各算一次 min(cap, Σ) 并落池（在淘汰判定之前）。上界再取「池里还剩多少」—— stats.lpLost 记真掉的血。
    const versusLossApplied = new Map();
    if (this.isVersus && this.teamLps) {
      for (const [t, raw] of versusLossByTeam) {
        const pool = Math.max(0, this.teamHpPool(t) ?? 0);
        const loss = Math.min(cap, Math.max(0, raw), pool);
        if (loss > 0) this._versusTeamLpLoss(t, loss);
        versusLossApplied.set(t, loss);
      }
    }
    for (const ps of alive) {
      const r = this.lastResults.get(ps.playerId) || { leaked: [], perfect: true, coins: 0, layerGains: {}, killed: 0, damageDealt: 0 };
      const own = ownLeaks.get(ps.playerId) || { counted: 0, free: 0, units: 0 };
      const placedLeaks = this.isVersus ? (placedLeaksByPlayer.get(ps.playerId) || 0) : 0;
      // 漏怪只数（逐人统计 / 完美作战用）：官方 counted + 官方「不计数」+ 自己场上漏过去的投放怪
      const leakUnits = own.units + placedLeaks;
      const loss = this.isVersus && this.teamLps
        ? (versusLossApplied.get(this.teamIdOf(ps)) ?? 0)   // 对抗：整队一次 min(cap, Σ)，上面已落池
        : (uniteRan && plan.leakers.includes(ps) ? Math.min(cap, survivors.get(ps.playerId) || 0) : Math.min(cap, leakUnits));
      // 肉鸽 rule 藏品 homeCooked：本回合零损失 = 一场完美作战（计数用于 +10%/场）
      if (loss === 0) { ps.relicPerfectBattles = (Number(ps.relicPerfectBattles) || 0) + 1; }
      // 肉鸽 rule 藏品 kingVessel：零损失**连续**回合数（上一回合没掉目标生命 ⇒ 下一战生命 +80%，连 3 回合 +200%）
      ps.relicNoLossStreak = loss === 0 ? (Number(ps.relicNoLossStreak) || 0) + 1 : 0;
      // 肉鸽 rule 藏品 survivor：打完的场数（desc 明写「不包括联防」）⇒ 每场再 +20%
      if (!uniteRan) ps.relicBattles = (Number(ps.relicBattles) || 0) + 1;
      if (this.uniteResultView) this.uniteResultView.losses[ps.playerId] = loss;
      // 对抗模式：扣的是**整队共享池**（队友的漏怪一起算），已按队扣过；队员的 ps.lp 由 _syncVersusTeamLp 拆分回写。
      if (!(this.isVersus && this.teamLps)) ps.lp -= loss;
      ps.stats.lpLost += loss;
      ps.stats.leaks += leakUnits;
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
      if (r.perfect !== false && leakUnits === 0) ps.stats.perfectRounds++;
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
      for (const b of ps.bounties) if (b.card.payout === 'perfect' && leakUnits === 0 && r.perfect !== false) coins += b.card.coin;
      // rule 藏品：赏金倍率（bountyMul ×2 / loseAllFunds ×0.5 / postBountyMul ×1.5）—— 照 desc 连乘
      if (coins > 0 && typeof this.relicBountyMul === 'function') {
        const bm = this.relicBountyMul();
        if (Number.isFinite(bm) && bm !== 1) coins = Math.max(0, Math.round(coins * bm));
      }
      if (coins > 0) { ps.pendingFunds += coins; ps.stats.fundsGained += coins; }
      // rule 藏品：完成悬赏计数（atkPerBounty 每完成一次永久 +20%）
      if (coins > 0) { ps.relicBountiesDone = (Number(ps.relicBountiesDone) || 0) + 1; }
      // rule 藏品：完成悬赏（本回合拿到赏金）时的额外资金（choiceFunds「完成悬赏时资金额外 +8」）
      if (coins > 0 && typeof this.applyRelicChoiceFunds === 'function') {
        try { this.applyRelicChoiceFunds(ps); } catch { /* noop */ }
      }
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
      this.dispatch(ps, 'onBattleResult', { result: r, lpLoss: loss, perfect: leakUnits === 0 && r.perfect !== false, unite: uniteResult || null });
      ps.recompute();
    }
    // 对抗模式（业主 2026-11-03）：对称血量 —— 攻方「自己投放的怪被击杀」那一笔已在上面和守方漏怪一起按队汇总、
    // 各算一次 min(cap, Σ) 并落池（逐队封顶、在淘汰判定之前），这里不再单独扣一次。
    // 联防奖励（业主 2026-10-18）：自家阵地与联防都没有穿透才发钱。
    //   全员都防住（没有任何一家漏）→ 高的一档；有人漏但联防 0 穿透 → 低的一档；联防也漏了 → 不发。
    if (this.teamEcon && !this.teamEcon.borrowOnly) {
      const ownLeak = alive.some((ps) => {
        const r = this.lastResults.get(ps.playerId);
        return ((r && r.leaked) || []).some((l) => l && l.counted !== false);
      });
      const through = this.uniteResultView ? this.uniteResultView.through : 0;
      const uniteRanWithLeakers = !!(uniteRan && plan && Array.isArray(plan.leakers) && plan.leakers.length);
      // 业主 2026-10-27：不再有「归个人 / 归团队」两种归属——防线奖励恒进团队储备，判据只看漏怪与联防穿透。
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
    // 对抗模式：整队同生共死 —— 池归零时该队全员淘汰（ps.lp 已按池拆分，逐个判会拆散队伍）。
    if (this.isVersus && this.teamLps) {
      for (const t of this.matchTeamIds()) {
        if ((this.teamLps.get(t) ?? 0) > 0) continue;
        for (const ps of this.order) {
          if (!ps.alive || this.teamIdOf(ps) !== t) continue;
          ps.lp = 0;
          ps.eliminate(this.round);
          this.toast(ps, 'error', '队伍的目标生命值耗尽，已被淘汰');
        }
      }
      return;
    }
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
    // 对抗模式：一队全灭即结束（只剩一队存活 ⇒ 该队胜）；两队都有人则继续。
    if (this.isVersus && this.teamLps) {
      const aliveTeams = this.matchTeamIds().filter((t) => this.order.some((p) => p.alive && this.teamIdOf(p) === t));
      if (aliveTeams.length <= 1) { this.finish({ victory: aliveTeams.length === 1, reason: 'versus' }); return; }
    }
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
