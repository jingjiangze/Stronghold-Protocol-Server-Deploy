// server/match/player/round.js — PlayerState methods: the round lifecycle the match calls — startRound (income, pending
// coins, the shop, summon stacks topped up), endPrep, eliminate (every copy back to the pool), recompute (legality,
// out-of-range summons, temp pieces into free hand slots, bonds; onActiveBonds when the set of active bonds changed),
// the bond views — and battleInput (the player's PlayerBattleInput: board units with their loadout, their 补位 mark or
// their 自选 pick, carried 联防 state, the reached layers).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { boardOrder, pieceDir } from '../board.js';
import { computeBonds, bondSnapshot, activatedLayers, bondsWithGains } from '../bondsMeta.js';

/**
 * `rangeGrid`（面向 RIGHT 的相对格子）→ 该棋子实际覆盖到的 `"r,c"` 集合。
 * 旋转规则与 `server/sim/dir.js` 的 `rotateOffset` 一致（RIGHT 原样 / UP (dc,−dr) / LEFT (−dr,−dc) / DOWN (−dc,dr)），
 * 这里内联一份而不是反向 import 核心 sim —— 插件只依赖 battle-input 契约，不依赖引擎内部模块。
 */
export function rangeTileKeys(grid, r, c, dir) {
  const out = new Set();
  if (!Array.isArray(grid) || !Number.isInteger(r) || !Number.isInteger(c)) return out;
  const rot = (dr, dc) => {
    switch (dir) {
      case 'UP': return [dc, 0 - dr];
      case 'LEFT': return [0 - dr, 0 - dc];
      case 'DOWN': return [0 - dc, dr];
      default: return [dr, dc];
    }
  };
  for (const cell of grid) {
    if (!Array.isArray(cell) || !Number.isInteger(cell[0]) || !Number.isInteger(cell[1])) continue;
    const [ar, ac] = rot(cell[0], cell[1]);
    out.add(`${r + ar},${c + ac}`);
  }
  return out;
}

export class PlayerRound {
  startRound(r) {
    this.round = { refreshes: 0, buys: 0, sells: 0, spent: 0, gainedChess: 0, arts: 0 };
    this.pendingLayerGains = null; // settled (or lapsed) at the last SETTLE
    if (r > 1) this.shop.upgradePrice = Math.max(0, this.shop.upgradePrice - 1);
    // onIncome handlers may rewrite ev.income / ev.pending (e.g. 老鲤 withholds R1–R2 income until R3)
    const ev = { round: r, income: this.gd.income(r), pending: this.pendingFunds };
    this.pendingFunds = 0;
    this.m.dispatch(this, 'onIncome', ev);
    const nonNeg = (v) => (Number.isFinite(v) && v > 0 ? Math.trunc(v) : 0);
    this.addFunds(nonNeg(ev.income) + nonNeg(ev.pending), { reason: 'income' });
    // temp is NOT wiped here: the last prep's deadline resolved what the player could act on (endPrep); what overflowed
    // after it (battle-result grants, SETTLE merges, returned equipment) is shown and usable in this prep (tempDue).
    // Queued reward offers (a promotion's pick, a strategy's special refresh, an item offer) are kept until picked —
    // they do not lapse at the prep deadline (PRTS 卫戍协议/帮助: the temporary shop leaves its state when one is bought;
    // community report relayed by the maintainer on 2026-10-15) — so an offer left with 稍后 is shown again in this prep
    this.ready = false;
    // summon stacks removed from temp at the last prep deadline come back (PRTS 卫戍协议/帮助 §手牌区); full hand ⇒ temp
    for (const p of [...this.board.values()]) if (p.kind === 'chess') this.grantTokensFor(p);
    this.rollShop({ keepFrozen: true });
    this.shop.frozen = false;
    for (const s of this.shop.slots) if (s) s.frozen = false;
    this.recompute();
  }

