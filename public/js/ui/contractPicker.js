// ui/contractPicker.js — 危机合约 (Crisis Contract; shared/contracts.js, the room's room.setContracts).
//
// The room screen (screens/room.js) shows the entry in the difficulty pill once the room's difficulty allows contracts
// (`contractsAllowedAt` — 绝境 / 终极 only, CONTRACT_MIN_DIFFICULTY); a room below that has none, as the server clears its
// list there. The host opens the picker and sends the selection on 确认 (room.setContracts); everybody else opens the
// same picker read-only — the picks shown, not chosen, like 选择模拟协议 and ⚙ 同盟设置. Cancel / close sends nothing.
//
// The data is the shared table itself (CONTRACTS / contractSets), not a copy: the names, points, one-line descriptions
// and the rule fields (requires / requiresAny / excludes / minPlayers / minDifficulty / benefit) the tiles read are the
// ones the server judges with, so a contract added to shared/contracts.js appears here with no client change. Text that
// is UI chrome goes through t() (docs/I18N.md); a contract's own name and description are data, shown as written.
//
// Tiles: a contract whose blockers (players / difficulty / a group already full / support budget / a missing
// prerequisite) are not met is disabled with the reason (contractBlockers); ticking its prerequisite enables it. The
// selection the server stores is the resolved one (resolvePicked: excludes drop what conflicts), so ticking is one click
// per contract, not per rule. The strip of picks (ContractChips) reads room.state.contracts alone — no local cache, so it
// follows the server clearing a selection (difficulty dropped, a player left).
// Texts go through t() (docs/I18N.md).

import { useMemo, useState } from '../../vendor/hooks.module.js';
import { html, Button, Icon, Modal } from './components.js';
import { DIFFICULTY_NAMES } from '../../../shared/constants.js';
import {
  CONTRACTS, contractBlockers, contractById, contractName, contractPoints, contractsAllowedAt, exclusivityMap, resolvePicked,
} from '../../../shared/contracts.js';
import { contractSets, setProgress } from '../../../shared/contractSets.js';
import { t } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/** The room's player count as the server counts it (server/lobby.js `takenSeats`): every taken seat, bots included,
 * spectators not. */
export function roomPlayers(room) {
  const seats = Array.isArray(room?.seats) ? room.seats : [];
  return seats.filter(Boolean).length;
}

/**
 * The pill's 危机合约 entry (room.state.difficulty + room.state.contracts): null unless the room's difficulty allows
 * contracts (绝境 / 终极), otherwise whether this player may pick — the host, before the match; everybody else reads.
 * @param {any} room room.state payload
 * @param {any} myId
 * @returns {{ editable: boolean } | null}
 */
export function contractsOption(room, myId) {
  if (!room || room.inMatch || !contractsAllowedAt(room.difficulty)) return null;
  return { editable: room.hostId != null && room.hostId === myId };
}

/**
 * One tick: an untick removes the id; a tick adds it and lets `resolvePicked` settle the exclusivity / prerequisite /
 * group rules (the same function the server runs, so the screen shows what the room will keep).
 * @param {readonly string[]} picked
 * @param {string} id
 * @param {number} players
 * @param {string|null} difficulty
 * @returns {string[]}
 */
export function toggleContract(picked, id, players, difficulty) {
  const list = Array.isArray(picked) ? picked : [];
  if (list.includes(id)) return list.filter((x) => x !== id);
  return resolvePicked([...list, id], players, difficulty, { add: id });
}

/**
 * Why a tile is disabled — or what ticking it would drop — as a line of text (`contractBlockers`' kinds; the first is
 * what the host can act on, the same order the server's refusal names). '' for an unknown kind.
 * @param {{ kind: string, need?: any } | null | undefined} blocker
 * @returns {string}
 */
export function blockerText(blocker) {
  if (!blocker) return '';
  const names = (ids) => (Array.isArray(ids) ? ids : [ids]).map(contractName).join('、');
  switch (blocker.kind) {
    case 'players': return t('需要 {n} 名玩家', { n: blocker.need });
    case 'difficulty': return t('需要难度 {name} 或更高', { name: DIFFICULTY_NAMES[blocker.need] ? t(DIFFICULTY_NAMES[blocker.need]) : String(blocker.need) });
    case 'professionLimit': return t('同组最多 {n} 条', { n: blocker.need });
    case 'benefitLimit': return t('后援名额已满');
    case 'score': return t('需要 {n} 点已选点数', { n: blocker.need });
    case 'supportConflict': return t('与已选的后援合约冲突');
    case 'requires': return t('前置：{names}', { names: names(blocker.need) });
    case 'requiresAny': return t('前置（任选其一）：{names}', { names: names(blocker.need) });
    case 'excludes': return t('会取消：{names}', { names: names(blocker.need) });
    default: return t('当前不可选');
  }
}

