// server/match/match/confront.js — Match methods: the 狩猎期. Two modes share this module:
//
//   2V2 ('versus') — PHASE.CONFRONT (targets) → PHASE.PREP (placement, shared with the defense). From the drawn contest
//   round on, every ALIVE player intervenes once, against ONE opposing player:
//
//   step 1 (targets, PHASE.CONFRONT, VERSUS_CONFRONT.targetSeconds): each player names the opponent they attack. Inside a
//     team it is first come, first served — whoever submits first picks, and the teammate is given the opponent that is
//     left (A takes C, B gets D), so the two teams are paired one-to-one and every player both attacks and is attacked. The
//     step ends once every alive player holds a target (both sides — a side that finished early waits) or its window runs out.
//     规则档（业主 2026-11-04）：**只有赏金档（versusRule === 'bounty'）有这一步**；对抗档（versusRule === 'confront'）
//     没有目标选择模态 —— enterConfront 直接自动分配目标（assignConfrontTarget）并 finishConfrontTargets → 本回合 PREP
//     + 开商店。客户端因此只在 bounty 档渲染遮罩（ui/confrontOverlay.js）。
//   step 2 (monsters, 2026-11-04 单一 deadline): finishConfrontTargets opens the attackers' monster shop and enters the
//     SAME PREP the defenders prepare in (deadline = gd.prepTime(round), attackers press Ready too). Each attacker fills
//     their own VALUE BUDGET with monsters of ONE of the 6 groups, each on a gate (上路 'upper' / 下路 'lower') and all
//     inserted at one place in the wave (position: front / mid / back = 25 / 50 / 75 % of the round's monster count).
//     There is no separate placement window any more: the submissions freeze when the PREP ends (finishConfront →
//     this.confront), so nobody waits on a second clock.
//
//   同盟狩猎 (co-op, COOP_HUNT) — no phase, no submissions: the SYSTEM fills each alive player's 狩猎期 with its own
//   deployment (coopHuntPlans), using the same rhythm / budget / bounty tables (huntCfg). The prey is INSERTED into that
//   player's wave and its kills are banked at 坎诺特.
//
//   事件期 boss 格 (user 2026-10-21): on the 事件期 rounds only (match.eventRounds = E1 / E2 / R13 — the R4 / R8 / R13 of a
//   R4 start) step 2 adds ONE more slot offering the whole 机变悬赏 monster pool (data/choices.json `bountyDrafts`: every
//   drafted card's enemyKey and its adds[].enemyKey, ~81 monsters, each priced at the highest coin tier its cards give
//   it). A boss costs NO budget and counts against no maxPicks, one pick per monster per submission (sub.bosses); it is
//   placed on the TARGET's wave AFTER every other spawn and pays its killer the pool coin DIRECTLY as gold
//   (`bounty.bank: false` — economy.js addCoins), never the 坎诺特 赏金 account. [ASSUMED] bots / 托管 never use the
//   slot (botConfront stays deterministic and boss-free).
//
// After the 2V2 roster is complete the 悬赏名单 is held for VERSUS_CONFRONT.rosterMs (CONFRONT_ROSTER_MS) before COMBAT.
//
// The budget the panel shows (confrontBudget) = **the attacker's monster-funds balance** (2026-11-06 价值同源): the old
// 「wave value × the 5→15 % share (50 % on R13) × budgetMul」 round budget was a second number that disagreed with the
// money actually spendable (two different scales, neither bound by the other). The monster shop off ⇒ the old formula
// (confrontShareBudget) still runs, byte for byte.
// The groups are the OFFICIAL 特训敌人 types (特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射), NOT equal
// value buckets: the player picks a flavour (user decision 2026-10-17). A monster's cost and the wave's value are one
// unit — **the 阶位 ladder price** (MONSTER_PRICE_BY_TIER = 1 / 2 / 4 / 8 / 16 / 32, 业主 2026-11-05): a monster's tier
// comes from its base stats (monsterPool.monsterTierOf(confrontValue(rec)), the trait grades no longer price anything),
// so 「单价 = 阶梯价；波次价值 / 预算 = Σ阶梯价」 by construction (confrontValueOf).
//
// Applying: the placed monsters of an intervention land on ITS TARGET's wave only (confrontFor), replacing originals
// worth **the money the submission paid** (2026-11-06; the old `share × the wave value`), priced with confrontValueOf and
// closed to the nearest whole monsters, and inserted at the chosen position. The opponent never sees who is aiming at
// whom (m.public isolation) — the panel shows the opponents as '?'. 同盟狩猎 is the one difference: its prey REPLACES
// nothing (the wave keeps every original) and lands in the owning player's own wave (applyCoopHunt).
// Installed on Match.prototype like the other method containers.
import { sanitizeBotPickList } from './pureShares.js';
import { PHASE, ERR, GEO, VERSUS_CONFRONT, COOP_HUNT, merchantRateFor, merchantCapFor } from '../../../shared/constants.js';
import { confrontTraitGrade } from './confrontTraits.js';
import { gateOf, roundMods, previewInfo } from '../waves.js';
import { fillConfrontPicks } from './confrontFill.js';
import { Grid } from '../../sim/grid.js';
import { compileRoute } from '../../sim/ai.js';
import { MOVE_SCALE } from '../../sim/constants.js';
import { OK, fail } from './common.js';
// 怪物卡池（2026-11-03）：卡池 / 商店 / 怪物方 AI 契约。只在 `monsterShopOn` 为真时用；为假时一行都不跑。
// 2026-11-05：合法性判据从 `legalKeys`（按回合圈官方出怪）换成「卡池 + 阶位 ≤ 商店等级」（monsterShop 的 `cardBlocked`）。
import { buildMonsterPool } from '../monsterPool.js';
import { openMonsterShop, closeMonsterShop, monsterShopFrame, monsterShopReadOnlyFrame, monsterStockLeft, pushMonsterShops, monsterPriceOf, monsterFundsOf, addMonsterFundsTo, monsterPoolFor, spendMonsterFundsFrom, spendableMonsterFunds, monsterShopLevelOf, cardBlocked } from '../monsterShop.js';
// 怪物盟约（2026-11-04 业主口径）：攻方投放的怪吃自己这一回合攒出来的乘区，与 roundMods 相乘（只乘不覆盖）。
import { monsterBondMods, mergeMonsterBondMods, captureMonsterBondLeaks } from '../monsterBonds.js';
import { monsterStrategyFor } from '../monsterStrategies.js';

/**
 * 怪物方 AI 策略 hook 的安全调用（2026-11-03）：策略抛异常绝不能打断 botConfront / 收尾流程，
 * 记一次日志并返回 null = 「交回引擎既有实现」。
 * @param {any} m @param {any} strat @param {string} hook @param {any} ps
 */
function callStrategyHook(m, strat, hook, ps) {
  const fn = strat && strat[hook];
  if (typeof fn !== 'function') return null;
  try { return fn(m, ps); } catch (e) { m.reportError(`monster strategy ${hook}`, e); return null; }
}

/**
 * value(enemy, scale) — the 对抗期 STAT scoring formula: HP-primary, attack ×2, defence ×2, resistance ×15, the leader
 * (lpr > 1) HP bonus and 60 per block. FLYING enemies count as 2 blocks (the user's rule): a ground blocker cannot stop
 * them, so they are worth an extra block. `scale` is the round's hp/atk multiplier (gd.enemyScale), which makes a card's
 * value and the round's wave value comparable.
 *
 * This is the STAT half only — 2026-11-05 起它**只用来定档**（`monsterPool.js` 的 `monsterTierOf(confrontValue(rec))`
 * ⇒ 单价 = MONSTER_PRICE_BY_TIER[阶位]），不再直接出现在任何金额里（特性档位分 / 回合倍率都不再叠加，
 * 见 `confrontValueOf`）。
 * @param {any} e data/enemies.json record
 * @param {{ hpMul?: number, atkMul?: number }|null} scale
 */
/** 新价值公式的量纲除数（见 confrontValue）。 */
export const CONFRONT_VALUE_DIV = 120;

/**
 * 控怪档的目标出怪量 = 官方只数的这个比例。
 * 业主 2026-10-31：「控怪的出怪量调整为官方 1.5 倍」——旧值 1（与官方同等）实测仍偏少，因为
 * 「每种怪最多一只」把只数锁死在可选怪种数上（见 `botConfront` 的 take 与客户端 plan，已一并去掉）。
 * 赏金档不吃这个比例：它的倍率由玩家建房时选的 `versusSpeed` 决定（见 `confrontSpeedMul`）。
 */
export const CONFRONT_VOLUME_SHARE = 1.5;

export function confrontValue(e, scale = null) {
  const s = (e && e.stats) || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const hp = num(s.maxHp) * (Number.isFinite(scale && scale.hpMul) ? scale.hpMul : 1);
  const atk = num(s.atk) * (Number.isFinite(scale && scale.atkMul) ? scale.atkMul : 1);
  // 业主 2026-10-26 重定义怪物价值：权重改成与官方强度模型一致（server/match/waves.js:84-96 的 attrPower 回退式
  // atk×5 + hp×1 + def×3 + res×3），并**移除全部手工加成**（阻挡×60、远程×1.5、飞行按 2 块算、领袖 lpr 加成）。
  // 审计依据：旧公式对「机制型」怪系统性高估（频次 ×3.0 / 飞行 ×2.1 / 远程 ×1.6 / BOSS ×2.4 / 三档特性 ×1.8），
  // 对纯肉盾几乎零偏差，同强度带内现值最多差 354 倍。机制溢价现在只由特性档位分（confrontTraitStep）承担。
  const stat = hp + atk * 5 + num(s.def) * 3 + num(s.res) * 3;
  // 量纲归一（业主 2026-10-26）：÷120 后最便宜的怪落在个位数（R1 源石虫 ≈ 8），并且**一律整数**。
  // 下限 1：任何怪都不出现 0 价值。预算/只数上限/特性档位分都用同一个函数，因此自动同尺度。
  return Math.max(1, Math.round(stat / CONFRONT_VALUE_DIV));
}

/**
 * 「赏金」档沿用的**旧**价值公式（2026-10-26 之前线上那套，一字未改）：业主口径「当前线上的旧构建独立为一个赏金模式」。
 * ⚠ 2026-11-05 起**两个规则档统一按阶位阶梯价**（见 confrontValueOf），本函数不再参与单价 / 波次价值；
 * 保留导出只为旧口径对照（`confrontTraitStep` 的统计仍按档取口径）与老调用方兼容。
 * @param {any} e data/enemies.json record
 * @param {{ hpMul?: number, atkMul?: number }|null} scale
 */
export function confrontValueLegacy(e, scale = null) {
  const s = (e && e.stats) || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const hp = num(s.maxHp) * (Number.isFinite(scale && scale.hpMul) ? scale.hpMul : 1);
  const atk = num(s.atk) * (Number.isFinite(scale && scale.atkMul) ? scale.atkMul : 1);
  const blocks = e && e.isFlyEnemy ? 2 : num(s.blockCnt);
  const stat = hp + atk * 2 + num(s.def) * 2 + num(s.res) * 15 + Math.max(0, num(s.lpr) - 1) * hp * 0.6 + blocks * 60;
  const ranged = e && e.applyWay === 'RANGED' ? 1.5 : 1;
  return Math.round(stat * ranged);
}

/** The enemies normal waves really spawn: factions.json `templateSlots` + every type's `pool` / `entries`. */
export function confrontPool(factions) {
  const pool = new Set();
  for (const v of Object.values((factions && factions.templateSlots) || {})) if (typeof v === 'string') pool.add(v);
  for (const t of Object.values((factions && factions.types) || {})) {
    for (const k of t.pool || []) pool.add(k);
    for (const k of t.entries || []) pool.add(k);
  }
  return [...pool];
}

/**
 * The 狩猎期 groups are the OFFICIAL 特训敌人 types (data/factions.json `types`), one group per type in the data's own
 * order — the player picks a FLAVOR (隐匿 / 折射 / 飞行 …), never a strength (user decision 2026-10-17; the groups are
 * deliberately NOT equal-valued any more — the type sizes differ: 特异 35 enemies, 频次 10).
 *
 * An enemy may be offered by SEVERAL types when the data lists it in both (宿主士兵 is 特异 AND 隐匿) — it then shows
 * up in each of them. These template-slot enemies carry NO type in the data at all, so they are hand-assigned
 * (CONFRONT_GROUP_EXTRA) to keep the promise that every pool enemy is offered somewhere (test/match/versus.test.js).
 *
 * @param {object} factions data/factions.json
 * @param {(key: string) => { key: string, name: string, value: number }} rowOf
 * @returns {Array<{ id: string, name: string, icon: string|null, desc: string, rows: object[] }>}
 */
export function confrontTypeGroups(factions, rowOf, extra = CONFRONT_GROUP_EXTRA) {
  const types = (factions && factions.types) || {};
  const inPool = new Set(confrontPool(factions));
  const out = [];
  for (const [id, t] of Object.entries(types)) {
    const keys = new Set([...(t.pool || []), ...(t.entries || []), ...(extra[id] || [])]);
    const rows = [...keys].filter((k) => inPool.has(k)).map((k) => rowOf(k))
      .sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
    out.push({ id, name: t.name || id, icon: t.icon || null, desc: t.desc || '', rows });
  }
  return out;
}

/**
 * The template-slot enemies the official type lists leave out (they are a wave's guaranteed spawns, not 特训): assigned
 * by mechanic — 灵幛 hits everything around it (特异), 暴鸰 is a flying bomber (飞行), 枯朽前锋 / 孽罪奇美拉 spread
 * 源石污染 (持续).
 */
const CONFRONT_GROUP_EXTRA = Object.freeze({
  SPECIAL: ['enemy_1427_lrnazg'],
  FLY: ['enemy_1040_bombd'],
  DOT: ['enemy_1422_lrsldr', 'enemy_1425_lrcmra'],
});

/**
 * The 事件期 boss 格's monster pool and prices (user 2026-10-21): every monster the 机变悬赏 card pool can put on a card —
 * each card of choices.json `bountyDrafts` (initial / boss / hunter) contributes its `enemyKey` AND its `adds[].enemyKey`
 * (~81 monsters today). A monster's coin is the HIGHEST tier it ever appears at across ALL the cards (adds included):
 * eight monsters are priced at several tiers (e.g. 2 / 1 / 3) and pay the top one.
 * @param {object} choices gd.choices (data/choices.json, the same source server/match/choices.js reads)
 * @returns {Map<string, number>} enemyKey → its highest coin tier (0 when no card prices it)
 */
export function confrontBossCoins(choices) {
  const cards = Array.isArray(choices && choices.cards && choices.cards.bounty) ? choices.cards.bounty : [];
  const byId = new Map(cards.map((c) => [c.effectId, c]));
  const drafts = (choices && choices.bountyDrafts) || {};
  const pool = new Set();
  for (const kind of ['initial', 'boss', 'hunter']) {
    for (const g of (drafts[kind] && drafts[kind].groups) || []) {
      for (const id of g.cards || []) {
        const c = byId.get(id);
        if (!c) continue;
        if (c.enemyKey) pool.add(c.enemyKey);
        for (const a of c.adds || []) if (a.enemyKey) pool.add(a.enemyKey);
      }
    }
  }
  const out = new Map([...pool].map((k) => [k, 0]));
  const note = (key, coin) => {
    if (!out.has(key)) return;
    const n = Math.trunc(Number(coin) || 0);
    if (n > out.get(key)) out.set(key, n);
  };
  for (const c of cards) {
    note(c.enemyKey, c.coin);
    for (const a of c.adds || []) note(a.enemyKey, a.coin);
  }
  return out;
}

export class MatchConfront {
  /**
   * The 狩猎期 rule table of THIS match: the 2V2 table, or 同盟狩猎's (COOP_HUNT) in a co-op room. Both carry the same
   * HUNT_RHYTHM; reading through here is what lets the budget / bounty / merchant code serve both modes without a copy.
   */
  huntCfg() { return this.isVersus ? VERSUS_CONFRONT : COOP_HUNT; }

  /** The 对抗期 role window: from round 1 on, every normal (non-boss) round (攻守每回合互换). */
  confrontActiveAt(r) {
    return this.isVersus && r >= 1 && r < this.gd.bossRound;
  }
  confrontActive() { return this.confrontActiveAt(this.round); }

  /** 本回合的投放方：设置了攻防角色时只有攻方；未设置时退回全体（旧的对称行为，仅兼容路径）。 */
  confrontActors() { return this.attackingTeam == null ? this.alivePlayers() : this.attackers(); }

  /**
   * 同盟狩猎 (COOP_HUNT): the co-op room's system-run 狩猎期 — from the drawn start round on, on normal (non-boss)
   * rounds. R14/R15 are the unchanged boss rounds, so they never carry a hunt.
   */
  coopHuntActive() {
    return !this.isVersus && this.coopHuntOn && this.contestStartRound != null
      && this.round >= this.contestStartRound && this.round < this.gd.bossRound;
  }

  /** A 狩猎期 of either kind (2V2's 对抗期 or the co-op hunt) — used by the shared merchant / event gates. */
  /** 狩猎期（商人/事件）仍从抽到的 contestStartRound 起；攻防角色则从第 1 回合起。 */
  huntActive() { return this.isVersus ? (this.contestStartRound != null && this.round >= this.contestStartRound && this.round < this.gd.bossRound) : this.coopHuntActive(); }

  /**
   * 同盟狩猎 本回合投放公示 (user 2026-10-17): after PREP ends — every seat ready or its deadline — the round holds for
   * CONFRONT_ROSTER_MS (5 s, the same constant as the 2V2 悬赏名单) before COMBAT, showing every player what the system
   * deployed at them. The phase stays PREP, `confrontStage = 'roster'` and `coopRoster` publishes m.public.confront.
   *
   * Server-timed through setDeadline → later → scaled (virtual time and goldens agree). Idempotent: while the roster is
   * open this returns false and never arms a second timer, so two engine calls (all-ready + deadline, or two hunt rounds
   * back to back) cannot stack the hold. A non-hunt round / R14 / R15 never opens it.
   * @returns {boolean} whether a roster hold was opened now
   */
  enterCoopHuntRoster() {
    if (this.phase !== PHASE.PREP || this.confrontStage === 'roster' || !this.coopHuntActive()) return false;
    const ms = Math.max(0, Number(this.huntCfg().rosterMs) || 0);
    if (!(ms > 0)) return false;
    this.confrontStage = 'roster';
    this.coopRoster = true;
    this.setDeadline(ms / 1000, () => this.finishCoopHuntRoster());
    this.markPublic();
    return true;
  }

  /** The coop 投放公示's hold expired: clear it and start the round's battles. */
  finishCoopHuntRoster() {
    if (this.phase !== PHASE.PREP || this.confrontStage !== 'roster' || !this.coopRoster) return;
    this.setDeadline(0);
    this.confrontStage = null;
    this.coopRoster = false;
    this.startCombat();
  }

