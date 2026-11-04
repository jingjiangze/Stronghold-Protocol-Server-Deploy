// shared/hexes.js — 海克斯 (Hex) definitions: a TFT-style augment. At the start of round 1 every player is offered
// HEX_OFFER_SIZE random hexes and picks one; the pick is a match-long global bonus.
//
// This module says only WHAT a hex is (id / name / text / icons / grade / category / requirements / passive params).
// HOW a hex is applied lives entirely on the server (server/match/match/hexDraft.js MatchHexDraft), so the client never
// has to trust its own copy of the rules. The client (public/js/ui/hexOverlay.js) just renders these records.
//
// i18n: Chinese is the source language (shared/i18n.js SOURCE_LANG), so the plain strings below are the msgids — the
// overlay wraps them in t() / tName() on the client.
//
// 字段速查（详见 docs/MOD-HEX.md）
//   id / name / desc                 卡面文字
//   grade                            等级：silver 白银 / gold 黄金 / prismatic 炫彩（卡面配色）
//   category                         归类用的稳定英文键（'reinforce' / 'combat' / 'economy'），与语言无关，供代码筛选分组
//   tags                             卡面标签（字符串数组，会逐个渲染成小 chip）
//   icon / iconBond / iconId         卡面字形图标 / 盟约真实图标 / 效果栏徽章素材
//   requires.bond                    候选过滤：该盟约在本局不可用时，这条海克斯不进入候选池
//   firstDraftOnly                   只在**第一次**草案（第 1 回合）出现；第 7 回合的第二次候选里一定没有它
//   grant { kind, … }                立即发放：funds / freeRefresh / bondChess / randomBudget
//   spawnMods { hpMul/atkMul/… }     被动：乘进该玩家战场每个敌人的数值
//   keepFunds / incomeInterest       被动：回合结束保留资金 / 下回合利息（奸商本色）
//   roundStartFreeRefresh            被动：每回合开始送 N 次免费刷新（DD街区）
//   refreshTicket { every | chance } 被动：每次刷新按计数或概率送免费刷新（门票）
//   easterEgg { band, text }         彩蛋：仅当玩家的策略(角色)是该 band 时，卡面多一行斜体小字
//
// 归类示例：const economyHexes = HEXES.filter((h) => h.category === HEX_CATEGORY.ECONOMY);

/** How many hexes a draft offers each player. */
export const HEX_OFFER_SIZE = 3;
/** Free rerolls per CARD of a draft (each card may be refreshed once, on its own). */
export const HEX_REROLLS = 1;
/** Co-op choice time limit, seconds. On timeout the FIRST card of the offer is taken. Solo matches are untimed. */
export const HEX_CHOICE_SECONDS = 15;
/** 联合模式（coop）的海克斯选择时长（this fork 应用户要求 +10 秒；独立模拟仍 15 秒不限时的展示值）。 */
export const HEX_CHOICE_SECONDS_MULTI = 25;
/**
 * 第二次海克斯的回合：第 7 回合开始时再开一次三选一，且**不可与第一次相同**、按权重重新随机等级、
 * **不提供刷新**（`ps.hexRerolls` 为 null，客户端连「换」键都不画）。第 1 回合那次见 `HEX_FIRST_ROUND`。
 */
// v0.05：把「攻击力与生命值（同值）」这类效果按全属性折算成全能穿透（见 shared/pierce.js）
import { convertAllStats } from './pierce.js';

export const HEX_FIRST_ROUND = 1;
export const HEX_SECOND_ROUND = 7;

/**
 * 等级（云顶之弈式）。**一次候选只用一个等级** —— 黄金与白银（以及炫彩）绝不混在同一个池子里，
 * 由 MatchHexDraft.hexOfferGrade 在开选前定好，玩家的三张卡全部是同一个等级。
 */
export const HEX_GRADE = Object.freeze({
  SILVER: 'silver',        // 白银
  GOLD: 'gold',            // 黄金
  PRISMATIC: 'prismatic',  // 炫彩
});

/** 等级的中文名（卡面标签 + 选择界面标题）。 */
export const HEX_GRADE_NAME = Object.freeze({
  silver: '白银', gold: '黄金', prismatic: '炫彩',
});

/** 等级的颜色（客户端 hex.css 的 --hex-grade-* 同值；这里给出便于文档与测试引用）。 */
export const HEX_GRADE_COLOR = Object.freeze({
  silver: '#c9d6e2', gold: '#f0c04a', prismatic: '#ff6ec7',
});

/**
 * 第 1 回合那颗骰子：候选等级的权重。炫彩刻意稀有。
 * 只在「本局至少还有 HEX_OFFER_SIZE 条可用」的等级里抽；v0.03.3 起**三个等级等概率**（34/33/33，合计仍 100）。
 */
// v0.03.3 用户要求「随机海克斯出现权重平均」：原来是 45/45/10（炫彩很稀有，玩家反馈从没见过金色/炫彩），
// 改成三档等概率 34/33/33（刻意让合计仍是 100，tools/hex-test-static.mjs 有这条不变式）。
export const HEX_GRADE_WEIGHTS = Object.freeze({ silver: 34, gold: 33, prismatic: 33 });

/**
 * 对局选项 · 海克斯等级 (this fork)：房主可把本局**两次**三选一的等级钉死，或交回随机（默认）。
 * `HEX_GRADE_CHOICES` 是 room.setHexGrade 的合法值；'random' 之外的都是 HEX_GRADE 的键。
 */
export const HEX_GRADE_RANDOM = 'random';
export const HEX_GRADE_CHOICES = Object.freeze([HEX_GRADE_RANDOM, HEX_GRADE.SILVER, HEX_GRADE.GOLD, HEX_GRADE.PRISMATIC]);

/** 规整 room.setHexGrade / room.state.hexGrade：合法值原样返回，否则回退 'random'。 */
export function normalizeHexGradeChoice(v) {
  return HEX_GRADE_CHOICES.includes(v) ? v : HEX_GRADE_RANDOM;
}

/** 归类键。加海克斯时从这里取，或自己新增一个。 */
export const HEX_CATEGORY = Object.freeze({
  REINFORCE: 'reinforce',   // 增援类（发放干员）
  COMBAT: 'combat',         // 战斗类（改敌我数值）
  ECONOMY: 'economy',       // 经济类（资金 / 商店 / 刷新）
});

/**
 * 地区盟约（data/bonds.json 里 bondType === 'SEASON' 的 *Ship）→ 一个「随机 5 阶该盟约干员」的海克斯，
 * 与 大炎增援 同形。干员归属按 chess.json 的 `bonds` 判定（即游戏自己的盟约归属，例如 龙门/岁 的干员也计入炎）。
 *
 * 筛选维度是 **`tier`（阶）**，不是 `rarity`。chess.json 有四个互不相同的维度：
 *   `tier` 阶 1–6（游戏 UI 里那个罗马数字角标 TierChip，`{tier}阶`）
 *   `rarity` 星级 4/5/6（明日方舟稀有度，客户端 UI 基本不显示）
 *   `price` 商店费用 2/3/4
 *   `shopSortId` 商店排序
 * 玩家在界面上看到并称作「几星/几阶」的就是 **`tier`**，所以按 `tier` 筛才与玩家预期一致。
 * @type {[string, string, string][]} [bondId, hexId, 名称]
 */
