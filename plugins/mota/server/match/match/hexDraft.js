// server/match/match/hexDraft.js — Match methods: 海克斯 (Hex), a TFT-style augment draft added by this fork.
//
// Flow: MatchPhases.startRound calls hexOffer() twice — **draft 1 at round 1** (HEX_FIRST_ROUND) and **draft 2 at round 7**
// (HEX_SECOND_ROUND). Every alive player without a pick for that draft is offered HEX_OFFER_SIZE random hexes
// (ps.hexOffer, the player's own m.private only). The owner confirms one with `g.hex { hexId }` (MatchIntents) →
// hexPick() → _hexApply() grants the effect; the pick is appended to `ps.hexes` (a match has up to two picks, one per
// draft) and never reset. BOTH drafts carry HEX_REROLLS free rerolls per card (`g.hexReroll` → hexReroll, a fresh set
// that avoids the current three) — the second draft's reroll was added later (this fork, user request).
//
// Draft 2 differs from draft 1: its candidates exclude every hex this player already picked (`exclude` = `ps.hexes`),
// and (without the room's pinned grade) its grade is re-rolled by weight **per player** (the first draft's grade is
// match-wide).
//
// Both drafts live inside their round's prep like the 教鞭 personal choice (MatchSpDraft.offerBountyChoice): no phase of
// their own. PlayerPrep.setReady refuses Ready while a draft is open. In a co-op match the choice is timed
// (HEX_CHOICE_SECONDS): hexTimeout() then takes the FIRST card of the offer. Solo / single-human matches are untimed,
// like every other solo step, and fall back to the prep deadline.
//
// Offer filtering (the 盟约 rule): a hex declaring `requires.bond` is left out of the pool when that bond cannot matter
// in this match — bondLive() (a mode's static inactive list, or no chess left in the pool) or when every eligible
// operator of that bond is banned this match. A hex without `requires` (大静谧 / 经济类) is always available.
//
// 等级 (grade): a hex is 白银 / 黄金 / 炫彩 (`grade` in shared/hexes.js). hexOfferGrade() rolls ONE grade for the whole
// draft (HEX_GRADE_WEIGHTS: 三档等概率 since v0.03.3) and every card comes from that grade's pool — 黄金 / 白银 / 炫彩 never mix in one
// offer. A per-card reroll stays in the same grade (ps.hexGrade), so it cannot break that.
//
// 被动海克斯（选中的瞬间没有即时效果，由常规流程读回）:
//   keepFunds             奸商本色  PlayerRound.endPrep 不清空资金
//   incomeInterest        奸商本色  PlayerRound.startRound 的下回合利息（坎诺特时解除上限并让位给海克斯）
//   roundStartFreeRefresh DD街区    PlayerRound.startRound 每回合送免费刷新
//   refreshTicket         门票      PlayerEconomy.refresh 后按计数 / 概率送免费刷新
//   spawnMods             大静谧    MatchCombat._normalOpts 乘进每个敌人的 mods
//
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, ERR } from '../../../shared/constants.js';
import { HEXES, HEX_OFFER_SIZE, HEX_REROLLS, HEX_CHOICE_SECONDS, HEX_CHOICE_SECONDS_MULTI, HEX_GRADE, HEX_GRADE_NAME, HEX_GRADE_WEIGHTS, HEX_GRADE_RANDOM, HEX_CATEGORY, hexById, hexInterestBonus } from '../../../shared/hexes.js';
import { opsBuffMods } from '../../../shared/constants.js';
import { deriveSeed, createRng } from '../../sim/rng.js';
import { OK, fail } from './common.js';

/** Shop prices a 随机增援 draw may use, ascending. */
const REINFORCE_PRICES = [2, 3, 4];

export class MatchHexDraft {
  /**
   * Offer a hex draft. Called by MatchPhases.startRound: **draft 1 at round 1**, **draft 2 at round 7**
   * (HEX_FIRST_ROUND / HEX_SECOND_ROUND). A player who already holds that draft's pick (or whose draft is still open)
   * is left alone, so a re-entered startRound can never re-roll it. Co-op matches also arm the HEX_CHOICE_SECONDS timer.
   *
   * Draft 2 (第 7 回合的三选一):
   *   · 绝不与已经选过的任何海克斯重复（`exclude` = `ps.hexes`，候选与最终选择都被排除）
   *   · 等级按权重**重新**随机；因为「已选过」是每个玩家各自的，而池子又小，第二次是**每人各掷一次**
   *     （排除自己的已选后某个 4 张的档位可能凑不满三张 → 该档对这人不参与本次掷骰）
   *   · **不提供刷新**（`ps.hexRerolls = null` → 客户端连「换」键都不渲染）
   * @param {1|2} draft
   */
  hexOffer(draft = 1) {
    // 对局选项 · 全局设置 (this fork): `hexEnabled` 关闭时本局完全没有海克斯 —— 两次草案都直接跳过，回合照常推进
    // （预设 on：海克斯是本 fork 的核心玩法，这个开关只用来临时关掉它）。
    if (this.flags && this.flags.hexEnabled === false) return;
    // Timed by MODE, not by the human count: any co-op match shows the countdown, including a room where the player is
    // the only human (with or without AI seats). The base game's own steps use `soloUntimed` (isSolo || loneHuman)
    // instead, but a lone human in a co-op room still expects the multiplayer countdown here.
    // 联合模式时长 +10 秒（this fork 应用户要求）：HEX_CHOICE_SECONDS_MULTI = 25；独立模拟仍 15。
    const timed = !this.isSolo;
    // 房间设置 · 时长 (this fork, 仅联合模式)：房主设定的海克斯选择时长优先于官方 15/25
    const baseSec = this.hexChoiceSec > 0 ? this.hexChoiceSec : (this.isSolo ? HEX_CHOICE_SECONDS : HEX_CHOICE_SECONDS_MULTI);
    const ms = this.scaled(baseSec * 1000);
    const now = this.sched.now();
    const first = draft <= 1;
    // ONE grade per draft (云顶式): all three cards share it, 黄金 / 白银 / 炫彩 never mix in a pool. Draft 1 rolls it
    // match-wide (everyone sees the same tier); draft 2 rolls it per player (their exclusions differ).
    // 对局选项 · 海克斯等级 (this fork): 两次草案**各自独立**钉死（hexGrade1 / hexGrade2，'random' = 加权掷骰）。
    // `HEX_FORCE_OFFER` is a test seam used by tools/hex-*.mjs (unset in normal play).
    const forced = this._hexForcedOffer();
    // 三次草案各自钉死一个等阶（v0.03.3：第三槽 hexGrade3 只在三海克斯局用到）
    const pinned = draft === 1 ? this.hexGrade1 : draft === 2 ? this.hexGrade2 : this.hexGrade3;
    // 「自选海克斯」：**每人各取自己的队列**（v0.04.3：房主开启后成员也能自选；没自己队列的回落房主队列）——
    // 取队放在玩家循环里（_hexQueuedPickFor），不符合本局资格的直接跳过。
    const sharedGrade = forced ? hexById(forced[0]).grade : this.hexOfferGrade('offer', { firstDraft: first, pinned });
    let offered = false;
    // 凭证互斥 (this fork, 应用户要求)：同一次草案里，一张「{盟约}凭证」刷给了某个队友之后就不再出现在
    // 其他队友的候选里 —— 只排除**已经被刷出的那几张**，不是整个系列（池子够时每人仍可能拿到不同的凭证）。
    const credUsed = new Set();
    const isCredential = (id) => {
      const h = hexById(id);
      return !!(h && h.category === HEX_CATEGORY.REINFORCE && Array.isArray(h.tags) && h.tags.includes('凭证'));
    };
    for (const ps of this.alivePlayers()) {
      if (this.hexDraftCount(ps) >= draft) continue;                     // already picked for this draft
      if (Array.isArray(ps.hexOffer) && ps.hexOffer.length) continue;    // this draft is still open
      const exclude = [...this.hexPicks(ps), ...credUsed];
      // 盟约加权 (this fork)：把玩家与草案序号带给 hexDraw —— 非首次草案按已激活盟约/层数加权
      const opts = { firstDraft: first, exclude, pinned, player: ps, draft };
      const grade = forced ? sharedGrade
        : (first ? sharedGrade : this.hexOfferGrade(`offer:${ps.seat}`, opts));
      // 稀有度不重复 (v0.03.3, 玩家反馈已采纳)：三个等阶槽全随机时，若掷出的稀有度与这名玩家上一次相同，
      // 就顺延一个档（白银→黄金→炫彩→白银）；钉死了等阶就照钉的来，不干预。
      const noRepeat = (g) => {
        if (!this.hexGradeNoRepeat || !g || pinned !== HEX_GRADE_RANDOM) return g;
        const prev = ps.hexLastGrade || null;   // 这名玩家上一次实际拿到的稀有度（草案 1 也记在这）
        if (!prev || prev !== g) return g;
        const ring = [HEX_GRADE.SILVER, HEX_GRADE.GOLD, HEX_GRADE.PRISMATIC];
        const at = ring.indexOf(g);
        return at >= 0 ? ring[(at + 1) % ring.length] : g;
      };
      const finalGrade = noRepeat(grade);
      const queued = forced ? null : this._hexQueuedPickFor(ps, draft);
      let cards = forced ? forced.slice()
        : (finalGrade ? this.hexDraw(`offer:${ps.seat}:${draft}`, exclude, finalGrade, opts) : []);
      // 自选海克斯：优先占**第一格**（无视正常等阶），其余两张照常按本草案等阶抽；玩家依旧三选一，
      // 客户端按 ps.hexOfferPicked 把这一张高亮成「自选」（v0.03.3，用户要求）
      // 自选队列里的这一条若**本局已经拥有**（比如命运已经抽给了它），就不再塞进候选 —— 否则玩家会看到
      // 一张点不动的卡（hexPick 的 ERR.ALREADY 兜底会拒掉它）。
      const queuedOk = !!queued && !this.hexPicks(ps).includes(queued);
      if (queuedOk && !forced) {
        cards = [queued, ...cards.filter((id) => id !== queued)].slice(0, 3);
        ps.hexOfferPicked = queued;
      } else {
        ps.hexOfferPicked = null;
      }
      if (!cards.length) { this.reportError('hexOffer', new Error(`no eligible hex for seat ${ps.seat}`)); continue; }
      ps.hexGrade = finalGrade;
      ps.hexLastGrade = finalGrade || null;   // 供下一次「稀有度不重复」判定
      ps.hexOffer = cards;
      ps.hexOfferDraft = draft;
      // v0.05：本草案**出现过**的所有 id（含被刷新掉的）—— 刷新时整批排除，本次草案内不重复出现
      ps.hexSeen = cards.slice();
      // 两次草案**都**每卡 1 次免费刷新（this fork 应用户要求：第二次草案也可以单独刷新了）
      ps.hexRerolls = cards.map(() => HEX_REROLLS);
      ps.hexDeadline = timed ? now + ms : 0;
      ps.dirty();
      offered = true;
      for (const id of cards) if (isCredential(id)) credUsed.add(id);
      // an AI seat decides at once (MatchPrep.scheduleBotPrep also auto-picks, this keeps the m.public tidy meanwhile)
      if (ps.botControlled) this.hexAutoPick(ps);
    }
    if (offered && timed) {
      this.cancel(this._hexTimer);
      this._hexTimer = this.later(ms, () => this.hexTimeout());
    }
  }

