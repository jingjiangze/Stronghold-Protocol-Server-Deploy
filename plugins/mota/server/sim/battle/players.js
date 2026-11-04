// server/sim/battle/players.js — Battle methods: players and units: board → field tiles and directions, ally creation
// from the PlayerBattleInput, token defs for an owner's loadout, and the kit / profile / skill setup of a unit.
// Installed on Battle.prototype by server/sim/Battle.js (a method container: never instantiated; `this` is the battle).

import { COLS, BOSS_ROW_OFFSET } from '../constants.js';
import { GEO } from '../../../shared/constants.js';
import { Unit } from '../units.js';
import { normDir, mirrorDir } from '../dir.js';
import { SkillRuntime } from '../skills.js';
import { resolveProfile } from '../professions.js';
import { normalizeToken } from '../simdata.js';
import { isPotential, isCultivate } from '../../../shared/potential.js';
import { setupUnitKit } from '../content/index.js';
import { installTraitAttackSpeed } from '../content/traitMods.js';

import { clone } from './util.js';

export class BattlePlayers {
  _addPlayer(p) {
    const bossLike = this.kind === 'boss' || this.kind === 'hidden';
    const side = p.side === 'R' ? 'R' : 'L';
    const mirror = bossLike && side === 'R';
    const ps = {
      playerId: p.playerId,
      seat: p.seat ?? this.players.length,
      side,
      colOffset: Number(p.colOffset) || 0,
      rowOffset: p.rowOffset,
      coords: p.coords ?? 'board',
      mirror,
      facing: mirror ? -1 : 1,
      // default direction of this player's units on this field (the FA right side is mirrored: RIGHT ↔ LEFT)
      dir: mirror ? 'LEFT' : 'RIGHT',
      half: mirror || (Number(p.colOffset) || 0) >= 8 ? 'R' : 'L',
      bonds: clone(p.bonds ?? {}),
      bandId: p.bandId ?? null,
      playerEffects: clone(p.playerEffects ?? []),
      lpForBoss: p.lpForBoss ?? null,
      dp: this.flags.dpInit,
      units: [],
      input: p,
    };
    if (this.opts.morphPairing === 'plus') ps.morphPairing = 'plus';
    this.players.push(ps);
    this._perPlayer[ps.playerId] = {
      // `killed` / `total` / `leaked` / `perfect` keep the official `counted` reading (DESIGN §5.1); `killedInTotal` /
      // `leakedInTotal` are the HUD capsule's counters of this player's own field (only enemies the round scheduled:
      // spawns.js `_queueSpawn` / `inTotal`, deploy.js), `resolved` is derived from them at result time.
      killed: 0, total: 0, leaked: [], perfect: true, killedInTotal: 0, leakedInTotal: 0,
      layerGains: {}, coins: 0, damageDealt: 0, bossDamage: 0, healingDone: 0, deaths: 0, unitsEnd: [], unitStats: [],
    };
    const late = [];
    for (const u of p.units ?? []) {
      try {
        const unit = this._createAllyFromInput(ps, u);
        if (unit && unit.kind === 'token' && !unit.ownerUnit && u.ownerUid != null) late.push([unit, u]);
      } catch (e) { this._internalError('createUnit', e); }
    }
    // a token piece listed before its owner (board order is top→bottom) is linked once every unit exists, and takes
    // the owner-level variant (elite owners: `_b` stats) of the owner's loadout (DESIGN §16)
    for (const [t, inp] of late) {
      const owner = ps.units.find((x) => x.kind === 'op' && x.uid === inp.ownerUid);
      if (!owner) continue;
      t.ownerUnit = owner;
      const def = inp.def ? null : this._tokenDef(inp.tokenId ?? inp.chessId, owner, null);
      if (!def || def === t.def) continue;
      const st = def.stats;
      t.def = def; t.defId = def.id; t.name = def.name; t.rangeGrid = def.rangeGrid;
      Object.assign(t.base, {
        maxHp: st.maxHp, atk: st.atk, def: st.def, res: st.res, aspd: st.aspd, bat: st.bat, blockCnt: st.blockCnt, spRecovery: st.spRecovery,
        tauntLevel: st.tauntLevel, massLevel: st.massLevel, hpRecoveryPerSec: st.hpRecoveryPerSec, cost: st.cost, respawnTime: st.respawnTime,
      });
      t.markDirty();
      t.hp = t.s.maxHp;
    }
  }

  /** Board → field tile for a player (see header). */
  mapTile(ps, row, col, abs = false) {
    if (abs || ps.coords === 'field') return [row, col];
    return this._boardTile(ps, row, col);
  }