const REGION_REINFORCE = [
  ['yanShip', 'yan_reinforce', '大炎增援'],
  ['victoriaShip', 'victoria_reinforce', '维多利亚增援'],
  ['kjeragShip', 'kjerag_reinforce', '谢拉格增援'],
  ['sargonShip', 'sargon_reinforce', '萨尔贡增援'],
  ['siracusaShip', 'siracusa_reinforce', '叙拉古增援'],
  ['lateranoShip', 'laterano_reinforce', '拉特兰增援'],
  ['kazimierzShip', 'kazimierz_reinforce', '卡西米尔增援'],
  ['egirShip', 'egir_reinforce', '阿戈尔增援'],
];

/** 地区盟约的中文名（与 bonds.json 的 name 一致），用于卡面标签与描述。 */
const REGION_NAME = {
  yanShip: '炎', victoriaShip: '维多利亚', kjeragShip: '谢拉格', sargonShip: '萨尔贡',
  siracusaShip: '叙拉古', lateranoShip: '拉特兰', kazimierzShip: '卡西米尔', egirShip: '阿戈尔',
};

/** 地区增援的筛选条件：5 阶（`tier` —— 游戏 UI 显示的那个罗马数字角标；见上方注释）。 */
export const REGION_REINFORCE_TIER = 5;

const regionHex = (bondId, id, name) => Object.freeze({
  id,
  name,
  desc: `立即随机获得 1 名 ${REGION_REINFORCE_TIER} 阶「${REGION_NAME[bondId] || bondId}」干员。`,
  grade: HEX_GRADE.GOLD,
  category: HEX_CATEGORY.REINFORCE,
  tags: Object.freeze(['增援', REGION_NAME[bondId] || bondId]),
  icon: 'flag',
  iconBond: bondId,
  iconId: 'icon_team_buff',
  // 该盟约在本局不可用（被模式静态关闭 / 池子里没干员 / 该盟约的 5 阶干员全被禁）时，这条海克斯不出现在候选里
  requires: { bond: bondId, tier: REGION_REINFORCE_TIER },
  grant: { kind: 'bondChess', bond: bondId, tier: REGION_REINFORCE_TIER },
});

/**
 * 天选系列 (this fork, 炫彩)：立即随机获得 1 名 5 阶该地区干员，之后**每回合开始**再随机获得 1 名该地区干员，
 * 阶数不超过当前调度中心等级。`requires.bond` 与地区增援同规则 —— 本局该盟约不可用就不进池。
 * 每回合的发放由 `roundStartChess` 驱动（MatchHexDraft.hexRoundStartChess，PlayerRound.startRound 调用）。
 */
const destinyHex = (bondId, id, name) => Object.freeze({
  id,
  name,
  desc: `立即随机获得 1 名 ${REGION_REINFORCE_TIER} 阶「${REGION_NAME[bondId] || bondId}」干员；之后每回合开始再随机获得 1 名「${REGION_NAME[bondId] || bondId}」干员（阶数不超过当前调度中心等级）。第 7 回合额外获得 1 名 6 阶「${REGION_NAME[bondId] || bondId}」干员（在第 7 回合或之后选中本海克斯时立即补发）。`,
  grade: HEX_GRADE.PRISMATIC,
  category: HEX_CATEGORY.REINFORCE,
  tags: Object.freeze(['增援', '彩', REGION_NAME[bondId] || bondId]),
  icon: 'flag',
  iconBond: bondId,
  iconId: 'icon_team_buff',
  requires: { bond: bondId, tier: REGION_REINFORCE_TIER },
  grant: { kind: 'bondChess', bond: bondId, tier: REGION_REINFORCE_TIER },
  roundStartChess: { bond: bondId, tierCap: 'shop', tier6Round: 7 },
});

/** 天选系列：[bondId, hexId, 名称] —— 每个地区盟约一条，全部炫彩。 */
const REGION_DESTINY = [
  ['yanShip', 'tianxuan_yan', '天选大炎'],
  ['victoriaShip', 'tianxuan_victoria', '天选维多利亚'],
  ['kjeragShip', 'tianxuan_kjerag', '天选谢拉格'],
  ['sargonShip', 'tianxuan_sargon', '天选萨尔贡'],
  ['siracusaShip', 'tianxuan_siracusa', '天选叙拉古'],
  ['lateranoShip', 'tianxuan_laterano', '天选拉特兰'],
  ['kazimierzShip', 'tianxuan_kazimierz', '天选卡西米尔'],
  ['egirShip', 'tianxuan_egir', '天选阿戈尔'],
];

/**
 * 凭证系列（this fork）：[bondId, hexId, 名称] —— 每个地区盟约一条，全部黄金。
 * 发放「变形同构体 + 该盟约的联动装备」各 1 件（grant.kind === 'credential'，MatchHexDraft._hexApply）：
 * 两件同装于一名干员时，该干员视为拥有对应盟约（变形同构体的官方配对机制，判据 shared/morph.js）。
 * 附加条款与增援一致：本局未解锁该盟约就不进候选（requires.bond）；同一时间的三选一里只会出现一个
 * （category 'reinforce' 共用增援限流）；多人模式下同一张凭证不会同时刷给队友（hexOffer 的凭证互斥）。
 * 「对应的另一件装备」= items.json 里 `giveBondId` 为该盟约、**阶数最高**的非进阶（_a）装备 ——
 *   炎=炎国短刀(3) / 维多利亚=灼燃维式重锤(4) / 谢拉格=谢拉格不融冰(5) / 萨尔贡=萨尔贡浓茶(2) /
 *   叙拉古=叙拉古正装(3) / 拉特兰=拉特兰桥夹(4) / 卡西米尔=卡西米尔竞技旗(4) / 阿戈尔=阿戈尔重刃(3)。
 */
const credentialHex = (bondId, id, name, pairName) => Object.freeze({
  id,
  name,
  desc: `获得 1 件「变形同构体」与 1 件「${pairName}」。两者同装于一名干员时，该干员视为拥有「${REGION_NAME[bondId] || bondId}」盟约。`,
  grade: HEX_GRADE.GOLD,
  category: HEX_CATEGORY.REINFORCE,
  tags: Object.freeze(['增援', '凭证', REGION_NAME[bondId] || bondId]),
  icon: 'flag',
  iconBond: bondId,
  iconId: 'icon_player_buff',
  requires: { bond: bondId },
  grant: { kind: 'credential', bond: bondId },
});

