import {T,hurt,elem,areaAllies,targetsNear,byPriority,castSlot,setForm} from './helpers.js';
import {capEnemyBurstHit} from '../../../../shared/enemyPressure.js';
import {skill,blockWeight,blinkForward} from './archetypes.js';
import {enemyAmmunition} from './sankta.js';
import {present,spawnOwned,fireNative} from './compatibility-helpers.js';
const variant=e=>e.defId.endsWith('_2');
const ammoAttack=kind=>ab=>{
 const update=e=>{if(kind==='breaker'){e.profile.melee=enemyAmmunition(e).value<=0;e.profile.blockFree=!e.profile.melee;}};
 return[{
  spawn(_b,e){enemyAmmunition(e);update(e);},
  before(_c,_b,e,a){a.loaded=enemyAmmunition(e).value>0;},
  hitOut(c,_b,_e,a){if(a.loaded&&c.dmg.isAttack&&kind==='sniper')c.dmg.amount*=T(ab,'shotbuff.attack@headshot_atk_scale')??2;},
  dealt(c,b,e,a){if(!a.loaded)return;if(kind==='mage')elem(b,e,c.target,'burn',e.s.atk*(T(ab,'shotbuff.attack@headshot_ep_damage_ratio')??1.5));
   if(kind==='breaker')for(const u of areaAllies(b,e,c.target.x,c.target.y,1))if(u!==c.target)hurt(b,e,u,e.s.atk,'phys');
  },
  attack(_c,_b,e,a){if(a.loaded)enemyAmmunition(e).value=Math.max(0,enemyAmmunition(e).value+(T(ab,'shotbuff.attack@headshot_sp')??-1));update(e);},
  tick(_b,e){update(e);},
 }];
};
const candyMerchant=ab=>[{
 spawn(_b,e){enemyAmmunition(e);},hitOut(c,_b,e){if(c.dmg.isAttack&&c.target===e.blockedBy)c.dmg.amount*=T(ab,'shotbuff.attack@combat_atk_scale')??2.5;},
},skill(ab.sk.BornCar,(b,e)=>{enemyAmmunition(e).value--;spawnOwned(b,e,variant(e)?'enemy_1218_bomscr_2':'enemy_1218_bomscr',1,{cap:3,totalCap:12});},{cond:(_b,e)=>enemyAmmunition(e).value>0})];
const crash=ab=>({
 // Collision plus the immediate contact attack share the same raw-damage budget.
 hitOut(c,b,e){if(c.dmg.isAttack)c.dmg.amount=capEnemyBurstHit(b,e,c.dmg.amount,2);},
 iv:.1,tick(b,e,a){a.touching||=new Set();const now=new Set();
  for(const u of b.allyUnits)if(present(u)&&(u.x-e.x)*(u.x-e.x)+(u.y-e.y)*(u.y-e.y)<=.64){now.add(u.id);if(!a.touching.has(u.id)&&!e.s.flags.stun&&!e.s.flags.sleep&&!e.s.flags.freeze)hurt(b,e,u,capEnemyBurstHit(b,e,e.s.atk*(T(ab,'Crash.atk_scale')??1),2),'phys');}
  a.touching=now;
 },
});
const boat=ab=>[blockWeight(3),crash(ab),{death(c,b,e){if(c.reason==='killed')spawnOwned(b,e,ab.tS['DeathRattle.enemy_key']||(variant(e)?'enemy_1160_hvyslr_2':'enemy_1160_hvyslr'),1,{cap:1,totalCap:1});}}];
const familyCar=ab=>[{killed(_c,_b,e,a){a.blocked=!!e.blockedBy;},death(c,b,e,a){if(c.reason==='killed'&&a.blocked)spawnOwned(b,e,variant(e)?'enemy_1277_sgman_2':'enemy_1277_sgman',T(ab,'DeathRattle.attack@cnt')??3,{cap:3,totalCap:3});}}];
const snowThrower=ab=>[{
 spawn(_b,e){e.profile.melee=false;e.profile.blockFree=true;},before(_c,_b,_e,a){a.loaded=!a.spent;},
 hitOut(c,_b,_e,a){if(a.loaded&&c.dmg.isAttack)c.dmg.amount*=T(ab,'FirstAttack.attack@first_atk_scale')??1.5;},
 dealt(c,b,e,a){if(!a.loaded)return;for(const u of areaAllies(b,e,c.target.x,c.target.y,1))if(u!==c.target&&(u.tileR===c.target.tileR||u.tileC===c.target.tileC))hurt(b,e,u,e.s.atk*(T(ab,'FirstAttack.attack@first_atk_scale')??1.5),'phys');},
 attack(_c,b,e,a){if(!a.loaded)return;a.spent=true;e.profile.melee=true;e.profile.blockFree=false;setForm(b,e,'form2');},
}];
const attackBlink=ab=>[{
 spawn(_b,_e,a){a.n=0;},
 before(_c,_b,_e,a){a.blink=(a.n+1)%((ab.sk.blink?.sp??2)+1)===0;},
 attack(_c,b,e,a){a.n++;if(a.blink){castSlot(b,e,ab.sk.blink);blinkForward(b,e,ab.sk.blink?.bb.dist??1.5);}},
}];
const sailorCaptain=ab=>[{
 spawn(b,e){
  (b._compatSailorCaptains||=new Set()).add(e);
  if(b._compatSailorHook)return;b._compatSailorHook=true;
  b.on('damaged',c=>{const src=c.source;if(!src||!/^enemy_10043_sailor(?:_2)?$/.test(src.defId)||!c.dmg.isAttack||!(c.amount>0)||![...b._compatSailorCaptains].some(present))return;
   // PRTS 寻险水手: one 30%-ATK erosion rider while a captain stands; multiple captains do not duplicate it.
   elem(b,src,c.target,'erosion',src.s.atk*.3);
  });
 },
 hitOut(c,_b,e){if(c.dmg.isAttack&&c.target===e.blockedBy)c.dmg.amount*=T(ab,'1.attack@combat_atk_scale')??3;},
},skill(ab.sk.SummonSailor,(b,e)=>spawnOwned(b,e,ab.sk.SummonSailor?.bs.enemy_key||(variant(e)?'enemy_10043_sailor_2':'enemy_10043_sailor'),ab.sk.SummonSailor?.bb.cnt??2,{cap:8,totalCap:32}))];
const missiles=ab=>[blockWeight(3),{
 spawn(_b,e){e.profile.noAir=true;},
},skill(ab.sk.SkyProjectile,(b,e)=>{
 const list=byPriority(e,targetsNear(b,e,1)).filter(u=>!u.s.flags.liftoff);if(!list.length)return;
 const commanded=e.buffs.some(x=>x.key.startsWith('training:command')),count=commanded?6:3,s=ab.sk.SkyProjectile;
 e.atkCd=Math.max(e.atkCd,e.s.interval);
 for(let i=0;i<count;i++){const u=list[i%list.length],x=u.x,y=u.y;b.after(i*.2,()=>{if(!present(e))return;fireNative(b,e,u,'projectile_enemy_uareap_skill',()=>{for(const v of areaAllies(b,e,x,y,1.1))if(!v.s.flags.liftoff)hurt(b,e,v,capEnemyBurstHit(b,e,e.s.atk*(s?.bb.atk_scale??.7),count),'phys',{canDodge:true});},{point:{x,y}});},{owner:e});}
},{cond:(b,e)=>targetsNear(b,e,1).some(u=>!u.s.flags.liftoff)})];
const splitter=ab=>[{
 silAware:true,
 spawn(_b,e){e.profile.noAir=true;},
 taken(_c,b,e,a){if(a.done||e.mem.compatNoSplit||e.s.flags.silence||e.hpRatio>=(T(ab,'0.hp_ratio')??.5))return;a.done=true;
  castSlot(b,e,ab.sk['0']);const ratio=e.hpRatio,off=ab.sk['0']?.bb.offset_bound??.3;
  const child=spawnOwned(b,e,e.defId,1,{cap:1,totalCap:1,pos:[e.y+b.rng.range(-off,off),e.x+b.rng.range(-off,off)]})[0];
  if(child){child.mem.compatNoSplit=true;child.hp=child.s.maxHp*ratio;}e.swing=false;e.swingTargets=null;
 },
}];
const families=[['enemy_1213_mtrsnp',ammoAttack('sniper')],['enemy_1214_mtrmgc',ammoAttack('mage')],['enemy_1216_cansld',ammoAttack('breaker')],['enemy_1217_rescar',candyMerchant],
 ['enemy_1163_hvymot',boat],['enemy_1281_sgcar',familyCar],['enemy_1388_wingnt',snowThrower],['enemy_1322_wdgyht',attackBlink],['enemy_10049_pcaptn',sailorCaptain],['enemy_10123_uareap',missiles],['enemy_1436_dsdivi',splitter]];
export const COMPATIBILITY_AMMO_KITS=Object.freeze(Object.fromEntries(families.flatMap(([key,fn])=>key==='enemy_1214_mtrmgc'?[[key,fn]]:[[key,fn],[key+'_2',fn]])));
