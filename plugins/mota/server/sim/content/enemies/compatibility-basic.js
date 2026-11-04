// Native blackboard mechanics for the owner-expanded roster; no scene devices are created implicitly.
import {T,hurt,elem,areaAllies} from './helpers.js';
import {capEnemyBurstHit} from '../../../../shared/enemyPressure.js';
import {standby} from './standby.js';
import {artsBarrier,unbalanced,maxTargets,nthAttackPower,float as hovering} from './archetypes.js';
const alive=u=>u?.alive&&u.deployed&&!u.removed;
const blockedBuff=(key,mods)=>({iv:.1,tick(b,e){if(e.blockedBy)b.addBuff(e,{key,duration:.15,mods});}});
const vampire=ab=>[maxTargets(T(ab,'vampire.attack@max_target')??1),{dealt(c,b,e){b.heal(e,e,Math.max(0,c.amount||0)*(T(ab,'vampire.heal_scale')??0),{self:true});}}];
const mageStandby=ab=>[standby(ab)];
const duel=ab=>[{
 iv:.1,tick(b,e){if(!alive(e.blockedBy))return;b.addBuff(e,{key:'compat:duel',duration:.15,mods:{defPct:T(ab,'duel.cchmpn_t_buff_self.def')??-.7,taunt:T(ab,'duel.cchmpn_t_buff_self.taunt_level')??-1}});b.addBuff(e.blockedBy,{key:'compat:duel:'+e.id,duration:.15,mods:{defPct:T(ab,'duel.cchmpn_t_buff_blocker.def')??-.7}});},
 hitIn(c,_b,e){if(alive(e.blockedBy)&&c.source!==e.blockedBy)c.dmg.cancel=true;},
}];
const mudShield=ab=>[artsBarrier(T(ab,'shield.dynamic')??2000,{key:'compat:mudShield',whileUp:{hpPct:T(ab,'shield.max_hp')??.5,aspd:T(ab,'shield.attack_speed')??50}})];
const gangShield=ab=>{
 const breakIt=(b,e)=>{if(e.mem.compatShieldBroken)return;e.mem.compatShieldBroken=true;b.removeBuff(e,'compat:gangShield');b.addBuff(e,{key:'compat:brokenDef',persist:true,mods:{defPct:T(ab,'DefDesc.def')??-.5},visible:true});b.fx('shieldBreak',{id:e.id,x:e.x,y:e.y});};
 return[{spawn(b,e){b.addBuff(e,{key:'compat:gangShield',shield:T(ab,'Shield.dynamic')??8000,persist:true,visible:true});},tick(b,e){if(!e.findBuff('compat:gangShield')&&!e.mem.compatShieldBroken)breakIt(b,e);}},unbalanced(breakIt)];
};
const timedEvade=half=>ab=>{const refresh=(b,e,a)=>{const on=(a.until||0)>b.time&&!e.s.flags.silence;if(on===a.on)return;a.on=on;if(on)b.addBuff(e,{key:'compat:evade',duration:a.until-b.time,mods:{dodgePhys:T(ab,'Evade.prob')??1},visible:true});else b.removeBuff(e,'compat:evade');};return[{silAware:true,spawn(b,e,a){if(!half)a.until=b.time+(T(ab,'Evade.duration')??20);refresh(b,e,a);},taken(_c,b,e,a){if(!half||a.done||e.s.flags.silence||e.hpRatio>=(T(ab,'Evade.hp_ratio')??.5))return;a.done=true;a.until=b.time+(T(ab,'Evade.duration')??10);refresh(b,e,a);},tick:refresh,status(_c,b,e,a){refresh(b,e,a);}}];};
const initialEvade=timedEvade(false),halfEvade=timedEvade(true);
const robotRage=ab=>[{taken(_c,b,e,a){if(a.done)return;a.done=true;b.addBuff(e,{key:'compat:robotRage',duration:T(ab,'Rage.duration')??30,mods:{aspd:T(ab,'Rage.attack_speed')??100,moveMul:1+(T(ab,'Rage.move_speed')??1)},visible:true});}}];
const hitSprint=ab=>[{taken(_c,b,e,a){if(b.time<(a.next||0))return;a.next=b.time+(T(ab,'SpeedUp.cooldown')??5);b.addBuff(e,{key:'compat:hitSprint',duration:T(ab,'SpeedUp.duration')??2,mods:{moveMul:1+(T(ab,'SpeedUp.move_speed')??3)},visible:true});}}];
const idleSprint=ab=>[{
 spawn(b,e,a){a.last=b.time;},attack(_c,b,e,a){a.last=b.time;b.removeBuff(e,'compat:idleSprint');},
 tick(b,e,a){if(b.time-a.last>=(T(ab,'SpeedUp.duration')??5))b.addBuff(e,{key:'compat:idleSprint',duration:.2,mods:{moveMul:1+(T(ab,'SpeedUp.move_speed')??4)},visible:true});},
}];
// [ASSUMED] The popups do not expose a circle radius; use the common 1.5-tile death-blast radius.
const bombCart=candy=>ab=>[{
 sil:true,spawn(_b,e){e.profile.noAttack=true;},
 tick(b,e){if(alive(e.blockedBy)){e.mem.compatBombBlocker=e.blockedBy;b.kill(e,e.blockedBy);}},
 death(c,b,e){if(c.reason!=='killed')return;const amount=candy?(T(ab,'boom.attack@s2mode_boom_atk')??375):e.s.atk*(T(ab,'killed.atk_scale')??1),element=candy?(T(ab,'boom.attack@s2mode_ep_fire_damage')??250):e.s.atk*(T(ab,'killed.ep_damage_ratio')??.2);
  for(const u of areaAllies(b,e,e.x,e.y,1.5)){hurt(b,e,u,amount,'arts');elem(b,e,u,'burn',element);}b.fx('explode',{id:e.id,x:e.x,y:e.y,r:1.5,kind:'candyCart'});
 },
}];
const blockRes=ab=>[blockedBuff('compat:blockRes',{resFlat:T(ab,'MagicResistance.magic_resistance')??40})];
const blockDef=ab=>[blockedBuff('compat:blockDef',{defFlat:T(ab,'Def.def')??130})];
const witch=ab=>[...blockDef(ab),{
 hitOut(c,_b,e){if(c.dmg.isAttack&&c.target===e.blockedBy){c.dmg.type='phys';c.dmg.amount*=T(ab,'combat.attack@ccwitch_rage_attack.atk_scale')??4;}},
}];
const rendDef=ab=>[{sil:true,dealt(c,b,e){if(alive(c.target))b.addBuff(c.target,{key:'compat:rendDef:'+e.id,persist:true,refresh:'stack',maxStacks:1000,mods:{defFlat:T(ab,'defdown.def')??-10},visible:true});}}];
const reduceBlock=ab=>[{sil:true,dealt(c,b,_e){if(alive(c.target))b.addBuff(c.target,{key:'compat:reduceBlock',duration:T(ab,'ReduceBlockCnt.duration')??5,mods:{blockCnt:T(ab,'ReduceBlockCnt.block_cnt')??-1},visible:true});}}];
const frostHunter=ab=>[{hitOut(c){if(c.dmg.isAttack&&c.target?.s.flags.freeze)c.dmg.amount*=T(ab,'atkup.atk_scale')??1.5;}}];
const multiShot=count=>()=>[{hitOut(c,b,e){if(c.dmg.isAttack)c.dmg.amount=capEnemyBurstHit(b,e,c.dmg.amount,count);},dealt(c,b,e){for(let i=1;i<count;i++)if(alive(c.target))hurt(b,e,c.target,capEnemyBurstHit(b,e,e.s.atk,count),e.base.dmgType,{isSkill:false});}}];
const doubleMage=()=>[maxTargets(2)];
const flute=ab=>[{...nthAttackPower((ab.sk.boostAtk?.sp??2)+1,ab.sk.boostAtk?.bb.atk_scale??1.3,null,0,ab.sk.boostAtk),sil:true}];
const families=[
 ['enemy_1075_dmgswd',mageStandby],['enemy_1098_cchmpn',duel],['enemy_1091_mdhmmr',mudShield],['enemy_10114_ymgsld',gangShield],
 ['enemy_1258_durman',initialEvade],['enemy_1259_durwar',halfEvade],['enemy_1264_durgrd',robotRage],['enemy_2043_smsbr',hitSprint],['enemy_2044_smwiz',idleSprint],
 ['enemy_10037_cnvpcar',bombCart(false)],['enemy_1218_bomscr',bombCart(true)],['enemy_1114_rgrdmn',vampire],['enemy_1228_dslime',vampire],
 ['enemy_1048_hirman',blockRes],['enemy_1093_ccsbr',blockDef],['enemy_1096_ccwitch',witch],['enemy_1095_ccripr',rendDef],['enemy_1049_eagent',reduceBlock],
 ['enemy_1064_snsbr',frostHunter],['enemy_1065_snwolf',frostHunter],['enemy_1066_snbow',frostHunter],['enemy_1069_icebrk',frostHunter],
 ['enemy_1057_gansho',multiShot(3)],['enemy_10165_tjggb',multiShot(3)],['enemy_1371_ltnflu',flute],['enemy_1171_durokt',()=>[hovering()]],
];
export const COMPATIBILITY_BASIC_KITS=Object.freeze(Object.fromEntries([
 ...families.flatMap(([key,fn])=>['enemy_1114_rgrdmn','enemy_1228_dslime','enemy_1057_gansho','enemy_2043_smsbr','enemy_2044_smwiz','enemy_1064_snsbr'].includes(key)?[[key,fn]]:[[key,fn],[key+'_2',fn]]),['enemy_1038_lunmag_2',doubleMage],
]));