const REGION_CREDENTIAL = [
  ['yanShip', 'yan_credential', '炎凭证', '炎国短刀'],
  ['victoriaShip', 'victoria_credential', '维多利亚凭证', '灼燃维式重锤'],
  ['kjeragShip', 'kjerag_credential', '谢拉格凭证', '谢拉格不融冰'],
  ['sargonShip', 'sargon_credential', '萨尔贡凭证', '萨尔贡浓茶'],
  ['siracusaShip', 'siracusa_credential', '叙拉古凭证', '叙拉古正装'],
  ['lateranoShip', 'laterano_credential', '拉特兰凭证', '拉特兰桥夹'],
  ['kazimierzShip', 'kazimierz_credential', '卡西米尔凭证', '卡西米尔竞技旗'],
  ['egirShip', 'egir_credential', '阿戈尔凭证', '阿戈尔重刃'],
];

/** 经济类 · 立即发放资金（MatchHexDraft._hexApply 的 grant.kind === 'funds'）。 */
const fundsHex = (id, name, grade, gain) => Object.freeze({
  id,
  name,
  desc: `立即获得 ${gain} 资金。`,
  grade,
  category: HEX_CATEGORY.ECONOMY,
  tags: Object.freeze(['经济']),
  icon: 'sell',
  iconId: 'icon_player_buff',
  grant: { kind: 'funds', gain },
});

/** 经济类 · 立即发放免费刷新次数（ps.shop.freeRefreshes，游戏原生的免费刷新）。 */
const freeRefreshHex = (id, name, grade, count) => Object.freeze({
  id,
  name,
  desc: `立即获得 ${count} 次免费刷新次数。`,
  grade,
  category: HEX_CATEGORY.ECONOMY,
  tags: Object.freeze(['经济']),
  icon: 'bolt',
  iconId: 'icon_stage_buff',
  grant: { kind: 'freeRefresh', count },
});

/** 经济类 · 门票（每次刷新按计数或概率送免费刷新，读 MatchHexDraft.hexOnRefresh）。 */
const ticketHex = (id, name, grade, spec, desc) => Object.freeze({
  id,
  name,
  desc,
  grade,
  category: HEX_CATEGORY.ECONOMY,
  tags: Object.freeze(['经济']),
  icon: 'target',
  iconId: 'icon_stage_buff',
  refreshTicket: Object.freeze(spec),
});

/**
 * 战斗类 · 协防协议：每个已激活的不同盟约给全体干员 +全属性（读 hexOpsBuffsOf，随 battleInput 每场重算）。
 * v0.05 平衡：原文「攻击力和生命值（同值）」按**全属性提升**认定 —— 取出 25% 按 R=50 折成全能穿透，
 * 剩下 75% 作为真正的全属性（攻/生/防/抗一起）。
 */
const pactHex = (id, name, grade, pct) => {
  const split = convertAllStats({ allPct: pct * 100 });
  const kept = split.kept / 100;
  return Object.freeze({
    id,
    name,
    desc: `你每有一个激活的不同盟约，你的干员获得 ${Math.round(split.kept * 100) / 100}% 全属性提升与 ${split.pierce}% 全能穿透。`,
    grade,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '增益']),
    icon: 'flag',
    iconId: 'icon_player_buff',
    opsPerActiveBond: { atk: kept, hp: kept, def: kept, res: kept, pierce: split.pierce / 100 },
  });
};

/**
 * 战斗类 · 宝宝学院：1–3 阶干员的全属性加成，合成精锐后额外攻速（++ 精锐化时送一件随机装备）。
 * v0.05 平衡：原文「攻击力与生命值（同值）」按全属性认定，25% 折成全能穿透（穿透为队伍通用）。
 */
const academyHex = (id, name, grade, pct, eliteItem) => {
  const split = convertAllStats({ allPct: pct * 100 });
  const kept = split.kept / 100;
  return Object.freeze({
    id,
    name,
    desc: `你的 1–3 阶干员获得 ${Math.round(split.kept * 100) / 100}% 全属性提升，合成至精锐后额外获得 ${Math.round(pct * 100)}% 攻速加成`
      + `${eliteItem ? '；合成精锐时获得一件随机装备（不超过商店等级）' : ''}；你的干员额外获得 ${split.pierce}% 全能穿透。`,
    grade,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '增益']),
    icon: 'gear',
    iconId: 'icon_player_buff',
    opsAcademy: { maxTier: 3, atk: kept, hp: kept, def: kept, res: kept, pierce: split.pierce / 100, eliteAspd: pct, eliteItem: eliteItem === true },
  });
};

/**
 * 战斗类 · 名刀·司命：生命值将低于 1 时的保命 + 之后整局的干员生命加成（settle.js / battleInput 读）。
 * v0.05：只剩炫彩一条（黄金版删除），并且**触发后进入 cooldown 回合冷却**，冷却结束可再次触发，
 * 每次触发都会再叠加一次生命加成（ps.famedHpBonus 累加）。
 */
const famedBladeHex = (id, name, grade, saveLp, hpBonus, cooldown) => Object.freeze({
  id,
  name,
  desc: `当你的生命值将低于 1 时，回复 ${saveLp} 点生命（本回合你的生命值不会再减少），本局对战剩余时间你的干员获得 ${Math.round(hpBonus * 100)}% 生命值加成。触发后进入 ${cooldown} 回合冷却，冷却结束后可再次触发（每次触发都会再叠加一次生命加成）。`,
  grade,
  category: HEX_CATEGORY.COMBAT,
  tags: Object.freeze(['战斗', '保命']),
  icon: 'bolt',
  iconId: 'icon_player_buff',
  deathSave: { lp: saveLp, hpBonus, cooldown },
});

/** 经济类 · 命运：立即资金 + 随机一个同等级海克斯（bonusHex —— _hexApply 结算；奖励池排除命运本身防连环）。 */
const fundsHexLike = (id, name, grade, gain) => Object.freeze({
  id,
  name,
  desc: `立即获得 ${gain} 资金，并随机获得一个${HEX_GRADE_NAME[grade]}海克斯。`,
  grade,
  category: HEX_CATEGORY.ECONOMY,
  tags: Object.freeze(['经济', '命运']),
  icon: 'bolt',
  iconId: 'icon_team_buff',
  grant: { kind: 'funds', gain },
  bonusHex: grade,
});

