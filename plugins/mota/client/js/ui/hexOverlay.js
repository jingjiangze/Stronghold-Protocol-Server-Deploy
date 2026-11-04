// public/js/ui/hexOverlay.js — 海克斯 (Hex) draft overlay (this fork): the TFT-style "pick 1 of 3 augments" screen,
// shown twice per match — at the start of round 1 and again at round 7 (m.private.hexOfferDraft).
//
// The server decides everything (server/match/match/hexDraft.js): it offers the ids in m.private.hexOffer and records the
// confirmed one with `g.hex { hexId }` → m.private.hex / m.private.hexes. This file only draws the shared/hexes.js
// records, so the client never holds a second copy of the rules.
//
// 版式（v0.03.5）：与「海克斯熔毁协议」同一套骨架 —— 顶部英文微标 + 大标题 + 等级徽章副标题，中部「本局已获得」chips 带，
// 三栏卡（tier 条 / 六边形图标 / 名称 / 标签 / 描述 / 底部 SELECT 行动条），底部倒计时 + 提示。配色改成蓝金白。
//
// 图标：一律单色「剪影」——盟约专属的海克斯用 `iconBond` 对应的盟约形象（bondIconUrl → CSS mask 上色），
// 其余用 shared/hexes.js 的 `icon` 字形（GIcon，currentColor 天然是剪影）。颜色由卡面等级色决定。
//
// 等级 (grade): every card of one draft shares a grade — 白银 / 黄金 / 炫彩 — painted on the border / tier chip /
// icon silhouette. The server picks it once (m.private.hexGrade); this file only paints it.
//
// Co-op extras: a Countdown (m.private.hexDeadline — the server then takes the FIRST card) and, on the FIRST draft only,
// a PER-CARD free reroll (m.private.hexRerolls[slot] → `g.hexReroll { slot }`). The round-7 draft sends no reroll
// budget (hexRerolls = null), so this file draws no 换 chip at all.
//
// The card is a <div role="button">, not a <button>: a button may not nest the per-card 换 chip.

import { html, Countdown } from './components.js';
import { GIcon, RichText } from './gameComponents.js';
import { bondIconUrl } from './assetUrls.js';
import { data } from '../data.js';
import { HexGlyphIcon } from './hexGlyph.js';
import { hexById, HEX_CHOICE_SECONDS, HEX_GRADE_NAME } from '../../../shared/hexes.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** 等级 → 卡面配色类（public/css/screens/hex.css 的 .hxd__card--*）。 */
const GRADE_CLASS = Object.freeze({
  silver: 'hxd__card--silver',
  gold: 'hxd__card--gold',
  prismatic: 'hxd__card--prismatic',
});
const GRADE_TIER = Object.freeze({ silver: 'SILVER', gold: 'GOLD', prismatic: 'PRISMATIC' });

/**
 * The recipient's open draft (m.private.hexOffer) as renderable cards, else null.
 * @param {any} priv m.private payload
 * @returns {any[] | null}
 */
export function normalizeHexOffer(priv) {
  const ids = priv && Array.isArray(priv.hexOffer) ? priv.hexOffer : null;
  if (!ids || !ids.length) return null;
  const cards = ids.map((id) => hexById(id)).filter(Boolean);
  return cards.length ? cards : null;
}

/**
 * The recipient's confirmed pick (m.private.hex) as a record, else null.
 * @param {any} priv m.private payload
 */
export function myHex(priv) {
  return priv ? hexById(priv.hex) : null;
}

/** 卡面图标：单色剪影（盟约图标走 CSS mask，字形图标走 currentColor）；双盟约 = 两个图标各一半 + 粒子。 */
function HexGlyph({ card }) {
  return html`<${HexGlyphIcon} card=${card} cls="hxd__glyph" assets=${data.get('assets')} />`;
}

/**
 * The overlay.
 * @param {{ cards: any[], grade?: string|null, bandId?: string|null, deadline?: number, rerolls?: number[]|null,
 *   draft?: number, busyId?: string|null, rerollSlot?: number|null, picked?: string|null, ownedIds?: string[],
 *   onPick: (id: string) => void, onReroll?: (slot: number) => void }} props
 */