  /**
   * 海克斯统计台账 (v0.03.3)：给某条海克斯记一笔（资金 / 触发次数）。只做累加，不做判断；
   * 展示交给 hexStatsView（「本局海克斯详情」弹窗与右侧悬停共用同一份文案）。
   * @param {PlayerState} ps @param {string} hexId @param {{ funds?: number, count?: number }} patch
   */
  hexStatAdd(ps, hexId, patch = {}) {
    if (!ps || typeof hexId !== 'string' || !hexId) return;
    if (!ps.hexStats || typeof ps.hexStats !== 'object') ps.hexStats = {};
    const cur = ps.hexStats[hexId] || (ps.hexStats[hexId] = { funds: 0, count: 0 });
    if (Number.isFinite(patch.funds) && patch.funds) cur.funds = (Number(cur.funds) || 0) + patch.funds;
    if (Number.isFinite(patch.count) && patch.count) cur.count = (Number(cur.count) || 0) + patch.count;
    if (Number.isFinite(patch.damage) && patch.damage) cur.damage = (Number(cur.damage) || 0) + patch.damage;
  }

  /**
   * 「本局海克斯详情」(v0.03.3, 用户要求)：本局已获得的海克斯 + 每条的实际收益统计。
   * 只列**能如实统计**的量（资金、触发次数、由台账能算出来的派生值）；没数据的条目 lines 为空（前端显示「—」）。
   * @returns {{ id: string, name: string, grade: string|null, desc: string, lines: string[] }[]}
   */
  hexStatsView(ps) {
    const kills = Number(ps && ps.stats && ps.stats.kills);
    return this.hexPicks(ps).map((id) => {
      const h = hexById(id);
      const st = (ps.hexStats && ps.hexStats[id]) || null;
      const lines = [];
      if (st && Number(st.count) > 0) lines.push(`触发 ${Math.trunc(st.count)} 次`);
      if (st && Number(st.funds) > 0) lines.push(`累计获得 ${Math.trunc(st.funds)} 资金`);
      if (st && Number(st.damage) > 0) lines.push(`累计造成 ${Math.trunc(st.damage)} 伤害`);
      // 黑手帝国：真伤加成完全由累计击杀决定（sim 里 500 × ⌊kills / 15⌋），这里可按同一口径算出来
      if (id === 'bx_siracusa_empire' && Number.isFinite(kills)) {
        const bonus = 500 * Math.floor(kills / 15);
        lines.push(bonus > 0 ? `累计击杀 ${kills} → 附加真伤 +${bonus}` : `累计击杀 ${kills}（每 15 名 +500 真伤）`);
      }
      // 王室宝库：宝箱累计的全属性提升（ps.hexAllStats）
      if (id === 'bx_victoria_treasury') {
        const pct = Math.round((Number(ps.hexAllStats) || 0) * 1000) / 10;
        if (pct > 0) lines.push(`全体干员全属性累计 +${pct}%`);
      }
      return { id, name: h ? h.name : id, grade: h ? h.grade : null, desc: h ? h.desc : '', lines };
    });
  }

  /**
   * 双盟约通用钩子 (v0.04.3)：某盟约获得 `gained` 层后，玩家持有的**双盟约海克斯**让对方盟约获得
   * `floor(gained × dualBond.sharePct)` 层（默认 25%）。
   *
   * 从 `PlayerState.addLayers` 的**所有**路径统一调用（经济/结算/战斗回写/天赋/道具），所以以后再加双盟约海克斯，
   * 只需在 shared/hexes.js 写 `dualBond: { a, b, sharePct }`，不用碰 Match / economy。
   *
   * **不会左脚踩右脚**：转移出去的层数走 `addLayers(..., { dualSkip: true })`，不再触发本钩子（单次传播）。
   * @param {import('../PlayerState.js').PlayerState} ps @param {string} bondId 获得层数的盟约
   * @param {number} gained 实际获得的层数（已被层数上限裁过）
   * @returns {number} 转移出去的总层数
   */
  hexDualBondShare(ps, bondId, gained) {
    if (!ps || !(gained > 0) || typeof bondId !== 'string') return 0;
    const ids = Array.isArray(ps.hexes) ? ps.hexes : [];
    if (!ids.length) return 0;
    let total = 0;
    for (const id of ids) {
      const hex = hexById(id);
      const d = hex && hex.dualBond;
      if (!d) continue;
      let other = null;
      if (d.a === bondId) other = d.b;
      else if (d.b === bondId) other = d.a;
      if (!other) continue;
      const share = Number(d.sharePct);
      const grant = Math.floor(gained * (Number.isFinite(share) && share > 0 ? share : 0.25));
      if (grant <= 0) continue;
      total += ps.addLayers(other, grant, { requireActive: false, reason: `dualBond:${id}`, dualSkip: true });
    }
    return total;
  }

  /** 该玩家已经选下的海克斯 id 列表（按选择顺序；含命运等奖励进来的，被动钩子与候选排除都用它）。 */
  hexPicks(ps) {
    return ps && Array.isArray(ps.hexes) ? ps.hexes : [];
  }

  /** 该玩家经草案选下的次数（0/1/2）——奖励海克斯不计入，否则会吞掉第 7 回合的草案。 */
  hexDraftCount(ps) {
    return ps && Number.isInteger(ps.hexDraftPicks) ? ps.hexDraftPicks : this.hexPicks(ps).length;
  }

  /**
   * 财团 (this fork, 盟约专属·投资人炫彩)：购买干员的资金返还比例 —— 玩家海克斯里声明 `purchaseRefund`
   * 的最大值（0 = 无）。PlayerEconomy.buy 在干员购买成功后调用。
   * @param {object} ps @param {number} price @returns {number} 返还资金（≥1 或 0）
   */
  hexPurchaseRefund(ps, price) {
    let rate = 0;
    for (const h of this.hexAllOf(ps)) {
      const r = h && Number(h.purchaseRefund);
      if (Number.isFinite(r) && r > rate) rate = r;
    }
    if (!(rate > 0) || !(price > 0)) return 0;
    return Math.max(1, Math.floor(price * Math.min(rate, 1)));
  }

  /**
   * 家族账本 (this fork, 盟约专属·叙拉古黄金)：本局累计击杀（ps.stats.kills，跨回合累积）每满 `every` 名
   * → 立即 `funds` 资金，循环。PlayerRound.startRound 调用（发放时点 = 回合开始）。
   * @param {object} ps @returns {number} 本次发放的资金（0 = 未达里程碑）
   */
  hexKillMilestone(ps) {
    const h = this.hexAllOf(ps).find((x) => x && x.killMilestone);
    if (!h) return 0;
    const every = Math.max(1, Math.trunc(Number(h.killMilestone.every) || 12));
    const funds = Math.max(0, Math.trunc(Number(h.killMilestone.funds) || 0));
    const kills = Number.isFinite(ps.stats && ps.stats.kills) ? Math.trunc(ps.stats.kills) : 0;
    const paid = Number.isInteger(ps.killMilestonePaid) ? ps.killMilestonePaid : 0;
    const due = Math.floor(kills / every) - paid;
    if (!(due > 0) || !(funds > 0)) return 0;
    ps.killMilestonePaid = paid + due;
    const got = ps.addFunds(funds * due, { reason: 'hex' });
    this.toast(ps, 'info', `${h.name} · 累计击杀 ${kills} · 获得 ${got} 资金`);
    return got;
  }

