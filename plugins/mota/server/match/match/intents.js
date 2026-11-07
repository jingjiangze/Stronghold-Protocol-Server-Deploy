// server/match/match/intents.js — Match methods: the g.* / b.* intent router (_handle: the prep intents go to
// PlayerState, the drafts, watching, the pause and the battle reports to the match), emotes, AI 托管 (setAutoplay,
// kickBot) and g.unitStats (the stats the board's units start their next battle with: a preview battle, started, read
// and dropped).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { unitStatsEntry } from '../../../shared/protocol.js';
import { PHASE, ERR, EMOTES, EMOTE_COOLDOWN_MS, GEO } from '../../../shared/constants.js';
import { deriveSeed } from '../../sim/rng.js';
import { OK, fail } from './common.js';
import { onHumanEmote } from '../botEmotes.js';
// 怪物卡池（2026-11-03）：攻方的怪物商店（买卡进投放草稿 / 刷新 / 冻结 / 撤回草稿）
import { buyMonster, rollMonsterShop, freezeMonster, dropMonster, placeMonster, upgradeMonsterShop, monsterShopFrame, pushMonsterShops } from '../monsterShop.js';

export class MatchIntents {
  _handle(ps, msg) {
    switch (msg.t) {
      // 对抗模式（2V2 / 4V4）：狩猎期目标 / 布阵 / 悬赏提取、事件期选择
      case 'g.confrontTarget': return this.submitConfrontTarget(ps, msg);
      case 'g.confront': return this.submitConfront(ps, msg);
      // 怪物卡池（2026-11-03）：怪物商店 —— index 是格子下标（缺省/非整数 ⇒ BAD_TARGET）
      case 'g.monsterBuy': return this.monsterShopReply(ps, buyMonster(this, ps, Number(msg.index)));
      case 'g.monsterRefresh': return this.monsterShopReply(ps, rollMonsterShop(this, ps));
      case 'g.monsterFreeze': return this.monsterShopReply(ps, freezeMonster(this, ps, Number(msg.index)));
      // 撤回一张投放草稿（复验修复 1.4）：id = 草稿条目的稳定 id（优先，多端撤回按它定位）；
      // 没给 id 才用 index（老客户端回落），库存退回本队的池
      case 'g.monsterDrop': return this.monsterShopReply(ps, dropMonster(this, ps, msg.index == null ? null : Number(msg.index), msg.id == null ? null : Number(msg.id)));
      // 点卡即投放（业主 2026-11-04）：卡直接投到上/下出怪口，count 可选（缺省 1）；用掉后该格自动补位
      case 'g.monsterPlace': return this.monsterShopReply(ps, placeMonster(this, ps, Number(msg.index), msg.gate, msg.count == null ? 1 : Number(msg.count)));
      // 升级怪物卡池（业主 2026-11-04「参考卫戍协议干员商店」）：无字段；等级挂 Match、跨回合持久，
      // 满级回 MAX_LEVEL，扣款全有或全无。回包走 monsterShopReply（本席 + 同队各推一帧新的 level/upgradePrice）。
      case 'g.monsterLevelUp': return this.monsterShopReply(ps, upgradeMonsterShop(this, ps));
      case 'g.hex': return this.hexPick(ps, msg.hexId);
      case 'g.hexReroll': return this.hexReroll(ps, msg.slot);
      case 'g.meltOpen': return this.meltdownRequest(ps);
      case 'g.meltPick': return this.meltPick(ps, msg.slot);
      case 'g.meltBuy': return this.meltBuy(ps, msg.itemId);
      case 'g.meltBuyRelic': return this.meltBuyRelic(ps, msg.relicId);
      case 'g.relicPick': return this.relicPick(ps, msg.relicId);
      case 'g.roguePick':
        // 肉鸽的不期而遇由独立插件 `rogue` 提供（code.matchMixin）；插件停用时这条意图直接拒绝，不崩。
        if (typeof this.roguePick !== 'function') return fail(ERR.BAD_TARGET, 'no rogue plugin');
        return this.roguePick(ps, msg.choiceId);
      case 'g.rogueNode': {
        // 肉鸽节点三选一（2026-11-04）：rogue-core 插件的 mixin 提供；插件停用时直接拒绝，不崩。
        if (typeof this.rogueNodePick !== 'function') return fail(ERR.BAD_TARGET, 'no rogue plugin');
        const res = this.rogueNodePick(ps, msg.nodeId);
        if (res && res.error) return fail(ERR.BAD_TARGET, 'bad rogue node');
        return OK;
      }
      case 'g.meltClose': return this.meltClose(ps);
      case 'g.confront.withdraw': return this.withdrawBounty(ps, msg);
      case 'g.event.pick': return this.pickEvent(ps, msg.target);
      case 'g.infoReady':
        if (this.phase !== PHASE.INFO_CHECK) return fail(ERR.WRONG_PHASE);
        if (this.setupVote) return fail(ERR.WRONG_PHASE, 'setup reroll vote in progress');
        if ((msg.setupRevision ?? 0) !== this.setupRevision) return fail(ERR.BAD_TARGET, 'setup changed; confirm the current revision');
        if (!ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
        return OK;
      case 'g.rerollVote': return this.voteSetupReroll(ps, msg.voteId, msg.agree);
      case 'g.band': return this.pickBand(ps, msg.bandId);
      case 'g.bandSkip': return this.skipBand(ps);
      // the strategy highlighted in the draft screen (what a timed-out turn takes, timeoutBand)
      case 'g.bandFocus': return this.bandFocus(ps, msg.bandId ?? null);
      case 'g.buy': return ps.buy(msg.slot);
      case 'g.refresh': return ps.refresh();
      case 'g.freeze': return ps.freeze();
      case 'g.levelUp': return ps.levelUp();
      case 'g.sell': return ps.sell(msg.uid);
      // dir: the deploy wheel's facing (DESIGN §3; absent ⇒ PlayerState reads to.dir, then RIGHT)
      case 'g.move': return ps.move(msg.uid, msg.to, msg.dir);
      case 'g.equip': return ps.equip(msg.itemUid, msg.targetUid, msg.replaceUid ?? null);
      case 'g.art': return ps.useArt(msg.itemUid, msg.row, msg.col, msg.dir);
      case 'g.destroy': return ps.destroy(msg.uid);
      case 'g.unequip': return ps.unequip(msg.itemUid);
      case 'g.reward': return ps.pickReward(msg.idx);
      case 'g.choice': {
        const res = msg.choiceId !== undefined
          ? this.pickPersonalChoice(ps, msg.idx, msg.choiceId)
          : this.pickCard(ps, msg.idx);
        // rule 藏品：choiceFunds（笞心魔宝宝）「选择决策时资金额外 +8」——只在选择成功时发
        if (res && res.error === undefined && typeof this.applyRelicChoiceFunds === 'function') {
          try { this.applyRelicChoiceFunds(ps); } catch { /* noop */ }
        }
        return res;
      }
      case 'g.ready': {
        const ready = ps.setReady(!!msg.ready);
        // 协同经济 (DESIGN §28): a human readying up withdraws its own pending requests (the ready gate)
        if (this.teamEcon && ps.ready && !ps.isBot) this.econCloseAllFrom(ps.playerId, 'ready');
        return ready;
      }
      // 协同经济 (DESIGN §28/§29; a client only sends these after m.public.econ told it the rule set is on)
      case 'g.econ.request': return this.econRequest(ps, msg.to, msg.amount);
      case 'g.econ.respond': return this.econRespond(ps, msg.id, msg.approve);
      case 'g.econ.project': return this.econBuyProject(ps, msg.project);
      // 后勤项目升级表态 (user decision 2026-10-12): approve/reject the pending proposal — see MatchEconomy.econVote
      case 'g.econ.vote': return this.econVote(ps, msg.id, msg.approve);
      // 救援 (DESIGN §29, 促融共竞): the settle window's rescue — see MatchRevival.reviveConsent
      case 'g.revive': return this.reviveConsent(ps, msg.playerId, { round: msg.round });
      // 主动存入（业主 2026-10-30）：把本回合 1 点资金放进团队储备，每人每回合最多 1 次
      case 'g.econ.deposit': return this.econDeposit(ps);
      // 救济 (DESIGN §28): the weakest teammate takes one fund out of the reserve — see MatchEconomy.econRelief
      case 'g.econ.relief': return this.econRelief(ps);
      // 赏金加时 (业主 2026-10-18): 花钱买时间 —— see MatchEconomy.econBuyTime
      case 'g.econ.bounty': return this.econBuyTime(ps);
      case 'g.econ.repay': return this.econRepay(ps, { to: msg.to ?? null });
      case 'g.econ.nudge': return this.econNudge(ps, msg.to);
      // a plugin interaction window (PLUGIN API v2, docs/PLUGINS.md §10b): the window's own id, not a draft card —
      // the host applies the declared primitive, a plugin never reaches the match state itself
      case 'g.offer': return this.requestOffer(ps, msg.offerId, msg.idx, msg);
      case 'g.offerRefresh': return this.requestOfferRefresh(ps, msg.offerId, msg.idx, msg);
      case 'g.emote': return this.emote(ps, msg.id);
      // playerId: the player tapped (a shared field names two) — the watch preference (item 56)
      case 'g.watch': return this.watch(ps, msg.fieldId, msg.playerId ?? null);
      case 'g.autoplay': return this.setAutoplay(ps, !!msg.on);
      case 'g.pause': return this.setPause(ps, !!msg.on);
      // the stats the board's units start their next battle with (the detail card in prep, user playtest #4 item 7)
      case 'g.unitStats': return this.unitStats(ps, msg.seq ?? null);
      // 战斗中实时部署 (方案 A): deploy / withdraw one of the player's own board pieces during COMBAT
      // (match/combat.js liveDeploy / liveRetreat)
      case 'g.deploy': return this.liveDeploy(ps, msg);
      case 'g.retreat': return this.liveRetreat(ps, msg);
      case 'g.leave': this.onLeave(ps.playerId); return OK;
      // the client could not merge an incremental m.public frame and asks for the full one again
      // (DESIGN §8.2 "incremental frame", the self-healing ask; shared/protocol.js 'g.publicFull')
      case 'g.publicFull': return this.resendPublic(ps.playerId);
      case 'g.test': return this.applyTestCommand(ps, msg);
      case 'b.progress': return this._onProgress(ps, msg);
      case 'b.result': return this._onResult(ps, msg);
      // the host's answer to a delegated bot layout rehearsal (DESIGN §14): a report, never an error — an unknown,
      // expired or foreign task is ignored (MatchRehearsal._onRehearsalResult)
      case 'b.rehearsalResult': this._onRehearsalResult(ps, msg); return OK;
      default: return fail(ERR.BAD_MSG);
    }
  }

  /**
   * 怪物商店意图的回包（2026-11-03）。失败照旧返回错误码（platform.js 会把 `{ error }` 原样回给客户端）；
   * 成功时把商店私有态推一帧 `m.monsterShop` —— 公共帧（match/views.js）刻意不带商店，客户端靠这一帧更新。
   * 推送失败不影响已经成功的操作。
   */
  monsterShopReply(ps, res) {
    if (res && res.error) return fail(res.error, res.detail);
    try { this.sendTo(ps.playerId, monsterShopFrame(this, ps)); } catch (e) { this.reportError('monster shop frame', e); }
    // 共享池同步（2026-11-04 第二轮复审修复 1）：这些意图会改共享池 / 队友也要看到的草稿态，
    // 同队其他人类必须收到新帧（自己上面已经推过，排除掉 —— 不重复推同一席）。
    try { pushMonsterShops(this, { except: ps }); } catch (e) { this.reportError('monster shop push', e); }
    // 预备区即时刷新（业主 2026-11-05）：投放 / 撤回改的是 `ps.monsterDraft.picks`，而预备区画的是
    // `m.private.nextEnemies`（views.js 的 nextEnemiesFor 攻方分支）—— 只推商店帧 pen 不会重画。
    // 标一次 private 即可：handle() 末尾的 flush() 逐席构建 privateView 并按 JSON 去重（内容没变不重发，
    // 买卡 / 刷新 / 冻结 / 升级这类不改草稿的意图因此不会多出帧），所以这一行是顺手且幂等的。
    try { this.markPrivate(ps); } catch (e) { this.reportError('monster shop private', e); }
    return OK;
  }

  emote(ps, id) {
    if (!EMOTES.includes(id)) return fail(ERR.BAD_MSG, 'unknown emote');
    const now = this.sched.now();
    if (now - ps.lastEmoteAt < EMOTE_COOLDOWN_MS) return fail(ERR.RATE);
    ps.lastEmoteAt = now;
    this.broadcast({ t: 'm.emote', playerId: ps.playerId, id });
    // an AI teammate can react to a human's emote (enabled by default: server/match/botEmotes.js, SP_BOT_EMOTES=0 silences it)
    onHumanEmote(this, ps.playerId, id);
    return OK;
  }

  setAutoplay(ps, on) {
    if (ps.autoplay === on) return OK;
    ps.autoplay = on;
    this.markPublic();
    if (on) this.kickBot(ps);
    return OK;
  }

  /** Let the bot act for a (newly) bot-controlled seat in the current phase. */
  kickBot(ps) {
    if (!ps.botControlled || this.ended) return;
    this.offersChanged();
    if (this.phase === PHASE.INFO_CHECK && !ps.infoReady) { ps.infoReady = true; this.markPublic(); this.maybeEndInfo(); }
    else if (this.phase === PHASE.BAND_DRAFT && this.draftTurn() === ps.playerId) this.scheduleBandBot();
    else if (this.phase === PHASE.SP_DRAFT && this.spTurn() === ps.playerId) this.scheduleSpBot();
    else if (this.phase === PHASE.PREP && ps.alive && !ps.ready) this.scheduleBotPrep(ps, 0);
  }

  /**
   * g.unitStats { seq? } (user playtest #4 item 7: the detail card showed fixed record stats): the stats every unit of
   * the player's board will fight with at the start of its next battle — equipment, bonds and their layers, 特质, the
   * band and 机变 effects — computed exactly by the shared sim. The player's battle input after the onBattleStart meta
   * handlers (`ev.preview: true`, no enemies — those handlers must not change the match for a preview) builds a Battle
   * of the battle's options that is started (initial deployment + battleStart hooks), read and dropped: it is never
   * stepped: deployment skills contribute their initial stats but their timers do not advance. No SP / skill timer is
   * sent, and the real battle gets fresh units. Pushed to the player as `m.unitStats { seq, round, units }`
   * (units: shared/protocol.js unitStatsEntry, board operators and summons by uid); cached per input (a build costs
   * ≈ 0.3–0.7 ms). Prep phases only (ROUND_START, 机变, PREP); a battle's live stats come from the browser's own sim.
   * @param {PlayerState} ps @param {number|null} seq echoed (the client keeps the newest answer)
   */
  unitStats(ps, seq = null) {
    if (!ps.alive) return fail(ERR.ELIMINATED);
    if (this.phase !== PHASE.ROUND_START && this.phase !== PHASE.SP_DRAFT && this.phase !== PHASE.PREP) return fail(ERR.WRONG_PHASE);
    const units = this._unitStatsOf(ps);
    this.sendTo(ps.playerId, { t: 'm.unitStats', seq: Number.isInteger(seq) ? seq : null, round: this.round, units });
    return OK;
  }

  /** The start-of-battle stats of a player's board units (see unitStats); [] when the preview battle cannot be built. */
  _unitStatsOf(ps) {
    const input = ps.battleInput({ side: 'L', colOffset: 0 });
    const ev = { input, kind: 'normal', round: this.round, preview: true };
    this.dispatch(ps, 'onBattleStart', ev);
    const players = [ev.input && typeof ev.input === 'object' ? ev.input : input];
    let key = null;
    try { key = JSON.stringify([this.round, this.stageId, this.battleContent, players]); } catch { key = null; }
    if (!this._unitStatsCache) this._unitStatsCache = new WeakMap(); // PlayerState → { key, units } (the last preview)
    const cached = this._unitStatsCache.get(ps);
    if (key && cached && cached.key === key) return cached.units;
    const units = [];
    // the flags of the battle it previews: a normal round gains IN_BATTLE layers from its start (a <战斗开始时> layer gain
    // raises bond stats at t = 0 there too); the Final Assault / Hidden Core fight without (previewed as a normal field)
    const bossRound = this.round === this.gd.bossRound || this.round === this.gd.hiddenRound;
    const b = this.newBattle({
      seed: deriveSeed(this.seed, `preview:${this.round}:${ps.seat}`), kind: 'normal', modeId: this.modeId, round: this.round,
      stageId: this.stageId, rect: { ...this.layout.battle.normal }, timeLimit: 60, players, spawns: [], routes: this.wave ? this.wave.routes : [],
      sharedBoss: null, flags: { layerGainsEnabled: !bossRound, ...this.dpFlags() }, fieldId: `n:${ps.playerId}`, recordEvents: false,
    });
    try {
      if (typeof b.start === 'function') b.start();
      for (const u of Array.isArray(b.allyUnits) ? b.allyUnits : []) {
        if (u && Number.isInteger(u.uid) && (u.kind === 'op' || u.kind === 'token')) units.push(unitStatsEntry(u, u.s));
      }
    } catch (e) { this.reportError('unitStats', e); }
    this._unitStatsCache.set(ps, { key, units });
    return units;
  }
}