/** 战斗类 · 我来兜底（仅限联合模式）：替队友联合防守时干员的攻击加成（unite.js 的联防 spec 读）。 */
const backupHex = (id, name, grade, atk, allStats = false, pierceOnUnite = 0) => Object.freeze({
  id,
  name,
  desc: allStats
    ? `当你需要替队友联合防守时，你的干员所有数值（攻击 / 生命 / 防御 / 法抗）获得 ${Math.round(atk * 10000) / 100}% 加成、并获得 ${Number(pierceOnUnite) || 0}% 全能穿透。`
    : `当你需要替队友联合防守时，你的干员获得 ${Math.round(atk * 100)}% 攻击力加成。`,
  grade,
  category: HEX_CATEGORY.COMBAT,
  tags: Object.freeze(['战斗', '联合']),
  icon: 'eye',
  iconId: 'icon_player_buff',
  uniteAtk: atk,
  // 我来兜底++：加成作用于全部数值（atk/hp/def/res），不再是单纯攻击（unite.js 读）
  ...(allStats ? { uniteAllStats: true } : {}),
  ...(pierceOnUnite > 0 ? { pierce: pierceOnUnite, unitePierce: true } : {}),
  // 仅联合模式（coop）出现：hexEligible 读 requires.mode
  requires: { mode: 'coop' },
});

/**
 * 盟约专属系列（第六轮征集, this fork）：主盟约战斗机制线 —— 不动「给干员」的增援/天选/凭证，只让该盟约
 * 玩出第二种打法。全局规则（MatchHexDraft）：
 *   · **每局只能选一个**：任何人选下一条盟约专属后，本局所有后续草案不再出现盟约专属（hexExclusiveTaken）；
 *     同一次三选一里也最多一条（hexDraw 限流，与增援限流同形）；
 *   · **炫彩附加**：选择后立即随机获得 1 名 3 阶对应盟约干员（grant bondChess tier 3，_hexApply 结算）；
 *   · **加权**：第一回合之后的草案，所有「盟约系」海克斯（requires.bond）更倾向于当前已激活的盟约，
 *     激活层数越多权重越高（hexDraw 的加权抽样，opts.player / opts.draft）。
 * `pendingHook: true` = 效果钩子尚未实装（hexEligible 暂不投放，图鉴可见）；实装一批放开一批。
 * 战斗侧效果经 spec.players[].hexes 进 Battle（MatchHexDraft.playerHexes / support.playerHexIds 读）。
 */
const bondExclusiveHex = (bondId, spec) => Object.freeze({
  id: spec.id,
  name: spec.name,
  desc: spec.desc,
  grade: spec.grade,
  category: spec.category || HEX_CATEGORY.COMBAT,
  tags: Object.freeze(['盟约专属', REGION_NAME[bondId] || bondId, ...(spec.tags || [])]),
  icon: 'flag',
  iconBond: bondId,
  iconId: 'icon_team_buff',
  bondExclusive: true,
  bond: bondId,
  requires: { bond: bondId, ...(spec.tier3 ? { tier: 3 } : {}) },
  ...(spec.tier3 ? { grant: { kind: 'bondChess', bond: bondId, tier: 3 } } : {}),
  ...(spec.pendingHook ? { pendingHook: true } : {}),
  ...(spec.extra || {}),
});

/**
 * 第六轮征集（2026-10-16 定稿）：主盟约 18 条中的 11 条 + 投资人炫彩 1 条 = **12 条本轮实装**；
 * 其余 7 条（焚尽八荒 / 薪火相传 / 萨满战鼓 / 王室宝库 / 王室铸币 / 深海猎场 / 黑手帝国）与凛冬将至的移速句、
 * 沙暴的技能叠进、雪幕 pending —— 需要的战斗钩子在下一批（core.js 各盟约段）。
 */
// 暂缓存档 (this fork)：投资人「财团」（第六轮 · 炫彩）—— 2026-10-16 起暂停使用，不进海克斯列表与图鉴；
// 效果（购买返还 30%）已实装，恢复 = 把这段展开进 BOND_EXCLUSIVE。
// bondExclusiveHex('investorShip', {
//   id: 'bx_investor_syndicate', name: '财团', grade: HEX_GRADE.PRISMATIC,
//   tags: ['玩法改写', '经济', '购买'],
//   desc: '每次购买干员时，返还其费用 30% 的资金，向下取整且至少返还 1 资金。',
//   category: HEX_CATEGORY.ECONOMY,
//   extra: { purchaseRefund: 0.3 },
// }),
/**
 * 双盟约系列 (v0.04.3，用户设计)：**两个盟约**共同支撑的一条海克斯。
 *   · 解锁：`requires.bonds` 里的两个盟约**都没有被锁定**（本局都可用、都有至少 1 名的干员池）才出现；
 *   · 限流：和普通盟约专属同一条规则（bondExclusive = 每局只能选一个盟约系专属；同批三选一最多一条）；
 *   · 图标：`iconBond` + `iconBond2` 各取一半拼接（客户端 hexGlyph.js 画成左红右蓝 + 粒子）；
 *   · 赠送：`grants` 一次发多名干员（默认两个盟约各 1 名 1 阶）；
 *   · 层数互换：`dualBond.sharePct` 由 **Match.hexDualBondShare 这个通用钩子**统一处理 —— 以后再加双盟约海克斯，
 *     只要在 spec 里写 `dualBond: { a, b, sharePct }`，不需要碰 Match / economy 一行代码。
 */
const dualBondHex = (a, b, spec) => Object.freeze({
  id: spec.id,
  name: spec.name,
  desc: spec.desc,
  grade: spec.grade || HEX_GRADE.PRISMATIC,
  category: spec.category || HEX_CATEGORY.COMBAT,
  tags: Object.freeze(['双盟约', REGION_NAME[a] || a, REGION_NAME[b] || b, ...(spec.tags || [])]),
  icon: 'flag',
  iconBond: a,
  iconBond2: b,               // 双盟约图标：两个盟约图标各一半（客户端按它拼接）
  iconId: 'icon_team_buff',
  bondExclusive: true,
  bond: a,                    // 兼容字段：加权/图鉴按主盟约归组
  dualBond: Object.freeze({ a, b, sharePct: spec.sharePct ?? 0.25 }),
  requires: { bonds: Object.freeze([a, b]) },
  grants: Object.freeze(spec.grants || [
    Object.freeze({ kind: 'bondChess', bond: a, tier: 1 }),
    Object.freeze({ kind: 'bondChess', bond: b, tier: 1 }),
  ]),
  ...(spec.extra || {}),
});

