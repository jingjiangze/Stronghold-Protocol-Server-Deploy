// plugins/mota/server/match/monsterPool.js — 怪物卡池：把「对抗可投放的敌人」做成干员卡池形态。
// 价格 = **阶位阶梯价** MONSTER_PRICE_BY_TIER（1 / 2 / 4 / 8 / 16 / 32，业主 2026-11-05：「最低 1，等比换算价值，
// 别整这么多数字」）：属性只负责**定档**（阶位按基础价 confrontValue 六等分位分档），档位负责**定价**；
// 波次价值 / 预算也按同一张阶梯求和（match/confront.js 的 confrontValueOf / confrontWaveValue），两端同源。
// 份数按官方卫戍干员商店的 poolCopies 等比换算（业主 2026-11-05，见 MONSTER_COPIES_BY_TIER）。
// 单位是「一只怪」（spawn count:1），不是整波。
//
// 与 pool.js 的 SharedPool 同构（cap / left / take / give / snapshot / totalLeft / 份数加权 roll）：
// 买走一份就少一份。池的归属随 `m.monsterMode`：shared（默认）/ master = 同队攻方共用一个池（见
// match/match/confront.js 的 finishConfrontTargets / this.monsterPools；master 只是投放权单人，池仍队级）；
// solo = 每人一个池（只有该队第一位存活攻方持有投放权，见 monsterShop.js 的 monsterPoolFor）。
//
// 卡池来源（业主 2026-11-05 裁决「放宽卡池来源，但相关规则参考官方卫戍，如怪物星级商店概率等，等比换算」）：
//   · **池 = data/enemies.json 的全部条目**（475 条；排除 `tokenOnly: true` 的 8 条 ⇒ 467 只），不筛阵营、不筛官方波次。
//     旧口径（2026-11-04）= 本回合官方出怪 / 面板并集，实测让 7 个阵营在池里 0 只（池层面）。
//   · **BOSS 不进商店**（2026-11-05 业主：官方卫戍商店从不卖领袖）⇒ 建池时再排掉 `rank === 'BOSS'` 的 59 条，
//     商店池 = 467 − 59 = **408 只**。**官方波次的 key 不受这条限制**：它们走 monsterPoolKeys 的第 2 步「成员保证」，
//     官方波次真出 BOSS 时它照样进池、照样买得到（「官方优先」是另一条裁决，不能被「BOSS 不进商店」吃掉）。
//   · 「本回合官方出怪优先」的语义保留为**成员保证**：官方波次的 key 一定在池里（本回合快照来自同一份 data）；
//     快照里有、data 里没有的 key 也补进池（防御：宁可多一只，不丢官方可投放怪）。
//   · **合法性（能不能提交 / 买 / 投）= 「在池里 + 阶位 ≤ 商店等级」**（业主 2026-11-05 第二次裁决：去掉
//     `legalKeys` 这道按回合圈的门 —— 它把 R1–R3 的货架卡成「只有本回合官方出怪」，池放宽到全表等于白放宽）。
//     `legalKeys` 仍然导出（盟约口径 / 老调用方的兼容入口），但**不再参与**发牌 / 购买 / 投放 / 提交。
//
// 阶位口径（2026-11-05 全表重取等分位，6 档；取切点的人群见下面的「取哪个人群」）：
//   · 切点 MONSTER_TIER_BANDS 重取脚本 = `tools/tier-bands.mjs`（只读数据、池子再变时重跑，把打印的切点抄回来）。
//   · 分位口径用**基础价** `confrontValue`（= round((maxHp + atk×5 + def×3 + res×3) / 120)，下限 1），与建池同一函数；
//     旧切点 [39, 57, 87, 134, 176]（2026-11-04 在 120 只旧基线池上取的）在全表口径下把 34 % 的表压进 tier6
//     （58 / 60 / 69 / 74 / 47 / 159），业主报障「卡池不该只有本回合官方出怪、要按六阶等分」就是这一处。
//   · **取哪个人群**：阶位只对「商店真能发出来的卡」有意义，所以切点在**商店池**（全表 475 − tokenOnly 8 − BOSS 59
//     = 408 只）上取等分位 ⇒ **每档 68 / 72 / 64 / 68 / 68 / 68 只**（16.7 / 17.6 / 15.7 / 16.7 / 16.7 / 16.7 %）。
//     若改在 475 条全表上取（等分位 [46, 71, 117, 179, 317]），落到商店池会变成 79 / 73 / 77 / 77 / 69 / 33 只
//     （tier6 只剩 8.1 %）—— 59 只 BOSS 的高价离群值占住了最高两档，商店侧反而不再等分，所以不取这个口径。
//     两个口径的数字都打在 `node tools/tier-bands.mjs` 的输出里（--base all / noToken / shop）。
//   · 定阶只看**基础价**，不看本回合价：本回合价随 gd.enemyScale 的 hp/atk 倍率整体上浮，同一只怪会在后期
//     跳档；阶位是怪物的固有稀有度（与「这一回合卖多少钱」分开）。
//   · 卡面价格 = 阶梯价（MONSTER_PRICE_BY_TIER），与波次价值 / 预算同源：m.confrontValueOf(key) 现在就是阶梯价
//     —— 2026-11-05 业主裁决「单价只由阶位决定」，价格不再吃回合倍率，也不再叠加特性档位分（见 match/confront.js）。
//   · 旧切点 [25, 50, 100, 200]（2026-11-03）在旧基线池上实测 5 / 26 / 34 / 40 / 15 —— 严重偏斜，早已废弃。
//
// 依赖方向：本文件 import 了 match/match/confront.js 的两个**纯函数**（confrontPool / confrontValue）；
// confront.js 又 import 本文件，构成 ESM 循环导入。两边都只在函数体内取用对方的导出（函数声明会被提升），
// 模块顶层不互相求值，因此安全。

