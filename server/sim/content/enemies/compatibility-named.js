import {hurt,targetsNear,byPriority,areaAllies,castSlot,stayRoute} from './helpers.js';
import {capEnemyBurstHit} from '../../../../shared/enemyPressure.js';
import {skill,unblockable,maxTargets,taunt,stealth} from './archetypes.js';
import {present,spawnOwned} from './compatibility-helpers.js';
const candle=ab=>[stealth(),{
 spawn(_b,_e,a){a.left=ab.sk.ChargeAttack?.icd??25;},
 status(c,_b,_e,a){if(['stun','freeze','sleep','silence','levitate'].includes(c.status))a.cancelled=true;},
 tick(b,e,a,dt){if(a.casting){if(e.s.flags.stun||e.s.flags.silence)a.cancelled=true;return;}a.left-=dt;if(a.left>0||!e.canAct||e.s.flags.silence)return;const u=byPriority(e,targetsNear(b,e,e.base.rangeRadius||2.5))[0];if(!u)return;
  const s=ab.sk.ChargeAttack,dur=s?.bb.duration??7,life=u.deploySeq;a.casting=true;a.cancelled=false;a.left=s?.cd??25;castSlot(b,e,s,dur);b.addBuff(e,{key:'compat:candleCharge',duration:dur,flags:{noMove:true,disarm:true,stealthOff:true},visible:true});
  b.fx('telegraph',{id:e.id,x:u.x,y:u.y,r:s?.bb.range_radius??2.2,dur,kind:'candle'});
  b.after(dur,()=>{a.casting=false;b.removeBuff(e,'compat:candleCharge');if(!present(e)||a.cancelled||!present(u)||u.deploySeq!==life)return;const r=s?.bb.range_radius??2.2;b.fx('explode',{id:e.id,x:u.x,y:u.y,r,kind:'candle'});for(const v of areaAllies(b,e,u.x,u.y,r))hurt(b,e,v,capEnemyBurstHit(b,e,e.s.atk*(s?.bb.atk_scale??2.5)),'arts');},{owner:e});
 },
}];
const gertrude=()=>[unblockable(),maxTargets(2),skill(null,(b,e)=>{const d=spawnOwned(b,e,'enemy_1248_ltholo',1,{cap:3,totalCap:32,route:stayRoute(e)})[0];if(d)b.after(30,()=>{if(d.alive)b._remove(d,'expired');});},{cd:10,icd:10}),{
 death(_c,b,e){for(const d of b.enemies)if(d.alive&&d.mem.compatParent===e.id)b._remove(d,'expired');},
}];
const image=()=>[taunt(1),{spawn(b,e){e.profile.noAttack=true;b.addBuff(e,{key:'compat:imageStill',persist:true,flags:{noMove:true,unblockable:true}});}}];
export const COMPATIBILITY_NAMED_KITS=Object.freeze({enemy_1184_cadkgt:candle,enemy_1184_cadkgt_2:candle,enemy_1184_cadkgt_3:candle,enemy_1247_ltgtld:gertrude,enemy_1248_ltholo:image});
