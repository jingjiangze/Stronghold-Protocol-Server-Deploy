// Owner adaptation: standby changes combat readiness, never initial route movement.
// Native wake-on-damage, delayed awakening and sentinel alarms still share one transition.
import {T} from './helpers.js';
export function standby(ab, {maxTargets=1}={}) {
 return {
  spawn(b,e,a) {
   a.until=b.time+(T(ab,'revive.unmove_duration')??150);
   e.profile.noAttack=true;e.profile.maxTargets=maxTargets;
   e.mem.standbyWake=()=>a.wake(b,e,a);
  },
  wake(b,e,a) {
   if(a.awake||!e.alive||e.removed)return;
   a.awake=true;e.mem.trainingAwake=true;e.profile.noAttack=false;e.profile.dmgType='arts';
   b.addBuff(e,{key:'compat:standbyAwake',persist:true,mods:{moveMul:T(ab,'revive.move_speed')??2},visible:true});
   b.fx('buff',{id:e.id,x:e.x,y:e.y});
  },
  taken(c,b,e,a) {if(c.amount>0&&e.hpRatio<=(T(ab,'revive.hp_ratio')??.999))a.wake(b,e,a);},
  tick(b,e,a) {if(b.time>=a.until)a.wake(b,e,a);},
 };
}