const BOND_EXCLUSIVE = [
  // ===== 炎 =====
  bondExclusiveHex('yanShip', {
    id: 'bx_yan_burnall', name: '焚尽八荒', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['玩法改写', '灼燃', '全队'],
    desc: '【炎】不再召唤「炎佑」，改为所有【炎】干员的攻击附带等于其攻击力 25% 的灼燃损伤，并无视目标 50% 的法术抗性；每有 1 名在场【炎】干员，全体【炎】干员的攻击力额外提高 6%。【炎】达到 9 层时，每隔 8 秒对全场敌人造成一次等于【炎】干员攻击力 15% 的灼燃损伤；本局所有敌人的灼燃逼爆冷却时长缩短 50%。',
    extra: { yanBurnall: { burnPct: 0.25, resIgnore: 0.5, atkPerOp: 0.06, nine: { layers: 9, every: 8, atkPct: 0.15 }, burnCdMul: 0.5 } },
  }),
  bondExclusiveHex('yanShip', {
    id: 'bx_yan_legacy', name: '薪火相传', grade: HEX_GRADE.GOLD,
    tags: ['机制调整', '召唤物', '属性继承'],
    desc: '「炎佑」继承的属性比例提高至 30% + 每名在场【炎】干员 5%；「祛恶之焰」的冷却时间缩短 30%。',
  }),
  // ===== 萨尔贡 =====
  bondExclusiveHex('sargonShip', {
    id: 'bx_sargon_drum', name: '萨满战鼓', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['玩法改写', '叠层', '计时器'],
    desc: '【萨尔贡】的攻速叠加改为全队共享一个 15 秒的计时器，任意【萨尔贡】干员开技能都会刷新该计时器；叠加上限提高至 100 层。',
    extra: { sargonDrum: { shareTime: 15, maxStacks: 100 } },
  }),
  bondExclusiveHex('sargonShip', {
    id: 'bx_sargon_horn', name: '狂猎号角', grade: HEX_GRADE.GOLD,
    tags: ['战斗强化', '叠层', '上限'],
    desc: '【萨尔贡】攻速/攻击的叠加上限提高至 40 层，每层持续时间缩短 25%。',
    extra: { sargonHorn: true },
  }),
  bondExclusiveHex('sargonShip', {
    id: 'bx_sargon_sandstorm', name: '沙暴', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['玩法改写', '环境', '控场'],
    // v0.05 增强：从「开场减攻速」改为「战斗中萨尔贡干员累计开技能到阈值才起风」，且是全场敌人全属性 -25%
    desc: '战斗内你的【萨尔贡】干员累计开启 10 次技能后扬起沙暴：场上所有敌人全属性（攻击 / 生命 / 防御 / 法抗）降低 25%，直到战斗结束。',
    extra: { sargonSandstorm: { casts: 10, down: 0.25 } },
  }),
  // ===== 维多利亚 =====
  bondExclusiveHex('victoriaShip', {
    id: 'bx_victoria_treasury', name: '王室宝库', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['玩法改写', '收菜', '宝箱', '经济'],
    desc: '维多利亚的层数里程碑改为每累计 25 层开启一个维多利亚宝箱，随机产出维式重锤、进阶装备、6–12 资金、一名【维多利亚】干员（不再固定 3 阶，阶数上限为当前调度中心等级），或让全体干员获得 2.25% 全属性提升与 1% 全能穿透（可叠加、永久）；维多利亚只是不再从层数里程碑获得装备（改为开宝箱），盟约本身提供的每件装备攻击力加成与伤害加成照常生效。装备格已满时装备类奖励自动折算为 6 资金。',
  }),
  bondExclusiveHex('victoriaShip', {
    id: 'bx_victoria_mint', name: '王室铸币', grade: HEX_GRADE.GOLD,
    tags: ['机制调整', '装备', '加速成型'],
    desc: '立即获得 1 件维式重锤与 10 资金；维式重锤的层数里程碑改为每 18 层一次，装备格已满时每次折算为 6 资金。',
    extra: { victoriaMint: true, grant: { kind: 'funds', gain: 10 } },
  }),
  bondExclusiveHex('victoriaShip', {
    id: 'bx_victoria_quartermaster', name: '军需官', grade: HEX_GRADE.SILVER,
    tags: ['数值调整', '数值'],
    desc: '维多利亚盟约 6 人效果：每件装备提供的攻击力由 50% 提高至 65%，进阶装备由 80% 提高至 100%。',
    extra: { victoriaQuartermaster: true },
  }),
  // ===== 谢拉格 =====
  bondExclusiveHex('kjeragShip', {
    id: 'bx_kjerag_winter', name: '凛冬将至', grade: HEX_GRADE.GOLD,
    tags: ['战斗强化', '控场', '环境'],
    desc: '寒风的间隔缩短至 16 秒，寒冷的持续时间提高 3 秒。',
  }),
  bondExclusiveHex('kjeragShip', {
    id: 'bx_kjerag_frostmark', name: '冰霜烙印', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['玩法改写', '叠层', '增伤'],
    desc: '【谢拉格】干员攻击寒冷或冻结的敌人时附加 1 层冰霜烙印，每层使该敌人受到的伤害提高 6%，至多 5 层，持续 6 秒；叠满 5 层时立即触发一次寒风。',
    extra: { kjeragFrostmark: true },
  }),
  bondExclusiveHex('kjeragShip', {
    id: 'bx_kjerag_snowveil', name: '雪幕', grade: HEX_GRADE.SILVER,
    tags: ['数值调整', '减伤', '光环'],
    desc: '【谢拉格】干员攻击寒冷或冻结的敌人时获得 10 点攻速加成（持续 3 秒），并使该敌人的攻击力降低 12%（持续 6 秒）。',
  }),
  // ===== 阿戈尔 =====
  bondExclusiveHex('egirShip', {
    id: 'bx_egir_hunt', name: '深海猎场', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['战斗强化', '成长', '击杀'],
    desc: '【阿戈尔】每吞噬或击倒 1 名敌人，本场攻击力提高 6%；吞噬获得的盟约层数翻倍。',
  }),
  bondExclusiveHex('egirShip', {
    id: 'bx_egir_undertide', name: '逆潮', grade: HEX_GRADE.SILVER,
    tags: ['数值调整', '数值', '复活'],
    desc: '【阿戈尔】的生命值加成提高至 42%；5 人档的复活次数提高至 4 次，仍为每人至多一次。',
    extra: { egirUndertide: true },
  }),
  // ===== 叙拉古 =====
  bondExclusiveHex('siracusaShip', {
    id: 'bx_siracusa_ledger', name: '家族账本', grade: HEX_GRADE.GOLD,
    tags: ['机制调整', '经济', '击杀统计'],
    desc: '本局累计击杀敌人每达到 12 名，立即获得 3 资金，计数跨回合永久保留并循环。',
    category: HEX_CATEGORY.ECONOMY,
    extra: { killMilestone: { every: 12, funds: 3 } },
  }),
  bondExclusiveHex('siracusaShip', {
    id: 'bx_siracusa_empire', name: '黑手帝国', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['玩法改写', '经济', '真伤', '成长'],
    desc: '每回合开始时获得等于上回合击杀数一半的资金，向下取整且至多 6；本局累计击杀每满 15 名，【叙拉古】干员的附加真实伤害提高 500（无上限）。',
  }),
  // ===== 卡西米尔 =====
  bondExclusiveHex('kazimierzShip', {
    id: 'bx_kazimierz_glory', name: '耀骑士的光辉', grade: HEX_GRADE.GOLD,
    tags: ['战斗强化', '成长', '部署'],
    desc: '战斗开始时，你的【卡西米尔】干员立刻获得 3 次部署的攻击力叠加；叠加上限提高至 80% + 每层 1%。',
    extra: { kazimierzGlory: { deploys: 3, capAdd: 0.3 } },
  }),
  bondExclusiveHex('kazimierzShip', {
    id: 'bx_kazimierz_law', name: '骑士铁律', grade: HEX_GRADE.PRISMATIC, tier3: true,
    tags: ['玩法改写', '机制解锁', '真伤'],
    desc: '【卡西米尔】干员的两种 6 人档效果同时生效：无论是否阻挡敌人，都每 2 秒对周围 0.8 格造成 120% 攻击力的真实伤害并晕眩 0.3 秒，且普通攻击附带 30% 攻击力的真实伤害。',
    extra: { kazimierzLaw: true },
  }),
  bondExclusiveHex('kazimierzShip', {
    id: 'bx_kazimierz_knights', name: '骑士团', grade: HEX_GRADE.SILVER,
    tags: ['数值调整', '数值'],
    desc: '每次部署提供的攻击力提高至 26%，叠加上限提高至 60% + 每层 1%。',
    extra: { kazimierzKnights: { perAdd: 0.06, capAdd: 0.1 } },
  }),
  // ===== 双盟约 =====
  dualBondHex('yanShip', 'kjeragShip', {
    id: 'bx_frostfire', name: '焚荒之冰', grade: HEX_GRADE.PRISMATIC,
    tags: ['玩法改写', '真伤', '叠层', '双盟约'],
    desc: '你的【炎】干员对同时处于灼燃损伤与寒冷 / 冻结的敌人造成伤害时，额外造成相当于该次伤害 1% / 3% 的真实伤害；你的【谢拉格】干员攻击处于灼燃损伤下的敌人时，有 50% 概率使【谢拉格】获得 1 层。'
      + '【谢拉格】或【炎】获得层数时，使对方获得其中 25% 的层数（这条海克斯自身转移出去的层数不再触发；不会循环）。'
      + '获得 1 名 1 阶【炎】干员与 1 名 1 阶【谢拉格】干员。',
    extra: {
      frostfire: {
        // v0.04.3 平衡调整：真伤基数 = 这次**实际打出**的伤害（已过护甲/魔抗/减伤），不再用目标最大生命值
        trueDmgOf: 'dealt',
        coldPct: 0.01, frozenPct: 0.03,
        kjeragProc: 0.5,           // 谢拉格 打灼燃 → +1 层概率（不设每场上限）
      },
      // 结算校验放宽 (v0.04.3)：本海克斯允许的战斗内加层远超「60 + 4·回合」的通用上界，
      // fields.js 的 layerAllowanceOf 读这张表给对应盟约加额度（只放宽校验，不改变实际数值）。
      layerAllowance: { kjeragShip: 400 },
    },
  }),
];