import { confrontPool, confrontValue } from './match/confront.js';

/**
 * 价格分档切点（基础价口径，见文件头）。`cost > band` 逐级 +1 ⇒ 6 档（`length + 1`）。
 * 2026-11-05 按**商店池**（全表 475 − tokenOnly 8 − BOSS 59 = 408 只）在 confrontValue 上重取等分位：
 * 每档 68 / 72 / 64 / 68 / 68 / 68 只（16.7 / 17.6 / 15.7 / 16.7 / 16.7 / 16.7 %），切点 = 每组的最大值。
 * 池子再变就重跑 `node tools/tier-bands.mjs`（三个口径的切点与分布都打在输出里）。
 * @type {readonly number[]}
 */
export const MONSTER_TIER_BANDS = Object.freeze([44, 65, 98, 148, 226]);

/**
 * 官方卫戍**干员商店**每张棋子的库存份数（`data/config.json` → `economy.poolCopies`，实测原值）。
 * 这是「等比换算」的基准（业主 2026-11-05），不要再手改 —— 换算表见 MONSTER_COPIES_BY_TIER。
 * @type {Readonly<Record<number, number>>}
 */
export const MONSTER_OFFICIAL_COPIES_BY_TIER = Object.freeze({ 1: 12, 2: 14, 3: 18, 4: 16, 5: 8, 6: 5 });

/** 干员池 key 数（`data/chess.json` 的条数，实测 266 —— 等比换算的分母）。 */
export const MONSTER_CHESS_POOL_SIZE = 266;
/** 怪物池 key 数（`data/enemies.json` 的条数，实测 475 —— 等比换算以这个数为基数）。 */
export const MONSTER_ENEMY_POOL_SIZE = 475;
/**
 * 怪物份数的**等比缩放系数** = 怪物池 key 数 ÷ 干员池 key 数 = 475 / 266（`MONSTER_CHESS_POOL_SIZE`）
 * = 1.785714…，保留 3 位 → **1.786**。
 * 推导：`Math.round((MONSTER_ENEMY_POOL_SIZE / MONSTER_CHESS_POOL_SIZE) * 1000) / 1000`。
 */
export const MONSTER_COPY_SCALE = 1.786;

