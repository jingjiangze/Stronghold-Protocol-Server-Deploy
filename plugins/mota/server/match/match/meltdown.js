// server/match/match/meltdown.js — 海克斯熔毁协议 (this fork): the endless-mode shop that opens after a 隐秘 Boss.
//
// 流程：无尽模式下 `_finalDone(hidden=true)` 不再直接结束对局，而是 `meltdownOpen(cb)` 开商店；
// 每个存活玩家拿到 4 个栏位（① 主盟约专属 6 阶装备、② 炫彩、③ 黄金、④ 白银海克斯），各自限购 1 件、
// 可以一件都不买直接关闭；所有真人关闭后执行 cb（`startRound(round + 1)`）。
//
// 代价（本局永久累计，写进 `this.meltDebt`）：
//   · 装备：`allStats` 敌方全属性 +10%（本局剩余回合）
//   · 海克斯：每波从 dmg(受伤减免) / round(每回合全属性) / deploy(部署回复) 里随机一种，数值按品阶：
//       炫彩 10 / 3 / 10，黄金 7 / 2 / 7，白银 4 / 1 / 4
//   · `dmg` 折算成敌人的等效生命（1/(1-r)）挂在 hpMul 上；`round` 每回合往 `growth` 里加一次；
//     `allStats` 直接进 `meltMul()`。三者在 `_sanitizeSpawns` 里与 endlessMul 相乘 —— 那个函数是敌人属性的咽喉。
//
// 海克斯卡池：只取 `category === 'combat'`，并剔除 `tianxuan_*` / `bx_*`（羁绊专属）、名称含「增援 / 凭证 / 天选」。
// 每个品阶的池在本局内逐波消耗，抽空后该栏 `exhausted: true`（客户端画「海克斯等阶达到极限」）。

import { createRng, deriveSeed } from '../../sim/rng.js';
import { PHASE, ERR } from '../../../shared/constants.js';
import { HEXES, hexById } from '../../../shared/hexes.js';
import { OK, fail } from './common.js';
import { freeSlot } from '../board.js';
// 商店设施三项效果（业主 2026-10-30）：商店等级 / 协同资金获取 / 装备造价
import { shopLevelOf, equipPriceOf } from './projectEffects.js';
import { isShopItem } from '../../sim/simdata.js';

/** 三种代价 × 三档数值：品阶 → 数值 */
const COST_VALUE = {
  prismatic: { dmg: 10, round: 3, deploy: 10 },
  gold: { dmg: 7, round: 2, deploy: 7 },
  silver: { dmg: 4, round: 1, deploy: 4 },
};
const HEX_GRADES = ['prismatic', 'gold', 'silver'];
const COST_KEYS = ['dmg', 'round', 'deploy'];
const GEAR_PENALTY = 10;

/** 个人资金价目（业主 2026-10-26：熔毁商店也可以直接花个人资金买，不叠 debuff）。按档定价，数值可调。 */
const FUNDS_PRICE = { prismatic: 8, gold: 5, silver: 3, gear: 6 };

/**
 * 藏品稀有度档位（失与得用，2026-11-06）：`relics-87` 现在只发 red(73) / blue(14)，`mid` 是客户端已经认的
 * 中间档（将来数据侧出现时不必改这里）。官方口径「产出跟投入挂钩」⇒ 只允许**同档或降档**，不同档位按 rank 比。
 * rank 0 = 未知档（数据缺 tier）⇒ 不设门（宁可换得到，也不要因为数据缺字段把选项锁死）。
 */
const RELIC_TIER_RANK = { blue: 1, mid: 2, red: 3 };

/**
 * 一张熔毁卡的个人资金价（0 = 不能拿钱买）。
 * 装备栏固定 gear 档；其余按 card.grade（prismatic / gold / silver）。
 * @param {any} card
 * @returns {number}
 */
/** 一件装备的资金价：跟装备自己的 items.json.price 走（×2 换到储备单位，夹 2..12）。
 *  商店设施「装备造价」每级再 −1（下限 2，业主 2026-10-30 的平衡口径）。 */
function meltItemPrice(rec, equipLevel = 0) {
  return equipPriceOf(Math.max(2, Math.min(12, Math.round((Number(rec && rec.price) || 2) * 2))), equipLevel);
}

function meltFundsPrice(card) {
  if (!card || card.exhausted) return 0;
  if (card.kind === 'gear') return FUNDS_PRICE.gear;
  // 业主 2026-10-27：商店卖的是「游戏内装备」，价格就跟装备自己的 `items.json.price` 走（×2 换算成储备单位），
  // 不再只按品阶定死。品阶价只作为兜底（老局 / 卡片缺 price 时）。
  if (Number.isFinite(card.price) && card.price > 0) return card.price;
  return FUNDS_PRICE[card.grade] || 0;
}

/**
 * 扣款（业主 2026-10-30「其他人买装备等优先消耗团队储备」）：**先扣团队储备，不够再扣本回合资金**。
 * 个人储备这一层已下线（economy.js 的 econSplitLeftover 不再往它写），所以这里完全不读它。
 * 余额不足返回 false（调用方已先判过，这里只兜底，并回滚已扣的团队池）。
 */
function es_safe_spend(ps, price) {
  const m = ps && ps.match;
  let left = Math.max(0, Math.floor(Number(price) || 0));
  if (!left) return true;
  const team = m ? Math.max(0, Math.floor(Number(m.teamReserve) || 0)) : 0;
  const fromTeam = Math.min(team, left);
  if (fromTeam > 0) { m.teamReserve = team - fromTeam; left -= fromTeam; }
  if (left <= 0) return true;
  const funds = Math.max(0, Math.floor(Number(ps.funds) || 0));
  if (funds < left) { if (fromTeam > 0) m.teamReserve = team; return false; }
  ps.funds = funds - left;
  return true;
}

/** 这一页能拿钱买装备的余额 = 团队储备 + 本回合资金。 */
function es_spendable(ps) {
  const m = ps && ps.match;
  return Math.max(0, Math.floor(Number(m && m.teamReserve) || 0)) + Math.max(0, Math.floor(Number(ps && ps.funds) || 0));
}

/** 0..n-1 洗牌（用调用方给的 rng，保证可复现） */
function shuffled(list, rng) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * 这条藏品的效果在本局**是否真的生效**（业主 2026-11-01「完成完整肉鸽」的透明化）：
 * 目前只有 `enemy` / `enemyRank`（敌人乘区）与 `immediate` / `deployCap` / `lpCap`（入手即结算）接了实现；
 * `rule.*`（57 条，官方 DSL，需逐条语义）、`ally*`、`price`、`income`、`hand`、`enemyMove` 等**尚未接入**。
 * 返回 false 的藏品仍会进背包、仍显示在 HUD，但会标注「未实装」，避免玩家以为它已经生效。
 */
/**
 * 已接进引擎的 **effect 键**（非 rule 类藏品）。
 * 2026-11-03：补齐 7 个此前被当成「未实装」的键——抽卡池只发这里认的藏品，缺一个就少一堆牌。
 */
export const RELIC_APPLIED_KEYS = Object.freeze(['enemy', 'enemyRank', 'immediate', 'deployCap', 'lpCap',
  'ally',          // 全队 攻/防/生命 百分比（relicAllyMul）
  'allyElite',     // 精锐干员 攻击 百分比（per-unit，round.js 的精英分支）
  'allyPerBench',  // 待部署区每有一名干员叠一层（relicAllyMul）
  'income',        // 进入休整期资金额外 +N（applyRelicRoundEconomy）
  'price',         // 商店价格（干员 / 装备 / 五阶以上 / 首个购买）
  'refreshLimit',  // 休整期收费刷新上限（economy.refresh）
  'hand',          // 待部署区容量 −N（pieces.handCap / freeHandSlot）
]);
/** 已接进引擎的 rule id（语义逐条照 relics.json 的官方 desc，不要按字段名猜）。 */
export const RELIC_APPLIED_RULES = Object.freeze([
  'ussuri',        // 敌方 +35%，每回合 +10%，最低 35%（relicEnemyMul）
  'leaderHalve',   // 敌方 +35%，领袖额外 +20%/+50%，≥4 盟约减半（relicEnemyMul + activeBondsOf）
  'enemyDmgTaken', // 敌人受伤 −20% ⇒ 等效生命 +25%（hp 等价近似）
  'enemyCount',    // 敌人数量 +50%（combat.js 的 spawn count，mul 是增量）
  'fundsDrain',    // 每回合失去 1 资金，最多 5（applyRelicRoundEconomy）
  'kingCrystal',   // 休整期资金 +5（另两项 LP/价格待接，见清单）
  'loseAllFunds',  // 入手清空资金（悬赏减半待赏金钩子）
  'postBattleFunds', // 每场战斗 +1 资金（applyRelicPostBattle；悬赏 +50% 待钩子）
  'choiceFunds',   // 每次选择 +8（applyRelicChoiceFunds；入手 +3 走 immediate）
  'enemyRamp',     // 战斗开始那一档 +step（战斗内每 10 秒递增缺通道，未接）
  'atkPerBond',    // 己方攻击：每激活盟约 +10%（relicAllyMul → sim 的 relicMods 通道）
  'atkPerRound',   // 己方攻击：每过一回合 +15%，最多 10 次（同上）
  'atkPerEquip',   // 棋盘每件装备：攻击 +10% / 生命 +20%（relicAllyMul）
  'atkPerBenchItem', // 待部署区每件装备：攻击 +10%（上限 +150%）
  'homeCooked',    // 生命/攻击 +20%，每场完美作战再 +10%（ps.relicPerfectBattles）
  'atkPerSpend',   // 每花 5 资金：全队攻击 +5%（ps.totalSpent）
  'hpdefPerSpend', // 每花 3 资金：全队生命/防御 +3%
  'aspdPerSpend',  // 每花 3 资金：全队攻速 +7（加法）
  'atkPerNeighbor', // 周围 4 格每有一名干员：攻击 +20%（per-unit，见 battleInput）
  'aspdPerNeighbor', // 周围 4 格每有一名干员：攻速 +30（per-unit）
  'bountyMul',     // 悬赏资金翻倍（relicBountyMul）
  'lpDrainRest',   // 进入休整期 LP −1，最低 1（applyRelicLpDrain；低血时 SP 回复 −20% 那半句未接）
  'bountyKillDeploy', // 初始部署 −3 已由 effect.deployCap 生效（别再扣一次）；「每击杀赏金目标 +1」待击杀计数
  'spawnHpChance', // 每个敌人按概率生命 +extra（combat.js 逐 spawn 用波次 rng 掷一次）
  'atkPerBounty',  // 攻击 +20%，每次完成悬赏再 +20%（ps.relicBountiesDone，封顶 10 层）
  'dmgDealt',      // 「造成伤害 +50%」⇒ 用己方攻击 ×1.5 近似（无独立伤害乘区）
  'eliteAtkPerRound', // 精锐干员每回合攻击 −10%，最多 −50%（per-unit，见 battleInput）
  'eliteHpPerRound',  // 精锐干员每回合生命 −10%，最多 −50%（同上）
  'eliteStatsPerElite', // 场上每有一名精锐：精锐 生命/攻击/防御 +10%（per-unit，见 battleInput）
  'eliteAspdPerElite',  // 本场每有一名精锐：精锐 攻速 +10，最多 10 层（同上）
  'eliteAtkPerMerge',   // 每有一次 4 阶以上合成：精锐 攻击 +40%，最多 4 层（ps.relicEliteMerges）
  'aspdPerNegative',  // 每个负面藏品：全队攻速 +35（relicAllyMul，数自己持有的 negative 藏品）
  'hpPerTier4Buy',    // 每买一次 4 阶以上干员：全队最大生命 +5%，最多 10 层（ps.relicTier4Buys）
  'kingVessel',       // 上一回合没掉目标生命：全队生命 +80%；连续 3 回合 +200%（ps.relicNoLossStreak）
  'probe',            // 入手后下一休整期资金 −1；每过 2 回合敌方 攻/生 +10%（relicEnemyMul）
  'recruitTopBond',   // 进新回合随机获得一名「当前盟约层数最高」的干员（+1 部署由 effect.deployCap）
  'consumableFree',   // 一次性道具用掉后返还价格（relicConsumableUsed，挂 items.js 的两个消耗点）
  'consumableRefund', // 一次性道具用掉后再发一个（每回合最多 3 次，同上）
  'camoRanged',       // 远程干员攻击 +50%（per-unit，见 battleInput；迷彩本体在引擎内，这里只接加攻）
  'camoAura',         // 攻击范围内的其他干员攻击 +10%，可叠加（per-unit，同上）
  'hpIfDp',           // 场上部署费用合计 ≥ 阈值：全队最大生命 +150%（relicAllyMul，费用取 gd.chess().stats.cost）
  'spInit',           // 所有干员初始技力 −10（relicAllyMul → 引擎 initSp 通道）
  'spOnDeploy',       // 所有干员部署时失去 15 点技力（同一条 initSp 通道：初始技力减少、夹在 0 以上）
  'shelter',          // 所有我方单位获得 10% 庇护（引擎 dmgTakenMul 通道；低血再 +35% 那半句要战斗内 HP，未接）
  'stunOnDeploy',     // 随机 N 名干员部署时晕眩 10s，N 每回合 +1、最多 4（per-unit relicMods.stunOnDeploy）
  'openingDebuff',    // 开战最多 5 名随机干员中负面（本条用「晕眩 10s」近似，见 relicStunRule）
  'startDebuff',      // 开战 10 秒：我方 攻击 −20% / 攻速 −20 / 技力回复 −20%（buff duration 通道）
  'neuralDps',        // 全场每秒 10 点真实伤害（buff interval/onTick）
  'fogOnDeploy',      // 部署后 60 秒内每秒 2% 最大生命真实伤害（同上，带 duration）
  'spRegenStack',     // 每用一次技能永久 +0.4 技力回复，最多 5 层（skillStart 钩子）
  'atkAfterSkill',    // 技能触发后 1 秒内攻击 +100%（同上）
  'enemyDefShred',    // 敌方防御 +3000，每次受击 −100、最多 30 次（spec.enemyMods，见 spawns.js）
  'eliteDmgReduce',   // 精英/领袖登场 30 秒内受到伤害 ×0.5（同上）
  'statusDuration',   // 敌方异常状态时长 ×2.5（同上 → applyStatus）
  'shelterOnDebuff',  // 有干员陷入负面后：全体 35% 庇护 + 攻击无视 35% 双防（per-unit 钩子，见 players.js）
  'removeTemp',       // 移除临时部署区（player/pieces.js 的 stow 尊重 ps.relicNoTemp；已有的 temp 一并清掉）
  'survivor',         // 攻击最高的一名干员 攻/防 +20%，每打完一场再 +20%（per-unit，见 battleInput）
]);
export function relicEffectApplied(effect) {
  if (!effect || typeof effect !== 'object') return false;
  if (RELIC_APPLIED_KEYS.some((k) => Object.hasOwn(effect, k))) return true;
  const ru = effect.rule;
  return !!(ru && typeof ru.id === 'string' && RELIC_APPLIED_RULES.includes(ru.id));
}

