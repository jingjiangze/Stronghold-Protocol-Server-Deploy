// server/match/match/views.js — Match methods: the state builders — m.public (publicView with statusOf / fieldOf, the
// fields' progress, the teammates' live pendingLp / uniteLeft, the SETTLE uniteResult), the nextEnemies preview of
// m.private and the prep scout's m.field (prepFieldMeta: board, hand and temp as units, the scouted player's effects and
// coming enemies; in a boss round's prep on the player's half of the boss field).
// Installed on Match.prototype by server/match/Match.js (a method container: never instantiated; `this` is the match).

import { PHASE, GEO, VERSUS_CONFRONT } from '../../../shared/constants.js';
import { TEST_PUBLIC_LOG } from '../../../shared/testMode.js';
import { boardOrder, pieceDir } from '../board.js';
import { bondList, offBondCounts } from '../bondsMeta.js';
import { cardView } from '../choices.js';
import { bountySpawns, previewOf, gateOf, isFlyKey } from '../waves.js';
import { timelineAt } from '../fields.js';
import { bossFieldPlacement } from '../finalAssault.js';
import { battleProgress } from '../../sim/spec.js';
// 攻方回合（2026-11-04 业主口径）：公共行的干员盟约同样置空（与 m.private 同一个判据）。
import { isAttackerRound } from '../monsterBonds.js';

/** Milliseconds since the match started. A stamp before the start, or a bad stamp, is 0. The stored log keeps the epoch. */
function auditClock(at, startedAt) {
  const stamp = Number(at);
  const start = Number(startedAt);
  if (!Number.isFinite(stamp) || !Number.isFinite(start)) return 0;
  return Math.max(0, stamp - start);
}

/** A reported capsule numerator clamped to its denominator, else null (unknown — never a fabricated 0). */
const finiteOrNull = (v, cap = Infinity) => {
  if (v == null) return null;   // Number(null) === 0: an unreported value must not read as "0 resolved"
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(Number.isFinite(cap) ? cap : Infinity, Math.trunc(n)));
};

/**
 * A scouted operator's potential (below 6) and 练度 (0.2.2), like the sim's UnitInfo: PlayerState.loadoutFor's
 * `potential` / `cultivate` (null for a stand-in or a prototype 自选 pick: neither field).
 */
function cultivationInfo(lo) {
  const out = {};
  if (lo && Number.isInteger(lo.potential) && lo.potential < 6) out.potential = lo.potential;
  if (lo && Number.isInteger(lo.cultivate)) out.cultivate = lo.cultivate;
  return out;
}

/**
 * 攻方投放草稿（`ps.monsterDraft.picks`，monsterShop.js 的 buyMonster / placeMonster 写）→ `previewOf` 的 spawn-like 列表。
 * 攻方本回合没有棋盘，`nextEnemiesFor` 既有的几条分支给不出内容（它们都是守方的波次 / 首领组），预备区因而是空的；
 * 业主 2026-11-05：攻方投放期的预备区要显示「我投放的怪」（数量 / 类型 / 门），所以由草稿自己造预览。
 * 每条 pick = 1 只（`count: 1`）—— 同 key 连投 3 只就是 3 条，客户端 `layoutPen` 按条摆、`count` 只参与稀疏化，
 * 条数即只数。`fly` / `elite` 取官方口径（waves.js 的 isFlyKey / previewInfo）：怪表里查不到就 `false`，绝不抛。
 * @param {object} gd @param {object} ps
 * @returns {Array<{ enemyKey: string, count: number, time: number, preview: object }>}
 */
function monsterDraftSpawns(gd, ps) {
  const picks = ps && ps.monsterDraft && Array.isArray(ps.monsterDraft.picks) ? ps.monsterDraft.picks : [];
  const out = [];
  for (const p of picks) {
    const key = p && typeof p.enemyKey === 'string' && p.enemyKey ? p.enemyKey : null;
    if (!key) continue;
    let fly = false;
    let rank = null;
    try {
      fly = isFlyKey(gd, key);
      const e = gd && typeof gd.enemy === 'function' ? gd.enemy(key) : null;
      rank = e && typeof e.rank === 'string' ? e.rank : null;
    } catch { fly = false; rank = null; }
    out.push({
      enemyKey: key,
      count: 1,
      time: 0,
      preview: { gate: p.gate === 'upper' ? 'upper' : 'lower', fly, elite: rank === 'ELITE', boss: false },
    });
  }
  return out;
}

export class MatchViews {
  statusOf(ps) {
    if (ps.left) return 'left';
    if (!ps.alive) return 'dead';
    switch (this.phase) {
      case PHASE.INFO_CHECK: return ps.infoReady ? 'ready' : 'deciding';
      case PHASE.BAND_DRAFT:
        if (this.draft && this.draft.picks[ps.playerId]) return 'ready';
        return this.draft && this.draftTurn() === ps.playerId ? 'deciding' : 'acting';
      case PHASE.SP_DRAFT:
        if (this.sp && this.sp.picks[ps.playerId] != null) return 'ready';
        return this.sp && this.spTurn() === ps.playerId ? 'deciding' : 'acting';
      case PHASE.PREP: return ps.ready ? 'ready' : 'acting';
      case PHASE.COMBAT: case PHASE.FINAL_ASSAULT: case PHASE.HIDDEN_CORE: {
        const f = this.fields.find((x) => x.players.includes(ps.playerId));
        return f && f.live ? 'combat' : 'done';
      }
      case PHASE.UNITE: return this.unitePlan && this.unitePlan.helpers.includes(ps) ? 'helping' : 'done';
      case PHASE.ROUND_START: return 'acting';
      default: return 'done';
    }
  }

