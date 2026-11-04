// Small-boss versions use native blackboards; stage-wide permanent deployment seals are explicitly omitted.
import {T,hurt,elem,areaAllies,areaAlliesInTiles,targetsNear,byPriority,abilityAttackFx} from './helpers.js';
import {reborn,skill,ep} from './archetypes.js';
const frost=ab=>{
 const s=ab.sk.ArcticBlast;
 return [reborn({dur:T(ab,'reborn.duration')??5,onReborn(b,e){b.addBuff(e,{key:'miniboss:frostReborn',persist:true,mods:{atkPct:T(ab,'reborn.atk')??.5}});}}),
  skill(s,(b,e)=>{const radius=s?.bb.range_radius??2.5;b.fx('explode',{id:e.id,x:e.x,y:e.y,r:radius,kind:'frost'});
   for(const u of areaAllies(b,e,e.x,e.y,radius)){abilityAttackFx(b,e,u,'enemy');hurt(b,e,u,e.s.atk*(s?.bb.atk_scale??1.5),'arts');b.addBuff(u,{key:'miniboss:arctic',duration:s?.bb.duration??8,mods:{aspd:s?.bb.attack_speed??-50},visible:true});}
  },{cond:(b,e)=>areaAllies(b,e,e.x,e.y,s?.bb.range_radius??2.5).length>0})];
};
const firstSpeaker=ab=>[ep('neural',T(ab,'epdamage.attack@ep_damage_ratio')??.4),
 skill(ab.sk.Spear,(b,e)=>{
  const initial=byPriority(e,targetsNear(b,e,e.base.rangeRadius+.25))[0];if(!initial)return;
  const s=ab.sk.Spear,duration=Math.max(0,Math.min(60,s?.bb.duration??5));
  // [ASSUMED] One bubble per second; each chooses the least neural damage among the target and its four neighbours.
  for(let i=0;i<Math.ceil(duration);i++)b.after(i,()=>{
   if(!e.alive||!e.canAct||!initial.alive)return;
   const candidates=byPriority(e,areaAlliesInTiles(b,e,initial.tileR,initial.tileC,'plus',1));
   candidates.sort((a,z)=>(a.elem?.neural||0)-(z.elem?.neural||0));const target=candidates[0];if(!target)return;
   hurt(b,e,target,e.s.atk*(s?.bb.atk_scale??.6),'phys');elem(b,e,target,'neural',e.s.atk*(s?.bb.ep_damage_ratio??.6));
  },{owner:e});
 },{cond:(b,e)=>targetsNear(b,e,e.base.rangeRadius+.25).length>0})];
export const EXTRA_MINI_KITS=Object.freeze({enemy_1505_frstar:frost,enemy_1154_dsmant:firstSpeaker});
export const EXTRA_MINI_STATS=Object.freeze({enemy_1001_bigbo_2:'Big Adam: native heavily armoured physical attacker'});