  /**
   * 「自选海克斯」(this fork, 房间选项)：房主从图鉴指定的海克斯队列（Match.hexQueue）——每次草案依次自动
   * 发放队列里的下一个，**跳过本局不可用的**（盟约没开 / firstDraftOnly 错位等），队列空了回落到随机草案。
   * 对每个存活玩家各发一份（房主的指定 = 全员的指定），走与手选完全相同的 hexPick 通道（计数 / 应用 / 广播
   * 全部一致）。@param {number} di 草案序号（0 起）——用于 firstDraftOnly 的资格判定
   * @returns {boolean} 是否发放了自定义海克斯（false = 队列空 / 全不可用，调用方回落随机草案）
   */
  /**
   * 「自选海克斯」：取本次草案（1 起）排到的那一条 id —— 从房主指定的队列里按顺序消耗，跳过本局不可用的
   * （盟约未开 / firstDraftOnly 错位等）。返回 null 表示这一草案没有自选（照常按等阶抽三选一）。
   * @param {number} draft @returns {string|null}
   */
  _hexQueuedPick(draft) {
    const queue = Array.isArray(this.hexQueue) ? this.hexQueue : [];
    while (queue.length) {
      const id = queue.shift();
      const hex = hexById(id);
      if (!hex) continue;
      if (!this.hexEligible(hex, { firstDraft: draft === 1, selfPick: true })) continue;
      return id;
    }
    return null;
  }

  /**
   * v0.04.3 每人一份的自选队列：先取这名玩家自己的（Match.hexPicksBy，房主开启自选后成员也能自选），
   * 没有自己的队列才回落房主的全局队列（旧行为）。按草案顺序消耗，跳过本局不可用的。
   * @param {import('../PlayerState.js').PlayerState} ps @param {number} draft 草案序号（1 起）
   * @returns {string|null}
   */
  _hexQueuedPickFor(ps, draft) {
    const own = ps && this.hexPicksBy && this.hexPicksBy.get ? this.hexPicksBy.get(ps.playerId) : null;
    if (Array.isArray(own) && own.length) {
      while (own.length) {
        const id = own.shift();
        const hex = hexById(id);
        if (!hex) continue;
        if (!this.hexEligible(hex, { firstDraft: draft === 1, selfPick: true })) {
          // 不再静默跳过：告诉玩家「自选为什么没出现」（例：首轮限定、模式禁用的海克斯）
          this.toast(ps, 'warn', `自选海克斯「${hex.name}」本局不可用，已跳过`);
          continue;
        }
        return id;
      }
      return null;   // 自己有队列但全不可用：不借用房主的（他的指定不属于这名玩家）
    }
    return this._hexQueuedPick(draft);
  }

  hexDebugGrantNext(di) {
    const queue = Array.isArray(this.hexQueue) ? this.hexQueue : [];
    while (queue.length) {
      const id = queue[0];
      const hex = hexById(id);
      if (!hex) { queue.shift(); continue; }
      if (!this.hexEligible(hex, { firstDraft: di === 0, selfPick: true })) {
        queue.shift();
        continue;
      }
      queue.shift();
      for (const ps of this.alivePlayers()) {
        if (this.hexDraftCount(ps) >= di + 1) continue;
        ps.hexOffer = [id];
        this.hexPick(ps, id);
      }
      return true;
    }
    return false;
  }

  /**
   * The co-op choice deadline: whoever has not picked yet takes the FIRST card of its own offer. The deadline lives
   * outside the phase deadline (this.deadline belongs to ROUND_START / PREP), so it never delays the round.
   */
  hexTimeout() {
    this._hexTimer = null;
    for (const ps of this.alivePlayers()) {
      if (!Array.isArray(ps.hexOffer) || !ps.hexOffer.length) continue;
      this.hexPick(ps, ps.hexOffer[0]);
    }
  }

  /**
   * Whether a hex may enter the offer pool in this match.
   *  - `firstDraftOnly`（奸商本色）只在**第一次**草案出现 —— 第 7 回合的第二次候选里一定没有它
   *  - 盟约规则：`requires.bond` 声明的盟约在本局不可用时排除（见文件头）
   * @param {any} hex @param {{firstDraft?: boolean}} [opts]
   */
  hexEligible(hex, { firstDraft = true, player = null, draft = 1, selfPick = false } = {}) {
    if (!hex) return false;
    if (hex.firstDraftOnly && !firstDraft) return false;
    // 盟约专属系列 (this fork, 第六轮征集)：效果钩子未实装的（pendingHook）暂不投放；**每局只能选一个** ——
    // 任何人选下一条后（hexExclusiveTaken），本局所有后续草案不再出现盟约专属（hexDraw 另限同批最多一条）。
    if (hex.pendingHook) return false;
    // 盟约专属「每局一条」是**投放**限流：自选队列（selfPick）是玩家在房间里预先指定的，不受这条约束 ——
    // 否则先选了任意一条盟约专属之后，自选里的双盟约海克斯会被静默跳过（用户反馈「自选不了」）。
    if (hex.bondExclusive && this.hexExclusiveTaken && !selfPick) return false;
    // 混沌投掷 (this fork, 赌局系列)：随机三选一整局只会出现一条（选中后 chaosRandomTaken = true）；
    // 「自选海克斯」队列（opts.selfPick）不受这条限流约束 —— 房主想指定就给。
    if (hex.chaosRoll && this.chaosRandomTaken && !selfPick) return false;
    const req = hex.requires;
    // requires.mode（我来兜底，this fork）：仅联合模式（coop）出现，独立模拟永远不可用
    if (req && req.mode === 'coop' && this.isSolo) return false;
    // 自选海克斯 (v0.05 修)：房主/成员在房间里**点名指定**的盟约专属海克斯，不再因为「该盟约本局不活跃 / 干员池空」
    // 被静默丢弃 —— 玩家已经明确要它了（用户反馈：自选「战争天梯」没生效，实际是被这里 skip 掉且没有任何提示）。
    if (selfPick && hex.bondExclusive) return true;
    // 双盟约 (v0.04.3)：requires.bonds = **两个盟约都没有被锁定**（本局都可用、都有干员池）才出现
    if (req && Array.isArray(req.bonds) && req.bonds.length) {
      for (const b of req.bonds) {
        if (!this.bondLive(b)) return false;
        if (!this.hexBondChess(b).length) return false;
      }
      return true;
    }
    if (!req || !req.bond) return true;
    if (!this.bondLive(req.bond)) return false;
    return this.hexBondChess(req.bond, req).length > 0;
  }

  /**
   * Shop-eligible operators that belong to `bond` (membership = the chess' own `bonds` list, i.e. the game's own
   * definition — 龙门 / 岁 operators count towards 炎), optionally narrowed to a shop `price`, a `rarity` (明日方舟
   * 星级) and/or a `tier` (阶 — the number the game UI actually shows, TierChip I–VI). `filter` is
   * `{ price?, rarity?, tier? }` (a bare number is read as `price`, for older callers). Chess banned this match are
   * left out. The 地区增援 hexes filter by **`tier` (5 阶)**: `rarity` is not what the player sees.
   * @param {{price?: number, rarity?: number, tier?: number}|number|null} [filter]
   * @returns {string[]} chess ids (never golden / hidden / diy — gd.visibleChess)
   */
  hexBondChess(bond, filter = null) {
    const f = typeof filter === 'number' ? { price: filter } : (filter || {});
    const wantPrice = Number.isInteger(f.price) ? f.price : null;
    const wantRarity = Number.isInteger(f.rarity) ? f.rarity : null;
    const wantTier = Number.isInteger(f.tier) ? f.tier : null;
    const banned = new Set(Array.isArray(this.bannedChess) ? this.bannedChess : []);
    const out = [];
    for (const id of this.gd.visibleChess) {
      const rec = this.gd.chess(id);
      if (!rec) continue;
      if (banned.has(this.gd.baseIdOf(id))) continue;
      if (wantPrice != null && rec.price !== wantPrice) continue;
      if (wantRarity != null && rec.rarity !== wantRarity) continue;
      if (wantTier != null && rec.tier !== wantTier) continue;
      if (Array.isArray(rec.bonds) && rec.bonds.includes(bond)) out.push(id);
    }
    return out;
  }

  /** Every hex this match may offer right now, as ids (all grades). */
  hexPool(opts = {}) {
    return HEXES.filter((h) => this.hexEligible(h, opts)).map((h) => h.id);
  }

  /**
   * Eligible ids of ONE grade — the only pool `hexDraw` / `hexDrawOne` ever draw from.
   * @param {string} grade @param {{firstDraft?: boolean, exclude?: string[]}} [opts]
   */
  hexPoolOf(grade, opts = {}) {
    const skip = new Set(Array.isArray(opts.exclude) ? opts.exclude : []);
    return HEXES.filter((h) => h.grade === grade && !skip.has(h.id) && this.hexEligible(h, opts)).map((h) => h.id);
  }

