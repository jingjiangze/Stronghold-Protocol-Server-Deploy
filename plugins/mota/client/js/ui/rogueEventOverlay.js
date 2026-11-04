// plugins/mota/client/js/ui/rogueEventOverlay.js — 肉鸽「不期而遇」随机事件（业主 2026-10-27）。
//
// 眼海克斯/藏品同一套 `.hxd__*` 视觉：标题 + 文案 + 2 个按钮（每个按钮写着这一选会发生什么）。
// 数据：`m.private.rogueOffer = { round, eventId, name, desc, choices:[{id,label}] }`
// 动作：`g.roguePick { choiceId }`

import { html, Icon } from './components.js';

/** 事件图标（与 components.js 的 ICONS 同名）；没有专门字形的用 dots 兜底。 */
const EVENT_ICONS = {
  ev_peddler: 'search',
  ev_shrine: 'crown',
  ev_wounded: 'user',
  ev_gamble: 'dice',
  ev_altar: 'eye',
};
import { t } from '../../../shared/i18n.js';

export function normalizeRogueOffer(priv) {
  const o = priv && priv.rogueOffer;
  return o && Array.isArray(o.choices) && o.choices.length ? o : null;
}

export function RogueEventOverlay({ offer, busy = false, onPick }) {
  if (!offer) return null;
  return html`<div class="hxd hxd--rogue" role="dialog" aria-modal="true" aria-label=${t('不期而遇')}>
    <div class="hxd__veil" aria-hidden="true"></div>
    <div class="hxd__inner">
      <span class="hxd__micro">ROGUE // <b>ENCOUNTER</b></span>
      <h2 class="hxd__title" data-text=${offer.name}>
        <${Icon} name=${EVENT_ICONS[offer.eventId] || 'dots'} size=${22} class="rgv__icon" />${offer.name}
      </h2>
      <div class="hxd__rule" aria-hidden="true"><i></i><span></span><i></i></div>
      <p class="hxd__sub">
        ${offer.round ? t('第 {r} 回合 · ', { r: offer.round }) : null}${offer.desc}
        <span class="sep">·</span><span>${t('二选一，选完立即生效；不选则超时取第一个')}</span>
      </p>
      <div class="rgv__choices">
        ${offer.choices.map((c) => html`<button key=${c.id} type="button" class="rgv__choice" disabled=${busy}
          onClick=${() => !busy && onPick && onPick(c.id)}>
          <span class="rgv__key">${c.id.toUpperCase()}</span>
          <span class="rgv__label">${c.label}</span>
        </button>`)}
      </div>
    </div>
  </div>`;
}
