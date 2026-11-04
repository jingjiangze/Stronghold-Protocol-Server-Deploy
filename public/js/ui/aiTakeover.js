import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { useStore } from '../store.js';
import { net } from '../net.js';
import { toastError } from './toasts.js';
import { DEFAULT_VERSION, roomVersion } from '../versions.js';
import { t } from '../../../shared/i18n.js';

/**
 * 「潜入」= 以观战身份进到**进行中的对局**里，接管一个 AI 席位（AI 协作）。
 * 机制在 server/aiTakeover.js：观战者 `room.aiRequest` → 同房在线真人过半 `room.aiVote` → 休整期换席。
 * 这里只负责入口与投票面板。
 */
export function AiTakeoverPanel() {
  const room = useStore(s => s.room), pub = useStore(s => s.match.public), myId = useStore(s => s.me.playerId);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const autoOpened = useRef(false);
  // 潜进入口：钩子不能写在下面的早退之后，所以先算出这两个判据（room 可能还没到，用可选链）
  const spectator = !!room && room.spectators?.some(s => s.playerId === myId);
  const bots = (pub?.players || []).filter(p => p.isBot && p.alive && !p.left);
  // 以观战身份进来、且此刻有可接的 AI 席、正在休整期 ⇒ 自动展开一次面板（之后由玩家自己开关）。
  useEffect(() => {
    if (autoOpened.current || !spectator || !bots.length || pub?.phase !== 'PREP') return;
    if (room && room.aiTakeoverEnabled === true && roomVersion(room) === DEFAULT_VERSION && room.mode !== 'solo') {
      autoOpened.current = true;
      setOpen(true);
    }
  }, [spectator, bots.length, pub?.phase, room]);
  if (!room || room.aiTakeoverEnabled !== true || room.mode === 'solo' || roomVersion(room) !== DEFAULT_VERSION) return null;
  const run = async (kind, body) => { if (busy) return; setBusy(true); try { await net.request(kind, body); } catch (e) { toastError(e); } finally { setBusy(false); } };
  const requests = room.aiTakeoverVotes || [], votes = requests;
  const name = id => (pub?.players || []).find(p => p.playerId === id)?.name || id;
  return html`<button type="button" class="btn ai-participation-entry" onClick=${() => setOpen(true)}>${t('AI 协作')}${votes.length ? ` (${votes.length})` : ''}</button>
    <${Modal} open=${open} onClose=${() => setOpen(false)} title=${t('AI 协作')} width="min(800px,92vw)" actions=${html`<${Button} onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <p>${t('潜入：休整期里选中一个 AI 席位即可直接接管，不需要申请或投票。房主需先开启「AI 协作」。')}</p>
      <p>${t('申请在退出、断线、投票资格或阶段变化时取消。接替后的席位数据含 AI 此前表现，计入你的个人统计与奖励。')}</p>
      ${spectator ? html`<div class="ai-requests">${bots.map(p => html`<${Button} disabled=${busy || pub.phase !== 'PREP'} onClick=${() => run('room.aiTakeover', { botId: p.playerId })}>${t('直接接管')} P${p.seat + 1} · ${p.name}<//>`)}</div>` : null}
      ${requests.map(v => html`<div class="ai-vote"><strong>${v.applicantName} → ${name(v.botId)}</strong><span>${v.yes.filter(id => v.eligible.includes(id)).length}/${Math.floor(v.eligible.length / 2) + 1}</span>
        ${v.eligible.includes(myId) ? html`<${Button} disabled=${busy || pub?.phase !== 'PREP'} onClick=${() => run('room.aiVote', { voteId: v.id, approve: true })}>${t('同意')}<//><${Button} disabled=${busy} onClick=${() => run('room.aiVote', { voteId: v.id, approve: false })}>${t('不同意')}<//>` : null}</div>`)}
      ${!votes.length ? html`<p>${t('暂无投票')}</p>` : null}
    <//>`;
}
