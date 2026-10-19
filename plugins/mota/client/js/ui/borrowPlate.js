// 借钱 plate (DESIGN §28/§29): the borrow mode's one control, with a spot of its own in the HUD — right of the 整备区
// row, under the board's bottom-right corner, above the shop cards (user report 2026-10-07: 单独把 ui 换区域, and 一看就
// 知道能点的，和官方类似 — it used to be squeezed into the shop bar's 剩余可放置角色 / 冻结 / 刷新 line, where it read as
// a readout rather than a button). So it is built in the official button language: a bright amber ring, the funds glyph
// and the count, a 借钱 caption, hover lift and glow, and an idle pulse while a borrow is actually available. Clicking
// it opens the teammate picker beside it — one row per teammate (user decision 2026-10-08), with the amount picker on
// a row of its own when a mode ever allows more than one fund per request. A pending request replaces the plate with
// its own row: 同意 / 拒绝 on the incoming side, a plain 已向 … 请求 … readout on the outgoing one — a request cannot
// be withdrawn (user decision 2026-10-08); it closes on the answer, or on its 30 s TTL, which gives the round's
// budget back (server/match/match/economy.js, econCloseRequest 'expired').
//
// The strip that stays in the shop bar (public/js/ui/shopBar.js EconStrip) is the rest of the team economy — the
// reserve and the logistics projects — which only appear when a server turns the full rule set on.
import { html } from './components.js';
import { CoinGlyph, Img, Sprite } from './gameComponents.js';
import { actions } from './gameActions.js';
import { localAsset } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { longPress, heldClick } from './longPress.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * The mode's own 资金 icon (user report 2026-10-07: 将这个的图标改成促融共竞的钱的图标) — the official
 * `garrisonTypeIcon/icon_gold` sprite the autochess HUD uses for funds, resolved like every other official sprite:
 * the data/assets.json copy first (present on any install that ran setup), the local-client extraction second, the
 * client's own glyph as the last resort.
 */
function FundsIcon() {
  return html`<${Sprite} k="garrisonTypeIcon/icon_gold" class="borrow__coin"
    fallback=${html`<${Img} src=${localAsset('ui/common', 'icon_gold')} class="borrow__coin"
      fallback=${html`<${CoinGlyph} class="borrow__coin" />`} />`} />`;
}

/**
 * @param {{ econ:any, editable:boolean }} props
 */
