// Standalone adaptations are described alongside native blackboards in tools/data/rogue-leaders.mjs.
import { T,hurt,elem,areaAllies,targetsNear,watchDeaths,castSlot } from './helpers.js';
import { skill,unblockable,onHitStatus,ep,reborn,nthAttackPower,nthAttackStatus,blinkForward,taunt } from './archetypes.js';
import { alive,adds,friends,target,stop } from './additional-leader-helpers.js';
const near=(b,e)=>targetsNear(b,e,e.base.rangeRadius||3);
const rust=ab=>[unblockable(),{spawn(b,e){b.addBuff(e,{key:'rogue:arrival',duration:5,flags:{invulnerable:true},visible:true});}},
 skill(ab.sk.CriticalHit,(b,e)=>{const u=near(b,e)[0];if(u)hurt(b,e,u,e.s.atk*(ab.sk.CriticalHit.bb.atk_scale??3),'arts');},{cond:(b,e)=>near(b,e).length>0})];
const snow=female=>ab=>[{
 spawn(b,e){watchDeaths(b,e);e.mem.rogueSnowInherited=false;},
 dealt(c,b,e){if((female||e.mem.rogueSnowInherited)&&c.dmg.isAttack)b.applyStatus(c.target,'cold',{source:e,duration:T(ab,'combat.attack@freeze')??5});},
 hitOut(c,_b,e){if((!female||e.mem.rogueSnowInherited)&&c.dmg.isAttack&&c.target.s.flags.freeze)c.dmg.amount*=T(ab,'damagescaletofrozen.atk_scale')??2.5;},
 otherDeath(c,b,e){if(c.reason!=='killed'||c.unit?.defId!==(female?'enemy_2015_csicem':'enemy_2014_csicer')||e.mem.rogueSnowInherited)return;
  e.mem.rogueSnowInherited=true;b.addBuff(e,{key:'rogue:snowInherited',persist:true,mods:{aspd:T(ab,'triggerrage.attack_speed')??100,moveMul:1+(T(ab,'triggerrage.move_speed')??2)},visible:true});},
}];
const carmen=ab=>[{
 spawn(b,e){e.mem.rogueAmmo={value:e.def.raw.spData?.initSp??3,max:e.def.raw.spData?.maxSp??3,check:b.time+35,reload:0};e.profile.melee=false;e.profile.blockFree=true;},
 before(_c,_b,e,a){a.loaded=e.mem.rogueAmmo.value>0;},
 hitOut(c,_b,_e,a){if(a.loaded&&c.dmg.isAttack)c.dmg.amount*=ab.sk.Fire?.bb.atk_scale??2;},
 attack(_c,b,e,a){if(a.loaded){e.mem.rogueAmmo.value--;castSlot(b,e,ab.sk.Fire);if(!e.mem.rogueAmmo.value){e.profile.melee=true;e.profile.blockFree=false;}}},
 tick(b,e){const m=e.mem.rogueAmmo;
  if(m.reload){if(!e.canAct){m.reload=0;e.profile.noAttack=false;b.applyStatus(e,'stun',{duration:T(ab,'Stun.stun')??10,source:e});return;}
   if(b.time+1e-9>=m.reload){m.reload=0;m.value=m.max;e.profile.noAttack=false;e.profile.melee=false;e.profile.blockFree=true;b.removeBuff(e,'rogue:reload');}}
  else if(b.time+1e-9>=m.check){m.check=b.time+(T(ab,'Reload.interval')??35);if(m.value===0){m.reload=b.time+3;e.profile.noAttack=true;b.addBuff(e,{key:'rogue:reload',duration:3,flags:{noMove:true}});castSlot(b,e,ab.sk.Charge,3);}}
 },
}];
const pathshaper=ab=>[{
 spawn(_b,e,a){a.attacks=0;a.hits=0;},
 attack(_c,b,e,a){a.attacks++;if(a.attacks%((ab.sk.Summon?.sp??2)+1)===0){castSlot(b,e,ab.sk.Summon);adds(b,e,'enemy_2033_syboys',1,T(ab,'SummonMark.limit_amount')??8);}},
 taken(_c,b,e,a){if(++a.hits%(T(ab,'SummonMark.damage_counter')??10)===0)adds(b,e,'enemy_2033_syboys',1,T(ab,'SummonMark.limit_amount')??8);},
}];
const fractal=ab=>[{
 spawn(b,_e,a){a.n=0;a.until=b.time+(T(ab,'Suicide.duration')??90);},
 attack(_c,b,e,a){if(++a.n%((ab.sk.Summon?.sp??2)+1)!==0)return;const root=e.mem.additionalParent?b.enemies.find(u=>u.id===e.mem.additionalParent):e;if(alive(root))adds(b,root,'enemy_2033_syboys',1,8);},
 tick(b,e,a){if(b.time>=a.until)b.kill(e);},
}];
const bubble=ab=>[ep('erosion',T(ab,'Attack.attack@ep_damage_ratio')??.6),reborn({dur:5,onReborn(_b,e){e.mem.rogueBubble2=true;}}),{
 spawn(b,e){b.addBuff(e,{key:'rogue:hover',persist:true,flags:{float:true}});},
 dealt(c,b,e){const n=e.mem.rogueBubble2?5:3,list=near(b,e);for(let i=1;i<n;i++){const u=list[i%Math.max(1,list.length)]||c.target;hurt(b,e,u,e.s.atk,e.base.dmgType);elem(b,e,u,'erosion',e.s.atk*(T(ab,'Attack.attack@ep_damage_ratio')??.6));}},
 iv:.5,tick(b,e){for(const u of near(b,e))b.addBuff(u,{key:'rogue:bubbleSlow',duration:.6,mods:{aspd:T(ab,e.mem.rogueBubble2?'SlowDown2.attack_speed':'SlowDown.attack_speed')??-60}});},
}];
const snowpriest=ab=>[onHitStatus('cold',T(ab,'Attack.attack@freeze')??4.5),{
 dealt(c,b,e){const list=targetsNear(b,e,99).filter(u=>u!==c.target),hit=new Set([c.target]);let last=c.target,scale=1;
  for(let i=1;i<(T(ab,'Attack.attack@chain.max_target')??4);i++){
   const u=list.filter(u=>!hit.has(u)&&(u.x-last.x)*(u.x-last.x)+(u.y-last.y)*(u.y-last.y)<=(T(ab,'Attack.attack@projectile_range')??2.1)*(T(ab,'Attack.attack@projectile_range')??2.1)).sort((a,z)=>((a.x-last.x)*(a.x-last.x)+(a.y-last.y)*(a.y-last.y))-((z.x-last.x)*(z.x-last.x)+(z.y-last.y)*(z.y-last.y))||a.id-z.id)[0];
   if(!u)break;scale*=T(ab,'Attack.attack@chain.atk_scale')??.85;hurt(b,e,u,e.s.atk*scale,e.base.dmgType);b.applyStatus(u,'cold',{source:e,duration:T(ab,'Attack.attack@freeze')??4.5});b.fx('beam',{id:e.id,from:last.id,to:u.id});hit.add(u);last=u;
  }
 },
},skill(ab.sk.ChainBuff,(b,e)=>{for(const u of friends(b,e).slice(0,ab.sk.ChainBuff.bb['chain.max_target']??4))b.addBuff(u,{key:'rogue:chainBuff',duration:ab.sk.ChainBuff.bb.duration??10,mods:{aspd:ab.sk.ChainBuff.bb.attack_speed??100,moveMul:1+(ab.sk.ChainBuff.bb.move_speed??1)},visible:true});},{sil:true,cond:(b,e)=>friends(b,e).length>0})];
const vine=ab=>[nthAttackStatus((ab.sk.StunAttack?.sp??2)+1,'stun',ab.sk.StunAttack?.bb.stun??15,false,ab.sk.StunAttack),{
 taken(c,b,e){if(!c.source&&c.dmg.tags?.includes('environment'))b.addBuff(e,{key:'rogue:environmentWeak',duration:T(ab,'Weak.weak[limit]')??10,mods:{dmgTakenMul:T(ab,'Weak.damage_scale')??2},visible:true});},
}];
const lamia=ab=>[ep('apoptosis',T(ab,'1.attack@ep_damage_ratio')??.2),{death(c,b,e){if(c.reason==='killed')for(const u of adds(b,e,'enemy_2073_skzrck',1,1)){u.lpr=0;u.base.lpr=0;u.profile.noAttack=true;stop(b,u);}}}];
const goliath=ab=>{const cost=ab.sk.PowerAttack?.sp??3,power=nthAttackPower(cost+1,ab.sk.PowerAttack?.bb.atk_scale??1.5,null,0,ab.sk.PowerAttack);
 return[{before(_c,_b,e){if(e.mem.rogueGoliathReady){power.n=cost;e.mem.rogueGoliathReady=false;}}},power,{dealt(c,_b,e){if(power.power&&!c.target.alive)e.mem.rogueGoliathReady=true;}}];};