  /**
   * The public plans of the coop 投放公示: ONE row per alive player, public information only — the assigned official
   * 特训敌人 category / its name, the deployment's total value, its monster count and the picks (name + priced value).
   * Never the budget, the gates / positions or the internal bounty coins.
   * @returns {Array<{ playerId: string, seat: number, category: string|null, categoryName: string, value: number, count: number, picks: Array<{ name: string, value: number }> }>}
   */
  coopHuntRosterPlans() {
    const plans = this.coopHuntPlans();
    if (!plans) return [];
    const groups = new Map(this.confrontGroups().map((g) => [g.id, g]));
    const out = [];
    for (const ps of this.alivePlayers().slice().sort((a, b) => a.seat - b.seat)) {
      const p = plans.get(ps.playerId);
      if (!p) continue;
      const g = groups.get(p.category);
      out.push({
        playerId: ps.playerId,
        seat: ps.seat,
        category: p.category,
        categoryName: g ? g.name : (p.category || ''),
        value: p.value,
        count: p.count,
        picks: p.picks.map((x) => {
          const e = this.gd.enemy(x.enemyKey);
          return { name: e ? e.name : x.enemyKey, value: this.confrontValueOf(x.enemyKey) };
        }),
      });
    }
    return out;
  }

  /**
   * The share of the opponent's original wave a team may replace (and the share of its value it may spend) this round:
   * 5 % at R_contest, +2 %/round, capped at 15 % (VERSUS_CONFRONT.ratioBase / Step / Max). R13 is the 最终狩猎 (hunt) round
   * — a flat 50 %, the one round the intervention can gut a wave.
   */
  confrontRatio() {
    const cfg = this.huntCfg();
    if (this.round === cfg.huntRound) return cfg.huntRatio;
    const r = this.round; // 攻防从第 1 回合起：R1 = base，之后每回合 +step
    return Math.min(cfg.ratioMax, cfg.ratioBase + cfg.ratioStep * (r - 1));
  }

  /** Whether THIS round is the 最终狩猎 (R13) — the one with the flat, much larger share and the fixed 25 bounty. */
  confrontHunt() { return this.round === this.huntCfg().huntRound; }

  /** The round's hp/atk scaling: spawn mods / replacement value stay in its unit (NOT the card price any more —
   *  2026-11-05 起单价只由阶位决定，见 confrontValueOf). */
  confrontScale() { return this.gd.enemyScale(this.round); }

  /**
   * The absolute 特性 (trait) score of ONE grade step, in this round's currency: the graded part is
   * `step × (grade − 1)`, and `step` is calibrated so the graded part is exactly `VERSUS_CONFRONT.traitShare`
   * (30 %) of the whole value table — Σ(step·(g−1)) = share/(1−share) · Σ(stat value) over the confront pool
   * (confrontTraits.js holds the grades). Recomputed when the round's scaling moves the stat values.
   *
   * ⚠ 2026-11-05 起**不再参与定价**：`confrontValueOf` / 波次价值 / 预算全部改成阶位阶梯价（MONSTER_PRICE_BY_TIER），
   * 特性档位分不再叠加进任何金额。保留这个方法只为旧的统计口径与对照（没有调用方，别在新代码里用）。
   */
  confrontTraitStep() {
    const scale = this.confrontScale();
    const sig = `${this.round}|${scale.hpMul}|${scale.atkMul}`;
    if (this._traitStep != null && this._traitStepSig === sig) return this._traitStep;
    const en = (this.data && this.data.enemies) || {};
    const scores = this.huntCfg().traitStepScores;
    const share = Math.max(0, Math.min(0.9, Number(this.huntCfg().traitShare) || 0));
    let stat = 0;
    let steps = 0;
    const times = this.confrontTimesKeys();
    for (const k of confrontPool(this.data && this.data.factions)) {
      if (!en[k]) continue;
      // the same stat half confrontValueOf prices: 频次怪's manual 1.5× (user 2026-10-21) is part of the table's base
      // 特性档位分按**本档的口径**标定：赏金档沿用旧价值（含频次 ×1.5），对抗档用新定义
      stat += Math.round(this.isConfrontRule()
        ? confrontValue(en[k], scale)
        : confrontValueLegacy(en[k], scale) * (times.has(k) ? 1.5 : 1));
      steps += scores[confrontTraitGrade(k) - 1] || 0;
    }
    this._traitStep = steps > 0 ? Math.round((share / (1 - share)) * stat / steps) : 0;
    this._traitStepSig = sig;
    return this._traitStep;
  }

  /**
   * The price of ONE enemy in this match's currency: **its 阶位 ladder price** (`MONSTER_PRICE_BY_TIER`:
   * 1 / 2 / 4 / 8 / 16 / 32, via monsterShop.monsterPriceOf). Every money value the 狩猎期 uses — the group rows,
   * the wave total (`confrontWaveValue`), a submission's cost and the replacement share (`applyConfront`) — goes
   * through here, so 「单价 = 阶梯价 / 波次价值 = Σ阶梯价」 are one number.
   *
   * 业主 2026-11-05：「怪物价值最低为 1，等比换算价值，别整这么多数字（包括赏金模式）」——
   * 单价**只由阶位决定**（阶位 = `monsterTierOf(confrontValue(rec))`，基础属性口径，见 monsterPool.js），
   * 所以这里既**不吃**回合倍率 `scale`，也**不再**叠加特性档位分 / 旧价值（赏金档与对抗档同价）。
   * `scale` 参数保留只为调用方的老签名（波次 spawn 的 mods 仍会传进来），已不影响结果。
   * @param {string} enemyKey
   * @param {{ hpMul?: number, atkMul?: number }|null} _scale 已忽略（保留签名兼容）
   */
  confrontValueOf(enemyKey, _scale = null) {
    return monsterPriceOf(this, enemyKey);
  }

  /** The 频次怪 (TIMES) type's monster keys (pool + entries), cached — 旧价值公式（赏金档 ×1.5）与
   *  `confrontTraitStep` 的统计口径仍按它取；2026-11-05 起**不参与**单价（单价只由阶位决定）。 */
  confrontTimesKeys() {
    if (!this._confrontTimesKeys) {
      const types = (this.data && this.data.factions && this.data.factions.types) || {};
      const times = types.TIMES || {};
      this._confrontTimesKeys = new Set([...(times.pool || []), ...(times.entries || [])]);
    }
    return this._confrontTimesKeys;
  }

  /**
   * The four 特训敌人 types shown this round (same for both teams): two UP types + two normal, all distinct. The draw is
   * seeded per round (rngConfrontTypes) and cached, so opening the panel / a reconnect shows the same four cards.
   * `all` / `budget` let the draw guarantee that at least one offered type has a monster the round's budget can afford;
   * an empty/unplayable board would otherwise be possible from a four-type subset.
   * @param {Array<{ id: string, rows: Array<{ value: number }> }>} [all]
   * @param {number} [budget]
   * @returns {{ round: number, ids: string[], up: Set<string> }}
   */
  confrontTypeDraw(all = [], budget = null) {
    const round = this.round;
    if (this._confrontTypeDraw && this._confrontTypeDraw.round === round) return this._confrontTypeDraw;
    const ids = all.length ? all.map((g) => g.id) : Object.keys((this.data && this.data.factions && this.data.factions.types) || {});
    const pool = ids.slice();
    const up = [];
    for (let i = 0; i < 2 && pool.length; i++) {
      const k = Math.floor(this.rngConfrontTypes() * pool.length);
      up.push(pool.splice(Math.max(0, Math.min(pool.length - 1, k)), 1)[0]);
    }
    const normal = [];
    for (let i = 0; i < 2 && pool.length; i++) {
      const k = Math.floor(this.rngConfrontTypes() * pool.length);
      normal.push(pool.splice(Math.max(0, Math.min(pool.length - 1, k)), 1)[0]);
    }
    let picked = [...up, ...normal];
    // a four-type draw must still let every seat place at least one monster within this round's value budget
    const b = Number(budget);
    const selected = new Set(picked);
    if (Number.isFinite(b) && b > 0 && !all.some((g) => selected.has(g.id) && (g.rows || []).some((r) => Number(r.value) <= b))) {
      const alt = all.filter((g) => !selected.has(g.id) && (g.rows || []).some((r) => Number(r.value) <= b))
        .sort((x, y) => Math.min(...x.rows.map((r) => Number(r.value) || Infinity)) - Math.min(...y.rows.map((r) => Number(r.value) || Infinity)))[0];
      if (alt) {
        const slot = picked.findIndex((id) => !up.includes(id));
        if (slot >= 0) picked[slot] = alt.id;
      }
    }
    for (let i = picked.length - 1; i > 0; i--) {
      const j = Math.floor(this.rngConfrontTypes() * (i + 1));
      [picked[i], picked[j]] = [picked[j], picked[i]];
    }
    this._confrontTypeDraw = { round, ids: picked, up: new Set(up) };
    return this._confrontTypeDraw;
  }

  /**
   * The groups offered in the 狩猎期: four of the official 特训敌人 types (two UP + two normal, drawn once per round),
   * each carrying its pool members priced in this round's currency (confrontValueOf). Recomputed when the round changes.
   *
   * 对抗（业主 2026-10-26）：池子**按回合卡住** —— 只给本局第 1..N 回合真正出过的怪（confrontSeenKeys），
   * 官方哪个回合有哪些怪，攻方就只能选到那个回合为止。协同狩猎不走这条（COOP_HUNT 的猎物池不变）。
   * @returns {Array<{ id: string, name: string, icon: string|null, desc: string, up: boolean, rows: Array<{ key: string, name: string, value: number }> }>}
   */
  confrontGroups() {
    const scale = this.confrontScale();
    const sig = `${this.round}|${scale.hpMul}|${scale.atkMul}`;
    if (this._confrontGroups && this._confrontSig === sig) return this._confrontGroups;
    const en = (this.data && this.data.enemies) || {};
    // 没有历史记录（老对局 / 第 1 回合还没建波）时退回全池，避免面板突然空掉
    const seenSet = this.isConfrontRule() ? this.confrontSeenKeys() : null;
    const seen = seenSet && seenSet.size ? seenSet : null;
    const all = confrontTypeGroups(this.data && this.data.factions, (k) => ({
      key: k, name: (en[k] && en[k].name) || k, value: this.confrontValueOf(k, scale),
    })).map((g) => (seen ? { ...g, rows: g.rows.filter((r) => seen.has(r.key)) } : g))
      .filter((g) => !seen || (g.rows || []).length > 0);
    // 业主 2026-10-26：官方出过的怪里，有一部分不属于任何「特训类型」池（模板直给的保证怪，如 slime）。
    // 按「出过什么就能选什么」的规则它们不该消失 —— 单独收进一个「本局已出场」组，池子因此恰好等于见过的集合。
    if (seen) {
      const grouped = new Set();
      for (const g of all) for (const r of g.rows || []) grouped.add(r.key);
      const rest = [...seen].filter((k) => en[k] && !grouped.has(k))
        .map((k) => ({ key: k, name: en[k].name || k, value: this.confrontValueOf(k, scale) }))
        .sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
      if (rest.length) all.push({ id: 'SEEN', name: '本局已出场', icon: null, desc: '', up: false, rows: rest });
    }
    const byId = new Map(all.map((g) => [g.id, g]));
    // 最终狩猎 (R13) keeps the original 7-type panel; the 4-card draw (2 UP + 2 normal) is for the earlier hunt rounds.
    if (this.confrontHunt()) {
      this._confrontGroups = all.map((g) => ({ ...g, up: false }));
    } else {
      const draw = this.confrontTypeDraw(all, this.huntDeployBudget());
      this._confrontGroups = draw.ids.map((id) => byId.get(id)).filter(Boolean)
        .map((g) => ({ ...g, up: draw.up.has(g.id) }));
    }
    this._confrontSig = sig;
    return this._confrontGroups;
  }

  /**
   * The 事件期 boss 格 is open THIS round (user 2026-10-21): the boss slot exists only on the event rounds
   * (match.eventRounds = E1 / E2 / R13 — the R4 / R8 / R13 of a R4 start), so the rounds in between never offer it and a
   * `bosses` list on such a round is refused. [ASSUMED] the submission carries the same gate as the panel.
   */
  confrontBossOpen() {
    return this.isVersus && Array.isArray(this.eventRounds) && this.eventRounds.includes(this.round);
  }

  /**
   * How many bosses ONE submission may name this round (user 2026-10-21, after playtest): the cap is the EVENT's own
   * ordinal — 1 boss on the round of the 1st event, 2 on the 2nd, 3 on the 3rd (R4 / R8 / R13 of a R4 start). Zero on
   * every round the slot does not exist on. The panel greys the rest out at the cap and the server refuses more
   * (ERR.CONFRONT_COUNT), so "不限数量" from the first draft is gone.
   */
  confrontBossCap() {
    if (!this.confrontBossOpen() || !Array.isArray(this.eventRounds)) return 0;
    return Math.max(0, this.eventRounds.indexOf(this.round) + 1);
  }

  /**
   * The boss 格's pool (confrontBossCoins), named through gd.enemy: every 机变悬赏 monster, at its highest coin tier.
   * Data, not round state — computed once and cached, sorted by key so the panel order is stable.
   * @returns {Array<{ key: string, name: string, coin: number }>}
   */
  confrontBossPool() {
    if (this._confrontBossPool) return this._confrontBossPool;
    const coins = confrontBossCoins(this.gd.choices);
    this._confrontBossPool = [...coins.entries()]
      .map(([key, coin]) => ({ key, name: (this.gd.enemy(key) && this.gd.enemy(key).name) || key, coin }))
      .sort((a, b) => String(a.key).localeCompare(String(b.key)));
    return this._confrontBossPool;
  }

  /** The coins ONE boss pays its killer in gold when it dies (its pool's highest tier; 0 outside the pool). */
  confrontBossCoin(enemyKey) {
    if (!this._confrontBossCoins) this._confrontBossCoins = new Map(this.confrontBossPool().map((r) => [r.key, r.coin]));
    return this._confrontBossCoins.get(enemyKey) || 0;
  }

  /** The round's original wave spawns (every team faces the same synced one). */
  _confrontWaveSpawns() { return (this.wave && this.wave.spawns) || []; }

  /**
   * 记下某一回合真正生成的出怪 key（对抗的「按回合可选池」用它）。
   * 由 phases.js 在 `this.wave = buildNormalWave(...)` 之后调用；占位槽替换后的 key 已经是最终怪。
   * @param {number} round @param {{ spawns?: Array<{ enemyKey?: string }> } | null} wave
   */
  confrontRecordWave(round, wave) {
    if (!this._confrontWaveHistory) this._confrontWaveHistory = new Map();
    const set = new Set();
    for (const s of (wave && wave.spawns) || []) if (s && typeof s.enemyKey === 'string' && s.enemyKey) set.add(s.enemyKey);
    const r = Math.floor(Number(round) || 0);
    if (r > 0) this._confrontWaveHistory.set(r, set);
  }

  /** 本局第 1..N 回合真正出过的怪（对抗狩猎池的回合闸门；N = 当前回合）。 */
  confrontSeenKeys() {
    const out = new Set();
    for (const [r, set] of (this._confrontWaveHistory || new Map())) {
      if (r <= this.round) for (const k of set) out.add(k);
    }
    return out;
  }

  /**
   * 纯玩家出怪（业主 2026-10-26）：对抗里只要本回合有攻方真的投放了，守方面对的波次就**只有**投放的怪 ——
   * 官方波次不再生成，但仍保留为「预算基准 + 可选池参考」（confrontWaveValue / confrontSeenKeys 照旧跑）。
   * 没人投放时保持官方波次（否则会出现「空波次白送一回合」）。
   */
  confrontPurePlacement() {
    // 只有「对抗」档才纯玩家出怪；「赏金」档（缺省）保持线上那套：官方波次 + 替换份额
    return this.isConfrontRule() && !!this.confrontSubs && this.confrontSubs.size > 0;
  }

  /** 「对抗」档（业主 2026-10-26）：完全由玩家控制出怪。「赏金」档（缺省）= 当前线上那套。 */
  isConfrontRule() { return this.isVersus && this.versusRule === 'confront'; }

  /**
   * 投放窗口（2026-11-04 单一 deadline）：攻守回合的 PREP —— 目标选择已经结束（`confrontStage == null`），
   * 且不在投放公示（`'roster'`）里。`g.confront` / AI 的 botConfront / 怪物商店都用它当阶段闸门。
   */
  confrontWindowOpen() {
    return this.phase === PHASE.PREP && this.confrontStage == null && typeof this.isRoleRound === 'function' && this.isRoleRound();
  }

  /**
   * 怪物卡池是否开着（业主 2026-11-03：对抗局默认全开，`opts.monsterShop === false` 关掉回到旧平铺面板）。
   * 关掉时 enterConfront 之后的卡池分支（finishConfrontTargets 的开张 / botConfront / finishConfront 的收尾）全部不执行
   * —— 行为与改造前逐字节一致。
   */
  get monsterShopOn() {
    // 回收盟约快照（2026-11-04 复验修复 3）：settle() 在发完攻方奖励、清 `this.fields`（settle.js:238）之前会读
    // 这个 getter（settle.js:112）—— 漏怪快照只能在这之前钉住。shared 模式的奖励已经走 addMonsterFundsTo 捕获，
    // 但 solo 模式走 PlayerState.addMonsterFunds（不经 monsterShop），所以在唯一的公共入口补一次：
    // `captureMonsterBondLeaks` 幂等、fields 为空即 no-op、不读本 getter（不会自递归）。
    captureMonsterBondLeaks(this);
    return this.isVersus && this.opts?.monsterShop !== false;
  }


  /**
   * 怪物模式的归属口径（业主 2026-11-04 / 2026-11-06，经房间选项 `opts.monsterMode` 透传；Match.js 不改）：
   *   · `'shared'`（缺省）：**共有出怪** —— 同队共用一个出怪池，且同队攻方共用同一个目标（对面遇到的怪由怪物方一起出）；
   *   · `'solo'`：**单人怪物模式** —— 池按人、且只有该队第一位存活攻方持有投放权（其余攻方的商店不开）；
   *   · `'master'`：**单人掌握怪物** —— 整队仍是攻方、**资源全队级**（池 / 资金 / 商店等级 / 盟约与 shared 同口径），
   *     但只有该队第一位存活攻方持有投放权（其余攻方收到一帧只读商店，客户端显示「队长操作中」）。
   * 三值的归一化在房间层（server/lobby.js、versus-room/versusLobby.js）与客户端下拉里各做一次，别的值一律回 'shared'。
   */
  get monsterMode() {
    const v = this.opts?.monsterMode;
    return v === 'solo' || v === 'master' ? v : 'shared';
  }

  /**
   * 这名玩家是否有投放权（solo / master 怪物模式：每队只交给**第一位存活攻方**；shared：全体攻方都有）。
   * 座位顺序 = `this.order`（attackers() / _aliveOf() 都按它过滤，见 infra.js）。
   * monsterShop.js 的所有开张 / 购买 / 投放闸门都问这一个判定（避免两份「第一位」实现漂移）。
   * @param {object} ps
   * @returns {boolean}
   */
  monsterPlaceActor(ps) {
    if (!ps || ps.alive === false || ps.left === true) return false;
    if (this.monsterMode === 'shared') return true;
    if (this.attackingTeam != null && typeof this.teamIdOf === 'function' && this.teamIdOf(ps) !== this.attackingTeam) return false;
    const team = typeof this.teamIdOf === 'function' ? this.teamIdOf(ps) : 0;
    const first = this.confrontActors().find((p) => p && (typeof this.teamIdOf !== 'function' || this.teamIdOf(p) === team));
    return !!first && first.playerId === ps.playerId;
  }

  /** 攻方人数（纯玩家出怪时按人均分官方波次价值；取不到时按每队人数兜底）。 */
  attackingTeamSize() {
    if (this.attackingTeam == null || typeof this.teamIdOf !== 'function') return Math.max(1, Number(this.teamSize) || 1);
    const n = this.alivePlayers().filter((p) => this.teamIdOf(p) === this.attackingTeam).length;
    return Math.max(1, n);
  }

