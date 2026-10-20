// In-match intents (`g.*`, DESIGN §8.2) with uniform error handling: every request goes through
// `act()`, which plays a UI sound on success, shows the ERR_TEXT toast on failure and never throws.
// The UI never mutates state optimistically — it waits for the next m.private / m.public push.
// `net.request` is looked up at call time so the dev mock harness can stub it.

import { net } from '../net.js';
import { toast, toastError } from './toasts.js';
import { audio } from '../audio.js';
// 协同经济 / 救援的拒绝原因表（下面四张 *_DETAIL_TEXT，魔塔侧）用的是 `t()`：上游这一版里它们只写了标识符、
// 没有 import —— 这里补上唯一的导入，合并后两边的主动作都不缺。
import { t } from '../../shared/i18n.js';

const SUCCESS_SFX = {
  'g.buy': 'buy', 'g.sell': 'sell', 'g.refresh': 'refresh', 'g.freeze': 'freeze', 'g.levelUp': 'levelup',
  'g.move': 'drop', 'g.equip': 'equip', 'g.art': 'artPlace', 'g.reward': 'pick', 'g.choice': 'pick',
  'g.band': 'confirm', 'g.bandSkip': 'back', 'g.infoReady': 'ready', 'g.emote': 'emote', 'g.destroy': 'back',
  'g.unequip': 'back',
};

/**
 * 这一局的声明允不允许卸下已装备的装备（行为开关 `unequip`，DESIGN §28.43.1）。
 *
 * 客户端要知道这一格才能决定**画不画那个「卸下」按钮** —— 缺省档（`official`）下不画，于是**缺省界面逐字节不变**。
 * 写入点是 `public/js/roomMods.js`（`welcome.mods` 变化时用**那一份既有的** `mergeBehaviourDecls` + `behaviourValue`
 * 合成后调 `setUnequipAllowed`，与 `morphPairing` 走同一条路：客户端不自己实现一遍合并规则）。放在这里而不是
 * `detailPanel.js`，是因为这里同时是**发送点**（`unequip`），读数与发数不分家；也避免 UI 模块之间多一条 import。
 */
let unequipOn = false;
/** 记下这一页的有效档位（由 `roomMods.js` 从 `welcome.mods.packs[].behaviour` 合成后调用）。 */
export function setUnequipAllowed(on) { unequipOn = on === true; }
/** 当前档位（缺省 / 没声明 ⇒ `false` = 官方：装上的装备不画「卸下」）。 */
export function unequipAllowed() { return unequipOn; }

let inflight = 0;
const busyListeners = new Set();
const emitBusy = () => { for (const fn of [...busyListeners]) { try { fn(inflight); } catch { /* ignore */ } } };

/** Subscribe to the number of in-flight intents (for subtle busy indicators). */
export function onBusy(fn) { busyListeners.add(fn); return () => busyListeners.delete(fn); }

// Single-flight shop refresh (GitHub #501, single-ptilopsis): under a high RTT the shop has not answered yet while the
// player taps 刷新 again — every extra g.refresh the client sends is a paid refresh (server/match intents.js → ps.refresh).
// A tap while the previous request is still on the wire is dropped; the button dims and the R hotkey stays inert (both
// call actions.refresh) until the request settles (success or failure). This is not server-side cancellation or
// idempotency: a timed-out request may already have executed. The shop bar receives onRefreshBusy via the game screen.
let refreshPending = false;
const refreshBusyListeners = new Set();
const emitRefreshBusy = () => { for (const fn of [...refreshBusyListeners]) { try { fn(refreshPending); } catch { /* ignore */ } } };

/**
 * Subscribe to the shop refresh's in-flight state — fires once with the current state.
 * @param {(busy: boolean) => void} fn
 * @returns {() => void} unsubscribe
 */
export function onRefreshBusy(fn) { refreshBusyListeners.add(fn); try { fn(refreshPending); } catch { /* ignore */ } return () => refreshBusyListeners.delete(fn); }
/**
 * The 借钱 refusals a player can hit that the generic ERR_TEXT ('已完成该操作') does not explain (user report
 * 2026-10-08: the second ask said 已完成该操作): the server names the reason in `detail` and the toast says it.
 */
const ECON_DETAIL_TEXT = {
  pending: () => t('已有一条待答复的借钱请求：等它结束再发起下一次'),
  budget: () => t('本回合的借钱次数已用完'),
  'no target': () => t('没有可借的队友了：他们本回合都拒绝过你，或已经准备就绪'),
  'team cap': () => t('本回合全队可调拨的额度已用完'),
  amount: () => t('金额超出上限'),
};

/**
 * The 救援 refusals (DESIGN §28, 促融共竞): 业主 2026-10-12 改成「其余全体队友同意 + 共享池扣款」，所以原因表也跟着
 * 换成了投票/池子那几条；服务端在 `detail` 里报名字，toast 按它说话，而不是笼统的「已完成该操作」。
 */