/**
 * 每阶的份数（**库存 cap 的唯一公式**，业主 2026-11-05）：
 * `MONSTER_COPIES_BY_TIER[t] = max(1, round(MONSTER_OFFICIAL_COPIES_BY_TIER[t] × MONSTER_COPY_SCALE))`。
 * 实测（scale 1.786）：tier1→21、2→25、3→32、4→29、5→14、6→9（6 档全覆盖；原 scale 1.846 时是
 * 22/26/33/30/15/9）。
 * 按 2026-11-05 的商店池（408 只、六阶 68 / 72 / 64 / 68 / 68 / 68）折算的库存总量：
 * T1 21×68=1428 / T2 25×72=1800 / T3 32×64=2048 / T4 29×68=1972 / T5 14×68=952 / T6 9×68=612 份
 * —— 高阶薄是官方 poolCopies（12/14/18/16/8/5）的形状，不是新切点造成的；发牌按剩余份数加权，
 * 所以满级商店的抽卡份额约 T1 16.2 % / T2 20.4 % / T3 23.2 % / T4 22.4 % / T5 10.8 % / T6 6.9 %（合计 8812 份）。
 * **旧口径「份数 = 官方该回合只数 × 1.5」已废弃**（它只对官方波次成立，池放宽到全表后失效）；
 * 1.5 倍出怪量改由**军费**保证：每名攻方每回合拿到「官方波次价值 × 1.5 ÷ 攻方人数」
 * （match/match/confront.js 的 grantMonsterFunds / CONFRONT_VOLUME_SHARE），库存不再是它的约束。
 * @type {Readonly<Record<number, number>>}
 */
export const MONSTER_COPIES_BY_TIER = Object.freeze(
  Object.fromEntries(Object.entries(MONSTER_OFFICIAL_COPIES_BY_TIER).map(([tier, copies]) => [
    Number(tier),
    Math.max(1, Math.round(copies * MONSTER_COPY_SCALE)),
  ])),
);

/**
 * **旧口径的 1.5 常量，现已不参与库存公式**（业主 2026-11-05：份数改按官方 poolCopies 等比换算）。
 * 保留导出是为了不破坏外部引用；「1.5 × 出怪量」现在只由**资金口径**保证 ——
 * 与 match/match/confront.js 的 `CONFRONT_VOLUME_SHARE = 1.5` 同一个数（军费 = 波次价值 × 1.5）。
 */
export const MONSTER_POOL_COPIES_SHARE = 1.5;

/** 最高阶（= 分档切点数 + 1；当前 5 个切点 ⇒ 6 档）。 */
export const MONSTER_MAX_TIER = MONSTER_TIER_BANDS.length + 1;

/**
 * **单价阶梯**（业主 2026-11-05：「怪物价值最低为 1，等比换算价值，别整这么多数字」）。
 * 下标 = 阶位 − 1：`tier 1..6 → 1 / 2 / 4 / 8 / 16 / 32`（首项 1 = 下限，公比 2）。
 * 单价**只由阶位决定**，与回合倍率 / 规则档（对抗 / 赏金同价）/ 攻方人数都无关；属性只负责定档
 * （`monsterTierOf(confrontValue(rec))`，切点 MONSTER_TIER_BANDS 不动）⇒ 全表只有这 6 个价格
 * （旧口径 = 218 个不同价格、1 ~ 20 887；赏金档另走 legacy 公式，中位 12 460 / 最大 3 756 540）。
 * 波次价值 / 军费 / 预算按同一张阶梯求和（match/confront.js 的 confrontValueOf）—— 「预算 = Σ阶梯价」同源。
 * @type {readonly number[]}
 */
export const MONSTER_PRICE_BY_TIER = Object.freeze([1, 2, 4, 8, 16, 32]);

/**
 * 阶位 → 单价（`MONSTER_PRICE_BY_TIER` 的唯一查表口；夹到 [1, MONSTER_MAX_TIER]，非法 / 缺失 → 最低价 1）。
 * @param {number} tier 1..MONSTER_MAX_TIER
 * @returns {number} 1 / 2 / 4 / 8 / 16 / 32
 */