  fieldOf(ps) {
    const f = this.fields.find((x) => x.players.includes(ps.playerId));
    return f ? f.fieldId : null;
  }

  publicView() {
    // 协同经济 (DESIGN §28/§29): m.public.econ exists only while the rule set is on (the client's capability probe)
    const econ = this.econPublicView();
    // 救援 (DESIGN §29): the settle window — null outside 促融共竞
    const revival = this.revivalView();
    const v = {
      t: 'm.public',
      phase: this.phase,
      round: this.round,
      lastRound: this.gd.lastRound,
      deadline: this.deadline,
      serverNow: this.sched.now(),
      modeId: this.modeId,
      difficulty: this.difficulty,
      // 危机合约 (shared/contracts.js): the room's selection, so the settlement / the HUD can name it. Omitted while
      // the room had none, so an ordinary match's m.public keeps its keys.
      ...(this.contracts?.length ? { contracts: this.contracts.slice() } : {}),
      stageId: this.stageId,
      // 下一回合的战场 id（客户端据此在本回合空闲时预热场景包，换图时只重建一次）
      nextStageId: this.nextStageId || this.stageId,
      // 肉鸽（完整模式，业主 2026-11-01）：本回合词缀 / 是否紧急作战 / 下回合预告 —— 客户端常驻 HUD 直接读。
      ...(this.isRogue === true ? (() => {
        const r = Number(this.round) || 1;
        const aff = typeof this.rogueRoundAffix === 'function' ? this.rogueRoundAffix(r) : null;
        const nextOf = (pred, span) => {
          for (let i = 1; i <= span; i++) { const n = r + i; if (typeof pred === 'function' && pred.call(this, n)) return n; }
          return null;
        };
        return { rogue: {
          affix: aff ? { kind: aff.kind, mul: aff.mul, label: aff.label } : null,
          emergency: typeof this.rogueEmergencyRound === 'function' ? this.rogueEmergencyRound(r) === true : false,
          nextEventRound: nextOf(this.rogueEventRound, 3),
          nextEmergencyRound: nextOf(this.rogueEmergencyRound, 5),
          // P0 节点图（2026-11-03）：rogue-core 的 mixin 提供；未安装时为 null，客户端不渲染。
          nodes: typeof this.rogueNodeState === 'function' ? this.rogueNodeState() : null,
        } };
      })() : {}),
      setupRevision: this.setupRevision,
      rerollVote: this.setupVote ? {
        id: this.setupVote.id,
        proposerId: this.setupVote.proposerId,
        voters: this.setupVote.voters.slice(),
        agreed: [...this.setupVote.agreed],
      } : null,
      factions: this.factions.slice(),
      // 对抗模式（2V2 / 4V4）：每队人数、对抗期起始回合与事件期回合表（普通房间不带这些键）
      ...(this.isVersus ? {
        teamSize: this.teamSize, contestStartRound: this.contestStartRound, eventRounds: this.eventRounds,
        // 攻防回合：本回合谁进攻/谁防守（非攻防回合 false / null）
        roleRound: typeof this.isRoleRound === 'function' ? this.isRoleRound() : false,
        attackingTeam: this.attackingTeam ?? null,
        defenderTeam: this.defenderTeam ?? null,
      } : {}),
      ...(this.isVersus && this.teamLps ? { teamLps: Object.fromEntries(this.teamLps), teamLp: this.teamLp } : {}),
      // 事件期（R4/R5/R6 起）：EventOverlay 读 pub.event —— eventView() 以前从未被合并，事件期面板永远不显示。
      ...(this.huntMode ? { event: this.eventView() } : {}),
      // 狩猎期：只带本队可见的提交（对手由 messaging 屏蔽）；名单公示用 roster.until 播动画
      // 2026-11-04：投放窗口 = 攻守回合的 PREP（选目标已结束、投放公示未开始 ⇒ confrontStage == null）。此时 this.confront
      // 还没冻结（phases.js 每回合清成 null，finishConfront 才快照），面板必须读活的 confrontSubs；COMBAT / SETTLE 才读冻结值。
      ...(this.isVersus && this.confrontActive && this.confrontActive()
        && (this.phase === PHASE.CONFRONT
          || (this.phase === PHASE.PREP && this.confrontStage == null && typeof this.isRoleRound === 'function' && this.isRoleRound())
          || (this.confront && this.confront.size)) ? (() => {
        // 投放中（CONFRONT 选目标 / PREP 投放）读活数据；其余阶段读冻结快照
        const placing = this.phase === PHASE.CONFRONT
          || (this.phase === PHASE.PREP && this.confrontStage == null && typeof this.isRoleRound === 'function' && this.isRoleRound());
        const src = placing ? (this.confrontSubs || new Map()) : (this.confront || new Map());
        const subs = {};
        for (const [pid, s2] of src) subs[pid] = s2 ? { group: s2.group, position: s2.position || null, picks: s2.picks || [], total: (s2.picks || []).length, target: s2.target || null, coins: this.confrontBountyOf(s2.picks), committed: s2.committed === true } : null;
        return {
          confront: {
            active: placing,
            stage: this.phase === PHASE.CONFRONT ? (this.confrontStage || 'target') : null,
            roster: this.phase === PHASE.CONFRONT && this.confrontStage === 'roster' ? { until: this.deadline, ms: VERSUS_CONFRONT.rosterMs } : null,
            round: this.round,
            ratio: this.confrontRatio ? this.confrontRatio() : null,
            // 2026-11-06 价值同源：面板预算 = **怪物资金账户余额**（confrontBudget 现在读 monsterFundsOf，与
            // monsterShopFrame 的 `budget` 是同一个口径；商店关着才回落到旧的回合预算公式）。
            budget: this.confrontBudget ? this.confrontBudget() : null,
            // 怪物模式（2026-11-06）：shared / solo / master —— 客户端据此在攻方只读时显示「队长操作中」。
            monsterMode: this.monsterMode || null,
            // 2026-11-01 P1（审计 D12/D13/死 UI）：规则档与同盟狩猎标记下发（客户端 conf.hunt 以前读不到）；
            // 事件期 boss 格下发（池 + 上限），客户端据此渲染选择区 —— boss 不占预算、不计只数上限
            versusRule: this.versusRule || null,
            hunt: typeof this.coopHuntActive === 'function' ? this.coopHuntActive() : false,
            bosses: {
              open: this.confrontBossOpen ? this.confrontBossOpen() : false,
              cap: this.confrontBossCap ? this.confrontBossCap() : 0,
              pool: this.confrontBossOpen && this.confrontBossOpen()
                ? (this.confrontBossPool ? this.confrontBossPool() : []).map((r) => ({ key: r.key, name: r.name, coin: r.coin }))
                : [],
            },
            // 本回合一次最多放几只：协议硬上限 maxPicks（防一次误提交塞爆消息）。注释 2026-11-06 纠偏 ——
            // 真正的约束**不是**「Σ价值 ≤ 预算」：商店开着时判据是「尚未付款的 Σ单价 ≤ 怪物资金账户余额」
            // （confrontPurchaseLimit），另有一道「池里 tier ≤ 商店等级」的卡池闸门；`maxPicks` 只管条数上限。
            maxPicks: this.confrontPlaceCap ? this.confrontPlaceCap() : VERSUS_CONFRONT.maxPicks,
            targets: this.confrontTargets ? Object.fromEntries(this.confrontTargets) : {},
            groups: (this.confrontGroups ? this.confrontGroups() : []).map((g) => ({ id: g.id, name: g.name, icon: g.icon, desc: g.desc, rows: (g.rows || []).map((r) => ({ key: r.key, name: r.name, value: r.value })) })),
            // 预设路线（攻方选路线 + 时刻；服务端按公式校验）
            routes: (this._confrontRoutes ? (this._confrontRoutes().routes || []) : []).map((r, i) => ({
              i,
              motion: String(r.motion || '').toUpperCase().startsWith('F') ? 'FLY' : 'WALK',
              start: Array.isArray(r.start) ? r.start : null,
              end: Array.isArray(r.end) ? r.end : null,
              gate: Array.isArray(r.start) ? gateOf(r.start, false) : null,
            })),
            subs,
            // 狩猎期结算后：只在战斗/结算阶段公示名单；守方休整期（PREP）不弹，避免挡住下干员与聊天/观战
            applied: (this.phase === PHASE.COMBAT || this.phase === PHASE.SETTLE) && !!this.confront && this.confront.size > 0,
          },
        };
      })() : {}),
      disabledBonds: [...new Set([...this.disabledBonds, ...this.staticInactiveBonds])].sort(),
      drawnDisabledBonds: this.disabledBonds.slice(),
      bannedChess: this.bannedChess.slice(),
      bossId: this.bossId,
      hiddenBossId: this.hiddenBossId,
      ...(econ ? { econ } : {}),
      ...(revival ? { revival } : {}),
      bossRound: this.gd.bossRound,
      hiddenRound: this.gd.hiddenRound,
      bossPairs: this.bossWaves ? this.bossWaves.map(w => w.players.slice()) : this.bossPairs ? this.bossPairs.map(ids => ids.slice()) : null,
      spRound: this.gd.spRounds().includes(this.round),
      // DESIGN §14: 'client' = battles are simulated by the browsers (b.start specs), 'server' = legacy streaming
      combatMode: this.clientCombat ? 'client' : 'server',
      // solo pause (g.pause, DESIGN §14): the battle, its field clock and every deadline are frozen while true
      paused: !!this.paused,
      players: this.order.map((ps) => this.publicPlayerView(ps)),
      fields: this.fields.map((f) => this.publicFieldView(f)),
    };
    if (this.offers.length) v.offers = this.offerViews();
    if (this.teamLp != null) v.teamLp = Math.max(0, Math.round(this.teamLp));
    // 最终攻势 / 隐秘核心: when the overtime drain starts (ms epoch; `deadline` is the level's 120 s countdown)
    if ((this.phase === PHASE.FINAL_ASSAULT || this.phase === PHASE.HIDDEN_CORE) && this.overtimeAt) v.overtimeAt = this.overtimeAt;
    if (this.bossPool) v.bossHp = { hp: Math.max(0, Math.round(this.bossPool.hp)), max: Math.round(this.bossPool.maxHp) };
    if (this.phase === PHASE.BAND_DRAFT && this.draft) {
      const d = this.draft;
      // turnSeconds: the length of a turn (the countdown gauge's total; 0 when untimed) — deadline = turnDeadline
      v.draft = {
        order: d.order.slice(), turn: this.draftTurn(), picks: { ...d.picks }, skipsLeft: { ...d.skipsLeft }, turnDeadline: d.turnDeadline || 0,
        turnSeconds: d.untimed ? 0 : this.bandTurnMs() / 1000, untimed: !!d.untimed,
      };
    }
    if (this.phase === PHASE.SP_DRAFT && this.sp) {
      const s = this.sp;
      v.sp = {
        family: s.family, name: s.name, desc: s.desc, eventId: s.eventId,
        cards: s.cards.map(c => ({ ...cardView(c), soldOut: c.kind === 'item' && !this.itemPool.canGain(c.id) })), order: s.order.slice(),
        turn: this.spTurn(), picks: { ...s.picks }, taken: { ...s.taken }, untimed: !!s.untimed,
      };
    }
    if (this.phase === PHASE.UNITE && this.unitePlan) v.unite = { helpers: this.unitePlan.helpers.map((p) => p.playerId), leakers: this.unitePlan.leakers.map((p) => p.playerId) };
    // SETTLE after a 联防: its outcome as data (settle.js uniteResultView; GitHub #235, PR #112) — { through, helpers,
    // leakers, losses: { playerId: the LP settlement charged this round } } — the client's result box reads the viewer's
    // own charge from it; absent when no 联防 resolved (the client then shows the round's own battle result)
    if (this.phase === PHASE.SETTLE && this.uniteResultView) {
      const ur = this.uniteResultView;
      v.uniteResult = { through: ur.through, helpers: ur.helpers.slice(), leakers: ur.leakers.slice(), losses: { ...ur.losses } };
    }
    // Test match (DESIGN §34.8). Omitted entirely when the flag is off, so a normal m.public stays identical.
    if (this.test === true) {
      v.test = true;
      v.testActions = this.testActions | 0;
      v.testTimers = this.testTimers !== false;
      const log = Array.isArray(this.testLog) ? this.testLog : [];
      v.testLog = log.slice(-TEST_PUBLIC_LOG).map((e) => ({
        seq: e.seq, playerId: e.playerId, cmd: e.cmd, args: e.args,
        // The stored row keeps the scheduler epoch. The dock clock is time since this match started.
        at: auditClock(e.at, this.startedAt),
        ok: e.ok === true,
        ...(e.code ? { code: e.code } : {}),
        ...(e.detail ? { detail: e.detail } : {}),
      }));
    }
    return v;
  }

