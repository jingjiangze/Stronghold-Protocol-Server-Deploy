// plugins/mota/server/match/monsterStrategies.js — 怪物方 AI 的两套内置实现。
// legacy   = 改造前 botConfront 的确定性行为（默认，保证线上不变）
// cardpool = 卡池玩法：按商店买、按价值/威胁度投放
//
// legacy 的实现方式是「三个 hook 全返回 null」：引擎（match/match/confront.js 的 botConfront）看到 null 就走它
// 原有的 fillConfrontPicks 贪心 + assignConfrontTarget。这是最小侵入的选择 —— 不把 100 多行的旧决策搬一份进来，
// 也就没有「改一处忘一处」的漂移风险。
//
// cardpool 只做三件事：
//   ① 开商店（若还没开）；② 按「威胁值 / 价格」性价比反复买（买不起就刷新，免费次数用完再最多自费 2 次）；
//   ③ 把 ps.monsterDraft.picks 原样交回引擎 —— 路线/投放时刻由 `_botConfrontPlan` 定，预算/只数/合法性由
//      `_sanitizeBotPicks` 与 `_confrontMember` 兜底（与人类提交同一套判据）。
//
// 默认口径（业主 2026-11-03：对抗局全开）：monsterStrategyFor 在「对抗档（isConfrontRule）」缺省 cardpool；
// 其它 versus 档（赏金 / AI 对抗）缺省 legacy，保证线上那两档的 AI 决策一字不变。环境变量
// SP_MONSTER_STRATEGY 可以覆盖（两套内置都认），未知 id 记一次日志并回落 legacy。

import { CONFRONT_VALUE_DIV } from './match/confront.js';
import { defineMonsterStrategy, createMonsterRegistry } from './monsterContract.js';
import { openMonsterShop, rollMonsterShop, buyMonster, monsterBudgetLeft } from './monsterShop.js';

/** 一条警告只打一次（多回合重复刷屏没有信息量）。 */
const warned = new Set();
function warnOnce(line) {
  if (warned.has(line)) return;
  warned.add(line);
  if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn(`[monsterStrategies] ${line}`);
}

/**
 * 一只怪的「威胁值」：与 confrontValue 的 stat half 同源（hp + atk×5 + def×3 + res×3，÷ CONFRONT_VALUE_DIV），
 * 再按机制加权 —— 飞行绕开地面拦截（+15%），多阻挡（blockCnt ≥ 2，+10%；= 1，+5%）。
 * 纯函数：同样的记录永远得到同样的数（不读 match / 不读时钟）。
 * @param {any} e data/enemies.json 的记录（可为 null）
 * @returns {number} ≥ 1 的整数
 */
export function threatOf(e) {
  const s = (e && e.stats) || {};
  const num = (v) => (Number.isFinite(v) ? v : 0);
  const stat = num(s.maxHp) + num(s.atk) * 5 + num(s.def) * 3 + num(s.res) * 3;
  const value = Math.max(1, Math.round(stat / CONFRONT_VALUE_DIV));
  const flyMul = e && e.isFlyEnemy ? 1.15 : 1;
  const blocks = num(s.blockCnt);
  const blockMul = blocks >= 2 ? 1.1 : blocks >= 1 ? 1.05 : 1;
  return Math.max(1, Math.round(value * flyMul * blockMul));
}

/** 威胁值 / 价格 最高的那一格（买得起、未售出、有库存）；没有 → null。 */
function bestSlot(m, ps) {
  const shop = ps && ps.monsterShop;
  if (!shop || !Array.isArray(shop.slots)) return null;
  const { left } = monsterBudgetLeft(m, ps);
  const enemies = (m && m.data && m.data.enemies) || {};
  let best = null;
  let bestRatio = -1;
  for (let i = 0; i < shop.slots.length; i++) {
    const slot = shop.slots[i];
    if (!slot || slot.sold === true) continue;
    const price = Number(slot.price) || 0;
    if (!(price > 0) || price > left) continue;
    const ratio = threatOf(enemies[slot.key]) / price;
    if (ratio > bestRatio) { bestRatio = ratio; best = i; }
  }
  return best;
}

/** 已有草稿 = 投放已经由「点卡 / 之前的购买」定下（monsterDraft.picks 非空）。 */
function hasDraft(ps) {
  return !!(ps && ps.monsterDraft && Array.isArray(ps.monsterDraft.picks) && ps.monsterDraft.picks.length > 0);
}

