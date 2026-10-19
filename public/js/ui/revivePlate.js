// 救援 / 众筹 plate (促融共竞, DESIGN §29)：结算窗口里的那个面板。
//
// 队友的目标生命值耗尽后会被扣在 0，直到结算期结束；其余**全体存活队友同意**才救回来，钱从共享池按人头扣
// （每人 5 / 10 / 15…，救得越多下一次越贵）。AI 席位默认同意（服务端代发），人类通常只需要按一下。
//
// 2026-10-17 重做：分两行显示「每人多少 / 合计多少 / 池里够不够」，加进度条与还差人数，把我自己的角色
// （被救援 / 已同意 / 待同意 / 旁观）分开写，不再是挤成一行的长句。
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * @param {{ revival: any, myId: string, onRevive: (playerId: string) => void }} props
 */
export function RevivePlate({ revival, myId, onRevive }) {
  if (!revival || !revival.open || !Array.isArray(revival.targets) || !revival.targets.length) return null;
  const costPer = Number(revival.costPer) || 0;
  const costNext = Number(revival.costNext) || costPer;
  const pool = Number(revival.pool) || 0;
  const revives = Number(revival.revives) || 0;
  const iAmDown = revival.targets.some((tg) => tg.playerId === myId);

  return html`<div class=${cx('revive', iAmDown && 'is-downed')} role="status" aria-live="polite" data-testid="revive-plate">
    <div class="revive__head">
      <span class="revive__title">${t('救援')}<i class="revive__micro">CROWDFUND</i></span>
      <span class="revive__pool" title=${t('协同资金余额：救援费用从这里按人头扣')}>
        ${t('协同资金')}<b class="num">${pool}</b>
      </span>
    </div>

    <ul class="revive__list">
      ${revival.targets.map((tg) => {
        const need = Array.isArray(tg.need) ? tg.need : [];
        const agreed = Array.isArray(tg.agreed) ? tg.agreed : [];
        const total = Number.isFinite(tg.total) ? tg.total : costPer * need.length;
        const left = Math.max(0, need.length - agreed.length);
        const iAmVoter = need.includes(myId);
        const iAgreed = agreed.includes(myId);
        const iAmTarget = tg.playerId === myId;
        const short = pool < total;
        const pct = need.length ? Math.round((agreed.length / need.length) * 100) : 0;
        return html`<li key=${tg.playerId} class=${cx('revive__row', iAmTarget && 'is-target', short && 'is-short')}>
          <div class="revive__who">
            <b class="revive__name">${tg.name}</b>
            ${iAmTarget ? html`<span class="revive__tag">${t('你')}</span>` : null}
            <span class="revive__cost">${t('每人 {per} · 合计 {total}', { per: costPer, total })}</span>
          </div>
          <div class="revive__meter" role="progressbar" aria-valuemin="0" aria-valuemax=${need.length || 1}
            aria-valuenow=${agreed.length} aria-label=${t('救援同意进度')}>
            <span class="revive__fill" style=${`width:${pct}%`}></span>
          </div>
          <div class="revive__foot">
            <span class="revive__count">${t('同意 {n}/{total}', { n: agreed.length, total: need.length })}</span>
            ${short
              ? html`<span class="revive__warn">${t('协同资金不足（还差 {n}）', { n: Math.max(0, total - pool) })}</span>`
              : iAmTarget
                ? html`<span class="revive__wait">${t('等待队友同意')}</span>`
                : iAmVoter && !iAgreed
                  ? html`<button type="button" class="revive__btn is-live" data-testid="revive-agree"
                      title=${t('同意从协同资金出钱把 {name} 救回来（还差 {left} 人）', { name: tg.name, left })}
                      onClick=${() => onRevive(tg.playerId)}>${t('同意救援')}</button>`
                  : html`<span class="revive__wait">${iAgreed ? t('已同意 · 还差 {left} 人', { left }) : t('等待队友同意')}</span>`}
          </div>
        </li>`;
      })}
    </ul>

    <div class="revive__note">${iAmDown
      ? t('你的目标生命值耗尽，等待全体队友同意救援（AI 队友默认同意）')
      : t('其余全体存活队友同意才会救援；费用按人头从协同资金扣，救得越多下一次越贵（下一人 {next}）', { next: costNext })}</div>
    ${revives > 0 ? html`<div class="revive__history">${t('本局已救援 {n} 次', { n: revives })}</div>` : null}
  </div>`;
}