export function HexOverlay({ cards, grade = null, bandId = null, deadline = 0, rerolls = null, draft = 1, busyId = null, rerollSlot = null, picked = null, ownedIds = [], onPick = () => {}, onReroll = () => {} }) {
  if (!Array.isArray(cards) || !cards.length) return null;
  const budgets = Array.isArray(rerolls) ? rerolls : null;
  const free = busyId == null && rerollSlot == null;
  // the offer's grade (server-authoritative); fall back to the first card's own grade if the field is absent
  const offerGrade = grade || cards[0].grade || null;
  const second = draft >= 2;
  const title = second ? t('再次选择一个海克斯') : t('选择一个海克斯');
  const tail = deadline > 0 ? t('到时间未选择将自动选取第一项') : t('点击卡牌即可选取');
  const sub = second ? t('不会与已选的重复') : t('全局增益，本局一直生效');
  const owned = (Array.isArray(ownedIds) ? ownedIds : []).map((id) => hexById(id)).filter(Boolean);

  return html`<div class="hxd" role="dialog" aria-modal="true" aria-label=${t('海克斯')}>
    <div class="hxd__veil" aria-hidden="true"></div>
    <div class="hxd__inner">
      <div class="hxd__micro">HEX // <b>AUGMENT DRAFT</b></div>
      <h2 class="hxd__title" data-text=${title}>${title}</h2>
      <div class="hxd__rule" aria-hidden="true"><i></i><span></span><i></i></div>

      <p class="hxd__sub">
        ${offerGrade ? html`<span class=${cx('hxd__grade', `hxd__grade--${offerGrade}`)}>${t(HEX_GRADE_NAME[offerGrade] || offerGrade)}</span>` : null}
        <span>${sub}</span><span class="sep">·</span>
        <span>${budgets ? t('每张可免费刷新 1 次') : t('本次不可刷新')}</span><span class="sep">·</span>
        <span>${tail}</span>
      </p>

      <div class="hxd__picks">
        <div class="hxd__picks-k">${t('本局已获得海克斯')}</div>
        <div class="hxd__chips">
          ${owned.length
            ? owned.map((h) => html`<span key=${h.id} class=${cx('hxd__chip', h.grade !== 'silver' && `hxd__chip--${h.grade}`)}><i></i>${t(h.name)}</span>`)
            : html`<span class="hxd__empty">${t('尚未获得任何海克斯')}</span>`}
        </div>
      </div>

      <div class="hxd__grid">
        ${cards.map((c, slot) => {
          const busy = busyId != null && busyId === c.id;
          const rerolling = rerollSlot === slot;
          const left = budgets ? (Number(budgets[slot]) || 0) : 0;
          const tags = Array.isArray(c.tags) ? c.tags : (c.tag ? [c.tag] : []);
          const cardGrade = c.grade || offerGrade;
          const egg = c.easterEgg && bandId && c.easterEgg.band === bandId ? c.easterEgg.text : null;
          const busyNow = busy || rerolling;
          // 右上角只放一个短标签（tags[0] 恒为「盟约专属/战斗/经济」，tags[1] 才是地区或细分）
          const meta = tags[1] || tags[0] || t('全局增益');
          return html`<div key=${c.id} role="button" tabindex=${free ? 0 : -1}
              class=${cx('hxd__card', cardGrade && GRADE_CLASS[cardGrade], free && 'is-pickable', busyNow && 'is-busy',
                !free && 'is-locked', budgets && 'has-reroll', picked && picked === c.id && 'is-selfpick',
                // 双盟约 (v0.04.3)：双色呼吸边框 + 环绕光弧 + 粒子；选中瞬间爆一下
                c.iconBond2 && 'hxd__card--duo', busyId != null && busyId === c.id && 'is-choosing')}
              aria-disabled=${free ? undefined : 'true'}
              aria-label=${`${t(c.name)}，${t(c.desc)}`} title=${`${t(c.name)}\n${t(c.desc)}`}
              onClick=${() => free && onPick(c.id)}
              onKeyDown=${(e) => { if (free && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onPick(c.id); } }}>
            <div class="hxd__gain">
              <div class="hxd__row">
                <span class="hxd__tier">${GRADE_TIER[cardGrade] || ''}</span>
                <span class="hxd__owner">${meta}</span>
              </div>
              <div class=${cx('hxd__icon', cardGrade && `hxd__icon--${cardGrade}`)}>
                <${HexGlyph} card=${c} />
              </div>
              <h3 class="hxd__name">
                <span>${t(c.name)}</span>
                ${picked && picked === c.id ? html`<span class="spcard__selfpick hxd__selfpick">${t('自选')}</span>` : null}
              </h3>
              <div class="hxd__tags">
                ${cardGrade ? html`<span class=${cx('hxd__tag', 'hxd__tag--grade')}>${t(HEX_GRADE_NAME[cardGrade] || cardGrade)}${t('海克斯')}</span>` : null}
                ${tags.slice(0, 2).map((tag) => html`<span key=${tag} class="hxd__tag">${t(tag)}</span>`)}
              </div>
              <div class="hxd__divider"></div>
              <${RichText} text=${t(c.desc)} class="hxd__desc" as="p" />
              ${egg ? html`<span class="hxd__egg">${t(egg)}</span>` : null}
            </div>
            <div class="hxd__act">
              ${budgets ? html`<button type="button" class="hxd__reroll"
                  disabled=${!free || left <= 0}
                  aria-label=${t('免费刷新「{name}」（剩余 {n} 次）', { name: t(c.name), n: left })}
                  title=${t('免费刷新这张（剩余 {n} 次）', { n: left })}
                  onClick=${(e) => { e.stopPropagation(); if (free && left > 0) onReroll(slot); }}>${t('换')}<i class="hxd__reroll-n">${left}</i></button>`
                : html`<span class="hxd__act-k">SELECT</span>`}
              <span class="hxd__act-v">${busyNow ? t('选择中') : (free ? html`${t('点击选取')}<em class="hxd__arrow">›</em>` : t('等待其他玩家'))}</span>
            </div>
            ${busyNow ? html`<span class="hxd__stamp">${t('选择中')}</span>` : null}
          </div>`;
        })}
      </div>

      <div class="hxd__foot">
        <div class="hxd__timer">
          ${deadline > 0
            ? html`<${Countdown} deadline=${deadline} total=${HEX_CHOICE_SECONDS} size="sm" label="" gauge=${true} />`
            : html`<span class="hxd__untimed">${t('单人模式 · 不限时')}</span>`}
        </div>
        <div class="hxd__hint">${budgets ? t('点击卡牌即可选取 · 每张可免费刷新 1 次') : t('点击卡牌即可选取 · 本次不可刷新')}</div>
        <div class="hxd__count">DRAFT <b>${draft}</b></div>
      </div>
    </div>
  </div>`;
}