  /** 这一回合的预算**至少要能放下几只**本回合的中位怪（随回合增长：R1-3 → 2，R4-6 → 3，R7-9 → 4 …）。 */
  confrontMinUnits() { return 2 + Math.floor(Math.max(0, this.round - 1) / 3); }

  /**
   * 一次提交最多放几只。
   *
   * 业主 2026-10-30 口径：**按价值算，不设只数上限**。此前（2026-10-26）这里用「本回合官方只数」封顶，
   * 早期回合官方只数小（R1 只有 6 只），玩家看到的就是「本回合最多只能放 4 只」——与「预算是价值预算」
   * 自相矛盾。现在只留协议的硬上限（maxPicks，防一次误提交塞爆消息），真正的约束是 Σ价值 ≤ 预算；
   * 出怪节奏由波次的时段（官方 time/interval）决定，见 `_confrontInsertTime`。
   */
  confrontPlaceCap() {
    return this.huntCfg().maxPicks;
  }

  /**
   * 只数下限（业主 2026-10-27；注释 2026-11-06 纠偏 —— 此前写的「0.9 × 波次价值 ÷ 攻方人数」与代码相反）。
   *
   * 为什么需要它：预算与**只数目标**是两回事。单只价值跨度极大（实测本局 8 ~ 1113，约 140 倍），
   * 同一笔预算买最便宜的能放一百多只、买中位的只放 2 只 —— 只数目标完全没有保证。
   * 审计实测（旧口径）：R1 官方 6 只、预算 45、中位单价 21 ⇒ 每名攻方只能放 2 只，两个攻方合计 4 只。
   *
   * 这里返回的是**预算下限** = 中位单价 × max(2, ceil(官方只数 × 1.5))（`CONFRONT_VOLUME_SHARE`，赏金档 ×1）：
   * 保证「按中位价买得下 1.5 倍官方只数」的那笔钱一定够；想放更贵的怪就自然少放几只，
   * 价值上限仍由调用方那条 base 约束（取 max，不封顶）。
   */
  confrontCountFloor() {
    // 控怪档：官方只数 × CONFRONT_VOLUME_SHARE（业主 2026-10-31 定为 1.5 倍）；
    // 赏金档：官方只数 × 1（那一档的倍率是玩家选的 versusSpeed，不叠在这里）。
    const share = this.isConfrontRule() ? CONFRONT_VOLUME_SHARE : 1;
    const need = Math.max(2, Math.ceil(this.confrontWaveCount() * share));
    const median = this.confrontPoolMedianValue();
    return Math.round(median * need);
  }

  /** 本回合可选池（第 1..N 回合出过的怪）的**单价中位数**（= 阶梯价中位；业主 2026-11-05 起与卡价同源）——
   *  预算下限的基准，按回合缓存。 */
  confrontPoolMedianValue() {    if (this._confrontPoolMedian != null && this._confrontPoolMedianRound === this.round) return this._confrontPoolMedian;
    const en = (this.data && this.data.enemies) || {};
    const vals = [...this.confrontSeenKeys()].filter((k) => en[k]).map((k) => this.confrontValueOf(k)).sort((a, b) => a - b);
    this._confrontPoolMedian = vals.length ? vals[Math.floor(vals.length / 2)] : 0;
    this._confrontPoolMedianRound = this.round;
    return this._confrontPoolMedian;
  }

  /**
   * The value of the round's original wave = **Σ 阶位阶梯价 × 只数**（业主 2026-11-05：波次价值与单价同源）。
   * 单价走 `confrontValueOf`（= monsterShop.monsterPriceOf，只由阶位决定），所以这里的 `s.mods` 本回合倍率
   * **不再影响**金额（传进去只为签名一致，见 confrontValueOf）。
   */
  confrontWaveValue() {
    const scale = this.confrontScale();
    let v = 0;
    for (const s of this._confrontWaveSpawns()) {
      const cnt = Math.max(1, Math.floor(Number(s.count) || 1));
      v += this.confrontValueOf(s.enemyKey, s.mods || scale) * cnt;
    }
    return v;
  }

  /** The round's monster count (Σ counts) — the base of the insertion positions (25 / 50 / 75 %). */
  confrontWaveCount() {
    return this._confrontWaveSpawns().reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
  }

  /**
   * 本回合的「全队军费总额 G」—— 怪物商店**升级价**的基准（业主 2026-11-04「参考卫戍协议干员商店」）。
   * = `confrontWaveValue() × CONFRONT_VOLUME_SHARE`：与 grantMonsterFunds 同源（每人军费 = G ÷ 攻方人数，
   * 全队合计恰好 = G），**不在这里另算一遍公式**。monsterShop.js 的 monsterUpgradePriceOf 从这里取 G。
   * @returns {number} >= 0
   */
  monsterUpgradeFundsG() {
    return Math.max(0, Math.round((Number(this.confrontWaveValue()) || 0) * CONFRONT_VOLUME_SHARE));
  }

  /**
   * 每名攻方本回合的**军费份额** = `round(官方波次价值 × CONFRONT_VOLUME_SHARE ÷ 攻方人数)`。
   *
   * 这就是 `grantMonsterFunds` 每人发的那一份（本方法的唯一调用方之一），也是 `monsterShop.js` 里
   * **bot 只能花自己那一份**的上限（2026-11-05 真机 2V2：同队 1 人类 + 1 AI 共用队级账户，AI 开窗瞬间
   * 把队资金花到 0，人类看到「怪物资金 0」三张卡全买不起）。公式只在这里定义一次，发放与上限共用，
   * 不要在别处另算一遍（否则两处会漂移）。
   * @returns {number} >= 0
   */
  monsterFundsSharePerAttacker() {
    return Math.max(0, Math.round((Number(this.confrontWaveValue()) || 0) * CONFRONT_VOLUME_SHARE / this.attackingTeamSize()));
  }

  /**
   * 面板上那个「剩余价值 / 剩余投放预算」= **真正能花的钱**（2026-11-06 价值同源）。
   *
   * 旧口径是「波次价值 × 份额 × budgetMul（+ 只数下限）」的**回合预算**，与 `monsterShop.funds`（账户余额）是两个数
   * （口径不同、数量级也不同：面板上的钱不是余额，余额也不受面板约束，玩家看到「买得起」却提交不了、或反之）。
   * 现在：
   *   · 商店开着（`monsterShopOn`）⇒ 直接读**怪物资金账户**（`monsterFundsOf`，与 confrontPurchaseLimit 同源）；
   *     `ps` 缺省时取「面板席位」= 第一个非 bot 存活攻方（没有人类就取第一位）—— 人类读数不受 bot 份额封顶，
   *     与他自己 monsterShopFrame 的 `budget` 恒等；shared / master 是队级账户，同队两人读到同一个数。
   *   · 商店关着 / 一个攻方都没有 ⇒ 旧公式原样保留（`confrontShareBudget`，行为逐字节不变）。
   * @param {object} [ps] 指定席位（不传 = 面板席位）
   * @returns {number}
   */
  confrontBudget(ps = null) {
    if (this.monsterShopOn) {
      const seat = ps || this.confrontPanelSeat();
      if (seat) return Math.max(0, Number(monsterFundsOf(this, seat)) || 0);
    }
    return this.confrontShareBudget();
  }

  /** 面板读数的默认席位：第一个非 bot 存活攻方（没有人类就取第一位攻方；一个都没有 → null）。 */
  confrontPanelSeat() {
    const actors = typeof this.confrontActors === 'function' ? this.confrontActors() : null;
    if (!Array.isArray(actors) || !actors.length) return null;
    return actors.find((p) => p && !p.botControlled) || actors[0] || null;
  }

  /**
   * 旧的回合预算（波次价值 × 份额 × budgetMul，再抬到只数下限）。**商店关着**的旧对局仍走这一条；
   * 商店开着时面板 / 提交都不再用它（见 confrontBudget / confrontPurchaseLimit）。
   *
   * 对抗的 base = 「官方波次价值 × 1.5 ÷ 攻方人数」，下限取两者较大（① 至少放得下 N 只中位怪；② 只数下限
   * 「按中位价买得下 1.5× 官方只数」）。2026-11-01 P1（审计 D1）：**不再**依赖 `confrontPurePlacement()`
   * （它看「是否已有人提交」，草稿也计入）—— 否则同回合预算可跳 7.5 倍。
   */
  confrontShareBudget() {
    const byShare = Math.round(this.confrontWaveValue() * this.confrontRatio() * this.huntCfg().budgetMul);
    // 只数下限（2026-10-27）：按中位价买得下「官方同等只数」。赏金档以前不加下限，R1 只够买 1 只（官方 5 只）。
    const countFloor = this.confrontCountFloor();
    // 「赏金」档：份额预算与只数下限取大
    if (!this.isConfrontRule()) return Math.max(byShare, countFloor);
    // 「对抗」档：攻方就是这一波怪的全部来源，每名攻方分到「官方波次价值 × 1.5 ÷ 攻方人数」。
    const base = Math.round((this.confrontWaveValue() * CONFRONT_VOLUME_SHARE) / this.attackingTeamSize());
    const floor = Math.max(
      Math.round(this.confrontPoolMedianValue() * this.confrontMinUnits()),
      countFloor,
    );
    return Math.max(base, floor);
  }

  /**
   * 发本回合的**怪物军费**（业主 2026-11-04 裁决：攻方有独立的怪物资金账户，跨回合结转）。
   *
   * 金额 = `round(官方波次价值 × CONFRONT_VOLUME_SHARE ÷ 攻方人数)`，**对每个攻方各发一份** ——
   * 两人合计 = 1.5 × 波次价值。**「1.5 倍出怪量」现在就由这笔军费保证**（业主 2026-11-05：库存份数改按官方
   * 干员商店 poolCopies 等比换算，见 monsterPool.js 的 MONSTER_COPIES_BY_TIER；份数不再跟着官方只数走，
   * 库存也不再是 1.5× 的约束）。
   * 账户（业主 2026-11-04 裁决 2）：shared 模式下这 N 份都进**同一个队级账户**（`m.teamMonsterFunds`，
   * 见 monsterShop.js 的 addMonsterFundsTo），全队总军费仍是 1.5 × 波次价值；solo 各自进 `ps.monsterFunds`。
   * 发放点 = `finishConfrontTargets`（目标选择刚结束：攻方名单 / 人数 / 本回合波次都已确定）。
   * 只在 `monsterShopOn && isRoleRound()` 时发；调用方本来就套在这道闸门里，这里再判一次是为了防止
   * 将来有人在别的阶段调它（`opts.monsterShop === false` ⇒ 一行都不跑，账户恒 0）。
   * @returns {number} 每人拿到的军费（没发 → 0）
   */
  grantMonsterFunds() {
    if (!this.monsterShopOn || typeof this.isRoleRound !== 'function' || this.isRoleRound() !== true) return 0;
    // 每人一份 = `monsterFundsSharePerAttacker()`（单点定义：bot 的自有份额上限读的是同一个方法，
    // 见 monsterShop.js 的 monsterOwnShare —— 发放与上限必须同源，否则「够不够花」会和「发了多少」漂移）。
    const amount = this.monsterFundsSharePerAttacker();
    for (const ps of this.confrontActors()) {
      if (!ps) continue;
      // 帧上的「本回合军费 / 本回合奖励」每回合重置一次（奖励在 settle 里累加）
      ps.monsterGrant = amount;
      ps.monsterEarned = 0;
      // 账户走访问器（业主 2026-11-04 裁决 2）：shared → 同队一份队级账户（每人各发一份 = 全队拿到
      // 「波次价值 × 1.5」，也就是本回合「1.5 倍出怪量」的资金保证）；solo → 各人自己的 ps.monsterFunds。
      addMonsterFundsTo(this, ps, amount);
    }
    return amount;
  }

  /**
   * What ONE seat can spend this round in the current mode — the budget the type-draw's affordability floor must use.
   * 2V2 spends `confrontBudget()` = 怪物资金账户余额（2026-11-06 价值同源；商店关着时回落旧的回合预算）；
   * 同盟狩猎 inserts its prey, so a seat only gets `wave value × share` (coopHuntPlans). Using the 2V2 number for
   * co-op would let an unplayable 4-type draw through.
   */
  huntDeployBudget() {
    if (this.isVersus) return this.confrontBudget();
    return Math.round(this.confrontWaveValue() * this.confrontRatio());
  }

  /**
   * Σ value of a set of picks, at this round's scaling.
   * **必须与卡面同源**（业主 2026-11-04）：单价一律走 `monsterShop.js` 的 `monsterPriceOf`（含全局系数
   * `MONSTER_PRICE_FACTOR`），不在这里另算一遍 confrontValueOf —— 否则「预算 / 卡价 / 提交校验」会不同尺度。
   * `monsterPriceOf` 内部就是 `confrontValueOf(key)`（缺省 scale = 本回合），所以量纲与旧实现一致。
   */
  confrontSpent(picks) {
    let v = 0;
    for (const p of picks || []) v += monsterPriceOf(this, p && p.enemyKey);
    return v;
  }

  /**
   * 一份投放最多能花多少（2026-11-04 复验修复 1）：**只按攻方的怪物资金余额**。
   *
   * 旧的「余额 + 草稿价」把草稿里已经付过款的卡再加回额度，等于给同一笔钱发了两遍额度
   * （复验实测：空草稿直接提交 5 只、价值 160 → 成功，余额 168 不变、池库存不变 —— `g.confront` 是免费通道）。
   * 现在提交侧只对**尚未付款**的部分收钱（`_confrontChargeFor`：草稿里的同 key 条数先抵扣），
   * 所以额度不再需要加回草稿价；「已买的草稿 + 提交」也不会被自己的付款卡住（那部分 cost = 0）。
   * 商店关着 / 取不到账户（老对局 / 没有怪物账户的席位）⇒ 回落到旧的回合预算，行为逐字节不变。
   * @param {object} ps
   * @returns {number}
   */
  confrontPurchaseLimit(ps) {
    if (!this.monsterShopOn || !ps) return this.confrontBudget();
    // 取不到账户（老对局 / 没有怪物账户的席位）⇒ 回落到旧的回合预算，行为逐字节不变。
    // shared / master 读的是队级账户（恒为数字），不需要这道兜底；只有 solo 是个人账户（可能缺字段）。
    if (this.monsterMode === 'solo' && !Number.isFinite(Number(ps.monsterFunds))) return this.confrontBudget();
    // 账户读数走 monsterFundsOf（业主 2026-11-04 裁决 2）：shared = 队级账户余额（同队两人同额），solo = 个人账户。
    return Math.max(0, Number(monsterFundsOf(this, ps)) || 0);
  }

  /**
   * 一次提交里**哪些 pick 还没付过钱**（2026-11-04 复验修复 1）：先抵扣两边已经付过款的额度 ——
   *   ① 草稿（`ps.monsterDraft.picks`）里的同 key 条数：那些卡在 `buyMonster` / `placeMonster` 时就已经扣过款、
   *      也从同一个池 `take` 过份数（见 monsterShop.js）；
   *   ② 本回合**已经为提交付过款**的同 key 条数（`this._confrontPaid`）：草稿可以反复覆盖（`commit` 之前），
   *      同一笔付款绝不能收第二遍（复验要求 b）。
   * 抵扣按 key 逐条消耗，与顺序无关（草稿 3 条 + 提交 5 条 ⇒ 只对多出来的 2 条收费）。
   * @param {object} ps @param {Array<{ enemyKey: string }>} picks
   * @returns {{ charge: object[], cost: number }} charge = 需要付款的 pick；cost = 它们的 Σ 单价（monsterPriceOf 同源）
   */
  _confrontChargeFor(ps, picks) {
    const credit = new Map();
    const add = (key, n) => { if (typeof key === 'string' && key) credit.set(key, (credit.get(key) || 0) + n); };
    const draft = ps && ps.monsterDraft && Array.isArray(ps.monsterDraft.picks) ? ps.monsterDraft.picks : [];
    for (const d of draft) if (d && typeof d.enemyKey === 'string') add(d.enemyKey, 1);
    const pid = ps && ps.playerId;
    const ledger = this._confrontPaid instanceof Map && pid != null ? this._confrontPaid.get(pid) : null;
    if (ledger instanceof Map) for (const [key, n] of ledger) if (n > 0) add(key, n);
    const charge = [];
    let cost = 0;
    for (const p of Array.isArray(picks) ? picks : []) {
      if (!p || typeof p.enemyKey !== 'string') continue;
      const left = credit.get(p.enemyKey) || 0;
      if (left > 0) { credit.set(p.enemyKey, left - 1); continue; }
      charge.push(p);
      cost += monsterPriceOf(this, p.enemyKey);
    }
    return { charge, cost };
  }

  /**
   * 结算一次提交的未付款部分（2026-11-04 复验修复 1）：**先算后扣、全有或全无**。
   *   ① 库存预检（逐 key 合计需求 vs 池里剩余）→ 不足直接 SOLD_OUT，不动钱也不动库存；
   *   ② 份额闸门（只有 bot：超「自己那一份 − 已花」→ CONFRONT_BUDGET，一分不扣）+ 扣款
   *      （`spendMonsterFundsFrom`，余额不够也一分不扣）→ 失败 CONFRONT_BUDGET；
   *   ③ 扣库存；理论上预检已过，仍防御性回滚（把钱与已取的库存一起还回去）后再 SOLD_OUT。
   * @param {object} ps @param {{ charge: object[], cost: number }} settle `_confrontChargeFor` 的结果
   * @returns {null|{ error: string }} null = 已付清（或无需付款）
   */
  _confrontPayPicks(ps, { charge, cost }) {
    const list = Array.isArray(charge) ? charge : [];
    if (!list.length) return null;
    const pool = monsterPoolFor(this, ps);
    const demand = new Map();
    for (const p of list) demand.set(p.enemyKey, (demand.get(p.enemyKey) || 0) + 1);
    for (const [key, n] of demand) if (pool.left(key) < n) return { error: ERR.SOLD_OUT };
    // 共享军费留份（2026-11-05）：与 monsterShop.js 的 `payMonsterFunds` **同一口径** —— 份额闸门在扣款之前，
    // 超了不碰队账户、也不碰库存（上面的库存预检是只读的）。判据单点在 monsterShop.js 的 `spendableMonsterFunds`
    // （人类 / solo / 全 AI 队在那里恒等于账户余额），这里不复制公式。
    const ownCost = Math.max(0, Number(cost) || 0);
    const ownPrev = ps && ps.botControlled ? Math.max(0, Number(ps.monsterSpentOwn) || 0) : 0;
    if (cost > 0 && ps && ps.botControlled && cost > spendableMonsterFunds(this, ps)) return { error: ERR.CONFRONT_BUDGET };
    if (cost > 0 && !spendMonsterFundsFrom(this, ps, cost)) return { error: ERR.CONFRONT_BUDGET };
    // bot 的「已花自己那一份」记账（与 payMonsterFunds 同口径，初始视为 0）—— 下面回滚时同步减回去，
    // 否则这一笔会把份额永久占住（同 monsterShop.js 的 `refundMonsterFunds`）。
    if (ps && ps.botControlled && ownCost > 0) ps.monsterSpentOwn = ownPrev + ownCost;
    const taken = [];
    for (const [key, n] of demand) {
      const got = pool.take(key, n);
      taken.push([key, got]);
      if (got < n) {
        for (const [k, g] of taken) if (g > 0) pool.give(k, g);
        if (cost > 0) addMonsterFundsTo(this, ps, cost);
        if (ps && ps.botControlled && ownCost > 0) ps.monsterSpentOwn = ownPrev;
        return { error: ERR.SOLD_OUT };
      }
    }
    // 记账（2026-11-04 复验修复 1 / 复验要求 b）：这次付过款的 pick 记进本回合的提交台账 ——
    // 草稿可以在 `commit` 之前反复覆盖，同一笔付款不能收第二遍（`_confrontChargeFor` 会先抵扣它）。
    const pid = ps && ps.playerId;
    if (pid != null) {
      if (!(this._confrontPaid instanceof Map)) this._confrontPaid = new Map();
      const prev = this._confrontPaid.get(pid);
      const next = new Map(prev instanceof Map ? prev : []);
      for (const p of list) next.set(p.enemyKey, (next.get(p.enemyKey) || 0) + 1);
      this._confrontPaid.set(pid, next);
    }
    return null;
  }

