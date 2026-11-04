import {hurt, elem, targetsNear, areaAllies, areaAlliesInTiles,abilityAttackFx} from './helpers.js';
import {skill, reborn, splashAttack} from './archetypes.js';
import {alive, friends, phase2, ranged, target, stop, barrier, strike, pulse, dot, objective, objectives, adds, nextForm, lives, seal} from './additional-leader-helpers.js';

const mandra = ab => {
  const shield = (b, e) => b.addBuff(e, {key: 'additional:stoneShield', persist: true, mods: {physTakenMul: .4, artsTakenMul: .4}});
  const pillar = (b, e) => objective(b, e, {key:'trap_043_dupilr',name: '蔓德拉的石柱', hp: 4500, onBreak: () => {
    b.removeBuff(e, 'additional:stoneShield'); b.removeBuff(e, 'additional:mandraFloat'); e.mem.stoneBroken = b.time + 25;
    b.applyStatus(e, 'stun', {source: e, duration: 5});
  }});
  return [{spawn(b, e) { ranged(e, 3); shield(b, e); pillar(b, e); }, iv: 1,
    tick(b, e) {
      if (e.mem.stoneBroken && b.time >= e.mem.stoneBroken) { e.mem.stoneBroken = null; shield(b, e); if (phase2(e)) b.addBuff(e, {key: 'additional:mandraFloat', persist: true, flags: {float: true, unblockable: true}}); }
      if (!objectives(e).length) pillar(b, e);
      if (phase2(e) && !e.mem.stoneBroken) for (const u of areaAllies(b, e, e.x, e.y, 1.7)) hurt(b, e, u, e.s.atk * .3, 'arts');
    },
  }, reborn({dur: 5, invincible: 3, onReborn(b, e) { nextForm(b, e, 2); shield(b, e); b.addBuff(e, {key: 'additional:mandraFloat', persist: true, flags: {float: true, unblockable: true}}); }}),
  skill(ab.sk.PetrifiedRay, (b, e) => {
    const u = target(b, e, 'atk'); if (!u) return;
    abilityAttackFx(b,e,u,'enemy');
    const mark = {until: b.time + 7.1, source: e}; u.mem.mandraRay = mark;
    dot(b, e, u, {key: 'additional:mandraRay', duration: 7.1, amount: () => e.s.atk, mods: {aspd: -u.base.aspd * .7}});
    if (!e.mem.mandraExitHook) { e.mem.mandraExitHook = true; b.on('beforeUnitExit', ({unit}) => { if (unit.mem.mandraRay?.source === e && unit.mem.mandraRay.until > b.time && alive(e)) seal(b, unit.tileR, unit.tileC, e); }); }
  }, {cd: 15, icd: 5,fxDuration:ab.sk.PetrifiedRay?.bb['mandra_ray[cd].duration']??7.1})];
};
const devourer = _ab => {
  const formMods = i => i === 2 ? {hpPct: 2, atkPct: -.15, resFlat: 30} : i === 3 ? {hpPct: 1.5, resFlat: 30, moveMul: 1.5} : {hpPct: 3, atkPct: .15, resFlat: 30, moveMul: 1.5};
  return [{spawn(b, e) { b.addBuff(e,{key:'additional:phase',persist:true,mods:{hpPct:-.6,atkPct:-1,defPct:-1,moveMul:1.2}});e.hp=e.s.maxHp;e.profile.noAttack=true;e.mem.seaRemains = []; b.on('death', ({unit, reason}) => {
    if (reason === 'killed' && unit.side === 'enemy' && unit !== e && !unit.mem.leaderObjective && /海嗣|海怪|壳海|脊海|浮海|囊海|始海|钵海|富营养/.test(unit.name)) {
      const list = e.mem.seaRemains; list.push({key: unit.defId, x: unit.x, y: unit.y}); if (list.length > 12) list.shift();
    }
  }); },
  dealt(c, b, e) { if (e.mem.additionalPhase >= 4) b.heal(e, e, c.amount * 1.4); },
  }, lives({count: 4, delay: 3, onPhase(b, e, i) {
    nextForm(b, e, i, formMods(i));
    const remains = e.mem.seaRemains.shift();
    if (remains) {
      const tank = /1152|1232/.test(remains.key), caster = /1149|1153/.test(remains.key);
      b.addBuff(e, {key: `additional:seaAdapt:${i}`, persist: true, mods: tank ? {defPct: 1, blockCnt: 1} : caster ? {resFlat: 30} : {dodgePhys: .25, dodgeArts: .25}});
      for (const u of areaAllies(b, e, remains.x, remains.y, 1.5)) { b.kill(u, e); if (!u.alive) u.respawnAt = Math.max(u.respawnAt, b.time + 5); }
    }
  }})];
};
const white = ab => [splashAttack({unblocked: false, radius: .8}), {
  spawn(b, e) { ranged(e, 3); b.addBuff(e, {key: 'additional:whiteArmor', persist: true, mods: {defFlat: 800, resFlat: 50}}); },
  dealt(c, b, e) { if (e.blockedBy) b.applyStatus(c.target, 'stun', {source: e, duration: 6}); },
}, reborn({dur: 10.5, invincible: 5,
  during(b, e, a, elapsed) {
    if (elapsed > 8 || elapsed < (a.nextFriendly ?? 0)) return; a.nextFriendly = elapsed + 1;
    const enemy = friends(b, e)[0]; if (enemy) hurt(b, e, enemy, e.s.atk, 'arts');
  },
  onReborn(b, e) { b.removeBuff(e, 'additional:whiteArmor'); nextForm(b, e, 2, {atkPct: .25}); },
}), skill(ab.sk.P1_Resonance, (b, e) => {
  const u = target(b, e); if (!u) return;
  b.fx('telegraph', {id: e.id, x: u.x, y: u.y, r: 1.5, dur: 1, kind: 'arts'});
  const r = u.tileR, c = u.tileC;
  for (let i = 1; i <= 10; i++) b.after(i, () => { if (alive(e)) for (const v of areaAlliesInTiles(b, e, r, c, 'plus', 1)) hurt(b, e, v, e.s.atk * .1, 'arts'); }, {owner: e});
}), skill(ab.sk.P1_Crazy, (b, e) => {
  for (let i = 0; i < 10; i++) b.after(i * .5, () => { if (alive(e)) { const list = targetsNear(b, e, 99); const u = list[i % Math.max(1, list.length)]; if (u) strike(b, e, u, 1, .8); } }, {owner: e});
  b.after(5, () => { if (alive(e)) b.loseHp(e, Math.min(e.hp - 1, e.s.maxHp * .25), {source: e}); }, {owner: e});
})];
const minima = ab => {
  const refresh = (b, e) => barrier(b, e, 3333, 'additional:minimaShield', 80);
  return [{spawn(b, e) { ranged(e, 3); e.profile.priority=u=>u.findBuff(`additional:minimaDot:${e.id}`)?1:0;refresh(b, e); }, iv: .5,
    tick(b, e) {
      if (phase2(e)) return;
      if (e.findBuff('additional:minimaShield')?.shield > 0) for (const u of friends(b, e).filter(u => (u.x-e.x)*(u.x-e.x)+(u.y-e.y)*(u.y-e.y)<=9)) b.addBuff(u, {key: `additional:minimaHide:${e.id}`, duration: .6, flags: {stealth: true}});
      for (const u of friends(b, e).filter(u => /无人机|机械|战车|动力装甲/.test(u.name))) b.addBuff(u, {key: `additional:minimaAura:${e.id}`, duration: .6, mods: {atkPct: .2}});
    },
    dealt(c, b, e) { if (!phase2(e)) dot(b, e, c.target, {key: 'additional:minimaDot', duration: 15, amount: () => e.s.atk * .2}); },
  }, reborn({dur: 1, onReborn(b, e) { nextForm(b, e, 2, {moveMul: 2, defFlat: -400, resFlat: -40}); e.motion = 'WALK'; e.profile.noAttack = true; b.applyStatus(e, 'stun', {source: e, duration: 5}); }}),
  skill(ab.sk.RefreshShield, refresh, {cond: (b, e) => !phase2(e)}),
  skill(ab.sk.S2, (b, e) => { const units = targetsNear(b, e, 99); units.sort((a,z)=>areaAllies(b,e,z.x,z.y,1.5).length-areaAllies(b,e,a.x,a.y,1.5).length||a.id-z.id);const u=units[0];if(u)dot(b,e,u,{key:'additional:minimaDense',duration:5,amount:()=>e.s.atk}); }, {cond: (b,e)=>!phase2(e)}),
  skill(ab.sk.S3, (b,e)=>{const units=targetsNear(b,e,99);units.sort((a,z)=>areaAllies(b,e,a.x,a.y,1.5).length-areaAllies(b,e,z.x,z.y,1.5).length||a.id-z.id);const u=units[0];if(u)b.applyStatus(u,'stun',{source:e,duration:3});}, {cond:(b,e)=>!phase2(e)})];
};
const eblana = ab => [{
  spawn(b,e){ranged(e,3);adds(b,e,'enemy_1288_duskls',2,4);},
  dealt(c,b,e){if(phase2(e))hurt(b,e,c.target,e.s.atk*.8,'arts');},
},reborn({dur:5,invincible:5,onReborn(b,e){nextForm(b,e,2,{atkPct:.3});e.profile.maxTargets=2;pulse(b,e,.8);}}),
skill(ab.sk.Chain_1,(b,e)=>{
  for(const u of targetsNear(b,e,99).slice(0,phase2(e)?2:1)){
    abilityAttackFx(b,e,u,'enemy');
    const key=`additional:eblanaChain:${e.id}`;b.addBuff(u,{key,duration:15,flags:{stun:true},visible:true,
      onRemove:()=>{if(alive(e))for(const v of areaAlliesInTiles(b,e,u.tileR,u.tileC,'plus',1)){hurt(b,e,v,e.s.atk,'arts');elem(b,e,v,'burn',e.s.atk*.3);}}});
    objective(b,e,{name:'焦竭之火',key:'enemy_1294_duchns',link:{unit:u,key},pos:[u.y,u.x],hp:2500,onBreak:()=>b.removeBuff(u,key),onClear:()=>b.removeBuff(u,key)});
  }
}),skill(ab.sk.Sacrifice_1,(b,e)=>{const units=friends(b,e).filter(u=>u.defId==='enemy_1288_duskls').slice(0,5);for(const u of units)b.kill(u,e);barrier(b,e,e.s.maxHp*.1*units.length,'additional:eblanaBarrier',30);adds(b,e,'enemy_1288_duskls',2,4);})];
const cliff = ab => [{
  spawn(b,e){ranged(e,3,'phys');},
  dealt(c,b,e){b.addBuff(c.target,{key:`additional:cliffArmor:${e.id}`,duration:6,refresh:'stack',stacks:1,maxStacks:20,mods:{defFlat:-150}});},
},reborn({dur:8,invincible:5,onReborn(b,e){nextForm(b,e,2,{atkPct:.2,aspd:100,defFlat:1000});}}),
skill(ab.sk.MarkStunAttack_S1,(b,e)=>{const u=target(b,e);if(!u)return;for(const v of areaAlliesInTiles(b,e,u.tileR,u.tileC,'plus',1))b.applyStatus(v,'stun',{source:e,duration:6});for(let i=0;i<(phase2(e)?6:3);i++)b.after(i*.3,()=>{if(alive(e)&&alive(u))strike(b,e,u,1,0,'phys');},{owner:e});}),
skill(null,(b,e)=>{const x=e.x,y=e.y;b.fx('telegraph',{id:e.id,x,y,r:1,dur:2,kind:'fire'});b.after(2,()=>{if(!alive(e))return;b.addBuff(e,{key:'additional:cliffHeat',duration:5,mods:{atkPct:-.7,defPct:-.7}});for(const u of areaAllies(b,e,x,y,1))hurt(b,e,u,e.s.atk*.5,'arts');},{owner:e});},{cd:25,icd:10})];
const harold = ab => [{
  spawn(b,e){ranged(e,3);e.mem.coldHeaters=2;
    for(let i=0;i<2;i++)objective(b,e,{key:'trap_137_winfire',name:'冰封供暖器',hp:4000,onBreak:()=>{e.mem.coldHeaters=Math.max(0,e.mem.coldHeaters-1);}});
  },
  hitIn(c,b,e){if(['phys','arts'].includes(c.dmg.type))c.dmg.mul*=e.mem.coldHeaters>0?.65:1;},
  taken(c,b,e,a){if(!phase2(e)||e.hpRatio>(a.threshold??.75))return;a.threshold=(a.threshold??.75)-.25;for(let i=0;i<1+e.mem.coldHeaters;i++)b.after(i,()=>{if(alive(e))pulse(b,e,.8);},{owner:e});},
},reborn({dur:5,onReborn(b,e){nextForm(b,e,2,{atkPct:.2,aspd:50,defFlat:500});}}),
skill(ab.sk.InspireEnemy,(b,e)=>{for(const u of friends(b,e)){b.heal(e,u,e.s.atk);b.addBuff(u,{key:`additional:harold:${e.id}`,duration:10,mods:{atkPct:.2,defPct:.2}});}}),
skill(ab.sk.ExtingushWinfire,(b,e)=>{const u=target(b,e);if(u)strike(b,e,u,1,1.5);if(objectives(e).length<2){e.mem.coldHeaters++;objective(b,e,{key:'trap_137_winfire',name:'冰封供暖器',hp:4000,onBreak:()=>{e.mem.coldHeaters=Math.max(0,e.mem.coldHeaters-1);}});}})];
const lock = ab => [{
  spawn(b,e,a){stop(b,e);ranged(e,99);e.profile.maxTargets=2;a.hits=0;b.addBuff(e,{key:'additional:lockHeal',persist:true,mods:{hpRegen:e.s.maxHp*.0025}});},
  taken(c,b,e,a){if(++a.hits>=20){a.hits=0;pulse(b,e,1.5);}},
  iv:.25,tick(b,e){e.profile.noAttack=!!(e.findBuff('additional:lockShield')?.shield>0);},
},skill(null,(b,e)=>{adds(b,e,'enemy_1002_nsabr',2,8);if(e.findBuff('additional:lockShield'))for(const u of friends(b,e))b.addBuff(u,{key:`additional:lockRush:${e.id}`,duration:5,mods:{moveMul:2}});},{cd:16,icd:12}),
skill(ab.sk.shield,(b,e)=>{barrier(b,e,e.s.maxHp*.05,'additional:lockShield',20);})];

export const ADDITIONAL_COMBAT_KITS=Object.freeze({enemy_1523_mandra:mandra,enemy_1529_dsdevr:devourer,enemy_1530_white:white,enemy_1532_minima:minima,enemy_1536_ncrmcr:eblana,enemy_1546_cliff:cliff,enemy_1549_windoc:harold,enemy_2018_csdoll:lock});