  /**
   * Whether field tile (r, c) lies on player `ps`'s own board: the board region GEO.FIELD (rows 9–12, cols 2–10, the
   * tiles its pieces are deployed on) mapped onto this field — the 联防 right-hand helper's +8 columns, the boss field's
   * rows 2–5, the mirrored right half of a pair (whatever coordinates the player's input uses). Never the hand / 临时
   * 整备区 rows of a boss field (rows 0–1, inside BOSS_RECT) nor the other half of a 联防 or boss field. Moves that must
   * stay where the player could deploy read it (乌尔比安's S3 【移动】, kits/ops/chess_char_5_05-ulpia.js); the 突袭
   * landing reads onFieldBoard (any player of this field), with a Raid-only multiplayer boss/hidden exception (§29.13).
   */
  onOwnBoard(ps, r, c) {
    if (!ps) return false;
    let keys = ps._boardKeys;
    if (!keys) {
      keys = ps._boardKeys = new Set();
      for (let br = GEO.FIELD.r0; br <= GEO.FIELD.r1; br++) {
        for (let bc = GEO.FIELD.c0; bc <= GEO.FIELD.c1; bc++) { const [fr, fc] = this._boardTile(ps, br, bc); keys.add(fr * COLS + fc); }
      }
    }
    return keys.has(r * COLS + c);
  }

  /**
   * Whether field tile (r, c) lies on the board of a player standing on this field: onOwnBoard of one of `players`,
   * the players whose units this battle holds (a teammate eliminated before it or playing another field is not one).
   * Both halves on the two-helper 联防 field and on a Final Assault / Hidden Core pair field; the own half only for a
   * lone 联防 helper and on a solo boss field; never a boss field's hand / 临时整备区 rows. The 突袭 landing reads it
   * (bonds/addon/battle.js raidTile — the owner's decision of 2026-10-07, DESIGN §26.1), then separately admits the
   * empty deployment half in multiplayer boss/hidden battles only (§29.13); this general method is unchanged.
   */
  onFieldBoard(r, c) {
    for (const ps of this.players) if (this.onOwnBoard(ps, r, c)) return true;
    return false;
  }

  _boardTile(ps, row, col) {
    const bossLike = this.kind === 'boss' || this.kind === 'hidden';
    let r = row;
    if (ps.rowOffset != null) r = row + ps.rowOffset;
    else if (bossLike && row >= 7) r = row + BOSS_ROW_OFFSET;
    const c = ps.mirror ? (col <= 10 ? COLS - 1 - col : col) : col + ps.colOffset;
    return [r, c];
  }

  /**
   * Board direction → field direction for a player (DESIGN §3): as given (default RIGHT) except on the mirrored Final
   * Assault right side, where RIGHT ↔ LEFT (UP / DOWN unchanged). `abs` / field coordinates are taken as they are.
   */
  mapDir(ps, dir, abs = false) {
    const d = normDir(dir);
    return ps && ps.mirror && !abs && ps.coords !== 'field' ? mirrorDir(d) : d;
  }

