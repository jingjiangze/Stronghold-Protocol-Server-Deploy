// 战斗中实时部署 (方案 A, spec.flags.liveDeploy) — the deploy strip of the own field.
//
// The battle starts with the player's operators HELD off the field (server/sim/battle/lifecycle.js skips the opening
// deployment under liveDeploy). This strip lists them: tap a chip to arm it, then tap a field tile — the order goes to
// the browser's own authoritative Battle (battle/runner.js liveDeploy → Battle.deployLive) and to the server, which
// records it in spec.cmds for a takeover replay and answers m.deploy. A standing operator shows a × chip: g.retreat
// withdraws it, its redeploy timer (base.respawnTime) arms, and NO DP is refunded — the next deployment costs
// base.cost again, with no penalty multiplier (方案 A's rule set).
//
// The DP figure itself is NOT duplicated here: the combat HUD's DpCounter (ui/hud.js, fed by the battle snapshot) is
// the one DP display; a chip carries the piece's cost so the player can read affordability at a glance.

import { html } from './components.js';
import { ERR_TEXT } from '../../../shared/constants.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * Toast text of a refused deployment. The engine's reasons (server/sim/battle/deploy.js deployLive / retreatLive) are
 * stable strings; the ERR codes a refused intent carries (intents.js: WRONG_PHASE / ELIMINATED / BAD_TARGET) fall back
 * to the shared ERR_TEXT table.
 * @param {string} reason
 * @returns {string}
 */
export function deployErrorText(reason) {
  const r = typeof reason === 'string' ? reason : '';
  if (Object.hasOwn(ERR_TEXT, r)) return t(ERR_TEXT[r]);
  switch (r) {
    case 'dp': return t('费用不足，无法部署');
    case 'tile': return t('无法部署在该位置');
    case 'occupied': return t('该位置已有单位');
    case 'down': return t('该位置有倒地干员，无法部署');
    case 'respawn': return t('再部署冷却中');
    case 'deployed': return t('该干员已在场上');
    case 'notdeployed': return t('该干员不在场上');
    case 'mode': return t('当前模式不支持实时部署');
    case 'finished': return t('作战已结束');
    case 'unknown':
    case 'player': return t('无效的目标');
    default: return t('无法部署');
  }
}

/**
 * The deploy strip: one chip per own board piece (cost + name), a × on a standing piece, and the armed highlight.
 * @param {{ pieces: Array<{ uid:number, name:string, cost:number|null, standing:boolean }>, armed: number|null,
 *           onDeploy: (uid:number)=>void, onRetreat: (uid:number)=>void }} props
 */
export function RealtimeDeployStrip({ pieces, armed = null, onDeploy = null, onRetreat = null }) {
  if (!Array.isArray(pieces) || !pieces.length) return null;
  return html`<div class="rtdeploy" role="group" aria-label=${t('实时部署')} data-testid="rt-strip">
    <span class="rtdeploy__hint">${t('部署')}</span>
    ${pieces.map((p) => html`<span key=${p.uid} class="rtdeploy__slot">
      <button type="button" class=${cx('rtdeploy__chip', p.standing && 'is-standing', armed === p.uid && 'is-armed')}
        disabled=${p.standing} data-testid="rt-chip" aria-pressed=${armed === p.uid ? 'true' : 'false'}
        title=${p.standing
          ? t('{name} 在场上', { name: p.name })
          : t('部署 {name}（{cost} 费用）：点亮后再点地图格子', { name: p.name, cost: p.cost ?? '?' })}
        onClick=${() => onDeploy?.(p.uid)}>
        <b class="rtdeploy__name">${p.name}</b><span class="rtdeploy__cost num">${p.cost ?? '?'}</span>
      </button>
      ${p.standing ? html`<button type="button" class="rtdeploy__out" data-testid="rt-retreat"
        aria-label=${t('撤退 {name}', { name: p.name })}
        title=${t('撤退 {name}（进入再部署冷却，不返还费用）', { name: p.name })} onClick=${() => onRetreat?.(p.uid)}>×</button>` : null}
    </span>`)}
  </div>`;
}
