// Native blackboards drive combat. Explicit ordinary-field changes are documented in tools/data/additional-leaders.mjs.
import {T, hurt, elem, targetsNear, areaAllies, setForm} from './helpers.js';
import {skill, unblockable, reborn, nthAttackStatus} from './archetypes.js';
import {alive, friends, phase2, ranged, target, stop, strike, dot, objective, objectives, adds, nextForm, lives} from './additional-leader-helpers.js';

const mephi = _ab => [{
  spawn(b, e, a) { e.profile.noAttack = true; a.left = 0; }, iv: .25,
  tick(b, e, a, dt) {
    if (!e.canAct) return;
    for (const u of friends(b, e)) b.addBuff(u, {key: `additional:mephi:${e.id}`, duration: .5, mods: {hpRegen: u.base.hpRecoveryPerSec || 0}});
    a.left -= dt; if (a.left > 0) return; a.left = e.s.bat || 6;
    for (const u of friends(b, e).filter(u => u.hpRatio < 1).sort((a, z) => a.hpRatio - z.hpRatio || a.id - z.id).slice(0, 3)) b.heal(e, u, e.s.atk);
  },
}];
const faust = ab => [unblockable(), {
  spawn(b, e) { ranged(e, 99, 'phys'); b.addBuff(e, {key: 'additional:faustEntry', duration: 5, flags: {invulnerable: true}}); },
  before(c, b, e) { e.profile.atkScale = e.mem.faustCritical ? ab.sk.CriticalHit.bb.atk_scale : 1; },
  attack(c, b, e) { e.mem.faustCritical = false; },
}, skill(ab.sk.CriticalHit, (b, e) => { e.mem.faustCritical = true; }),
skill(ab.sk.SummonBallis, (b, e) => { if (objectives(e).length < 3) objective(b, e, {key:'trap_007_ballis',name: '浮士德的弩炮', attack: true, hp: 4000}); })];
const singer = ab => {
  const poison = (b, e) => {
    for (const u of targetsNear(b, e, 99)) b.addBuff(u, {key: `additional:singerDust:${e.id}`, duration: 30,
      refresh: 'stack', stacks: 1, maxStacks: 5, interval: 1,
      onTick: ({buff}) => { if (alive(e)) hurt(b, e, u, (ab.sk.Poison?.bb.damage ?? 50) * buff.stacks, 'true'); },
    });
    b.fx('explode', {id: e.id, x: e.x, y: e.y, r: 5, kind: 'poison'});
  };
  return [unblockable(), {
    spawn(b, e, a) { e.profile.noAttack = true; a.threshold = .8; }, iv: 1,
    tick(b, e) {
      if (e.mem.singerSleep || e.mem.additionalRebirthing) return;
      for (const u of friends(b, e).filter(u => /宿主/.test(u.name))) b.addBuff(u, {key: `additional:singer:${e.id}`, duration: 1.2,
        mods: {atkPct: phase2(e) ? .2 : .1, aspd: phase2(e) ? 20 : 10}});
    },
    taken(c, b, e, a) { while (e.hpRatio <= a.threshold && a.threshold > 0 && !e.mem.singerSleep) { poison(b, e); a.threshold -= phase2(e) ? .15 : .2; } },
  }, skill(ab.sk.Heal, (b, e) => { for (const u of friends(b, e).filter(u => /宿主/.test(u.name))) b.heal(e, u, e.s.atk); }, {cond: (b, e) => !e.mem.singerSleep}),
  lives({delay: 2.6, onPhase(b, e) {
    e.mem.singerSleep = true; e.profile.noAttack = true;
    b.addBuff(e, {key: 'additional:singerSleep', duration: 15, mods: {defFlat: 2200, resFlat: 50, hpRegen: 200}, flags: {noMove: true},
      onExpire: () => { e.mem.singerSleep = false; e.profile.noAttack = true; for (const a of e.mem.ab.list) if (a.threshold != null) a.threshold = .85; nextForm(b, e, 3, {atkPct: .2}); },
    });
    e.hp = e.s.maxHp * .5;
  }, hpRatio: .5})];
};
const evolution = ab => [{
  spawn(b, e, a) { stop(b, e); e.profile.noAttack = true; a.phase = 1; a.time = 0; a.summon = 5; a.blast = 32; }, iv: 1,
  tick(b, e, a, dt) {
    a.time += dt;
    const threshold = a.phase === 1 ? .6 : .2;
    if (a.phase < 3 && (e.hpRatio <= threshold || a.time >= 35)) {
      a.phase++; a.time = 0; a.blast = a.phase === 3 ? 5 : 15; nextForm(b, e, a.phase);
      b.addBuff(e, {key: 'additional:evolveInv', duration: 3, flags: {invulnerable: true}});
    }
    if (--a.summon <= 0) { a.summon = a.phase === 1 ? 5 : a.phase === 2 ? 3 : 2; adds(b, e, a.phase === 1 ? 'enemy_1137_plasm' : 'enemy_1138_tumor', 2); }
    if (--a.blast <= 0) { a.blast = a.phase === 1 ? 32 : a.phase === 2 ? 15 : 10; for (const u of targetsNear(b, e, 99)) hurt(b, e, u, 500 + a.phase * 100, 'true'); }
    if (a.phase === 3) b.loseHp(e, T(ab, 'mode_3.damage') ?? 300, {source: e});
  },
  hitIn(c, b, e, a) {
    if (!['phys', 'arts'].includes(c.dmg.type)) return;
    if (a.phase === 3) c.dmg.mul *= .01;
    else if (c.source && (a.phase === 1 ? c.source.x < e.x : c.source.x > e.x)) c.dmg.mul *= .2;
  },
}];
const captain = ab => {
  const encourage = (b, e) => { for (const u of friends(b, e)) b.addBuff(u, {key: `additional:captain:${e.id}`, duration: 10, mods: {aspd: 100, moveMul: 1.5}}); };
  return [{
    spawn(b, e) { ranged(e, 3, 'phys'); b.on('death', ({unit, killer}) => { if (unit.side === 'ally' && killer === e && phase2(e)) encourage(b, e); }); },
    dealt(c, b, e) { if (!phase2(e)) elem(b, e, c.target, 'erosion', e.s.atk * .3); },
    death(c, b, e) { encourage(b, e); },
  }, reborn({dur: 3.5, invincible: 5, onReborn(b, e) { nextForm(b, e, 2, {aspd: 30}); }}),
  skill(ab.sk.SummonFcanon, (b, e) => { if (objectives(e).length < 2) objective(b, e, {key:'trap_041_fcanon',name: '潘乔的支援炮', attack: true}); }, {cond: (b, e) => !phase2(e)}),
  skill(ab.sk.SummonBmbmot, (b, e) => adds(b, e, 'enemy_1164_bmbmot_3', 1, 4), {cond: (b, e) => !phase2(e)}),
  skill(ab.sk.WaterCannon, (b, e) => { const u = target(b, e, 'maxHp'); if (!u) return; dot(b, e, u, {key: 'additional:water', duration: 5, amount: () => e.s.atk * .2});
    for (let i = 1; i <= 5; i++) b.after(i, () => { if (alive(e) && alive(u)) elem(b, e, u, 'erosion', e.s.atk * .2); }, {owner: e});
  }, {cond: (b, e) => !phase2(e)}),
  skill(ab.sk.BurstShoot, (b, e) => { const u = target(b, e, 'def'); if (u) { strike(b, e, u, .5, 0, 'phys'); b.addBuff(u, {key: `additional:captainDef:${e.id}`, duration: 10, mods: {defPct: -.5}}); } }, {cond: (b, e) => phase2(e)}),
  {attack(c, b, e, a) { if (phase2(e) && ((a.n = (a.n || 0) + 1) % 3 === 0)) for (const u of areaAllies(b, e, e.x, e.y, 2)) { hurt(b, e, u, e.s.atk, 'phys'); elem(b, e, u, 'erosion', e.s.atk * .3); } }}];
};
const knight = _ab => [{
  taken(c, b, e) { if (alive(c.source) && c.source.side === 'ally') b.applyStatus(c.source, 'cold', {source: e, duration: e.hpRatio < .5 ? 4 : 2}); },
  hitOut(c, _b, _e) { if (c.dmg.isAttack && c.target?.s.flags.freeze) c.dmg.amount *= 1.75; },
}, reborn({dur: 5, hpRatio: .25, onReborn(b, e) {
  nextForm(b, e, 2, {moveMul: 1.5}); b.addBuff(e, {key: 'additional:knightCharge', persist: true, flags: {unblockable: true}});
}})];
const wood = ab => [nthAttackStatus(1, 'cold', T(ab, 'Attack.attack@freeze') ?? 4.5, false), {
  spawn(b, e, a) { a.thresholds = [.7, .4, .1]; },
  taken(c, b, e, a) {
    if (!a.thresholds.length || e.hpRatio > a.thresholds[0]) return;
    a.thresholds = a.thresholds.filter(t => e.hpRatio > t);
    e.profile.noAttack = true;
    const beforeImmune = ab.immune;
    ab.immune = new Set([...(beforeImmune || []),'bind','slow','sluggish']);
    b._unblock(e); setForm(b, e, 'demon');
    for (const u of areaAllies(b, e, e.x, e.y, 2)) b.applyStatus(u, 'cold', {source: e, duration: 5});
    b.addBuff(e, {key: 'additional:woodDemon', duration: 3, flags: {unblockable: true}, mods: {moveMul: 3, physTakenMul: .2, artsTakenMul: .2},
      onExpire: () => { if (alive(e)) { e.profile.noAttack = false; ab.immune = beforeImmune; setForm(b, e, null); for (const u of areaAllies(b, e, e.x, e.y, 2)) b.applyStatus(u, 'cold', {source: e, duration: 5}); } },
    });
  },
}, skill(null, (b, e) => { for (const u of areaAllies(b, e, e.x, e.y, 2)) b.applyStatus(u, 'cold', {source: e, duration: 4.5}); }, {cd: 5, icd: 5})];

export const ADDITIONAL_CORE_KITS = Object.freeze({
  enemy_1507_mephi: mephi, enemy_1508_faust: faust, enemy_1514_smephi: singer,
  enemy_1519_bgball: evolution, enemy_1522_captan: captain,
  enemy_2038_sydonq: knight, enemy_2055_smlead: wood,
});