export function monsterPriceAtTier(tier) {
  const t = Math.max(1, Math.min(MONSTER_MAX_TIER, Math.trunc(Number(tier)) || 1));
  const price = MONSTER_PRICE_BY_TIER[t - 1];
  return Number.isFinite(price) && price > 0 ? price : MONSTER_PRICE_BY_TIER[0];
}

/**
 * 一只怪（`data/enemies.json` 的记录）的**单价**：先定档、再查阶梯。
 * 阶位 = `monsterTierOf(confrontValue(rec))` —— 基础属性口径，**不吃**本回合倍率（见文件头的「定阶只看基础价」）。
 * @param {any} rec data/enemies.json 的记录
 * @returns {number} 0 = 记录缺失（调用方按非法 / 不在池里处理）；否则 1 / 2 / 4 / 8 / 16 / 32
 */
export function monsterPriceOfRecord(rec) {
  if (!rec) return 0;
  return monsterPriceAtTier(monsterTierOf(confrontValue(rec)));
}

/**
 * 价格 → 阶位（1..MONSTER_MAX_TIER）。非有限 / 非正数一律按 tier1 处理（与 confrontValue 的下限 1 一致）。
 * @param {number} cost 基础价（confrontValue 口径；不是混了本回合倍率的价格）
 * @returns {number} 1..6
 */
export function monsterTierOf(cost) {
  const v = Number(cost);
  if (!Number.isFinite(v) || v <= 0) return 1;
  let tier = 1;
  for (const band of MONSTER_TIER_BANDS) if (v > band) tier += 1;
  return Math.min(MONSTER_MAX_TIER, tier);
}

/**
 * 一只怪的卡池条目：`{ key, cost, tier, cap }`。
 * `cost` 是**价格**（= 阶梯价 `MONSTER_PRICE_BY_TIER[tier]`，与波次价值 / 预算同一量纲），`tier` 由基础价定
 * （见文件头），`cap` = 该阶份数。
 * @typedef {{ key: string, cost: number, tier: number, cap: number }} MonsterPoolEntry
 */
