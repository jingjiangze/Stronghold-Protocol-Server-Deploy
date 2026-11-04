// Isolated demonstration harness. Each side runs its native enemy/boss controller in its own Battle.
// Opponents are non-attacking projections: damage, statuses and buffs resolve on the real opposing controller.
// This keeps enemy scripts' ally/enemy queries valid without changing production combat or operator rules.
import { buildBattleSpec, createBattleFromSpec } from './spec.js';
import { makeDamageInfo } from './damage.js';
import { unitInfo } from './snapshot.js';
import { GEO } from '../../shared/constants.js';
import { Grid } from './grid.js';
export const MIRROR_BOSSES = Object.freeze(['enemy_1544_cledub', 'enemy_1524_bldkgt', 'enemy_1571_mirbst', 'enemy_1505_frstar', 'enemy_2157_shadvr', 'enemy_1533_stmkgt', 'enemy_1515_bsnake']);
const globalId = (side, id) => (side + 1) * 100000 + id;
const mirrorX = x => 20 - x;
const isProjection = u => !!u?.mem?.mirrorSource;

export class MirrorArena {
  constructor(data, { enemyKey = MIRROR_BOSSES[0], stageId = 'act1autochess_m01', seed = 1 } = {}) {
    if (!MIRROR_BOSSES.includes(enemyKey)) throw new RangeError('mirror enemy');
    this.enemyKey = enemyKey; this.time = 0; this.events = []; this.projections = [new Map(), new Map()];
    this.raw = data.raw || data.data || null;
    const def = data.getEnemy(enemyKey);
    if (!def) throw new RangeError('missing mirror enemy');
    const floor = { height: 'LOW', build: 'ALL', pass: 'ALL', key: 'tile_road' };
    this.stage = { id: stageId, name: 'Mirror arena', size: { rows: 13, cols: 21 }, rows: Array.from({ length: 13 }, () => '.'.repeat(21)), tiles: { '.': floor }, legend: { '.': floor }, devices: [], mapChars: [], special: {} };
    this.battles = [0, 1].map(side => {
      const formal = enemyKey === 'enemy_1515_bsnake';
      const stage = data.getStage(stageId);
      const deviceOverrides = Object.fromEntries((stage?.devices || []).filter(d => d.alias).map(d => [d.alias, false]));
      const spec = buildBattleSpec({ battleId: 'mirror-' + side, fieldId: 'boss-mirror', kind: 'boss', round: 18, modeId: 'mode_single_abyss',
        stageId, seed, rect: GEO.BOSS_RECT, flags: { dpPerSec: 0, startOpCooldown: 0 },
        players: [{ playerId: 'mirror-' + side, side: 'L', units: [], bonds: {}, deviceOverrides }],
        spawns: [{ enemyKey, time: 0, count: 1, pos: [3, 15], routeIndex: 0, ...(formal ? { tag: 'boss', countInTotal: false } : {}) }],
        routes: [{ start: [3, 15], end: [3, 2], motion: 'WALK', checkpoints: [] }],
        bossId: formal ? 'boss_11' : null, boss: formal ? { poolHp: def.maxHp, poolMax: def.maxHp } : null });
      const battle = createBattleFromSpec(spec, data, { quiet: true });
      battle.autoFinish = false;
      battle.stage = this.stage; battle.grid = new Grid(this.stage, battle.rect);
      battle._spawnStageDevices = () => {};
      // A duel spans the full symmetric arena; normal multiplayer half-field ownership is inapplicable here.
      battle.on('enemySpawn', ({ enemy }) => { if (enemy.defId === 'enemy_1515_bsnake') { enemy.profile.zoneBounds = { ...battle.rect }; enemy.profile.canTarget = null; } }, { priority: -10000 });
      return battle;
    });
    for (let side = 0; side < 2; side++) this.bridge(side);
    for (const battle of this.battles) battle.start();
    // Native queues spawn on tick 1. Controllers that create objectives run here before opposing projections exist.
    for (const battle of this.battles) battle.step();
    this.sync(); this.time = this.battles[0].time; this.collect();
  }

