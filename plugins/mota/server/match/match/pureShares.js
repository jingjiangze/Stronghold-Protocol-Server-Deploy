// plugins/mota/server/match/match/pureShares.js —— 三层资金拆分 与 bot 投放清洗的**纯函数**实现。
//
// 为什么要单独成文件：这两段逻辑原先内联在 economy.js / confront.js 里，测试只能把公式**复刻**到
// 测试文件里（复刻版还会与实现漂移）。抽成无依赖的纯函数后，实现与测试 import 同一份代码。
//
// 业主 2026-10-26 定义：协同资金分三层 —— 每回合资金 / 个人储备（买装备）/ 团队储备（升级设施、救人）；
// 个人储备必须 >= 团队储备。bot 投放走与人类同样的路线/时刻/预算校验。

/**
 * 回合末把「每回合资金」拆进个人储备与团队储备。
 *
 * 关键性质（都由调用方与测试共同保证）：
 *   · **守恒**：personal + team === left（余数归个人，绝不吞钱）
 *   · **顺序无关**：同一输入永远得到同一结果（不受玩家处理顺序影响）
 *   · **大小约束**：加完之后 `reserveNow + personal >= teamReserve + team`，即个人储备不少于团队储备
 *
 * @param {object} o
 * @param {number} o.left 本回合未花完的资金
 * @param {number} o.reserveNow 该玩家现有个人储备
 * @param {number} o.teamReserve 当前团队储备
 * @param {number} [o.personalRate] 个人侧设施加成倍率（应急仓储，1 + lv*0.1）
 * @param {number} [o.teamRate] 团队侧设施加成倍率（后勤调度，1 + lv*0.1）
 * @returns {{ personal: number, team: number }}
 */
export function splitLeftoverShares({ left, reserveNow = 0, teamReserve = 0, personalRate = 1, teamRate = 1 } = {}) {
  const total = Math.max(0, Math.floor(Number(left) || 0));
  if (total <= 0) return { personal: 0, team: 0 };
  const rn = Math.max(0, Math.floor(Number(reserveNow) || 0));
  const tr = Math.max(0, Math.floor(Number(teamReserve) || 0));
  // 恒定三层拆分（业主 2026-10-27：团队/个人不是两种模式，是同一笔结余在局内的两个去处）
  const wp = 0.7 * (Number(personalRate) || 1);
  const wt = 0.3 * (Number(teamRate) || 1);
  let team = Math.floor((total * wt) / (wp + wt));
  let personal = total - team; // 余数归个人 ⇒ 守恒
  // 大小约束：团队池增长后不得超过该玩家的个人储备
  const gap = Math.max(0, rn + personal - tr);
  if (team > gap) {
    personal += team - gap;
    team = gap;
  }
  return { personal, team };
}

/**
 * bot 投放的清洗（与人类提交同判据，但**修复式**：非法字段就地剥掉，不整单拒绝）。
 *
 * 规则：
 *   · `routeIndex` 必须 `metricsOf(routeIndex, enemyKey)` 返回非 null 且 `len <= 40`，否则去掉（回落默认路线）
 *   · `time` 夹进 `[0, timeLimit - travel - 2]`；窗口为负时不给 time（等同人类省略 time）
 *   · 路线长度计入预算（长度 ×2）；超预算时**按长度从大到小**让出路线，仍超才截断列表
 *   · 预算 <= 0 ⇒ 返回空（与人类路径一致：人类在预算 0 时任何 picks 都会被 CONFRONT_BUDGET 拒）
 *
 * @param {Array<{enemyKey:string, gate?:string, routeIndex?:number, time?:number}>} picks
 * @param {object} o
 * @param {number} o.timeLimit
 * @param {number} o.cap 只数上限
 * @param {(routeIndex:number, enemyKey:string) => ({ len:number, travel:number }|null)} o.metricsOf
 * @param {(picks:Array<object>) => number} o.spentOf 价值合计（按 enemyKey 计价，不含路线成本）
 * @param {number} o.budget
 * @returns {Array<object>}
 */
export function sanitizeBotPickList(picks, { timeLimit = 60, cap = 64, metricsOf = () => null, spentOf = () => 0, budget = 0 } = {}) {
  const arr = Array.isArray(picks) ? picks : [];
  const tl = Math.max(1, Number(timeLimit) || 60);
  const max = Math.max(1, Number(cap) || 1);
  const out = [];
  for (const p of arr) {
    if (out.length >= max) break;
    if (!p || typeof p.enemyKey !== 'string') continue;
    const row = { enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' };
    const routeIndex = Number.isInteger(p.routeIndex) ? p.routeIndex : null;
    if (routeIndex != null) {
      const m = metricsOf(routeIndex, p.enemyKey);
      if (m && Number(m.len) <= 40) {
        row.routeIndex = routeIndex;
        row.routeLen = Number(m.len) || 0;
        const travel = Number(m.travel) || 0;
        const room = tl - travel - 2;
        if (Number.isFinite(p.time) && room >= 0) row.time = Math.min(room, Math.max(0, Number(p.time)));
      }
    }
    out.push(row);
  }
  const lim = Number(budget) || 0;
  if (!(lim > 0)) return [];
  const routeCost = () => out.reduce((n, x) => n + (Number(x.routeLen) || 0) * 2, 0);
  const total = () => Number(spentOf(out)) + routeCost();
  while (total() > lim && out.some((x) => (Number(x.routeLen) || 0) > 0)) {
    let worst = -1;
    let worstLen = 0;
    out.forEach((x, i) => { const L = Number(x.routeLen) || 0; if (L > worstLen) { worstLen = L; worst = i; } });
    if (worst < 0) break;
    delete out[worst].routeIndex; delete out[worst].routeLen; delete out[worst].time;
  }
  while (out.length && total() > lim) out.pop();
  return out;
}
