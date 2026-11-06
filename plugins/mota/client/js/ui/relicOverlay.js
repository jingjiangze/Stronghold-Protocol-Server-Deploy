// plugins/mota/client/js/ui/relicOverlay.js — 藏品卡面（2026-10-27 建，2026-11 对齐官方三种形态）。
//
// 一只组件、四种卡面模式（都是「选一张藏品」，只是来源与代价不同）：
//   · draft —— 协同房 R4/R8/R12 的免费三选一（每人独立抽 3 件、选 1 件；20 秒不选由服务端自动取第一张）；
//   · wish  —— 肉鸽「得偿所愿」节点：免费获得一件藏品，**必须选择**（官方不能空手离开，所以不给跳过/关闭）；
//   · shop  —— 肉鸽「诡意行商」节点：按 relics.json 的官方标价买（红 8 / 青蓝 4），买不起服务端拒绝，不买等超时；
//   · swap  —— 肉鸽「失与得」事件（2026-11-06）：**1 件换 1 件**。分两阶段，都在本组件里：
//              ① 先在「换出」那一栏点自己要失去的藏品（`onPick` 走的是同一个 `g.relicPick`，服务端第一阶段把
//                 `relicId` 当换出 id；稀有度跟投入挂钩，选完服务端按档位重发候选）；
//              ② 再从卡面选要换入的那件（同一个意图的第二阶段，`takeId`）。
// 视觉直接复用海克斯草案那套卡牌（`.hxd__*`），所以几处看起来是同一个家族。
//
// 数据：`m.private.relicOffer = [{ id, name, desc, icon, tier, set, kind, price?, mode?, swapGive?, downgraded? }]`
//       （shop 的卡面带 `price`；`mode` 服务端也可能挂在卡面或 `priv.relicOfferMode` 上；
//         swap 的第二阶段每张卡带 `swapGive` = 已选定的换出 id，降档候选带 `downgraded: true`）
//       swap 的「换出」候选来自同一帧 priv 的 `relicCards`（normalizeRelicOffer 挂到返回数组的 `give` 上）。
// 动作：`g.relicPick { relicId }`

import { html } from './components.js';
import { Img } from './gameComponents.js';
import { t } from '../../../shared/i18n.js';

/**
 * 稀有度 → 描边类（复用 hex.css 的 .hxd__card--*）。
 * `mid` 是「红色 / 青蓝之间的中间档」：现在的 relics-87 数据只发 red / blue，将来服务端发 tier:'mid' 时用
 * `.hxd__card--gold`（plugins/mota/client/css/screens/hex.css:423 已有这个类，与海克斯金卡同一套描边 + 扫光）。
 */
const TIER_CLASS = { red: 'hxd__card--prismatic', mid: 'hxd__card--gold', blue: 'hxd__card--silver' };
const TIER_LABEL = { red: '红色', mid: '金色', blue: '青蓝' };

/**
 * 「失与得进行中」的客户端信号：`normalizeRelicOffer(priv)` 每次被调用时刷新（见到 swap offer = true）。
 * 对局页在同一趟渲染里先调 `normalizeRelicOffer(priv)`（判是否挂藏品弹窗）、再渲染集成战略面板，所以面板读到的是
 * 本帧的值；`pub.rogue` 里没有 offer 状态，面板没法自己判断。只用来决定「藏品页里那排换出按钮显不显示」。
 */
let swapPending = false;
export function relicSwapPending() { return swapPending; }

/**
 * `priv.relicOffer` 有内容时返回卡面数组，否则 null（挂载判据与 HexOverlay 同形）。
 * 服务端把模式放在 `priv.relicOfferMode` 时，把它挂到返回数组的 `mode` 属性上带出去 —— 调用点（screens/game.js）
 * 只把这个数组当 `cards` 传进来，不额外传 `mode`，所以在归一化这里搭一次车；没有该字段时原样返回。
 *
 * 失与得（swap）额外把「自己手上的藏品」（`priv.relicCards`）挂到返回数组的 `give` 上：这是第一阶段要换出的候选，
 * 组件不自己拼 priv 的其它字段（对局页只传 cards）。
 */
export function normalizeRelicOffer(priv) {
  const list = priv && priv.relicOffer;
  if (!Array.isArray(list) || !list.length) { swapPending = false; return null; }
  const mode = priv && priv.relicOfferMode;
  const cardMode = list.map((c) => (c && typeof c.mode === 'string' ? c.mode : '')).find(Boolean) || '';
  const isSwap = mode === 'swap' || cardMode === 'swap';
  swapPending = isSwap;
  if (!['shop', 'wish', 'draft', 'swap'].includes(mode) && !isSwap) return list;
  const out = list.slice();
  if (['shop', 'wish', 'draft', 'swap'].includes(mode)) out.mode = mode;
  if (isSwap) {
    const own = Array.isArray(priv && priv.relicCards) ? priv.relicCards : [];
    out.give = own.map((c) => ({ id: String((c && c.id) || ''), name: String((c && c.name) || (c && c.id) || ''),
      tier: String((c && c.tier) || ''), kind: String((c && c.kind) || ''), icon: String((c && c.icon) || '') }))
      .filter((c) => c.id);
  }
  return out;
}