  projection(side, source) {
    if (!source) return null;
    if (isProjection(source)) return source.mem.mirrorSource;
    let proxy = this.projections[side].get(source.id);
    if (proxy) return proxy;
    const b = this.battles[side], ps = b.players[0];
    const stats = source.s;
    const def = { type: 'chess', id: 'mirror-proxy-' + source.defId, charId: null, name: source.name, raw: {},
      subProfessionId: 'fighter', profession: 'WARRIOR', position: 'MELEE', rangeGrid: [[0, 0]], skill: null,
      stats: { maxHp: stats.maxHp, atk: 0, def: stats.def, res: stats.res, aspd: 100, bat: 2, blockCnt: 99,
        spRecovery: 0, tauntLevel: 0, massLevel: source.base.massLevel, hpRecoveryPerSec: 0, cost: 0, respawnTime: 99999 },
      spine: source.def.spine || source.defId, immune: source.def.immune, talents: [], items: [] };
    proxy = b._makeAlly(ps, def, 'op', Math.round(source.y), Math.round(mirrorX(source.x)), { uid: globalId(1 - side, source.id), dir: 'RIGHT' });
    b._setupUnit(proxy, { trait: { noAttack: true } });
    proxy.alive = true; proxy.deployed = true; proxy.ground = true; proxy.deploySeq = ++b._deploySeq;
    proxy.profile.noAttack = true; proxy.mem.mirrorSource = source; proxy.mem.mirrorSide = 1 - side;
    for (const key of ['hp', 'hidden', 'deployed', 'form']) Object.defineProperty(proxy, key, { configurable: true,
      get: () => source[key], set: value => { source[key] = value; } });
    Object.defineProperty(proxy, 's', { configurable: true, get: () => ({ ...source.s, blockCnt: 99 }) });
    Object.defineProperty(proxy, 'alive', { configurable: true, get: () => source.alive, set: () => {} });
    Object.defineProperty(proxy, 'removed', { configurable: true, get: () => !source.alive || source.removed, set: () => {} });
    Object.defineProperty(proxy, 'x', { configurable: true, get: () => mirrorX(source.x), set: value => { source.x = mirrorX(value); } });
    Object.defineProperty(proxy, 'y', { configurable: true, get: () => source.y, set: value => { source.y = value; } });
    this.projections[side].set(source.id, proxy);
    return proxy;
  }

  bridge(side) {
    const b = this.battles[side], other = this.battles[1 - side];
    const nativeDamage = b.dealDamage.bind(b), nativeBuff = b.addBuff.bind(b), nativeStatus = b.applyStatus.bind(b);
    const nativeKill = b.kill.bind(b), nativeLoss = b.loseHp.bind(b);
    b.dealDamage = (source, target, input) => {
      if (!isProjection(target)) return nativeDamage(source, target, input);
      const real = target.mem.mirrorSource;
      if (!real.alive || real.hidden || !real.deployed || real.s.flags.invulnerable) return 0;
      const dmg = input?._norm ? { ...input } : makeDamageInfo(input);
      if (dmg.type !== 'element' && b._hooks.hit) b.emit('hit', { source: dmg.sourceless ? null : source, target, dmg, credit: source });
      if (dmg.cancel) return 0;
      const amount = other.dealDamage(this.projection(1 - side, source), real, dmg);
      if (source?.stats) source.stats.dmg += amount;
      if (dmg.type !== 'element' && b._hooks.damaged) b.emit('damaged', { source: dmg.sourceless ? null : source, target, amount, type: dmg.type, dmg, credit: source });
      return amount;
    };
    b.addBuff = (target, buff) => isProjection(target) ? other.addBuff(target.mem.mirrorSource, { ...buff, source: this.projection(1 - side, buff.source) }) : nativeBuff(target, buff);
    b.applyStatus = (target, key, opts = {}) => isProjection(target) ? other.applyStatus(target.mem.mirrorSource, key, { ...opts, source: this.projection(1 - side, opts.source) }) : nativeStatus(target, key, opts);
    b.kill = (target, source) => isProjection(target) ? other.kill(target.mem.mirrorSource, this.projection(1 - side, source)) : nativeKill(target, source);
    b.loseHp = (target, amount, opts = {}) => isProjection(target) ? other.loseHp(target.mem.mirrorSource, amount, { ...opts, source: this.projection(1 - side, opts.source) }) : nativeLoss(target, amount, opts);
  }

