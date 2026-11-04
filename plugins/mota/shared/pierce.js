// shared/pierce.js — 「全能穿透」词条（v0.05）
//
// 词条定义：**全能穿透 X%** = 同时无视目标 X% 的护甲（物理）与 X% 的法术抗性（法术）。
// 战斗侧实现：`server/sim/content/bonds/core.js` 的 installWarLadder 把它写成
// `defIgnorePct` / `resIgnorePct` 两个常驻 mod（百分比，0–1）。
//
// 本文件只做**词条口径的数学**（纯函数，服务端/客户端/工具共用），用来回答：
//   · 这 X% 穿透等效于多少「攻击力 +Y%」？
//   · 面对 x 护甲 / 魔抗的敌人，穿透还有多少边际收益（5% 保底之后归零）？
//
// 伤害口径与 `server/sim/damage.js` 一致：
//   物理  dmg = max(A − D·(1−p), 0.05·A)
//   法术  dmg = max(A·(1 − R·(1−p)/100), 0.05·A)
// 其中 A = 单次攻击面板、D = 护甲、R = 法术抗性（0–100）、p = 穿透（0–1）。

/** 词条元信息（UI/图鉴/详情卡统一用这一份文案）。 */
export const PIERCE_TERM = Object.freeze({
  id: 'pierce',
  name: '全能穿透',
  unit: '%',
  desc: '同时无视目标一定比例的护甲与法术抗性（护甲穿透 = 法术穿透 = 该数值）。',
});

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** 物理伤害（含 5% 保底）。 */
export const physDamage = (atk, def, pierce = 0) => Math.max(atk - def * (1 - clamp01(pierce)), 0.05 * atk);
/** 法术伤害（含 5% 保底）。 */
export const artsDamage = (atk, res, pierce = 0) => Math.max(atk * (1 - (res * (1 - clamp01(pierce))) / 100), 0.05 * atk);

/**
 * 相对于「0 穿透」的 DPS 倍率。
 * @param {{kind?:'phys'|'arts', atk:number, def?:number, res?:number, pierce:number}} o
 *   kind 缺省 'phys'；phys 用 def，arts 用 res（0–100）
 */
export function pierceRatio({ kind = 'phys', atk, def = 0, res = 0, pierce = 0 }) {
  const base = kind === 'arts' ? artsDamage(atk, res, 0) : physDamage(atk, def, 0);
  const now = kind === 'arts' ? artsDamage(atk, res, pierce) : physDamage(atk, def, pierce);
  return base > 0 ? now / base : 1;
}

/**
 * 「这 p 穿透等效于多少攻击力提升」——**相对攻击力的百分比**（0.05 = +5% 攻击）。
 * 由「同 DPS」反解：
 *   物理：1 + p·D/(A−D)   （A−D 为 0 穿透时的实际伤害；吃保底时另算）
 *   法术：1 + p·R/(100−R)
 * @returns {number} 倍率（1 = 等效 0 提升）
 */
export function pierceAtkEquivalent({ kind = 'phys', atk, def = 0, res = 0, pierce = 0 }) {
  const p = clamp01(pierce);
  if (kind === 'arts') {
    const b = 1 - res / 100;
    if (!(b > 0)) return 1;
    return Math.max(1, 1 + (p * res) / (100 - res));
  }
  const dmg0 = physDamage(atk, def, 0);
  if (!(dmg0 > 0.05 * atk + 1e-9)) return 1;      // 已经吃保底：穿透无效
  const dmgP = physDamage(atk, def, p);
  if (dmgP <= 0.05 * atk + 1e-9) {
    // 打到保底了：等效攻击提升按「保底伤害 / 原伤害」算
    return (0.05 * atk) / dmg0;
  }
  return 1 + (p * def) / (atk - def);
}