  /**
   * The grade of this draft. **黄金 / 白银 / 炫彩 never mix in one pool**: one weighted roll picks a single grade and
   * every card of the offer comes from it. Restricted to the grades that can actually fill an offer here
   * (≥ HEX_OFFER_SIZE eligible); if none can, any non-empty grade. Null only when the whole pool is empty.
   * @param {string} salt @param {{firstDraft?: boolean, exclude?: string[]}} [opts] @returns {string|null}
   */
  hexOfferGrade(salt, opts = {}) {
    const grades = Object.values(HEX_GRADE);
    const size = new Map(grades.map((g) => [g, this.hexPoolOf(g, opts).length]));
    let usable = grades.filter((g) => size.get(g) >= HEX_OFFER_SIZE);
    if (!usable.length) usable = grades.filter((g) => size.get(g) > 0);
    if (!usable.length) return null;
    // 对局选项 · 海克斯等级 (this fork): the host pinned the grade (room.setHexGrade → Match.hexGrade1/2, 'random' =
    // unset) — 两次草案各自独立。A usable pinned grade wins outright; if the pinned grade cannot fill an offer here,
    // fall through to the weighted roll so one always exists.
    const pinned = opts.pinned;
    if (pinned && pinned !== HEX_GRADE_RANDOM && usable.includes(pinned)) return pinned;
    if (usable.length === 1) return usable[0];
    const weights = usable.map((g) => Math.max(0, Number(HEX_GRADE_WEIGHTS[g]) || 0));
    const total = weights.reduce((a, b) => a + b, 0);
    if (!(total > 0)) return usable[0];
    const rng = createRng(deriveSeed(this.seed, `hex-grade:${salt}`));
    let roll = rng() * total;
    for (let i = 0; i < usable.length; i++) { roll -= weights[i]; if (roll < 0) return usable[i]; }
    return usable[usable.length - 1];
  }

  /**
   * Test seam for tools/hex-*.mjs: a test server started with `HEX_FORCE_OFFER=id1,id2,id3` pins every offer to those
   * ids, so an economy/combat hex can be exercised deterministically. Unset (or no valid id) → null and the normal
   * grade roll + draw happens — normal play never sets it.
   * @returns {string[]|null}
   */
  _hexForcedOffer() {
    const raw = typeof process !== 'undefined' && process.env ? process.env.HEX_FORCE_OFFER : '';
    const ids = String(raw || '').split(',').map((s) => s.trim()).filter((s) => !!hexById(s));
    return ids.length ? ids : null;
  }

  /**
   * Roll an offer: up to HEX_OFFER_SIZE distinct ELIGIBLE hex ids, shuffled on a stream salted with `salt`. `exclude`
   * is avoided when the pool is big enough for a fully different set — a small pool still yields an offer (that is the
   * one place the fallback belongs; a per-card reroll instead refuses, see hexDrawOne). `grade` restricts the draw to
   * one 等级 (the offer never mixes grades); pass null to draw from every grade.
   * @param {string} salt @param {string[]} [exclude] @param {string|null} [grade]
   *   @param {{firstDraft?: boolean, exclude?: string[]}} [opts] @returns {string[]}
   */
  hexDraw(salt, exclude = [], grade = null, opts = {}) {
    const o = { ...opts, exclude };
    const pool = grade ? this.hexPoolOf(grade, o) : this.hexPool(o);
    if (!pool.length) return [];
    const take = Math.min(HEX_OFFER_SIZE, pool.length);
    const skip = new Set(Array.isArray(exclude) ? exclude : []);
    const fresh = pool.filter((id) => !skip.has(id));
    const list = (fresh.length >= take ? fresh : pool).slice();
    const rng = createRng(deriveSeed(this.seed, `hex:${salt}`));
    // 盟约加权 (this fork, 第六轮征集)：**第一回合之后**的草案，「盟约系」海克斯（requires.bond 声明了盟约的）
    // 更倾向于该玩家**当前已激活**的盟约 —— 激活层数越多权重越高（1 + 层数/25，无 hard cap）。其余海克斯权重 1。
    // 加权无放回抽样：逐张按权重抽（抽中即移出池子），池子小于 take 时全出。
    const biasOn = o.player && Number(o.draft) > 1;
    const weightOf = (id) => {
      if (!biasOn) return 1;
      const h = hexById(id);
      const bond = h && h.requires && h.requires.bond;
      if (!bond) return 1;
      const st = o.player.bonds && o.player.bonds[bond];
      if (!st || !st.active) return 1;
      return 1 + (Number(o.player.layers && o.player.layers[bond]) || 0) / 25;
    };
    const picked = [];
    const bag = list.slice();
    if (biasOn) {
      while (picked.length < take && bag.length) {
        const weights = bag.map((id) => Math.max(0, weightOf(id)));
        const total = weights.reduce((a, b) => a + b, 0);
        let roll = total > 0 ? rng() * total : 0;
        let idx = bag.length - 1;
        if (total > 0) {
          for (let i = 0; i < bag.length; i++) { roll -= weights[i]; if (roll < 0) { idx = i; break; } }
        }
        picked.push(bag.splice(idx, 1)[0]);
      }
    }
    for (let i = bag.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [bag[i], bag[j]] = [bag[j], bag[i]];
    }
    const drawn = biasOn ? [...picked, ...bag].slice(0, take) : (() => {
      for (let i = list.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [list[i], list[j]] = [list[j], list[i]];
      }
      return list.slice(0, take);
    })();
    // 增援限流 (this fork, 应用户要求)：同一时间的三选一里**最多一个增援类**（category 'reinforce'）——
    // 超出的从「未入选的非增援」里补位；整个池子只有增援时保持原样（保证一定有候选优先）。
    // 盟约专属限流 (this fork, 第六轮征集)：同一时间的三选一里**最多一个盟约专属** —— 同形补位。
    const isReinforce = (id) => hexById(id)?.category === HEX_CATEGORY.REINFORCE;
    const isBondEx = (id) => hexById(id)?.bondExclusive === true;
    const isChaos = (id) => hexById(id)?.chaosRoll != null;
    const capped = (drawn2, isIt) => {
      if (drawn2.filter(isIt).length <= 1) return drawn2;
      const kept = [];
      let seen = 0;
      for (const id of drawn2) {
        if (isIt(id) && ++seen > 1) continue;
        kept.push(id);
      }
      const spare = list.filter((id) => !isIt(id) && !kept.includes(id) && !skip.has(id));
      for (const id of spare) {
        if (kept.length >= take) break;
        kept.push(id);
      }
      return kept.slice(0, take);
    };
    return capped(capped(capped(drawn, isBondEx), isReinforce), isChaos);
  }

  /**
   * One replacement id for a per-card reroll: a pool member that is NOT in `exclude` (the whole current offer), so the
   * refreshed card really changes and the three cards stay distinct. `grade` (the draft's, ps.hexGrade) keeps the
   * replacement in the same 等级 so a reroll can never mix 黄金 into a 白银 offer. Returns null when that grade has
   * nothing fresh to offer — the caller then refuses the reroll instead of consuming it for no visible change.
   * @param {string} salt @param {string[]} exclude @param {string|null} [grade]
   *   @param {{firstDraft?: boolean}} [opts] @returns {string|null}
   */
  hexDrawOne(salt, exclude = [], grade = null, opts = {}) {
    const skip = new Set(Array.isArray(exclude) ? exclude : []);
    // 增援限流 (this fork)：单卡刷新时，若刷新后三张里仍会同时有两个增援（offer 里已有一个、且被刷新的不是它），
    // 则候选排除增援类；该等级只剩增援时返回 null（调用方拒绝刷新、不扣次数，宁可限流也不违反规则）。
    const others = Array.isArray(opts.offer) ? opts.offer.filter((id) => typeof id === 'string' && !skip.has(id)) : [];
    const blockReinforce = others.some((id) => hexById(id)?.category === HEX_CATEGORY.REINFORCE);
    const blockChaos = others.some((id) => hexById(id)?.chaosRoll != null);
    const fresh = (grade ? this.hexPoolOf(grade, { ...opts, exclude }) : this.hexPool({ ...opts, exclude }))
      .filter((id) => !skip.has(id))
      .filter((id) => !blockReinforce || hexById(id)?.category !== HEX_CATEGORY.REINFORCE)
      .filter((id) => !blockChaos || hexById(id)?.chaosRoll == null);
    if (!fresh.length) return null;
    const rng = createRng(deriveSeed(this.seed, `hex:${salt}`));
    return fresh[Math.floor(rng() * fresh.length)] || null;
  }