  /**
   * bot 的投放预算（2026-11-04 复验修复 1 / 2026-11-06 价值同源）：
   * 商店开着时 = min(**账户可花额**, 账户余额 + 草稿里已付过款的价值)。
   * 2026-11-06 起 `confrontBudget(ps)` 本身就是账户余额口径（与面板 / 提交同源），所以这里实际等于
   * `spendableMonsterFunds + 草稿已付` —— bot 只能派自己付得起的怪（`_confrontPayPicks` 会拒），
   * 否则赏金档 bot 会整单落空。
   * 共享军费留份（2026-11-05）：bot 在 shared 里看到的是「自己那一份 − 已花」
   * （`spendableMonsterFunds`，与 monsterShop.js 同一单点定义）；solo / master / 全 AI 队下它恒等于账户余额。
   * @param {object} ps @returns {number}
   */
  confrontBotBudget(ps) {
    if (!this.monsterShopOn) return this.confrontBudget(ps);
    const draft = ps && ps.monsterDraft && Array.isArray(ps.monsterDraft.picks) ? ps.monsterDraft.picks : [];
    const funds = Math.max(0, Number(spendableMonsterFunds(this, ps)) || 0);
    return Math.min(this.confrontBudget(ps), funds + this.confrontSpent(draft));
  }

  /**
   * This bounty phase's 1-based index in the match — the "第几次狩猎期" of the rule below, independent of which round
   * (R4 / R5 / R6) the competition started in. Same counter confrontRatio uses.
   */
  confrontHuntIndex() {
    if (this.contestStartRound == null) return 0;
    return Math.max(0, this.round - this.contestStartRound + 1);
  }

  /**
   * The FIXED bounty of this bounty phase, or null when the phase runs the live formula:
   *   * the R13 最终狩猎: VERSUS_CONFRONT.finalHuntBounty (25), scaled by the kill ratio;
   *   * the 1st–4th phase: VERSUS_CONFRONT.bountyCaps = [1, 1, 2, 2];
   *   * from the 5th on (R13 aside): the live formula — `Σ value(killed) / wave value × the round's income ×
   *     killIncomeShare`, no cap, no per-monster floor.
   */
  confrontFixedBountyCap() {
    if (this.confrontHunt()) return this.huntCfg().finalHuntBounty;
    const caps = this.huntCfg().bountyCaps;
    const i = this.confrontHuntIndex();
    return i >= 1 && i <= caps.length ? caps[i - 1] : null;
  }

  /**
   * What a whole placement has paid once its first `killed` monsters (in insertion order) are down — always an integer:
   *   fixed phases:  floor(cap × killed / total),  cap = bountyCaps[huntIdx − 1] or finalHuntBounty on R13
   *   live phases:   floor(Σ value of those monsters / wave value × the round's income × killIncomeShare)
   * Full clear = cap (fixed) / the whole formula value (live), all leaked = 0; a single cheap monster out of many pays
   * its share, i.e. 0 unless it completes a whole coin — no `min 1` anywhere (that floor was the farm).
   * @param {number} killed
   * @param {object[]} picks the placement, in insertion order
   */
  confrontBountyAt(killed, picks) {
    // 业主 2026-10-30「对抗里面的赏金清除」：对抗模式（两档都算）不再发赏金 —— 这里是唯一真源，
    // 置 0 之后 views 下发的 coins、挂到投放怪身上的 bounty、坎诺特提现全部归零。
    // 协同狩猎走的是另一条路径（applyCoopHunt），不受影响。
    if (this.isVersus) return 0;
    const list = picks || [];
    const n = list.length;
    if (!n) return 0;
    const k = Math.max(0, Math.min(n, Math.floor(Number(killed) || 0)));
    const cap = this.confrontFixedBountyCap();
    if (cap != null) return Math.floor((cap * k) / n);
    const wave = Math.max(1, this.confrontWaveValue());
    const income = Number(this.gd.income(this.round)) || 0;
    const cfgShare = Number(this.huntCfg().killIncomeShare) > 0 ? Number(this.huntCfg().killIncomeShare) : 1;
    let v = 0;
    for (let i = 0; i < k; i++) v += this.confrontValueOf(list[i] && list[i].enemyKey);
    // Ceiling: one round's income. The formula pays for the VALUE a team threw, and a placement is meant to be a share of
    // the receiver's wave — but `picks` here is the receiver's WHOLE batch, so a stack (N attackers on one player) would
    // otherwise pay N × the single-placement rate. One round's income is the natural ceiling: a team cannot earn more
    // from throwing monsters at somebody than a round of income pays, and the fixed phases already cap at 1/1/2/2 / 25.
    return Math.min(Math.floor((v / wave) * income * cfgShare), Math.floor(income * cfgShare));
  }

  /**
   * What ONE placement pays, monster by monster: `coins[i] = B(i) − B(i−1)` (B = confrontBountyAt). Each kill adds its
   * fractional share to the accumulator, and gold is paid only when the integer part grows — a monster may pay 0 — so
   * the running total is exactly B(killed) and the sum of the array is exactly B(total): no per-kill rounding drift and
   * no way to farm: sending 64 of the cheapest monsters still totals B(64).
   * @param {object[]} picks
   * @returns {number[]} coins, one per pick (same order)
   */
  confrontBountyPlan(picks) {
    const list = picks || [];
    const n = list.length;
    const out = [];
    for (let i = 1; i <= n; i++) out.push(this.confrontBountyAt(i, list) - this.confrontBountyAt(i - 1, list));
    return out;
  }

  /**
   * The bounty ONE monster of a placement can pay its killer: the listed monsters are inserted one by one, so a
   * single-monster placement is a full clear and pays B(1). Kept as the per-monster lookup the value-table tests use;
   * the SHOWN total of a placement is `confrontBountyOf` below.
   * @param {string} enemyKey
   */
  confrontBounty(enemyKey) { return this.confrontBountyOf([{ enemyKey, gate: 'lower' }]); }

  /**
   * The bounty a whole placement pays when every monster of it dies — what the 悬赏名单 shows next to the pair
   * ("赏金 +N"), and the exact total the sim credits (see confrontBountyPlan for the per-kill split).
   */
  confrontBountyOf(picks) {
    const list = picks || [];
    return this.confrontBountyAt(list.length, list);
  }

  /**
   * 同盟狩猎 (COOP_HUNT): the system's 狩猎期 deployment — ONE plan PER ALIVE PLAYER (user addendum 2026-10-17: co-op is
   * four separate waves, so each player gets their own prey, not one shared batch). Built once when the round's wave is
   * generated (MatchPhases.startRound) and cached for the round.
   *
   * Algorithm (greedy, seeded → fully reproducible):
   *   1. budget = this round's ratio × the player's wave value (co-op prey is INSERTED, so the net addition is exactly
   *      the ratio; 2V2 keeps the ×budgetMul because its placement REPLACES originals, which keeps the same net ratio);
   *      the co-op wave is shared, so the number is the same for everybody, but it is computed per player and stored per
   *      plan;
   *   2. the candidate pool is the official 特训敌人 types (confrontGroups: 特异 / 飞行 / 频次 / 元素 / 持续 / 隐匿 / 折射);
   *   3. the alive players (seat order) are rotated onto the types from a seeded offset, so their MAIN types differ while
   *      the types last (4 players / 7 types → four different types);
   *   4. each player fills from their own type, value-descending: take a monster while it fits, up to maxPicks (this
   *      leaves the budget as full as that type allows);
   *   5. totals must be PAIRWISE DISTINCT. On a collision the later player changes ONE pick — the closest affordable
   *      substitute in their own type, else in the other types, else adds / removes the cheapest pick — until the total
   *      is unique. A full re-fill from another type is the last resort. A player always keeps at least one pick when the
   *      budget can afford one;
   *   6. dead / departed players are not part of the distribution: the rotation and the plans cover the ALIVE seats only,
   *      so their slot passes to the next living player.
   *
   * The bounty is priced HERE, at deployment time (`confrontBountyPlan`), and stored on the plan: the per-kill coins a
   * battle later credits never move when an event card / 强力属性 changes the monster's stats (2V2's rule).
   * @returns {Map<string, object>|null} playerId → plan
   *   Each plan carries `value` = the deployment's total VALUE (well below the budget; the pairwise-distinct rule is
   *   about THIS field) and `count` = how many monsters it holds (1–maxPicks; NOT a total value). `picks` is the list,
   *   `coins` the per-kill banked bounty priced at deployment time.
   */
  coopHuntPlans() {
    if (!this.coopHuntActive()) return null;
    if (this._coopHuntRound === this.round && this._coopHuntPlans) return this._coopHuntPlans;
    const cfg = this.huntCfg();
    const ratio = this.confrontRatio();
    const waveValue = this.confrontWaveValue();
    const groups = this.confrontGroups().filter((g) => g && Array.isArray(g.rows) && g.rows.length);
    const alive = this.alivePlayers().slice().sort((a, b) => a.seat - b.seat);
    // seeded rotation of the MAIN type: four alive players land on four different types (the drawn 4-type panel)
    const offset = groups.length ? Math.floor(this.rngCoopHunt() * groups.length) % groups.length : 0;
    const used = new Set();
    const plans = new Map();
    alive.forEach((ps, i) => {
      const budget = Math.round(waveValue * ratio);
      const gi = groups.length ? (offset + i) % groups.length : 0;
      const group = groups[gi] || null;
      let picks = group ? this._coopFill(group.rows, budget, cfg.maxPicks) : [];
      if (!picks.length) picks = this._coopFill(this._coopUnionRows(groups), budget, cfg.maxPicks);
      let value = this.confrontSpent(picks);
      if (used.has(value)) {
        const alt = this._coopUniquePicks(picks, group, groups, budget, used, cfg.maxPicks);
        if (alt) { picks = alt.picks; value = alt.value; }
      }
      used.add(value);
      const positions = cfg.positions;
      const position = positions[Math.max(0, Math.min(positions.length - 1, Math.floor(this.rngCoopHunt() * positions.length)))];
      plans.set(ps.playerId, {
        round: this.round, playerId: ps.playerId, seat: ps.seat, budget, ratio, value,
        /** the MAIN official 特训敌人 type this seat was assigned (its picks normally all come from it) */
        category: group ? group.id : null, group: gi + 1,
        picks, coins: this.confrontBountyPlan(picks), position,
        /** number of monsters deployed (the total VALUE is `value`) */
        count: picks.length,
      });
    });
    this._coopHuntRound = this.round;
    this._coopHuntPlans = plans;
    return plans;
  }

  /** ONE alive player's system deployment of this round (null when the round has no hunt / they have no plan). */
  coopHuntPlan(ps) {
    const plans = this.coopHuntPlans();
    return plans && ps ? (plans.get(ps.playerId) || null) : null;
  }

  /** The union of every type's rows, de-duplicated by key (a monster may be listed under several types). */
  _coopUnionRows(groups) {
    const seen = new Set();
    const out = [];
    for (const g of groups || []) {
      for (const r of g && Array.isArray(g.rows) ? g.rows : []) {
        if (!r || typeof r.key !== 'string' || seen.has(r.key)) continue;
        seen.add(r.key);
        out.push(r);
      }
    }
    return out;
  }

  /** Greedy fill: rows value-descending, take each monster that still fits (up to maxPicks). Seeded gates. */
  _coopFill(rows, budget, maxPicks = 64) {
    const picks = [];
    let left = budget;
    const sorted = (rows || []).slice().sort((a, b) => b.value - a.value || String(a.key).localeCompare(String(b.key)));
    for (const r of sorted) {
      if (picks.length >= maxPicks) break;
      if (!(r.value > 0) || r.value > left) continue;
      left -= r.value;
      picks.push({ enemyKey: r.key, gate: this.rngCoopHunt() < 0.5 ? 'upper' : 'lower' });
    }
    return picks;
  }

  /**
   * Resolve a duplicate total: return the closest pick-set whose total is still affordable and not in `used`, else null.
   * Preference order: one substitute in the player's own type, a substitute in another type, add / remove one pick.
   * The first tie-break is the smallest change, then the player's own type.
   * @returns {{ picks: object[], value: number }|null}
   */
  _coopUniquePicks(picks, mainGroup, groups, budget, used, maxPicks = 64) {
    const val = (key) => this.confrontValueOf(key);
    const total = picks.reduce((s, p) => s + val(p.enemyKey), 0);
    const keys = new Set(picks.map((p) => p.enemyKey));
    const out = [];
    const consider = (next, group) => {
      if (!next.length || next.length > maxPicks) return;
      const v = next.reduce((s, p) => s + val(p.enemyKey), 0);
      if (!(v > 0) || v > budget || used.has(v)) return;
      out.push({ picks: next, value: v, delta: Math.abs(v - total), own: group === mainGroup ? 0 : 1 });
    };
    const order = [mainGroup, ...groups.filter((g) => g !== mainGroup)].filter(Boolean);
    for (const g of order) {
      for (let i = 0; i < picks.length; i++) {
        const cur = picks[i].enemyKey;
        for (const r of g.rows) {
          if (r.key === cur || keys.has(r.key)) continue;
          const next = picks.slice();
          next[i] = { enemyKey: r.key, gate: picks[i].gate };
          consider(next, g);
        }
      }
      if (picks.length < maxPicks) {
        for (const r of g.rows) {
          if (keys.has(r.key)) continue;
          consider([...picks, { enemyKey: r.key, gate: 'lower' }], g);
        }
      }
    }
    if (picks.length > 1) for (let i = 0; i < picks.length; i++) consider(picks.filter((_, j) => j !== i), mainGroup);
    out.sort((a, b) => a.delta - b.delta || a.own - b.own
      || a.picks.map((p) => p.enemyKey).join('|').localeCompare(b.picks.map((p) => p.enemyKey).join('|')));
    if (out.length) return out[0];
    // last resort: a complete re-fill from another type (or the union), still with a unique total
    for (const g of order) {
      const alt = this._coopFill(g.rows, budget, maxPicks);
      const v = this.confrontSpent(alt);
      if (alt.length && !used.has(v)) return { picks: alt, value: v };
    }
    const union = this._coopFill(this._coopUnionRows(groups), budget, maxPicks);
    const v = this.confrontSpent(union);
    return union.length && !used.has(v) ? { picks: union, value: v } : null;
  }

  /**
   * Insert ONE player's system-run prey into their spawn list (同盟狩猎). Co-op players each have their own wave, so each
   * plan is inserted into that player's list at the plan's own position, each monster on the route of its gate. The prey
   * is a bonus target, `countInTotal: false`: it stays out of the 官方只数 / 完美作战 counters — but a leak is NOT free
   * (2026-11-06 纠偏：注释此前写「a leak costs no 目标生命值」): with no `confrontSeat` settle charges it as an official
   * uncounted leak (1 point each, match/match/settle.js), and a kill still pays the bounty.
   *
   * The bounty is the plan's own per-kill split (`plan.coins`, priced at deployment) plus the receiver's 赏金嗅觉
   * (eventBountyBonusOf), and it always carries `bank: true`: 赏金 goes to 坎诺特's account, never to the purse.
   * @param {object[]} spawns the player's wave (already carrying the round's event card / 强力属性)
   * @param {import('../PlayerState.js').PlayerState} ps
   * @returns {object[]} a new list (the input is never mutated)
   */
  applyCoopHunt(spawns, ps) {
    const plan = this.coopHuntPlan(ps);
    if (!plan || !plan.picks.length || !Array.isArray(spawns) || !spawns.length) return spawns;
    const mods = roundMods(this.confrontScale());
    const base = this.wave && Array.isArray(this.wave.spawns) ? this.wave.spawns : spawns;
    const start = this._confrontInsertTime(base, plan.position);
    const scent = typeof this.eventBountyBonusOf === 'function' ? this.eventBountyBonusOf(ps) : 0;
    const { routes, leader } = this._confrontRoutes();
    const out = spawns.slice();
    plan.picks.forEach((p, i) => {
      // 2026-11-05：同门路线不存在时 `confrontRoutePlanFor` 会合成一条（route 非 null）—— 挂到 spawn 上让 sim 用它
      const routing = this.confrontRoutePlanFor(p.enemyKey, p.gate);
      const routeIndex = routing.routeIndex;
      const route = routing.route || routes[routeIndex];
      out.push({
        time: start + i, enemyKey: p.enemyKey, count: 1, interval: 0,
        routeIndex,
        ...(routing.route ? { route: routing.route } : {}),
        mods: { ...mods }, ownerPlayerId: ps.playerId,
        // the prep preview must show the REAL gate / movement class of an appended prey (previewOf otherwise defaults
        // to lower / ground); `prey` marks it display-only: it is not one of the stage's scheduled enemies, so it is
        // excluded from the HUD capsule's denominator (`countInTotal: false`).
        preview: previewInfo(this.gd, p.enemyKey, route, false, leader),
        prey: true,
        countInTotal: false,
        bounty: { coins: (plan.coins[i] || 0) + scent, ownerPlayerId: ps.playerId, total: plan.count, index: i, bank: true },
      });
    });
    return out;
  }

  /**
   * 商人「坎诺特」 (user 2026-10-17): a kill bounty on a monster the opponent PLACED never becomes gold — the sim banks
   * it (`unit.bounty.bank`, economy.js addBank) and settle adds it to PlayerState.bountyBank. The ONLY way from 赏金 to
   * 金币 is this withdrawal in prep, at the round's rate (VERSUS_CONFRONT.merchantRates): `cost = gold / rate`, rounded
   * UP on the first withdrawal of a round and DOWN afterwards, at most merchantRoundCap gold a round (R15 uncapped).
   * @param {number} round absolute round number
   */
  merchantRate() { return merchantRateFor(this.round, this.huntCfg()); }

  /** The per-round withdrawal cap of the current round (Infinity in the R15 隐秘核心 round). */
  merchantCap() { return merchantCapFor(this.round, this.huntCfg()); }

  /** The 赏金 a withdrawal of `gold` costs right now (ceil on this round's first, floor afterwards). */
  merchantCost(ps, gold) {
    const g = Math.max(0, Math.trunc(Number(gold) || 0));
    if (!(g > 0)) return 0;
    const raw = g / this.merchantRate();
    // the epsilon keeps exact boundaries exact (4 / 0.2 = 19.999… / 20.000… must cost 20 either way)
    return !ps || !(ps.withdrawnThisRound > 0) ? Math.ceil(raw - 1e-9) : Math.floor(raw + 1e-9);
  }