const brother=(b,key)=>b.enemies.some(u=>alive(u)&&u.defId===key);
const spear=ab=>[taunt(1),{iv:.2,tick(b,e){const blocker=e.blockedBy,scale=brother(b,'enemy_2114_dylbgg')?(T(ab,'1.lb_damage_scale')??2):(T(ab,'1.damage_scale')??1.5);
 if(blocker){b.addBuff(e,{key:'rogue:spearWeak',duration:.25,mods:{physTakenMul:scale,artsTakenMul:scale}});b.addBuff(blocker,{key:'rogue:spearWeak:'+e.id,duration:.25,mods:{physTakenMul:scale,artsTakenMul:scale}});}
}}];
const blade=ab=>[skill(ab.sk.WindMove,(b,e)=>{const dur=brother(b,'enemy_2114_dylbgg')?(ab.sk.WindMove.bb.lb_duration??4):(ab.sk.WindMove.bb.duration??2);e.mem.rogueWindEnd=b.time+dur;e.mem.rogueWindNext=b.time;b.addBuff(e,{key:'rogue:wind',duration:dur,flags:{unblockable:true},mods:{moveMul:1+(ab.sk.WindMove.bb.move_speed??2)},visible:true});b._unblock(e);},{cond:(_b,e)=>!!e.blockedBy}),{
 tick(b,e){if(b.time<(e.mem.rogueWindEnd||0)&&b.time>=(e.mem.rogueWindNext||0)){e.mem.rogueWindNext=b.time+(T(ab,'WindDamage.interval')??1);for(const u of areaAllies(b,e,e.x,e.y,T(ab,'WindDamage.range_radius')??1.2))hurt(b,e,u,e.s.atk*(T(ab,'WindDamage.atk_scale')??.8),'phys');}},
}];
const swords=ab=>[{
 iv:.2,tick(b,e){if(brother(b,'enemy_2110_dyyrzf')||brother(b,'enemy_2112_dyhlgy'))b.addBuff(e,{key:'rogue:brotherShield',duration:.25,mods:{physTakenMul:1-(T(ab,'GlobalDyBuff.damage_resistance')??.4),artsTakenMul:1-(T(ab,'GlobalDyBuff.damage_resistance')??.4)}});},
},skill(ab.sk.FirstAid,(b,e)=>{const list=b.enemies.filter(u=>alive(u)&&['enemy_2110_dyyrzf','enemy_2112_dyhlgy','enemy_2114_dylbgg'].includes(u.defId));const u=list.sort((a,z)=>a.hpRatio-z.hpRatio||a.id-z.id)[0];if(!u)return;b.heal(e,u,e.s.atk*(ab.sk.FirstAid.bb.heal_scale??5));for(const key of ['stun','cold','freeze','silence','slow','disarm','fear','bind'])b.removeStatus(u,key);})];
const hank=ab=>[{
 spawn(_b,e){e.profile.ignoreStealth=true;e.profile.ignoreCamou=true;},
 hitOut(c,_b,e){if(c.dmg.isAttack&&e.blockedBy===c.target)c.dmg.amount*=T(ab,'CombatSet.attack@atk_scale_combat')??2;},
 dealt(c,b,e){if(e.blockedBy===c.target)hurt(b,e,c.target,e.s.atk*(T(ab,'CombatSet.attack@atk_scale_combat')??2),'phys');},
},skill(ab.sk.Blink,(b,e)=>blinkForward(b,e,ab.sk.Blink.bb.dist??1.5),{sil:true,cond:(_b,e)=>!!e.blockedBy}),
 skill(ab.sk.Shining,(b,e)=>{const u=target(b,e);if(!u)return;const x=u.x,y=u.y,delay=ab.sk.Shining.bb.projectile_delay_time??15;b.fx('telegraph',{id:e.id,x,y,r:1.5,dur:delay});
  b.after(delay,()=>{if(!alive(e))return;for(const v of b.allyUnits.filter(v=>alive(v)&&(v.x-x)*(v.x-x)+(v.y-y)*(v.y-y)<=2.25)){b.addBuff(v,{key:'rogue:flare',duration:5,flags:{reveal:true}});hurt(b,e,v,e.s.atk,'phys',{ignoreSelect:true});}b.fx('explode',{id:e.id,x,y,r:1.5});},{owner:e});
 },{cond:(b,e)=>!!target(b,e)})];