  /**
   * g.hex { hexId }: the owner's pick of its open hex draft. Allowed from the moment the offer exists (round 1's or
   * round 7's ROUND_START) through that round's PREP, like the 教鞭 choice — the player must be able to act during the
   * 2 s ROUND_START window too. The pick is appended to `ps.hexes` (a match can offer two drafts: round 1 and round 7),
   * and every passive hook reads **all** of them.
   */
  hexPick(ps, hexId) {
    ps.hexOfferPicked = null;   // 选完即清掉「自选」高亮标记（v0.03.3）
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const offer = ps.hexOffer;
    if (!Array.isArray(offer) || !offer.length) return fail(ERR.BAD_TARGET, '当前没有待选的海克斯'); // i18n-ignore: developer error detail
    if (typeof hexId !== 'string' || !offer.includes(hexId) || !hexById(hexId)) return fail(ERR.BAD_TARGET);
    // 第二次草案的候选已经排除了已选过的，这里再兜一层：同一个海克斯不可能被选两次
    if (this.hexPicks(ps).includes(hexId)) return fail(ERR.ALREADY, '该海克斯本局已经选过'); // i18n-ignore: developer error detail
    ps.hexOffer = null;
    ps.hexOfferDraft = 0;
    ps.hexes.push(hexId);
    // 草案计数（this fork）：命运等奖励海克斯也会进 ps.hexes，草案的「已选过第 N 次」必须用独立计数，
    // 否则第 1 回合选命运 → hexes 变 2 条 → 第 7 回合的草案会被误判为已选而跳过
    ps.hexDraftPicks = (Number.isInteger(ps.hexDraftPicks) ? ps.hexDraftPicks : 0) + 1;
    // `hex` 是老字段（m.private / m.public 视图与既有测试仍读它），恒等于第一张；被动钩子一律读 `hexes` 整份数组
    ps.hex = ps.hexes[0];
    try { this._hexApply(ps, hexId); } catch (e) { this.reportError(`hex ${hexId}`, e); }
    ps.recompute();
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /**
   * g.hexReroll { slot }: one free reroll of ONE card of the open draft — that slot alone is replaced by a hex that is
   * not among the three currently listed, so the cards never repeat. Each slot has its own HEX_REROLLS budget
   * (ps.hexRerolls[slot]); a second reroll of the same card is refused.
   */
  hexReroll(ps, slot) {
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    if (ps.ready) return fail(ERR.WRONG_PHASE, 'ready');
    const offer = ps.hexOffer;
    if (!Array.isArray(offer) || !offer.length) return fail(ERR.BAD_TARGET, '当前没有待选的海克斯'); // i18n-ignore: developer error detail
    if (!Number.isInteger(slot) || slot < 0 || slot >= offer.length) return fail(ERR.BAD_TARGET);
    const left = Array.isArray(ps.hexRerolls) ? ps.hexRerolls : [];
    if (!offer.length || !left.length) return fail(ERR.ALREADY, '本次候选不可刷新'); // i18n-ignore: developer error detail
    if (!(left[slot] > 0)) return fail(ERR.ALREADY, '该选项的刷新次数已用完'); // i18n-ignore: developer error detail
    const used = Math.max(0, HEX_REROLLS - (left[slot] || 0));
    // v0.05 两条硬约束：
    //   ① 已拥有的一律不出现（用户反馈：命运抽到的海克斯还会被刷出来，且点不动 → hexPick 报「已经选过」）；
    //   ② 本次草案**已经出现过**的（含此前被刷新换掉的）不再出现 —— 刷新不再来回摇同一批。
    const seen = Array.isArray(ps.hexSeen) ? ps.hexSeen : [];
    const banned = Array.from(new Set([...offer, ...this.hexPicks(ps), ...seen]));
    const id = this.hexDrawOne(`reroll:${ps.seat}:${slot}:${used}`, banned, ps.hexGrade || null, { offer });
    if (!id) return fail(ERR.BAD_TARGET, '没有可替换的海克斯'); // i18n-ignore: developer error detail
    const next = offer.slice();
    next[slot] = id;
    ps.hexOffer = next;
    if (Array.isArray(ps.hexSeen)) { if (!ps.hexSeen.includes(id)) ps.hexSeen.push(id); } else ps.hexSeen = [...next, id];
    left[slot] = (left[slot] || 0) - 1;
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /**
   * The pick made for a player who did not make one — an AI seat, the co-op HEX_CHOICE_SECONDS deadline, or the prep
   * deadline. Per the rule, the FIRST card of the offer is taken. Nothing pending: nothing happens, no rng draw.
   */
  hexAutoPick(ps) {
    if (!ps || !Array.isArray(ps.hexOffer) || !ps.hexOffer.length) return undefined;
    return this.hexPick(ps, ps.hexOffer[0]);
  }

  /**
   * The enemy stat multipliers this player's hexes impose on its OWN normal field (MatchCombat._normalOpts multiplies
   * them into the `mods` of every spawn, so they travel to the browser inside the battle spec — no sim change needed).
   * A hex declares them in shared/hexes.js as `spawnMods`, e.g. `{ hpMul: 0.9 }` or `{ atkMul: 0.8, speedMul: 0.9 }`.
   * Keys are the ones waves.js roundMods uses: hpMul / atkMul / defMul / resMul / speedMul. hpMul must stay > 0.
   * 多张海克斯（两次草案）**相乘**叠加，例如 0.95 × 0.9 = 0.855。
   * @returns {Record<string, number>|null} null when none of the player's hexes changes anything
   */
  hexSpawnModsOf(ps) {
    const out = {};
    for (const hex of this.hexAllOf(ps)) {
      const src = hex && hex.spawnMods;
      if (!src || typeof src !== 'object') continue;
      for (const key of ['hpMul', 'atkMul', 'defMul', 'resMul', 'speedMul']) {
        const v = src[key];
        if (!Number.isFinite(v) || v < 0 || (key === 'hpMul' && v <= 0)) continue;
        out[key] = key in out ? out[key] * v : v;
      }
    }
    return Object.keys(out).length ? out : null;
  }

  /** Apply a hex's effect to its owner. Runs once, at the pick. */
  _hexApply(ps, hexId) {
    const hex = hexById(hexId);
    if (!hex) return;
    // 盟约专属 (this fork, 第六轮征集)：任何人选下一条 → 本局不再出现盟约专属（hexEligible 读）；
    // 徽章 battle:true —— 随 playerEffects 进战斗规格，战斗侧内容钩子（support.playerHexIds）据此生效。
    if (hex.bondExclusive) this.hexExclusiveTaken = true;
    // 战争天梯 (v0.05)：选下即发精英隐现 + 开启阶梯进度（弹药钩子 ps.lateranoAmmo 逐场结算）
    if (hex.id === 'bx_war_ladder') this.startWarLadder(ps);
    // 混沌投掷 (this fork, 赌局系列)：选中即按 times 投掷；带 every 的（赌神）记下下次部署阶段的投掷回合。
    // 任何人通过随机三选一拿到过一条混沌后，本局随机池不再出现混沌（hexEligible 读 chaosRandomTaken）。
    if (hex.chaosRoll) {
      this.chaosRandomTaken = true;
      const spec = hex.chaosRoll;
      if (Number(spec.every) > 0) ps.chaosNextRound = this.round + Math.max(1, Math.trunc(Number(spec.every)));
      const times = Math.max(0, Math.trunc(Number(spec.times) || 0));
      for (let i = 0; i < times; i++) this.chaosRoll(ps, hex);
      return;
    }
    // the persistent badge: an EffectRef flagged `battle: false`, so it shows in the 效果 column (ui/effectsList.js)
    // while PlayerState.battleInput drops it before the sim ever sees it (no content hook can match it)
    ps.effects.push({
      id: `hex:${hex.id}`, key: null, name: hex.name, desc: hex.desc,
      iconKind: 'hex', iconId: hex.iconId || null, battle: hex.bondExclusive === true,
    });

    // 天选系列 (v0.03.2)：在第 7 回合或之后才选中时，当场补发那张 6 阶（round 1 / 5 / 9 的草案都可能）
    const sixSpec = hex.roundStartChess;
    if (sixSpec && sixSpec.bond && Number.isFinite(Number(sixSpec.tier6Round)) && this.round >= Number(sixSpec.tier6Round)) {
      this._hexGrantTier6(ps, hex, sixSpec.bond);
    }

    // 双盟约 (v0.04.3)：一次发多名干员（默认两个盟约各 1 名 1 阶）
    const grantList = Array.isArray(hex.grants) ? hex.grants : null;
    if (grantList && grantList.length) {
      const given = [];
      for (const g of grantList) {
        if (!g || g.kind !== 'bondChess') continue;
        const id = this._hexPickChess(this.hexBondChess(g.bond, g), `grant:${ps.seat}:${hex.id}:${g.bond}`);
        if (!id) continue;
        const name = this.gd.chess(id)?.name || id;
        this._hexGive(ps, hex, id);
        given.push(name);
      }
      if (given.length) this.toast(ps, 'info', `${hex.name} · 获得 ${given.join(' + ')}`);
      return;
    }

    const grant = hex.grant;
    if (grant && grant.kind === 'bondChess') {
      // 地区增援: one random operator of the hex's bond at its star (candidates were validated by hexEligible)
      const id = this._hexPickChess(this.hexBondChess(grant.bond, grant), `grant:${ps.seat}:${hex.id}`);
      this._hexGive(ps, hex, id);
      return;
    }

    // {盟约}凭证 (this fork, grant.kind === 'credential')：发放「变形同构体 + 该盟约的联动装备」各 1 件进手牌。
    // 联动装备 = items.json 里 `giveBondId` 为该盟约、阶数最高的非进阶（_a）装备（见 shared/hexes.js 的表注）；
    // 变形同构体 = `canGiveBond: true` 的那件（判据 shared/morph.js isMorphCarrier）。两件同装时装备者即视为
    // 该盟约成员 —— 那是变形同构体自己的官方机制，这里只负责把两件装备发到位。
    if (grant && grant.kind === 'credential') {
      const items = this.gd.raw?.items || {};
      const morph = Object.values(items).find((r) => r && r.canGiveBond && !r.isGolden);
      let pair = null;
      for (const rec of Object.values(items)) {
        if (!rec || rec.canGiveBond || rec.isGolden || rec.giveBondId !== grant.bond) continue;
        if (!pair || (rec.tier || 0) > (pair.tier || 0)) pair = rec;
      }
      const given = [];
      for (const rec of [morph, pair]) {
        if (!rec) continue;
        // 手牌满时 stow 会落临时整备区（allowTemp），再满才销毁 —— acquireItem 自己会 toast，这里补一条海克斯名
        if (ps.acquireItem(rec.id, { source: 'grant' })) given.push(rec.name);
        else this.toast(ps, 'warn', `${hex.name}：「${rec.name}」未能放入（整备区已满）`);
      }
      this.toast(ps, 'info', `${hex.name} · 获得 ${given.join(' + ') || '（无）'}`);
      return;
    }

    // 天降盟约 (this fork, shopBondGift): 随机锁定一个「未激活的主要盟约」并存 ps.giftBond，并立刻投一个该盟约
    // 干员进牌库；此后每次 rollShop（手动刷新 / 回合开始）由 hexSeedGiftBond 再投一个
    if (hex.shopBondGift === true) {
      const bondId = this._hexPickGiftBond(ps);
      if (!bondId) { this.toast(ps, 'warn', `${hex.name}：当前没有可解锁的主要盟约`); return; }
      ps.giftBond = bondId;
      const bondName = this.gd.bond(bondId)?.name || bondId;
      this.toast(ps, 'info', `${hex.name} · 牌库中将出现「${bondName}」的干员`);
      const seeded = this.hexSeedGiftBond(ps);
      if (!seeded) this.toast(ps, 'warn', `${hex.name}：当前商店没有可替换的位置，下次刷新时出现`);
      return;
    }

    if (grant && grant.kind === 'funds') {
      // 命运 / 资金类：立即获得资金
      const n = Math.max(0, Math.trunc(Number(grant.gain) || 0));
      const got = ps.addFunds(n, { reason: 'hex' });
      this.toast(ps, 'info', `${hex.name} · 获得 ${got} 资金`);
      // 王室铸币 (this fork, 盟约专属·维多利亚黄金)：立即再获得 1 件维式重锤与 10 资金
      if (hex.victoriaMint) {
        const rec = typeof this.gd.bond === 'function' ? this.gd.bond('victoriaShip') : null;
        const buffs = rec && Array.isArray(rec.buffs) ? rec.buffs : [];
        const hit = buffs.find((b) => b && (b.key === 'bond_layer_added_reward_equip' || b.bbKey === 'bond_layer_added_reward_equip'));
        const pool = hit && hit.p ? hit.p.pool : null;
        const id = pool ? this.m.rollItemId({ pool }) : null;
        if (id && ps.acquireItem(id, { source: 'hex' })) this.toast(ps, 'info', `${hex.name} · 获得 维式重锤`);
      }
      // 命运 (this fork, bonusHex): 再随机获得一个同等级海克斯 —— 奖励池排除命运本身（防连环）与首轮限定
      if (hex.bonusHex) {        const owned = new Set(this.hexPicks(ps));
        owned.add(hex.id);
        const pool = this.hexPoolOf(hex.bonusHex, { exclude: [...owned] }).filter((id) => {
          const h2 = hexById(id);
          return h2 && !h2.bonusHex && !h2.firstDraftOnly;
        });
        if (pool.length) {
          const rng = createRng(deriveSeed(this.seed, `hex-fate:${ps.seat}:${this.round}:${ps.hexes.length}`));
          const id = pool[Math.floor(rng() * pool.length)];
          const h2 = hexById(id);
          ps.hexes.push(id);
          this._hexApply(ps, id); // 自己会推效果栏徽章 + 立即发放类结算
          this.toast(ps, 'info', `${hex.name} · 获得 ${h2.name}`);
        } else {
          this.toast(ps, 'warn', `${hex.name}：当前没有可获得的${HEX_GRADE_NAME[hex.bonusHex]}海克斯`);
        }
      }
      return;
    }

    if (grant && grant.kind === 'freeRefresh') {
      // 免费刷新 / + / ++: 立即获得免费刷新次数（ps.shop.freeRefreshes —— 游戏原生的免费刷新）
      const n = Math.max(0, Math.trunc(Number(grant.count) || 0));
      if (n > 0 && ps.shop) ps.shop.freeRefreshes += n;
      this.toast(ps, 'info', `${hex.name} · 获得 ${n} 次免费刷新`);
      return;
    }

    if (grant && grant.kind === 'randomBudget') {
      // 随机增援: split the budget into shop prices, then draw one distinct operator per price
      const rng = createRng(deriveSeed(this.seed, `hex-grant:${ps.seat}`));
      const taken = new Set();
      const names = [];
      let left = Number(grant.budget) || 0;
      let guard = 0;
      while (left > 0 && guard++ < 32) {
        // never leave a remainder of 1: the cheapest operator costs 2, so a leftover 1 would end the split short of
        // the budget (e.g. 3+2+2 = 7 instead of 8)
        const fits = REINFORCE_PRICES.filter((p) => p <= left && (left - p === 0 || left - p >= REINFORCE_PRICES[0]));
        if (!fits.length) break;
        const price = fits[Math.floor(rng() * fits.length)];
        left -= price;
        const candidates = this.gd.visibleChess.filter((cid) => {
          const rec = this.gd.chess(cid);
          return rec && rec.price === price && !taken.has(this.gd.baseIdOf(cid));
        });
        const id = this._hexPickChess(candidates, `rand:${ps.seat}:${taken.size}`, rng);
        if (!id) continue;
        taken.add(this.gd.baseIdOf(id));
        if (ps.acquireChess(id, { source: 'grant' })) names.push(this.gd.chess(id)?.name || id);
      }
      this.toast(ps, names.length ? 'info' : 'warn', names.length ? `随机增援 · 获得 ${names.join('、')}` : '随机增援：当前没有可用的干员');
      return;
    }

    if (Number.isFinite(hex.roundStartFreeRefresh) && hex.roundStartFreeRefresh > 0) {
      // DD街区 —— 选中的当回合本身也算一个回合，所以立刻结算一次（之后每回合由 PlayerRound.startRound 发放）。
      // 第 1 回合的 startRound 早在开选之前就跑完了，不给这一下的话玩家在第 1 回合会以为它没生效。
      const n = Math.max(0, Math.trunc(hex.roundStartFreeRefresh));
      if (n > 0 && ps.shop) ps.shop.freeRefreshes += n;
      this.toast(ps, 'info', `${hex.name} · 获得 ${n} 次免费刷新`);
      return;
    }

    // 大静谧 / 门票 / 奸商本色 在选中的那一刻都没有即时效果：它们是**被动**的，分别由
    // hexSpawnModsOf / hexOnRefresh / hexKeepsFunds + hexIncomeOf 在常规流程里读回。
  }

  // -------------------------------------------------------------------------------------------------
  // 被动海克斯的钩子 —— 由游戏的常规流程调用；玩家没选到对应海克斯时全部是零开销的 no-op
  // 一场对局有两次草案（第 1 / 第 7 回合），所以下面每一条都遍历 `ps.hexes` 整份数组：
  // 取了奸商本色又取 DD街区 时两个效果都要生效，只读第一张会漏掉第二个。
  // -------------------------------------------------------------------------------------------------

  /** 该玩家选中的海克斯记录（null = 还没选 / 已清空）。**按选择顺序**，通常 0–2 张。 */
  hexAllOf(ps) {
    if (!ps || !Array.isArray(ps.hexes)) return [];
    const out = [];
    for (const id of ps.hexes) {
      const hex = hexById(id);
      if (hex) out.push(hex);
    }
    return out;
  }

  /**
   * 该玩家选中的海克斯记录（null = 还没选 / 已清空）。返回**第一张** —— 内容层（bands/meta.js 的坎诺特让位）与
   * 视图仍在用它；需要全部请用 `hexAllOf`。
   */
  hexOf(ps) {
    const all = this.hexAllOf(ps);
    return all.length ? all[0] : null;
  }

  /** 奸商本色：回合结束不清空剩余资金（PlayerRound.endPrep）。任一张海克斯带 keepFunds 即生效。 */
  hexKeepsFunds(ps) {
    return this.hexAllOf(ps).some((h) => !!h.keepFunds);
  }

  /**
   * 回合开始时海克斯给的额外收入 —— 奸商本色的利息：每拥有 `per` 资金 → +`gain`，上限 `max`；玩家策略是
   * `uncappedBand`（坎诺特）时上限解除（此时坎诺特自带的 coin_carry_over 会让位，见 sim/content/bands/meta.js，
   * 不重复计算）。有收入时发一条 toast。
   * @returns {number} 本次加了多少资金
   */
  hexIncomeOf(ps) {
    let total = 0;
    for (const h of this.hexAllOf(ps)) {
      const spec = h && h.incomeInterest;
      if (!spec) continue;
      const bonus = hexInterestBonus(spec, ps.funds, ps.bandId);
      if (bonus > 0) {
        total += bonus;
        this.toast(ps, 'info', `${h.name} · 利息 +${bonus}`);
      }
    }
    return total;
  }

  /** DD街区：每回合开始送 N 次免费刷新（PlayerRound.startRound）。多张叠乘。 @returns {number} */
  hexRoundStartFreeRefreshes(ps) {
    let total = 0;
    for (const h of this.hexAllOf(ps)) {
      const n = h && Number.isFinite(h.roundStartFreeRefresh) ? Math.max(0, Math.trunc(h.roundStartFreeRefresh)) : 0;
      if (n > 0) total += n;
    }
    if (total > 0 && ps.shop) {
      ps.shop.freeRefreshes += total;
      ps.dirty();
    }
    return total;
  }

  /**
   * 天选系列 (this fork, `roundStartChess`): 每回合开始随机发放 1 名该盟约的干员 —— **阶数不超过当前调度中心等级**
   * （ps.shop.level；还没有商店数据 / 该等级没有可用的该盟约干员时就跳过，不静默塞人）。选中的当回合不发
   * （第 1 回合的 startRound 早在开选前就跑完了，且选中那刻已经发过 5 阶那张），所以实际从第 2 回合开始每回合一张。
   * @returns {number} 实际发放的干员数（多张天选叠着就各发各的）
   */
  hexRoundStartChess(ps) {
    let got = 0;
    for (const h of this.hexAllOf(ps)) {
      const spec = h && h.roundStartChess;
      if (!spec || !spec.bond) continue;
      // 天选系列 (v0.03.2)：第 7 回合额外发一张 **6 阶**该盟约干员（每张天选各一次；在第 7 回合或之后
      // 才选中它的，由 _hexApply 当场补发，这里负责「已经开始发的那一批」）
      const sixRound = Number(spec.tier6Round);
      if (Number.isFinite(sixRound) && sixRound > 0 && this.round >= sixRound) this._hexGrantTier6(ps, h, spec.bond);
      const level = Math.max(1, Math.min(6, Math.trunc(Number(ps.shop && ps.shop.level) || 1)));
      const candidates = this.hexBondChess(spec.bond).filter((cid) => {
        const rec = this.gd.chess(cid);
        return rec && Number(rec.tier) <= level;
      });
      const id = this._hexPickChess(candidates, `tianxuan:${ps.seat}:${this.round}:${h.id}`);
      if (!id) { this.toast(ps, 'warn', `${h.name}：调度中心 ${level} 级没有可用的「${this.gd.bond(spec.bond)?.name || spec.bond}」干员`); continue; }
      if (this._hexGive(ps, h, id) !== false) got++;
    }
    return got;
  }

  /**
   * 天选系列 (v0.03.2)：额外发放 1 名 **6 阶**该盟约干员 —— 每张天选每局一次（`ps.hexSixGiven` 记账），
   * 第 7 回合起由 hexRoundStartChess 触发；若玩家是在第 7 回合或之后才选中这张海克斯，_hexApply 当场补发。
   * @returns {boolean} 是否发出（已发过 / 该盟约没有 6 阶干员时返回 false）
   */
  _hexGrantTier6(ps, hex, bondId) {
    if (!ps || !hex || !bondId) return false;
    if (!ps.hexSixGiven || typeof ps.hexSixGiven !== 'object') ps.hexSixGiven = {};
    if (ps.hexSixGiven[hex.id]) return false;
    const id = this._hexPickChess(this.hexBondChess(bondId, { tier: 6 }), `tianxuan6:${ps.seat}:${hex.id}`);
    if (!id) { this.toast(ps, 'warn', `${hex.name}：该盟约没有可发放的 6 阶干员`); return false; }
    const ok = this._hexGive(ps, hex, id) !== false;
    if (ok) ps.hexSixGiven[hex.id] = true;
    return ok;
  }

  /**
   * 维多利亚的助力 (this fork, `roundStartItem`): 每 `every` 回合开始获得一件随机装备（阶数 ≤ 当前调度中心等级，
   * 用商店的 itemPool 抽）。无可用装备 / 整备区满时提示并跳过。 @returns {number}
   */
  hexRoundStartItem(ps) {
    let got = 0;
    for (const h of this.hexAllOf(ps)) {
      const spec = h && h.roundStartItem;
      if (!spec) continue;
      const every = Math.max(1, Math.trunc(Number(spec.every) || 3));
      if (this.round % every !== 0) continue;
      const maxTier = Math.max(1, Math.min(6, Math.trunc(Number(ps.shop && ps.shop.level) || 1)));
      const id = this.pool.rollItem(this.rngShop, maxTier, this.itemPool);
      if (!id) { this.toast(ps, 'warn', `${h.name}：没有可发放的装备`); continue; }
      if (ps.acquireItem(id, { source: 'grant' })) { got++; this.toast(ps, 'info', `${h.name} · 获得 ${this.gd.item(id)?.name || id}`); }
      else this.toast(ps, 'warn', `${h.name}：整备区已满，装备未获得`);
    }
    return got;
  }

  /**
   * 休养生息 (this fork, `frugalEnd`): 休整期结束（endPrep）时结算 —— 本回合没买过干员 → 下回合 +资金，
   * 没刷新过商店 → 下回合 +经验（调度中心升级价格 −1）。由 PlayerState.roundBoughtChess / roundRefreshed 标记。
   * @returns {{ funds: number, xp: number } | null}
   */
  hexFrugalCheck(ps) {
    let out = null;
    for (const h of this.hexAllOf(ps)) {
      const spec = h && h.frugalEnd;
      if (!spec) continue;
      const funds = !(ps.roundBoughtChess === true) ? Math.max(0, Math.trunc(Number(spec.noBuyFunds) || 0)) : 0;
      const xp = !(ps.roundRefreshed === true) ? Math.max(0, Math.trunc(Number(spec.noRefreshXp) || 0)) : 0;
      if (funds > 0 || xp > 0) out = { funds: (out?.funds || 0) + funds, xp: (out?.xp || 0) + xp };
    }
    return out;
  }

  /**
   * 勤俭持家 (this fork, `firstBuyXp`): 每回合首次购买干员时获得经验（调度中心升级价格 −1）。
   * @returns {number}
   */
  hexFirstBuyXp(ps) {
    let xp = 0;
    for (const h of this.hexAllOf(ps)) {
      const n = h && Number.isFinite(h.firstBuyXp) ? Math.max(0, Math.trunc(h.firstBuyXp)) : 0;
      if (n > 0) xp = Math.max(xp, n);
    }
    return xp;
  }

  /**
   * 核心盟约 (this fork, `coreBondChance`): 本次给 `bondId` 加层时是否触发「层数最多的激活盟约 50% 再 +1」。
   * 并列最多也算最多；触发用独立盐值的确定性随机流，不影响商店 / 波次。 @returns {number} 额外层数（0 或 1）
   */
  hexCoreBondExtra(ps, bondId, before) {
    let chance = 0;
    for (const h of this.hexAllOf(ps)) {
      const c = h && Number.isFinite(h.coreBondChance) ? Math.max(0, Math.min(1, h.coreBondChance)) : 0;
      if (c > chance) chance = c;
    }
    if (!(chance > 0)) return 0;
    let top = 0;
    for (const [id, b] of Object.entries(ps.bonds || {})) {
      if (!b || !b.active || id === bondId) continue;
      top = Math.max(top, Number(ps.layers[id]) || Number(b.layers) || 0);
    }
    if (!((Number(before) || 0) >= top)) return 0;
    const rng = createRng(deriveSeed(this.seed, `hex-core:${ps.seat}:${bondId}:${before}:${this.round}`));
    return rng() < chance ? 1 : 0;
  }

  /**
   * 碎片大厦的回忆 (this fork, `leakNuke`): 该玩家的普通战场 spec.flags.leakNuke（sim 的 leak 路径读它）。
   * @returns {{ damage: number, silence: number } | null}
   */
  hexLeakNukeOf(ps) {
    for (const h of this.hexAllOf(ps)) {
      const n = h && h.leakNuke;
      if (!n) continue;
      const silence = Number(n.silence) || 0;
      // 碎片大厦的回忆 (v0.03.2 起)：伤害 = 当前激活的最高盟约层数 × damagePerMaxLayer（层数为 0 时这一条不生效）
      const per = Number(n.damagePerMaxLayer);
      if (Number.isFinite(per) && per > 0) {
        const damage = Math.max(0, Math.round(this.hexTopActiveLayers(ps) * per));
        if (damage > 0) return { damage, silence };
        continue;
      }
      if (Number.isFinite(n.damage) && n.damage > 0) return { damage: n.damage, silence };
    }
    return null;
  }

  /** 该玩家当前**激活**盟约里的最高层数（碎片大厦的回忆 / 核心盟约等按层数取值的海克斯用）。 */
  hexTopActiveLayers(ps) {
    let top = 0;
    for (const [id, b] of Object.entries((ps && ps.bonds) || {})) {
      if (!b || !b.active) continue;
      top = Math.max(top, Number(ps.layers?.[id]) || Number(b.layers) || 0);
    }
    return top;
  }

  /**
   * 焚尽八荒 (v0.03.2, `yanBurnall.burnCdMul`): 本局敌方灼燃逼爆冷却时长倍率（0.5 = 缩短 50%）。
   * 无该海克斯时 null（spec 不带这个键，与旧行为逐字节一致）。
   * @returns {number|null}
   */
  hexBurnCdMulOf(ps) {
    for (const h of this.hexAllOf(ps)) {
      const spec = h && h.yanBurnall;
      const mul = spec && Number(spec.burnCdMul);
      if (Number.isFinite(mul) && mul >= 0 && mul < 1) return mul;
    }
    return null;
  }

  /** 我来兜底++ (v0.03.2)：加成作用于全部数值（atk/hp/def/res），unite.js 的联防 spec 读。 */
  hexUniteAllStats(ps) {
    for (const h of this.hexAllOf(ps)) {
      if (h && h.uniteAllStats === true && Number(h.uniteAtk) > 0) return true;
    }
    return false;
  }

  /**
   * 我来兜底 (this fork, `uniteAtk`): 该玩家在联防战场里干员的攻击加成（unite.js 的联防 spec 组装时读）。
   * @returns {number}
   */
  hexUniteAtkOf(ps) {
    let atk = 0;
    for (const h of this.hexAllOf(ps)) {
      const a = h && Number.isFinite(h.uniteAtk) ? Math.max(0, h.uniteAtk) : 0;
      if (a > atk) atk = a;
    }
    return atk;
  }

  /**
   * 天降盟约 (this fork)：从「本局可用的主要盟约（bondType SEASON）里玩家尚未激活的」随机挑一个作为礼物盟约。
   * @returns {string|null}
   */
  _hexPickGiftBond(ps) {
    const candidates = (this.gd.bondIds || []).filter((id) => {
      const rec = this.gd.bond(id);
      if (!rec || rec.bondType !== 'SEASON') return false;
      if (ps.bonds[id] && ps.bonds[id].active) return false;   // 未解锁 = 玩家还没激活它
      return this.bondLive(id) && this.hexBondChess(id).length > 0;
    });
    if (!candidates.length) return null;
    const rng = createRng(deriveSeed(this.seed, `hex-gift-bond:${ps.seat}:${this.round}`));
    return candidates[Math.floor(rng() * candidates.length)] || null;
  }

  /**
   * 天降盟约 (this fork)：把一个礼物盟约的干员（阶数 ≤ 当前调度中心等级、有副本）投进商店 —— 选中当刻一次，
   * 之后每次 rollShop（手动刷新 / 回合开始）再投一次。替换一个非冻结未售出的干员位（都不可用时退而替换任意干员位）。
   * @returns {boolean} 是否投放成功
   */
  hexSeedGiftBond(ps) {
    const bondId = ps && ps.giftBond;
    if (!bondId) return false;
    const level = Math.max(1, Math.min(6, Math.trunc(Number(ps.shop && ps.shop.level) || 1)));
    const candidates = this.hexBondChess(bondId).filter((cid) => {
      const rec = this.gd.chess(cid);
      return rec && Number(rec.tier) <= level;
    });
    if (!candidates.length) return false;
    const rng = createRng(deriveSeed(this.seed, `hex-gift-seed:${ps.seat}:${this.round}:${ps.stats && ps.stats.refreshes}`));
    const id = candidates[Math.floor(rng() * candidates.length)];
    const slots = ps.shop && Array.isArray(ps.shop.slots) ? ps.shop.slots : [];
    let pickFrom = slots.map((s, i) => (s && s.kind === 'chess' && !s.frozen && !s.sold ? i : -1)).filter((i) => i >= 0);
    if (!pickFrom.length) pickFrom = slots.map((s, i) => (s && s.kind === 'chess' ? i : -1)).filter((i) => i >= 0);
    if (!pickFrom.length) return false;
    const at = pickFrom[Math.floor(rng() * pickFrom.length)];
    slots[at] = { kind: 'chess', id, basePrice: this.gd.chessPrice(id), frozen: !!ps.shop.frozen, sold: false };
    ps.dirty();
    return true;
  }

  /**
   * 战斗 spec 的干员增益合成 (this fork)：房间滑条（opsBuffMods）+ 协防协议（按激活盟约数）+ 名刀的剩余对局生命加成
   * （settle.js 在触发保命时写 ps.famedHpBonus）+ 宝宝学院的分阶数据（sim 按 def.tier / def.golden 落到干员）。
   * 全部为中性值时返回 null（spec 不带 buffs，与旧行为一致）。
   * @returns {{ hpMul: number, atkMul: number, defMul: number, resMul: number, aspdFlat: number, academy?: object } | null}
   */
  hexOpsBuffsOf(ps) {
    const base = opsBuffMods(this.buffs);
    let hpMul = base ? base.hpMul : 1;
    let atkMul = base ? base.atkMul : 1;
    let defMul = base ? base.defMul : 1;
    let resMul = base ? base.resMul : 1;
    const aspdFlat = base ? base.aspdFlat : 0;
    const saved = Number(ps.famedHpBonus) || 0;
    if (saved > 0) hpMul *= 1 + saved;
    let bonds = 0;
    for (const [, b] of Object.entries(ps.bonds || {})) if (b && b.active) bonds++;
    let academy = null;
    for (const h of this.hexAllOf(ps)) {
      if (!h) continue;
      const pact = h.opsPerActiveBond;
      if (pact && bonds > 0) {
        // v0.05：协防协议已是全属性（攻/生/防/抗一起），穿透由 hexPierceOf 汇总
        atkMul *= 1 + (Number(pact.atk) || 0) * bonds;
        hpMul *= 1 + (Number(pact.hp) || 0) * bonds;
        defMul *= 1 + (Number(pact.def) || 0) * bonds;
        resMul *= 1 + (Number(pact.res) || 0) * bonds;
      }
      if (h.opsAcademy && !academy) academy = { ...h.opsAcademy };
    }
    // 王室宝库 (this fork, v0.03.2)：宝箱累计的「全属性永久提升」—— 四维一起乘（无层数时是 no-op）
    const allStats = Math.max(0, Number(ps.hexAllStats) || 0);
    if (allStats > 0) {
      const mul = 1 + allStats;
      hpMul *= mul; atkMul *= mul; defMul *= mul; resMul *= mul;
    }
    const plain = hpMul === 1 && atkMul === 1 && defMul === 1 && resMul === 1 && aspdFlat === 0;
    if (plain && !academy) return null;
    return academy ? { hpMul, atkMul, defMul, resMul, aspdFlat, academy } : { hpMul, atkMul, defMul, resMul, aspdFlat };
  }

  /**
   * 门票：每次刷新后结算（PlayerEconomy.refresh）。
   *  - `{ every: 4 }`   按**对局全局**刷新计数（ps.stats.refreshes，与游戏自身的「贾维」策略同口径）每逢整数倍 +1
   *  - `{ chance: 0.25 }` 按该次刷新的序号派生一条独立随机流判定，不打扰商店 / 波次的随机序列
   * 多张门票同时生效时逐张判定（每张各自掷一次概率骰）。
   * @returns {number} 本次送出多少次免费刷新
   */
  hexOnRefresh(ps) {
    const hexes = this.hexAllOf(ps).filter((h) => h && h.refreshTicket);
    if (!hexes.length || !ps.shop) return 0;
    const n = Number.isFinite(ps.stats && ps.stats.refreshes) ? Math.trunc(ps.stats.refreshes) : 0;
    if (n <= 0) return 0;
    let granted = 0;
    const fired = [];
    for (const h of hexes) {
      const spec = h.refreshTicket;
      const every = Number.isInteger(spec.every) && spec.every > 0 ? spec.every : 0;
      const chance = Number.isFinite(spec.chance) ? Math.max(0, Math.min(1, spec.chance)) : 0;
      let mine = 0;
      if (every && n % every === 0) mine += 1;
      if (chance > 0) {
        const rng = createRng(deriveSeed(this.seed, `hex-ticket:${ps.seat}:${n}:${h.id}`));
        if (rng() < chance) mine += 1;
      }
      if (mine > 0) { granted += mine; fired.push(h.name); }
    }
    if (granted > 0) {
      ps.shop.freeRefreshes += granted;
      ps.dirty();
      // toast 里必须带海克斯自己的名字：tools/hex-test-economy.mjs 就是按 `<名字> · 获得 N 次免费刷新` 数触发次数的
      this.toast(ps, 'info', `${fired.join('、')} · 获得 ${granted} 次免费刷新`);
    }
    return granted;
  }

  /** Grant one operator and tell the player (a full 整备区 is reported instead of failing silently). */
  _hexGive(ps, hex, chessId) {
    if (!chessId) { this.toast(ps, 'warn', `${hex.name}：当前没有可用的干员`); return; }
    const got = ps.acquireChess(chessId, { source: 'grant' });
    const name = this.gd.chess(chessId)?.name || chessId;
    if (got) this.toast(ps, 'info', `${hex.name} · 获得 ${name}`);
    else this.toast(ps, 'warn', `${hex.name}：整备区已满，${name} 未获得`);
  }

  /**
   * Pick one id out of `candidates`, preferring operators with a copy left in the shared pool; `rng` defaults to a
   * stream derived from `salt` so repeated draws of one hex differ but stay reproducible.
   * @param {string[]} candidates @param {string} salt @param {(()=>number)|null} rng @returns {string|null}
   */
  _hexPickChess(candidates, salt, rng = null) {
    if (!Array.isArray(candidates) || !candidates.length) return null;
    const r = rng || createRng(deriveSeed(this.seed, `hex-pick:${salt}`));
    const inPool = [];
    const rest = [];
    for (const cid of candidates) {
      const base = this.gd.baseIdOf(cid);
      if (!this.pool.has(base) || this.pool.left(base) > 0) inPool.push(cid);
      else rest.push(cid);
    }
    const list = inPool.length ? inPool : rest;
    return list[Math.floor(r() * list.length)] || null;
  }
}