export function BorrowPlate({ econ, editable }) {
  // 点一下 = 直接广播 (user 2026-10-17: 「只要点这个按钮，直接向所有人广播借钱，不需要浮窗」) — the picker it used to
  // open (choose an amount, then pick a teammate or 广播) is gone: the amount is the smallest one the server allows for a
  // single ask, and every teammate gets the request. Long-press still explains the rule.
  const amount = Math.min(1, Math.max(1, Number(econ.maxAmount) || 1));
  const canAsk = editable && econ.requestLeft > 0 && econ.partners.length > 0;
  // 长按看规则 (user 2026-10-17: 长按这些按钮显示备注)
  const hold = longPress(() => t('点击立即向全体队友借 {amount} 资金，队友各自决定借不借。\n单次最多 {max} 块 · 本回合还可发起 {left} 次 · 全队本回合还能调拨 {team}', {
    amount, max: econ.maxAmount, left: econ.requestLeft, team: econ.transferLeft,
  }));
  const owe = econ.owe && econ.owe.total > 0 ? econ.owe : null;
  const due = econ.due && econ.due.total > 0 ? econ.due : null;
  const cover = econ.cover && econ.cover.total > 0 ? econ.cover : null;
  const debtTip = `${owe ? t(' · 已欠 {total}（自己点「还钱」结清）', { total: owe.total }) : ''}${due ? t(' · 队友欠我 {total}（可点「催钱」）', { total: due.total }) : ''}`
    + `${cover ? t(' · 兜底 {kills}/{total}（利息率 {ratePct}%）', { kills: cover.kills, total: cover.total, ratePct: cover.ratePct }) : ''}`;
  return html`<div class="borrow" role="group" aria-label=${t('协同经济')}>
    <span class="borrow__cap">${t('本回合可调拨')} <b class="num">${econ.transferLeft}</b></span>
    ${owe ? html`<span class="borrow__owe" title=${t('你目前欠队友 {total} 资金，点右侧「还钱」结清', { total: owe.total })}>${t('欠')} <b class="num">${owe.total}</b></span>` : null}
    ${due ? html`<span class="borrow__due" title=${t('队友欠你 {total} 资金，点右侧「催钱」提醒', { total: due.total })}>${t('应收')} <b class="num">${due.total}</b></span>` : null}
    ${cover ? html`<span class="borrow__cover" title=${t('兜底利息：为队友挡住 {kills}/{total} 只（{ratePct}%）——队友还钱时，这笔利息按各自的兜底率分给所有兜底过的人（借款人除外），100% 需累计到全场怪物总量{lagTip}{pendingTip}{earnedTip}', {
      kills: cover.kills, total: cover.total, ratePct: cover.ratePct,
      lagTip: cover.lag > 0 ? t(' · 借给落后队友的 {total} 资金还有 {mult} 倍风险溢价', { total: cover.lag, mult: cover.lagPremium }) : '',
      pendingTip: cover.pending > 0 ? t(' · 待结 {pending} 资金利息', { pending: cover.pending }) : '',
      earnedTip: cover.earned > 0 ? t(' · 本局已领 {earned} 资金利息', { earned: cover.earned }) : '',
    })}>${t('兜底')} <b class="num">${cover.ratePct}%</b>${cover.lag > 0 ? html` <i class="borrow__premium">${t('溢价 ×{mult}', { mult: cover.lagPremium })}</i>` : null}${cover.pending > 0 ? html` <i class="borrow__accrued">${t('待结 +{pending}', { pending: cover.pending })}</i>` : null}${cover.earned > 0 ? html` <i class="borrow__accrued">${t('已领 +{earned}', { earned: cover.earned })}</i>` : null}</span>` : null}
    ${owe ? html`<button type="button" class=${cx('borrow__act', editable && econ.funds > 0 && 'is-live')}
      disabled=${!editable || econ.funds <= 0}
      title=${t('用你手上的钱按欠款顺序归还（现在欠 {n}，手上有 {funds}）', { n: owe.total, funds: econ.funds })}
      onClick=${() => actions.econRepay(null)}>${t('还钱')}<b class="num">${owe.total}</b></button>` : null}
    ${due ? html`<button type="button" class=${cx('borrow__act', editable && 'is-live')} disabled=${!editable}
      title=${t('提醒还欠你钱的人（每人每回合限一次）')}
      onClick=${() => (due.list || []).forEach((d) => actions.econNudge(d.playerId))}>${t('催钱')}<b class="num">${due.total}</b></button>` : null}
    ${econ.requestIn ? html`<span class="borrow__req is-in">
      <span><b>${econ.requestIn.fromName}</b> ${t('请求')} <b class="num">${econ.requestIn.amount}</b>${econ.requestIn.phrase ? html` <i class="borrow__phrase">「${t(econ.requestIn.phrase)}」</i>` : null}</span>
      <button type="button" class="borrow__btn is-ok" disabled=${!editable} title=${editable ? t('同意并支付') : t('取消就绪后才能操作')}
        onClick=${() => actions.econRespond(econ.requestIn.id, true)}>${t('同意')}</button>
      <button type="button" class="borrow__btn" disabled=${!editable} onClick=${() => actions.econRespond(econ.requestIn.id, false)}>${t('拒绝')}</button>
    </span>` : econ.requestOut ? html`<span class="borrow__req is-out">
      <span>${econ.requestOut.toName ? html`${t('已向')} <b>${econ.requestOut.toName}</b> ` : t('已向全体')} ${t('请求')} <b class="num">${econ.requestOut.amount}</b>${econ.requestOut.phrase ? html` <i class="borrow__phrase">「${t(econ.requestOut.phrase)}」</i>` : null}</span>
    </span>` : html`<span class="borrow__ask">
      <button type="button" class=${cx('borrow__plate', canAsk && 'is-live')}
        disabled=${!canAsk}
        aria-label=${t('目前费用 {funds}，点击向队友借钱', { funds: econ.funds })}
        title=${!editable ? t('休整期才能借钱') : econ.requestLeft <= 0 ? t('本回合的借钱次数已用完') : econ.partners.length === 0 ? t('队友本回合都已拒绝过你：等下一回合再试') : t('目前费用 {funds} · 点击向全体队友借 {amount} 块（本回合还可发起 {requestLeft} 次）{debtTip}', { funds: econ.funds, amount, requestLeft: econ.requestLeft, debtTip })}
        onPointerDown=${hold.onPointerDown} onPointerUp=${hold.onPointerUp}
        onPointerLeave=${hold.onPointerLeave} onPointerCancel=${hold.onPointerCancel}
        onClick=${(e) => { if (heldClick(e)) return; actions.econRequest(null, amount); }}>
        <${FundsIcon} />
        <b class="num borrow__num">${econ.funds}</b>
        <span class="borrow__label">${t('借钱')}</span>
      </button>
    </span>`}
  </div>`;
}