export const HEXES = Object.freeze([
  ...REGION_REINFORCE.map(([bond, id, name]) => regionHex(bond, id, name)),
  ...REGION_DESTINY.map(([bond, id, name]) => destinyHex(bond, id, name)),
  ...REGION_CREDENTIAL.map(([bond, id, name, pair]) => credentialHex(bond, id, name, pair)),

  // ===== 战争天梯（拉特兰专属 · 炫彩，v0.05）：按【拉特兰】干员累计消耗的弹药逐档发奖 =====
  bondExclusiveHex('lateranoShip', {
    id: 'bx_war_ladder',
    name: '战争天梯',
    grade: HEX_GRADE.PRISMATIC,
    category: HEX_CATEGORY.ECONOMY,
    tags: ['弹药', '阶梯', '成长'],
    desc: '获得一张精英化【隐现】，开启战争阶梯：本局对战剩余时间，按你的【拉特兰】干员累计消耗的弹药获得阶梯奖励。'
      + '（阶梯里的「全能穿透」是词条：同时无视目标等比例护甲与法术抗性。）',
    extra: {
      warLadder: {
        startChess: 'chess_char_1_01_b',        // 精英化·隐现
        thresholds: [55, 111, 222, 333, 444, 555, 666, 777, 888, 999],
        // 与 thresholds 一一对应：干员 / 装备 / 资金 / 盟约层数 / 全能穿透(%) / 真伤比例(%)
        grants: [
          { label: '送葬人 + 空弦 + 拉特兰桥夹', chess: ['chess_char_2_01_a', 'chess_char_3_21_a'], items: ['chess_item_4_08_e_a'] },
          { label: '信仰搅拌机 + 拉特兰全能穿透 3%', chess: ['chess_char_4_01_a'], pierce: 3 },
          { label: '莫斯提马 + 拉特兰层数 +55', chess: ['chess_char_4_02_a'], layers: 55 },
          { label: '圣约送葬人 + 拉特兰全能穿透 5%', chess: ['chess_char_5_01_a'], pierce: 5 },
          { label: '15 资金 + 铳骑之威', funds: 15, items: ['chess_item_6_02_e_a'] },
          { label: '新约能天使 + 拉特兰全能穿透 7%', chess: ['chess_char_6_13_a'], pierce: 7 },
          { label: '博士投影 + 拟态物质', items: ['chess_item_5_06_e_a', 'chess_item_5_05_e_a'] },
          { label: '塑心 + 蕾缪安 + 拉特兰全能穿透 10%', chess: ['chess_char_6_09_a', 'chess_char_6_01_a'], pierce: 10 },
          { label: '3× 铳骑之威 + 变形同构体 + 20 资金', funds: 20, items: ['chess_item_6_02_e_a', 'chess_item_6_02_e_a', 'chess_item_6_02_e_a', 'chess_item_6_09_e_a'] },
          { label: '拉特兰干员造成的伤害 1% 转真实伤害', truePct: 1 },
        ],
        repeatEvery: 666,      // 999 之后每 666 发
        repeatTruePct: 0.2,    // 每次 +0.2% 真伤
      },
    },
  }),

  // ===== 战斗类 =====
  Object.freeze({
    id: 'great_silence',
    name: '大静谧',
    desc: '本局所有敌人的最大生命值降低 5%。',
    grade: HEX_GRADE.SILVER,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗']),
    icon: 'skull',
    iconId: 'icon_enemy_debuff',
    // 被动数值：MatchHexDraft.hexSpawnModsOf 读出后，MatchCombat._normalOpts 会乘进该玩家战场里每个敌人的 mods
    // （乘法倍率，与 waves.js 的 roundMods 同义）。可用键：hpMul / atkMul / defMul / resMul / speedMul
    spawnMods: { hpMul: 0.95 },
  }),
  pactHex('coop_pact', '协防协议', HEX_GRADE.SILVER, 0.03),
  pactHex('coop_pact_plus', '协防协议+', HEX_GRADE.GOLD, 0.05),
  pactHex('coop_pact_plusplus', '协防协议++', HEX_GRADE.PRISMATIC, 0.10),
  academyHex('academy', '宝宝学院', HEX_GRADE.GOLD, 0.05, false),
  academyHex('academy_plusplus', '宝宝学院++', HEX_GRADE.PRISMATIC, 0.10, true),
  famedBladeHex('famed_blade_plus', '名刀·司命', HEX_GRADE.PRISMATIC, 5, 0.2, 5),
  backupHex('backup', '我来兜底', HEX_GRADE.SILVER, 0.1),
  backupHex('backup_plus', '我来兜底+', HEX_GRADE.GOLD, 0.2),
  // 平衡调整 (v0.05)：35% 全属性里取出 25%（=8.75%）按 R=50 折成全属性穿透 → 取整 9%
  backupHex('backup_plusplus', '我来兜底++', HEX_GRADE.PRISMATIC, 0.2625, true, 9),
  Object.freeze({
    id: 'shard_memory',
    name: '碎片大厦的回忆',
    desc: '怪物进入核心时对全场怪物造成一次真实伤害冲击 —— 伤害等于你当前激活的最高盟约层数 × 1000（无视护甲与法抗），并沉默怪物 0.5 秒（联合防守时不触发）。',
    grade: HEX_GRADE.PRISMATIC,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '全场']),
    icon: 'back',
    iconId: 'icon_enemy_debuff',
    // v0.05：冲击伤害的类型明确为真实伤害（type: 'true'，无视护甲/法抗）
    leakNuke: { damagePerMaxLayer: 1000, damage: 1000, silence: 0.5, type: 'true' },
  }),

  // ===== 经济类：成长与合成 =====
  Object.freeze({
    id: 'victoria_aid',
    name: '维多利亚的助力',
    desc: '每 3 回合获得一件随机装备（不超过商店等级）。',
    grade: HEX_GRADE.GOLD,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济', '装备']),
    icon: 'target',
    iconId: 'icon_player_buff',
    roundStartItem: { every: 3, tierCap: 'shop' },
  }),
  Object.freeze({
    id: 'recuperate',
    name: '休养生息',
    desc: '休整阶段结束时，若你没有购买过干员，下回合获得 1 资金；若你没有刷新过商店，下回合获得 1 经验。',
    grade: HEX_GRADE.SILVER,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济']),
    icon: 'sell',
    iconId: 'icon_player_buff',
    frugalEnd: { noBuyFunds: 1, noRefreshXp: 1 },
  }),
  Object.freeze({
    id: 'twin_blade',
    name: '双剑',
    desc: '你首次进阶装备时，获得一件相同的一阶复制。',
    grade: HEX_GRADE.SILVER,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济', '装备']),
    icon: 'dp',
    iconId: 'icon_player_buff',
    twinItem: true,
  }),
  Object.freeze({
    id: 'twin_life',
    name: '双生',
    desc: '你首次进阶干员时，获得一位相同的一阶复制。',
    grade: HEX_GRADE.SILVER,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济']),
    icon: 'emote',
    iconId: 'icon_player_buff',
    twinChess: true,
  }),
  Object.freeze({
    id: 'core_bond',
    name: '核心盟约',
    desc: '你激活层数最多的盟约获得层数时，有 50% 的概率再获得一层。',
    grade: HEX_GRADE.PRISMATIC,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济', '盟约']),
    icon: 'flag',
    iconId: 'icon_player_buff',
    coreBondChance: 0.5,
  }),
  Object.freeze({
    id: 'thrifty',
    name: '勤俭持家',
    desc: '每回合首次购买干员时，获得 1 经验（调度中心升级价格 −1）。',
    grade: HEX_GRADE.SILVER,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济']),
    icon: 'sell',
    iconId: 'icon_player_buff',
    firstBuyXp: 1,
  }),

  // ===== 经济类：命运（资金 + 随机同等级海克斯）=====
  fundsHexLike('fate_silver', '白银命运', HEX_GRADE.SILVER, 1),
  fundsHexLike('fate_gold', '黄金命运', HEX_GRADE.GOLD, 3),
  fundsHexLike('fate_prismatic', '炫彩命运', HEX_GRADE.PRISMATIC, 5),

  // ===== 经济类：天降盟约（牌库定向投放礼物盟约干员）=====
  Object.freeze({
    id: 'skyfall_bond',
    name: '天降盟约',
    desc: '本局对战中，你的牌库里会出现一个未解锁的主要盟约的干员；本局游戏剩余时间内，你每次刷新牌库都会出现一个对应盟约的干员。',
    grade: HEX_GRADE.PRISMATIC,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济', '盟约']),
    icon: 'flag',
    iconId: 'icon_player_buff',
    // 选中的那一刻随机定一个「未激活的主要盟约」并存 ps.giftBond；此后每次 rollShop（手动刷新 / 回合开始）
    // 都由 MatchHexDraft.hexSeedGiftBond 把一个该盟约干员投进商店（MatchHexDraft._hexApply 分支）
    shopBondGift: true,
  }),

  // ===== 经济类：DD街区（每回合送刷新）=====
  Object.freeze({
    id: 'dd_block',
    name: 'DD街区',
    desc: '每回合开始时获得 1 次免费刷新次数。',
    grade: HEX_GRADE.GOLD,
    category: HEX_CATEGORY.ECONOMY,
    tags: Object.freeze(['经济']),
    icon: 'dp',
    iconId: 'icon_stage_buff',
    // MatchHexDraft.hexRoundStartFreeRefreshes：PlayerRound.startRound 每回合发放
    roundStartFreeRefresh: 1,
  }),

  // ===== 经济类：门票（每次刷新送刷新）=====
  ticketHex('ticket_silver', '白银门票', HEX_GRADE.SILVER, { every: 4 },
    '每当累计刷新 4 次，获得 1 次免费刷新次数。'),
  ticketHex('ticket_gold', '黄金门票', HEX_GRADE.GOLD, { chance: 0.25 },
    '每次刷新有 25% 概率获得 1 次免费刷新次数。'),
  ticketHex('ticket_prismatic', '炫彩门票', HEX_GRADE.PRISMATIC, { chance: 0.5 },
    '每次刷新有 50% 概率获得 1 次免费刷新次数。'),

  // ===== 经济类：奸商本色（保留资金 + 利息）=====
  Object.freeze({
    id: 'devil_merchant',
    name: '奸商本色',
    desc: '本局在回合结束时不会失去资金；每拥有 5 资金，下回合开始时额外获得 1 资金（上限 10）。角色为坎诺特时上限解除。',
    grade: HEX_GRADE.PRISMATIC,
    category: HEX_CATEGORY.ECONOMY,
    // 「首轮限定」：只在**第一次**海克斯草案出现（第 7 回合的第二次候选里一定没有它）。
    // 强制点在 hexDraft.js 的 hexEligible（读 hex.firstDraftOnly），tag 只是把这条规则画在卡面上。
    tags: Object.freeze(['经济', '首轮限定']),
    firstDraftOnly: true,
    icon: 'gear',
    iconId: 'icon_player_buff',
    // PlayerRound.endPrep：即使 bandId 不在 gd.leftoverKeptBands 里也保留资金
    keepFunds: true,
    // PlayerRound.startRound：下回合利息。坎诺特（band_cannot）时解除 max 上限，
    // 且坎诺特策略自带的 coin_carry_over 会被让位（content/bands/meta.js 里判断本字段）—— 不重复计算
    incomeInterest: Object.freeze({ per: 5, gain: 1, max: 10, uncappedBand: 'band_cannot' }),
    // 彩蛋：仅当玩家的策略(角色)是坎诺特时，卡面多一行斜体小字
    easterEgg: Object.freeze({ band: 'band_cannot', text: '（不贪怎么玩？）' }),
  }),

  // ===== 盟约专属（第六轮征集, this fork）：每局限选一个 · 炫彩送 3 阶盟约干员 · 草案按激活盟约/层数加权 =====
  ...BOND_EXCLUSIVE,

  // ===== 混沌投掷（this fork, 赌局系列）=====
  // `chaosRoll: { times, every }` —— MatchChaos.chaosRoll() 掷 3d6 定奖励；times = 选中时立即投几次，
  // every > 0 时此后每 `every` 个回合的部署阶段开始时再投一次（赌神）。具体点数 → 奖励的映射是隐藏规则，
  // 卡面只写「掷出三颗骰子，按点数获得奖励」，彩蛋（666/111/325）绝不写在卡面上。
  // 限流：随机三选一里整局只会出现一条混沌类（chaosRandomTaken；自选 hexQueue 不受限），同一批最多一条。
  Object.freeze({
    id: 'chaos_god',
    name: '赌神！',
    desc: '立即进行一次混沌投掷，此后每两个回合的部署阶段开始时再投一次。掷出三颗骰子，按点数获得奖励。',
    grade: HEX_GRADE.PRISMATIC,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '赌局', '周期']),
    icon: 'target',
    iconId: 'icon_player_buff',
    chaosRoll: Object.freeze({ times: 1, every: 2 }),
  }),
  Object.freeze({
    id: 'chaos_king',
    name: '赌王！',
    desc: '立即进行两次混沌投掷。掷出三颗骰子，按点数获得奖励。',
    grade: HEX_GRADE.GOLD,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '赌局']),
    icon: 'target',
    iconId: 'icon_player_buff',
    chaosRoll: Object.freeze({ times: 2, every: 0 }),
  }),
  // ===== 飞升系列（this fork）：战斗开始 `delay` 秒后，己方全体干员全属性 ×(1+allStats)，直到战斗结束 =====
  // 战斗侧 server/sim/content/hexes.js（install 注册 battle.after(delay)）；之后部署的干员同样吃到
  // （spawn 时读 battle 玩家对象的 ascensionMul）。召唤物 / 装置不吃 —— 与宝宝学院同口径。
  Object.freeze({
    id: 'ascension',
    name: '飞升',
    desc: '战斗开始 12 秒后，你的所有干员全属性增加 18.75%、并获得 6.5% 全能穿透，直到战斗结束。',
    grade: HEX_GRADE.SILVER,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '增益', '延迟']),
    icon: 'bolt',
    iconId: 'icon_player_buff',
    delayedOps: Object.freeze({ delay: 12, allStats: 0.1875 }),
    // 平衡调整 (v0.05)：原 25% 全属性里取出 25%（=6.25%）按 R=50 折成全能穿透 → 取整 6.5%
    pierce: 6.5,
  }),
  Object.freeze({
    id: 'ascension_plus',
    name: '飞升+',
    desc: '战斗开始 12 秒后，你的所有干员全属性增加 37.5%、并获得 12.5% 全能穿透，直到战斗结束。',
    grade: HEX_GRADE.GOLD,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '增益', '延迟']),
    icon: 'bolt',
    iconId: 'icon_player_buff',
    delayedOps: Object.freeze({ delay: 12, allStats: 0.375 }),
    pierce: 12.5,
  }),
  Object.freeze({
    id: 'ascension_plusplus',
    name: '飞升++',
    desc: '战斗开始 12 秒后，你的所有干员全属性增加 75%、并获得 25% 全能穿透，直到战斗结束。',
    grade: HEX_GRADE.PRISMATIC,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '增益', '延迟']),
    icon: 'bolt',
    iconId: 'icon_player_buff',
    delayedOps: Object.freeze({ delay: 12, allStats: 0.75 }),
    pierce: 25,
  }),

  Object.freeze({
    id: 'chaos_rookie',
    name: '赌徒！',
    desc: '立即进行一次混沌投掷。掷出三颗骰子，按点数获得奖励。',
    grade: HEX_GRADE.SILVER,
    category: HEX_CATEGORY.COMBAT,
    tags: Object.freeze(['战斗', '赌局']),
    icon: 'target',
    iconId: 'icon_player_buff',
    chaosRoll: Object.freeze({ times: 1, every: 0 }),
  }),
]);

