import {T,hurt,targetsNear,areaAllies,spawnChildren,remainingRoute,setForm} from './helpers.js';
import {skill} from './archetypes.js';
import {alive,ranged} from './additional-leader-helpers.js';
const M3='enemy_2078_skzmst';
function boom(b,e,ab){
  const s=ab.sk.Boom;for(const u of areaAllies(b,e,e.x,e.y,s?.bb.range_radius??2)){
    hurt(b,e,u,e.s.atk*(s?.bb.atk_scale??1),'phys');b.applyStatus(u,'stun',{source:e,duration:s?.bb.boom_duration??5});
  }b.fx('explode',{id:e.id,x:e.x,y:e.y,r:2,kind:'kaltsit'});
}
function finishPair(b,e,killer){
  if(!alive(e)||!e.mem.kaltDown||alive(e.mem.kaltM3))return;
  b.removeBuff(e,'kaltsit:down');b.kill(e,killer);
}
const kaltsit=ab=>[{
  spawn(b,e){
    const mate=spawnChildren(b,e,M3,1,{pos:[e.y,Math.max(b.rect.c0,e.x-1)],countInTotal:false,tag:'part'})[0];
    if(mate){e.mem.kaltM3=mate;mate.mem.kaltOwner=e;mate.bounty=null;mate.lpr=0;mate.mem.additionalParent=e.id;}
    b.on('death',({unit,reason,killer})=>{if(unit===mate&&reason==='killed'){e.mem.kaltMateDefeated=true;finishPair(b,e,killer);}
      if(unit===e&&alive(mate)){mate.mem.kaltCleanup=true;b.kill(mate,null);}
    });
    b.on('enemyLeak',({enemy})=>{if(enemy===e&&alive(mate)){mate.mem.kaltCleanup=true;b.kill(mate,null);}if(enemy===mate&&alive(e)){e.bounty=null;e.mem.kaltMateEscaped=true;if(e.mem.kaltDown)b.leak(e);}});
  },
  taken(c,b,e,a){
    const mate=e.mem.kaltM3;if(a.swapped||e.hpRatio>.5||!alive(mate)||e.mem.kaltDown)return;a.swapped=true;
    const p=[e.x,e.y],q=[mate.x,mate.y],goal=remainingRoute(e).end,mateGoal=remainingRoute(mate).end;
    b._unblock(e);b._unblock(mate);e.x=q[0];e.y=q[1];mate.x=p[0];mate.y=p[1];
    b.rerouteEnemy(e,goal);b.rerouteEnemy(mate,mateGoal);
    for(const u of[e,mate])b.addBuff(u,{key:'kaltsit:swapRest',duration:5,flags:{stun:true,noMove:true}});
    boom(b,e,ab);boom(b,mate,mate.mem.ab);for(const u of[e,mate]){setForm(b,u,'swap','phase',{dur:5});b.after(5,()=>{if(alive(u))setForm(b,u,'normal');},{owner:u});}
  },
  killed(c,b,e){
    if(!alive(e.mem.kaltM3))return false;
    e.mem.kaltDown=true;e.hp=1;e.profile.noAttack=true;b._unblock(e);
    b.addBuff(e,{key:'kaltsit:down',persist:true,flags:{invulnerable:true,untargetable:true,unblockable:true,noMove:true}});return true;
  },
}];
const mon2tr=ab=>[{
  hitOut(c){if(c.dmg.isAttack)c.dmg.amount*=T(ab,'1.atk_scale')??1.5;},
  death(c,b,e){if(!e.mem.kaltCleanup)boom(b,e,ab);},
}];
const talulah=ab=>[{
  spawn(b,e){ranged(e,1.5,'arts');},
  taken(c,b,e,a){
    if(a.half||e.hpRatio>.5)return;a.half=true;
    b.addBuff(e,{key:'talulah:half',persist:true,mods:{defPct:T(ab,'halfhp.def')??.5,resPct:T(ab,'halfhp.magic_resistance')??.5}});
    for(const s of ab.list)if(s.id==='talulahFire'){s.cd=10;s.left=Math.min(s.left,10);}
  },
},skill(ab.sk.DragonFire,(b,e)=>{
  const s=ab.sk.DragonFire,u=targetsNear(b,e,e.base.rangeRadius)[0];if(!u)return;
  const duration=(s.bb['dragon_fire.duration']??30.5)*(1-b.resistOf(u));let elapsed=0;
  b.addBuff(u,{key:`talulah:dragonFire:${e.id}`,duration,interval:1,visible:true,
    onTick:()=>{if(!alive(e)||!alive(u))return;elapsed++;const base=s.bb['dragon_fire.baseDamage']??200,gain=s.bb['dragon_fire.addOnDamage']??200,max=s.bb['dragon_fire.addOnDuration']??20;hurt(b,e,u,base+gain*Math.min(elapsed,max)/max,'true');},
  });b.fx('beam',{from:{x:e.x,y:e.y},to:{x:u.x,y:u.y},kind:'fire'});
},{id:'talulahFire'})];
export const KALTSIT_TALULAH_KITS=Object.freeze({enemy_2076_skzklz:kaltsit,enemy_2078_skzmst:mon2tr,enemy_3002_ftrtal:talulah});