  /**
   * One `m.public.players[]` row (full form). Split out of publicView so the incremental frame (matchMessaging
   * _publicFrame → server/viewsDelta.js) can diff one player at a time: the emitted objects are the same, field for
   * field, in the same order — a full frame is byte-identical to before the delta work.
   * @param {any} ps PlayerState
   */
  publicPlayerView(ps) {
    return {
      playerId: ps.playerId,
      seat: ps.seat,
      // 对抗模式（2V2 / 4V4）：每人所属阵营，队伍面板据此上色（普通房间不带这个键）。
      // 房间座位用的是 'red'/'blue'（lobby teamOfSeat 分支），这里保持一致；TEAMS 的 yellow/blue 是 20 人分队口径。
      ...(this.isVersus ? {
        team: this.teamIdOf(ps) === 0 ? 'red' : 'blue',
        // 攻防回合的角色：attack=本回合投放怪物，defend=本回合下干员防守；非攻防回合 null
        role: (typeof this.isRoleRound === 'function' && this.isRoleRound()) ? (this.isAttacker(ps) ? 'attack' : 'defend') : null,
      } : {}),
      name: ps.name,
      isBot: ps.isBot,
      connected: ps.isBot || (ps.connected && !ps.left),
      alive: ps.alive,
      // 救援 (DESIGN §29): LP spent, still rescuable this settle — the row shows 等待救援 rather than 已淘汰
      ...(this.revivalEnabled ? { pendingDeath: !!ps.pendingDeath, revivalReason: ps.revivalUnavailableReason || null } : {}),
      lp: Math.max(0, ps.lp),
      bandId: ps.bandId,
      shopLevel: ps.shop.level,
      boardCount: ps.deployCount,
      ready: this.phase === PHASE.INFO_CHECK ? ps.infoReady : ps.ready,
      // the strip of a teammate watching this player (DESIGN §20.15): every bond with members, layers or an active tier
      // (= the player's own m.private list without thresholds / countsHand — the client reads those from bonds.json),
      // this round's in-battle gains included once the COMBAT phase ended (PlayerState.bondsView); [] once eliminated —
      // nobody can watch an eliminated player (g.watch refuses them, they have no field) and the result screen reads
      // m.result's own bonds, so their layers would only cost every m.public bytes for the rest of the match
      // (the mode-off bonds with members included, `off: true`, as in m.private — bondsMeta.offBondCounts)
      // 攻方回合（2026-11-04 业主口径）：他这一回合只有怪物方盟约 ⇒ 公共行也给 []（队友 / 观战不再看到干员盟约条）。
      bonds: ps.alive && !isAttackerRound(this, ps) ? bondList(this.gd, ps.bondsView(), { off: offBondCounts(ps.gd || this.gd, ps) }) : [],
      fieldId: this.fieldOf(ps),
      status: this.statusOf(ps),
      autoplay: ps.autoplay,
      // the LP this round's own battle will cost at settlement so far (COMBAT / 联防 only, omitted when 0)
      // 干员皮肤 (docs/SKINS.md): PUBLIC 是有意的——队友正是靠它看到你的外观；为空时省略。
      ...(Object.keys(ps.skins || {}).length ? { skins: ps.skins } : {}),
      ...this._pendingLpView(ps),
    };
  }

