import {T,hurt,targetsNear,byPriority,castSlot,expectedFinal,unbalancedNow} from './helpers.js';
import {splashAttack} from './archetypes.js';
import {present,channel} from './compatibility-helpers.js';
import {capEnemyBurstHit} from '../../../../shared/enemyPressure.js';

// Official enemy_10210_muwiz / _2 blackboards and native animations, 2026-10-27 local snapshot.
// PRTS 乌萨斯战争术师: 1-tile Arts splash; threshold shield; seven 1-second focus pulses.
// No 泄漏源 object exists in training: the initial shield is not regenerated autonomously.
const SHIELD='ursus:warShield',STEAL='ursus:warStolen',GAIN='ursus:warGain';
function warCaster(ab){
 const focus=ab.sk.LockDamage,leave=ab.sk.Leave;
 return [splashAttack({unblocked:false,radius:1,fxKind:'arts'}),{
  spawn(b,e,a){
   a.left=focus?.icd??15;a.age=0;a.stolen=0;a.perTarget=new Map();a.shield=true;
   b.addBuff(e,{key:SHIELD,persist:true,visible:true,mods:{defPct:T(ab,'Shiled.def')??.2,resFlat:T(ab,'Shiled.magic_resistance')??-20}});
  },
  hitIn(c,b,e,a){
   if(!a.shield||!['phys','arts'].includes(c.dmg.type))return;
   if(expectedFinal(c.source,e,c.dmg)<(T(ab,'Shiled.max_damage')??1200)){c.dmg.cancel=true;return;}
   a.shield=false;b.removeBuff(e,SHIELD);b.fx('shieldBreak',{id:e.id,x:e.x,y:e.y});
  },
  // The ordinary attack and its splash share the existing 3000 per-target pressure ceiling.
  hitOut(c,b,e){c.dmg.amount=capEnemyBurstHit(b,e,c.dmg.amount);},
  tick(b,e,a,dt){
   a.age+=dt;
   if(leave&&!a.leaving&&a.age>=leave.icd){
    a.leaving=true;if(a.cast)a.cast.cancelled=true;b.removeBuff(e,'ursus:focus');
    castSlot(b,e,leave);b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip:'Leave'});
    e.profile.noAttack=true;
    b.addBuff(e,{key:'ursus:leave',persist:true,flags:{noMove:true,disarm:true,invulnerable:true}});
    b.after(e.def.raw.nativeAnimations?.durations?.Leave??1,()=>{if(e.alive)b.kill(e,null);},{owner:e});return;
   }
   if(a.leaving)return;
   if(a.target){
    if(a.cast.cancelled||!present(a.target)||a.target.deploySeq!==a.deployment||a.pulses>=a.hits){
     a.target=null;a.left=focus?.cd??15;b.removeBuff(e,'ursus:focus');return;
    }
    a.pulse-=dt;if(a.pulse>1e-9)return;a.pulse+=1;a.pulses++;
    const target=a.target,damage=capEnemyBurstHit(b,e,e.s.atk*(focus?.bb.atk_scale??.4),a.hits);
    if(hurt(b,e,target,damage,'arts',{tags:['ursusFocus']})>0){
     const max=T(ab,'StealAtk.steal_atk_max')??2050,current=a.perTarget.get(target.id)||0;
     const taken=Math.max(0,Math.min(T(ab,'StealAtk.steal_atk')??50,target.s.atk-1,max-a.stolen,max-current));
     if(taken>0){
      a.stolen+=taken;a.perTarget.set(target.id,current+taken);
      target.mem.ursusWarStolen=Math.max(target.mem.ursusWarStolen||0,current+taken);
      b.addBuff(target,{key:STEAL,persist:true,mods:{atkFinal:-target.mem.ursusWarStolen}});
      b.addBuff(e,{key:GAIN,persist:true,mods:{atkFinal:a.stolen}});
     }
    }
    return;
   }
   a.left-=dt;if(a.left>0||!present(e)||unbalancedNow(b,e)||e.s.flags.stun||e.s.flags.freeze||e.s.flags.sleep||e.s.flags.levitate||e.s.flags.disarm)return;
   const target=byPriority(e,targetsNear(b,e,e.base.rangeRadius).filter(u=>!u.isFlying))[0];if(!target)return;
   a.target=target;a.deployment=target.deploySeq;a.pulses=0;a.hits=Math.max(1,Math.ceil(focus?.bb.hit_duration??7));a.pulse=1;
   a.cast=channel(b,e,'ursus:focus',a.hits,{},false);castSlot(b,e,focus,a.hits);
  },
 }];
}
export const URSUS_WAR_CASTER_KITS=Object.freeze({enemy_10210_muwiz:warCaster,enemy_10210_muwiz_2:warCaster});