const elbert=ab=>[skill(null,(b,e)=>{const u=target(b,e);if(!u)return;const x=u.x,y=u.y,flight=.6;
 b.fx('trainingFire',{id:e.id,x:e.x,y:e.y,to:u.id,tx:x,ty:y,dur:flight});
 b.after(flight,()=>{if(!alive(e))return;b.fx('trainingFireHit',{id:e.id,x,y});for(const v of areaAllies(b,e,x,y,1)){hurt(b,e,v,1000,'arts');elem(b,e,v,'apoptosis',200);}},{owner:e});
 },{cd:T(ab,'DamageAura.duration')??10,icd:1,cond:(b,e)=>!!target(b,e)}),
 skill(ab.sk.Blink,(b,e)=>blinkForward(b,e,1.5)),{
 death(c,b,e){if(c.reason!=='killed')return;for(const u of friends(b,e))b.addBuff(u,{key:'rogue:elbertStaff',duration:10,mods:{aspd:T(ab,'Die.attack_speed')??50,moveMul:1+(T(ab,'Die.move_speed')??1.5)},visible:true});},
}];
export const ROGUE_LEADER_KITS=Object.freeze({enemy_2006_flsnip:rust,enemy_2014_csicer:snow(true),enemy_2015_csicem:snow(false),enemy_2026_syudg:carmen,
 enemy_2130_dyswrd:()=>[{dealt(_c,b,e){b.kill(e);}}],
 enemy_2033_syboys:fractal,
 enemy_2031_syboy:pathshaper,enemy_2037_sygirl:bubble,enemy_2051_smsha2:snowpriest,enemy_2053_smgia2:vine,
 enemy_2071_skzdny:lamia,enemy_2074_skzgly:goliath,enemy_2110_dyyrzf:spear,enemy_2112_dyhlgy:blade,enemy_2114_dylbgg:swords,enemy_2138_shdbjg:hank,enemy_2143_shwksc:elbert});
