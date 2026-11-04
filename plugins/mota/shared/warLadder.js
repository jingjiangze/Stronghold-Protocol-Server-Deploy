// shared/warLadder.js — 战争天梯（bx_war_ladder）的**纯**阶梯数学，服务端与客户端共用。
//
// 规格在 `shared/hexes.js` 的 `extra.warLadder`：{ thresholds, grants, repeatEvery, repeatTruePct }。
// 规则：
//   · 第 1..N 档 = thresholds[i]（固定表，最后一档通常是 999）；
//   · 之后**无上限**：每 repeatEvery 发一档，奖励 = 真伤比例 +repeatTruePct；
//   · 档位只前进不后退（累计弹药只增不减），每档只发一次。
// 这里只做「弹药 → 第几阶 / 阈值 / 显示文案」，不发奖（发奖在 server/match/match/warLadder.js）。

/** 最后一档的阈值（没有 thresholds 时 0）。 */
export const lastThreshold = (spec) => {
  const th = spec && Array.isArray(spec.thresholds) ? spec.thresholds : [];
  return th.length ? Number(th[th.length - 1]) || 0 : 0;
};

/**
 * 第 i 档（0 起）：{ t: 阈值, label: 奖励文案, repeat: 是否无限延伸段, k: 延伸序号(从 1 起) }。
 * @param {{thresholds:number[], grants:any[], repeatEvery:number, repeatTruePct:number}} spec
 * @param {number} i
 */
export function tierAt(spec, i) {
  const th = spec && Array.isArray(spec.thresholds) ? spec.thresholds : [];
  const gr = spec && Array.isArray(spec.grants) ? spec.grants : [];
  const idx = Math.max(0, Math.trunc(i));
  if (idx < th.length) {
    const g = gr[idx] || {};
    return { t: Number(th[idx]) || 0, label: g.label || '', repeat: false, k: 0 };
  }
  const every = Math.max(1, Math.trunc(Number(spec && spec.repeatEvery) || 666));
  const step = Number(spec && spec.repeatTruePct) || 0.2;
  const k = idx - th.length + 1;
  return {
    t: lastThreshold(spec) + every * k,
    label: `拉特兰伤害转真伤 +${step.toFixed(1)}%（累计 ${(1 + step * k).toFixed(1)}%）`,
    repeat: true,
    k,
  };
}

/** 已达成几阶（弹药 ≥ 阈值即算）。 */
export function tierCount(spec, ammo) {
  const a = Math.max(0, Number(ammo) || 0);
  let i = 0;
  while (i < 5000 && tierAt(spec, i).t <= a) i++;
  return i;
}

/** 下一档（永远存在，因为无限延伸）。 */
export const nextTier = (spec, ammo) => tierAt(spec, tierCount(spec, ammo));

/** 当前档（还没达成任何档时 null）。 */
export const currentTier = (spec, ammo) => {
  const n = tierCount(spec, ammo);
  return n > 0 ? tierAt(spec, n - 1) : null;
};

/** 距离下一档还差多少发。 */
export const needForNext = (spec, ammo) => Math.max(0, nextTier(spec, ammo).t - (Number(ammo) || 0));
