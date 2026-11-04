// BDA/BZM base level0. Parameters come from current native enemy blackboards.
import {areaAlliesInTiles,T} from './helpers.js';
const CROSS_TAG='blackflow:cross';
function blockedBleed(ab){return[{iv:T(ab,'block.interval')??1,
 tick(b,e){if(!e.hidden&&e.blockedBy?.alive&&e.blockedBy.deployed&&!e.blockedBy.hidden&&!e.blockedBy.s.flags.noBlock&&!e.blockedBy.s.flags.sleep&&!e.s.flags.unblockable&&!e.s.flags.levitate&&!e.s.flags.fear)b.loseHp(e,e.s.maxHp*(T(ab,'block.hp_ratio')??.05),{sourceless:true,tags:['blackflow:blockedLoss']});}
}];}
/** Engine moving can remain set on a newly stopped/controlled actor. Guard current state, not its last animation. */
export function blackflowIsMoving(b,e,attackAt=-1){
 const f=e.s.flags,leg=e.route?.legs?.[e.route.legIdx];
 return !!(e.alive&&e.moving&&!e.hidden&&!e.blockedBy&&!e.swing&&!f.stun&&!f.freeze&&!f.sleep&&!f.levitate&&!f.noMove&&e.s.moveSpeed>0&&b.time>=e.pauseUntil&&b.time>=e.unbalanceUntil&&b.time>=e.atkStandUntil&&attackAt!==b.time&&(!leg||leg.t==='move'));
}
function sunHerald(ab){return[{
 spawn(_b,_e,a){a.attackAt=-1;},
 before(_c,b,_e,a){a.attackAt=b.time;},
 hitIn(c,b,e,a){if((c.dmg.type==='phys'||c.dmg.type==='arts')&&blackflowIsMoving(b,e,a.attackAt))c.dmg.mul=(c.dmg.mul??1)*(1-(T(ab,'move.damage_resistance')??.9));},
 hitOut(c,b,e){
  if(!c.dmg.isAttack||c.dmg.type!=='arts'||c.dmg.tags?.includes(CROSS_TAG)||!c.target)return;
  const main=c.target,seen=new Set([main.id]);
  for(const u of areaAlliesInTiles(b,e,main.tileR,main.tileC,'plus',1)){
   if(seen.has(u.id))continue;seen.add(u.id);
   // Same normal attack identity/budget, each secondary once. Primary stays in the engine pipeline.
   b.dealDamage(e,u,{amount:e.s.atk*(e.profile.atkScale??1),type:'arts',isAttack:true,isSkill:false,isProjectile:!!c.dmg.isProjectile,attackId:c.dmg.attackId,canDodge:true,tags:[...(c.dmg.tags||[]),CROSS_TAG]});
  }
 }
}];}
export const BLACKFLOW_ELITE_KITS=Object.freeze({enemy_2159_shjagr:blockedBleed,enemy_2158_sheagl:sunHerald});