export class MonsterPool {
  /**
   * @param {MonsterPoolEntry[]} entries
   */
  constructor(entries = []) {
    /** @type {Map<string, { cap: number, left: number, tier: number, cost: number }>} */
    this.entries = new Map();
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || typeof e.key !== 'string' || !e.key) continue;
      const cap = Math.max(0, Math.floor(Number(e.cap) || 0));
      if (cap <= 0) continue;
      const cost = Number(e.cost);
      const tier = Math.max(1, Math.min(MONSTER_MAX_TIER, Math.floor(Number(e.tier) || 1)));
      this.entries.set(e.key, {
        cap,
        left: cap,
        tier,
        cost: Number.isFinite(cost) && cost > 0 ? cost : 0,
      });
    }
  }

  /** 这只怪是否在池里。 */
  has(key) { return this.entries.has(key); }

  /** 价格（entry 建池时的量纲）；不在池里 → 0。 */
  cost(key) { return this.entries.get(key)?.cost ?? 0; }

  /** 阶位；不在池里 → 0。 */
  tier(key) { return this.entries.get(key)?.tier ?? 0; }

  /** 该怪的官方份数（总额）；不在池里 → 0。 */
  cap(key) { return this.entries.get(key)?.cap ?? 0; }

  /** 剩余份数（对外一律夹到 >= 0）。 */
  left(key) { return Math.max(0, this.entries.get(key)?.left ?? 0); }

  /**
   * 取走最多 n 份，返回**实际取走**的数量（夹在剩余份数内；不在池里 / n 非正 → 0）。
   * @param {string} key @param {number} [n]
   */
  take(key, n = 1) {
    const e = this.entries.get(key);
    const want = Math.floor(Number(n));
    if (!e || !(want > 0)) return 0;
    const k = Math.min(Math.max(0, e.left), want);
    e.left -= k;
    return k;
  }

  /**
   * 归还最多 n 份，返回**实际归还**的数量（夹在 cap 内）。
   * @param {string} key @param {number} [n]
   */
  give(key, n = 1) {
    const e = this.entries.get(key);
    const want = Math.floor(Number(n));
    if (!e || !(want > 0)) return 0;
    const k = Math.min(e.cap - e.left, want);
    e.left += k;
    return k;
  }

  /** { key: 剩余份数 } 快照（测试 / 诊断）。 */
  snapshot() {
    const o = {};
    for (const [key, e] of this.entries) o[key] = Math.max(0, e.left);
    return o;
  }

  /** 全池剩余份数合计。 */
  totalLeft() {
    let n = 0;
    for (const e of this.entries.values()) n += Math.max(0, e.left);
    return n;
  }

  /**
   * 按**剩余份数**加权抽一个 key（份数就是权重：便宜的怪份数多，出场率自然高）。
   * 剩余为 0 的怪永远不会被抽到。
   * @param {() => number} rng [0,1) 随机源（match 里用 m.rngMonsterShop）
   * @param {{ tiers?: number[]|Set<number>|number|null, exclude?: string[]|Set<string>|null }} [opts]
   *   tiers: 只在这些阶里抽（缺省 = 全阶）；exclude: 不抽这些 key（同一张商店里避免重复）
   * @returns {string|null} 无候选 → null
   */
  roll(rng, { tiers = null, exclude = null } = {}) {
    let tierFilter = null;
    if (tiers != null) {
      const list = Array.isArray(tiers) || tiers instanceof Set ? [...tiers] : [tiers];
      tierFilter = new Set(list.map(Number).filter((t) => Number.isFinite(t)));
    }
    const excludeSet = exclude == null ? null : (exclude instanceof Set ? exclude : new Set(exclude));
    const candidates = [];
    let total = 0;
    for (const [key, e] of this.entries) {
      if (!(e.left > 0)) continue;
      if (tierFilter && !tierFilter.has(e.tier)) continue;
      if (excludeSet && excludeSet.has(key)) continue;
      candidates.push([key, e.left]);
      total += e.left;
    }
    if (!(total > 0)) return null;
    let r = (typeof rng === 'function' ? rng() : Math.random()) * total;
    for (const [key, n] of candidates) { r -= n; if (r < 0) return key; }
    return candidates[candidates.length - 1][0];
  }
}

/**
 * 本回合官方出怪的**只读快照**（由 match/match/phases.js 在每回合建波后写入 `m._roundOfficialSpawns`）。
 * 两个用途（2026-11-05 起职责拆分）：
 *   · `legalKeys` 的**规则闸门**（对抗档 = 本回合官方出怪 —— 提交合法性，未放宽）；
 *   · `monsterPoolKeys` 的**成员保证**（官方 key 一定进池，见那里的注释）。
 * boss 回合 / 老对局 / 未进 ROUND_START 时没有快照 → null。
 * @param {object} m
 * @returns {Set<string>|null} 去重后的 enemyKey；无快照 → null
 */
export function officialSpawnKeys(m) {
  const list = m && m._roundOfficialSpawns;
  if (!Array.isArray(list) || !list.length) return null;
  const keys = new Set();
  for (const s of list) if (s && typeof s.enemyKey === 'string' && s.enemyKey) keys.add(s.enemyKey);
  return keys.size ? keys : null;
}

/**
 * 本回合官方出怪里每个 key 的**合计只数**。2026-11-05 起**不再是份数口径**（份数改按官方 poolCopies 等比换算）；
 * 现在只给盟约用：monsterBonds.js 的「增援」以「官方只数 × 1.5」为基准、`factionPoolCounts` 按官方只数加权。
 * @param {object} m
 * @returns {Map<string, number>|null} 无快照 → null
 */
export function officialSpawnCounts(m) {
  const list = m && m._roundOfficialSpawns;
  if (!Array.isArray(list) || !list.length) return null;
  const counts = new Map();
  for (const s of list) {
    if (!s || typeof s.enemyKey !== 'string' || !s.enemyKey) continue;
    const n = Math.max(1, Number(s.count) || 1);
    counts.set(s.enemyKey, (counts.get(s.enemyKey) || 0) + n);
  }
  return counts.size ? counts : null;
}

