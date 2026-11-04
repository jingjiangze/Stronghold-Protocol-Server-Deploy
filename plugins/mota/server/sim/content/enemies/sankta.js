// Laterano/Sankta combatants. Values come from the official skill/talent blackboards and spData.
import {T,targetsNear,byPriority,hurt,castSlot} from './helpers.js';
import {skill} from './archetypes.js';
import {FLY_KITS} from './fly.js';
export const enemyAmmunition=e=>e.mem.sanktaAmmo||(e.mem.sanktaAmmo={max:e.def.raw?.spData?.maxSp??(e.defId.endsWith('_2')?7:5),value:e.def.raw?.spData?.initSp??(e.defId.endsWith('_2')?7:5)});
const ammunition=enemyAmmunition;
const usesAmmo=e=>/^enemy_(?:1008[78]_|121[3467]_)/.test(e.defId);
const sword=ab=>[{
 iv:T(ab,'SkillTrigger.interval')??6,
 spawn(b,e){ammunition(e);},
 tick(b,e){const ammo=ammunition(e);if(ammo.value<=0)return;ammo.value--;
  const s=ab.sk.ForeverEnhance?.bb||{};castSlot(b,e,ab.sk.ForeverEnhance);b.addBuff(e,{key:'ab:enhance',refresh:'stack',stacks:1,maxStacks:T(ab,'SkillTrigger.max_stack_cnt')??15,persist:true,mods:{moveFlat:(s.move_speed_add??0)*e.base.moveSpeed,atkPct:s.atk_add??0}});
 }
}];
const sniper=ab=>[{
 silAware:true,
 spawn(b,e,a){const ammo=ammunition(e);ammo.max=1;ammo.value=Math.min(1,ammo.value);a.firstReady=b.time+(ab.sk.Sniping?.icd??5);e.profile.noAttack=true;},
 attack(c,b,e){const ammo=ammunition(e);ammo.value=Math.max(0,ammo.value-1);},
 tick(b,e,a){const ammo=ammunition(e);
  if(ammo.value>0){if(a.reloading){a.reloading=false;b.removeBuff(e,'sankta:reload');}e.profile.noAttack=b.time<a.firstReady;return;}
  if(e.s.flags.silence){a.reloading=false;e.profile.noAttack=true;b.removeBuff(e,'sankta:reload');return;}
  // Owner: the real ammo-empty reload state permits walking; normal shot wind-up/recovery, blocking and control still stop movement.
  if(!a.reloading){a.reloading=true;e.profile.noAttack=true;b.addBuff(e,{key:'sankta:reload',persist:true});
   // [ASSUMED] The stage prefab's post-shot delay precedes its explicit reload animation duration.
   a.readyAt=b.time+(ab.sk.Sniping?.bb.delay_add_bullet??4)+(ab.sk.AddBullet?.bb.duration??10);
  }
  if(b.time+1e-9>=a.readyAt){ammo.value=ammo.max;a.reloading=false;e.profile.noAttack=false;b.removeBuff(e,'sankta:reload');}
 }
}];
const caretaker=ab=>{
 const s=ab.sk.RangeHeal,candidates=(b,e)=>b.enemiesInRadius(e.x,e.y,s?.bb.range_radius??2.5).filter(u=>u.alive&&(u.hp<u.s.maxHp||(usesAmmo(u)&&ammunition(u).value<ammunition(u).max))).sort((a,z)=>a.hpRatio-z.hpRatio||a.id-z.id);
 return[skill(s,(b,e)=>{for(const u of candidates(b,e).slice(0,s?.bb.max_target??3)){b.heal(e,u,e.s.atk*(s?.bb.heal_scale??2));if(usesAmmo(u)){const ammo=ammunition(u);ammo.value=Math.min(ammo.max,ammo.value+(s?.bb.sp??1));}}},{cd:5,cond:(b,e)=>candidates(b,e).length>0})];
};
const preacher=ab=>{
 const s=ab.sk.DamageOrSp,release=(b,e)=>{if(e.mem.sanktaChannel)b.fx('enemyChannelCancel',{id:e.id,x:e.x,y:e.y});e.mem.sanktaChannel=null;e.profile.noAttack=false;b.removeBuff(e,'sankta:channel');};
 return[skill(s,(b,e)=>{const target=byPriority(e,targetsNear(b,e,e.base.rangeRadius+.25))[0];if(!target)return;
  e.mem.sanktaChannel={target,until:b.time+(s?.bb.hit_duration??8),next:b.time};e.profile.noAttack=true;b.addBuff(e,{key:'sankta:channel',persist:true,mods:{moveMul:0}});
 },{sil:true,cond:(b,e)=>!e.mem.sanktaChannel&&targetsNear(b,e,e.base.rangeRadius+.25).length>0}),{
  silAware:true,
  tick(b,e){const c=e.mem.sanktaChannel;if(!c)return;if(!e.canAct||e.s.flags.silence||!c.target.alive||c.target.removed||b.time+1e-9>=c.until){release(b,e);return;}
   // [ASSUMED] One Arts pulse per second; dream/wakefulness stage devices are absent from this mode.
   if(b.time+1e-9>=c.next){c.next++;hurt(b,e,c.target,e.s.atk*(s?.bb.atk_scale??.5),'arts');}
  }
 }];
};
export const SANKTA_KITS=Object.freeze({
 enemy_10083_hlbird_2:FLY_KITS.enemy_10083_hlbird,
 enemy_10084_hlegle_2:FLY_KITS.enemy_10084_hlegle,
 enemy_10085_hllevi:FLY_KITS.enemy_10085_hllevi_2,
 enemy_10086_hltigr:FLY_KITS.enemy_10083_hlbird,
 enemy_10086_hltigr_2:FLY_KITS.enemy_10083_hlbird,
 enemy_10087_hlchgr:sword,enemy_10087_hlchgr_2:sword,
 enemy_10088_hlsnip:sniper,enemy_10088_hlsnip_2:sniper,
 enemy_10089_hlsprt:caretaker,enemy_10089_hlsprt_2:caretaker,
 enemy_10090_hlgrd:preacher,enemy_10090_hlgrd_2:preacher,
});
