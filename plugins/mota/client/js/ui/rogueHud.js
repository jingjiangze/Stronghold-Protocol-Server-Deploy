import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { t } from '../../../shared/i18n.js';

/**
 * 肉鸽常驻 HUD（业主 2026-11-01「完成完整肉鸽模式」）：
 * 本局已获藏品 / 当前回合词缀 / 紧急作战 / 下一回合的不期而遇与紧急作战预告。
 * 数据全在 `m.public.rogue`（服务端 views.js 组装）与 `m.private.relicCards`（player/views.js）。
 * 收起时只显示「藏品 N/3」，点开列出名称与品阶 —— 局内不再靠一闪而过的 toast 才知道规则。
 */
export function RogueHud({ rogue, relicCards, disabled = false }) {
  const [open, setOpen] = useState(false);
  const cards = Array.isArray(relicCards) ? relicCards : [];
  if (disabled || (!rogue && !cards.length)) return null;
  const affix = rogue && rogue.affix ? rogue.affix.label : '';
  // 徽章带图标（2026-11-01）：警告=紧急作战、骰子=不期而遇、沙漏=回合预告
  const badges = [];
  if (rogue && rogue.emergency === true) badges.push({ icon: 'warn', text: t('紧急作战') });
  if (rogue && Number.isInteger(rogue.nextEventRound)) badges.push({ icon: 'dice', text: t('下次不期而遇 R{r}', { r: rogue.nextEventRound }) });
  if (rogue && Number.isInteger(rogue.nextEmergencyRound)) badges.push({ icon: 'hourglass', text: t('下次紧急作战 R{r}', { r: rogue.nextEmergencyRound }) });
  return html`<div class="rogue-hud" data-testid="rogue-hud"
      style="position:fixed;left:.6rem;bottom:.6rem;z-index:40;max-width:min(360px,46vw);font-size:12px;
             background:rgba(12,14,20,.82);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:.45rem .6rem;color:#e8eaf0">
    <button type="button" data-testid="rogue-hud-toggle" onClick=${() => setOpen((v) => !v)}
      style="all:unset;cursor:pointer;display:flex;gap:.5rem;align-items:center;width:100%">
      <b>${t('肉鸽')}</b>
      <span class="num">${t('藏品 {n}/{max}', { n: cards.length, max: 3 })}</span>
      ${affix ? html`<span style="opacity:.85">${t('词缀：')}${affix}</span>` : null}
      <span style="margin-left:auto;opacity:.6">${open ? '▾' : '▸'}</span>
    </button>
    ${badges.length ? html`<div data-testid="rogue-hud-badges" style="margin-top:.3rem;display:flex;flex-wrap:wrap;gap:.3rem">
      ${badges.map((b) => html`<span key=${b.text} style="padding:.05rem .35rem;border-radius:999px;background:rgba(232,178,92,.18);border:1px solid rgba(232,178,92,.4);display:inline-flex;align-items:center;gap:.25rem"><${Icon} name=${b.icon} />${b.text}</span>`)}
    </div>` : null}
    ${open ? html`<div data-testid="rogue-hud-list" style="margin-top:.35rem;border-top:1px solid rgba(255,255,255,.12);padding-top:.3rem">
      ${cards.length
        ? html`<ul style="margin:0;padding-left:1rem">
            ${cards.map((c) => html`<li key=${c.id} data-relic-id=${c.id} title=${c.desc || ''}
              style=${`display:flex;align-items:center;gap:.35rem;${c.kind === 'negative' ? 'color:#e28a6a' : ''}`}>
              ${c.icon ? html`<img src=${c.icon} alt="" width="20" height="20" loading="lazy"
                style="border-radius:4px;background:rgba(255,255,255,.08);object-fit:contain" />` : null}
              ${c.name}${c.tier ? html` <small style="opacity:.6">${c.tier}</small>` : null}
              ${c.applied === false ? html` <small data-relic-unapplied title=${t('这条藏品的效果还没接进引擎：本局只记录、不生效')}
                style="opacity:.55;border:1px solid rgba(255,255,255,.25);border-radius:4px;padding:0 .2rem">${t('未实装')}</small>` : null}
            </li>`)}
          </ul>`
        : html`<p style="margin:0;opacity:.7">${t('还没有藏品：开局与每 2 回合各有一次三选一。')}</p>`}
    </div>` : null}
  </div>`;
}
