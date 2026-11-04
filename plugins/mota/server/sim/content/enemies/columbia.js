import {T,hurt,targetsNear,byPriority,areaAllies,castSlot} from './helpers.js';
import {capEnemyBurstHit} from '../../../../shared/enemyPressure.js';
import {skill,unblockable,maxTargets,setFloat,blockWeight} from './archetypes.js';
import {SPECIAL_KITS} from './special.js';import{LEADER_KITS}from'./leaders.js';
import {present,spawnOwned,channel} from './compatibility-helpers.js';
const armour=e=>/^enemy_125[456]_/.test(e.defId);
const defence=ab=>[{spawn(_b,_e,_a,a){a.hitShield=T(ab,'Shield.max_block_damage_cnt')??1;}}];
const engineer=ab=>[skill(ab.sk.Charge,(b,e)=>{const u=b.enemiesInRadius(e.x,e.y,3).filter(x=>present(x)&&armour(x)&&x.hp<x.s.maxHp).sort((a,z)=>a.hpRatio-z.hpRatio||a.id-z.id)[0];if(!u)return;
 const dur=ab.sk.Charge?.bb.hit_duration??10;const cast=channel(b,e,'columbia:repair',dur,{},false);const life=u.deploySeq;
 for(let i=1;i<=dur;i++)b.after(i,()=>{if(!cast.cancelled&&present(e)&&present(u)&&u.deploySeq===life&&!e.s.flags.stun)b.heal(e,u,u.s.maxHp*(ab.sk.Charge?.bb.hp_ratio??.05));},{owner:e});
},{cond:(b,e)=>b.enemiesInRadius(e.x,e.y,3).some(x=>present(x)&&armour(x)&&x.hp<x.s.maxHp)})];
const driver=ab=>[{
 hitIn(c,_b,e){if(!e.blockedBy&&['phys','arts'].includes(c.dmg.type))c.dmg.mul*=1-(T(ab,'DamageReduce.damage_resistance')??0);},
 iv:.1,tick(b,e){const u=b.enemiesInRadius(e.x,e.y,.5).find(x=>present(x)&&armour(x)&&!x.mem.columbiaCharged);if(!u)return;u.mem.columbiaCharged=true;const n=T(ab,'Driver.sp')??50;for(const a of u.mem.ab?.list||[])if(a.cd!=null)a.left=Math.max(0,a.left-n);b.heal(e,u,u.s.maxHp*Math.min(1,n/100));b.fx('buff',{id:u.id,x:u.x,y:u.y,kind:'armourCharge'});b._remove(e,'consumed');},
}];
const heavy=ab=>[skill(ab.sk.Punch,(b,e,a)=>{const u=e.blockedBy;if(!present(u))return;const s=ab.sk.Punch,dur=s?.bb.duration??10;a.left=(s?.cd??20)+dur+1;b._unblock(e);const cast=channel(b,e,'columbia:overload',dur+1,{unblockable:true});castSlot(b,e,s,dur);const life=u.deploySeq;
 for(let i=1;i<=dur;i++)b.after(i,()=>{if(cast.cancelled||!present(e)||!present(u)||u.deploySeq!==life||e.s.flags.stun||e.s.flags.silence)return;hurt(b,e,u,capEnemyBurstHit(b,e,e.s.atk*(s?.bb.atk_scale??.75),Math.floor(dur)),'phys');b.applyStatus(u,'stun',{duration:s?.bb.stun??2,source:e});b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip:'Skill_Loop'});},{owner:e});
},{sil:true,cond:(_b,e)=>present(e.blockedBy)&&!e.blockedBy.isFlying})];
const assault=ab=>[maxTargets(4),{hitOut(c,_b,e){if(c.dmg.isAttack&&c.target!==e.blockedBy)c.dmg.amount*=T(ab,'Passive.attack@ranged.atk_scale')??.5;}}];
const city=ab=>[{
 sil:true,dealt(c,b){b.addBuff(c.target,{key:'columbia:blockCut',duration:T(ab,'ReduceBlockCnt.duration')??3,mods:{blockCnt:T(ab,'ReduceBlockCnt.normal_block_cnt')??-1},visible:true});},
}];
const police=ab=>[...city(ab),{spawn(b,e){b.addBuff(e,{key:'columbia:policeEntrance',duration:T(ab,'Invisible.invisible_duration')??4,flags:{stealth:true},mods:{moveMul:1+(T(ab,'Invisible.move_speed')??1.1)}});}}];
const rocket=()=>[{
 silAware:true,
 tick(b,e,a){const on=e.s.moveSpeed>e.base.moveSpeed+1e-6&&!e.s.flags.silence;if(on===a.on)return;a.on=on;setFloat(b,e,on);b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip:on?'Fly_Begin':'Fly_End'});},
}];
const rush=ab=>[blockWeight(3),{
 iv:.1,tick(b,e,a){a.touching||=new Set();const now=new Set();for(const u of targetsNear(b,e,.7)){now.add(u.id);if(!a.touching.has(u.id)&&!e.s.flags.stun&&!e.s.flags.sleep&&!e.s.flags.freeze)hurt(b,e,u,capEnemyBurstHit(b,e,(T(ab,'Rush.atk_scale')??800)*(T(ab,'Rush.rush_damage')??.4)*e.s.moveSpeed,2),'phys');}a.touching=now;},
 hitOut(c,b,e){if(c.dmg.isAttack)c.dmg.amount=capEnemyBurstHit(b,e,(T(ab,'Combat.atk_scale')??800)*Math.max(T(ab,'Combat.rush_damage')??.4,e.s.moveSpeed),2);},
}];
const crossing=ab=>[{
 spawn(_b,e,a){e.profile.noAttack=true;a.left=e.s.interval;},tick(b,e,a,dt){a.left-=dt;if(a.left>0||!e.canAct)return;a.left+=e.s.interval;for(const u of areaAllies(b,e,e.x,e.y,3)){if(Math.min(Math.abs(u.x-e.x),Math.abs(u.y-e.y))>.4)continue;const close=(u.x-e.x)*(u.x-e.x)+(u.y-e.y)*(u.y-e.y)<=1;hurt(b,e,u,capEnemyBurstHit(b,e,e.s.atk*(T(ab,close?'AttackTrigger.attack@CloseAttack':'AttackTrigger.attack@FourDirAttack')??.5)),'arts');}b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip:'Attack'});},
}];
const terminal=ab=>[blockWeight(4),{
 silAware:true,
 taken(c,b,e,a){if(!(c.amount>0)||c.dmg?.type==='element')return;a.n=Math.min(T(ab,'passive.max_stack_cnt')??110,(a.n||0)+1);const max=T(ab,'passive.max_stack_cnt')??110;b.addBuff(e,{key:'columbia:terminalDecay',persist:true,mods:{defFlat:(T(ab,'passive.def')??-5500)*a.n/max,resFlat:(T(ab,'passive.magic_resistance')??-110)*a.n/max}});},
 death(c,b,e){if(c.reason!=='killed'||e.s.flags.silence)return;spawnOwned(b,e,ab.tS['passive.enemy_key']||(e.defId.endsWith('_2')?'enemy_1333_cbbgen_2':'enemy_1333_cbbgen'),1,{cap:1,totalCap:1});for(const u of areaAllies(b,e,e.x,e.y,1.5))hurt(b,e,u,capEnemyBurstHit(b,e,e.s.atk*(T(ab,'Boom.atk_scale')??2)),'phys');b.fx('explode',{id:e.id,x:e.x,y:e.y,r:1.5,kind:'terminal'});},
}];
const dorothy=ab=>[unblockable(),skill(ab.sk.PlaceTrap,(b,e)=>{
 const s=ab.sk.PlaceTrap,u=byPriority(e,targetsNear(b,e,99))[0];if(!u)return;
 const mines=e.mem.columbiaMines||=[];if(mines.filter(x=>!x.done).length>=8)return;
 const zoneId=`${e.id}:${e.mem.columbiaMineSerial=(e.mem.columbiaMineSerial||0)+1}`;
 const mine={x:u.x,y:u.y,done:false,zoneId};mines.push(mine);
 b.fx('zone',{id:e.id,zoneId,x:mine.x,y:mine.y,r:s?.bb.range_radius??.3,dur:30,kind:'dorothyTrap'});
 b.fx('dorothyTrapStart',{id:e.id,zoneId,x:mine.x,y:mine.y});
 // No owner on this timer: a placed mine remains active after Dorothy dies.
 let age=0;const timer=b.every(.1,()=>{
  age+=.1;const list=age>=.5?areaAllies(b,e,mine.x,mine.y,s?.bb.range_radius??.3):[];
  if(!list.length&&age<30)return;
  timer.cancel();mine.done=true;b.fx('enemyZoneEnd',{id:e.id,zoneId,x:mine.x,y:mine.y,kind:'dorothyTrap'});
  if(!list.length)return;
  for(const v of list){
   b.fx('dorothyTrapHit',{id:e.id,zoneId,target:v.id,x:v.x,y:v.y});
   hurt(b,e,v,e.s.atk*(s?.bb.atk_scale??1.5),'arts');b.applyStatus(v,'stun',{duration:s?.bb.stun??10,source:e});
  }
  if(e.alive)b.addBuff(e,{key:'columbia:trapPower',persist:true,refresh:'stack',maxStacks:s?.bb.max_stack_cnt??50,mods:{atkPct:s?.bb.atk??.1}});
 });
},{cond:(b,e)=>targetsNear(b,e,99).length>0})];
const families=[['enemy_1249_lysdb',defence],['enemy_1250_lyengs',engineer],['enemy_1251_lysyta',driver],['enemy_1252_lysytb',driver],['enemy_1253_lysytc',driver],['enemy_1255_lybgpa',heavy],['enemy_1256_lyacpa',assault],['enemy_1326_cbagen',city],['enemy_1327_cbrokt',rocket],['enemy_1330_cbrush',rush],['enemy_1331_cbsisy',crossing],['enemy_1332_cbterm',terminal],['enemy_1333_cbbgen',police]];
export const COLUMBIA_KITS=Object.freeze(Object.fromEntries([...families.flatMap(([key,fn])=>[[key,fn],[key+'_2',fn]]),['enemy_1257_lydrty',dorothy],['enemy_1328_cbjedi_2',LEADER_KITS.enemy_1328_cbjedi],['enemy_1329_cbshld',SPECIAL_KITS.enemy_1329_cbshld],['enemy_1329_cbshld_2',SPECIAL_KITS.enemy_1329_cbshld_2]]));
