// Other-leader adaptations for ordinary battlefields. Scene-device omissions and timing adaptations are in the data.
import {T,hurt,areaAllies,targetsNear,byPriority,zone,castSlot} from './helpers.js';
import {reborn,skill,unblockable,nthAttackStatus} from './archetypes.js';
const present=u=>u?.alive&&u.deployed&&!u.removed;
const ranged=(e,r)=>{e.profile.melee=false;e.base.rangeRadius=r;e.markDirty();};
const immune=['stun','freeze','cold','sleep','levitate'];
const blood=ab=>{
 const s=ab.sk.BloodPool;
 return[{
  hitIn(c,b,e){if((e.blockedBy&&c.source===e.blockedBy)||c.dmg.type==='element'||c.dmg.type==='elemental')return;c.dmg.amount*=e.mem.otherPhase2?(T(ab,'Passive2.damage_scale')??.5):(T(ab,'Passive.damage_scale')??.75);}
 },reborn({dur:T(ab,'Reborn.duration')??.5,hpRatio:T(ab,'Reborn.hp_ratio')??.5,invincible:T(ab,'Passive2.invincible_time')??6,onReborn(b,e){e.mem.otherPhase2=true;ranged(e,e.def.raw.stats.rawRangeRadius>0?e.def.raw.stats.rawRangeRadius:2.5);b.addBuff(e,{key:'other:bloodRage',persist:true,mods:{atkPct:T(ab,'Passive2.atk')??.5}});}}),
 skill(s,(b,e)=>{const target=e.blockedBy;if(!present(target))return;const duration=s?.bb.stun??10;b.applyStatus(target,'stun',{source:e,duration});const x=target.x,y=target.y;
  zone(b,{x,y,r:.7,life:duration,iv:s?.bb.interval??1,kind:'blood',id:e.id,pick:()=>areaAllies(b,e,x,y,.7),tick:units=>{for(const u of units)hurt(b,e,u,s?.bb.damage??200,'arts');}});
 },{cond:(b,e)=>present(e.blockedBy)})];
};
const martyr=ab=>{
 const smoke=(b,e)=>{const x=e.x,y=e.y;zone(b,{x,y,r:1.5,life:180,iv:.5,kind:'smoke',id:e.id,pick:()=>b.enemiesInRadius(x,y,1.5),tick:units=>{for(const u of units)b.addBuff(u,{key:'other:martyrSmoke',duration:.6,mods:{dodgePhys:T(ab,'SmokeBomb.prob')??.5,dodgeArts:T(ab,'SmokeBomb.prob')??.5,physTakenMul:T(ab,'SmokeBomb.damage_scale')??.7,artsTakenMul:T(ab,'SmokeBomb.damage_scale')??.7}});}});};
 const noon=ab.sk.NoonArrived;
 return[unblockable(),{
  spawn(b,e,a){e.mem.martyrAmmo=5;e.mem.martyrNextSmoke=.5;},
  before(c,b,e,a){a.charged=e.mem.martyrAmmo>0;},
  hitOut(c,b,e,a){if(a.charged&&c.dmg.isAttack)c.dmg.amount*=ab.sk.BounceAttackP1?.bb.atk_scale??1.5;},
  dealt(c,b,e,a){if(!a.charged||!c.dmg.isAttack||!present(c.target))return;const seen=new Set([c.target.id]);let from=c.target;
   for(let i=0;i<4;i++){const next=byPriority(e,areaAllies(b,e,from.x,from.y,2)).find(u=>!seen.has(u.id));if(!next)break;seen.add(next.id);hurt(b,e,next,e.s.atk*(ab.sk.BounceAttackP1?.bb.atk_scale??1.5),'phys',{canDodge:true,tags:['martyrBounce']});from=next;}
  },
  attack(c,b,e){e.mem.martyrAmmo=Math.max(0,e.mem.martyrAmmo-1);},
  taken(c,b,e,a){if(e.hpRatio>e.mem.martyrNextSmoke)return;smoke(b,e);e.mem.martyrNextSmoke-=e.mem.otherPhase2?.25:.5;},
 },reborn({dur:T(ab,'Reborn.duration')??5,onReborn(b,e){e.mem.otherPhase2=true;e.profile.noAttack=false;e.mem.martyrAmmo=5;e.mem.martyrNextSmoke=.75;e.mem.noonReady=b.time+(T(ab,'PassiveP2.recovery_time')??20);b.addBuff(e,{key:'other:martyrP2',persist:true,mods:{atkPct:T(ab,'PassiveP2.atk')??.2}});}}),
 skill(noon,(b,e)=>{const targets=byPriority(e,targetsNear(b,e,99)).sort((a,z)=>a.x-z.x||a.id-z.id).slice(0,5),delay=noon?.bb.duration??12;e.profile.noAttack=true;
  b.addBuff(e,{key:'other:noonScan',duration:delay,mods:{moveMul:0},onExpire:()=>{e.profile.noAttack=false;}});
  for(const target of targets){b.fx('telegraph',{id:e.id,x:target.x,y:target.y,r:.5,dur:delay,kind:'target'});b.after(delay,()=>{if(e.alive&&present(target))hurt(b,e,target,e.s.atk*(noon?.bb.atk_scale??2),'phys',{canDodge:true});},{owner:e});}
  b.after(delay,()=>{if(e.alive)e.mem.martyrAmmo=5;},{owner:e});
 },{cond:(b,e)=>e.mem.otherPhase2&&b.time>=(e.mem.noonReady??Infinity)})];
};
const manfred=ab=>{
 const shield=(b,e)=>b.addBuff(e,{key:'other:manfredShield',persist:true,mods:{dodgePhys:T(ab,'Shield.prob')??.8,dodgeArts:T(ab,'Shield.prob')??.8},visible:true});
 return[{
  spawn(b,e){ranged(e,e.def.raw.stats.rawRangeRadius>0?e.def.raw.stats.rawRangeRadius:2.5);e.profile.dmgType='arts';shield(b,e);},
  before(c,b,e,a){const id=c.targets[0]?.id;if(a.target!==id){b.removeBuff(e,'other:focus');a.target=id;}},
  attack(c,b,e){b.addBuff(e,{key:'other:focus',duration:T(ab,'Funnel_common.attack@duration')??6,refresh:'stack',stacks:1,maxStacks:T(ab,'Funnel_common.attack@max_stack_cnt')??5,mods:{aspd:T(ab,'Funnel_common.attack@attack_speed')??60}});},
  dealt(c,b,e){if(c.dmg.isAttack&&e.mem.otherPhase2)hurt(b,e,c.target,e.s.atk*(T(ab,'Funnel_s2.atk_scale')??.5),'phys',{canDodge:true,tags:['manfredBlade']});},
  hitIn(c,b,e){if(!c.dmg.tags?.some(tag=>tag==='cityCannon'||tag==='cannon'))return;b.removeBuff(e,'other:manfredShield');b.applyStatus(e,'stun',{source:c.source,duration:T(ab,'Shield[disable].stun')??8});b.after(T(ab,'Shield.disable_duration')??30,()=>{if(e.alive)shield(b,e);},{owner:e});},
 },reborn({dur:T(ab,'Reborn.duration')??20,invincible:T(ab,'Reborn.invincible')??5,during(b,e,a){if(b.time<(a.nextShot??a.t0))return;a.nextShot=b.time+(T(ab,'Reborn.interval')??.8);const units=targetsNear(b,e,99);if(units.length)hurt(b,e,b.rng.pick(units),e.s.atk*(ab.sk.Funnel_rage?.bb.atk_scale??.3),'arts');},onReborn(b,e){e.mem.otherPhase2=true;}})];
};
const steam=ab=>{
 const boost=(b,e,permanent=false)=>{b.removeBuff(e,'other:steamBorn');ab.immune=new Set([...(ab.immune||[]),...immune]);
  b.addBuff(e,{key:'other:steamBoost',...(permanent?{persist:true}:{duration:ab.sk.Boost?.bb.boost_duration??15}),mods:{aspd:permanent?(T(ab,'reborn.attack_speed')??100):(ab.sk.Boost?.bb.attack_speed??100),moveMul:1+(permanent?(T(ab,'reborn.move_speed')??.3):(ab.sk.Boost?.bb.move_speed??.3)),dmgTakenMul:1-(ab.sk.Boost?.bb.damage_resistance??.3)},onExpire:()=>{if(!e.mem.otherPhase2){ab.immune=new Set();b.applyStatus(e,'stun',{source:e,duration:ab.sk.Boost?.bb.stun??5});}}});
 };
 return[{
  spawn(b,e,a){a.n=0;a.bombed=false;b.addBuff(e,{key:'other:steamBorn',persist:true,mods:{aspd:T(ab,'BornWeak.attack_speed')??-50,moveMul:1+(T(ab,'BornWeak.move_speed')??-.5)}});},
  before(c,b,e,a){a.slash=(a.n+1)%5===0;if(a.slash)castSlot(b,e,ab.sk.Zantetsuken);},
  hitOut(c,b,e,a){if(a.slash&&c.dmg.isAttack)c.dmg.amount*=ab.sk.Zantetsuken?.bb.atk_scale??1.25;},
  dealt(c,b,e,a){if(!a.slash||!c.dmg.isAttack)return;for(let i=0;i<2;i++)hurt(b,e,c.target,e.s.atk*(ab.sk.Zantetsuken?.bb.atk_scale??1.25),'phys',{canDodge:true,tags:['steamSlash']});},
  attack(c,b,e,a){a.n++;},
  taken(c,b,e,a){const phase=!!e.mem.otherPhase2;if(a.bombPhase===phase||e.hpRatio>(phase?(T(ab,'TriggerHeroBomb_2.hp_ratio')??.3):(T(ab,'TriggerHeroBomb.hp_ratio')??.5)))return;a.bombPhase=phase;
   const s=ab.sk[phase?'HeroBomb[second_state]':'HeroBomb[first_state]'],targets=byPriority(e,targetsNear(b,e,99)).sort((a,z)=>z.s.maxHp-a.s.maxHp).slice(0,phase?2:1),delay=s?.bb.mark_duration??8;
   for(const target of targets){const x=target.x,y=target.y;b.fx('telegraph',{id:e.id,x,y,r:1.5,dur:delay,kind:'cannon'});
    // [ASSUMED] Five cannon impacts at 0.5s intervals use the prefab's marked target area.
    for(let i=0;i<5;i++)b.after(delay+i*.5,()=>{if(!e.alive)return;const u=areaAllies(b,e,x,y,1.5).sort((a,z)=>z.hpRatio-a.hpRatio)[0];if(u)hurt(b,e,u,e.s.atk*(s?.bb.atk_scale??.5),'arts');},{owner:e});}
  }
 },skill(ab.sk.Boost,(b,e)=>boost(b,e),{cond:(b,e)=>!e.mem.otherPhase2}),
 reborn({dur:T(ab,'reborn.duration')??8,invincible:T(ab,'reborn.stmkgt_t_state_2[reborn_invincible].duration')??15,onReborn(b,e){e.mem.otherPhase2=true;b.removeBuff(e,'other:steamBoost');boost(b,e,true);b.addBuff(e,{key:'other:steamP2',persist:true,mods:{defFlat:T(ab,'reborn.def')??-1500,resFlat:T(ab,'reborn.magic_resistance')??-40}});}})];
};
const cold=ab=>[{
 spawn(b,e){
  // [ASSUMED] Ordinary-field entry/second-life protection is 5s; the raid's 80s/30s travel gates do not fit this mode.
  b.addBuff(e,{key:'other:coldEntry',duration:5,flags:{invulnerable:true},visible:true});
  if(b._otherColdExit)return;b._otherColdExit=true;
  b.on('beforeUnitExit',({unit,permanent})=>{if(permanent||unit.side!=='ally'||unit.kind!=='op'||!unit.s.flags.freeze||unit.mem.coldExitPenalty||!b.enemies.some(n=>n.alive&&n.defId==='enemy_2007_flwitch'))return;unit.persist.redeployMul*=2;unit.mem.coldExitPenalty=true;});
  b.on('deploy',({unit})=>{if(unit?.mem.coldExitPenalty){unit.persist.redeployMul/=2;delete unit.mem.coldExitPenalty;}});
 }
},nthAttackStatus(1,'cold',T(ab,'attackfreeze.freeze')??5,false),
 skill(ab.sk.IceBurst,(b,e)=>{const s=ab.sk.IceBurst,r=e.def.raw.stats.rawRangeRadius>0?e.def.raw.stats.rawRangeRadius:2.5;for(const u of areaAllies(b,e,e.x,e.y,r)){hurt(b,e,u,e.s.atk*(s?.bb.atk_scale??1.3),'arts');b.applyStatus(u,'cold',{source:e,duration:s?.bb.freeze??10});}},{cond:(b,e)=>areaAllies(b,e,e.x,e.y,e.def.raw.stats.rawRangeRadius>0?e.def.raw.stats.rawRangeRadius:2.5).length>0}),
 reborn({dur:T(ab,'reborn.duration')??6.6,invincible:5,onReborn(b,e){e.mem.otherPhase2=true;b.addBuff(e,{key:'other:coldP2',persist:true,mods:{atkPct:T(ab,'reborn.atk')??.9,hpPct:T(ab,'reborn.max_hp')??.5}});}})];
export const OTHER_LEADER_KITS=Object.freeze({enemy_1524_bldkgt:blood,enemy_1527_martyr:martyr,enemy_1528_manfri:manfred,enemy_1533_stmkgt:steam,enemy_2007_flwitch:cold});