export class MatchMeltdown {
  /** 惰性建状态（老对局 / 非无尽对局永远不会碰它）。 */
  _melt() {
    if (!this.melt) {
      this.melt = {
        open: false,
        cb: null,
        wave: 0,
        pool: this._meltItemPool(),
        debt: { dmg: 0, round: 0, deploy: 0, allStats: 0 },
        growth: 0,        // 「每回合全属性」的累计（每次 startRound 加一次 debt.round）
        offers: new Map(),
        closed: new Set(),
      };
    }
    return this.melt;
  }

  /**
   * 本局的卡池：只留战斗类，剔掉经济 / 增援 / 羁绊专属，并**按对局模式过滤 `requires.mode`** ——
   * 单人局绝不出现联机专属（协防协议 / 我来兜底 系列），联机局也不出现仅单人可用的条目。
   */
  /**
   * 本局的**装备**卡池（业主 2026-10-26：商店不卖海克斯，改卖装备）：按 tier 分三档
   *   prismatic = tier 6 / gold = tier 4-5 / silver = tier 2-3
   * 剔除：盟约专属（requiresBondId，需对应盟约才合理）、商店隐藏/排除、金色变体。
   */
  _meltItemPool() {
    const pool = { prismatic: [], gold: [], silver: [] };
    const items = (this.gd && this.gd.raw && this.gd.raw.items) || {};
    const gradeOf = (tier) => (tier >= 6 ? "prismatic" : tier >= 4 ? "gold" : tier >= 2 ? "silver" : null);
    for (const [id, rec] of Object.entries(items)) {
      if (!rec) continue;
      if (rec.requiresBondId) continue;
      if (rec.hideInShop || rec.shopExcluded) continue;
      if (rec.isGolden) continue;
      const grade = gradeOf(Number(rec.tier) || 0);
      if (!grade) continue;
      pool[grade].push(id);
    }
    return pool;
  }
  /** 玩家已激活的主盟约里层数最高的一个（只认 isCore）。 */
  _meltMainBond(ps) {
    let best = null;
    const bonds = ps && ps.bonds ? ps.bonds : {};
    for (const [id, st] of Object.entries(bonds)) {
      if (!st || !st.active) continue;
      const rec = this.gd.raw && this.gd.raw.bonds ? this.gd.raw.bonds[id] : null;
      if (!rec || !rec.isCore) continue;
      const layers = Number(st.layers ?? st.stacks ?? st.count ?? 0) || 0;
      if (!best || layers > best.layers) best = { id, layers, rec };
    }
    return best;
  }

  /** 该盟约的专属 6 阶装备（items.json 里 requiresBondId === bondId 且 tier 6）。 */
  _meltBondGear(bondId) {
    const items = this.gd.raw && this.gd.raw.items ? this.gd.raw.items : {};
    for (const rec of Object.values(items)) {
      if (rec && rec.tier === 6 && rec.requiresBondId === bondId) return rec;
    }
    return null;
  }

  /** 开商店：给每个存活玩家发 4 张卡，等他们买完 / 关闭。 */
  /**
   * 开商店：给每个存活玩家发 4 张卡，等他们买完 / 关闭。
   * `opts.resume = true`：由玩家按钮主动打开 —— 关店时**恢复进入前的阶段/截止时间**，而不是推进回合。
   */
  meltdownOpen(cb, opts = {}) {
    const st = this._melt();
    if (!st.open && opts && opts.resume) {
      st.resumePhase = this.phase;
      st.resumeDeadline = this.deadline;
    }
    st.open = true;
    st.cb = typeof cb === 'function' ? cb : null;
    st.wave += 1;
    st.closed.clear();
    st.offers.clear();

    const rng = createRng(deriveSeed(this.seed, `melt:${this.round}:${st.wave}`));
    for (const ps of this.alivePlayers()) {
      st.offers.set(ps.playerId, this._meltDeal(ps, rng));
      ps.dirty();
      this.markPrivate(ps);
    }
    // 停在「结算」：玩家既不能准备也不能出门，只有商店上的两个动作有效。
    this.phase = PHASE.SETTLE;
    this.deadline = 0;
    this.markPublic();
    this.tickerText('海克斯熔毁协议 · 四栏各限购一件', 60);
  }

  _meltDeal(ps, rng) {
    const st = this._melt();
    const cards = [];

    // ① 主盟约专属装备
    const main = this._meltMainBond(ps);
    const gear = main ? this._meltBondGear(main.id) : null;
    cards.push(gear ? {
      kind: 'gear',
      slot: 0,
      itemId: gear.id,
      name: gear.name,
      desc: String(gear.desc || gear.descRaw || '').replace(/\n/g, ' '),
      iconId: gear.iconId || gear.trapId || '',
      tier: 6,
      owner: main ? `${main.rec.name} · ${main.layers} 层` : '',
      source: String(gear.category || ''),
      cost: { type: 'allStats', value: GEAR_PENALTY },
      sold: false,
    } : { kind: 'gear', slot: 0, exhausted: true, name: '', desc: '', cost: null });

    // ②③④ 装备：每品阶从本局池里抽 1 件，抽空即「达到极限」
    const types = shuffled(COST_KEYS, rng);
    HEX_GRADES.forEach((grade, i) => {
      const pool = st.pool[grade];
      if (!pool || !pool.length) {
        cards.push({ kind: 'item', slot: i + 1, grade, exhausted: true, cost: null });
        return;
      }
      const idx = Math.floor(rng() * pool.length);
      const itemId = pool.splice(idx, 1)[0];
      const rec = this.gd.item(itemId) || {};
      const type = types[i % types.length];
      cards.push({
        kind: 'item',
        slot: i + 1,
        grade,
        itemId,
        name: rec.name || itemId,
        desc: String(rec.desc || rec.descRaw || '').replace(/\n/g, ' '),
        iconId: rec.iconId || rec.trapId || '',
        tier: Number(rec.tier) || 0,
        // 出处（业主 2026-10-27：商店要备注装备出处）——取 items.json 的 category：STAT/ECONOMY/BOND/RECRUIT/ON_HIT/...
        source: String(rec.category || ''),
        // 价格取装备自己的 price（×2 换到储备单位，夹在 2..12）：1~3 块的装备 → 2~6，6 阶 4 块 → 8
        price: Math.max(2, Math.min(12, Math.round((Number(rec.price) || 2) * 2))),
        cost: { type, value: COST_VALUE[grade][type] },
        sold: false,
      });
    });
    return { cards, sold: cards.map(() => false) };
  }