/**
 * 合法性闸门的规则分流（**只管能不能提交 / 能不能买，不再决定池子来源**，2026-11-05）：
 *   · 对抗档（`m.isConfrontRule()`）→ 官方波次（本回合真正生成的怪），维持 2026-11-04 的口径；
 *   · 赏金档（缺省）→ 返回 null，让调用方回落到**面板并集**（confrontGroups 的行 key 并集）——
 *     实测赏金档 R2/R3 的「官方 key ∩ 面板」= 0，用官方集合当闸门会把该档的子单 / 商店 / bot 全部判死；
 *   · 取不到 isConfrontRule（老对局 / 直测 / 非对抗）→ 沿用官方优先的旧行为。
 * @param {object} m
 * @returns {Set<string>|null}
 */
function officialForRule(m) {
  if (!m) return null;
  const rule = typeof m.isConfrontRule === 'function' ? m.isConfrontRule() === true : true;
  return rule ? officialSpawnKeys(m) : null;
}

/**
 * 本回合「官方出怪 / 面板」口径的 key 集合（2026-11-04 的旧口径，**已不再用于盟约分母**）。
 * 现在的提交 / 购买 / 投放判据是「在卡池里 + 阶位 ≤ 商店等级」（见 `monsterPoolKeys` 与 buildMonsterPool 的 tier；
 * confront.js 的 `_confrontMember` 与 monsterShop.js 的 buyMonster / placeMonster / rollCard 都改用它）。
 * 之所以撤掉这道闸门：R1–R3 的官方波次只有 2–3 个 key，商店 / bot 全被它滤成空货架，池放宽到全表等于白放宽。
 * 保留导出只为兼容仍按「本回合官方 / 面板」问话的老调用方 —— **盟约阈值分母已改成 `monsterPoolKeys`**
 * （业主 2026-11-05：旧分母在对抗档只有 7 个 key / 3 个阵营，19 个阵营恒 0）。
 *
 * 按规则档分流（officialForRule）：
 *   · 对抗档 = 本回合官方出怪（`m._roundOfficialSpawns`，业主 2026-11-04 口径）；
 *   · 赏金档 / 没有快照 = `confrontGroups()` 的行 key 并集（面板并集；赏金档实测官方 key ∩ 面板 = 0）。
 * 返回 null = 两个来源都取不到（match 上没有 confrontGroups / 它抛异常）= 不做闸门（旧行为不受影响）。
 * 回落路径的缓存挂在 match 上、以 groups 数组的**引用**为键：`confrontGroups()` 按「回合|倍率」重算时会换新数组，
 * 引用一变缓存自动失效（官方快照路径每次现算，键少、成本可忽略）。
 * @param {object} m
 * @returns {Set<string>|null}
 */
export function legalKeys(m) {
  const official = officialForRule(m);
  if (official) return official;
  if (!m || typeof m.confrontGroups !== 'function') return null;
  let groups;
  try { groups = m.confrontGroups(); } catch { return null; }
  const cache = m._monsterLegalKeys;
  if (cache && cache.groups === groups) return cache.keys;
  const keys = new Set();
  for (const g of Array.isArray(groups) ? groups : []) {
    for (const r of (g && g.rows) || []) if (r && typeof r.key === 'string' && r.key) keys.add(r.key);
  }
  m._monsterLegalKeys = { groups, keys };
  return keys;
}

/**
 * 本回合「可投放的怪物」全集（**2026-11-04 口径，保留导出**）：对抗档 = 本回合官方出怪；赏金档 = 面板并集
 * （confrontGroups 的行 key 并集，同一套分流见 officialForRule）；两者都取不到才退回官方全池。
 * ⚠ **它不是卡池来源**（卡池见 `monsterPoolKeys`，2026-11-05 已放宽到 data/enemies.json 全表）。
 * ⚠ **已不再用于盟约分母**（业主 2026-11-05）：它的分母在对抗档只等于「本回合官方出怪」（实测 R1–R13 只有
 * 7 个 key / 3 个阵营），让其余 19 个阵营的分母恒 0、阈值退化常量 [1,2,3]；盟约阈值的分母已统一改成
 * `monsterPoolKeys`（商店池 408 只口径），见 monsterBonds.js 的 factionPoolCounts。
 * @param {object} m
 * @returns {string[]} 排序后的 key（顺序稳定，便于复现）
 */