  /** One `m.public.fields[]` row (full form; split out for the incremental frame, like publicPlayerView). @param {any} f */
  publicFieldView(f) {
    const v = { fieldId: f.fieldId, kind: f.kind, players: f.players.slice(), live: !!f.live };
    const pr = this._fieldProgress(f);
    if (pr) v.progress = pr;
    return v;
  }

  /**
   * m.public.fields[].progress: { killed, resolved, total, done } (teammates' waiting UI). `resolved` is the HUD
   * capsule's numerator — the field's own scheduled enemies knocked out or leaked (Battle.resolved / the reported
   * b.progress `resolved`); it is `null` (never 0) while unknown, so the client's `resolved ?? killed` fallback holds.
   * `total` is the capsule's denominator: only the enemies the round scheduled (runtime splits / summons — boss summons
   * included — are in neither part).
   */
  _fieldProgress(f) {
    if (!f) return null;
    if (!f.cc) {
      const b = f.battle;
      if (!b) return null;
      const total = Number(b.total) || 0;
      return { killed: Number(b.killed) || 0, resolved: finiteOrNull(b.resolved, total), total, done: !f.live };
    }
    if (f.done && f.result) {
      let killed = 0, total = 0, own = 0, ownKnown = true;
      for (const pp of Object.values(f.result.perPlayer || {})) {
        killed += Number(pp && pp.killed) || 0;
        total += Number(pp && pp.total) || 0;
        if (Number.isFinite(pp && pp.resolved)) own += Number(pp.resolved); else ownKnown = false;
      }
      // the FIELD's numerator (the validated client result / Battle.result(): what the capsule showed) — not the sum of the
      // players' own: an enemy that spawns on one half and leaks on the other (a 联防 lane, the boss pair's crossing routes)
      // is billed to one player's `total` and to the other's leak, so their own min(total, …) clamp it to 0
      let resolved = finiteOrNull(f.result.resolved, total);
      if (resolved == null && ownKnown) resolved = Math.min(total, own);
      if (f.result.synthetic) { killed = f.progress.killed; total = f.progress.total; resolved = finiteOrNull(f.progress.resolved, total); }
      return { killed, resolved, total, done: true };
    }
    if (f.mode === 'server' && f.timeline) {
      // a server-run / bot field: no authority ever sends a b.progress, so the capsule reads the battle's own counters —
      // the timeline sample carries `resolved` (Battle.resolved: knocked out + leaked among the field's own enemies),
      // never the report-driven `progress.leaks`, which would leave such a field at 0 forever
      const [, killed, total, resolved] = timelineAt(f.timeline, this._fieldElapsed(f));
      return { killed, resolved: finiteOrNull(resolved, total), total, done: false };
    }
    const total = f.progress.total;
    return { killed: f.progress.killed, resolved: finiteOrNull(f.progress.resolved, total), total, done: false };
  }

