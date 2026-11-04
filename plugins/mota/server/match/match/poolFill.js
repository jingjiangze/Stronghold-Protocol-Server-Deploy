// plugins/mota/server/match/match/poolFill.js — 「借钱优先取团队储备」的纯分配逻辑（业主 2026-10-30）。
//
// 规则：一次借款先由**团队储备**垫（团队自己的钱，不产生债务），池子不够的部分才去问队友。
// 池子能垫多少同时受三件事钳制：
//   ① 请求金额（不多垫）；
//   ② 团队储备余额（垫不出没有的钱）；
//   ③ 本回合团队资金流动的剩余额度（`teamTransferCap() - econRound.spent`）—— 否则一个人可以
//      靠反复请求把池子抽干，而这条额度原本就是给「团队资金流动」设的上限。
// 纯函数：不读 Match、不写状态，便于单测（test/match/econ-pool-first.test.js）。

/**
 * @param {{ amount: number, teamReserve: number, capLeft: number }} v
 * @returns {{ fromPool: number, remaining: number }} fromPool 由池子垫付的部分；remaining 还要向队友借的部分
 */
export function splitPoolFill({ amount, teamReserve, capLeft } = {}) {
  const want = Math.max(0, Math.floor(Number(amount) || 0));
  const pool = Math.max(0, Math.floor(Number(teamReserve) || 0));
  const cap = Math.max(0, Math.floor(Number(capLeft) || 0));
  const fromPool = Math.min(want, pool, cap);
  return { fromPool, remaining: want - fromPool };
}