  _createAllyFromInput(ps, inp) {
    // coerce (a string row would otherwise concatenate: "10" + -7 → "10-7"); non-integers never deploy
    const row = Number(inp.row), col = Number(inp.col);
    if (!Number.isInteger(row) || !Number.isInteger(col)) { this.log(`bad tile ${inp.row},${inp.col} for ${inp.chessId ?? inp.tokenId}`); return null; }
    const [r, c] = this.mapTile(ps, row, col, !!inp.abs);
    const dir = this.mapDir(ps, inp.dir, !!inp.abs);
    if (inp.kind === 'token') {
      const owner = inp.ownerUid != null ? ps.units.find((x) => x.uid === inp.ownerUid) : null;
      const def = this._tokenDef(inp.tokenId ?? inp.chessId, owner, inp.def);
      if (!def) { this.log(`unknown token ${inp.tokenId}`); return null; }
      const u = this._makeAlly(ps, def, 'token', r, c, { uid: inp.uid, ownerUnit: owner, dir });
      u.carry = inp.carryState ?? null;
      return u;
    }
    // the unit's own loadout (DESIGN §16): an entry without loadout fields is the DEFAULT — never another player's
    // choice for the same chess id in a multi-player field (the per-battle data view maps id-only lookups); `standIn:
    // true` fields the chess as its 补位 stand-in (simdata getStandIn: the stand-in's body, the chess's identity); `diy`
    // fills a 自选 slot with its pick (simdata getDiy: the slot's identity, the operator's body, skill and module);
    // `potential` (潜能 1–6, 0.2.2) composes the def at it (never a stand-in's); `skin` (docs/SKINS.md) is the
    // appearance the owning player chose and rides through to the unit, so every client draws that model (never a rule)
    const lo = { skillIndex: inp.skillIndex ?? null, moduleId: inp.moduleId ?? null };
    if (inp.standIn === true) lo.standIn = true;
    if (inp.diy && typeof inp.diy === 'object') lo.diy = inp.diy;
    if (inp.standIn !== true && isPotential(inp.potential)) lo.potential = inp.potential;
    const def = this.data.getChess(inp.chessId, lo);
    if (!def) { this.log(`unknown chess ${inp.chessId}${lo.diy ? ' (illegal 自选 pick)' : ''}`); return null; }
    // a DIY slot has no body of its own (甄选干员): it fights only as a 自选 piece (its `diy` pick)
    if (def.raw?.isDiy && !def.diyFor) { this.log(`自选 slot ${inp.chessId} without a pick`); return null; }
    const u = this._makeAlly(ps, def, 'op', r, c, { uid: inp.uid, dir, skin: inp.skin });
    u.items = [...(inp.items ?? [])];
    u.carry = inp.carryState ?? null;
    /*
     * ⚠ **不要在这里加 `u.spine = inp.spine` / `u.skin = …`。**
     *
     * 我一度在这里插了一段"把皮肤从 input 搬到单位"的代码,以为 sim 丢了它 —— **那是错的**:
     * 这个函数**末尾**(见下面 `// 干员皮肤` 那一段)本来就在拷 `inp.skin` / `inp.skinOf`。
     * 我插的那段是重复的,而且更糟的是它**骗过了变异测试**:
     * 我把自己的那段删掉再跑自检,依然全过 —— 因为末尾那段还在起作用,
     * 于是我一度以为"自检抓不到 bug",其实是我在错误的位置做变异。
     *
     * 教训:插代码之前先 `grep` 一遍同一个函数体,确认它是不是已经有了。
     */
    /*
     * 练度 (自持有, 0.2.2): the owned operator's ×ATK / ×DEF / ×max HP (units.js Πmul) — never a 补位 stand-in's nor a
     * prototype 自选 pick's (another character than the one the player owns).
     */
    if (isCultivate(inp.cultivate) && !def.standInFor && !def.raw?.diyProto) {
      const mul = typeof this.data.cultivateMul === 'function' ? this.data.cultivateMul(inp.cultivate) : null;
      if (mul) { u.cultivate = inp.cultivate; u.cultMul = Object.freeze({ ...mul }); u.markDirty(); }
    }
    /*
     * 危机合约的干员减益 (shared/contractEffects.js `opStatMul`)。
     *
     * 「临阵磨枪 / 训练不足 / 恢复期 / 重伤残」把干员的 ×ATK / ×DEF / ×max HP 压下去(0.9 → 0.5)。
     * 接在 `cultMul` 上而不是 `mods`:那一项在 `units.js _recalc` 里与 buff / 潜能各自独立相乘,
     * 而且 `maxHp` / `atk` / `def` 都带**不低于基础值**的下限,所以纯减益不会被翻成增益。
     *
     * ⚠ 必须**无条件**施加 —— 上面那个 `if` 只在有练度时才装 `cultMul`,而减益对每个自家干员都成立
     * (补位 / 自选编队也一样,它们只是不能改练度,不是不该吃合约)。
     */
    /*
     * ⚠ 倍率挂在**玩家输入**上(`ps.input.contractOpStatMul`),不是**单位**上 ——
     * 这个函数的 `inp` 是单位,`battleInput()` 把合约那一段放在它返回的玩家对象里。
     * 第一版读 `inp.contractOpStatMul`,于是恒为 undefined、减益完全不生效(实测面板一点没动)。
     */
    const contractOp = (ps && ps.input && ps.input.contractOpStatMul) || (this.data && this.data.contractOpStatMul);
    if (contractOp && (contractOp.atk !== 1 || contractOp.def !== 1 || contractOp.hp !== 1)) {
      const prev = u.cultMul || { atk: 1, def: 1, hp: 1 };
      u.cultMul = Object.freeze({ atk: prev.atk * contractOp.atk, def: prev.def * contractOp.def, hp: prev.hp * contractOp.hp });
      u.markDirty();
    }
    // 干员皮肤 (docs/SKINS.md): the skin this piece wears. It rides on the UNIT (not the def) because the def is
    // cached per (chessId, loadout) and shared by every player fielding that chess — two players may skin the same
    // operator differently. snapshot.js unitInfo() puts it back on the wire, and the client resolves the model.
    //
    // ⚠ `skinOf` 必须**一起拷贝**:自选编队上场时模型画的是被选中的干员,而皮肤要按归属 id 查目录
    // (`public/js/assets.js spineEntry`)。这里只拷 `skin` 的话,`unitInfo` 再想带 `skinOf` 也没有 ——
    // 皮肤在战斗里静默退回默认模型。这里是整条链的最后一环,漏了它前面全白做。
    if (typeof inp.skin === 'string' && inp.skin) {
      u.skin = inp.skin;
      if (typeof inp.skinOf === 'string' && inp.skinOf) u.skinOf = inp.skinOf;
    }
    return u;
  }