/** 物理穿透的收益上限：p ≥ 这个值时伤害已经压到 5% 保底，再多也没用（返回 0–1）。 */
export const pierceCapPhys = ({ atk, def }) => (def > 0 ? clamp01((def - 0.95 * atk) / def) : 0);
/** 法术穿透的收益上限：R·(1−p) ≤ 95 之后就是 5% 保底（返回 0–1）。 */
export const pierceCapArts = ({ res }) => (res > 0 ? clamp01(1 - 95 / res) : 0);

/**
 * 换算表工具：给定「攻击 +a%」与「穿透 +p%」，比较谁更划算（>1 表示穿透更优）。
 *   物理：p·D/(A−D) ÷ a·A/(A−D) = p·D / (a·A)   ⇒ 穿透更优 ⟺ p·D > a·A
 *   法术：p·R/(100−R) ÷ a                   ⇒ 穿透更优 ⟺ p·R > a·(100−R)
 */
export function pierceVsAtk({ kind = 'phys', atk = 1, def = 0, res = 0, pierce = 0, atkPct = 0 }) {
  const p = clamp01(pierce);
  if (kind === 'arts') {
    const gain = (p * res) / Math.max(1e-9, 100 - res);
    return atkPct > 0 ? gain / atkPct : Infinity;
  }
  const gain = (p * def) / Math.max(1e-9, atk - def);
  return atkPct > 0 ? gain / (atkPct * atk / Math.max(1e-9, atk - def)) : Infinity;
}

/**
 * 混合伤害的整队 DPS 倍率：按各类型占比加权（share 之和 1）。
 * @param {{shares?: {phys?:number, arts?:number}, atkPhys?:number, atkArts?:number, def?:number, res?:number, pierce:number, atkPct?:number}} o
 */
export function squadRatio({ shares = { phys: 0.5, arts: 0.5 }, atkPhys = 1000, atkArts = 1000, def = 0, res = 0, pierce = 0, atkPct = 0 }) {
  const m = 1 + atkPct;
  const rp = pierceRatio({ kind: 'phys', atk: atkPhys * m, def, pierce });
  const ra = pierceRatio({ kind: 'arts', atk: atkArts * m, res, pierce });
  return (shares.phys || 0) * rp + (shares.arts || 0) * ra;
}

/**
 * 取整规则（作者定）：保留 1 位小数，以 .5 为线 —— 小数部分 < .5 一律取 .5；= .5 保留；> .5 进位到整数。
 * 例：6.25 → 6.5；12.5 → 12.5；8.75 → 9；25 → 25。
 */
export function snapPierceHalf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  const i = Math.floor(n);
  const f = Math.round((n - i) * 1e6) / 1e6;
  if (f === 0) return i;
  if (f < 0.5) return i + 0.5;
  if (f === 0.5) return i + 0.5;
  return i + 1;
}

/**
 * 「全属性提升」→「全能穿透」换算（v0.05 平衡调整）：
 *   取 allPct 的 share（默认 25%）按 R=50 等价的攻击力折算成穿透 —— R=50 时 1% 穿透 ≈ 1% 攻击，
 *   所以 pierce = allPct × share × (100−R)/R；剩下 (1−share) 仍留在全属性上。
 * @param {{allPct:number, share?:number, R?:number}} o allPct 用百分数（0.10 = 10%）
 * @returns {{ kept:number, pierce:number }} kept = 剩余全属性（百分数，未取整），pierce = 穿透（百分数，已按 .5 取整）
 */
export function convertAllStats({ allPct, share = 0.25, R = 50 }) {
  const pct = Number(allPct) || 0;                    // 百分数：10 = 10%
  const s = Math.max(0, Math.min(1, Number(share)));
  const r = Math.max(1, Math.min(99, Number(R) || 50));
  const moved = pct * s;                              // 10% × 25% = 2.5（个百分点）
  const pierceRaw = (moved * (100 - r)) / r;          // R=50 → 1:1
  return { kept: Math.round(pct * (1 - s) * 1e4) / 1e4, pierce: snapPierceHalf(pierceRaw) };
}

/** 显示用：0.03 → '+3%'。 */
export const fmtPierce = (p) => `${p >= 0 ? '+' : ''}${Math.round(p * 1000) / 10}%`;
