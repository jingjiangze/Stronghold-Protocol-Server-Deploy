// plugins/mota/client/js/ui/relicOverlay.js — 藏品三选一（业主 2026-10-27）。
//
// 藏品不再进商店，改成「像海克斯那样的随机三选一」：协同房 R4 / R8 / R12 各发一份，
// 每人独立抽 3 件、选 1 件；20 秒不选由服务端自动取第一张。
// 视觉直接复用海克斯草案那套卡牌（`.hxd__*`），所以两处看起来是同一个家族。
//
// 数据：`m.private.relicOffer = [{ id, name, desc, icon, tier, set, kind }]`
// 动作：`g.relicPick { relicId }`

import { html } from './components.js';
import { Img } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';

/** 稀有度 → 描边类（复用 hex.css 的 .hxd__card--*） */
const TIER_CLASS = { red: 'hxd__card--prismatic', blue: 'hxd__card--silver' };
const TIER_LABEL = { red: '红色', blue: '青蓝' };

/** `priv.relicOffer` 有内容时返回卡面数组，否则 null（挂载判据与 HexOverlay 同形）。 */
export function normalizeRelicOffer(priv) {
  const list = priv && priv.relicOffer;
  return Array.isArray(list) && list.length ? list : null;
}

export function RelicOverlay({ cards, busyId = null, round = 0, onPick }) {
  if (!cards || !cards.length) return null;
  return html`<div class="hxd hxd--relic" role="dialog" aria-modal="true" aria-label=${t('选择藏品')}>
    <div class="hxd__veil" aria-hidden="true"></div>
    <div class="hxd__inner">
      <span class="hxd__micro">RELIC // <b>DRAFT</b></span>
      <h2 class="hxd__title">${t('选择藏品')}</h2>
      <p class="hxd__sub">
        ${round ? t('第 {r} 回合 · ', { r: round }) : null}${t('三选一，选完立即生效；不选则超时自动取第一张')}
      </p>
      <div class="hxd__grid">
        ${cards.map((c) => html`<div key=${c.id} role="button" tabindex="0"
            class=${`hxd__card is-pickable ${TIER_CLASS[c.tier] || 'hxd__card--silver'}${busyId === c.id ? ' is-busy' : ''}`}
            onClick=${() => busyId == null && onPick && onPick(c.id)}>
          <div class="hxd__gain">
            <div class="hxd__row">
              <span class="hxd__tier">${c.kind === 'negative' ? t('负面藏品') : t('增益藏品')}</span>
              <span class="hxd__owner">${TIER_LABEL[c.tier] || ''}</span>
            </div>
            <div class="hxd__icon">
              ${c.icon
                ? html`<${Img} src=${c.icon} fallback=${html`<span class="hxd__glyph">✦</span>`} />`
                : html`<span class="hxd__glyph">✦</span>`}
            </div>
            <h3 class="hxd__name">${c.name}</h3>
            <div class="hxd__tags"><span class="hxd__tag">${c.set || t('藏品')}</span></div>
            <p class="hxd__desc">${c.desc}</p>
          </div>
        </div>`)}
      </div>
    </div>
  </div>`;
}