  /**
   * Token def: an inline def (PlayerBattleInput `def`, spawnToken `opts.def`) as given, else the data record's variant
   * for the owner — `owner` = the owning ally unit (its chess and its selected skill / module: getToken(id,
   * owner.defId, owner.def.loadout), DESIGN §16), a chess id, or null.
   */
  _tokenDef(tokenId, owner, inline) {
    if (inline) return normalizeToken(tokenId, inline);
    if (!this.data.getToken) return null;
    if (owner && typeof owner === 'object') return this.data.getToken(tokenId, owner.defId ?? null, owner.def?.loadout ?? null);
    return this.data.getToken(tokenId, owner ?? null);
  }

  _makeAlly(ps, def, kind, r, c, extra = {}) {
    const st = def.stats;
    const u = new Unit({
      id: ++this._idSeq, side: 'ally', kind, def, defId: def.id, name: def.name, ownerId: ps ? ps.playerId : null,
      uid: extra.uid ?? null, ownerUnit: extra.ownerUnit ?? null, skin: extra.skin ?? null, x: c, y: r, tileR: r, tileC: c,
      dir: extra.dir != null ? normDir(extra.dir) : extra.facing != null ? normDir(extra.facing) : ps ? ps.dir : 'RIGHT',
      base: {
        maxHp: st.maxHp, atk: st.atk, def: st.def, res: st.res, aspd: st.aspd, bat: st.bat, blockCnt: st.blockCnt,
        moveSpeed: 0, spRecovery: st.spRecovery, tauntLevel: st.tauntLevel, massLevel: st.massLevel,
        hpRecoveryPerSec: st.hpRecoveryPerSec, cost: st.cost, respawnTime: st.respawnTime,
      },
    });
    if(kind==='op')u.contractRedeployMul=ps?.input?.contractRedeployMul||1;
    if(kind==='op' && ps?.bandId==='band_closur' && ps.input?.closurDebt>0) { u.debtPenalty=.9; u.markDirty(); }
    u.alive = false;
    u.deployed = false;
    u.items = [];
    u.rangeGrid = def.rangeGrid;
    u.player = ps;
    this.units.push(u);
    this.allyUnits.push(u);
    if (ps) ps.units.push(u);
    return u;
  }

  /** Resolve kit/profile/skill for a unit (called by content/index.js; safe to call again). */
  _setupUnit(u, kit = null) {
    if (!kit) {
      try { kit = setupUnitKit(this, u, this.contentMode); } catch (e) {
        if (e?.contentFault || this.contentFault) throw e;
        this._internalError('setupUnitKit', e);
        kit = null;
      }
    }
    u.kit = kit || {};
    u.profile = resolveProfile(u.def, u.kit.trait || null);
    if (u.def.untargetable) this.addBuff(u, { key: 'trait:untargetable', flags: { untargetable: true }, persist: true, allowDead: true });
    // abnormal effects a summon holds (tokens.json `abnormal`, PRTS; user playtest #6 item 18): 禁疗 — no heal reaches it;
    // 孤立 ("无法被同阵营选中") — no ally heal or ally selection (auras over a range) reaches it
    const ab = u.def.abnormal;
    if (Array.isArray(ab) && ab.length) {
      const flags = {};
      if (ab.includes('healFree')) flags.noHeal = true;
      if (ab.includes('isolated')) { flags.isolated = true; flags.noHeal = true; }
      if (Object.keys(flags).length) this.addBuff(u, { key: 'trait:abnormal', flags, persist: true, allowDead: true });
    }
    const spec = u.kit.skill || null;
    u.skill = new SkillRuntime(this, u, u.def.skill, spec, u.def.skill?.bb ?? {});
    if (u.profile.install && !u._profInstalled) {
      u._profInstalled = true;
      this._safe(() => u.profile.install(this, u), 'profile.install', u);
    }
    for (const t of u.kit.talents || []) {
      if (t && typeof t.install === 'function') this._safe(() => t.install(this, u), 'talent.install', u);
    }
    if (typeof u.kit.install === 'function') this._safe(() => u.kit.install(this, u), 'kit.install', u);
    // trait lines the ENGINE owns for every operator (content/traitMods.js: the module attack-speed riders whose
    // condition is a pure function of the field — 「攻击范围内存在N名及以上敌人时攻击速度+X」). Runs after kit.install:
    // a kit that implements its own line for this trait is never double-counted — traitMods.js refuses every condition
    // shape a kit already owns (`reason: 'kit'`), and the kits whose line it DOES take over (the two REA-Y ones) had
    // their hand-written copy deleted in the same change. Calling it before kit.install would let a kit's own buff and
    // this rule both land on the same unit.
    this._safe(() => installTraitAttackSpeed(this, u), 'traitMods.attackSpeed', u);
    return u.kit;
  }
}