  /**
   * LP a player's own battle of this normal round will cost at settlement so far — settle()'s min(lpCapPerRound,
   * counted leaks) — for the teammates' live LP (m.public players[].pendingLp, user playtest #3 item 2; the own client
   * counts its local battle itself). COMBAT: the recorded result once every field is done, else the field's result, else
   * the authority's b.progress leaks (a server-run field reports none before its result is released); 联防: a leaker's
   * enemies still standing on the 联防 field (_uniteLeft, uncapped in `uniteLeft`, user playtest #6 item 7), anyone
   * else's own battle count (0: they were perfect). Omitted when 0 and in every other phase (boss rounds charge the
   * merged team LP live).
   * @returns {{ pendingLp?: number, uniteLeft?: number }}
   */
  _pendingLpView(ps) {
    if (!ps || !ps.alive || (this.phase !== PHASE.COMBAT && this.phase !== PHASE.UNITE)) return {};
    // 2026-11-06 与 settle() 对齐（业主报障「扣血逻辑完全混乱」的显示侧那一半）：
    //   ① 官方「不计数」怪（unharmful / part）也扣 1 点 —— 旧码只数 `counted`，显示上永远少报；
    //   ② 带 `confrontSeat` 的条目属于「投放怪」那一笔（按阶位阶梯价、记到队上），这里不重复计。
    const lossUnits = (r) => (r && Array.isArray(r.leaked)
      ? r.leaked.filter((l) => l && l.confrontSeat == null && l.uniteRuntime !== true).length : 0);
    // 联防: a leaker's enemies still standing on the 联防 field (uncapped), the loss capped like settle()
    const left = this._uniteLeft(ps);
    if (left != null) {
      const loss = Math.min(this.gd.lpCapPerRound, left);
      return loss > 0 ? { uniteLeft: left, pendingLp: loss } : { uniteLeft: left };
    }
    const ownLossOf = (pid) => {
      if (this.lastResults.has(pid)) return lossUnits(this.lastResults.get(pid));
      if (this.phase !== PHASE.COMBAT) return 0;
      const f = this.fields.find((x) => x && x.kind === 'normal' && Array.isArray(x.players) && x.players.includes(pid));
      if (!f) return 0;
      if (f.cc) return f.done && f.result ? lossUnits(f.result.perPlayer && f.result.perPlayer[pid]) : Number(f.progress && f.progress.leaks) || 0;
      if (f.battle) { try { return battleProgress(f.battle).leaks; } catch { return 0; } }
      return 0;
    };
    let n = ownLossOf(ps.playerId);
    // 对抗：settle 是**逐队**一次 min(cap, Σ) —— 这里同样按队聚合，否则 2V2 会低报队友那份。
    if (this.isVersus && this.teamLps) {
      const myTeam = this.teamIdOf(ps);
      for (const o of this.alivePlayers()) {
        if (!o || o.playerId === ps.playerId || this.teamIdOf(o) !== myTeam) continue;
        n += ownLossOf(o.playerId);
      }
      // 投放怪漏过（按价值）也记在队上；未出结果的场在 settle 时才计，这里只看已出结果的
      for (const f of this.fields || []) {
        if (!f || !f.done) continue;
        const fr = f.result && typeof f.result === 'object' ? f.result : null;
        if (!fr || !fr.confrontLeaks) continue;
        const teams = new Set();
        for (const pid of new Set(f.players || [])) {
          const o = this.order.find((x) => x && x.playerId === pid);
          if (o) teams.add(this.teamIdOf(o));
        }
        if (!teams.has(myTeam)) continue;
        let c = 0, v = 0;
        for (const [seat, cnt] of Object.entries(fr.confrontLeaks || {})) {
          c += Math.max(0, Number(cnt) || 0);
          v += Math.max(0, Number(fr.confrontLeakValue && fr.confrontLeakValue[seat]) || 0);
        }
        n += Math.max(c, v);
      }
    }
    const loss = Math.min(this.gd.lpCapPerRound, Math.max(0, Math.trunc(Number(n) || 0)));
    return loss > 0 ? { pendingLp: loss } : {};
  }

