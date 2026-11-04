import { DataSource } from './simdata.js';
import { buildBattleSpec, createBattleFromSpec } from './spec.js';
import { GEO } from '../../shared/constants.js';
import { PURSUER_KEY, PURSUER_RULES, demoPursuerSkill } from './content/bosses/pursuer.js';

/** Isolated skill stage; all operator stat changes below exist only in this data overlay. */
export class PursuerArena {
  constructor(data, { compiledSpec = null, seed = 20261021 } = {}) {
    const normal = Object.values(data.raw.chess).filter(u => !u.isGolden && !u.isDiy);
    const records = [normal.find(u => u.charId === 'char_4145_ulpia'), normal.find(u => u.charId === 'char_2015_dusk'),
      normal.find(u => u.charId === 'char_103_angel'), normal.find(u => u.subProfessionId === 'artsfghter')];
    if (records.some(u => !u)) throw Error('Pursuer demo operators missing');
    const chess = Object.fromEntries(records.map((record, i) => {
      const id = `studio_pursuer_target_${i}`, ground = i === 0 || i === 3;
      return [id, { ...structuredClone(record), chessId: id, charId: null, spine: record.charId, avatar: record.charId,
        skill: null, skills: [], talents: [], demoGround: ground, demoArts: i === 1 || i === 3,
        stats: { ...record.stats, maxHp: 100000, atk: 0, def: 0, res: 0, blockCnt: ground ? 99 : 0,
          cost: 0, respawnTime: 10, hpRecoveryPerSec: 0 } }];
    }));
    this.data = new DataSource({ chess }, data); this.fieldId = 'pursuer-demo'; this.lastAction = null;
    const units = sign => [
      { row: 3, col: sign < 0 ? 4 : 16 }, { row: 4, col: sign < 0 ? 7 : 13 },
      { row: 2, col: sign < 0 ? 6 : 14 }, { row: 2, col: sign < 0 ? 5 : 15 },
    ].map((p, i) => ({ ...p, chessId: `studio_pursuer_target_${i}`, uid: (sign < 0 ? 1 : 5) + i,
      abs: true, dir: sign < 0 ? 'RIGHT' : 'LEFT' }));
    const players = [{ playerId: 'left', side: 'L', units: units(-1) }, { playerId: 'right', side: 'R', units: units(1) }];
    const stageId = compiledSpec?.stageId || 'act1autochess_m01', pool = compiledSpec?.boss?.poolMax || 4800000;
    const spec = compiledSpec ? { ...structuredClone(compiledSpec), battleId: this.fieldId, fieldId: this.fieldId,
      players, flags: { ...compiledSpec.flags, startOpCooldown: 0, dpPerSec: 0 } }
      : buildBattleSpec({ battleId: this.fieldId, fieldId: this.fieldId, kind: 'boss', round: 14, modeId: 'mode_multi_hard',
        stageId, seed, rect: GEO.BOSS_RECT, players, bossId: 'boss_pursuer', boss: { poolHp: pool, poolMax: pool },
        flags: { startOpCooldown: 0, dpPerSec: 0 }, routes: [{ motion: 'WALK', start: [4, 9], end: [1, 3], checkpoints: [] },
          { motion: 'WALK', start: [4, 11], end: [1, 17], checkpoints: [] }],
        spawns: [{ enemyKey: PURSUER_KEY, time: 0, count: 1, pos: [4, 9], routeIndex: 0, tag: 'boss', countInTotal: false,
          mods: { atkMul: 2.143589, speedMul: 1, slot: 'N' } }] });
    this.stage = data.getStage(stageId).raw || data.rawStage(stageId);
    this.battle = createBattleFromSpec(spec, this.data, { quiet: true }); this.battle.autoFinish = false;
    this.battle._spawnStageDevices = () => {}; this.battle.start(); this.configureTargets(); this.step();
  }
  get time() { return this.battle.time; }
  get errors() { return this.battle.errors || []; }
  bodies() { return this.battle.enemies.filter(u => u.alive && u.defId === PURSUER_KEY).sort((a, b) => a.mem.pursuer.sign - b.mem.pursuer.sign); }
  configureTargets() {
    for (const u of this.battle.allyUnits) {
      u.profile.noAttack = true; u.ground = !!u.def.raw.demoGround;
      if (u.def.raw.demoArts) u.profile.dmgType = 'arts';
      this.battle.addBuff(u, { key: 'studio:stationary', persist: true, allowDead: true, flags: { noMove: true, noDisplace: true } });
    }
  }
  step() { this.battle.step(); }
  fieldMeta() { return { ...this.battle.fieldMeta(), fieldId: this.fieldId }; }
  snapshot() { return this.battle.snapshot(); }
  drainEvents() { return this.battle.drainEvents(); }
  restoreTargets() {
    for (const u of this.battle.allyUnits) { if (!u.alive) this.battle._deploy(u); u.hp = u.s.maxHp; }
    this.configureTargets(); return true;
  }
  trigger(kind, side = 0) {
    const bodies = this.bodies().filter(e => !side || e.mem.pursuer.sign === side);
    let n = 0;
    for (const e of bodies) {
      if (kind === 'hit') {
        const source = this.battle.allyUnits.find(u => u.alive && (u.x - 10) * e.mem.pursuer.sign > 0);
        this.battle.dealDamage(source || null, e, { amount: 500, type: 'arts', isSkill: true }); n++;
      } else if (kind === 'rebirth') {
        if (e.mem.pursuer.phase === 0) { this.battle.kill(e, null); n++; }
        break;
      } else {
        const result = demoPursuerSkill(this.battle, e, kind); if (result) n += Number(result);
        if (kind === 'army') break;
      }
    }
    this.lastAction = { kind, n }; return n;
  }
  resetCooldowns() {
    for (const e of this.bodies()) {
      const s = e.mem.pursuer; s.dodgeReady = this.time; s.nextAssassination = this.time + PURSUER_RULES.assassinationEvery; s.nextCloak = this.time + PURSUER_RULES.cloakEvery;
      for(const key of ['pursuer:dodge','pursuer:cloak','pursuer:dodge:invulnerable','pursuer:cloak:invulnerable'])this.battle.removeBuff(e,key);
    }
  }
  combo() {
    if (this.bodies().some(e => e.mem.pursuer.phase !== 0)) return false;
    this.resetCooldowns(); this.trigger('hit');
    this.battle.after(3.2, () => this.trigger('assassinate'));
    this.battle.after(5, () => { this.restoreTargets(); this.trigger('rebirth'); });
    this.battle.after(12.6, () => this.restoreTargets());
    this.battle.after(15, () => this.trigger('army'));
    this.battle.after(17, () => this.trigger('cloak'));
    return true;
  }
}