const REVIVE_DETAIL_TEXT = {
  'revival-disabled': () => t('这个模式没有救援'),
  'revival-window-closed': () => t('救援窗口已经关闭'),
  'stale-round': () => t('回合已经变了：救援只能在当前结算期内发起'),
  'revival-target-ineligible': () => t('他不需要救援，或已经被救回来了'),
  'revival-not-voter': () => t('你不在这次救援的名单里'),
  'revival-already-consented': () => t('你已经同意过这次救援了'),
  'revival-pool-insufficient': () => t('共享池不够支付这次救援'),
};

/** 后勤项目升级提案的表态被拒时的说明（业主 2026-10-12：点击 = 发起提案，全队同意才升级）。 */
const PROJECT_DETAIL_TEXT = {
  'vote in progress': () => t('已经有一条升级提案在表决中'),
  'no vote': () => t('现在没有待表决的升级提案'),
  'not a voter': () => t('你不在这次表决的名单里'),
  voted: () => t('你已经表态过了'),
  stale: () => t('提案已经过期：项目等级或资金变了'),
  reserve: () => t('共享池不够支付这次升级'),
};

/** 救济被拒时的说明（服务端 `econRelief` 的 detail；原来这一串只能落到通用的 ERR_TEXT）。 */
const RELIEF_DETAIL_TEXT = {
  'relief disabled': () => t('这个模式没有救济'),
  'relief budget': () => t('你本回合领取救济的次数已用完'),
  'not the weakest': () => t('只有生命值最低、且不高于阈值的队友能领救济'),
  'team relief cap': () => t('全队本回合的救济额度已用完'),
  reserve: () => t('共享池是空的，没有可以领的资金'),
};

/** 赏金加时被拒时的说明（服务端 `econBuyTime` 的 detail）：每一条都要说清「为什么买不到」。 */
const BOUNTY_DETAIL_TEXT = {
  untimed: () => t('这一回合没有准备倒计时，买不了时间'),
  bounty: () => t('本回合的赏金加时已经买满'),
  reserve: () => t('协同资金不足，买不了这次加时'),
  'time purchase disabled': () => t('这个模式不能买时间'),
};

/**
 * Send an intent. Resolves true on `ok`, false on error (already toasted).
 * @param {string} t
 * @param {object} [fields]
 * @param {{ sfx?: string|false, quiet?: boolean, detailText?: Record<string, () => string> }} [opts]
 *   `detailText` maps the server's `err.detail` to a user-facing line (the mota 协同经济 / 救援 actions); when it does
 *   not match, the toast is the upstream ERR_TEXT one — so every caller that passes no `detailText` behaves as before.
 * @returns {Promise<boolean>}
 */
export async function act(t, fields = {}, opts = {}) {
  inflight += 1;
  emitBusy();
  try {
    await net.request(t, fields);
    const s = opts.sfx === undefined ? SUCCESS_SFX[t] : opts.sfx;
    if (s) audio.sfx(s);
    return true;
  } catch (err) {
    if (!opts.quiet) {
      const map = opts.detailText;
      const say = map && err && typeof err.detail === 'string' ? map[err.detail] : null;
      let text = null;
      if (typeof say === 'function') { try { text = say(); } catch { text = null; } }
      if (text) toast(text, 'error');
      else toastError(err);
      audio.sfx('error', { volume: 0.6 });
    }
    return false;
  } finally {
    inflight = Math.max(0, inflight - 1);
    emitBusy();
  }
}

