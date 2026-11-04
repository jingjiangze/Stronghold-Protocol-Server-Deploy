// shared/crisisScore.js — 危机合约的计分规则 (owner 2026-10-10).
//
// Pure arithmetic over one finished match, shared by the client (ui/profile.js records it) and — because the numbers
// are shown to OTHER players — by anything that has to agree on them. No imports beyond the contract tables, so it can
// be tested directly.
//
// ── 规则 (owner) ────────────────────────────────────────────────────────────────────────────────────────
//   1. **只有成功完成（存活）的才会计入最高分和累计分数。** 打输的局不计分 —— 不算最高分、不加累计分,
//      但**照记进战绩**(场次 / 胜率 / 历史列表都要它)。
//   2. **8 回合前死亡不扣分** —— 也不得分(0)。
//   3. **8 回合后死亡只加基础分** —— 合约那一份**不算**(你没扛住,不能拿合约的钱)。
//   4. **成功活着胜利额外加存活胜利分。**
//
// ── 为什么"基础分"不能直接用 contractPoints ──────────────────────────────────────────────────────────────
// `contractPoints(ids, difficulty)` = `contractBasePoints(难度) + Σ 合约点数` —— **即使一条合约都没选,
// 它也会把难度基础分算进去**(ABYSS = 2)。所以:
//   · 要"难度基础分"就用 `contractBasePoints(难度)`,不要拿 `contractPoints` 去凑;
//   · 要"合约那一份"就是 `contractPoints(ids, diff) - base`(下面 `ctr` 那行),**并且**得先判 `ids.length`
//     —— 空选时那个差值虽然是 0,但依赖"差值为 0"不如显式判空来得清楚。
// ⚠ 这里曾经写着「没有合约时直接返回 0」,那是 0.1.x 的做法(shared/contracts.js 老版本里有一句
//   `if (!list.length) return 0`)。现在那句子没了,写法与注释都要跟着改,否则下一个读的人会以为
//   无合约的局连基础分都拿不到 —— 而实际上它拿得到(这正是 `crisisScore` 想要的)。
// 又:`CONTRACT_BASE_POINTS` 现在只有 ABYSS(终极)是 2,其余全是 0 —— 所以常规难度下"只加基础分"就是 0 分。
// 这是数据决定的,不是 bug;难度一变,这里跟着变。

import { contractBasePoints, contractPoints } from './contracts.js';

/** 活到这个回合数(含)之后倒下,才拿得到基础分 (owner:「8回合前死亡不扣分 8回合后死亡只加基础分」). */
export const SURVIVE_ROUND = 8;

/** 成功存活通关额外加的「存活胜利分」(owner:「成功活着胜利额外加存活胜利分」). */
export const SURVIVAL_BONUS = 20;

/**
 * 一局危机合约的结算档位。**这是给玩家看的分类**,不只是内部标记 —— 三档的含义完全不同:
 *   `clear`   成功完成(存活胜利):基础分 + 合约分 + 存活胜利分
 *   `hold`    撑过第 8 回合但没能通关:只加基础分
 *   `fallen`  第 8 回合前就倒了:0 分(不扣分)
 */
export const CRISIS_TIERS = Object.freeze(['fallen', 'hold', 'clear']);

/**
 * 这一局拿多少危机合约分。
 *
 * @param {{ won?: boolean, rounds?: number|null, teamRounds?: number|null, contracts?: string[],
 *           difficulty?: string|null, contractPoints?: number, contractPlayers?: number }} row 一行战绩(ui/profile.js 的历史行形状)
 * @returns {{ points: number, tier: 'fallen'|'hold'|'clear', base: number, contracts: number, bonus: number }}
 *   `points` 就是要加进累计分、并拿去做最高分比较的值
 */
export function crisisScore(row) {
  const r = row && typeof row === 'object' ? row : {};
  const ids = Array.isArray(r.contracts) ? r.contracts : [];
  const difficulty = typeof r.difficulty === 'string' ? r.difficulty : null;
  /*
   * `rounds` 是**本人**到的回合,`teamRounds` 是队伍到的。用本人那一档:危机合约是个人成绩,
   * 队友推得远不该把倒得早的人的分抬起来。两个都没有时退到 0(= 没撑过)。
   */
  const reached = Number.isFinite(r.rounds) ? r.rounds : (Number.isFinite(r.teamRounds) ? r.teamRounds : 0);

  const base = contractBasePoints(difficulty);
  const total=Number.isFinite(r.contractPoints)?r.contractPoints:contractPoints(ids,difficulty,Number.isFinite(r.contractPlayers)?r.contractPlayers:20);
  const ctr = ids.length ? Math.max(0,total-base) : 0;

  if (r.won) return { points: base + ctr + SURVIVAL_BONUS, tier: 'clear', base, contracts: ctr, bonus: SURVIVAL_BONUS };
  if (reached >= SURVIVE_ROUND) return { points: base, tier: 'hold', base, contracts: 0, bonus: 0 };
  return { points: 0, tier: 'fallen', base: 0, contracts: 0, bonus: 0 };
}

/**
 * 这一局是否计入「最高分 / 累计分」。**只有 `clear` 算**(owner 第 1 条)。
 *
 * 分开成一个函数是因为调用点要问两件不同的事:「这局算多少分」和「这局要不要记进分数」——
 * 打输的局**仍然进历史**(`recordMatch` 照记),只是不动 `crisis` 那两个数。
 * @param {{ points: number, tier: string }} score `crisisScore` 的结果
 */
export const crisisCounts = (score) => !!score && score.tier === 'clear';

/** 三档的中文名(界面用;`ui/profile.js` 和结算画面共用同一套说法)。 */
export const CRISIS_TIER_LABEL = Object.freeze({
  clear: '完成',
  hold: '坚持',
  fallen: '失守',
});