  /** 守方私有预告：本回合朝我投来的怪物（怪种/路线/时机）。攻方或非对抗回合返回 []。 */
  incomingFor(ps) {
    if (!this.isVersus || !this.confront || !this.confront.size) return [];
    if (typeof this.isRoleRound === 'function' && this.isRoleRound() && !this.isDefender(ps)) return [];
    const out = [];
    for (const [pid, s] of this.confront) {
      if (!s || s.target !== ps.playerId) continue;
      for (const p of s.picks || []) {
        out.push({
          enemyKey: p.enemyKey,
          gate: p.gate === 'upper' ? 'upper' : 'lower',
          from: pid,
          ...(p.route ? { route: p.route } : {}),
          ...(Number.isInteger(p.routeIndex) ? { routeIndex: p.routeIndex } : {}),
          ...(Number.isFinite(p.time) ? { time: p.time } : {}),
        });
      }
      for (const b of s.bosses || []) out.push({ enemyKey: b.enemyKey, boss: true, gate: b.gate === 'upper' ? 'upper' : 'lower', from: pid });
    }
    return out;
  }

  /** nextEnemies preview for m.private. */
  nextEnemiesFor(ps) {
    if (!ps.alive) return [];
    // 攻方投放期（业主 2026-11-05）：攻方本回合没有棋盘，下面的分支给的全是**守方**的波次（`this.wave` / 首领组），
    // 预备区因此是空的。攻方要看见「我投放的怪」——草稿里的每一条 pick 就是一只，按门 / 飞行 / 精英摆进预备区。
    // 闸门严格四重：PREP + 商店开着（对抗局，`opts.monsterShop !== false`）+ 本席是攻方 + 本席的商店真的开张
    // （`ps.monsterShop`，monsterShop.js 的 openMonsterShop 只给有投放权的攻方建）—— 守方 / 协同 / 单人 /
    // 目标选择期（CONFRONT）/ R14·R15（`attackingTeam == null` ⇒ isAttacker false）与投放结束后的收尾帧一律走原路径。
    // 草稿为空 ⇒ `[]`（攻方看自己的投放，不回落守方波次）。
    if (this.phase === PHASE.PREP && this.monsterShopOn === true && ps.monsterShop
      && typeof this.isAttacker === 'function' && this.isAttacker(ps)) {
      return previewOf(monsterDraftSpawns(this.gd, ps));
    }
    if (this.bossWaves) {
      const g = this.bossGroupOf(ps);
      if (!g) return [];
      return previewOf([...g.wave.spawns, ...bountySpawns(this.gd, this.round, g.wave, ps.bounties, ps.playerId, { solo: this.isSolo, side: g.side })]);
    }
    if (!this.wave) return [];
    const bounty = bountySpawns(this.gd, this.round, this.wave, ps.bounties, ps.playerId, { solo: this.isSolo });
    // 2V2 事件期: the round's monster card + 强力属性 subset (the preview's counts/flags must match the battle)
    // 同盟狩猎: the system's prey is appended last, exactly as _normalOpts inserts it
    let list = this.foeWaveSpawns([...this.wave.spawns, ...bounty]);
    if (this.coopHuntActive()) list = this.applyCoopHunt(list, ps);
    return previewOf(list);
  }

  /** A 自选 piece's pick (like the sim's UnitInfo.diy): a scout's card composes the operator from it (shared/diy.js). */
  _diyInfo(ps, piece) {
    const p = piece.kind === 'chess' && typeof ps.diyPickOf === 'function' ? ps.diyPickOf(piece.id) : null;
    return p ? { charId: p.charId, skillIndex: p.skillIndex, uniEquipId: p.uniEquipId } : undefined;
  }

  /** The 外勤医疗 reserve medic already standing on each player's field in preparation. Touch replaces it only at
   * battleStart, so the prep view always uses the reserve medic, regardless of the current elite count. The stage's
   * normal-board slot is transformed to the correct half of a boss field by _onBossHalf / the client prep camera. */
  prepMapChars(ps) {
    if (!ps?.alive || this.phase !== PHASE.PREP || !this.teamMedicGranted()) return [];
    const id = 'char_605_cmedic';
    const slot = this.stage?.mapChars?.find((m) => m?.key === id && Array.isArray(m.pos) && m.pos[0] >= 9 && m.pos[0] <= 12
      && m.pos[1] >= 0 && m.pos[1] <= 10 && !/multi_only/.test(String(m.alias)));
    const rec = this.gd.token(id);
    if (!slot || !rec) return [];
    const dir = slot.dir || 'RIGHT';
    return [{
      id: -ps.seat - 1, uid: -ps.seat - 1, kind: 'token', side: 'ally', ownerId: ps.playerId, defId: id,
      area: 'board', name: rec.name || id, tier: 1, golden: false,
      spine: rec.assets?.spine || id, avatar: rec.assets?.avatar || id,
      x: slot.pos[1], y: slot.pos[0], dir, facing: dir === 'LEFT' ? -1 : 1, maxHp: rec.stats?.maxHp || 1,
    }];
  }