export const actions = {
  infoReady: (setupRevision = 0) => act('g.infoReady', { setupRevision }),
  rerollSetup: (setupRevision) => act('room.rerollSetup', { setupRevision }, { sfx: 'confirm' }),
  rerollVote: (voteId, agree) => act('g.rerollVote', { voteId, agree }, { sfx: agree ? 'confirm' : 'back' }),
  cancelReroll: (voteId) => act('room.cancelReroll', { voteId }, { sfx: 'back' }),
  band: (bandId) => act('g.band', { bandId }),
  bandSkip: () => act('g.bandSkip'),
  buy: (slot) => act('g.buy', { slot }),
  // a tap while the previous g.refresh is still on the wire is dropped (GitHub #501) — see onRefreshBusy above
  refresh: () => {
    if (refreshPending) return Promise.resolve(false);
    refreshPending = true;
    emitRefreshBusy();
    return act('g.refresh').finally(() => { refreshPending = false; emitRefreshBusy(); });
  },
  freeze: () => act('g.freeze'),
  levelUp: () => act('g.levelUp'),
  sell: (uid) => act('g.sell', { uid }),
  // `dir` (UP|RIGHT|DOWN|LEFT): the direction chosen with the deploy wheel (research 09 §6.1 — g.move / g.art carry it;
  // the server defaults to RIGHT when absent)
  move: (uid, to, dir) => act('g.move', dir ? { uid, to, dir } : { uid, to }),
  // `replaceUid`: the equipped item the replace dialog picked (ui/equipReplace.js) — it is destroyed; absent ⇒ none needed
  equip: (itemUid, targetUid, replaceUid) => act('g.equip', Number.isInteger(replaceUid) ? { itemUid, targetUid, replaceUid } : { itemUid, targetUid }),
  art: (itemUid, row, col, dir) => act('g.art', dir ? { itemUid, row, col, dir } : { itemUid, row, col }),
  destroy: (uid) => act('g.destroy', { uid }),
  // 装备拆卸（行为开关 `unequip: "allow"`）：把一件已装备的装备退回手牌 / 临时整备区。缺省档下服务端回
  // `'equipped items are locked'`，而界面**根本不画**这个按钮（`unequipAllowed()`），所以它正常只在 `allow` 档出现。
  unequip: (itemUid) => act('g.unequip', { itemUid }),
  reward: (idx) => act('g.reward', { idx }),
  offer: (offer, idx, refresh = false, cardId) => act(refresh ? 'g.offerRefresh' : 'g.offer', { offerId: offer.id, pluginId: offer.pluginId, seq: offer.seq, idx, cardId }),
  choice: (idx, choiceId) => act('g.choice', choiceId === undefined ? { idx } : { idx, choiceId }),
  ready: (ready) => act('g.ready', { ready }, { sfx: ready ? 'ready' : 'back' }),
  emote: (id) => act('g.emote', { id }, { quiet: true }),
  // `playerId`: the player tapped in the team panel (a shared field shows two) — what an eliminated viewer follows
  watch: (fieldId, playerId = null) => act('g.watch', typeof playerId === 'string' && playerId ? { fieldId, playerId } : { fieldId }, { sfx: 'tab' }),
  autoplay: (on) => act('g.autoplay', { on }),
  // 战斗中观看他人布阵 (owner decision 2026-10-20): the viewer's own switch (g.watchLineup) — while it is on, the team
  // panel's 「布阵」 button offers a teammate's settled board during a battle (g.watch 'n:<id>', server relays only)
  watchLineup: (on) => act('g.watchLineup', { on }),
  // solo battles only (ui/matchStatus.js pauseAvailable): m.public.paused follows
  pause: (on) => act('g.pause', { on: !!on }, { sfx: on ? 'click' : 'confirm' }),
  // 协同经济 (DESIGN §27): the server refuses these unless it advertised m.public.econ — the shop bar only renders the
  // strip then, so they are never sent blind
  // `to = null` ⇒ 广播（问遍其余队友）；给了 id ⇒ v1 的指定队友（借还牌的队友选择器）。
  econRequest: (to, amount) => act('g.econ.request', to == null ? { amount } : { to, amount }, { sfx: 'click', detailText: ECON_DETAIL_TEXT }),
  econRespond: (id, approve) => act('g.econ.respond', { id, approve }, { sfx: approve ? 'confirm' : 'back', detailText: ECON_DETAIL_TEXT }),
  // 后勤项目：点击 = 发起提案（不再直接扣款）；随后 `g.econ.vote` 表态，全票同意才升级（业主 2026-10-12）。
  econProject: (project) => act('g.econ.project', { project }, { sfx: 'confirm', detailText: PROJECT_DETAIL_TEXT }),
  econVote: (id, approve) => act('g.econ.vote', { id, approve }, { sfx: approve ? 'confirm' : 'back', detailText: PROJECT_DETAIL_TEXT }),
  // 救援 (DESIGN §28, 促融共竞): the settle window's rescue — 其余全体存活队友同意后从共享池扣款；服务端拥有全部规则
  // （谁能救、花多少、哪一回合），这里只报目标与本次点击所属的回合。
  revive: (playerId, round) => act('g.revive', { playerId, round }, { sfx: 'confirm', detailText: REVIVE_DETAIL_TEXT }),
  // 救济 (DESIGN §27): take one fund out of the team reserve. No arguments — the server decides who may take, and it
  // refuses anyone but the (tied) weakest teammate at or below the threshold.
  econRelief: () => act('g.econ.relief', {}, { sfx: 'confirm', detailText: RELIEF_DETAIL_TEXT }),
  // 赏金加时 (2026-10-18): 休整期用协同资金给全队买准备时间。秒数/价格由服务端决定（本回合已买次数递增）。
  econBounty: () => act('g.econ.bounty', {}, { sfx: 'confirm', detailText: BOUNTY_DETAIL_TEXT }),
  // 还钱 / 催钱 (2026-10-17): 债务不再是下回合自动扣，借款人点还、债权人点催。
  econRepay: (to = null) => act('g.econ.repay', to ? { to } : {}, { sfx: 'confirm', detailText: ECON_DETAIL_TEXT }),
  econNudge: (to) => act('g.econ.nudge', { to }, { sfx: 'click', detailText: ECON_DETAIL_TEXT }),
  // room-level intent (NOT g.*): the host frees a spectator seat while the match runs — the server takes room.removeSpectator at
  // any time (server/lobby.js removeSpectator), the game screen had no entry for it (ui/hud.js SpectatorPill; GitHub #120)
  removeSpectator: (playerId) => act('room.removeSpectator', { playerId }, { sfx: 'back' }),
};
