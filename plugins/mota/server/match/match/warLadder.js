// server/match/match/warLadder.js — 战争天梯（拉特兰专属 · 炫彩，v0.05）
//
// 选下这条海克斯后：
//   · 立即获得 1 张**精英化隐现**（`warLadder.startChess`）；
//   · 开启「战争阶梯」：按本局【拉特兰】干员**累计消耗的弹药**逐档发奖励（`ps.lateranoAmmo`，
//     钩子见 server/sim/Battle.js + server/match/match/combat.js）；
//   · 每档只发一次（按 `warLadderTier` 前进）；最后一档之后，再每 `repeatEvery` 发把真伤比例 +`repeatTruePct`。
//
// 数值与奖励全在 `shared/hexes.js` 的 `extra.warLadder`（thresholds / grants 等长数组），这里只做执行，
// 调数值不用改逻辑。

import { HEXES } from '../../../shared/hexes.js';
import { tierCount } from '../../../shared/warLadder.js';

const specOf = () => (HEXES.find((h) => h && h.id === 'bx_war_ladder') || {}).warLadder || null;

export class MatchWarLadder {
  /** 这条海克斯的配置（thresholds / grants / repeatEvery…）。 */
  warLadderSpec() { return specOf(); }

  /** 某名玩家是否已开启战争天梯。 */
  warLadderActive(ps) { return !!(ps && ps.warLadderOn); }

  /** 选下海克斯时调用：发精英隐现 + 初始化阶梯进度。 */
  startWarLadder(ps) {
    const spec = specOf();
    if (!spec || !ps || ps.warLadderOn) return;
    ps.warLadderOn = true;
    ps.warLadderTier = 0;
    ps.warLadderPierce = 0;
    ps.warLadderTruePct = 0;
    ps.warLadderExtra = 0;
    if (spec.startChess) {
      const piece = ps.acquireChess(spec.startChess, { source: 'hex' });
      if (!piece) this.toast(ps, 'warn', '战争天梯：整备区已满，精英隐现进入临时整备区');
    }
    this.toast(ps, 'info', `战争天梯 · 开启：累计弹药达到 ${spec.thresholds[0]} 发即刻发奖`);
    this.checkWarLadder(ps);
  }

  /**
   * 结算后调用（也可随时调）：把累计弹药换成阶梯奖励。幂等 —— 每档只发一次。
   * @returns {number} 本次新发放的档数
   */
  checkWarLadder(ps) {
    const spec = specOf();
    if (!spec || !ps || !ps.warLadderOn) return 0;
    const ammo = Number(ps.lateranoAmmo) || 0;
    const th = Array.isArray(spec.thresholds) ? spec.thresholds : [];
    const gr = Array.isArray(spec.grants) ? spec.grants : [];
    let fired = 0;
    // 固定档：逐档发放（每档只发一次）
    while (ps.warLadderTier < th.length && ammo >= th[ps.warLadderTier]) {
      const i = ps.warLadderTier;
      this._warLadderGrant(ps, gr[i] || {}, th[i]);
      ps.warLadderTier = i + 1;
      fired++;
    }
    void tierCount;   // 无限段的档数由下面的 repeatEvery 处理（tierCount 供客户端/测试同源）
    // 最后一档之后：每 repeatEvery 发 → 真伤比例 +repeatTruePct（无上限）
    const last = th.length ? th[th.length - 1] : 0;
    const every = Math.max(0, Math.trunc(Number(spec.repeatEvery) || 0));
    if (every > 0 && ps.warLadderTier >= th.length && ammo >= last + every) {
      const extraTiers = Math.floor((ammo - last) / every);
      const had = Number(ps.warLadderExtra) || 0;
      if (extraTiers > had) {
        const step = Number(spec.repeatTruePct) || 0.2;
        const add = (extraTiers - had) * step;
        ps.warLadderExtra = extraTiers;
        ps.warLadderTruePct = Math.round(((Number(ps.warLadderTruePct) || 0) + add) * 100) / 100;
        this.toast(ps, 'info', `战争天梯 · 真伤比例 +${add.toFixed(1)}%（现 ${ps.warLadderTruePct.toFixed(1)}%）`);
      }
    }
    if (fired) {
      try { ps.recompute(); } catch { /* 视图会在下一次 push 时刷新 */ }
      ps.dirty?.();
    }
    return fired;
  }

  /** 发一档奖励：干员 / 装备 / 资金 / 盟约层数 / 全能穿透 / 真伤比例。 */
  _warLadderGrant(ps, grant, threshold) {
    const g = grant || {};
    const got = [];
    for (const id of Array.isArray(g.chess) ? g.chess : []) {
      const piece = ps.acquireChess(id, { source: 'hex' });
      const name = this.gd && this.gd.chess ? (this.gd.chess(id) || {}).name : null;
      got.push(piece ? `干员·${name || id}` : `干员·${name || id}（整备区满，进临时区）`);
    }
    for (const id of Array.isArray(g.items) ? g.items : []) {
      const it = ps.acquireItem(id, { source: 'hex' });
      const name = this.gd && this.gd.item ? (this.gd.item(id) || {}).name : null;
      got.push(`${it ? '' : '（满）'}装备·${name || id}`);
    }
    if (Number(g.funds) > 0) {
      ps.addFunds(Math.trunc(Number(g.funds)), { reason: 'warLadder' });
      got.push(`${Math.trunc(Number(g.funds))} 资金`);
    }
    if (Number(g.layers) > 0) {
      ps.addLayers('lateranoShip', Math.trunc(Number(g.layers)), { reason: 'warLadder' });
      got.push(`拉特兰层数 +${Math.trunc(Number(g.layers))}`);
    }
    if (Number(g.pierce) > 0) {
      const v = Math.trunc(Number(g.pierce));
      ps.warLadderPierce = Math.max(Number(ps.warLadderPierce) || 0, v);
      got.push(`拉特兰全能穿透 ${ps.warLadderPierce}%`);
    }
    if (Number(g.truePct) > 0) {
      ps.warLadderTruePct = Math.max(Number(ps.warLadderTruePct) || 0, Number(g.truePct));
      got.push(`拉特兰伤害 ${ps.warLadderTruePct}% 转真伤`);
    }
    this.toast(ps, 'info', `战争天梯 · ${threshold} 发：${got.length ? got.join('、') : '（本档无奖励）'}`);
  }
}