  /**
   * Prep deadline (Match.endPrep, after the <休整期结束时> onPrepEnd effects): the temp pieces due at this prep are
   * resolved; what overflowed after Ready or during onPrepEnd stays for the next prep, which `prepsEnded` now names.
   */
  endPrep() {
    this.resolveTemp();
    this.prepsEnded++;
    for (const uid of [...this._tempDue.keys()]) if (!this.temp.some((p) => p && p.uid === uid)) this._tempDue.delete(uid);
    // (queued reward offers stay: they last until picked, startRound)
    this.clearUnfrozenShop();
    // 三层资金（业主 2026-10-26）：每回合资金 → 个人储备 / 团队储备（由 Match 的分配函数决定比例与设施加成）。
    if (this.match && typeof this.match.econSplitLeftover === 'function') this.match.econSplitLeftover(this);
    else if (!this.gd.leftoverKeptBands.includes(this.bandId)) this.funds = 0;
    this.ready = true;
    this.dirty();
  }

  // `effects` are kept: a 信标 gift still pending is delivered to the teammate at the next round start (builtin_gift is
  // flagged afterElimination — GitHub #86); nothing else of an eliminated player is dispatched.
  eliminate(round) {
    this.alive = false;
    this.ready = false;
    // 投放权移交（2026-11-06 业主第 2 条）：solo / master 的队长在投放窗口里阵亡时，权力按判据落到下一位存活攻方，
    // 但商店只给当时的第一位开过 —— 不在这里重新对账，这一回合剩下没人能买卡 / 投放。Match 侧的实现是幂等的，
    // 非对抗局 / 商店关着 / 不在投放窗口时它一行都不写。
    try { if (this.match && typeof this.match.syncMonsterOperators === 'function') this.match.syncMonsterOperators(); } catch { /* ignore */ }
    // 三层资金：永久淘汰时个人储备一并清空（与 funds / pendingFunds 同口径）。
    // 注意：救援分支（revival)只置 alive=false，**不**走这里；若将来加「淘汰后复活」，这里的清零会丢储备。
    this.reserve = 0;
    this.eliminatedRound = round;
    const all = [];
    for (const p of this.board.values()) all.push(p);
    for (const p of this.hand) if (p) all.push(p);
    for (const p of this.temp) if (p) all.push(p);
    for (const p of all) {
      this.returnCopies(p);
      if (p.kind === 'item') this.releaseItemStock(p);
      for (const it of p.items || []) this.releaseItemStock(it);
    }
    this.board.clear();
    this.hand.fill(null);
    this.temp.fill(null);
    this._tempDue.clear();
    this.offers = [];
    this.bounties = [];
    this.personalChoice = null;
    this.shop.slots = [];
    this.funds = 0;
    this.pendingFunds = 0;
    this.recompute();
  }

  recompute() {
    this.deployMap(); // a change of the deploy field (a boss round's prep) marks the legality stale
    if (this._legalityStale) this._evictIllegal();
    this._liftOutOfRange();
    // a free regular hand slot pulls a temp piece in (PRTS 卫戍协议/帮助 §手牌区 "常规手牌区出现空位时自动移入")
    this._fillHandFromTemp();
    // the states the last recompute stored: the change since then is reported once (_reportActiveBonds)
    const before = this.bonds;
    this.bonds = computeBonds(this.gd, this);
    this.dirty();
    this._reportActiveBonds(before, this.bonds);
  }

  /**
   * onActiveBonds (docs/META.md §2.2): the set of active bonds differs between `before` and `after` — every path that
   * changes what the bonds count ends in recompute (a board edit in prep: place, move, swap, withdraw; buys, sells,
   * merges, transformations, temp moves, equipment, effects, an eviction). Bonds that light up pay their owed layer
   * milestones at once (维多利亚's hammers, 远见 / 奇迹's funds — the maintainer's report of 2026-10-15). Each recompute
   * reports the difference to the previous computed state, so a handler's own recompute (a hammer's onGain) reports
   * only what changed after it, and nothing twice. Never for an eliminated player (eliminate clears the board) nor a
   * detached copy (preview.js previewPlayer).
   */
  _reportActiveBonds(before, after) {
    if (!this.alive || typeof this.m.dispatch !== 'function') return;
    if (this.m.players && this.m.players.get(this.playerId) !== this) return;
    const activated = [];
    const deactivated = [];
    for (const id of this.gd.bondIds) {
      const was = !!(before && before[id] && before[id].active);
      const is = !!(after && after[id] && after[id].active);
      if (is && !was) activated.push(id);
      else if (was && !is) deactivated.push(id);
    }
    if (activated.length || deactivated.length) this.m.dispatch(this, 'onActiveBonds', { activated, deactivated });
  }