export function monsterCardKeys(m) {
  const official = officialForRule(m);
  if (official) return [...official].sort();
  const keys = new Set();
  if (m && typeof m.confrontGroups === 'function') {
    for (const g of m.confrontGroups() || []) {
      for (const r of (g && g.rows) || []) if (r && typeof r.key === 'string' && r.key) keys.add(r.key);
    }
  }
  if (!keys.size) for (const k of confrontPool(m && m.data && m.data.factions)) keys.add(k);
  return [...keys].sort();
}

/**
 * **卡池的 key 全集**（`buildMonsterPool` 的遍历源）。业主 2026-11-05「放宽卡池来源」：
 *   · 主来源 = **`data/enemies.json` 的全部条目**（475 条；排除 `tokenOnly: true` 的 8 条 ⇒ 467 只），
 *     不筛阵营、不筛官方波次 —— 旧口径只取「本回合官方出怪 / 面板并集」，实测 7 个阵营在池里 0 只。
 *   · **BOSS 不进商店**（业主 2026-11-05：官方卫戍商店从不卖领袖）⇒ 第 1 步再排掉 `rank === 'BOSS'` 的 59 条，
 *     商店池 = 467 − 59 = 408 只。
 *   · 「本回合官方出怪优先」保留为**成员保证**：`_roundOfficialSpawns` 的 key **一定**在池里
 *     （第 2 步；官方波次真出 BOSS 时它照样进池 —— 这条保证**不**受「BOSS 不进商店」影响）。
 *   · data 不可用（直测 / 精简 stub）时回落旧路径：面板并集 → `confrontPool(data/factions.json)`，绝不返回空池。
 * ⚠ 本函数只管**池 / 库存**；「能不能提交 / 买 / 投」= 在池里 + 阶位 ≤ 商店等级（2026-11-05 起不再看 legalKeys）。
 * 它**同时是盟约阈值分母的来源**（monsterBonds.js 的 factionPoolCounts，业主 2026-11-05：分母统一用商店池）。
 * @param {object} m
 * @returns {string[]} 排序后的 key（顺序稳定，便于复现）
 */
export function monsterPoolKeys(m) {
  const keys = new Set();
  // 1) data/enemies.json 全表（tokenOnly 的召唤物 / 部件不单独建条目；BOSS 不进商店）
  const enemies = (m && m.data && m.data.enemies) || {};
  for (const key of Object.keys(enemies)) {
    const rec = enemies[key];
    if (!rec || rec.tokenOnly === true) continue;
    if (rec.rank === 'BOSS') continue; // 商店不卖领袖（第 2 步的官方成员保证会把官方 BOSS 补回来）
    keys.add(key);
  }
  // 2) 本回合官方出怪的 key 必须有（官方优先 = 成员保证；也覆盖 tokenOnly / data 缺条目的边角）
  const official = officialSpawnKeys(m);
  if (official) for (const key of official) keys.add(key);
  // 3) data 不可用的回落（面板并集 → confrontPool）
  if (!keys.size) {
    if (m && typeof m.confrontGroups === 'function') {
      for (const g of m.confrontGroups() || []) {
        for (const r of (g && g.rows) || []) if (r && typeof r.key === 'string' && r.key) keys.add(r.key);
      }
    }
    if (!keys.size) for (const k of confrontPool(m && m.data && m.data.factions)) keys.add(k);
  }
  return [...keys].sort();
}