/**
 * 买卡循环：反复买「最划算、买得起」的一格；一格都买不起就刷新。
 * 刷新上限（1 次免费 + 最多 MONSTER_MAX_PAID_REFRESHES 次自费）**由商店自己记账**（monsterShop.js 的
 * rollMonsterShop，人类走同一条路径）；这里不再自己数次数（2026-11-04 复验修复 2：两份计数会漂移，且玩家侧
 * 原先无上限）。商店拒绝刷新（WRONG_PHASE / 预算不足）就收手。
 * 草稿非空就直接返回（2026-11-04 复验修复 3）：草稿是玩家（或上一次买卡）已经决定的投放，
 * 再买一只就变成「投 3 提交 4」—— 买卡只发生在草稿为空时。
 * 副作用只有 ps.monsterShop / ps.monsterDraft.picks。
 * @returns {number[]} 买到的格下标（诊断 / 测试用）
 */
function cardpoolShopPlan(m, ps) {
  const bought = [];
  if (!ps || !ps.monsterShop) return bought;
  if (hasDraft(ps)) return bought;
  for (let guard = 0; guard < 64; guard++) {
    const idx = bestSlot(m, ps);
    if (idx != null) {
      const res = buyMonster(m, ps, idx);
      if (res && res.ok) { bought.push(idx); continue; }
    }
    const rolled = rollMonsterShop(m, ps, { free: false });
    if (!rolled || rolled.error) break;
  }
  return bought;
}

/** cardpool 的投放计划：先保证商店开着，再买（**仅当草稿为空**），最后把草稿交回引擎。买不到 → null（回落引擎原逻辑）。 */
function cardpoolDeployPlan(m, ps) {
  if (!m || !ps || m.monsterShopOn !== true) return null;
  if (!ps.monsterShop) {
    const opened = openMonsterShop(m, ps);
    if (opened && opened.error) return null;
  }
  // 2026-11-04 复验修复 3：草稿非空（人类点卡 / 已买到的卡）＝ 投放已经决定 —— 跳过买卡，原样交回草稿。
  // 旧实现无条件先买再交回草稿，线上表现是「人类投 3 → 提交 4」。只有草稿为空时才买。
  if (!hasDraft(ps)) cardpoolShopPlan(m, ps);
  const picks = (ps.monsterDraft && Array.isArray(ps.monsterDraft.picks)) ? ps.monsterDraft.picks : [];
  if (!picks.length) return null;
  return picks.map((p) => ({ enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' }));
}

/** legacy：三个 hook 全部交回引擎（= 改造前 botConfront 的行为）。 */
export const MONSTER_LEGACY = defineMonsterStrategy({
  id: 'legacy',
  name: '旧版贪心',
  desc: '三个 hook 全部返回 null：投放、选目标都交回引擎既有实现（fillConfrontPicks + assignConfrontTarget），与改造前一致。',
  pickTargets: () => null,
  shopPlan: () => null,
  deployPlan: () => null,
});

/** cardpool：按商店买（威胁值/价格最高优先），再交回引擎做路线/时刻/预算清洗。 */
export const MONSTER_CARDPOOL = defineMonsterStrategy({
  id: 'cardpool',
  name: '卡池投放',
  desc: '开怪物商店并按威胁值/价格买卡，把投放草稿交回引擎（路线与时刻由 _botConfrontPlan 定，预算由 _sanitizeBotPicks 兜底）。',
  pickTargets: () => null,
  shopPlan: (m, ps) => cardpoolShopPlan(m, ps),
  deployPlan: (m, ps) => cardpoolDeployPlan(m, ps),
});

/** 内置策略表（恒含 legacy；冻结；普通对象，按 id 取用）。 */
export const MONSTER_REGISTRY = createMonsterRegistry([MONSTER_LEGACY, MONSTER_CARDPOOL]);

/**
 * 按 id 取策略（未知 id → 记一次日志并回落 legacy，绝不返回 null）。
 * @param {string} [id] @param {Readonly<Record<string, Readonly<object>>>} [registry]
 * @returns {Readonly<object>}
 */
export function getMonsterStrategy(id = 'legacy', registry = MONSTER_REGISTRY) {
  const key = String(id ?? 'legacy').trim() || 'legacy';
  if (typeof key === 'string' && Object.hasOwn(registry, key)) return registry[key];
  warnOnce(`unknown monster strategy '${key}' — falling back to legacy`);
  return registry.legacy;
}

/**
 * 本局该用哪套怪物 AI。
 * 优先级：SP_MONSTER_STRATEGY > 本局档位缺省（对抗档 cardpool / 其它档 legacy）。
 * 注意：这只决定「用哪套」；引擎只在 `m.monsterShopOn` 为真时才问它（见 botConfront 的守卫）。
 * @param {object} m
 * @returns {Readonly<object>}
 */
export function monsterStrategyFor(m) {
  const env = (typeof process !== 'undefined' && process.env) ? process.env.SP_MONSTER_STRATEGY : null;
  const pick = (typeof env === 'string' && env.trim()) ? env.trim() : null;
  if (pick) return getMonsterStrategy(pick);
  const confront = !!(m && typeof m.isConfrontRule === 'function' && m.isConfrontRule());
  return getMonsterStrategy(confront ? 'cardpool' : 'legacy');
}
