// plugins/mota/server/match/match/confrontFill.js — 对抗投放的「1.5× 只数 + 价值」双目标填充（2026-11-01 P1）。
//
// 业主 2026-10-31 口径：「控怪出怪量 = 官方 1.5 倍」同时指**只数**与**价值**。旧的 cheapest-first 填充
// 会用最便宜的怪把只数塞爆（cap=80 先命中，预算还剩一大半），价值与只数两个目标都跑偏。
// 这里按「剩余预算 / 剩余只数」的目标单价逐只挑怪：每步选最接近目标单价、且负担得起的行，
// 只数与价值同时逼近目标。纯函数，不读 Match，便于单测（test/match/confront-fill.test.js）。

/**
 * @param {{
 *   rows?: Array<{key: string, value: number}>,   // 本回合可选的怪（可含重复 key；跨组展平后传入）
 *   budget?: number,                              // 价值预算
 *   unitsTarget?: number,                         // 只数目标（调用方按 官方只数×1.5÷攻方人数 算好）
 *   cap?: number,                                 // 协议硬上限 maxPicks（与只数目标取小）
 * }} v
 * @returns {Array<{enemyKey: string, value: number}>} 选中的怪（按选择顺序；gate 由调用方按序交替）
 */
export function fillConfrontPicks({ rows, budget, unitsTarget, cap } = {}) {
  const list = (Array.isArray(rows) ? rows : []).filter((r) => r && typeof r.key === 'string' && Number.isFinite(r.value) && r.value > 0);
  const capN = Math.max(1, Math.floor(Number(cap) || 1));
  const want = Math.min(capN, Math.max(1, Math.floor(Number(unitsTarget) || 1)));
  let left = Math.max(0, Math.floor(Number(budget) || 0));
  const picks = [];
  if (!list.length) return picks;
  // 稳定排序（价格升序 + key），不依赖输入顺序；并列时优先更便宜
  const sorted = [...list].sort((a, b) => a.value - b.value || String(a.key).localeCompare(String(b.key)));
  while (picks.length < want) {
    const remain = want - picks.length;
    const aim = left / remain; // 剩余预算 / 剩余只数 —— 双目标的分摊单价
    let best = null;
    let bestScore = Infinity;
    for (const r of sorted) {
      if (r.value > left) continue;
      const score = Math.abs(r.value - aim);
      if (score < bestScore - 1e-9 || (Math.abs(score - bestScore) <= 1e-9 && best && r.value < best.value)) {
        best = r;
        bestScore = score;
      }
    }
    if (!best) break; // 预算连最便宜的都不够了
    left -= best.value;
    picks.push({ enemyKey: best.key, value: best.value });
  }
  return picks;
}