  /** g.meltOpen：玩家主动开商店（协同共竞；同一时间只开一次，幂等）。 */
  meltdownRequest(ps) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    if (!String(this.modeId || '').startsWith('mode_xie_')) return fail(ERR.WRONG_PHASE, 'only 协同共竞 has the shop'); // i18n-ignore
    if (![PHASE.PREP, PHASE.ROUND_START, PHASE.SETTLE].includes(this.phase)) return fail(ERR.WRONG_PHASE, 'the shop opens in prep / settle'); // i18n-ignore
    const st = this._melt();
    if (st.open) return OK;
    this.meltdownOpen(null, { resume: true });
    return OK;
  }

  /**
   * g.meltPick { slot, pay? }：买下某一栏（每栏 1 件，买过即售罄）。
   * `pay='funds'` 用个人资金付（不叠 debuff）；缺省/'debuff' 走原来的敌人属性代价。
   */
  meltPick(ps, slot, pay = null) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore: developer error detail
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const offer = st.offers.get(ps.playerId);
    if (!offer) return fail(ERR.BAD_TARGET, '没有你的栏位'); // i18n-ignore: developer error detail
    if (!Number.isInteger(slot) || slot < 0 || slot >= offer.cards.length) return fail(ERR.BAD_TARGET);
    const card = offer.cards[slot];
    if (!card || card.exhausted) return fail(ERR.BAD_TARGET, '这一栏已经到了极限'); // i18n-ignore
    if (offer.sold[slot]) return fail(ERR.ALREADY, '该栏已售罄'); // i18n-ignore: developer error detail

    // 复审计 2026-10-27：先判支付能力并扣款，**再**发装备。
    // 旧顺序（先 acquireItem 再判余额）在余额不足时会把装备塞进手牌、只回滚售罄标记 ⇒ 可白嫖。
    const price0 = meltFundsPrice(card);
    if (pay === 'funds') {
      if (!(price0 > 0) || !(es_spendable(ps) >= price0)) return fail(ERR.NO_FUNDS);
      if (!es_safe_spend(ps, price0)) return fail(ERR.NO_FUNDS);
    }
    offer.sold[slot] = true;
    card.sold = true;

    if ((card.kind === 'gear' || card.kind === 'item') && card.itemId) {
      // 手牌满就不成交（卡片保持未售，避免「付了代价却拿不到东西」）
      if (typeof freeSlot === 'function' && freeSlot(ps.hand) < 0) { offer.sold[slot] = false; card.sold = false; return fail(ERR.HAND_FULL); }
      try { ps.acquireItem(card.itemId, { source: 'melt' }); }
      catch (e) { this.reportError('melt item', e); }
    }
    if (card.cost && pay !== 'funds') {
      const key = card.cost.type;
      st.debt[key] = (Number(st.debt[key]) || 0) + card.cost.value;
    }

    ps.recompute();
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** 商店等级（采购等阶上限）：R1-2 → 1，R3-4 → 2 …… 封顶 6（业主 2026-10-27：目录式商店） */
  meltShopLevel() {
    const base = Math.min(6, Math.max(1, Math.ceil((Number(this.round) || 1) / 2)));
    // 商店设施「商店等级」每级 +1（业主 2026-10-30「升级是提示商店等级」）；硬顶在 projectEffects 里夹住
    return shopLevelOf(base, this.teamProjects && this.teamProjects.shopLevel);
  }

  /**
   * 目录式道具商店（业主 2026-10-27）：把本局可售装备按品阶分组下发，每件带价格 / 出处 / 可买状态。
   * 盟约专属（requiresBondId）不进目录——它们仍走「主盟约专属」那栏。
   */
  meltCatalog(ps) {
    const level = this.meltShopLevel();
    const have = Math.max(0, Math.floor(Number(es_spendable(ps)) || 0));
    const groups = [];
    const byTier = (this.gd && this.gd.shopItemsByTier) || {};
    for (let t = 1; t <= 6; t++) {
      // byTier[t] 是**装备 id 字符串**数组（gamedata.js 的 shopItemsByTier），先还原成记录再判
      const rows = (byTier[t] || [])
        .map((id) => (typeof this.gd.item === 'function' ? this.gd.item(id) : (typeof id === 'object' ? id : null)))
        .filter((it) => it && !it.requiresBondId && isShopItem(it))
        .map((it) => {
          const price = meltItemPrice(it, this.teamProjects && this.teamProjects.equipCost);
          return {
            itemId: String(it.id || it.baseId || ''),
            name: String(it.name || it.id || ''),
            desc: String(it.desc || it.descRaw || '').replace(/\n/g, ' '),
            iconId: String(it.iconId || it.trapId || ''),
            tier: t,
            source: String(it.category || ''),
            price,
            unlocked: t <= level,
            affordable: have >= price,
          };
        })
        .sort((a, b) => (a.price - b.price) || a.name.localeCompare(b.name));
      if (rows.length) groups.push({ tier: t, rows });
    }
    return { level, funds: have, groups, relics: this.meltRelicRows(level, have) };
  }

  /**
   * 藏品（业主 2026-10-27）：数据来自插件的 `data/relics.json`（`{ relics: [...] }`）。
   * **当前该文件为空数组**，所以客户端不会出现「藏品」页签；把真实数据放进去即自动出现，代码不用改。
   * 条目字段：`id / name / desc / tier / set（出处）/ cost（个人储备价，缺省按 tier）`。
   */
  meltRelicRows(level, have) {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const list = raw && Array.isArray(raw.relics) ? raw.relics : [];
    return list
      .filter((r) => r && typeof r.id === 'string' && r.id)
      .map((r) => {
        const tier = Math.max(1, Math.min(6, Number(r.tierNum) || (r.tier === 'red' ? 4 : 2)));
        // 价格：官方三档 低 8 / 中 12 / 高 16（源石锭语义）。数据只映射了 blue=8（低档）/ red=16（高档），
        // 没有中档稀有度，见 relics.json 的 priceNotice。
        // 2026-11-06：去掉此前的 `Math.min(12, …)` 上限 —— red 的官方高档 16 会被夹成 12，
        // 与 `relicOffer`（商店节点直购）用的 relics.json 原价不一致。
        const price = Math.max(2, Math.round(Number(r.price) || (tier >= 4 ? 16 : 8)));
        return {
          kind: String(r.kind || ''),
          icon: String(r.icon || `/assets/relics/${r.id}.png`),
          relicId: r.id,
          name: String(r.name || r.id),
          desc: String(r.desc || '').replace(/\n/g, ' '),
          iconId: String(r.iconId || r.icon || ''),
          tier,
          source: String(r.set || r.source || ''),
          price,
          unlocked: tier <= level,
          affordable: have >= price,
        };
      });
  }

  /**
   * 藏品效果聚合（业主 2026-10-27）：把已拥有藏品的声明式效果汇总给战斗层。
   * 现状（只接引擎已有通道）：`enemy/enemyRank(BOSS/ELITE).{hp,atk}` → 敌人 hpMul/atkMul；
   * `deployCap` → ps.deployCapBonus；`lpCap` / `immediate.{funds,lp,items}` 在获得时立即结算。
   * 其余（ally / price / rule.*——57 条走 rule DSL）本局暂不生效，见交付说明。
   */
  /**
   * 收集「持有某条 rule 类藏品」的参数（同一件藏品只算一次）。语义一律以 `relics.json` 的**官方 desc** 为准，
   * 不要按字段名猜方向 —— 例如 `enemyCount.mul = 0.5` 的 desc 是「敌人数量 **+50%**」（是增量不是倍率）。
   * @param {string} ruleId @returns {object[]} 每件持有藏品的 rule 参数对象
   */
  /**
   * 取某玩家持有的、带 `effect[key]` 的藏品效果对象（这些藏品没有 `rule`，只有 `ally` / `allyElite` /
   * `allyPerBench` / `price` / `income` / `hand` / `refreshLimit` 这类键）。同一条藏品只算一次。
   */
  relicEffectList(ps, key) {
    const ids = ps && Array.isArray(ps.relics) ? ps.relics : null;
    if (!ids || !ids.length) return [];
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    if (!defs.length) return [];
    const byId = new Map(defs.map((r) => [r.id, r]));
    const out = [];
    for (const id of ids) {
      const def = byId.get(id);
      const v = def && def.effect && def.effect[key];
      if (v == null) continue;
      // 这些键有的值是对象（ally / price / allyPerBench），有的是标量（income 1 / hand −4 / refreshLimit 5）
      out.push(typeof v === 'object' ? { ...v, relicId: id } : v);
    }
    return out;
  }

  relicRuleParams(ruleId) {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    if (!defs.length) return [];
    const byId = new Map(defs.map((r) => [r.id, r]));
    const out = [];
    const seen = new Set();
    const players = this.players && typeof this.players.values === 'function' ? this.players.values() : [];
    for (const ps of players) {
      for (const id of (ps && Array.isArray(ps.relics) ? ps.relics : [])) {
        if (seen.has(id)) continue;
        const ru = (byId.get(id) || {}).effect && byId.get(id).effect.rule;
        if (ru && ru.id === ruleId) { seen.add(id); out.push({ ...ru, ownerId: ps.playerId }); }
      }
    }
    return out;
  }

  /** 某玩家的已激活盟约数（`ps.bonds[*].active`）。 */
  activeBondsOf(playerId) {
    const ps = this.players && typeof this.players.get === 'function' ? this.players.get(playerId) : null;
    const bonds = ps && ps.bonds;
    if (!bonds || typeof bonds !== 'object') return 0;
    return Object.values(bonds).filter((b) => b && b.active === true).length;
  }

  relicEnemyMul() {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    if (!defs.length) return { hp: 0, atk: 0 };
    const idx = new Map(defs.map((r) => [r.id, r]));
    const acc = { hp: 0, atk: 0, speed: 0 };
    const add = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Number.isFinite(o.hp)) acc.hp += o.hp;
      if (Number.isFinite(o.atk)) acc.atk += o.atk;
    };
    const players = this.players && typeof this.players.values === 'function' ? this.players.values() : [];
    for (const ps of players) {
      for (const id of (ps && Array.isArray(ps.relics) ? ps.relics : [])) {
        const def = idx.get(id);
        const e = def && def.effect;
        if (!e) continue;
        add(e.enemy);
        if (e.enemyRank) { add(e.enemyRank.BOSS); add(e.enemyRank.ELITE); }
      }
    }
    // 肉鸽：本回合随机词缀 + 事件里累积的敌人修正一起算进来
    if (this.isRogue === true) {
      const aff = typeof this.rogueRoundAffix === 'function' ? this.rogueRoundAffix() : null;
      if (aff && aff.kind === 'hp') acc.hp += aff.mul;
      if (aff && aff.kind === 'atk') acc.atk += aff.mul;
      if (aff && aff.kind === 'speed') acc.speed += aff.mul;
      // 紧急作战：整波强化（与词缀/藏品共用同一幂等标记，不会重复乘）
      if (typeof this.rogueEmergencyRound === 'function' && this.rogueEmergencyRound(this.round)) {
        acc.hp += 0.25;
        acc.atk += 0.2;
      }
      for (const ps of players) {
        const b = ps && ps.rogueAffixBonus;
        if (!b) continue;
        acc.hp += Number(b.hp) || 0;
        acc.atk += Number(b.atk) || 0;
      }
    }
    // ---- rule 类藏品的敌方修正（语义逐条取自 relics.json 的官方 desc）----
    // ussuri：「敌方攻击/防御/生命 +35%，每进入新回合额外 +10%，完成悬赏和完美作战时 −5%（最低 35%）」
    //   完成悬赏/完美作战的递减需要结算侧计数，暂未接入 ⇒ 按 0 次计（只会略高，不会低于 min 夹取）。
    for (const ru of this.relicRuleParams('ussuri')) {
      const step = Number(ru.step) || 0;
      const min = Number(ru.min) || 0.35;
      const v = Math.max(min, 0.35 + step * Math.max(0, (Number(this.round) || 1) - 1));
      acc.hp += v; acc.atk += v;
    }
    // leaderHalve：「敌方 +35%，领袖额外攻击/防御 +20%、生命 +50%；激活 ≥4 盟约时领袖加成减半」
    for (const ru of this.relicRuleParams('leaderHalve')) {
      const need = Number(ru.bonds) || 4;
      const half = this.activeBondsOf(ru.ownerId) >= need ? 0.5 : 1;
      acc.hp += 0.35 + 0.5 * half;
      acc.atk += 0.35 + 0.2 * half;
    }
    // enemyRamp（谒日之祈）：「战斗开始时敌方 攻/生/防/法抗 +10%，每过 10 秒额外 +10%，最多 +50%」
    //   ⇒ 本引擎没有「战斗内按时长递增」的通道，这里只结算**战斗开始那一档**（`step`），并注明未接的部分。
    for (const ru of this.relicRuleParams('enemyRamp')) {
      const step = Number(ru.step) || 0;
      if (step > 0) { acc.hp += step; acc.atk += step; }
    }
    // enemyDmgTaken：「敌人受到的物理/法术伤害降低 20%」⇒ 等效生命 +25%（引擎没有独立受击乘区，用 hp 等价近似）
    for (const ru of this.relicRuleParams('enemyDmgTaken')) {
      const p = Math.max(Number(ru.phys) || 0, Number(ru.arts) || 0);
      if (p > 0 && p < 1) acc.hp += 1 / (1 - p) - 1;
    }
    // probe（探测先锋）：「每过 2 个回合所有敌方单位的生命攻击力提升 10%」——按回合数每 `every` 回合加一档
    for (const ru of this.relicRuleParams('probe')) {
      const every = Math.max(1, Number(ru.every) || 2);
      const step = Math.max(Number(ru.atk) || 0, Number(ru.hp) || 0);
      const stacks = Math.floor(Math.max(0, (Number(this.round) || 1) - 1) / every);
      if (step > 0 && stacks > 0) { acc.hp += step * stacks; acc.atk += step * stacks; }
    }
    return acc;
  }

  /** 获得藏品时结算「一次性」效果（资金 / 生命 / 装备 / 部署上限 / 生命上限）。 */
  /**
   * rule 藏品的**回合级经济**（每回合开始调用一次，语义照 relics.json 的官方 desc）：
   * - `fundsDrain`（巫王旋角）：「每进入一个新回合后，失去 1 点初始资金（最多失去 5 点）」
   * - `kingCrystal`（国王水晶）：休整期资金 +5
   * 计数挂在 `ps.relicRuleState` 上，跨回合累积（不随回合清零）。
   */
  /**
   * rule 藏品：**每场战斗结束**的资金奖励（`postBattleFunds`，至宝指环）
   * desc：「战斗结束（包括联防）额外获得 1 点资金，且悬赏获得的资金 +50%」——
   * 后半句 `effect.postBountyMul` 需要赏金发放点的倍率钩子（尚未接入），这里只接前半句。
   */
  /**
   * rule 藏品的**己方属性**聚合（语义照 relics.json 的官方 desc），返回给 BattleSpec 每个 unit 的 `relicMods`。
   * 引擎侧通道：`server/sim/battle/players.js` 的 `_makeAlly` 会把 `atkMul/hpMul/defMul/aspdMul/aspdAdd` 乘/加到单位基础属性上。
   * 当前接入：
   * - `atkPerBond`「每有一个激活的盟约，所有干员攻击力 +10%」→ 按该玩家激活盟约数累加
   * - `atkPerRound`「回合结束后所有干员攻击力 +15%（最多 10 次）」→ 按已过回合数（round-1，封顶 10）累加；
   *   完成悬赏额外 +1 次的规则未接（无悬赏完成计数）
   * 其余己方属性类（atkPerNeighbor/atkPerEquip/atkPerBenchItem/homeCooked/atkPerSpend/hpIfDp…）见覆盖清单，逐个待接。
   */
  /** 某个玩家持有的**负面藏品（kind === 'negative'）**数量——`aspdPerNegative`（刀光剑影）用它算攻速。 */
  relicNegativeCount(ps) {
    const ids = ps && Array.isArray(ps.relics) ? ps.relics : null;
    if (!ids || !ids.length) return 0;
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    const neg = new Set(defs.filter((r) => r && r.kind === 'negative').map((r) => r.id));
    if (!neg.size) return 0;
    let n = 0;
    for (const id of ids) if (neg.has(id)) n += 1;
    return n;
  }

  /** 精锐目标类藏品的参数（都对**精锐干员**生效，4 阶以上）：
   * - `eliteStatsPerElite`（场上每有一名精锐：精锐 生命/攻击/防御 +10%）
   * - `eliteAspdPerElite`（本场每有一名精锐：精锐 攻速 +10，最多 10 层）
   * - `eliteAtkPerMerge`（每有一次 4 阶以上合成：精锐 攻击 +40%，最多 4 层；计数在 acquire.js）
   */
  relicEliteRules() {
    let hp = 0, atk = 0, def = 0, aspdPer = 0, aspdMax = 0, mergePer = 0, mergeMax = 0;
    for (const ru of this.relicRuleParams('eliteStatsPerElite')) {
      const per = Math.max(0, Number(ru.per) || 0);
      hp += per; atk += per; def += per;
    }
    for (const ru of this.relicRuleParams('eliteAspdPerElite')) {
      aspdPer += Math.max(0, Number(ru.per) || 0);
      aspdMax = Math.max(aspdMax, Number.isFinite(Number(ru.max)) ? Number(ru.max) : 10);
    }
    for (const ru of this.relicRuleParams('eliteAtkPerMerge')) {
      mergePer += Math.max(0, Number(ru.per) || 0);
      mergeMax = Math.max(mergeMax, Number.isFinite(Number(ru.max)) ? Number(ru.max) : 4);
    }
    if (!hp && !atk && !def && !aspdPer && !mergePer) return null;
    return { hp, atk, def, aspdPer, aspdMax, mergePer, mergeMax };
  }

  /**
   * 精锐干员（4 阶以上）每回合被削弱的倍率（`eliteAtkPerRound` / `eliteHpPerRound`，desc 的负向那半句）：
   * 「我方精锐干员攻击力/生命每回合 −10%，最多 −50%」。返回 { atkMul, hpMul }（≤1）。
   */
  relicEliteRoundMul() {
    const round = Math.max(0, (Number(this.round) || 1) - 1);
    const acc = { atkMul: 1, hpMul: 1 };
    for (const ru of this.relicRuleParams('eliteAtkPerRound')) {
      const per = Math.abs(Number(ru.per) || 0);
      const max = Math.abs(Number.isFinite(Number(ru.max)) ? Number(ru.max) : 0.5);
      if (per > 0) acc.atkMul = Math.max(1 - max, 1 - per * round);
    }
    for (const ru of this.relicRuleParams('eliteHpPerRound')) {
      const per = Math.abs(Number(ru.per) || 0);
      const max = Math.abs(Number.isFinite(Number(ru.max)) ? Number(ru.max) : 0.5);
      if (per > 0) acc.hpMul = Math.max(1 - max, 1 - per * round);
    }
    return acc;
  }

  /**
   * `stunOnDeploy`（“未尽的生命”）「我方随机一名干员部署时晕眩 10s，每过一个回合使晕眩人数 +1，最多 +3 名」：
   * 返回 { count, dur }，由 `battleInput()` 用 seed+回合确定性地挑出这几个单位，写进它们的 `relicMods.stunOnDeploy`。
   */
  relicStunRule(ps) {
    const list = this.relicRuleParams('stunOnDeploy');
    const opening = this.relicRuleParams('openingDebuff');
    if (!list.length && !opening.length) return null;
    let base = 1, perRound = 0, max = 4, dur = 0;
    for (const ru of list) {
      base = Math.max(base, Number(ru.count) || 1);
      perRound = Math.max(perRound, Number(ru.perRound) || 0);
      max = Math.max(max, Number(ru.max) || 4);
      dur = Math.max(dur, Number(ru.dur) || 10);
    }
    // openingDebuff（深蓝之心）「战斗开始时随机干员中负面效果…最多 5 名」：本引擎用「晕眩」代表这一组负面状态
    for (const ru of opening) {
      base = Math.max(base, Number(ru.count) || 5);
      max = Math.max(max, 5);
      dur = Math.max(dur, 10);
    }
    const round = Math.max(1, Number(this.round) || 1);
    const count = Math.min(max, base + perRound * (round - 1));
    return count > 0 && dur > 0 ? { count, dur } : null;
  }

  /**
   * 藏品对**敌人**的修正（照 desc，交给 `spec.enemyMods`，引擎在敌人生成时施加）：
   * - `enemyDefShred`（戈渎不语）「敌方防御力 +3000，但每次受到伤害时防御力下降 100（最多 30 次）」
   * - `eliteDmgReduce`（生命蓝图）「精英和领袖敌人登场 30 秒内受到的物理和法术伤害 −50%」
   * - `statusDuration`（精神治疗录像带）「敌人受到的一次性晕眩、寒冷、冻结等异常效果影响时间提高 150%」⇒ ×2.5
   */
  relicEnemyMods() {
    let defAdd = 0, perHit = 0, max = 0, eliteMul = 1, eliteDur = 0, statusMul = 1;
    for (const ru of this.relicRuleParams('enemyDefShred')) {
      defAdd += Number(ru.flat) || 0;
      if (Number(ru.perHit)) perHit += Number(ru.perHit);
      max = Math.max(max, Number(ru.max) || 0);
    }
    for (const ru of this.relicRuleParams('eliteDmgReduce')) {
      const m = Number(ru.mul);
      if (m > 0 && m < 1) eliteMul = Math.min(eliteMul, m);
      eliteDur = Math.max(eliteDur, Number(ru.dur) || 30);
    }
    for (const ru of this.relicRuleParams('statusDuration')) {
      const pct = Number(ru.pct);
      if (pct > 0) statusMul *= 1 + pct;
    }
    if (!defAdd && !perHit && eliteMul === 1 && statusMul === 1) return null;
    const out = {};
    if (defAdd || perHit) { out.defAdd = defAdd; if (perHit) { out.defShredPerHit = perHit; out.defShredMax = max || 30; } }
    if (eliteMul !== 1) { out.eliteDmgTakenMul = eliteMul; out.eliteDmgDur = eliteDur || 30; }
    if (statusMul !== 1) out.statusDurationMul = statusMul;
    return out;
  }

  /** `allyElite`（未叙魔王残片）「精锐干员的攻击力 −30%」→ 只作用在 4 阶以上单位上的乘区。 */
  relicAllyEliteMul(ps) {
    let mul = 1;
    const list = typeof this.relicEffectList === 'function' ? this.relicEffectList(ps, 'allyElite') : [];
    for (const v of list) {
      const a = Number(v.atk);
      if (Number.isFinite(a)) mul *= 1 + a;
    }
    return Math.max(0, mul);
  }

  /** 相邻类藏品的「每相邻一人」参数（`atkPerNeighbor` / `aspdPerNeighbor`）—— 需要 per-unit 计算，见 battleInput。 */
  relicNeighborRules() {
    let atkPer = 0, aspdPer = 0;
    for (const ru of this.relicRuleParams('atkPerNeighbor')) atkPer += Math.max(0, Number(ru.per) || 0);
    for (const ru of this.relicRuleParams('aspdPerNeighbor')) aspdPer += Math.max(0, Number(ru.per) || 0);
    return (atkPer || aspdPer) ? { atkPer, aspdPer } : null;
  }

  relicAllyMul(ps) {
    if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) return null;
    let atk = 0, hp = 0, def = 0, aspdAdd = 0;
    // 这些 effect 键是新接的；老测试的假 this 不一定挂 relicEffectList，缺了就按空处理
    const effects = (k) => (typeof this.relicEffectList === 'function' ? this.relicEffectList(ps, k) : []);
    for (const ru of this.relicRuleParams('atkPerBond')) {
      const per = Math.max(0, Number(ru.per) || 0);
      atk += per * this.activeBondsOf(ps.playerId);
    }
    for (const ru of this.relicRuleParams('atkPerRound')) {
      const per = Math.max(0, Number(ru.per) || 0);
      const max = Number.isFinite(Number(ru.max)) ? Number(ru.max) : 10;
      atk += per * Math.min(max, Math.max(0, (Number(this.round) || 1) - 1));
    }
    // 棋盘上已装备的件数（atkPerEquip「每装备一件：攻击 +10%、生命 +20%」）
    const boardItems = (() => {
      const b = ps.board;
      if (!b || typeof b.values !== 'function') return 0;
      let n = 0;
      for (const piece of b.values()) n += Array.isArray(piece && piece.items) ? piece.items.length : 0;
      return n;
    })();
    for (const ru of this.relicRuleParams('atkPerEquip')) {
      atk += Math.max(0, Number(ru.atk) || 0) * boardItems;
      hp += Math.max(0, Number(ru.hp) || 0) * boardItems;
    }
    // 待部署区/手牌里的装备件数（atkPerBenchItem「每有一件：攻击 +10%，最多 +150%」）
    const benchItems = (() => {
      let n = 0;
      for (const area of [ps.temp, ps.hand]) {
        if (!Array.isArray(area)) continue;
        for (const piece of area) if (piece && piece.kind === 'item') n += 1;
      }
      return n;
    })();
    for (const ru of this.relicRuleParams('atkPerBenchItem')) {
      const per = Math.max(0, Number(ru.per) || 0);
      const max = Number.isFinite(Number(ru.max)) ? Number(ru.max) : 1.5;
      atk += Math.min(max, per * benchItems);
    }
    // atkPerBounty「我方干员攻击 +20%，每完成一次悬赏永久额外 +20%（最高 +200%）」
    const bounties = Math.max(0, Math.trunc(Number(ps.relicBountiesDone) || 0));
    for (const ru of this.relicRuleParams('atkPerBounty')) {
      const base = Math.max(0, Number(ru.base) || 0);
      const per = Math.max(0, Number(ru.per) || 0);
      const max = Number.isFinite(Number(ru.max)) ? Number(ru.max) : 10;
      atk += base + per * Math.min(max, bounties);
    }
    // dmgDealt「对敌人造成的物理与法术伤害提升 50%」—— 引擎没有独立「造成伤害」乘区，
    // 用**己方攻击力 ×(1+p)** 近似（p 取 phys/arts 的较大者），注释写明是近似。
    for (const ru of this.relicRuleParams('dmgDealt')) {
      const p2 = Math.max(Number(ru.phys) || 0, Number(ru.arts) || 0);
      if (p2 > 0) atk += p2;
    }
    // 消费类（desc 都是「每花费 N 点资金 → +X」）：
    //   atkPerSpend「每花 5 资金，所有干员攻击 +5%」
    //   hpdefPerSpend「每花 3 资金，所有干员最大生命 +3%、防御 +3%」
    //   aspdPerSpend「每消耗 3 点资金 +7 攻速」（攻速是加法不是乘法）
    const spent = Math.max(0, Math.floor(Number(ps.totalSpent) || 0));
    for (const ru of this.relicRuleParams('atkPerSpend')) {
      const each = Math.max(1, Number(ru.each) || 5);
      atk += (Math.floor(spent / each) * Math.max(0, Number(ru.per) || 0));
    }
    for (const ru of this.relicRuleParams('hpdefPerSpend')) {
      const each = Math.max(1, Number(ru.each) || 3);
      const gain = Math.floor(spent / each) * Math.max(0, Number(ru.per) || 0);
      hp += gain; def += gain;
    }
    for (const ru of this.relicRuleParams('aspdPerSpend')) {
      const each = Math.max(1, Number(ru.each) || 3);
      aspdAdd += Math.floor(spent / each) * Math.max(0, Number(ru.per) || 0);
    }
    // homeCooked「生命 +20%、攻击 +20%；每通过一场完美作战额外 +10%」
    const perfect = Math.max(0, Number(ps.relicPerfectBattles) || 0);
    for (const ru of this.relicRuleParams('homeCooked')) {
      const per = Math.max(0, Number(ru.per) || 0);
      hp += 0.2 + per * perfect;
      atk += 0.2 + per * perfect;
    }
    // aspdPerNegative「每拥有一个负面藏品，所有友方单位攻击速度 +35」——只数**自己**持有的 negative 藏品
    const negatives = typeof this.relicNegativeCount === 'function' ? this.relicNegativeCount(ps) : 0;
    for (const ru of this.relicRuleParams('aspdPerNegative')) aspdAdd += Math.max(0, Number(ru.per) || 0) * negatives;
    // hpPerTier4Buy「每购买 4 阶以上干员时，所有友方干员最大生命 +5%（最多 10 层）」——计数在 economy.buy()
    const tier4Buys = Math.max(0, Math.trunc(Number(ps.relicTier4Buys) || 0));
    for (const ru of this.relicRuleParams('hpPerTier4Buy')) {
      const per = Math.max(0, Number(ru.per) || 0);
      const max = Number.isFinite(Number(ru.max)) ? Number(ru.max) : 10;
      hp += per * Math.min(max, tier4Buys);
    }
    // kingVessel「上一个回合没有损失目标生命时全队最大生命 +80%，连续 3 回合 +200%」——连胜计数在 settle()
    if (this.relicRuleParams('kingVessel').length) {
      const streak = Math.max(0, Math.trunc(Number(ps.relicNoLossStreak) || 0));
      if (streak >= 3) hp += 2;
      else if (streak >= 1) hp += 0.8;
    }
    // hpIfDp（黑洞协议）「部署费用达到 50 以上时，所有干员的生命值 +150%」
    //   ⚠ params 写的是 `hp: 0.5`，desc 写的是 +150% —— 按 desc 落地（本项目一律以官方 desc 为准），
    //   部署费用取棋子 `stats.cost` 之和（data/chess.json 自带，如 chess_char_1_01_a 是 12）。
    if (this.relicRuleParams('hpIfDp').length) {
      let dp = 0;
      const b = ps.board;
      if (b && typeof b.values === 'function') {
        for (const piece of b.values()) {
          if (!piece || piece.kind !== 'chess') continue;
          const rec = this.gd && typeof this.gd.chess === 'function' ? this.gd.chess(piece.id) : null;
          dp += Math.max(0, Number(rec && rec.stats && rec.stats.cost) || 0);
        }
      }
      for (const ru of this.relicRuleParams('hpIfDp')) {
        const need = Number.isFinite(Number(ru.dp)) ? Number(ru.dp) : 50;
        if (dp >= need) hp += 1.5;
      }
    }
    // 技力类（2026-11-01，引擎 initSp / spRegenMul 通道；见 server/sim/battle/deploy.js）：
    //   spInit「所有干员初始技力 −10」+ spOnDeploy「部署时失去 15 点技力」——两者都是「初始技力减少」，
    //   合并成一项交给引擎，负值由引擎夹到 0（初始技力本身就不能为负）。
    let initSp = 0;
    for (const ru of this.relicRuleParams('spInit')) initSp += Math.trunc(Number(ru.n) || 0);
    for (const ru of this.relicRuleParams('spOnDeploy')) initSp += Math.trunc(Number(ru.n) || 0);
    // lpDrainRest 的后半句：「关卡生命低于 10 时，我方技力回复速度 −20%」——按当前 LP 判定，乘进 spRegenMul
    let spRegenMul = 1;
    for (const ru of this.relicRuleParams('lpDrainRest')) {
      const low = ru.spLowLp && typeof ru.spLowLp === 'object' ? ru.spLowLp : null;
      if (low && (Number(ps.lp) || 0) < (Number(low.lp) || 10)) spRegenMul *= 1 + Math.min(0, Number(low.pct) || 0);
    }
    // ---- 战斗内时序类（2026-11-02，全部走引擎 buff/钩子通道，缺省零影响）----
    // startDebuff（退行的罗辛南特）「战斗开始时我方攻击 −20%、攻速 −20、技力回复 −20%，持续 10 秒」
    let startDur = 0, startAtkPct = 0, startAspd = 0, startSpMul = 1;
    for (const ru of this.relicRuleParams('startDebuff')) {
      startDur = Math.max(startDur, Number(ru.dur) || 10);
      startAtkPct += Number(ru.atkPct) || 0;
      startAspd += Number(ru.aspd) || 0;
      const sp = Number(ru.spRegen);
      if (Number.isFinite(sp)) startSpMul *= 1 + sp;
    }
    // neuralDps（每秒固定伤害）+ fogOnDeploy（部署后限时按最大生命百分比掉血）
    let flatDps = 0, dotMaxHpPct = 0, dotDur = 0;
    for (const ru of this.relicRuleParams('neuralDps')) flatDps += Math.max(0, Number(ru.n) || 0);
    for (const ru of this.relicRuleParams('fogOnDeploy')) {
      dotMaxHpPct += Math.max(0, Number(ru.ratio) || 0);
      dotDur = Math.max(dotDur, Number(ru.dur) || 60);
    }
    // spRegenStack（技能用一次 +0.4 技力回复）+ atkAfterSkill（技能后 1 秒 +100% 攻）
    let skillSpPer = 0, skillSpMax = 5, skillAtkWindow = 0, skillAtkMul = 2;
    for (const ru of this.relicRuleParams('spRegenStack')) {
      skillSpPer += Math.max(0, Number(ru.per) || 0);
      skillSpMax = Math.max(skillSpMax, Number(ru.max) || 5);
    }
    for (const ru of this.relicRuleParams('atkAfterSkill')) {
      skillAtkWindow = Math.max(skillAtkWindow, Number(ru.window) || 1);
      skillAtkMul = Math.max(skillAtkMul, Number(ru.mul) || 2);
    }
    // ally（坍缩之种 −30% / “坏家伙”+35%+35%+45% / 未知仪器 生命+50%）：直接加到全局乘区上
    for (const v of effects('ally')) {
      if (Number.isFinite(Number(v.atk))) atk += Number(v.atk);
      if (Number.isFinite(Number(v.hp))) hp += Number(v.hp);
      if (Number.isFinite(Number(v.def))) def += Number(v.def);
    }
    // allyPerBench（琥珀伤痕 / 树海贵宾套餐 / 悲伤的红）：待部署区（手牌 + 临时区）每有一名干员叠一层，封顶 max
    const benchChess = (() => {
      let n = 0;
      for (const area of [ps.hand, ps.temp]) {
        if (!Array.isArray(area)) continue;
        for (const piece of area) if (piece && piece.kind === 'chess') n += 1;
      }
      return n;
    })();
    for (const v of effects('allyPerBench')) {
      const per = (k) => Math.max(0, Number(v[k]) || 0);
      const max = Number.isFinite(Number(v.max)) ? Number(v.max) : 1.5;
      if (per('atk')) atk += Math.min(max, per('atk') * benchChess);
      if (per('hp')) hp += Math.min(max, per('hp') * benchChess);
    }
    // shelterOnDebuff（养育者基因种）「有干员陷入负面状态后所有友方单位获得 35% 庇护，攻击无视目标 35% 法术抗性和防御力
    // 持续至战斗结束」——触发是战斗内事件，数值交给 players.js 的 statusApplied 钩子（这里只给出两个系数）。
    let debuffShelter = 0, debuffIgnore = 0;
    for (const ru of this.relicRuleParams('shelterOnDebuff')) {
      debuffShelter = Math.max(debuffShelter, Number(ru.mul) || 0);
      debuffIgnore = Math.max(debuffIgnore, Number(ru.ignore) || 0);
    }
    // shelter（佣兵保单）「所有我方单位获得 10% 庇护，生命低于初始 50% 时额外 35%」——
    // 庇护有通道（引擎 dmgTakenMul），静态这半句接上；低血那半句是**战斗中动态 HP**，对局侧拿不到，未接。
    let shelter = 0;
    for (const ru of this.relicRuleParams('shelter')) shelter += Math.max(0, Number(ru.base) || 0);
    const hasTimed = startDur || flatDps || dotMaxHpPct || skillSpPer || skillAtkWindow || debuffShelter;
    if (!atk && !hp && !def && !aspdAdd && !initSp && spRegenMul === 1 && !shelter && !hasTimed) return null;
    return { atkMul: 1 + atk, hpMul: 1 + hp, ...(def ? { defMul: 1 + def } : {}), ...(aspdAdd ? { aspdAdd } : {}),
      ...(initSp ? { initSp } : {}), ...(spRegenMul !== 1 ? { spRegenMul } : {}),
      ...(shelter ? { shelter: Math.min(1, shelter) } : {}),
      ...(startDur ? { startAtkPct, startAspd, startSpMul, startDur } : {}),
      ...(flatDps ? { flatDps } : {}),
      ...(dotMaxHpPct ? { dotMaxHpPct, dotDur } : {}),
      ...(skillSpPer ? { skillSpPer, skillSpMax } : {}),
      ...(skillAtkWindow ? { skillAtkWindow, skillAtkMul } : {}),
      ...(debuffShelter ? { debuffShelter, debuffIgnore } : {}) };
  }

  /**
   * rule 藏品的**赏金倍率**（照 desc 连乘）：
   * - `bountyMul`「悬赏中获得的资金奖励翻倍」(`mul`)
   * - `loseAllFunds`「使悬赏获得的资金减半」(`bountyMul`)
   * - `effect.postBountyMul`（至宝指环「悬赏获得的资金 +50%」，非 rule 键）
   */
  relicBountyMul() {
    let mul = 1;
    for (const ru of this.relicRuleParams('bountyMul')) mul *= Math.max(0, Number(ru.mul) || 1);
    for (const ru of this.relicRuleParams('loseAllFunds')) mul *= Math.max(0, Number(ru.bountyMul) || 1);
    const players = this.players && typeof this.players.values === 'function' ? this.players.values() : [];
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
    const byId = new Map(defs.map((r) => [r.id, r]));
    const seen = new Set();
    for (const ps of players) {
      for (const id of (ps && Array.isArray(ps.relics) ? ps.relics : [])) {
        if (seen.has(id)) continue;
        const def = byId.get(id) || {};
        const v = Number((def.effect || {}).postBountyMul);
        if (Number.isFinite(v) && v > 0) { mul *= v; seen.add(id); }
      }
    }
    return mul;
  }

  /**
   * rule 藏品的**干员价格折扣**（`kingCrystal`「购买的干员所消耗的资金 −1」）——返回给商店/刷新处叠加。
   */
  relicChessPriceDelta(ps, chessId = null) {
    let d = 0;
    for (const ru of this.relicRuleParams('kingCrystal')) d += Math.trunc(Number(ru.priceChess) || 0);
    // price（无限续杯瓶 −1 全干员 / 奎萨图什塔允诺 +1 五阶以上）
    let tier = 0;
    try { tier = this.gd && typeof this.gd.tierOf === 'function' ? Number(this.gd.tierOf(chessId)) || 0 : 0; } catch { /* 取不到阶数 */ }
    const priceList = typeof this.relicEffectList === 'function' ? this.relicEffectList(ps, 'price') : [];
    for (const v of priceList) {
      if (Number.isFinite(Number(v.chessAll))) d += Number(v.chessAll);
      if (Number.isFinite(Number(v.chessTier5)) && tier >= 5) d += Number(v.chessTier5);
    }
    return d;
  }

  /** `refreshLimit`（主教的研究）「休整期间最多刷新商店 N 次」——返回 N 或 null（没有这条藏品）。 */
  relicRefreshCap(ps) {
    const list = typeof this.relicEffectList === 'function' ? this.relicEffectList(ps, 'refreshLimit') : [];
    if (!list.length) return null;
    let cap = Infinity;
    for (const v of list) if (Number.isFinite(Number(v))) cap = Math.min(cap, Math.max(0, Math.trunc(Number(v))));
    return Number.isFinite(cap) ? cap : null;
  }

  /** rule 藏品：`lpDrainRest`（进入休整期目标生命 −1，最低 1）与 `kingCrystal`（战斗结束 −2，最低 1）。 */
  applyRelicLpDrain(phase) {
    if (!this.players || typeof this.players.values !== 'function') return;
    for (const ps of this.players.values()) {
      if (!ps || ps.isBot || !Array.isArray(ps.relics) || !ps.relics.length) continue;
      const hits = phase === 'rest' ? this.relicRuleParams('lpDrainRest') : this.relicRuleParams('kingCrystal');
      for (const ru of hits) {
        const n = Math.abs(Math.trunc(Number(ru.n) || 0));
        const crystal = phase === 'rest' ? 0 : Math.abs(Math.trunc(Number(ru.lp) || 0));
        const take = phase === 'rest' ? n : crystal;
        if (take > 0) { try { ps.lp = Math.max(1, (Number(ps.lp) || 1) - take); ps.dirty && ps.dirty(); } catch { /* noop */ } }
      }
    }
  }

  applyRelicPostBattle() {
    if (!this.players || typeof this.players.values !== 'function') return;
    for (const ps of this.players.values()) {
      if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) continue;
      for (const ru of this.relicRuleParams('postBattleFunds')) {
        const n = Math.max(0, Number(ru.n) || 0);
        if (n > 0) { try { ps.addFunds(n, { reason: 'relic-post-battle' }); } catch { /* noop */ } }
      }
    }
  }

  /**
   * rule 藏品：**做出一次选择**时的资金奖励（`choiceFunds`，笞心魔宝宝）
   * desc：「资金 +3，在选择决策、完成悬赏时资金额外 +8」——入手 +3 由 `effect.immediate` 结算，这里是「每次选择 +8」。
   * 「完成悬赏」那一半需要赏金完成点的钩子（尚未接入）。
   */
  applyRelicChoiceFunds(ps) {
    if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) return;
    for (const ru of this.relicRuleParams('choiceFunds')) {
      const n = Math.max(0, Number(ru.n) || 0);
      if (n > 0) { try { ps.addFunds(n, { reason: 'relic-choice' }); } catch { /* noop */ } }
    }
  }

  applyRelicRoundEconomy() {
    if (!this.players || typeof this.players.values !== 'function') return;
    const players = [...this.players.values()];
    for (const ps of players) {
      if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) continue;
      const st = (ps.relicRuleState ||= {});
      for (const ru of this.relicRuleParams('fundsDrain')) {
        const per = Math.max(0, Number(ru.perRound) || 0);
        const max = Math.max(0, Number(ru.max) || 0);
        const done = Number(st.fundsDrained) || 0;
        const take = Math.min(per, Math.max(0, max - done));
        if (take > 0) { st.fundsDrained = done + take; try { ps.addFunds(-take, { reason: 'relic-funds-drain' }); } catch { /* noop */ } }
      }
      for (const ru of this.relicRuleParams('kingCrystal')) {
        const inc = Math.max(0, Number(ru.income) || 0);
        if (inc > 0) { try { ps.addFunds(inc, { reason: 'relic-king-crystal' }); } catch { /* noop */ } }
      }
      // income（无限续杯瓶 +1 / 迷幻的藏宝图 +2）：「进入休整期时资金额外 +N」
      const incomeList = typeof this.relicEffectList === 'function' ? this.relicEffectList(ps, 'income') : [];
      for (const v of incomeList) {
        const n = Math.trunc(Number(v) || 0);
        if (n) { try { ps.addFunds(n, { reason: 'relic-income' }); } catch { /* noop */ } }
      }
      // probe（探测先锋）：「获得时下次休整期资金 −1」——只扣一次（`st.probePaid` 跨回合记账）
      if (this.relicRuleParams('probe').length && !st.probePaid) {
        st.probePaid = true;
        try { ps.addFunds(-1, { reason: 'relic-probe' }); } catch { /* noop */ }
      }
      // recruitTopBond（似曾相识棋盒）：「进入下一回合时，随机获得一名当前盟约层数最高的干员」
      // （+1 部署上限那半边来自 effect.deployCap，已在 relicGrantInstant 里生效）
      if (this.relicRuleParams('recruitTopBond').length) {
        try { this.relicRecruitTopBond(ps); } catch { /* 取不到候选就跳过 */ }
      }
    }
  }

  /**
   * 「当前盟约层数最高的干员」：取该玩家层数最高的**已激活**盟约 → 从该盟约的可见干员里随机一名发放。
   * 复用 hex 抽卡已有的 `hexBondChess()` / `_hexPickChess()`（同实例方法，非 hex 模式下按 `typeof` 跳过）。
   */
  /**
   * 隐匿/迷彩类藏品的**攻击加成**参数（迷彩本身是引擎内的目标选择状态，对局侧接不了；能接的是加攻）：
   * - `camoRanged`（捕鳞蓑）「远程干员获得【迷彩】，攻击力提升 50%」→ `rangedAtk = 0.5`（desc 无参数，硬编码）
   * - `camoAura`（犬植浆）「干员攻击范围内的其他干员获得迷彩，攻击力 +10%（可叠加）」→ `auraAtk`（每覆盖一名 +10%）
   * 远程判定用棋子的 `position === 'RANGED'`（data/chess.json 自带 MELEE/RANGED），范围用 `rangeGrid`。
   */
  relicCamoRules() {
    const hasRanged = this.relicRuleParams('camoRanged').length > 0;
    let auraAtk = 0;
    for (const ru of this.relicRuleParams('camoAura')) auraAtk += Math.max(0, Number(ru.atk) || 0);
    if (!hasRanged && !auraAtk) return null;
    return { rangedAtk: hasRanged ? 0.5 : 0, auraAtk };
  }

  /**
   * `survivor`（生还者合约）「战斗开始时，使攻击力最高的一名干员攻击力和防御力 +20%，
   * 且每次战斗结束后（不包括联防）额外 +20%」——只对**一个**单位生效，所以参数交给 battleInput 逐单位判定。
   * 打完的场数记在 `ps.relicBattles`（settle 里非联防时 +1）。
   */
  relicSurvivorRule(ps) {
    const list = this.relicRuleParams('survivor');
    if (!list.length) return null;
    let per = 0;
    for (const ru of list) per += Math.max(0, Number(ru.per) || 0);
    if (per <= 0) return null;
    const battles = Math.max(0, Math.trunc(Number(ps && ps.relicBattles) || 0));
    return { per, stacks: 1 + battles };
  }

  /**
   * 一次性道具（`kind: consume_on_equip*` 的装备 / `itemType: MAGIC` 的战术道具）判据，
   * 与 `player/items.js` 的两个消耗点保持一致。
   */
  relicIsConsumable(rec) {
    if (!rec || typeof rec !== 'object') return false;
    return (typeof rec.kind === 'string' && rec.kind.startsWith('consume_on_equip')) || rec.itemType === 'MAGIC';
  }

  /** 随机一件一次性道具的 id（`consumableRefund` 再发一件时用；rng 走 this.rng，缺失时退 Math.random）。 */
  relicRandomConsumableId() {
    const items = (this.gd && this.gd.raw && this.gd.raw.items) || null;
    if (!items || typeof items !== 'object') return null;
    const pool = Object.keys(items).filter((id) => this.relicIsConsumable(items[id]));
    if (!pool.length) return null;
    const r = typeof this.rng === 'function' ? this.rng() : Math.random();
    return pool[Math.min(pool.length - 1, Math.floor((Number(r) || 0) * pool.length))];
  }

  /**
   * 一次性道具**被用掉之后**的 rule 钩子（由 `player/items.js` 在 equip 消耗分支与 useArt 成功分支调用）：
   * - `consumableFree`（果腹）：「一次性装备道具免费（使用后返还购买价格）」⇒ 按目录价 `gd.itemPrice` 退资金
   * - `consumableRefund`（复得之轮）：「使用后获得一个一次性装备道具，每回合最多 3 次」⇒ 发一件同类，按回合记账
   */
  relicConsumableUsed(ps, itemId) {
    if (!ps) return;
    const free = this.relicRuleParams('consumableFree').length > 0;
    const refund = this.relicRuleParams('consumableRefund').length > 0;
    if (!free && !refund) return;
    if (free) {
      let price = 0;
      try { price = Math.max(0, Math.trunc(Number(this.gd.itemPrice(itemId)) || 0)); } catch { /* 没目录价就不退 */ }
      if (price > 0) { try { ps.addFunds(price, { reason: 'relic-consumable-free' }); } catch { /* noop */ } }
    }
    if (refund) {
      const st = (ps.relicRuleState ||= {});
      const round = Number(this.round) || 1;
      if (st.refundRound !== round) { st.refundRound = round; st.refundCount = 0; }
      const done = Number(st.refundCount) || 0;
      if (done < 3) {
        const id = this.relicRandomConsumableId();
        if (id) {
          st.refundCount = done + 1;
          try { ps.acquireItem(id, { source: 'relic' }); } catch { /* 池子/数据守卫 */ }
        }
      }
    }
  }

  relicRecruitTopBond(ps) {
    if (!ps || typeof ps.acquireChess !== 'function') return null;
    let best = null;
    for (const [id, st] of Object.entries(ps.bonds || {})) {
      if (!st || !st.active) continue;
      const layers = Number(st.layers ?? st.stacks ?? st.count ?? 0) || 0;
      if (!best || layers > best.layers) best = { id, layers };
    }
    if (!best) return null;
    const cands = typeof this.hexBondChess === 'function' ? this.hexBondChess(best.id) : null;
    if (!Array.isArray(cands) || !cands.length) return null;
    const id = typeof this._hexPickChess === 'function'
      ? this._hexPickChess(cands, `relic-topbond:${ps.playerId}:${this.round}`)
      : cands[Math.floor(Math.random() * cands.length)];
    return id ? ps.acquireChess(id, { source: 'relic' }) : null;
  }

  relicGrantInstant(ps, def) {
    const e = (def && def.effect) || {};
    const im = e.immediate && typeof e.immediate === 'object' ? e.immediate : null;
    // 失与得的账本（2026-11-06）：下发前先取基准值，事后按**实际变化**写一条可回放的账（`relicRevoke` 用）。
    // 只记真的改过的字段 —— 玩家资金被 `addFunds` 夹到 0 之类的情况也如实记为 0 变化、不写键。
    // 账本是纯数据（数字 / 字符串 / 数组），可直接 JSON 序列化；不进公开视图（见 player/views.js 的 privateView）。
    const led = {};
    const fundsBefore = Number(ps && ps.funds) || 0;
    const lpBefore = Number(ps && ps.lp) || 0;
    const capBefore = Number(ps && ps.deployCapBonus) || 0;
    const grantedItems = [];
    if (im) {
      if (Number.isFinite(im.funds) && im.funds) ps.addFunds(Math.trunc(im.funds), { reason: 'relic' });
      if (Number.isFinite(im.lp) && im.lp) ps.lp = Math.max(1, (Number(ps.lp) || 0) + Math.trunc(im.lp));
      if (Array.isArray(im.items)) for (const itemId of im.items) {
        try {
          const piece = ps.acquireItem(itemId, { source: 'relic' });
          // 合成（两件同名 → 金）时返回的是合成后的那件，按它记 uid，revoke 时按 uid 找回并移除。
          if (piece) grantedItems.push({ id: String(piece.id || itemId), uid: piece.uid });
        } catch { /* 池子/数据守卫 */ }
      }
    }
    if (Number.isFinite(e.deployCap) && e.deployCap) ps.deployCapBonus = (Number(ps.deployCapBonus) || 0) + Math.trunc(e.deployCap);
    // rule：loseAllFunds（追忆仪）「获得时，本次休整期失去所有的资金」（悬赏减半那半边待赏金倍率钩子，见覆盖清单）
    if (e.rule && e.rule.id === 'loseAllFunds') { try { ps.funds = 0; ps.dirty && ps.dirty(); } catch { /* noop */ } }
    // rule：removeTemp（维度流质）「移除临时部署区」——置旗（stow 不再往 temp 塞）并把已经在里面的清掉
    if (e.rule && e.rule.id === 'removeTemp') {
      try {
        const wasNoTemp = !!ps.relicNoTemp;
        const cleared = [];
        ps.relicNoTemp = true;
        if (Array.isArray(ps.temp)) {
          ps.temp.forEach((piece, idx) => {
            if (!piece) return;
            let repaid = 0;
            try { repaid = ps.releaseItemStock ? (Number(ps.releaseItemStock(piece)) || 0) : 0; } catch { /* noop */ }
            // 记原槽位 + 这件道具 + 清掉时归还的库存份数（revoke 放回时按同一份数重新记账）
            cleared.push({ idx, piece, repaid });
          });
          ps.temp.fill ? ps.temp.fill(null) : (ps.temp.length = 0);
        }
        if (cleared.length) led.removedTemp = cleared;
        if (!wasNoTemp) led.noTemp = true;
        ps.dirty && ps.dirty();
      } catch { /* noop */ }
    }
    if (Number.isFinite(e.lpCap) && e.lpCap) ps.lp = Math.max(1, (Number(ps.lp) || 0) + Math.trunc(e.lpCap));
    // 净变化一次性落账：`immediate.lp` 与 `lpCap` 都写 `ps.lp`，合成一条 `lp` 才不会把同一笔加成记两遍。
    const fundsDelta = (Number(ps && ps.funds) || 0) - fundsBefore;
    const lpDelta = (Number(ps && ps.lp) || 0) - lpBefore;
    const capDelta = (Number(ps && ps.deployCapBonus) || 0) - capBefore;
    if (fundsDelta) led.funds = fundsDelta;
    if (lpDelta) led.lp = lpDelta;
    if (capDelta) led.deployCap = capDelta;
    if (grantedItems.length) led.items = grantedItems;
    // 落账：`ps.relicLedger[relicId]` 是**栈**（同一件藏品可能被重复下发 —— 得偿所愿池子抽空时允许发重复），
    // 每次下发 push 一条，`relicRevoke` 弹最后一条。全是纯数据，可跨存档序列化；不进公开视图。
    if (def && def.id && Object.keys(led).length) {
      const map = ps.relicLedger && typeof ps.relicLedger === 'object' ? ps.relicLedger : (ps.relicLedger = {});
      const stack = Array.isArray(map[def.id]) ? map[def.id] : (map[def.id] = []);
      stack.push(led);
    }
  }

  /** 藏品的稀有度档（'red' / 'blue' / 'mid'；数据缺 tier 时返回 ''）。 */
  relicTierOf(relicId) {
    const def = this.relicPool().find((r) => r && r.id === relicId) || null;
    return String((def && def.tier) || '');
  }

  /** 档 → rank（0 = 未知档，不设门）。 */
  relicTierRank(tier) {
    return RELIC_TIER_RANK[String(tier || '')] || 0;
  }

  /**
   * **撤销**一件藏品（失与得的「失」，2026-11-06）。
   *
   * 按 `ps.relicLedger[relicId]` 的最后一条逐项逆运算（资金 / 生命 / 部署上限 / 一次性道具 / 被 removeTemp 清掉的
   * 临时部署区道具），然后从 `ps.relics` 移除 —— rule 类聚合（relicAllyMul / relicEnemyMul / relicEffectList）
   * 都是「读 ps.relics 现算」的，所以移除即自然失效，不用另外回滚。
   *
   * **没有账本的老藏品（本次改动前发出的历史存档）只移除、不逆运算、不抛错** —— 一次性加成当时就没记账，
   * 现在也无从回滚，宁可少给不可崩。
   * @param {object} ps @param {string} relicId
   */
  relicRevoke(ps, relicId) {
    const id = String(relicId || '');
    if (!ps || !id) return fail(ERR.BAD_TARGET, 'bad relic'); // i18n-ignore
    const own = Array.isArray(ps.relics) ? ps.relics : null;
    const idx = own ? own.indexOf(id) : -1;
    if (idx < 0) return fail(ERR.BAD_TARGET, 'relic not owned'); // i18n-ignore
    own.splice(idx, 1);
    const map = ps.relicLedger && typeof ps.relicLedger === 'object' ? ps.relicLedger : null;
    const stack = map && Array.isArray(map[id]) ? map[id] : null;
    const entry = stack && stack.length ? stack.pop() : null;
    if (stack && !stack.length) { try { delete map[id]; } catch { /* noop */ } }
    if (entry) {
      try { this.relicRevokeEntry(ps, entry); } catch (e) { this.reportError('relic revoke', e); }
    } else {
      // 老存档 / 直接 push 进 relics 的藏品：没有账本，只移除（不伪造回滚）
      try { this.reportError('relic revoke', new Error(`no ledger for ${id}`)); } catch { /* noop */ }
    }
    try { ps.dirty && ps.dirty(); } catch { /* noop */ }
    return OK;
  }

  /** 按一条账逐项反向（只处理账里真有的键）。 */
  relicRevokeEntry(ps, entry) {
    if (!ps || !entry) return;
    if (Number.isFinite(entry.funds) && entry.funds) {
      const n = Math.trunc(entry.funds);
      try {
        if (typeof ps.addFunds === 'function') ps.addFunds(-n, { reason: 'relic-revoke' });
        else ps.funds = Math.max(0, (Number(ps.funds) || 0) - n);
      } catch { /* noop */ }
    }
    // 生命下限 1（与下发同口径）：`entry.lp` 为负（如 n22 −12）时这里是加回来
    if (Number.isFinite(entry.lp) && entry.lp) ps.lp = Math.max(1, (Number(ps.lp) || 0) - Math.trunc(entry.lp));
    if (Number.isFinite(entry.deployCap) && entry.deployCap) {
      ps.deployCapBonus = (Number(ps.deployCapBonus) || 0) - Math.trunc(entry.deployCap);
    }
    if (Array.isArray(entry.items)) for (const it of entry.items) this.relicRevokeItem(ps, it);
    if (Array.isArray(entry.removedTemp)) this.relicRestoreTemp(ps, entry.removedTemp);
    if (entry.noTemp) ps.relicNoTemp = false;
  }

  /** 把下发时给的一次性道具收回来：按 uid 在手上 / 待部署区找回，找不到（已装备 / 已合成 / 已用掉）就记日志跳过。 */
  relicRevokeItem(ps, it) {
    const uid = it && it.uid;
    const id = String((it && it.id) || '');
    const hit = (arr, test) => (Array.isArray(arr) ? arr.findIndex((p) => p && test(p)) : -1);
    const test = (p) => (uid != null ? p.uid === uid : (!!id && p.id === id));
    for (const area of ['hand', 'temp']) {
      const arr = ps[area];
      const i = hit(arr, test);
      if (i < 0) continue;
      const piece = arr[i];
      arr[i] = null;
      try { if (ps.releaseItemStock) ps.releaseItemStock(piece); } catch { /* noop */ }
      return;
    }
    try { this.reportError('relic revoke', new Error(`item ${id || '?'} not found`)); } catch { /* noop */ }
  }

  /** 把 removeTemp 清掉的道具放回原槽位；原槽位被占就找空槽，找不到就记日志跳过。 */
  relicRestoreTemp(ps, list) {
    if (!Array.isArray(ps.temp)) return;
    for (const rec of list) {
      const piece = rec && rec.piece;
      if (!piece) continue;
      const want = Number.isInteger(rec.idx) && rec.idx >= 0 ? rec.idx : -1;
      let slot = want >= 0 && !ps.temp[want] ? want : ps.temp.findIndex((p) => !p);
      if (slot < 0 && typeof ps.temp.push === 'function') slot = ps.temp.length;
      if (slot < 0) {
        try { this.reportError('relic revoke', new Error('no temp slot')); } catch { /* noop */ }
        continue;
      }
      ps.temp[slot] = piece;
      // 清掉时归还过库存（releaseItemStock → repay），放回来要把同一份数重新记成欠账，否则等于白赚库存
      try {
        const pool = ps.m && ps.m.itemPool;
        if (pool && typeof pool.owe === 'function' && Number(rec.repaid) > 0) pool.owe(piece.id, Number(rec.repaid));
      } catch { /* noop */ }
    }
  }

  /**
   * 发一份**失与得**的换入候选（3 件，`ps.relicOfferMode = 'swap'`）。
   *
   * 稀有度门（官方「产出跟投入挂钩」）：给了 `giveId` 就按它的档位过滤 —— 同档优先，池里没有对等档才降到低档，
   * 并在卡面标 `downgraded: true`（客户端据此显示「已降档」）。不传 `giveId`（事件刚选中、还没选换出）时发全档候选。
   * @param {object} ps @param {string|null} giveId
   * @returns {boolean} 是否真的发出了 offer
   */
  relicSwapOffer(ps, giveId = null) {
    if (!ps || ps.alive === false) return false;
    const pool = this.relicDraftPool();
    if (!pool.length) return false;
    const owned = new Set(Array.isArray(ps.relics) ? ps.relics : []);
    const free = pool.filter((r) => r && !owned.has(r.id));
    if (!free.length) return false;
    const give = giveId ? String(giveId) : '';
    const giveRank = this.relicTierRank(give ? this.relicTierOf(give) : '');
    let cands = free;
    let downgraded = false;
    if (giveRank > 0) {
      const lower = free.filter((r) => {
        const rk = this.relicTierRank(r && r.tier);
        return rk > 0 && rk <= giveRank;
      });
      const equal = lower.filter((r) => this.relicTierRank(r && r.tier) === giveRank);
      cands = equal.length ? equal : lower;
      downgraded = !equal.length && cands.length > 0;
    }
    if (!cands.length) return false;
    const round = Number(this.round) || 1;
    const rng = createRng(deriveSeed(this.seed, `relic-swap:${round}:${ps.playerId}:${give}`));
    const take = shuffled(cands, rng).slice(0, 3);
    if (!take.length) return false;
    const extra = give ? { swapGive: give } : {};
    const down = downgraded ? { downgraded: true } : {};
    ps.relicOffer = take.map((r) => r.id);
    ps.relicOfferCards = take.map((r) => ({
      id: r.id,
      name: String(r.name || r.id),
      desc: String(r.desc || ''),
      icon: String(r.icon || `/assets/relics/${r.id}.png`),
      tier: String(r.tier || ''),
      set: String(r.set || ''),
      kind: String(r.kind || ''),
      mode: 'swap',
      ...extra,
      ...down,
    }));
    ps.relicOfferMode = 'swap';
    ps.relicOfferRound = round;
    ps.relicSwapGive = give || null;
    try { this.markPrivate(ps); } catch (e) { this.reportError('relic swap offer', e); }
    try { this.markPublic(); } catch { /* best effort */ }
    return true;
  }

  /**
   * **失与得**：1 件藏品换 1 件（2026-11-06，官方「选择自己持有但不需要的 1 件，换 1 件新的」）。
   *
   * 顺序：校验 → `relicRevoke(giveId)`（逆运算 + 从 relics 移除）→ `relicGrant(takeId)`（正常下发，含新账本）→
   * 清掉这份 swap offer。数量因此不变；rule 类聚合随 `ps.relics` 自然重算。
   * 稀有度门：`take` 的档位不得高于 `give`（数据缺 tier 的一侧不设门）。
   * @param {object} ps @param {string} giveId @param {string} takeId
   */
  relicSwap(ps, giveId, takeId) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const give = String(giveId || '');
    const take = String(takeId || '');
    if (!give || !take) return fail(ERR.BAD_TARGET, 'bad relic'); // i18n-ignore
    const own = Array.isArray(ps.relics) ? ps.relics : [];
    if (!own.includes(give)) return fail(ERR.BAD_TARGET, 'give: not owned'); // i18n-ignore
    const offer = Array.isArray(ps.relicOffer) ? ps.relicOffer : null;
    if (!offer || !offer.length) return fail(ERR.BAD_TARGET, 'no relic offer'); // i18n-ignore
    if (!offer.includes(take)) return fail(ERR.BAD_TARGET, 'take: not offered'); // i18n-ignore
    if (give === take) return fail(ERR.BAD_TARGET, 'swap: same relic'); // i18n-ignore
    const giveRank = this.relicTierRank(this.relicTierOf(give));
    const takeRank = this.relicTierRank(this.relicTierOf(take));
    if (giveRank > 0 && takeRank > giveRank) return fail(ERR.BAD_TARGET, 'swap: rarity too high'); // i18n-ignore
    const revoked = this.relicRevoke(ps, give);
    if (revoked && revoked.error) return revoked;
    const granted = this.relicGrant(ps, take);
    if (granted && granted.error) {
      // 下发失败：把换出的那件放回（尽力而为），玩家不会白丢一件
      try { if (!ps.relics.includes(give)) ps.relics.push(give); } catch { /* noop */ }
      return granted;
    }
    ps.relicOffer = null;
    ps.relicOfferCards = null;
    ps.relicOfferMode = null;
    ps.relicSwapGive = null;
    try { this.markPrivate(ps); } catch (e) { this.reportError('relic swap', e); }
    try { this.markPublic(); } catch { /* best effort */ }
    return OK;
  }

  // ---------------------------------------------------------------------------------------------
  // 藏品三选一（业主 2026-10-27：藏品不做商店，改成海克斯那样的随机三选一；仅协同、别太频繁）
  // 节奏：协同房 R4 / R8 / R12 各一次，每人 1 份 3 选 1，20 秒不选自动取第一张。
  // ---------------------------------------------------------------------------------------------

  // ---------------------------------------------------------------------------------------------
  // 肉鸽的随机元素（不期而遇 / 每回合词缀 / 紧急作战）已于 2026-11-01 迁到独立插件 `rogue`：
  // 它用 `code.matchMixin` 往本类上叠 `rogueEvents` / `rogueEventRound` / `rogueEventOffer` /
  // `rogueEventTimeout` / `roguePick` / `rogueEmergencyRound` / `rogueRoundAffix`（见 server/match/host/mixins.js）。
  // 本文件保留调用侧的 `typeof` 守卫，插件被停用时肉鸽元素自动缺席，其余玩法不受影响。
  // ---------------------------------------------------------------------------------------------

  /** 藏品候选池（来自 relics-87 插件的 data/relics.json，经 gd.raw.relics 到达）。 */
  relicPool() {
    const raw = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const list = raw && Array.isArray(raw.relics) ? raw.relics : [];
    return list.filter((r) => r && typeof r.id === 'string' && r.id);
  }

  /**
   * 藏品节奏（2026-11-06 业主裁决：改成官方形态「按节点给」）。
   * 肉鸽**只在给藏品的节点发**：不期而遇(事件)、险路恶敌(首领)、得偿所愿(wish) 各一次三选一；
   * 战斗 / 精英 / 商店(标价直购) / 休整不发（商店由 `relicOffer` 走 shop 分支，不在这里判）。
   * 协同共竞仍是 R4 / R8 / R12。
   *
   * 时序注意：`phases.js` 的 `_startRoundAfterOffers` 在 `rogueNodeBegin(r)` **之前**调用本函数，那时
   * `st.index` 还是上一层 ⇒ 必须用 `rogueNodeTypeFor(r)` 按回合号反算，不能读当前节点状态。
   */
  relicDraftRound(r) {
    if (this.isRogue === true) {
      const type = typeof this.rogueNodeTypeFor === 'function' ? this.rogueNodeTypeFor(r) : null;
      // wish（得偿所愿）也是免费三选一（官方：不能空手离开），只是卡面文案与「不可跳过」由 `relicOffer` 标明。
      // **事件节点不再自动发牌**：官方事件是「选项带代价换藏品」，自动再发一份会与事件选项双发（单节点最多 2 件）。
      return type === 'wish' || type === 'boss' || type === 'shop';
    }
    return r === 4 || r === 8 || r === 12;
  }

  /** 给每名存活玩家发一份 3 选 1（独立抽，不与他人共享）。 */
  /**
   * 抽卡池：**只发效果真的接进引擎的藏品**（业主 2026-11-01「完成完整肉鸽」）。
   * 87 条里 55 条的效果尚未接入（41 条纯 `rule` 类 + ally/price/income 等）——发出去只会是「什么都不做」的死牌。
   * 兜底：若数据侧一条都没有已实现效果（老数据/裁剪包），退回全池，绝不让抽卡空转。
   */
  relicDraftPool() {
    const all = this.relicPool();
    const live = all.filter((r) => relicEffectApplied(r && r.effect));
    return live.length ? live : all;
  }

  relicOffer() {
    // 协同共竞与肉鸽都有藏品节奏（业主 2026-10-30「肉鸽并入协同」）。这里以前只认 `mode_xie_` 前缀，
    // 而肉鸽的 modeId 是 `mode_multi_*` ⇒ 肉鸽**一件藏品都发不出来**（`relicDraftRound` 每 2 回合返 true 也白搭）。
    if (!String(this.modeId || '').startsWith('mode_xie_') && this.isRogue !== true) return;
    const pool = this.relicDraftPool();
    if (!pool.length) return;
    const round = Number(this.round) || 1;
    // 官方形态（四种来源，见各自的官方口径）：
    //   · 首领取 / 事件取 —— 白给三选一（draft）；
    //   · 商店 —— 按 relics.json 的 price 直购（blue 8 / red 16，见 priceNotice）；
    //   · 得偿所愿（wish）—— 白给三选一，**免费、不能空手离开**（不给跳过/关闭，超时也自动取第一张）。
    const nodeType = this.isRogue === true && typeof this.rogueNodeTypeFor === 'function' ? this.rogueNodeTypeFor(round) : null;
    const shop = nodeType === 'shop';
    const wish = nodeType === 'wish';
    const rng = createRng(deriveSeed(this.seed, `relic:${round}`));
    const shuffle = (arr) => {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    };
    for (const ps of this.alivePlayers()) {
      if (!ps) continue;
      // 肉鸽不设「每人 3 件」上限（官方没有这条）；协同共竞保持每人本局 3 件
      if (this.isRogue !== true && Array.isArray(ps.relics) && ps.relics.length >= 3) continue;
      if (Array.isArray(ps.relicOffer) && ps.relicOffer.length) continue;         // 已经有一份没选完
      const owned = new Set(Array.isArray(ps.relics) ? ps.relics : []);
      const free = pool.filter((r) => !owned.has(r.id));
      // 得偿所愿「不能空手离开」：池子被自己抽空（全拥有）时**也要给一张** —— 兜底允许重复发已拥有的藏品。
      // 已知代价：`immediate` 类一次性效果会再结算一次（`relicGrantInstant` 是单向下发，没有「已持有」判定）；
      // 但官方口径是「不能空手离开」，空手更偏离，所以选兜底。（事件/首领的 draft 不兜底：那种情况下静默不发即可。）
      const take = free.length ? shuffle(free).slice(0, 3) : (wish ? shuffle(pool).slice(0, 3) : []);
      if (!take.length) continue;
      ps.relicOffer = take.map((r) => r.id);
      // 卡面数据一并带上（客户端不用自己查表）；商店节点额外带官方标价（relics.json 的 price）。
      // `mode` 逐卡带上：客户端 relicOverlay 优先读 `priv.relicOfferMode`，但 server 的 player/views.js 目前
      // 不下发那个字段，逐卡 mode 让它仍能区分 wish（必须选）/ draft（超时自动取）/ shop（标价）。
      const offerMode = shop ? 'shop' : (wish ? 'wish' : 'draft');
      ps.relicOfferCards = take.map((r) => ({
        id: r.id,
        name: String(r.name || r.id),
        desc: String(r.desc || ''),
        icon: String(r.icon || `/assets/relics/${r.id}.png`),
        tier: String(r.tier || ''),
        set: String(r.set || ''),
        kind: String(r.kind || ''),
        mode: offerMode,
        ...(shop ? { price: Math.max(0, Number(r.price) || 0) } : {}),
      }));
      ps.relicOfferMode = offerMode;
      ps.relicOfferRound = round;
      try { this.markPrivate(ps); } catch (e) { this.reportError('relic offer', e); }
    }
    try { this.markPublic(); } catch { /* best effort */ }
    // 超时兜底：不选就取第一张（与海克斯草案一致）
    // ⚠️ `later()` 的单位是**毫秒**（infra.js 的 `later(ms, fn)`）。原来写 `later(20, …)` = 20 **毫秒**
    // 后就自动取第一张 —— 弹窗几乎不可见也来不及点（2026-10-31 修成 20 秒）。
    try {
      this._relicTimer = this.later(20 * 1000, () => this.relicTimeout());
    } catch { /* 无调度器时忽略 */ }
  }

  /**
   * 给**一名**玩家发一份藏品三选一（肉鸽「不期而遇」的 `relic` / `relicBuy` 选项用）。
   *
   * 与 `relicOffer` 共用同一套 offer 字段（`relicOffer` / `relicOfferCards` / `relicOfferMode` / `relicOfferRound`）
   * 与同一个结算入口（`relicPick` → `relicGrant`）—— **不另写一套发牌**。代价（资金 / 生命）的足额校验与扣款
   * 在事件侧（rogue 插件的 `roguePick`）做完再来这里发牌。
   *
   * 单槽位限制：offer 只有一个槽位。已经有没选完的 offer 时**不再覆盖**它（覆盖会吞掉玩家已付费/已到手的
   * 选项），改为直接入手一件（同一池子、同一 `relicGrant` 结算）。这也是官方「单事件 0–3 件」里
   * 第二、三件的通道。
   *
   * 不排新定时器：肉鸽的事件弹窗与藏品 offer 都在回合开始发出，`relicOffer` 已经排过 20s 兜底，
   * 这里再排一次会出现两个互相覆盖的定时器。
   *
   * @param {object} ps 玩家
   * @param {'event'|'wish'} [mode] 'wish' 时卡面标「得偿所愿·必须选」，其余按免费三选一（draft）渲染
   * @returns {boolean} 是否真的发出了东西（false = 玩家不合法 / 池子为空）
   */
  relicOfferOne(ps, mode = 'event') {
    if (!ps || ps.alive === false) return false;
    const pool = this.relicDraftPool();
    if (!pool.length) return false;
    const round = Number(this.round) || 1;
    const owned = new Set(Array.isArray(ps.relics) ? ps.relics : []);
    const free = pool.filter((r) => !owned.has(r.id));
    // 全拥有时允许重复（与 relicOffer 里 wish 的兜底同口径：花了代价就不能空手）。
    const src = free.length ? free : pool;
    if (!src.length) return false;
    const rng = createRng(deriveSeed(this.seed, `relic-one:${round}:${ps.playerId}:${(ps.relics || []).length}`));
    if (Array.isArray(ps.relicOffer) && ps.relicOffer.length) {
      const pick = src[rng.int(src.length)];
      if (!pick) return false;
      this.relicGrant(ps, pick.id);
      try { this.markPrivate(ps); } catch { /* best effort */ }
      try { this.markPublic(); } catch { /* best effort */ }
      return true;
    }
    const take = shuffled(src, rng).slice(0, 3);
    if (!take.length) return false;
    const offerMode = mode === 'wish' ? 'wish' : 'draft';
    ps.relicOffer = take.map((r) => r.id);
    ps.relicOfferCards = take.map((r) => ({
      id: r.id,
      name: String(r.name || r.id),
      desc: String(r.desc || ''),
      icon: String(r.icon || `/assets/relics/${r.id}.png`),
      tier: String(r.tier || ''),
      set: String(r.set || ''),
      kind: String(r.kind || ''),
      mode: offerMode,
    }));
    ps.relicOfferMode = offerMode;
    ps.relicOfferRound = round;
    try { this.markPrivate(ps); } catch (e) { this.reportError('relic offer one', e); }
    try { this.markPublic(); } catch { /* best effort */ }
    return true;
  }

  relicTimeout() {
    for (const ps of this.alivePlayers()) {
      const offer = ps && Array.isArray(ps.relicOffer) ? ps.relicOffer : null;
      if (!offer || !offer.length) continue;
      let pick = offer[0];
      if (ps.relicOfferMode === 'shop') {
        // 商店的报价可能买不起：超时只在**买得起**的里取第一张，一张都买不起就清空（不能白拿）
        const cards = Array.isArray(ps.relicOfferCards) ? ps.relicOfferCards : [];
        const affordable = cards.find((c) => es_spendable(ps) >= Math.max(0, Number(c.price) || 0));
        if (!affordable) {
          ps.relicOffer = null; ps.relicOfferCards = null; ps.relicOfferMode = null;
          try { this.markPrivate(ps); } catch { /* best effort */ }
          continue;
        }
        pick = affordable.id;
      } else if (ps.relicOfferMode === 'wish') {
        // 得偿所愿：官方「不能空手离开」⇒ 超时也**不清空**，自动取第一张（与 draft 同形，但语义上是强制）。
        // 这条分支显式写出来，避免以后有人把「买不起就清空」的商店逻辑顺手套到 wish 上。
        pick = offer[0];
      } else if (ps.relicOfferMode === 'swap') {
        // 失与得：还没选换出就超时 ⇒ 整份 swap offer 作废（不能替玩家决定失去哪一件）；
        // 已选换出 ⇒ 自动换入第一张，换不动（稀有度门 / offer 不合法）就清空，不留下卡死的弹窗。
        if (!ps.relicSwapGive) {
          ps.relicOffer = null; ps.relicOfferCards = null; ps.relicOfferMode = null; ps.relicSwapGive = null;
          try { this.markPrivate(ps); } catch { /* best effort */ }
          continue;
        }
        let res = null;
        try { res = this.relicPick(ps, offer[0], { auto: true }); } catch { /* best effort */ }
        if (res && res.error) {
          ps.relicOffer = null; ps.relicOfferCards = null; ps.relicOfferMode = null; ps.relicSwapGive = null;
          try { this.markPrivate(ps); } catch { /* best effort */ }
        }
        continue;
      }
      if (pick) { try { this.relicPick(ps, pick, { auto: true }); } catch { /* best effort */ } }
    }
  }

  /**
   * 把一件藏品真正发到玩家身上（`relicPick` 与 `relicOfferOne` 的唯一结算入口）。
   *
   * 2026-11-06 补齐失与得需要的**可撤销**：下发时同步在 `ps.relicLedger[relicId]` 记一条「实际改了什么」的账
   * （见 `relicGrantInstant`），`relicRevoke` 按账逆运算。不做失与得时行为与改动前逐字节等价 —— 账本只是多记一笔。
   * @param {object} ps @param {string} relicId
   */
  relicGrant(ps, relicId) {
    const id = String(relicId || '');
    if (!id) return fail(ERR.BAD_TARGET, 'bad relic'); // i18n-ignore
    const def = this.relicPool().find((r) => r.id === id) || null;
    if (!Array.isArray(ps.relics)) ps.relics = [];
    ps.relics.push(id);
    try { this.relicGrantInstant(ps, def); } catch (e) { this.reportError('relic instant', e); }
    try {
      this.toast(ps, 'info', (def && def.kind === 'negative' ? '获得负面藏品：' : '获得增益藏品：') + ((def && def.name) || id));
    } catch { /* toast 尽力而为 */ }
    try { ps.dirty && ps.dirty(); } catch { /* noop */ }
    return OK;
  }

  /** 选一件：只接受自己 offer 里的 id；入手后立即结算一次性效果。 */
  relicPick(ps, relicId, { auto = false } = {}) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const offer = Array.isArray(ps.relicOffer) ? ps.relicOffer : null;
    if (!offer || !offer.length) return fail(ERR.BAD_TARGET, 'no relic offer'); // i18n-ignore
    // 失与得（swap）分两阶段，都复用这一个意图（不新增 g.*）：
    //   ① `ps.relicSwapGive` 还没定 —— 传进来的是「自己要换出的藏品」id（从藏品页点选），定下后按档位重发 offer；
    //   ② 已定 —— 传进来的是 offer 里的 takeId，走 `relicSwap` 结算。
    if (ps.relicOfferMode === 'swap') return this.relicSwapPick(ps, relicId);
    if (!offer.includes(relicId)) return fail(ERR.BAD_TARGET, 'not offered'); // i18n-ignore
    // 商店节点：按 relics.json 的官方标价扣款（blue 8 / red 16，见 priceNotice），买不起直接拒绝、offer 保留
    // 得偿所愿（wish）与 draft/event 都免费 —— 不走这里，也就没有「余额不足拒绝」的路径。
    if (ps.relicOfferMode === 'shop') {
      const card = Array.isArray(ps.relicOfferCards) ? ps.relicOfferCards.find((c) => c.id === relicId) : null;
      const price = Math.max(0, Number(card && card.price) || 0);
      if (!(es_spendable(ps) >= price)) return fail(ERR.NO_FUNDS);
      if (price > 0 && !es_safe_spend(ps, price)) return fail(ERR.NO_FUNDS);
    }
    ps.relicOffer = null;
    ps.relicOfferCards = null;
    ps.relicOfferMode = null;
    try { this.relicGrant(ps, relicId); } catch (e) { this.reportError('relic grant', e); }
    try { this.markPrivate(ps); } catch (e) { this.reportError('relic pick markPrivate', e); }
    try { this.markPublic(); } catch (e) { this.reportError('relic pick markPublic', e); }
    void auto;
    return OK;
  }

  /**
   * 失与得的两阶段点击（`relicPick` 在 `relicOfferMode === 'swap'` 时转进来）。
   * 阶段①：`ps.relicSwapGive` 还是空的 ⇒ 传进来的是自己要换出的藏品 id，校验持有后按档位重发 offer；
   * 阶段②：已定 ⇒ 传进来的是 takeId，直接 `relicSwap`（稀有度 / offer 归属都在那里校验）。
   */
  relicSwapPick(ps, relicId) {
    const id = String(relicId || '');
    if (!id) return fail(ERR.BAD_TARGET, 'bad relic'); // i18n-ignore
    if (!ps.relicSwapGive) {
      const own = Array.isArray(ps.relics) ? ps.relics : [];
      if (!own.includes(id)) return fail(ERR.BAD_TARGET, 'swap: give not owned'); // i18n-ignore
      if (!this.relicSwapOffer(ps, id)) return fail(ERR.BAD_TARGET, 'swap: no candidate'); // i18n-ignore
      return OK;
    }
    return this.relicSwap(ps, ps.relicSwapGive, id);
  }

  /** 按 relicId 购买藏品：校验商店等级 → 个人储备，再扣款并记入 `ps.relics`。 */
  meltBuyRelic(ps, relicId) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const row = this.meltRelicRows(this.meltShopLevel(), Math.max(0, Math.floor(Number(es_spendable(ps)) || 0)))
      .find((r) => r.relicId === relicId);
    if (!row) return fail(ERR.BAD_TARGET, 'not a relic'); // i18n-ignore
    if (!row.unlocked) return fail(ERR.WRONG_PHASE, 'shop level too low'); // i18n-ignore
    if (!(es_spendable(ps) >= row.price)) return fail(ERR.NO_FUNDS);
    if (!es_safe_spend(ps, row.price)) return fail(ERR.NO_FUNDS);
    if (!Array.isArray(ps.relics)) ps.relics = [];
    ps.relics.push(relicId);
    const rawR = (this.gd && this.gd.raw && this.gd.raw.relics) || null;
    const defR = rawR && Array.isArray(rawR.relics) ? rawR.relics.find((r) => r.id === relicId) : null;
    try { this.relicGrantInstant(ps, defR); } catch (e) { this.reportError('relic instant', e); }
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** 按 itemId 购买（目录式商店）：先判等阶/余额/手牌，再扣个人储备，最后发装备。 */
  meltBuy(ps, itemId) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore
    if (!ps.alive) return fail(ERR.ELIMINATED);
    const rec = this.gd && typeof this.gd.item === 'function' ? this.gd.item(itemId) : null;
    if (!rec || !isShopItem(rec) || rec.requiresBondId) return fail(ERR.BAD_MSG, 'not a shop item'); // i18n-ignore
    const tier = Number(rec.tier) || 0;
    if (tier > this.meltShopLevel()) return fail(ERR.WRONG_PHASE, 'shop level too low'); // i18n-ignore
    const price = meltItemPrice(rec, this.teamProjects && this.teamProjects.equipCost);
    if (!(es_spendable(ps) >= price)) return fail(ERR.NO_FUNDS);
    if (typeof freeSlot === 'function' && freeSlot(ps.hand) < 0) return fail(ERR.HAND_FULL);
    if (!es_safe_spend(ps, price)) return fail(ERR.NO_FUNDS);
    try { ps.acquireItem(itemId, { source: 'melt' }); }
    catch (e) { this.reportError('melt buy', e); }
    ps.recompute();
    ps.dirty();
    this.markPrivate(ps);
    this.markPublic();
    return OK;
  }

  /** g.meltClose：不买 / 买完离开。所有人都关掉之后才继续下一关。 */
  meltClose(ps) {
    const st = this.melt;
    if (!st || !st.open) return fail(ERR.WRONG_PHASE, '商店没有开启'); // i18n-ignore
    if (!st.offers.has(ps.playerId)) return fail(ERR.BAD_TARGET);
    st.closed.add(ps.playerId);
    this.markPrivate(ps);
    this.markPublic();
    const humans = this.alivePlayers().filter((p) => !p.isBot);
    if (humans.every((p) => st.closed.has(p.playerId))) this._meltFinish();
    return OK;
  }

  _meltFinish() {
    const st = this.melt;
    if (!st || !st.open) return;
    st.open = false;
    const cb = st.cb;
    st.cb = null;
    // 玩家按钮打开的商店：关店后回到进入前的阶段（不推进回合）
    if (!cb && st.resumePhase) {
      this.phase = st.resumePhase;
      this.deadline = st.resumeDeadline || 0;
      st.resumePhase = null;
      st.resumeDeadline = null;
    }
    for (const ps of this.players.values()) {
      ps.dirty();
      this.markPrivate(ps);
    }
    this.markPublic();
    if (typeof cb === 'function') cb();
  }

  /** 超时兜底：所有人自动关店（防挂机卡住整局）。 */
  meltTimeout() {
    const st = this.melt;
    if (!st || !st.open) return;
    this._meltFinish();
  }

  /** 代价倍率（与 endlessMul 相乘）。 */
  meltMul() {
    const st = this.melt;
    if (!st) return 1;
    const extra = (Number(st.debt.allStats) || 0) + (Number(st.growth) || 0);
    return extra > 0 ? 1 + extra / 100 : 1;
  }

  /** `dmg` 折算成等效生命倍率（10% 减伤 ≈ ×1.111 血量）。 */
  /**
   * 「部署回复」档（业主 2026-10-26 接线 / 2026-10-27 补）：debts.deploy 每 1% 让干员 DP 回复速率降 1%，
   * 上限压到 20%（不低于 0）。乘在 battle flags 的 dpPerSec 上（sim/lifecycle.js 直接读它）。
   * @returns {number} 0..1 的乘子
   */
  meltDeployMul() {
    const st = this.melt;
    if (!st) return 1;
    const r = Math.max(0, Math.min(0.8, (Number(st.debt && st.debt.deploy) || 0) / 100));
    return r > 0 ? 1 - r : 1;
  }

  meltHpMul() {
    const st = this.melt;
    if (!st) return 1;
    const r = Math.max(0, Math.min(0.8, (Number(st.debt.dmg) || 0) / 100));
    return r > 0 ? 1 / (1 - r) : 1;
  }

  /** m.private.meltdown：只发给本人。 */
  meltdownView(ps) {
    const st = this.melt;
    if (!st || !st.open) return null;
    const offer = st.offers.get(ps.playerId);
    if (!offer) return null;
    return {
      wave: st.wave,
      cards: offer.cards.map((c, i) => ({ ...c, sold: !!offer.sold[i] })),
      sold: offer.sold.slice(),
      debt: { ...st.debt },
      funds: es_spendable(ps),
      prices: offer.cards.map((c) => meltFundsPrice(c)),
      growth: st.growth,
      closed: st.closed.has(ps.playerId),
      pool: { prismatic: st.pool.prismatic.length, gold: st.pool.gold.length, silver: st.pool.silver.length },
      // 目录式商店：按品阶分组的全量可售装备（每件带价格/出处/可买状态）
      catalog: typeof this.meltCatalog === 'function' ? this.meltCatalog(ps) : null,
    };
  }
}