/**
 * 卡面模式：`shop` / `wish` / `draft` / `swap`（见文件头）。
 * 来源优先级：显式 `mode` 参数 → 卡面数组的 `mode`（normalizeRelicOffer 带的）→ 单张卡面的 `mode` →
 * 有没有 `price`（有有限数字就算 shop）→ 否则 draft。
 * wish 与 draft 都免费，只能靠服务端给的 mode 区分；拿不到 mode 时按 draft 渲染（它的说明含「超时自动取第一张」，
 * 对 wish 不会说成「能跳过」，最坏只是没写明「必须选」）。
 * @param {any[]|null} cards
 * @param {string|null} [mode] 调用方（将来）从服务端直接拿到的模式
 * @returns {'shop'|'wish'|'draft'|'swap'}
 */
export function relicOfferMode(cards, mode = null) {
  const list = Array.isArray(cards) ? cards : [];
  const known = (v) => {
    const s = String(v == null ? '' : v).toLowerCase();
    return s === 'shop' || s === 'wish' || s === 'draft' || s === 'swap' ? s : '';
  };
  const fromCard = list.map((c) => known(c && c.mode)).find(Boolean);
  const found = known(mode) || known(list.mode) || fromCard || '';
  if (found) return /** @type {'shop'|'wish'|'draft'|'swap'} */ (found);
  return list.some((c) => Number.isFinite(Number(c && c.price))) ? 'shop' : 'draft';
}

export function RelicOverlay({ cards, mode = null, busyId = null, round = 0, onPick }) {
  if (!cards || !cards.length) return null;
  const kind = relicOfferMode(cards, mode);
  const shop = kind === 'shop';
  const wish = kind === 'wish';
  const swap = kind === 'swap';
  // 失与得：卡面带 `swapGive`（服务端已经收到第一阶段的换出 id）才算进入第二阶段；否则先让玩家选换出。
  const giveId = swap ? String(cards.map((c) => (c && c.swapGive) || '').find(Boolean) || '') : '';
  const ready = !swap || !!giveId;
  const gives = swap && Array.isArray(cards.give) ? cards.give : [];
  // 四种模式的文案：draft 三选一 / wish 得偿所愿（必须选）/ shop 按标价扣资金 / swap 失与得（1 件换 1 件）。
  // 都不能空手离开，所以没有跳过或关闭按钮。
  const title = shop ? t('购买藏品') : wish ? t('得偿所愿') : swap ? t('失与得') : t('选择藏品');
  const micro = shop ? 'SHOP' : wish ? 'WISH' : swap ? 'EXCHANGE' : 'DRAFT';
  const sub = shop
    ? t('商店：按标价扣资金，买不起会被拒绝；不买可等超时自动关闭')
    : wish
      ? t('得偿所愿 · 免费获得一件藏品，必须选择')
      : swap
        ? (ready
          ? t('失与得：选择要换入的藏品，将失去你选中的那一件')
          : t('失与得：先选一件要换出的藏品（换入的稀有度不会高于它）'))
        : t('三选一，选完立即生效；不选则超时自动取第一张');
  return html`<div class="hxd hxd--relic" role="dialog" aria-modal="true" aria-label=${title}>
    <div class="hxd__veil" aria-hidden="true"></div>
    <div class="hxd__inner">
      <span class="hxd__micro">RELIC // <b>${micro}</b></span>
      <h2 class="hxd__title">${title}</h2>
      <p class="hxd__sub">${round ? t('第 {r} 回合 · ', { r: round }) : null}${sub}</p>
      ${swap && !ready ? html`<div class="rgv__choices" aria-label=${t('换出的藏品')}>
        ${gives.length ? gives.map((g) => html`<button key=${g.id} type="button" class="rgv__choice"
            data-swap-id=${g.id} disabled=${busyId != null}
            onClick=${() => busyId == null && onPick && onPick(g.id)}>
            <span class="rgv__key">${TIER_LABEL[g.tier] || '✦'}</span>
            <span class="rgv__label">${g.name}</span>
            <span class="rgv__mark">${t('换出')}</span>
          </button>`) : html`<p class="hxd__sub">${t('没有可换出的藏品')}</p>`}
      </div>` : null}
      ${ready ? html`<div class="hxd__grid">
        ${cards.map((c) => html`<div key=${c.id} role="button" tabindex="0"
            class=${`hxd__card is-pickable ${TIER_CLASS[c.tier] || 'hxd__card--silver'}${busyId === c.id ? ' is-busy' : ''}`}
            onClick=${() => busyId == null && onPick && onPick(c.id)}>
          <div class="hxd__gain">
            <div class="hxd__row">
              <span class="hxd__tier">${c.kind === 'negative' ? t('负面藏品') : t('增益藏品')}</span>
              <span class="hxd__owner">${TIER_LABEL[c.tier] || c.tier || ''}</span>
            </div>
            <div class="hxd__icon">
              ${c.icon
                ? html`<${Img} src=${c.icon} fallback=${html`<span class="hxd__glyph">✦</span>`} />`
                : html`<span class="hxd__glyph">✦</span>`}
            </div>
            <h3 class="hxd__name">${c.name}</h3>
            <div class="hxd__tags">
              <span class="hxd__tag">${c.set || t('藏品')}</span>
              ${Number.isFinite(Number(c.price)) ? html`<span class="hxd__tag">${t('资金')} ${Number(c.price)}</span>` : null}
              ${c.downgraded ? html`<span class="hxd__tag hxd__tag--grade"
                title=${t('池里没有同档藏品，这张是降档补偿')}>${t('已降档')}</span>` : null}
            </div>
            <p class="hxd__desc">${c.desc}</p>
          </div>
        </div>`)}
      </div>` : null}
    </div>
  </div>`;
}