  /**
   * The 坎诺特 panel of ONE player (m.private.merchant): the banked 赏金, the round's rate and cap, what is left to
   * withdraw this round and the 1 / 2 / 4 / all options with the 赏金 each of them costs. null outside 2V2.
   */
  merchantView(ps) {
    if (!this.huntMode || !ps) return null;
    const rate = this.merchantRate();
    const cap = this.merchantCap();
    const withdrawn = Math.max(0, Math.trunc(Number(ps.withdrawnThisRound) || 0));
    const bank = Math.max(0, Math.trunc(Number(ps.bountyBank) || 0));
    const left = Math.max(0, cap - withdrawn);
    // the gold this bank can buy at all: bank * rate, floored (the cost of g gold is g / rate)
    const affordable = Math.floor(bank * rate + 1e-9);
    const max = Math.max(0, Math.min(left, affordable));
    const options = [1, 2, 4].map((gold) => ({ gold, cost: this.merchantCost(ps, gold), enabled: gold <= max }));
    options.push({ gold: max, cost: max > 0 ? this.merchantCost(ps, max) : 0, enabled: max > 0, all: true });
    return { bank, rate, cap: Number.isFinite(cap) ? cap : null, withdrawn, left: Number.isFinite(left) ? left : null, max, options };
  }

  /**
   * `g.confront.withdraw { gold }` (prep only, 2V2): turn 赏金 into 金币 through 坎诺特. The server owns everything —
   * the rate, the ceil/floor cost, the per-round cap and the balance; the client only sends the intent. Errors:
   * ERR.WRONG_PHASE (not prep / not 2V2), ERR.MERCHANT_CAP (over this round's cap), ERR.MERCHANT_BANK (not enough 赏金),
   * ERR.BAD_TARGET (a non-positive / malformed amount).
   */
  withdrawBounty(ps, { gold } = {}) {
    if (!this.huntMode || this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    // the coop 投放公示 freezes the prep: no withdrawal may change the purse in those 5 s
    if (this.confrontStage === 'roster') return fail(ERR.WRONG_PHASE, 'roster');
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (ps.ready) return fail(ERR.ALREADY);
    const g = Math.trunc(Number(gold));
    if (!Number.isFinite(g) || g <= 0) return fail(ERR.BAD_TARGET, 'illegal 坎诺特 withdraw'); // i18n-ignore: server detail
    if (ps.withdrawnThisRound + g > this.merchantCap()) return fail(ERR.MERCHANT_CAP);
    const cost = this.merchantCost(ps, g);
    if (!(cost > 0) || cost > ps.bountyBank) return fail(ERR.MERCHANT_BANK);
    ps.bountyBank -= cost;
    ps.withdrawnThisRound += g;
    ps.withdrawnGold += g;
    // addFunds already credits stats.fundsGained; never add it a second time here
    ps.addFunds(g, { reason: 'merchant' });
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** The alive, seated members of a team. */
  _aliveOf(team) { return this.order.filter((p) => p.alive && !p.left && this.teamIdOf(p) === team); }

  /** Every alive member of a team is a bot / under 托管 (its target is decided at once). */
  _allBots(team) {
    const members = this._aliveOf(team);
    return members.length > 0 && members.every((p) => p.botControlled);
  }

  /** Enter the 对抗期: step 1 (targets) opens. A team of BOTS decides at once; a team holding a human waits for it — the
   *  human picks first and the bot teammate is filled in only then (or when the window closes). Step 2 is this round's
   *  PREP (finishConfrontTargets), not a phase of its own.
   *
   *  规则档（业主 2026-11-04）：
   *   · 赏金档（`versusRule === 'bounty'`，缺省）→ 保留目标选择模态（10 s）；
   *   · 对抗档（`versusRule === 'confront'`）→ **没有目标选择**：进来就自动分配目标（assignConfrontTarget，shared
   *     模式同队共用同一个 target）并直接 finishConfrontTargets → 本回合 PREP + 开商店，客户端不再有遮罩。 */
  enterConfront() {
    this.phase = PHASE.CONFRONT;
    this.confrontStage = 'target';
    // 攻防不对称：只有 attack 一队投放；守方本回合只防守。
    const attack = this.attackingTeam ?? 0;
    this.attackingTeam = attack;
    this.defenderTeam = attack === 0 ? 1 : 0;
    /** receiver playerId → value of the original wave already replaced this round (the share is per RECEIVER) */
    this._confrontRemoved = new Map();
    this.confrontTargets = new Map(); // attacker playerId → target playerId
    this.confrontSubs = new Map();    // attacker playerId → { target, group, position, picks, bosses, ratio, budget }
    // 提交付款台账（2026-11-04 复验修复 1）：每回合清零 —— 上一回合为提交付过的款不能抵扣本回合的怪。
    this._confrontPaid = new Map();
    // 怪物卡池（2026-11-03）：这里只做阶段准备，**不再**开张商店 —— 2026-11-04 起投放窗口就是本回合的 PREP，
    // 商店在目标选择结束那一刻开（finishConfrontTargets），买卡 / 提交 / 冻结全程同一个 deadline。
    if (this.isConfrontRule()) {
      // 对抗档：跳过目标选择（业主 2026-11-04「遮罩只在悬赏模式出」）。confrontStage 仍是 'target'
      // 只为通过 finishConfrontTargets 的阶段闸门；它立刻被清成 null 并进 PREP。
      for (const ps of this.alivePlayers()) ps.ready = false;
      this.markPublic();
      this.finishConfrontTargets();
      return;
    }
    this.setDeadline(this.soloUntimed ? null : VERSUS_CONFRONT.targetSeconds, () => this.finishConfrontTargets());
    for (const t of this.matchTeamIds()) {
      if (t !== attack || !this._allBots(t)) continue;
      for (const ps of this._aliveOf(t)) this.assignConfrontTarget(ps, null, true);
    }
    for (const ps of this.alivePlayers()) ps.ready = false;
    this.markPublic();
    this.maybeFinishConfrontTargets();
  }

  /** `g.confrontTarget { targetPlayerId }`: the player names the OPPONENT they attack this round. */
  submitConfrontTarget(ps, { targetPlayerId }) {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.attackingTeam != null && this.teamIdOf(ps) !== this.attackingTeam) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters');
    if (this.confrontTargets.has(ps.playerId)) return fail(ERR.ALREADY);
    const target = this.players.get(targetPlayerId);
    if (!target || !target.alive || target.left || this.teamIdOf(target) === this.teamIdOf(ps)) return fail(ERR.BAD_TARGET);
    this.assignConfrontTarget(ps, target.playerId, true);
    this.markPublic();
    this.maybeFinishConfrontTargets();
    return OK;
  }

  /**
   * Give `ps` a target: the named one when it is still free, else the opponent nobody on this team picked yet, else the
   * LEAST-attacked opponent (a stack). `fillMates` also hands the teammates whatever remains (first come, first served:
   * A picks C and B is given D) — never the other team.
   *
   * Why the stack: a team can outnumber the opponents it still sees (4V4 with two alive opponents, or a 4-attacker team
   * against a 2-player team). Before this, `free[0]` was `undefined` and the extra attackers simply got NO target — their
   * submission carried `target: null`, `confrontFor` (which matches `s.target === ps.playerId`) never delivered it, and
   * the budget was spent on monsters that reached nobody. A stack keeps the placement alive; the price is bounded where
   * the placement is applied (`applyConfront` divides the round's replacement share by the number of attackers).
   */
  assignConfrontTarget(ps, want = null, fillMates = false) {
    // 守方不参与投放（攻防不对称）
    if (this.attackingTeam != null && this.teamIdOf(ps) !== this.attackingTeam) return;
    const team = this.teamIdOf(ps);
    const opp = this.defenderTeam != null ? this.defenderTeam : this.matchTeamIds().find((t) => t !== team);
    const oppIds = opp == null ? [] : this._aliveOf(opp).map((p) => p.playerId);
    const takenBy = (t) => [...this.confrontTargets.entries()]
      .filter(([pid]) => this.teamIdOf(this.players.get(pid)) === t).map(([, v]) => v);
    /** The opponent this team attacks the fewest times (ties: seat order) — the stack target when nobody is free. */
    const leastAttacked = () => {
      const loads = new Map(oppIds.map((pid) => [pid, 0]));
      for (const t of takenBy(team)) if (loads.has(t)) loads.set(t, loads.get(t) + 1);
      let best = null;
      for (const pid of oppIds) if (best == null || loads.get(pid) < loads.get(best)) best = pid;
      return best;
    };
    /** 2026-11-01 P1：目标按对手剩余 LP 升序（打薄弱处）；同分按本队已攻击次数（leastAttacked）。 */
    const weakestOf = (list) => {
      const loads = new Map(oppIds.map((pid) => [pid, 0]));
      for (const t of takenBy(team)) if (loads.has(t)) loads.set(t, loads.get(t) + 1);
      let best = null;
      for (const pid of list) {
        if (best == null) { best = pid; continue; }
        const la = Number(this.players.get(pid)?.lp) || 0;
        const lb = Number(this.players.get(best)?.lp) || 0;
        if (la < lb || (la === lb && loads.get(pid) < loads.get(best))) best = pid;
      }
      return best;
    };
    /** 本队第一个已分配的目标（没有 → null）。shared 出怪「同队共用一个 target」的取值点。 */
    const teamTarget = () => {
      for (const mate of this._aliveOf(team)) {
        const t = this.confrontTargets.get(mate.playerId);
        if (t != null) return t;
      }
      return null;
    };
    /** 按既有规则给一个还没目标的玩家选对手；`allowWant` 为假时忽略指名（队友代分配那一次）。 */
    const chooseFor = (playerId, allowWant) => {
      if (this.confrontTargets.has(playerId)) return;
      const free = oppIds.filter((pid) => !takenBy(team).includes(pid));
      const chosen = allowWant && typeof want === 'string' && playerId === ps.playerId && free.includes(want)
        ? want
        : (free.length ? weakestOf(free) : leastAttacked());
      if (chosen != null) this.confrontTargets.set(playerId, chosen);
    };
    const pickFor = (playerId) => {
      if (this.confrontTargets.has(playerId)) return;
      // 队级目标（monsterMode !== 'solo'，默认；业主 2026-11-04）：同队攻方共用同一个 target ——
      // 取该队第一个已分配的目标；本队还没人分配就按既有规则给「队里第一位」分配，其余沿用它的目标。
      // `master`（2026-11-06）沿用队级目标：整队仍是攻方，只是操作怪物的只有一个人。
      if (this.monsterMode !== 'solo') {
        const shared = teamTarget();
        if (shared != null) { this.confrontTargets.set(playerId, shared); return; }
        const first = this._aliveOf(team)[0];
        if (first && first.playerId !== playerId) {
          chooseFor(first.playerId, true);
          const t = this.confrontTargets.get(first.playerId);
          if (t != null) { this.confrontTargets.set(playerId, t); return; }
        }
      }
      chooseFor(playerId, true);
    };
    pickFor(ps.playerId);
    if (!fillMates) return;
    for (const mate of this._aliveOf(team)) pickFor(mate.playerId);
  }

  /** Step 1 ends once EVERY attacker holds a target, or its window runs out. */
  maybeFinishConfrontTargets() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return;
    const alive = this.confrontActors();
    if (alive.length && alive.every((p) => this.confrontTargets.has(p.playerId))) this.finishConfrontTargets();
  }

