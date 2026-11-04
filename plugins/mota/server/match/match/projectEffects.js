// plugins/mota/server/match/match/projectEffects.js — 商店设施（原「升级项」）的三项效果，纯函数（业主 2026-10-30）。
//
// 业主口径：「升级是提示商店等级和提示协同资金获取，装备造价这个也可以有，但需要做好平衡」。
// 三项都用**团队储备**购买（`econBuyProject` 扣 teamReserve），效果分别落在：
//   shopLevel  每级 商店等级上限 +1（能买到更高档的装备）
//   teamIncome 每级 团队储备每回合收入上限 +1
//   equipCost  每级 装备价格 −1（下限 2，别把装备变成白送）
// 纯函数：不读 Match、不写状态，便于单测（test/match/econ-projects.test.js）。

/** 三项各自最多几级（与 DEFAULTS.teamEconomy.projects 的 costs 长度一致）。 */
export const PROJECT_MAX_LEVEL = Object.freeze({ shopLevel: 4, teamIncome: 3, equipCost: 2 });

const lv = (level) => Math.max(0, Math.floor(Number(level) || 0));
const base = (v) => Math.floor(Number(v) || 0);

/**
 * 商店等级上限：每级 +1。**不设硬顶**（每级都要花团队储备，自然被经济约束），但夹在 1..20，
 * 免得配置写错把上限顶到荒唐的数。
 * @param {number} baseLevel 未升级时的等级（现在 = ceil(round/2)，最大 6）
 * @param {number} level 已买的级数
 */
export function shopLevelOf(baseLevel, level) {
  return Math.max(1, Math.min(20, base(baseLevel) + lv(level)));
}

/**
 * 装备价格：每级 −1，**下限 2**（业主「做好平衡」：装备永远不免费）。
 * @param {number} price 原价
 * @param {number} level 已买的级数
 */
export function equipPriceOf(price, level) {
  return Math.max(2, base(price) - lv(level));
}

/**
 * 团队储备每回合的收入上限：每级 +1（与 `perfectRewardCapPerRound` 相加后作为该回合的封顶）。
 * @param {number} baseCap 未升级时的每回合上限
 * @param {number} level 已买的级数
 */
export function teamIncomeCapOf(baseCap, level) {
  return Math.max(0, base(baseCap) + lv(level));
}
