// public/js/ui/hexGlyph.js — 海克斯卡面图标（v0.04.3 抽出，供三选一 / 熔毁商店 / 图鉴共用）。
//
// 三种形态：
//   ① 普通盟约专属：`iconBond` 的盟约形象做 CSS mask，颜色 = 卡面等级色（原有行为，逐字保留）；
//   ② **双盟约**：`iconBond` + `iconBond2` 两个盟约图标**各取一半**拼接 —— 左半「主盟约」暖色（炎 = 红），
//      右半「副盟约」冷色（谢拉格 = 冰蓝），上面再叠一层粒子特效（CSS 动画的火星 / 冰屑）；
//   ③ 其余：`icon` 字形（GIcon，currentColor 天然剪影）。
//
// 类名沿用调用方的基类（hxd__glyph / melt__glyph / hexcodex__icon），只在基类后面挂 `--duo` 与两个半片子元素，
// 样式统一写在 public/css/screens/hex.css 的「双盟约图标」段。

import { html } from './components.js';
import { GIcon } from './gameComponents.js';
import { bondIconUrl } from './assetUrls.js';

/** 这个海克斯是不是双盟约（两个盟约图标各一半）。 */
export const isDualHex = (card) => !!(card && card.iconBond && card.iconBond2);

const maskStyle = (url) => `-webkit-mask-image:url("${url}");mask-image:url("${url}")`;

/**
 * 双盟约图标：两个半片 + 粒子。
 * @param {{ card: any, cls: string, assets: any }} props  `cls` = 调用方的基类名（不含 --duo）
 */
export function DualBondGlyph({ card, cls, assets }) {
  const a = bondIconUrl(assets, card.iconBond);
  const b = bondIconUrl(assets, card.iconBond2);
  return html`<span class=${`${cls} ${cls}--duo`} aria-hidden="true" title=${`${card.name || ''}`}>
    ${a ? html`<i class=${`${cls}-half ${cls}-half--a`} style=${maskStyle(a)}></i>` : null}
    ${b ? html`<i class=${`${cls}-half ${cls}-half--b`} style=${maskStyle(b)}></i>` : null}
    <i class=${`${cls}-sparks`}></i>
  </span>`;
}

/**
 * 统一的卡面图标。
 * @param {{ card: any, cls: string, assets: any }} props
 */
export function HexGlyphIcon({ card, cls, assets }) {
  if (!card) return null;
  if (isDualHex(card)) return html`<${DualBondGlyph} card=${card} cls=${cls} assets=${assets} />`;
  const url = card.iconBond ? bondIconUrl(assets, card.iconBond) : null;
  if (url) return html`<span class=${`${cls} ${cls}--mask`} style=${maskStyle(url)} aria-hidden="true"></span>`;
  return html`<span class=${cls} aria-hidden="true"><${GIcon} name=${card.icon || 'bolt'} /></span>`;
}