  /**
   * Close step 1 (anyone the window caught out gets what is left) and enter step 2 = THIS round's PREP (2026-11-04):
   * every alive player prepares from now on, with ONE deadline (`gd.prepTime(round)`, armed by enterPrep). The attackers'
   * monster shop opens here — the placement window IS the prep, there is no separate 'monster' stage.
   */
  finishConfrontTargets() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'target') return;
    for (const ps of this.confrontActors()) this.assignConfrontTarget(ps, null, true);
    this.setDeadline(0);
    // 目标选择已经做完：PREP 结束时就冻结投放（endPrep → finishConfront），不再回 CONFRONT。
    this._confrontTargetsRound = this.round;
    // 投放窗 = 本回合的 PREP：stage 先清掉（PREP 里的冻结收尾与商店闸门都以「stage == null」判定目标选择已结束）。
    this.confrontStage = null;
    // 怪物卡池（2026-11-03）：攻方每人一张商店，同队共用一个池（按队建，Match.js 的构造函数不改）。
    // 池来源（业主 2026-11-05）：`data/enemies.json` 全表 − tokenOnly − BOSS（商店不卖领袖），不再只取本回合官方出怪
    // —— 见 monsterPool.js 的 monsterPoolKeys。合法性（能不能提交 / 买 / 投）= 「在池里 + tier ≤ 商店等级」，
    // 与池来源是同一张表（`cardBlocked`），2026-11-05 起不再按回合走 `legalKeys`。
    // 每回合**重建**（2026-11-04 复验修复 1，仍保留）：① 卡价是**本回合量纲**（confrontValueOf 含回合倍率与特性档位分），
    // 复用旧池会把上一回合的价格一路卖到后面几回合；② 商店池按回合变（官方成员保证随 `_roundOfficialSpawns` 变）。
    // 重建的代价是「上回合被买走的份数」被清空，这是**预期**的补货语义（每回合满库存），不是 bug。
    // 开张时机（2026-11-04）：目标选择结束这一刻，且**在进 PREP 之前**就位 —— 同步调度下 PREP 可能立刻结束，
    // 那时 finishConfront 的收尾（关店 / 补 bot 投放）必须已经能看到商店。
    if (this.monsterShopOn) {
      // 军费（业主 2026-11-04 裁决）：此刻攻方 / 人数 / 本回合波次都已确定 —— 给每个攻方发一份
      // 「官方波次价值 × 1.5 ÷ 攻方人数」，shared 模式进队级账户、solo 进 ps.monsterFunds（跨回合结转）。
      // 必须在开店 / 推首帧**之前**，否则第一帧显示的余额还是 0。
      this.grantMonsterFunds();
      // 商店等级（2026-11-04「参考卫戍协议干员商店」）：等级挂 Match（`m.monsterShopLevels`，跨回合持久，不挂
      // ps.monsterShop —— 那玩意儿每回合重建）。开店前 seed 一次：首次碰到该队（solo：该人）时为 1 级。
      // openMonsterShop 只**读**等级决定槽位数，不改等级；升级只走 g.monsterLevelUp。
      for (const ps of this.confrontActors()) monsterShopLevelOf(this, ps);
      this.monsterPools ||= new Map();
      const solo = this.monsterMode === 'solo';
      // `master`（2026-11-06 单人掌握怪物）：资源键仍按队（poolKeyOf 走 `!solo` 分支），只是投放权单人。
      const master = this.monsterMode === 'master';
      // 池的键：shared / master = teamId（同队必须共用同一个池，否则队友看不到对方买走的份数 / 退回来的份数）；
      // solo = playerId（业主 2026-11-04「单人怪物模式」：池按人）。
      const poolKeyOf = (ps) => (solo
        ? ps.playerId
        : (typeof this.teamIdOf === 'function' ? this.teamIdOf(ps) : 0));
      // 谁开店：shared = 全体攻方；solo / master = 每队只有第一位存活攻方（monsterPlaceActor）—— 其余攻方的商店不开。
      const actors = this.confrontActors().filter((ps) => (!solo && !master) || this.monsterPlaceActor(ps));
      const keys = new Set();
      for (const ps of actors) keys.add(poolKeyOf(ps));
      for (const key of keys) this.monsterPools.set(key, buildMonsterPool(this));
      for (const ps of actors) {
        try { openMonsterShop(this, ps); } catch (e) { this.reportError('monster shop open', e); }
        // 首帧（2026-11-03）：服务端主动推商店，客户端不必先发一次成功意图才知道开没开（否则死锁）
        try { if (ps.playerId) this.sendTo(ps.playerId, monsterShopFrame(this, ps)); } catch (e) { this.reportError('monster shop open', e); }
      }
      // 没开店的队友也要收一帧收尾帧，面板才不会沿用上一回合的货架：
      //   · solo   → 「关着」帧（open:false，与改造前逐字节一致）；
      //   · master → **只读**帧（open:true、slots:[]、readOnly:true）：队级资金 / 等级照发，客户端显示「队长操作中」。
      if (solo || master) {
        for (const ps of this.confrontActors()) {
          if (actors.includes(ps)) continue;
          const frameOf = master ? monsterShopReadOnlyFrame : monsterShopFrame;
          try { if (ps.playerId) this.sendTo(ps.playerId, frameOf(this, ps)); } catch (e) { this.reportError('monster shop open', e); }
        }
      }
    }
    // 进本回合的 PREP：全体存活玩家同一个 deadline（gd.prepTime(round)），攻方也在这里点准备。
    this.enterPrep();
    let botsActed = false;
    for (const ps of this.confrontActors()) if (ps.botControlled) { this.botConfront(ps); botsActed = true; }
    // 共享池同步（2026-11-04 第二轮复审修复 1）：bot 这一轮买走的份数必须推给人类队友 —— botConfront 自己也会推，
    // 这里再推一次是本轮「最终态」的兜底（内容相同，客户端按整帧覆盖，不会出现半帧）。没有 bot 行动就不推。
    if (botsActed) pushMonsterShops(this);
    this.markPublic();
  }

  /** `g.confront { group, position, picks, bosses, commit }` in step 2: the monsters a player throws at their target.
   *  `bosses` (the 事件期 boss 格, user 2026-10-21) is optional — an old client never sends it. `commit` splits the flow in
   *  two (业主 2026-10-27): without it the submission is a **draft** that may be overwritten any number of times until the
   *  PREP ends; with it the placement is final (the prep itself ends on Ready / its deadline — 2026-11-04 单一 deadline,
   *  不再由「全员已确认」提前收尾). */
  submitConfront(ps, { group, position, picks, bosses, commit }) {
    if (!this.confrontWindowOpen()) return fail(ERR.WRONG_PHASE);
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.attackingTeam != null && this.teamIdOf(ps) !== this.attackingTeam) return fail(ERR.WRONG_PHASE, 'the defending team cannot place monsters');
    // 投放权闸门（2026-11-06）：solo / master 只有每队第一位存活攻方能投放。商店闸门只挡「买 / 点卡」，
    // 旧 `g.confront` 通道可以不经商店直接提交 —— 这里用**同一个**判据补上，堵住绕过「单人掌握怪物」的口子。
    // shared（缺省）恒为 true，行为与改造前逐字节一致。
    if (!this.monsterPlaceActor(ps)) return fail(ERR.WRONG_PHASE, 'single-operator monster mode: only the first attacker places');
    // 已确认出击 = 定局，不能再改；草稿可以反复覆盖（这一步以前是 ALREADY 一刀切，见 2026-10-27 的交互改版）
    const prev = this.confrontSubs.get(ps.playerId);
    if (prev && prev.committed === true) return fail(ERR.ALREADY);
    const arr = Array.isArray(picks) ? picks : [];
    const bArr = Array.isArray(bosses) ? bosses : [];
    // the count cap first: it is the protocol's own list bound too (shared/constants.js maxPicks mirrors it)
    if (arr.length > this.confrontPlaceCap()) return fail(ERR.CONFRONT_COUNT);
    if (bArr.length > VERSUS_CONFRONT.maxBosses) return fail(ERR.CONFRONT_COUNT);
    const member = this._confrontMember(ps, group, position, arr, bArr);
    if (!member) return fail(ERR.BAD_TARGET, 'illegal 对抗期 pick'); // i18n-ignore: 服务端内部 detail（客户端显示的是 ERR.BAD_TARGET 的文案）
    if (member.error) return fail(member.error);
    // 防御：错误码常量缺失时 _confrontMember 可能返回 { error: undefined }；没有 sub 就绝不能静默写入（否则玩家派怪被丢弃）
    if (!member.sub) return fail(ERR.BAD_MSG, 'confront submission rejected');
    const sub = { ...member.sub, committed: commit === true };
    this.confrontSubs.set(ps.playerId, sub);
    // 收尾异常不得吞掉一次**已经成功**的提交（业主 2026-10-26：线上点提交恒报 INTERNAL，
    // 而 pick 其实已入库）。2026-11-04 起提交不再提前结束阶段：投放窗口 = 本回合 PREP，由 Ready / deadline 收尾。
    try { this.markPublic(); } catch (e) { this.reportError('confront markPublic', e); }
    return OK;
  }

  /**
   * Check a submission: every enemyKey is in the ROUND'S MONSTER POOL at a tier ≤ the shop level (2026-11-05 —
   * 「卡池 = 全表按阶级，发牌上限 = 商店等级」；the old 特训敌人 / 官方波次 gate `legalKeys` is gone: it locked R1–R3's
   * shelf to the 2–3 keys of the round's own wave), a legal gate and position, at most VERSUS_CONFRONT.maxPicks
   * monsters, and — 2026-11-04 复验修复 1 — the money still OWED for it (the picks already paid through the 怪物商店
   * draft / an earlier submission of the same round are credited) within the monster-funds balance. The player MAY MIX
   * TYPES (user decision 2026-10-17: step into one type, spend part of the budget, step into another and add more), so
   * `group` is display-only and only the union is checked. The AUTHORITATIVE cap (the client greys out what does not
   * fit, this refuses it): over the balance ⇒ ERR.CONFRONT_BUDGET, out of stock ⇒ ERR.SOLD_OUT, over the count ⇒
   * ERR.CONFRONT_COUNT.
   *
   * `bosses` (the 事件期 boss 格, user 2026-10-21) is checked on its own: every enemyKey must be in the 机变悬赏 pool
   * (confrontBossPool — and the round must be an event round at all), an enemyKey may appear at most ONCE per submission
   * ([ASSUMED] error code: a repeat is a count offence ⇒ ERR.CONFRONT_COUNT), and at most `confrontBossCap()` of
   * them (the event's own ordinal: E1 = 1 / E2 = 2 / E3 = 3, user 2026-10-21 after playtest). Bosses pay NO budget and count against NO maxPicks — `picks` may even be empty, a boss-only submission is a
   * legal one.
   * @returns {{ sub: object }|{ error: string }|null} null = malformed (unknown monster / gate / position)
   */
  _confrontMember(ps, group, position, picks, bosses = []) {
    const list = this.confrontGroups();
    // 合法性（2026-11-05 业主裁决，与 monsterShop 的 buyMonster / placeMonster / rollCard **同一个判据**）：
    // 「key 在卡池里」且「池里的 tier ≤ 商店等级」。卡池 = data/enemies.json 全表 − tokenOnly − BOSS
    // （monsterPool.js 的 monsterPoolKeys，entries 里带 tier），不新造表；商店关着时没有等级概念 ⇒ 不设阶位上限。
    // 之所以不再用 legalKeys：它把 R1–R3 的货架 / 提交卡成「本回合官方出怪」（2–3 个 key），池放宽到全表等于白放宽；
    // 而且两份实现各算一套曾导致「卡进得了草稿但提交必被拒」。
    const pool = monsterPoolFor(this, ps);
    const levelCap = this.monsterShopOn ? monsterShopLevelOf(this, ps) : Number.MAX_SAFE_INTEGER;
    const allowed = (key) => { const tier = pool.tier(key); return tier > 0 && tier <= levelCap; };
    const arr = Array.isArray(picks) ? picks : [];
    const pos = VERSUS_CONFRONT.positions.includes(position) ? position : null;
    if (!pos) return null;
    const out = [];
    const timeLimit = Math.max(1, Number(this.wave && this.wave.timeLimit) || 60);
    for (const p of arr) {
      if (!p || typeof p.enemyKey !== 'string' || !allowed(p.enemyKey)) return null;
      // 预设路线 + 投放时刻（可选）：**与 bot 走同一套清洗**（业主 2026-10-27：玩家手动提交不该因为路线/时刻被硬拒，
      // 线上表现是「服务器内部错误」——拒绝码在响应层的表里不存在，被兜底成 INTERNAL 了）。
      // 非法就就地退化：路线不可用 / 超长 → 回落默认路线；时刻夹进 [0, 时限-行程-2]，否则这只怪会晚于时限出场、
      // 整波看起来「少了一只」。真正该拒的只剩：未知怪、数量上限、预算超支。
      let routeIndex = Number.isInteger(p.routeIndex) ? p.routeIndex : null;
      let metrics = routeIndex != null ? this.confrontRouteMetrics(routeIndex, p.enemyKey) : null;
      if (routeIndex != null && (!metrics || Number(metrics.len) > 40)) { routeIndex = null; metrics = null; }
      let time = Number.isFinite(p.time) ? Math.max(0, p.time) : null;
      if (time != null) {
        let room = timeLimit - (metrics ? Number(metrics.travel) || 0 : 0) - 2;
        // 行程本身就塞不进时限 ⇒ 这条路线也一起丢掉，改走默认路线
        if (room < 0) { routeIndex = null; metrics = null; room = timeLimit - 2; }
        time = Math.max(0, Math.min(time, Math.max(0, room)));
      }
      out.push({
        enemyKey: p.enemyKey,
        gate: p.gate === 'upper' ? 'upper' : 'lower',
        ...(routeIndex != null ? { routeIndex } : {}),
        ...(time != null ? { time } : {}),
        ...(metrics ? { routeLen: metrics.len } : {}),
      });
    }
    if (out.length > VERSUS_CONFRONT.maxPicks) return { error: ERR.CONFRONT_COUNT };
    // 路线**不计费**（2026-11-06 口径统一）：`buyMonster` / `placeMonster` 从来没收过路线费，只有这里曾按
    // `routeLen × 1` 加进超支判据 —— 同一份投放「点卡」不超支、「提交」超支，玩家看到的就是莫名其妙的
    // CONFRONT_BUDGET。这里删掉那条判据，两条路径从此同一个尺度（routeLen 只作路线行程信息用）。
    // 预算判据（2026-11-04 复验修复 1：`g.confront` 曾经是免费投放通道）：
    //   商店开着 → 只判**尚未付款**的部分（草稿里的同 key 卡在 buyMonster / placeMonster 时已扣过款、也 take 过库存），
    //     上限 = 怪物资金账户余额（confrontPurchaseLimit，见那里的注释）；
    //   商店关着 → 旧口径（回合预算 vs 整单价值），一个字节都不变。
    // `confrontSpent` / `monsterPriceOf` 与卡面同源，所以这里与 buyMonster / placeMonster 是同一个尺度。
    const settle = this.monsterShopOn ? this._confrontChargeFor(ps, out) : null;
    const overBudget = settle
      ? settle.cost > this.confrontPurchaseLimit(ps)
      : this.confrontSpent(out) > this.confrontPurchaseLimit(ps);
    if (overBudget) return { error: ERR.CONFRONT_BUDGET };
    const bArr = Array.isArray(bosses) ? bosses : [];
    // outside the 事件期 rounds the boss 格 does not exist, so the pool is empty and any boss is refused with it
    const bossAllowed = this.confrontBossOpen() ? new Set(this.confrontBossPool().map((r) => r.key)) : new Set();
    const outB = [];
    for (const p of bArr) {
      if (!p || typeof p.enemyKey !== 'string' || !bossAllowed.has(p.enemyKey)) return null;
      if (outB.some((x) => x.enemyKey === p.enemyKey)) return { error: ERR.CONFRONT_COUNT };
      outB.push({ enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' });
    }
    // the cap is the event's own ordinal (confrontBossCap: E1 = 1, E2 = 2, E3 = 3; user 2026-10-21 after playtest) —
    // over the cap is a count offence; off the event rounds the cap is 0 and the empty pool above already refused
    if (outB.length > this.confrontBossCap()) return { error: ERR.CONFRONT_COUNT };
    // 收款（全有或全无，2026-11-04 复验修复 1）：到这里全部校验都已通过，才开始动钱 / 库存 ——
    // 余额不足 → CONFRONT_BUDGET、库存不足 → SOLD_OUT，两种失败都**不会**留下任何部分扣款。
    if (settle) {
      const paid = this._confrontPayPicks(ps, settle);
      if (paid) return { error: paid.error };
    }
    const gi = Number.isInteger(group) && group >= 1 && group <= list.length ? group : 1;
    return { sub: { target: this.confrontTargets.get(ps.playerId) ?? null, group: gi, position: pos, picks: out, bosses: outB, total: out.length, ratio: this.confrontRatio(), budget: this.confrontBudget(ps), seat: ps.seat } };
  }

  /** An AI player's submission, and the one a player who never submits gets at the window's end.
   *  控怪档（2026-11-01 P1，业主「1.5 倍 = 只数 + 价值」）：双目标填充 —— 只数目标 = 官方只数×1.5÷攻方人数、
   *  价值目标 = 预算全额，每步挑最接近「剩余预算/剩余只数」的负担得起的怪（`fillConfrontPicks` 纯函数）。
   *  赏金档保持旧口径（便宜优先 + 跨类型补齐；那一档语义是替换一小部分，不是 1.5× 配额）。
   *  事件期 boss 格（2026-11-01 P1）：开放时按金币降序取到 `confrontBossCap()` 只 —— 原「AI 恒空」的 [ASSUMED] 作废。 */
  botConfront(ps) {
    if (this.attackingTeam != null && this.teamIdOf(ps) !== this.attackingTeam) return;
    // solo / master 怪物模式（业主 2026-11-04 / 2026-11-06）：只有该队第一位存活攻方投放 —— 其余攻方也不补投放，
    // 否则 bot 的引擎回落路径会绕过「商店不开」把队友的投放直接写进 confrontSubs。
    if (this.monsterMode !== 'shared' && !this.monsterPlaceActor(ps)) return;
    if (!this.confrontWindowOpen() || this.confrontSubs.has(ps.playerId)) return;
    // 怪物卡池（2026-11-03）：只在商店开着时才问策略；`monsterShopOn` 为假 ⇒ strat = null ⇒ 下面全部走旧路径。
    // 惰性初始化（Match.js 不改）：this.monsterBot 首次用到时才建。
    const strat = this.monsterShopOn ? (this.monsterBot ||= monsterStrategyFor(this)) : null;
    if (strat) {
      const want = callStrategyHook(this, strat, 'pickTargets', ps);
      // null = 交回引擎：目标仍由 assignConfrontTarget 在 step 1 / step 2 收尾时分配。
      // 给了 playerId 就按 submitConfrontTarget 的同一套判据落地（存活的对手），非法值一并回落引擎。
      if (typeof want === 'string') {
        const target = this.players && typeof this.players.get === 'function' ? this.players.get(want) : null;
        if (target && target.alive && !target.left && this.teamIdOf(target) !== this.teamIdOf(ps)) this.confrontTargets.set(ps.playerId, want);
        else this.assignConfrontTarget(ps, null, false);
      }
    }
    const groups = this.confrontGroups();
    // bot 的花钱上限（2026-11-04 复验修复 1）：商店开着时 = min(回合预算, 账户余额 + 草稿里已付过款的价值)
    // （confrontBotBudget）—— bot 只能派自己付得起的怪，否则下面 `_confrontPayPicks` 会整单拒掉、投放落空。
    // 商店关着 = 旧的回合预算，行为逐字节不变。
    const budget = this.confrontBotBudget(ps);
    const cap = this.confrontPlaceCap();
    // 卡池闸门（2026-11-05，取代 2026-11-04 的 `legalKeys` 闸门）：候选必须是**卡池里 + 阶位 ≤ 商店等级**的怪
    // （与 `_confrontMember` / 商店的 buyMonster / placeMonster **同一个判据** `cardBlocked`，不另算一套）。
    // 商店开着时**先**把候选限定在卡池：赏金档的旧贪心（下面的 `ordered`）与对抗档的 `fillConfrontPicks`
    // 共用这一条判据 —— 否则「便宜优先」会先被买不到 / 交不上的怪吃光预算，投完再过滤就成了空单。
    // 商店关着（旧平铺面板）= 不做这道闸门，行为与改造前一致。
    const deck = this.monsterShopOn ? monsterPoolFor(this, ps) : null;
    const deckOk = (key) => !deck || cardBlocked(this, ps, key) == null;
    const rowAllowed = (r) => !deck || !!(r && deckOk(r.key));
    const rows = [];
    groups.forEach((g, gi) => (g.rows || []).forEach((r) => {
      if (!rowAllowed(r)) return;
      rows.push({ key: r.key, value: r.value, gi });
    }));
    const picks = [];
    // 商店计划（2026-11-04 复验修复 3b）：契约声明了 shopPlan 就必须真的调用 —— 它的副作用是 ps.monsterDraft.picks，
    // 下面 deployPlan 才可能拿到「这一回合买到的卡」。返回值只用于诊断/测试，允许 null；异常已在 callStrategyHook 里吞掉。
    if (strat) callStrategyHook(this, strat, 'shopPlan', ps);
    // 投放计划：策略返回 picks 数组就用它（仍会过 _botConfrontPlan + _sanitizeBotPicks）；返回 null 走旧贪心。
    const planned = strat ? callStrategyHook(this, strat, 'deployPlan', ps) : null;
    if (Array.isArray(planned)) {
      for (const p of planned) {
        if (p && typeof p.enemyKey === 'string') picks.push({ enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' });
      }
    } else if (this.isConfrontRule()) {
      const unitsTarget = Math.max(1, Math.round((this.confrontWaveCount() * CONFRONT_VOLUME_SHARE) / this.attackingTeamSize()));
      const filled = fillConfrontPicks({ rows, budget, unitsTarget, cap });
      filled.forEach((f, i) => picks.push({ enemyKey: f.enemyKey, gate: i % 2 ? 'upper' : 'lower' }));
    } else {
      // 赏金档：旧实现原样保留（便宜优先 + 反复扫到没有进展为止，去掉「每种怪最多一只」）；
      // 商店开着时先过 `rowAllowed`（卡池 + 阶位 ≤ 商店等级），不再「投完再被滤掉」。
      const ordered = groups.map((g, i) => ({ i, rows: (g.rows || []).filter(rowAllowed).slice().sort((a, b) => a.value - b.value || String(a.key).localeCompare(String(b.key))) }));
      let left = budget;
      const take = (list) => {
        let progressed = true;
        while (progressed && picks.length < cap) {
          progressed = false;
          for (const r of list) {
            if (picks.length >= cap) return;
            if (r.value > left) continue;
            left -= r.value;
            picks.push({ enemyKey: r.key, gate: picks.length % 2 ? 'upper' : 'lower' });
            progressed = true;
          }
        }
      };
      if (ordered.length) take(ordered[0].rows);
      if (picks.length < cap) for (let i = 1; i < ordered.length; i++) take(ordered[i].rows);
    }
    // 卡池闸门（2026-11-05，取代 2026-11-04 的 legalKeys 闸门）：`_sanitizeBotPicks`（pureShares.sanitizeBotPickList）
    // 只校验字段形态与预算，**不判** enemyKey 在不在卡池里；赏金档的 `confrontGroups` 又没有回合闸门
    // （isConfrontRule 为假时只按「本局见过」筛），于是 bot 的贪心会从全类型池里挑 —— 实测本回合官方只出 2 个 key，
    // 冻结进 this.confront 的 12 条里有 10 条是别的怪（apply 时多半被当成非法出怪丢掉）。
    // 三条产出路径（策略 deployPlan / 对抗档 fillConfrontPicks / 赏金档贪心）都汇到这一个 picks 数组，所以在这里
    // 过一道「卡池 + 阶位」（与 `_confrontMember` / 商店**同源**）就覆盖全部 return 路径，且先于 firstKey 与清洗。
    // 商店关着 = 不闸门，保持旧行为。`deck` 已在上面（rows 的候选集）算过，这里复用。
    if (deck) {
      const kept = picks.filter((p) => p && deckOk(p.enemyKey));
      if (kept.length !== picks.length) {
        picks.length = 0;
        for (const p of kept) picks.push(p);
      }
    }
    // 共享池库存（2026-11-04 第二轮复审修复 5）：bot 从来不读 `MonsterPool.left` —— 实测官方只出 5 只，bot 投了 9 条。
    // 逐 key 限量（每条 pick 消耗 1，超出的那一条单独丢弃，**不清空整单**），额度 = 本席**可用**份数
    // （池里剩下的份数 − 给同队人类留的份数，见 monsterShop.js 的 `monsterStockLeft`）+ 本席草稿里
    // 已经买下的份数（cardpool 策略买卡时已经从同一个池 `take` 过，只看 `left` 会把它自己买的卡全部丢掉）。
    // 没有商店（`deck == null`）= 不做闸门，保持旧行为。
    if (deck) {
      // 共享池留份（2026-11-04 真机 2V2）：bot 的逐 key 额度必须与 monsterShop.js 的 buyMonster / placeMonster
      // 走**同一个上限**（`monsterStockLeft` = 池里剩余 − 给同队人类攻方留的份数），否则 bot 的投放计划会绕过
      // 商店把留给人类的那几份也占掉。扣的只是池里的剩余值，**不扣**本席草稿里已经买下的份数
      // （那些已经从池里 take 走了，held 就是把它们加回来的额度）。
      // 2026-11-05：额度改成**按需现算**（不再预铺一遍 legal 全集 —— 那个集合已经没有语义了）。
      const held = new Map();
      for (const d of (ps.monsterDraft && Array.isArray(ps.monsterDraft.picks) ? ps.monsterDraft.picks : [])) {
        if (d && typeof d.enemyKey === 'string') held.set(d.enemyKey, (held.get(d.enemyKey) || 0) + 1);
      }
      const budgetLeft = new Map();
      const leftOf = (key) => {
        if (!budgetLeft.has(key)) budgetLeft.set(key, monsterStockLeft(this, ps, key) + (held.get(key) || 0));
        return budgetLeft.get(key);
      };
      const keptPicks = [];
      for (const p of picks) {
        if (!p) continue;
        const left = leftOf(p.enemyKey);
        if (left <= 0) continue;
        budgetLeft.set(p.enemyKey, left - 1);
        keptPicks.push(p);
      }
      picks.length = 0;
      for (const p of keptPicks) picks.push(p);
    }
    const firstKey = picks.length ? picks[0].enemyKey : null;
    const gi = firstKey == null ? 0 : (rows.find((r) => r.key === firstKey)?.gi ?? 0);
    // 事件期 boss 格：按金币降序取到 cap（不占预算、不计 maxPicks —— 校验器与 _confrontBossSpawns 都是这么定的）
    const bosses = [];
    if (this.confrontBossOpen()) {
      const pool = this.confrontBossPool().slice()
        .sort((a, b) => (Number(b.coin) - Number(a.coin)) || String(a.key).localeCompare(String(b.key)));
      for (const r of pool.slice(0, this.confrontBossCap())) bosses.push({ enemyKey: r.key, gate: bosses.length % 2 ? 'upper' : 'lower' });
    }
    // 业主 2026-10-26：AI 也要「操作怪物」—— 不再只丢默认路线，按怪物移动方式挑可用路线并错开投放时刻。
    // 插件可用 `server.modules.matchClass()` 包装 Match 覆写 `_botConfrontPlan` 做更强的决策（不碰引擎）。
    // 复审计 2026-10-27：bot 路径原先直接写库、绕过 _confrontMember 的全部校验
    // （time / routeIndex / 投放预算）。这里走同一套判据，非法字段就地纠正。
    // 2026-11-06 路线不计费：提交侧不再按 routeLen 加价（见 _confrontMember），bot 的 `_sanitizeBotPicks`
    // 仍按纯函数里的老口径保守估算 —— 只影响 bot 少投几只，不影响任何一方的实际扣款。
    // 复审计 2026-10-27：即使一条都买不起也必须写 sub —— 投放收尾（finishConfront）会给每个还没有 sub 的攻方
    // 补一份 bot 投放，缺 sub 的那一队在 PREP 结束时才补，不如这里就给全。
    // 同上（2026-11-04 复验修复 2）：合法集过滤后为空也照样写空 sub —— 旧不变式「即使一条都交不上也要有 sub」保留，
    // 空 picks 是合法提交（apply 时什么都不替换），且避免 finishConfront 的兜底再走一遍同样的空结果。
    let routed = this._sanitizeBotPicks(this._botConfrontPlan(ps, picks, 'mid'), budget);
    // 结算（2026-11-04 复验修复 1）：bot 的投放同样要付得起 —— 草稿里的卡先抵扣，其余按单价扣款 + 扣库存；
    // 付不起（余额 / 库存不足）就退回空投放（合法提交：apply 时什么都不替换），绝不写一笔没付钱的投放。
    if (this.monsterShopOn) {
      const chargeFor = this._confrontChargeFor(ps, routed);
      if (this._confrontPayPicks(ps, chargeFor)) routed = [];
    }
    this.confrontSubs.set(ps.playerId, { target: this.confrontTargets.get(ps.playerId) ?? null, group: gi + 1, position: 'mid', picks: routed, bosses, total: routed.length, ratio: this.confrontRatio(), budget, seat: ps.seat, committed: true });
    this.markPublic();
    // 共享池同步（2026-11-04 第二轮复审修复 1）：bot 写完 sub 之后把商店的新帧推给人类队友
    // （`shopPlan` 买卡 / 刷新已经改过共享池；bot 席位自己不收帧）。
    pushMonsterShops(this);
  }

  /**
   * AI 投放计划钩子（业主 2026-10-26）：默认 = 给每只怪挑一条**移动方式匹配**的路线并按行程错开时刻。
   * 插件可用 `server.modules.matchClass(fn)` 包装 Match 覆写本方法（例如按守方布阵选路），不需要改引擎。
   * @param {any} ps @param {Array<{enemyKey:string, gate:'upper'|'lower'}>} picks @param {'front'|'mid'|'back'} position
   * @returns {Array<{enemyKey:string, gate:string, routeIndex?:number, time?:number}>}
   */
  _botConfrontPlan(ps, picks, position = 'mid') {
    void ps; void position;
    const list = Array.isArray(picks) ? picks : [];
    if (!list.length) return list;
    const { routes: tplRoutes, leader } = this._confrontRoutes();
    const routeCount = (tplRoutes || []).length;
    const tl = Math.max(1, Number(this.wave && this.wave.timeLimit) || 60);
    const out = [];
    let slot = 0;
    for (const p of list) {
      // 2026-11-01 P1（审计 D6）：路线必须同时满足「这只怪走得通」与「门的朝向一致」——
      // applyConfront 直接信 routeIndex，旧过滤只查 WALK/FLY 会导致「下路怪走上路」。
      // gate 匹配的候选优先；一个都没有就省略 routeIndex，让权威 confrontRouteFor 按门+移动方式挑。
      const gate = p.gate === 'upper' ? 'upper' : 'lower';
      const compat = [];
      for (let i = 0; i < routeCount; i++) {
        const m = this.confrontRouteMetrics(i, p.enemyKey);
        if (!m) continue;
        const rt = tplRoutes[i];
        const gateOk = !rt || !Array.isArray(rt.start) || typeof gateOf !== 'function' || gateOf(rt.start, leader) === gate;
        if (gateOk) compat.push({ i, travel: Number(m.travel) || 0 });
      }
      const pick = compat.length ? compat[slot++ % compat.length] : null;
      const travel = pick ? pick.travel : 0;
      const room = Math.max(0, tl - travel - 2);
      // 按顺序铺在可用时间窗里（至少 1 秒间隔），同一路线会分摊到不同时刻
      const time = room > 0 ? Math.min(room, Math.round((out.length * room) / Math.max(1, list.length))) : undefined;
      out.push({ ...p, ...(pick ? { routeIndex: pick.i } : {}), ...(Number.isFinite(time) ? { time } : {}) });
    }
    return out;
  }

  /**
   * bot 投放的校验（与 `_confrontMember` 同判据，但**修复式**：非法字段就地剥掉，不整单拒绝，
   * 否则 bot 会交白卷）。规则：
   *   · routeIndex 必须 `confrontRouteMetrics` 非 null 且 `len <= 40`，否则去掉（回落默认路线）
   *   · time 夹到 `[0, timeLimit]`，且必须满足 `time + travel + 2 <= timeLimit`，否则去掉
   *   · 路线长度计入预算（长度 ×2），超预算时先剥 routeIndex，再不行就截断列表
   * @param {Array<{enemyKey:string, gate:string, routeIndex?:number, time?:number}>} picks
   * @param {number} budget
   * @returns {Array<object>}
   */
  _sanitizeBotPicks(picks, budget) {
    // 纯逻辑在 pureShares.js（与测试共用同一份代码）
    return sanitizeBotPickList(picks, {
      timeLimit: Math.max(1, Number(this.wave && this.wave.timeLimit) || 60),
      cap: this.confrontPlaceCap ? this.confrontPlaceCap() : VERSUS_CONFRONT.maxPicks,
      metricsOf: (i2, key) => this.confrontRouteMetrics(i2, key),
      spentOf: (list) => this.confrontSpent(list),
      budget: Number(budget) > 0 ? Number(budget) : this.confrontBudget(),
    });
  }

  /**
   * The PREP is over (endPrep, 2026-11-04): the monster-shop DRAFTS become submissions (a submission someone already
   * made wins over their draft; a seat left with nothing gets a bot one only when it is botControlled — a human's empty
   * draft means they throw nothing), the shops close and the placements FREEZE into `this.confront` — once, for this
   * round. Then the roster (悬赏名单) is held for VERSUS_CONFRONT.rosterMs before the battles start
   * (CONFRONT_ROSTER_MS, user 2026-10-17 addendum); without the hold (rosterMs 0) the battles start at once.
   */
  finishConfront() {
    if (this.phase !== PHASE.PREP || this.confrontStage != null) return;
    this.setDeadline(0);
    this.confrontSubs ||= new Map();
    // 点卡投放（2026-11-04 复验修复 1）：客户端已经不再发 `g.confront`，投放只写在 `ps.monsterDraft.picks` 里
    // （monsterShop.js 的 buyMonster / placeMonster）。收尾必须**先把草稿转成正式提交**，否则「没有 sub 的攻方」
    // 会被下一段 botConfront 用 bot 自选的怪覆盖 —— 赏金档的缺省策略是 legacy（三个 hook 全返回 null），
    // 回落到旧贪心填充 ⇒ 玩家投的卡整单消失（实测：投 2 只 slime，冻结进 this.confront 的是 bot 的 6 只）。
    // 判定顺序（业主口径）：
    //   ① 已有 sub（含已确认的 committed）→ 不动，玩家自己的提交优先于草稿；
    //   ② 草稿非空（人类或 bot 都算）→ 按 `submitConfront` 的同一套判据（`_confrontMember`：合法集 / 数量 / 预算 /
    //      路线 / 时刻）转成正式提交，写进 confrontSubs 并标记 committed；
    //   ③ 草稿为空 → 只有 botControlled 才补 bot 投放；人类空草稿 = 本回合什么都不投（保持空，不替人做主）。
    // 转换被拒（越界 / 超预算 / 不在本回合合法集）不静默丢弃：记一条 error，再按 ③ 兜底。
    for (const ps of this.confrontActors()) {
      if (this.confrontSubs.has(ps.playerId)) continue;
      const draft = ps.monsterDraft;
      const picks = draft && Array.isArray(draft.picks) ? draft.picks : [];
      if (picks.length > 0) {
        const member = this._confrontMember(ps, 0, (draft && draft.position) || 'mid', picks, []);
        if (member && member.sub) this.confrontSubs.set(ps.playerId, { ...member.sub, committed: true });
        else this.reportError(`confront draft ${ps.playerId}`, (member && member.error) || 'illegal 对抗期 pick'); // i18n-ignore: 服务端内部日志
      }
      if (this.confrontSubs.has(ps.playerId)) continue;
      if (ps.botControlled) this.botConfront(ps);
    }
    // 怪物卡池收尾（2026-11-03）：所有 sub 都已落到 confrontSubs（上面的 botConfront 也要能看到商店），
    // 再把 ps.monsterShop / ps.monsterDraft 摘掉。关掉时整段不执行。
    if (this.monsterShopOn) for (const ps of this.confrontActors()) closeMonsterShop(this, ps);
    // 收尾帧（2026-11-03）：商店已摘掉 ⇒ monsterShopFrame 返回 { open:false, slots: [] }，客户端据此收起面板
    if (this.monsterShopOn) {
      for (const ps of this.confrontActors()) {
        try { if (ps.playerId) this.sendTo(ps.playerId, monsterShopFrame(this, ps)); } catch (e) { this.reportError('monster shop close', e); }
      }
    }
    this.confront = new Map(this.confrontSubs);
    this._confrontDoneRound = this.round;
    const rosterMs = Math.max(0, Number(this.huntCfg().rosterMs) || 0);
    if (rosterMs > 0) {
      // 公示期沿用改造前的阶段口径：phase = CONFRONT + stage 'roster'。休整已经结束（ps.endPrep 已跑），把阶段切回来
      // 让休整意图（g.ready / g.buy / 商店 / 投放）与「取消准备」都被阶段闸门挡住，同时客户端照旧用
      // m.public.confront.roster = { until, ms } 播 5 s 名单。
      this.phase = PHASE.CONFRONT;
      this.confrontStage = 'roster';
      this.confrontRosterAt = this.sched.now();
      this.setDeadline(rosterMs / 1000, () => this.finishConfrontRoster());
      this.markPublic();
      return;
    }
    this.confrontStage = null;
    this.startCombat();
  }

  /** The roster hold expired: the battles start (the PREP itself already ended; the freeze happened in finishConfront). */
  finishConfrontRoster() {
    if (this.phase !== PHASE.CONFRONT || this.confrontStage !== 'roster') return;
    this.setDeadline(0);
    this.confrontStage = null;
    this.startCombat();
  }

  /**
   * The interventions aimed at a player's wave (each attacker hits exactly one target, so 0 or 1 here — a list keeps it
   * safe whatever the pairing did). `null` when nothing was submitted.
   * @param {object} ps
   * @returns {object[]}
   */
  confrontFor(ps) {
    // never apply a previous round's applied set: only THIS round's active 对抗期 has one (startRound clears it, and
    // the active guard keeps a direct call from re-deploying stale placements)
    if (!this.confrontActive() || !this.confront || !this.confront.size) return [];
    return [...this.confront.values()].filter((s) => s && s.target === ps.playerId);
  }

  /** The template routes of the round's wave (the gates live here, not on the stage). */
  _confrontRoutes() {
    const tplId = this.wave && this.wave.templateId;
    const tpl = tplId ? this.gd.wave(tplId) : null;
    const routes = tpl && Array.isArray(tpl.routes) ? tpl.routes : [];
    const leader = !!(tpl && (tpl.kind === 'boss' || tpl.kind === 'hidden'));
    return { routes, leader };
  }

  /**
   * 一条投放路线：**同门 + 同移动方式**的模板路线，没有就**合成一条从目标门出发的路线**（2026-11-05 修 bug）：
   *
   * 旧实现找不到同门路线时静默回落到「任意同移动方式的路线」（`routes.findIndex(motionOk)`），而 `data/waves.json`
   * 里 R1–R3 的模板 `act1autochess_01/02/03` **根本没有上门路线**（routes 的 start 全是 (9,10)），
   * 于是「投到上门」= 静默变成下门（业主 2026-11-05 报障）。现在改成合成路线：
   *
   *   · 形态与模板 routes 的元素同构（`{ motion, start, end, checkpoints }`），以**同 motion 的第一条模板路线**为模板，
   *     只把 `start` 换成目标门的门格；同 motion 一条都没有才用任意路线的 `end` / `checkpoints`（motion 仍按怪物自己的
   *     移动方式写死成 WALK / FLY，免得拿 FLY 的骨架给走地怪）。
   *   · 门格坐标**不硬编码**，三级推导（见 `_confrontGateStart`）：① 模板里别的路线已经有这个门的起点 → 借用它的坐标
   *     （escaped 场是 18 列，普通场是 10 列）；② 舞台 `data/stages.json` 的 `S`（tile_start）格子里 gateOf === 目标门的那个，
   *     优先与参照起点同列；③ 用 gateOf 反推 pen 分界行（最小 r 使 gateOf([r, col]) === gate）。
   *
   * **门的分界到底是多少**（对齐说明，客户端不在本次改动范围）：
   *   `waves.js:279` 的 `gateOf` 是**客户端 preview 栏的 pen 口径** —— target = 起点行 + 6（领袖场 +13），
   *   再与 `PEN_UPPER_ROW = 18` 比 ⇒ 起点行 ≥ 12 才算上门（行 9–11 全是下门）。普通场（19×21，`S` 在 (9,10) /
   *   (12,10)）就是这个分界；客户端 `ui/shopBar.js:201` 用 `GEO.FIELD.r1 - 1 = 11` 当分界，比服务端**早一行**，
   *   那是客户端自己的近似（本文件不改客户端，只记下正确分界 = 起点行 ≥ 12 = 上门）。
   *
   * 返回值是**索引 + 可选路线**：调用了 `confrontRouteFor`（只回索引）的老调用方行为不变，
   * 需要「真的从上门出来」的调用方（applyConfront / _confrontBossSpawns / applyCoopHunt）把 `route` 挂到 spawn 上
   * —— sim 的 `spawns.js` 用 `opts.route ?? routes[routeIndex]`，所以合成路线能生效，且**不污染** `this.wave.routes`
   * （那是 `gd.wave()` 的共享数据数组，push 进去会串到同模板的所有对局）。
   * @param {string} enemyKey @param {'upper'|'lower'} gate
   * @returns {{ routeIndex: number, route: object|null }} route = null ⇒ 用模板路线，无需覆盖
   */
  confrontRoutePlanFor(enemyKey, gate) {
    const en = (this.data && this.data.enemies) || {};
    const fly = !!(en[enemyKey] && en[enemyKey].isFlyEnemy);
    const { routes, leader } = this._confrontRoutes();
    if (!routes.length) return { routeIndex: 0, route: null };
    const motionOk = (r) => (fly ? r.motion === 'FLY' : r.motion !== 'FLY' && r.motion !== 'E_NUM');
    const j = routes.findIndex((r) => motionOk(r) && gateOf(r.start, leader) === gate);
    if (j >= 0) return { routeIndex: j, route: null };
    // 同门路线不存在 ⇒ 合成：以同 motion 的第一条为骨架，把 start 换到目标门的门格
    const ref = routes.findIndex(motionOk);
    const skeleton = routes[ref >= 0 ? ref : 0] || {};
    const start = this._confrontGateStart(gate, skeleton.start, leader);
    const copyPair = (v) => (Array.isArray(v) ? v.slice(0, 2) : null);
    const end = copyPair(skeleton.end) || copyPair(start) || [0, 0];
    const checkpoints = Array.isArray(skeleton.checkpoints)
      ? skeleton.checkpoints.map((cp) => (Array.isArray(cp) ? cp.slice() : cp))
      : [];
    return {
      // routeIndex 仍指向同 motion 的骨架：老调用方（只认索引）拿到的是一条「门不对但走得通」的路线，不会崩；
      // 新调用方再加 route 覆盖，真正从上/下门出来。
      routeIndex: ref >= 0 ? ref : 0,
      route: { motion: fly ? 'FLY' : 'WALK', start, end, checkpoints },
    };
  }

  /**
   * 目标门的**门格**坐标（`confrontRoutePlanFor` 的合成起点）。三级推导，全部走现成的 `gateOf` 判据，不硬编码坐标：
   *   ① 模板里别的路线已经有这个门的起点 → 直接借用（含列号；escaped 场是 18 列，普通场是 10 列）；
   *   ② 舞台 `data/stages.json` 的 `S` 字形门格（`tile_start`）里 gateOf === 目标门的：优先与参照起点同列的那个。
   *      普通场实测 `S` 在 (9,10) / (12,10) / (18 列) / (15,7)，同列筛完只剩 (9,10) 下门 / (12,10) 上门；
   *   ③ 反推 pen 分界行：最小的 r 使 `gateOf([r, 参照列]) === gate`（普通场上门 = 12，领袖场 = 5），
   *      与 `waves.js` 的 `PEN_UPPER_ROW = 18` − 行偏移（6 / 13）同一个结论。
   * 全部落空 → 原样返回参照起点（最后兜底，至少不产生非法坐标）。
   * @param {'upper'|'lower'} gate @param {number[]|null} refStart 参照起点 @param {boolean} leader
   * @returns {number[]} [row, col]
   */
  _confrontGateStart(gate, refStart, leader) {
    const { routes } = this._confrontRoutes();
    const ref = Array.isArray(refStart) ? refStart.slice(0, 2) : null;
    // ① 模板里已有的同门起点
    for (const r of routes) {
      if (Array.isArray(r && r.start) && gateOf(r.start, leader) === gate) return r.start.slice(0, 2);
    }
    const colHint = ref && Number.isFinite(ref[1]) ? ref[1] : null;
    // ② 舞台的 S 字形门格（同列优先）
    const rows = Array.isArray(this.stage && this.stage.rows) ? this.stage.rows : [];
    let fallback = null;
    for (let r = 0; r < rows.length; r++) {
      const line = typeof rows[r] === 'string' ? rows[r] : Array.isArray(rows[r]) ? rows[r].join('') : '';
      for (let c = 0; c < line.length; c++) {
        if (line[c] !== 'S') continue;
        if (gateOf([r, c], leader) !== gate) continue;
        if (colHint != null && c === colHint) return [r, c];
        if (!fallback) fallback = [r, c];
      }
    }
    if (fallback) return fallback;
    // ③ 反推 pen 分界行（普通场上门 = 12 行）
    const c = colHint ?? 10;
    for (let r = 0; r < GEO.ROWS; r++) if (gateOf([r, c], leader) === gate) return [r, c];
    return ref || [GEO.ROWS - 1, c];
  }

  /**
   * 一条投放路线的**索引**（兼容入口，老调用方只认整数）。
   * 需要「真的从目标门出来」的调用方请用 `confrontRoutePlanFor` 并把它的 `route` 挂到 spawn 上
   * （sim 的 `spawns.js` 用 `opts.route ?? routes[routeIndex]`）；这里只回索引 = 合成路线的骨架索引。
   * @param {string} enemyKey @param {'upper'|'lower'} gate
   * @returns {number} 模板 routes 的下标（永远可索引）
   */
  confrontRouteFor(enemyKey, gate) {
    return this.confrontRoutePlanFor(enemyKey, gate).routeIndex;
  }

  /**
   * 预设路线的几何 / 速度 / 行程（服务端权威）：
   *   WALK 用流场格数（与 sim 同一口径），FLY 用直线；速度 = enemy.moveSpeed × MOVE_SCALE。
   * 返回 null = 路线不存在 / 不可达 / 与怪物移动方式不匹配。
   */
  confrontRouteMetrics(routeIndex, enemyKey) {
    const { routes } = this._confrontRoutes();
    const r = routes[routeIndex];
    if (!r) return null;
    const motion = String(r.motion || '').toUpperCase().startsWith('F') ? 'FLY' : 'WALK';
    const fly = !!(this.data && this.data.enemies && this.data.enemies[enemyKey] && this.data.enemies[enemyKey].isFlyEnemy);
    if ((motion === 'FLY') !== fly) return null;
    if (!this._stageGrid) {
      const stage = this.stage || {};
      this._stageGrid = new Grid({ ...stage, legend: stage.legend || stage.tiles || null }, GEO.NORMAL_RECT);
    }
    const grid = this._stageGrid;
    const legs = compileRoute(r, GEO.NORMAL_RECT).filter((l) => l.t === 'move');
    let prev = Array.isArray(r.start) ? r.start : null;
    let len = 0;
    for (const leg of legs) {
      const next = [leg.r, leg.c];
      if (!prev) { prev = next; continue; }
      if (motion === 'FLY') len += Math.hypot(next[0] - prev[0], next[1] - prev[1]);
      else {
        const f = grid.flowField(next[0], next[1]);
        const k = prev[0] * GEO.COLS + prev[1];
        const d = f ? grid.fieldLength(f, k) : Infinity;
        if (!Number.isFinite(d)) return null;
        len += d;
      }
      prev = next;
    }
    const en = this.gd.enemy(enemyKey) || {};
    const speed = Math.max(0.01, Number(en.moveSpeed) || 1) * MOVE_SCALE;
    return { motion, len, travel: len / speed };
  }

  /**
   * The monsters ONE receiver faces this round — every intervention aimed at `ps`, as ONE batch in submission order.
   * The bounty's numerator and denominator are both read from THIS batch: the receiver's own wave (the round's normal
   * monsters included) never enters the count, so killing the whole wave pays nothing unless the monsters were placed
   * by the opponent. A `sub` not in the applied map (a direct call / test) is added as its own batch.
   * @returns {Array<{ s: object, p: object }>}
   */
  _confrontIncoming(ps, sub = null) {
    const batch = [];
    for (const s of this.confrontFor(ps)) for (const p of s.picks || []) batch.push({ s, p });
    if (sub && Array.isArray(sub.picks) && !batch.some((x) => x.s === sub)) {
      for (const p of sub.picks) batch.push({ s: sub, p });
    }
    return batch;
  }

  /**
   * Replace originals of a player's wave with one attacker's monsters:
   *   * originals worth **Σ the money this submission actually paid** (2026-11-06 价值同源；旧口径 `share × wave value`)
   *     are dropped at random, closed with the whole monsters nearest that value;
   *   * the placed monsters are inserted together at the chosen position (25 / 50 / 75 % of the round's monster count),
   *     each on the route matching its gate and movement;
   *   * the 事件期 boss 格's bosses (sub.bosses) replace NOTHING and enter after every other spawn (_confrontBossSpawns).
   * @param {object[]} spawns the player's original SpawnSpecs
   * @param {{ picks: object[], bosses?: object[], position: string, ratio: number }} sub
   * @param {object} ps the TARGET player
   * @returns {object[]} the modified spawn list
   */
  /**
   * 赏金档倍速（业主 2026-10-31「赏金档可选倍速，玩家自己调整」）：把这一回合**官方波次**的每只 count 乘上倍数。
   * 控怪档不吃它 —— 那一档是固定「官方 1.5 倍」口径（CONFRONT_VOLUME_SHARE），两条口径不叠加。
   * 上限沿用单 action 的 50 只（waves.js MAX_ACTION_UNITS），避免一次刷出超规格的一坨。
   */
  applyVersusSpeed(spawns) {
    const mul = this.isVersus && !this.isConfrontRule() ? (this.versusSpeed || 1) : 1;
    if (mul === 1 || !Array.isArray(spawns)) return spawns;
    return spawns.map((s) => ({ ...s, count: Math.max(1, Math.min(50, Math.round((Number(s && s.count) || 1) * mul))) }));
  }

  applyConfront(spawns, sub, ps) {
    const bosses = sub && Array.isArray(sub.bosses) ? sub.bosses : [];
    const picks = sub && Array.isArray(sub.picks) ? sub.picks : [];
    // 纯玩家出怪（confrontPurePlacement）：官方怪一律不进守方波次，只保留别的攻方已经投进来的（confrontPlaced），
    // 于是「替换官方份额」这一步在对抗里自然退化成空操作 —— 守方看到的全是玩家投放。
    const pure = typeof this.confrontPurePlacement === 'function' && this.confrontPurePlacement();
    if (!sub || !Array.isArray(spawns)) return spawns;
    const base = pure ? spawns.filter((s) => s && s.confrontPlaced === true) : spawns;
    if (!pure && (!spawns.length || (!picks.length && !bosses.length))) return spawns;
    // 空投放（业主口径见 confrontPurePlacement 的注释：「没人投放时保持官方波次，否则会出现空波次白送一回合」）：
    // 原来 return base（pure 时 base = []）⇒ 只要有人交了空 picks，守方这一回合**一只怪都看不到**。
    // 改回原样波次（shot: 官方波次 + 其他攻方已投的怪）。
    if (pure && !picks.length && !bosses.length) return spawns.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    // a boss-only placement ([ASSUMED] user 2026-10-21): the free boss 格 replaces nothing — it only appends its bosses
    // 同上：pure 下「只交了 boss」不该把官方波次也一起清掉。
    if (!picks.length) return this._confrontBossSpawns((pure ? spawns : base).map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined })), sub, ps);
    const scale = this.confrontScale();
    // price the originals EXACTLY like the card price / payment prices them (both = 阶位阶梯价 via confrontValueOf),
    // so 「剔掉的价值 = 付掉的钱」在同一条量纲上（2026-11-06）。
    // 2026-11-05：单价与波次价值同源（MONSTER_PRICE_BY_TIER），回合倍率 / 特性档位分都不再进金额。
    const valueOf = (key) => this.confrontValueOf(key, scale);
    const out = base.map((s) => ({ ...s, mods: s.mods ? { ...s.mods } : undefined }));
    // 替换份额 = **这一单实际付掉的钱**（2026-11-06 价值同源）：Σ `monsterPriceOf`（卡面 / 扣款 / 提交同一个函数）。
    // 旧口径 `confrontWaveValue() × sub.ratio` 与玩家实际花掉的钱完全脱钩 —— R13 花 1 价也能剔掉 168 价值的原怪。
    // 现在花多少剔多少（R1 花 1 → 剔到 1 价值；R13 花 100 → 剔到 100 价值），不够一整只就按最接近的整只，
    // 官方波次不够剔时自然剔到没有为止（units 用尽即止）。
    // 同一 receiver 的多次投放**不再互相抵扣**：每一单各自付钱、各自剔自己那一份。`_confrontRemoved` 只留作
    // 本回合累计剔除量的统计 / 审计，不参与目标值计算（旧注释里那套「later ones see 0 left」的口径已废）。
    if (!this._confrontRemoved) this._confrontRemoved = new Map();
    const share = this.confrontSpent(picks);
    const already = Math.max(0, Number(this._confrontRemoved.get(ps.playerId)) || 0);
    // 1) drop originals at random until the target value is (nearly) reached
    const target = Math.max(0, share);
    const units = [];
    const rowValue = new Map();
    out.forEach((s, i) => {
      // another attacker's placement is NEVER a removal candidate: two stacks must not eat each other's monsters
      // (confrontPlaced marks them; the original wave — bounty spawns and data-level unharmful parts included — is fair game)
      if (s && s.confrontPlaced === true) return;
      const cnt = Math.max(1, Math.floor(Number(s.count) || 1));
      const v = Math.max(1, valueOf(s.enemyKey));
      rowValue.set(i, v);
      for (let k = 0; k < cnt; k++) units.push({ i, v });
    });
    // shuffle (seeded), then close the target with the closest of two builds: (a) fill what fits, then add the single
    // remaining unit nearest the gap; (b) the shuffled order's first crossing of the target (and the one before it).
    // The picked set is the one closest to `share × wave value` in value terms, so a coarse wave (a 5 % share smaller
    // than every original) replaces the smallest original or nothing — whichever is closer — instead of overshooting by
    // a whole run; the announced ratio is what actually leaves the wave.
    for (let i = units.length - 1; i > 0; i--) {
      const j = Math.floor(this.rngConfront() * (i + 1));
      [units[i], units[j]] = [units[j], units[i]];
    }
    const totalOf = (list) => list.reduce((sum, u) => sum + units[u].v, 0);
    const take = new Map();
    if (target > 0 && units.length) {
      const greedy = [];
      let left = target;
      for (let u = 0; u < units.length; u++) {
        if (units[u].v > left) continue;
        greedy.push(u);
        left -= units[u].v;
        if (left <= 0) break;
      }
      if (left > 0 && greedy.length < units.length) {
        let best = -1;
        let bestGap = left;
        for (let u = 0; u < units.length; u++) {
          if (greedy.includes(u)) continue;
          const gap = Math.abs(units[u].v - left);
          if (gap < bestGap) { bestGap = gap; best = u; }
        }
        if (best >= 0) greedy.push(best);
      }
      const prefix = [];
      let acc = 0;
      for (let u = 0; u < units.length; u++) {
        prefix.push(u);
        acc += units[u].v;
        if (acc >= target) break;
      }
      const candidates = [greedy, prefix];
      if (prefix.length > 1) candidates.push(prefix.slice(0, -1));
      let bestList = candidates[0];
      for (const c of candidates.slice(1)) {
        const d = Math.abs(totalOf(c) - target);
        const bd = Math.abs(totalOf(bestList) - target);
        if (d < bd || (d === bd && c.length < bestList.length)) bestList = c;
      }
      for (const u of bestList) take.set(units[u].i, (take.get(units[u].i) || 0) + 1);
    }
    // the receiver's running total for this round (see the share note above)
    let removed = 0;
    for (const [i, n] of take) removed += n * (rowValue.get(i) || 0);
    if (removed > 0) this._confrontRemoved.set(ps.playerId, already + removed);
    // 2) apply the drops by REBUILDING the list (splicing while iterating would shift the indexes under us);
    //    a spawn that loses every unit goes away
    const kept = [];
    out.forEach((s, i) => {
      const c = Math.max(1, Math.floor(Number(s.count) || 1));
      const rest = c - (take.get(i) || 0);
      if (rest > 0) kept.push(rest === c ? s : { ...s, count: rest });
    });
    // 3) the placed monsters, together at the chosen position. `confrontSeat` marks the SENDER (the target's client
    //    outlines them and prints P<n> under them) and is also the key settle bills with: a killed / leaked placed
    //    monster is charged to the sender's side (sim/battle/deploy.js confrontKills / confrontLeaks, match/settle.js) —
    //    `sourcePlayerId` stays untouched, it drives the 联防 leak billing.
    const mods = roundMods(scale);
    // 怪物盟约（2026-11-04）：投放者这一回合攒的乘区乘在官方乘区上（monsterShopOn 为假 → merge 原样返回）
    const spawnMods = mergeMonsterBondMods(mods, monsterBondMods(this, this._confrontSubOwner(sub)));
    const start = this._confrontInsertTime(spawns, sub.position);
    const sentBy = Number.isInteger(sub.seat) ? sub.seat : null;
    // 赏金 (final rule, user 2026-10-17): the FIRST four bounty phases pay a fixed 1/1/2/2 by the kill ratio
    // (floor(cap × killed / total)); from the 5th phase on — the R13 最终狩猎 aside — the live formula pays
    // floor(Σ value(killed) / wave value × income × killIncomeShare), with no cap and no per-monster minimum. R13 pays
    // the FIXED finalHuntBounty (25) by the same kill ratio. Each monster carries the share that kill completes
    // (confrontBountyPlan), so a cheap monster can be worth 0 and the running total is exactly the floor above — 64 of
    // the cheapest monsters cannot beat the formula (or 25 on R13).
    //
    // BOTH the numerator and the denominator come from `batch` = the monsters the OPPONENT placed at THIS receiver
    // (confrontFor → _confrontIncoming). The receiver's wave keeps the round's own monsters in it — they are never
    // counted, so wiping out the whole wave pays nothing unless the monster was placed. `bounty.total` is the
    // receiver's batch size (each player may face a different one), `bounty.index` its 0-based slot in that batch.
    const batch = this._confrontIncoming(ps, sub);
    const offset = batch.findIndex((x) => x.s === sub);
    const total = batch.length;
    const coins = this.confrontBountyPlan(batch.map((x) => x.p));
    // 2V2 事件期 赏金嗅觉: each monster the opponent placed pays its killer +2 coins (banked 赏金) — the entry belongs to
    // the RECEIVER of the placement, so it is added here once per placed monster.
    const scent = typeof this.eventBountyBonusOf === 'function' ? this.eventBountyBonusOf(ps) : 0;
    sub.picks.forEach((p, i) => {
      // 路线（2026-11-05）：玩家显式给的 routeIndex 优先；否则按门择路，**没有同门路线就合成一条**
      // （`confrontRoutePlanFor.route`，由 sim 的 `spawns.js` 用 `opts.route ?? routes[routeIndex]` 生效）。
      const preset = Number.isInteger(p.routeIndex) ? p.routeIndex : null;
      const routing = preset == null ? this.confrontRoutePlanFor(p.enemyKey, p.gate) : null;
      kept.push({
        time: Number.isFinite(p.time) ? p.time : start + i * 1,
        enemyKey: p.enemyKey, count: 1, interval: 0,
        routeIndex: preset == null ? routing.routeIndex : preset,
        ...(routing && routing.route ? { route: routing.route } : {}),
        mods: { ...spawnMods }, ownerPlayerId: ps.playerId, confrontSeat: sentBy, confrontPlaced: true,
        // 对抗投放的扣血口径（2026-11-06）：`countInTotal: false` 只把它移出官方「只数 / 完美作战」计数 ——
        // 漏过**不再免费**：settle 按 `confrontSeat` 归到这一笔、按 `confrontPrice`（= 阶位阶梯价）扣守方，
        // 被击杀则按同一价值扣投放者。价格在 sim 里只是数据，结算口径在 match/match/settle.js。
        confrontPrice: valueOf(p.enemyKey),
        countInTotal: false,
        // 经济补助: killing a monster the opponent placed pays its killer (the sim's bounty mechanic — the killer's
        // player, a 联防 helper included); anyone the death cannot be credited to pays the wave's owner instead.
        // `total`/`index` are the RECEIVER's batch (the monsters the opponent placed at this player), so the UI can
        // show "killed / total" of the opponent's placement without ever counting the wave's own monsters.
        bounty: { coins: (coins[offset + i] || 0) + scent, ownerPlayerId: ps.playerId, total, index: offset + i, bank: true },
      });
    });
    return this._confrontBossSpawns(kept, sub, ps);
  }

  /**
   * The 事件期 boss 格's bosses on a wave (user 2026-10-21): appended AFTER every spawn the wave holds at this point
   * ([ASSUMED] start = max(time) + 10, +1 per boss — “只能排在波次最后入场”), each on the route of its gate, `count: 1`,
   * `countInTotal: false` (it is not one of the round's own scheduled enemies — but a leak is NOT free: settle bills it
   * to the sender's side through `confrontSeat` × `confrontPrice`, 2026-11-06) and `confrontSeat` = the sender's seat.
   * The bounty pays the KILLER the pool's highest coin tier DIRECTLY as gold —
   * `bank: false` (economy.js addCoins → pendingFunds), never the 坎诺特 赏金 account, and it carries no batch
   * total / index (bosses are not part of the placement's bounty batch). A missed boss pays nothing.
   * @param {object[]} list the spawn list being built (mutated: the bosses are pushed onto it)
   * @param {{ bosses: object[], seat?: number }} sub
   * @param {object} ps the TARGET player (ownerPlayerId / bounty owner — the bounty pays whoever kills it)
   * @returns {object[]} the same list
   */
  _confrontBossSpawns(list, sub, ps) {
    const bosses = Array.isArray(sub.bosses) ? sub.bosses : [];
    if (!bosses.length) return list;
    const mods = roundMods(this.confrontScale());
    // 怪物盟约（2026-11-04）：事件期 boss 也是投放者投的，吃同一份乘区
    const spawnMods = mergeMonsterBondMods(mods, monsterBondMods(this, this._confrontSubOwner(sub)));
    const sentBy = Number.isInteger(sub.seat) ? sub.seat : null;
    let time = list.reduce((n, s) => Math.max(n, Number(s && s.time) || 0), 0) + 10;
    for (const p of bosses) {
      // 2026-11-05：与投放怪同一条择路规则（没有同门路线就合成一条，挂在 spawn.route 上让 sim 用）
      const routing = this.confrontRoutePlanFor(p.enemyKey, p.gate);
      list.push({
        time: time++, enemyKey: p.enemyKey, count: 1, interval: 0,
        routeIndex: routing.routeIndex,
        ...(routing.route ? { route: routing.route } : {}),
        mods: { ...spawnMods }, ownerPlayerId: ps.playerId, confrontSeat: sentBy, confrontPlaced: true,
        // 与投放怪同一套结算：漏过 / 被击杀按这个价值扣（settle 的 confrontKills / confrontLeaks）
        confrontPrice: this.confrontValueOf(p.enemyKey),
        countInTotal: false,
        bounty: { coins: this.confrontBossCoin(p.enemyKey), ownerPlayerId: ps.playerId, bank: false },
      });
    }
    return list;
  }

  /**
   * 投放者（攻方）的 PlayerState：`this.confront` / `this.confrontSubs` 都是 `Map<playerId, sub>`，而
   * `applyConfront` / `_confrontBossSpawns` 只拿到 sub 本身 —— 靠**引用相等**反查回攻方，怪物盟约的乘区按他算。
   * 取不到（直测 / 老对局 / sub 不在表里）→ null（盟约乘区整段不生效，与改造前一致）。
   * @param {object} sub
   * @returns {object|null}
   */
  _confrontSubOwner(sub) {
    if (!sub) return null;
    const map = this.confront && this.confront.size ? this.confront : this.confrontSubs;
    if (!map || typeof map.entries !== 'function') return null;
    for (const [pid, s] of map) if (s === sub) return this.players.get(pid) || null;
    return null;
  }

  /** The insertion time of a position: walk the ORIGINAL wave by count to the 25 / 50 / 75 % mark. */
  _confrontInsertTime(spawns, position) {
    const frac = position === 'front' ? 0.25 : position === 'back' ? 0.75 : 0.5;
    const total = spawns.reduce((n, s) => n + Math.max(1, Math.floor(Number(s.count) || 1)), 0);
    const mark = Math.max(1, Math.round(total * frac));
    const ordered = spawns.slice().sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0));
    let seen = 0;
    for (const s of ordered) {
      seen += Math.max(1, Math.floor(Number(s.count) || 1));
      if (seen >= mark) return Number(s.time) || 0;
    }
    return Number(ordered.length ? ordered[ordered.length - 1].time : 0) || 0;
  }
}