  /** UnitInfo of a player's board pieces on their (board) tiles — a prep scout's board, the boss partner's (bossMateView).
   *  `area: 'board'` (a bench unit says 'hand' / 'temp': prepFieldMeta). */
  _prepBoardUnits(ps) {
    const units = this.prepMapChars(ps);
    // the player's own view of the data (0.2.0 自选编队: its slotted DIY slots are its operators — player/diy.js)
    const gd = ps.gd || this.gd;
    for (const { r, c, piece } of boardOrder(ps.board)) {
      const chess = piece.kind === 'token' ? null : gd.chess(piece.id);
      // 0.2.0 补位: a chess this player fields as its stand-in is deployed with the stand-in's body — name, art, max HP,
      // skill, like the sim's UnitInfo (`standInFor` = the replaced operator's charId)
      const rec = piece.kind === 'token' ? gd.token(piece.id) : ps.fieldRecord(chess);
      const assets = (rec && rec.assets) || {};
      // DESIGN §16: the skill / module THIS player's operator fights with (the scout's detail card shows it, like the
      // sim's UnitInfo in a shared field); moduleId only for an elite; 0.2.2 its potential (below 6) and 练度
      const lo = piece.kind === 'chess' && chess ? ps.loadoutFor(chess) : null;
      const diy = this._diyInfo(ps, piece);
      units.push({
        id: piece.uid, uid: piece.uid, kind: piece.kind === 'token' ? 'token' : 'op', side: 'ally', ownerId: ps.playerId, defId: piece.id,
        area: 'board',
        name: rec ? rec.name : piece.id, tier: rec && Number.isInteger(rec.tier) ? rec.tier : 1, golden: !!(rec && rec.isGolden),
        spine: assets.spine || (rec && rec.charId) || piece.id, avatar: assets.avatar || (rec && rec.charId) || piece.id,
        x: c, y: r, dir: pieceDir(piece), facing: pieceDir(piece) === 'LEFT' ? -1 : 1, maxHp: rec && rec.stats && Number.isFinite(rec.stats.maxHp) ? rec.stats.maxHp : 1,
        skillIndex: lo && Number.isInteger(lo.skillIndex) ? lo.skillIndex : undefined,
        moduleId: lo && typeof lo.moduleId === 'string' ? lo.moduleId : undefined,
        // the equipped items (like the sim's UnitInfo): a 变形同构体 wearer shows as a member of the bond it grants
        items: piece.kind === 'chess' && Array.isArray(piece.items) && piece.items.length ? piece.items.map((it) => it.id) : undefined,
        standInFor: rec && rec.standInFor ? rec.standInFor : undefined,
        diy,
        // 皮肤 (docs/SKINS.md): built per player (the owner of the scouted board), so a teammate's piece shows THEIR
        // appearance; a 自选 slot fights as its pick's operator, which is the key it wears too
        skin: ps.skinFor(rec, diy ? diy.charId : null) || undefined,
        ...cultivationInfo(lo),
      });
    }
    return units;
  }

  /**
   * A boss round's prep (最终攻势 / 隐秘核心: the pairing planned, no field up yet): the other player of `ps`'s pair as
   * { mate: PlayerState, side: its half 'L' | 'R' }, else null (a lone player, any other phase).
   */
  _bossMateOf(ps) {
    if (!ps || !this.bossWaves || this.fields.length) return null;
    const g = this.bossGroupOf(ps);
    const pid = g && g.players.length > 1 ? g.players.find((x) => x !== ps.playerId) : null;
    const mate = pid ? this.players.get(pid) : null;
    return mate ? { mate, side: g.side === 'R' ? 'L' : 'R' } : null;
  }

  /**
   * m.private `bossMate` (community report of 2026-10-06, item 51): in a boss round's prep the partner's board on its
   * half of the boss field, as the battle will place it (bossFieldPlacement: the right half mirrored, RIGHT ↔ LEFT) — the
   * own prep view draws it beside the own half, read-only, as the official prep shows both players of a pair together
   * (the official client knows every board: ChangePositionDn { boardStatus }, research 09). Null otherwise.
   * @returns {{ playerId: string, side: 'L'|'R', units: object[] } | null}
   */
  bossMateView(ps) {
    const m = ps && ps.alive ? this._bossMateOf(ps) : null;
    if (!m) return null;
    return { playerId: m.mate.playerId, side: m.side, units: this._prepBoardUnits(m.mate).map((u) => this._onBossHalf(u, m.side)) };
  }