  sync() {
    for (let side = 0; side < 2; side++) {
      const b = this.battles[side];
      for (let k = 0; k < b._occ.length; k++) if (isProjection(b._occ[k])) b._occ[k] = null;
      for (const enemy of this.battles[1 - side].enemies) if (enemy.alive) {
        const proxy = this.projection(side, enemy);
        proxy.tileR = Math.round(enemy.y); proxy.tileC = Math.round(mirrorX(enemy.x));
        proxy.blockWeight = enemy.blockWeight || 1;
        if (b.grid.inRect(proxy.tileR, proxy.tileC)) b._occ[proxy.tileR * 21 + proxy.tileC] ||= proxy;
      }
    }
  }
  root(side) { return this.battles[side].enemies.filter(e => e.defId === this.enemyKey).at(-1) || null; }
  get errors() { return this.battles.flatMap(b => b.errors || []); }
  step() {
    this.sync();
    for (const b of this.battles) if (!b.finished) b.step();
    this.sync(); this.time = Math.max(...this.battles.map(b => b.time)); this.collect();
  }
  unitId(side, id) {
    const unit = this.battles[side].units.find(u => u.id === id);
    return isProjection(unit) ? globalId(1 - side, unit.mem.mirrorSource.id) : globalId(side, id);
  }
  info(side, info) {
    return { ...info, id: globalId(side, info.id), uid: null, side: side ? 'enemy' : 'ally', kind: 'enemy', boss: false,
      facing: side ? info.facing : -(info.facing || 1), dir: side ? info.dir : info.dir === 'LEFT' ? 'RIGHT' : info.dir === 'RIGHT' ? 'LEFT' : info.dir,
      ...(Number.isFinite(info.x) ? { x: side ? info.x : mirrorX(info.x) } : {}),
      ...(Number.isFinite(info.col) ? { col: side ? info.col : mirrorX(info.col) } : {}) };
  }
  event(side, ev) {
    const out = [...ev], id = v => this.unitId(side, v), x = v => side ? v : mirrorX(v);
    if (ev[0] === 'spawn') {
      const u = this.battles[side].units.find(u => u.id === ev[1]?.id);
      if (isProjection(u)) return null;
      out[1] = this.info(side, ev[1]);
    } else if (ev[0] === 'atk') { out[1] = id(ev[1]); out[2] = id(ev[2]); }
    else if (ev[0] === 'fx') {
      out[2] = x(ev[2]); const extra = { ...ev[4] };
      for (const key of ['id', 'src', 'source', 'target', 'from', 'to']) if (typeof extra[key] === 'number') extra[key] = id(extra[key]);
      for (const key of ['x', 'fromX', 'fx', 'tx', 'x0', 'toX', 'targetX', 'originX', 'col', 'c', 'fromC', 'toC']) if (Number.isFinite(extra[key])) extra[key] = x(extra[key]);
      if (!side) {
        for (const key of ['dx', 'dc', 'facing']) if (Number.isFinite(extra[key])) extra[key] *= -1;
        if (extra.side === 'L' || extra.side === 'R') extra.side = extra.side === 'L' ? 'R' : 'L';
        if (Number.isFinite(extra.c0) && Number.isFinite(extra.c1)) { const c0 = extra.c0; extra.c0 = mirrorX(extra.c1); extra.c1 = mirrorX(c0); }
      }
      if (Array.isArray(extra.targets)) extra.targets = extra.targets.map(id);
      if (Array.isArray(extra.tiles)) extra.tiles = extra.tiles.map(([r, c]) => [r, x(c)]);
      out[4] = extra;
    } else if (['dmg', 'heal', 'die', 'status', 'skill', 'deploy', 'engage'].includes(ev[0])) {
      const unit = this.battles[side].units.find(u => u.id === ev[1]);
      if (isProjection(unit) && ['deploy', 'die'].includes(ev[0])) return null;
      out[1] = id(ev[1]);
    } else return null;
    return out;
  }
  collect() { for (let side = 0; side < 2; side++) for (const ev of this.battles[side].drainEvents()) { const e = this.event(side, ev); if (e) this.events.push(e); } }
  drainEvents() { const events = this.events; this.events = []; return events; }
  snapshot() {
    const base = this.battles[0].snapshot();
    const units = this.battles.flatMap((b, side) => b.snapshot().units.filter(u => !isProjection(b.units.find(a => a.id === u[0]))).map(u => {
      const out = [...u]; out[0] = globalId(side, u[0]); out[1] = side ? u[1] : mirrorX(u[1]); return out;
    }));
    return { ...base, fieldId: 'boss-mirror', t: this.time, units, boss: null };
  }
  fieldMeta() {
    const base = this.battles[0].fieldMeta();
    return { ...base, fieldId: 'boss-mirror', units: this.battles.flatMap((b, side) => b.enemies.map(u => this.info(side, unitInfo(u)))), boss: null };
  }
  breakObjectives() { for (const b of this.battles) for (const e of b.enemies.slice()) if (e.alive && e.mem.leaderObjective) b.kill(e); this.sync(); this.collect(); }
  reduceHp() {
    for (let side = 0; side < 2; side++) { const e = this.root(side); if (e?.alive) this.battles[side].dealDamage(null, e, { amount: e.s.maxHp * 0.25, type: 'true', canDodge: false }); }
    this.collect();
  }
}