export const HEX_BY_ID = Object.freeze(Object.fromEntries(HEXES.map((h) => [h.id, h])));

/** @returns {any|null} the record of `id`, or null */
export function hexById(id) {
  return typeof id === 'string' && Object.hasOwn(HEX_BY_ID, id) ? HEX_BY_ID[id] : null;
}

/**
 * 利息（奸商本色 `incomeInterest`）的纯计算 —— 服务端 MatchHexDraft.hexIncomeOf 调用，也便于直接单测。
 * 公式：`⌊资金 / per⌋ × gain`，默认被 `max` 截断；当玩家策略正是 `uncappedBand`（坎诺特）时**解除上限**。
 * @param {{per?: number, gain?: number, max?: number, uncappedBand?: string}|null|undefined} spec
 * @param {number} funds 结算时的持有资金
 * @param {string|null} bandId 玩家策略
 * @returns {number} 应加的资金（≥ 0 的整数）
 */
export function hexInterestBonus(spec, funds, bandId = null) {
  if (!spec || typeof spec !== 'object') return 0;
  const per = Math.max(1, Math.trunc(Number(spec.per) || 5));
  const gain = Math.max(0, Math.trunc(Number(spec.gain) || 0));
  if (!gain) return 0;
  const left = Math.max(0, Number.isFinite(funds) ? Math.trunc(funds) : 0);
  const raw = Math.floor(left / per) * gain;
  if (raw <= 0) return 0;
  const uncapped = !!(spec.uncappedBand && bandId === spec.uncappedBand);
  const max = Number.isFinite(spec.max) ? Math.max(0, Math.trunc(spec.max)) : Infinity;
  return uncapped ? raw : Math.min(max, raw);
}