  /** UnitInfo list of a player's board and hand (prep scouting): board pieces on their tiles, held pieces on the
   *   hand row (row 7) — the scout renders like the own prep bench. */
  prepFieldMeta(ps) {
    const units = this._prepBoardUnits(ps);
    const gd = ps.gd || this.gd;
    // the hand (整备区) and the 临时整备区 scout exactly like the own prep bench renders them: pieces as units on
    // their rows (hand row 7, col = hand slot; temp row 8, cols 4..8 = temp slots; no dir — bench pieces face right),
    // items included (the client draws their floating plates). PRTS 帮助 counts the temp area with the hand (review of
    // PR #129). Part of the meta for every watcher alike — the spectator seat's copy equals a teammate's
    // (test/match/spectator.test.js). User playtest #2 item 1 (GitHub #44).
    // (a held chess the player fields as its stand-in is the stand-in there too — name, art, max HP — and carries
    // `standInFor`, like a board piece: the owner's recall of the official mode, 2026-10-06, the hand shows the stand-in)
    // Each unit says where it waits (`area` 'hand' | 'temp'; a board unit 'board'): the bond popup of a watched player
    // counts it like the player's own (ui/watchBonds.js ownerBoard — a hand operator is owned and counts for 投资人 远见
    // 奇迹, a temp one counts for nothing; GitHub #385, PR #387). The tag survives the boss-half remap (_onBossHalf), the
    // row does not.
    const benchUnit = (piece, i, y, area) => {
      const rec = piece.kind === 'item' ? gd.item(piece.id) : piece.kind === 'token' ? gd.token(piece.id) : gd.chess(piece.id);
      const standIn = piece.kind === 'chess' && rec && ps.fieldsStandIn(rec) ? this.gd.standIn(rec.chessId) : null;
      const body = standIn || rec;
      const assets = (body && body.assets) || {};
      const lo = piece.kind === 'chess' && rec ? ps.loadoutFor(rec) : null;
      const diy = this._diyInfo(ps, piece);
      units.push({
        id: piece.uid, uid: piece.uid, kind: piece.kind === 'token' ? 'token' : piece.kind === 'item' ? 'item' : 'op',
        side: 'ally', ownerId: ps.playerId, defId: piece.id, area,
        name: body ? body.name : piece.id, tier: rec && Number.isInteger(rec.tier) ? rec.tier : 1, golden: !!(rec && rec.isGolden),
        spine: assets.spine || (body && body.charId) || piece.id, avatar: assets.avatar || (body && body.charId) || piece.id,
        x: i, y, maxHp: body && body.stats && Number.isFinite(body.stats.maxHp) ? body.stats.maxHp : 1,
        skillIndex: lo && Number.isInteger(lo.skillIndex) ? lo.skillIndex : undefined,
        moduleId: lo && typeof lo.moduleId === 'string' ? lo.moduleId : undefined,
        items: piece.kind === 'chess' && Array.isArray(piece.items) && piece.items.length ? piece.items.map((it) => it.id) : undefined,
        standInFor: standIn && standIn.standInFor ? standIn.standInFor : undefined,
        diy,
        // 皮肤 (docs/SKINS.md): the scouted player's own appearance (see the prep view above)
        skin: ps.skinFor(rec, diy ? diy.charId : null) || undefined,
        ...cultivationInfo(lo),
      });
    };
    for (let i = 0; i < ps.hand.length; i++) {
      if (ps.hand[i]) benchUnit(ps.hand[i], i, GEO.HAND_ROW, 'hand');
    }
    for (let i = 0; i < Math.min(ps.temp.length, GEO.TEMP_SIZE); i++) {
      if (ps.temp[i]) benchUnit(ps.temp[i], GEO.TEMP_C0 + i, GEO.TEMP_ROW, 'temp');
    }
    // `nextEnemies`: the scouted player's coming enemies — their preview pen shows on the scouting board too (research 09
    // §2.2 "Teammates"; render/app.js enterBattle({ prep: true, nextEnemies }))
    let nextEnemies = [];
    try { nextEnemies = this.nextEnemiesFor(ps); } catch (e) { this.reportError('nextEnemies', e); }
    // the scouted player's effects column (策略 / 机变 / 悬赏 …), display-ready (user playtest #2: while scouting, the
    // right column shows the watched player's effects, not one's own)
    const meta = { t: 'm.field', fieldId: `n:${ps.playerId}`, kind: 'normal', rect: { ...this.layout.battle.normal }, stageId: this.stageId, units, effects: ps.effectsView(), prep: true, nextEnemies };
    // 最终攻势 / 隐秘核心 prep: the pieces stand on the player's half of the boss field — the scout shows them there (rows
    // − 7, the right half mirrored with RIGHT ↔ LEFT: finalAssault.js bossFieldPlacement, as the own prep view), with the
    // round's leader at its spawn tile (nextEnemies `start`), framed by the boss-field prep camera of the player's side
    // (`side`). Until 0.2.0 an eliminated player or a spectator seat scouting a player then saw the normal board and no
    // leader at all (community report of 2026-10-06, item 55).
    // The pair's other player stands on the other half (item 51: both players of a pair together, as in the battle).
    const g = this.fields.length ? null : this.bossGroupOf(ps);
    if (!g) return meta;
    const mate = this.bossMateView(ps);
    const own = units.map((u) => this._onBossHalf(u, g.side));
    return { ...meta, kind: 'boss', rect: { ...this.layout.battle.boss }, side: g.side, units: mate ? [...own, ...mate.units] : own, ...(mate ? { mate: { playerId: mate.playerId, side: mate.side } } : {}) };
  }

  /** A prep UnitInfo (board, bench or temp row) placed on side 'L' | 'R' of the boss field (bossFieldPlacement). */
  _onBossHalf(u, side) {
    const p = bossFieldPlacement(side, u.y, u.x, u.dir || 'RIGHT');
    const v = { ...u, x: p.col, y: p.row };
    // a board piece keeps facing the same way relative to the leader (mirrored on the right half); a bench piece has no
    // stored facing (it faces right, as the own prep bench draws it)
    if (u.dir) { v.dir = p.dir; v.facing = p.dir === 'LEFT' ? -1 : 1; }
    return v;
  }
}