  activatedLayers() { return activatedLayers(this.bonds); }

  /**
   * The bond states the views show (m.private bonds, m.public players[].bonds): the computed states plus the pending
   * in-battle gains of this round's finished normal battle (bondsMeta.bondsWithGains). The 联防 field fights with them too
   * (battleInput `reached`); no other rule reads them.
   */
  bondsView() { return bondsWithGains(this.bonds, this.pendingLayerGains); }

  /**
   * `reached`: the bonds carry the layers this round's own combat reached (bondsView: the pending in-battle gains, capped
   * like settle()) — the 联防 field (unite.js; PRTS 卫戍协议/帮助 §联防阶段 "将以其阵地当前的状态", [ASSUMED] the current
   * state includes those layers, as the strip shows them). The gains stay pending: settle() adds them once.
   */
  battleInput({ side = 'L', colOffset = 0, carry = null, reached = false } = {}) {
    // a terrain change not yet followed by a recompute (a content hook at the prep end) never fields an illegal board
    this.deployMap();
    if (this._legalityStale) this.recompute();
    const units = [];
    for (const { r, c, piece } of boardOrder(this.board)) {
      if (piece.kind === 'chess') {
        const u = { uid: piece.uid, kind: 'chess', chessId: piece.id, row: r, col: c, dir: pieceDir(piece), items: (piece.items || []).map((i) => i.id) };
        const pick = this.diyPickOf(piece.id);
        if (pick) {
          // 0.2.0 自选编队: a slotted DIY slot fights as its pick (sim getChess(id, { diy }): the operator's body, the pick's
          // skill and module — no loadout fields, docs/SIM.md §12)
          u.diy = { charId: pick.charId, skillIndex: pick.skillIndex, uniEquipId: pick.uniEquipId };
        } else if (this.fieldsStandIn(piece.id)) {
          // 0.2.0 补位: a chess this player does not own fights as its stand-in (sim getChess(id, { standIn: true }): the
          // backup skill / module — no loadout fields, docs/SIM.md §12)
          u.standIn = true;
        } else {
          // DESIGN §16: the equipped skill / module (elite only) from the loadout (defaults when absent)
          const lo = this.loadoutFor(this.gd.chess(piece.id));
          u.skillIndex = lo.skillIndex;
          u.moduleId = lo.moduleId;
        }
        // 0.2.2: the potential / 练度 of an operator the player owns (the chess as itself, an owned 自选 pick — the player's
        // 干员调配 settings, 潜能 6 / 精英2 Lv.60 by default and for bots; never a stand-in's nor a prototype pick's)
        const cv = u.standIn ? null : this.cultivationFor(this.gd.chess(piece.id));
        if (cv) { u.potential = cv.potential; u.cultivate = cv.cultivate; }
        // 皮肤 (docs/SKINS.md): the appearance this player wears for the operator the piece fields, carried into the sim
        // so it reaches Unit.skin and the snapshot every client draws from. A 自选 slot's own record has no charId (its
        // appearance is the PICK's operator), so the pick's operator decides the key first.
        const skinId = this.skinFor(this.gd.chess(piece.id), pick ? pick.charId : null);
        if (skinId) u.skin = skinId;
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid);
        units.push(u);
      } else if (piece.kind === 'token') {
        const u = { uid: piece.uid, kind: 'token', tokenId: piece.id, row: r, col: c, dir: pieceDir(piece), ownerUid: piece.ownerUid };
        if (carry && carry.has(piece.uid)) u.carryState = carry.get(piece.uid); // 联防: { sp } (unite.js)
        units.push(u);
      }
    }
    // 肉鸽 rule 藏品：己方属性（攻击/生命/防御/攻速）—— 全局部分算一次，相邻类按每个单位自己的 4 邻域补
    // （sim 侧 `_makeAlly()` 会把这些乘/加到单位基础属性上；缺省时什么都不改）
    try {
      const am = this.m && typeof this.m.relicAllyMul === 'function' ? this.m.relicAllyMul(this) : null;
      const nb = this.m && typeof this.m.relicNeighborRules === 'function' ? this.m.relicNeighborRules() : null;
      const camo = this.m && typeof this.m.relicCamoRules === 'function' ? this.m.relicCamoRules() : null;
      // stunOnDeploy（“未尽的生命”）：按 seed+回合确定性地挑出 N 名干员，让他们部署即晕眩
      const stunRule = this.m && typeof this.m.relicStunRule === 'function' ? this.m.relicStunRule(this) : null;
      let stunUids = null;
      if (stunRule && stunRule.count > 0) {
        const pool = units.filter((x) => x.kind === 'chess').map((x) => x.uid);
        if (pool.length) {
          // 小 LCG：同 seed+回合 ⇒ 同一批倒霉蛋（复盘/双端一致，不用 Math.random）
          let st = ((Number(this.m.seed) || 1) ^ (Number(this.m.round) || 1) * 2654435761) >>> 0;
          const next = () => { st = (Math.imul(st, 1664525) + 1013904223) >>> 0; return st / 4294967296; };
          const pick = pool.slice();
          for (let i = pick.length - 1; i > 0; i--) { const j = Math.floor(next() * (i + 1)); [pick[i], pick[j]] = [pick[j], pick[i]]; }
          stunUids = new Set(pick.slice(0, Math.min(stunRule.count, pick.length)));
        }
      }
      // survivor（生还者合约）：只强化**场上攻击力最高**的那一名干员
      const surv = this.m && typeof this.m.relicSurvivorRule === 'function' ? this.m.relicSurvivorRule(this) : null;
      let survUid = null;
      if (surv) {
        let bestAtk = -1;
        for (const u of units) {
          if (u.kind !== 'chess') continue;
          const rec = this.gd && typeof this.gd.chess === 'function' ? this.gd.chess(u.chessId) : null;
          const a = Number(rec && rec.stats && rec.stats.atk) || 0;
          if (a > bestAtk) { bestAtk = a; survUid = u.uid; }
        }
      }
      // camoAura（犬植浆）：每被**别的干员**的攻击范围覆盖一次，攻击 +auraAtk（可叠加）
      let auraCount = null;
      if (camo && camo.auraAtk > 0) {
        auraCount = new Map();
        const cover = new Map(); // uid → 覆盖到的 "r,c" 集合
        for (const u of units) {
          if (u.kind !== 'chess') continue;
          const rec = this.gd && typeof this.gd.chess === 'function' ? this.gd.chess(u.chessId) : null;
          const grid = rec && Array.isArray(rec.rangeGrid) ? rec.rangeGrid : null;
          if (grid) cover.set(u.uid, rangeTileKeys(grid, u.row, u.col, u.dir));
        }
        for (const u of units) {
          const set = cover.get(u.uid);
          if (!set) continue;
          let n = 0;
          for (const other of units) {
            if (other.uid === u.uid) continue;
            if (set.has(`${other.row},${other.col}`)) n += 1;
          }
          auraCount.set(u.uid, n);
        }
      }
      if (am || nb || camo || surv || stunRule) {
        const occ = new Set(boardOrder(this.board).map(({ r, c }) => `${r},${c}`));
        for (const u of units) {
          let n = 0;
          if (nb) {
            for (const [dr, dc] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
              if (occ.has(`${u.row + dr},${u.col + dc}`)) n += 1;
            }
          }
          // 精锐干员（4 阶以上）额外吃 eliteAtkPerRound / eliteHpPerRound 的每回合削弱
          let eliteMul = { atkMul: 1, hpMul: 1, defMul: 1, aspdAdd: 0 };
          try {
            const tier = this.gd && typeof this.gd.tierOf === 'function' ? this.gd.tierOf(u.chessId) : 0;
            if (Number(tier) >= 4) {
              if (this.m && typeof this.m.relicEliteRoundMul === 'function') {
                const rm2 = this.m.relicEliteRoundMul();
                eliteMul.atkMul *= rm2.atkMul; eliteMul.hpMul *= rm2.hpMul;
              }
              // 精锐目标类：场上精锐数 / 合成层数
              const er = this.m && typeof this.m.relicEliteRules === 'function' ? this.m.relicEliteRules() : null;
              if (er) {
                let elites = 0;
                if (this.board && typeof this.board.values === 'function') {
                  for (const piece of this.board.values()) {
                    const t2 = this.gd && typeof this.gd.tierOf === 'function' ? this.gd.tierOf(piece && piece.id) : 0;
                    if (Number(t2) >= 4) elites += 1;
                  }
                }
                // allyElite（未叙魔王残片）「精锐干员攻击 −30%」：只乘在精锐身上
                const ae = this.m && typeof this.m.relicAllyEliteMul === 'function' ? this.m.relicAllyEliteMul(this) : 1;
                eliteMul.atkMul *= ae * (1 + er.atk * elites + er.mergePer * Math.min(er.mergeMax, Number(this.relicEliteMerges) || 0));
                eliteMul.hpMul *= 1 + er.hp * elites;
                eliteMul.defMul *= 1 + er.def * elites;
                eliteMul.aspdAdd += er.aspdPer * Math.min(er.aspdMax, elites);
              }
            }
          } catch { /* 取不到阶数就不削弱 */ }
          // 迷彩类（camoRanged / camoAura）：远程判定看棋子的 position，光环按「被几名干员的攻击范围覆盖」叠
          let camoMul = 1;
          if (camo) {
            if (camo.rangedAtk > 0) {
              const rec = this.gd && typeof this.gd.chess === 'function' ? this.gd.chess(u.chessId) : null;
              if (rec && rec.position === 'RANGED') camoMul *= 1 + camo.rangedAtk;
            }
            if (camo.auraAtk > 0 && auraCount) camoMul *= 1 + camo.auraAtk * (auraCount.get(u.uid) || 0);
          }
          // survivor（生还者合约）：只有攻击力最高的那一名吃「+20% ×(1+已打场数)」的攻/防
          let survMul = 1;
          if (surv && survUid === u.uid) survMul = 1 + surv.per * surv.stacks;
          const atkMul = (am && Number.isFinite(am.atkMul) ? am.atkMul : 1) * (1 + (nb ? nb.atkPer * n : 0)) * eliteMul.atkMul * camoMul * survMul;
          const aspdAdd = (am && Number.isFinite(am.aspdAdd) ? am.aspdAdd : 0) + (nb ? nb.aspdPer * n : 0);
          const hpMul = (am && Number.isFinite(am.hpMul) ? am.hpMul : 1) * eliteMul.hpMul;
          const defMul = (am && Number.isFinite(am.defMul) ? am.defMul : 1) * eliteMul.defMul * survMul;
          const aspdAdd2 = aspdAdd + eliteMul.aspdAdd;
          const stun = stunUids && stunUids.has(u.uid) ? stunRule.dur : 0;
          u.relicMods = { ...(am || {}), atkMul, hpMul, ...(defMul !== 1 ? { defMul } : {}), ...(aspdAdd2 ? { aspdAdd: aspdAdd2 } : {}),
            ...(stun ? { stunOnDeploy: stun } : {}) };
        }
      }
    } catch { /* 尽力而为，绝不因为藏品坏了出不了兵 */ }
    return {
      playerId: this.playerId,
      seat: this.seat,
      side,
      colOffset,
      units,
      bonds: bondSnapshot(reached ? this.bondsView() : this.bonds),
      bandId: this.bandId,
      // 危机合约 (shared/contractEffects.js): this player's own share of the room's modifiers —
      // `contractOpStatMul` (the operator stat multipliers: sim players.js `_makeAlly` reads it off the player input,
      // which is why it rides here and not on a unit), `contractSupports` (the support protocols a 支援 contract
      // grants: sim contractSupport.js) and `contractRedeployMul` (units.js). Each key is omitted while neutral, so a
      // match without contracts sends exactly the input it always sent.
      ...(this.m?.fx && (this.m.fx.opStatMul.atk !== 1 || this.m.fx.opStatMul.def !== 1 || this.m.fx.opStatMul.hp !== 1)
        ? { contractOpStatMul: this.m.fx.opStatMul } : {}),
      ...(this.m?.fx?.supportProtocols?.length ? { contractSupports: this.m.fx.supportProtocols } : {}),
      ...(this.m?.fx?.opRedeployMul != null && this.m.fx.opRedeployMul !== 1 ? { contractRedeployMul: this.m.fx.opRedeployMul } : {}),
      playerEffects: this.effects.filter((e) => e.battle !== false).map((e) => ({
        id: e.id, key: e.key ?? null, source: e.iconKind ?? null, params: e.params ?? null, counter: e.counter ?? null, data: e.data ?? null,
      })),
      deviceOverrides: { ...this.deviceOverrides },
    };
  }
}