/**
 * 这一回合**该队**的存活攻方人数。
 * **不是份数的乘数**（份数 2026-11-05 起只由阶位份数表决定，与人数 / 官方只数都无关 —— 见 buildMonsterPool）；
 * 保留导出是因为它是「该队有几个攻方」的通用问法（军费按它摊：grantMonsterFunds），改口径前其它调用方可能还在用。
 * 只用 `m.attackingTeam` 与 `m.teamIdOf` 现算（座位表取 `m.alivePlayers()`，没有就用 `m.order` 过滤）：
 * 非攻防回合（`attackingTeam == null`）、老对局、取不到座位表 → 1（老行为）。
 * @param {object} m
 * @returns {number} >= 1
 */
export function teamAttackerCount(m) {
  if (!m || m.attackingTeam == null || typeof m.teamIdOf !== 'function') return 1;
  const list = typeof m.alivePlayers === 'function'
    ? m.alivePlayers()
    : (Array.isArray(m.order) ? m.order.filter((p) => p && p.alive !== false && p.left !== true) : []);
  let n = 0;
  for (const ps of Array.isArray(list) ? list : []) if (m.teamIdOf(ps) === m.attackingTeam) n += 1;
  return Math.max(1, n);
}

/**
 * 用本局数据建一张怪物卡池（shared 怪物模式每队一张，solo 每人一张 —— 见 match/match/confront.js 的
 * finishConfrontTargets 与 monsterShop.js 的 monsterPoolFor）。
 * 份数口径（业主 2026-11-05 裁决「参考官方卫戍，等比换算」）：`cap = MONSTER_COPIES_BY_TIER[阶位]`
 *   （= `max(1, round(官方 poolCopies[阶位] × MONSTER_COPY_SCALE))`，见常量处的推导与实测值）。
 *   · **旧口径「份数 = 官方该回合只数 × 1.5」已替换**（它只对官方波次成立，池放宽到 467 只后失效）；
 *   · **1.5 × 出怪量改由军费保证**：每名攻方每回合拿到「官方波次价值 × 1.5 ÷ 攻方人数」
 *     （match/match/confront.js 的 grantMonsterFunds / CONFRONT_VOLUME_SHARE），库存不再是它的约束；
 *   · **按队算**：shared 模式下同队攻方共用这一个池，份数不乘攻方人数（队友看到的是同一份库存，买走就少）；
 *   · **与「这一回合官方出了几只」无关**：池每回合重建（finishConfrontTargets），库存每回合回到满值。
 * `tier` 字段建在 entry 上：卡面阶位展示 + **发牌阶位上限 + 提交合法性**（monsterShop 的 dealSlots/refillSlot 只抽
 * `tier ≤ 商店等级` 的卡，`_confrontMember` / buyMonster / placeMonster 也只放行 `tier ≤ 商店等级` 的卡 ——
 * 与干员商店 `maxTier = shop.level` 同构；2026-11-05 起不再看 `legalKeys`）。
 * @param {object} m Match 实例（只用 data / _roundOfficialSpawns / confrontGroups / confrontValueOf）
 * @returns {MonsterPool}
 */
export function buildMonsterPool(m) {
  const entries = [];
  if (!m) return new MonsterPool(entries);
  const enemies = (m.data && m.data.enemies) || {};
  for (const key of monsterPoolKeys(m)) {
    const rec = enemies[key] || null;
    // 价格只由 data 属性定档 ⇒ data 缺条目就没有价格（与 monsterShop.js 的 monsterPriceOf 同口径）。
    if (!rec) continue;
    // 阶位（无倍率量纲）：怪物的固有稀有度，不随回合倍率跳档 —— 展示 + 发牌阶位上限
    const tier = monsterTierOf(confrontValue(rec));
    // 单价（业主 2026-11-05）：只由阶位决定，查同一张阶梯（`confrontValueOf` 也返回这个数）
    const price = monsterPriceAtTier(tier);
    // 份数（业主 2026-11-05）：官方干员商店 poolCopies 的等比换算值；与官方只数 / 攻方人数无关。
    // 缺表项（未来加档）兜底 1 份，绝不出现 0 份的卡。
    const cap = MONSTER_COPIES_BY_TIER[tier] || 1;
    entries.push({ key, cost: price, tier, cap });
  }
  return new MonsterPool(entries);
}