/**
 * One contract tile: its name (and English name), points, one-line description, and — when it cannot be ticked — why;
 * a tickable tile names the picked contracts it would drop (exclusivityMap's symmetric view, as resolvePicked drops them).
 */
function ContractTile({ contract, picked, players, difficulty, editable, busy, onToggle, excludes }) {
  const on = picked.includes(contract.id);
  const blockers = contractBlockers(contract, players, difficulty, picked);
  const blocked = !on && blockers.length > 0;
  const why = blocked ? blockerText(blockers[0]) : null;
  const conflicts = on ? [] : excludes.filter((id) => picked.includes(id));
  return html`<button type="button" class=${cx('cpick__tile', on && 'is-on', blocked && 'is-blocked', !editable && 'is-ro')}
      data-contract=${contract.id} aria-pressed=${on ? 'true' : 'false'}
      disabled=${!editable || !!busy || blocked} onClick=${() => onToggle(contract.id)}>
    <span class="cpick__name">${contract.name}<span class="cpick__en">${contract.nameEn}</span><span class="cpick__pts num">+${contract.points}</span></span>
    <span class="cpick__desc">${contract.desc}</span>
    ${why ? html`<span class="cpick__hint cpick__hint--warn">${why}</span>` : null}
    ${conflicts.length ? html`<span class="cpick__hint">${blockerText({ kind: 'excludes', need: conflicts })}</span>` : null}
  </button>`;
}

/**
 * The picker (see the header).
 * @param {{ room: any, editable?: boolean, busy?: boolean, onConfirm: (ids: string[]) => void, onClose: () => void }} props
 */
export function ContractPicker({ room, editable = true, busy = false, onConfirm, onClose }) {
  const players = roomPlayers(room);
  const difficulty = room?.difficulty || null;
  const [picked, setPicked] = useState(() => (Array.isArray(room?.contracts) ? room.contracts.slice() : []));
  const sets = useMemo(() => contractSets(CONTRACTS), []);
  const excl = useMemo(() => exclusivityMap(), []);
  const total = useMemo(() => contractPoints(picked, difficulty, players), [picked, difficulty, players]);
  const toggle = (id) => { if (editable && !busy) setPicked((cur) => toggleContract(cur, id, players, difficulty)); };
  return html`<${Modal} open=${true} onClose=${onClose} class="cpick" micro="CRISIS CONTRACT" title=${t('危机合约')}
      width="min(9.6rem, 96vw)"
      actions=${editable
        ? html`<${Button} variant="ghost" data-testid="contracts-cancel" onClick=${onClose}>${t('取消')}<//>
            <${Button} loading=${busy} data-testid="contracts-confirm" onClick=${() => onConfirm(picked)}>${t('确认')}<//>`
        : html`<${Button} variant="ghost" data-testid="contracts-close" onClick=${onClose}>${t('关闭')}<//>`}>
    <p class="cpick__lead">${editable
      ? t('勾选本局的危机合约，确认后其他博士需要重新准备就绪。')
      : t('本局的危机合约由创建者选择。')}</p>
    <div class="cpick__total" data-testid="contracts-total">
      <${Icon} name="snow" /><span>${t('合约点数')}</span><b class="num">${total}</b>
      <span class="cpick__picked">${t('已选 {n} 条', { n: picked.length })}</span>
    </div>
    <div class="cpick__sets" data-testid="contract-picker">
      ${sets.map((set) => {
        const progress = setProgress(set, picked);
        return html`<section key=${set.id} class="cpick__set" data-set=${set.id}>
          <h3 class="cpick__sethead">${set.name}<span class="cpick__en">${set.nameEn}</span>
            <span class="num cpick__setnum">${progress.count}/${progress.total}</span></h3>
          <div class="cpick__grid">
            ${set.contracts.map((c) => html`<${ContractTile} key=${c.id} contract=${c} picked=${picked} players=${players}
              difficulty=${difficulty} editable=${editable} busy=${busy} onToggle=${toggle} excludes=${excl.get(c.id) || []} />`)}
          </div>
        </section>`;
      })}
    </div>
  <//>`;
}

/**
 * The room's picked contracts as a strip above the footer (room.state.contracts; empty → nothing, so a room without
 * contracts looks as before).
 */
export function ContractChips({ room }) {
  const ids = Array.isArray(room?.contracts) ? room.contracts : [];
  if (!ids.length) return null;
  const total = contractPoints(ids, room.difficulty, roomPlayers(room));
  return html`<section class="rs-ctrs" data-testid="room-contracts-chips" aria-label=${t('危机合约')}>
    <span class="rs-ctrs__label"><${Icon} name="snow" />${t('危机合约')}</span>
    ${ids.map((id) => html`<span key=${id} class="rs-ctrs__chip">${contractName(id)}<b class="num">+${contractById(id)?.points ?? 0}</b></span>`)}
    <span class="rs-ctrs__total num">${t('合约点数 {n}', { n: total })}</span>
  </section>`;
}
