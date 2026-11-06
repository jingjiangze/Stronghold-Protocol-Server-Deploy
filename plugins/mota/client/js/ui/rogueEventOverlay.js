// plugins/mota/client/js/ui/rogueEventOverlay.js — 肉鸽「不期而遇」随机事件（业主 2026-10-27）。
//
// 眼海克斯/藏品同一套 `.hxd__*` 视觉：标题 + 文案 + N 个按钮（每个按钮写着这一选会发生什么）。
// 选项数量不写死：服务端给几个就渲染几个，说明里的「N 选一」按 `choices.length` 生成。
// 数据：`m.private.rogueOffer = { round, eventId, name, desc, choices:[{id,label,relic?,relicBuy?,relicSwap?}] }`
//   · `choice.relic`     —— 选它会**拿到一件藏品**（服务端发牌）；
//   · `choice.relicBuy`  —— 选它会**花资金买一件藏品**（值是标价，也可以是 `{ price }`）；
//   · `choice.relicSwap` —— **失与得**：1 件换 1 件（选它会发一份换入候选，换出哪件在藏品弹窗/藏品页里选）。
//     三者客户端都只加一个角标，发牌 / 扣款 / 换牌全在服务端（`g.roguePick` → `g.relicPick`），这里不自己发牌。
// 动作：`g.roguePick { choiceId }`

import { html, Icon } from './components.js';

/** 事件图标（与 components.js 的 ICONS 同名）；没有专门字形的用 dots 兜底。 */
const EVENT_ICONS = {
  ev_peddler: 'search',
  ev_shrine: 'crown',
  ev_wounded: 'user',
  ev_gamble: 'dice',
  ev_altar: 'eye',
  // 失与得：ICONS 里没有 swap 字形，用 refresh（两个循环箭头）表示「换一件」
  ev_exchange: 'refresh',
};
import { t } from '../../../shared/i18n.js';

export function normalizeRogueOffer(priv) {
  const o = priv && priv.rogueOffer;
  return o && Array.isArray(o.choices) && o.choices.length ? o : null;
}

/** 标价：数字 / 纯数字串 / `{ price }` → 正数，否则 0（布尔 true 不算价钱）。 */
function priceOf(v) {
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : 0;
  if (typeof v === 'string') {
    const n = Number(v.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  if (v && typeof v === 'object') {
    const n = Number(v.price);
    return Number.isFinite(n) && n > 0 ? n : 0;
  }
  return 0;
}

/**
 * 选项的藏品角标文案（空串 = 没有角标）：`藏品` / `藏品 · 6 资金` / `藏品 · 换 1 件`。
 * 只看服务端给的标记，不推断「这个选项看起来像给藏品」。
 * @param {{ relic?: unknown, relicBuy?: unknown, relicSwap?: unknown }|null|undefined} choice
 * @returns {string}
 */
export function choiceRelicBadge(choice) {
  if (!choice) return '';
  const buy = choice.relicBuy;
  if (buy != null && buy !== false && buy !== 0 && !(Array.isArray(buy) && !buy.length)) {
    const price = priceOf(buy);
    return price ? t('藏品 · {n} 资金', { n: price }) : t('藏品');
  }
  const swap = choice.relicSwap;
  if (swap != null && swap !== false && swap !== 0 && !(Array.isArray(swap) && !swap.length)) return t('藏品 · 换 1 件');
  const relic = choice.relic;
  if (relic == null || relic === false || relic === '') return '';
  if (Array.isArray(relic) && !relic.length) return '';
  return t('藏品');
}

export function RogueEventOverlay({ offer, busy = false, onPick }) {
  if (!offer) return null;
  const count = offer.choices.length;
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
        <span class="sep">·</span><span>${t('{n} 选一，选完立即生效；不选则超时取第一个', { n: count })}</span>
      </p>
      <div class="rgv__choices">
        ${offer.choices.map((c) => {
          const badge = choiceRelicBadge(c);
          return html`<button key=${c.id} type="button" class="rgv__choice" disabled=${busy}
            onClick=${() => !busy && onPick && onPick(c.id)}>
            <span class="rgv__key">${c.id.toUpperCase()}</span>
            <span class="rgv__label">${c.label}</span>
            ${badge ? html`<span class="rgv__mark">${badge}</span>` : null}
          </button>`;
        })}
      </div>
    </div>
  </div>`;
}
