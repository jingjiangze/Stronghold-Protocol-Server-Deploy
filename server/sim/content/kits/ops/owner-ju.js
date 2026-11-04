// 矩: official blackboards; PRTS /w/Ju specifies the shared permanent S2 mark and .2/.9/.3-second aura timing.
import { num, talentBb, giveSp } from '../shared/tier1.js';
import { altSkills, instantKindOf } from '../shared/tier3.js';
import { canTargetEnemy } from '../../../targeting.js';

const dyingBattles = new WeakMap();
function dyingState(battle) {
  let state = dyingBattles.get(battle);
  if (state) return state;
  state = new Set();dyingBattles.set(battle,state);
  battle.on('heal', c => { if(c.target.mem.juDying)c.amount=0; });
  battle.on('kill', c => {
    const mark=c.victim.mem.juDying;if(!mark)return;
    if(c.killer)giveSp(c.killer,mark.sp,'ju:finish');
    state.delete(c.victim);delete c.victim.mem.juDying;
    battle.removeBuff(c.victim,'ju:dying');
  });
  battle.every(1/30,()=>{
    for(const e of state){
      if(!e.alive||e.removed){state.delete(e);continue;}
      if(battle.time+1e-9>=e.mem.juDying.until&&!e.hidden)battle.kill(e,null);
    }
  });
  return state;
}

export default {
  char_4221_ju:(bb,chess,def)=>{
    const talent=talentBb(chess),s1=def.skill?.id==='skchr_ju_1';
    return {
      trait:{priority:'heaviest',skipEnemy:e=>!!e.mem.juDying},
      skills:altSkills(chess,def,bb,{
        skchr_ju_1:s=>({kind:instantKindOf(s),attack:{atkScale:num(s.bb.atk_scale_s1,1),skipEnemy:e=>!!e.mem.juDying||e.hpRatio>.5}}),
        skchr_ju_2:s=>({kind:'duration',mods:{atkPct:num(s.bb.atk)},attack:{maxTargets:num(s.bb['attack@max_target_s2'],2)},
          onStart({unit}){unit.mem.juNextExtra=0;},
        }),
      }),
      install(battle,unit){
        const marked=dyingState(battle);
        // An armed S1 waits for a legal low-health target before spending the next shot.
        unit.profile={...unit.profile,skipEnemy:e=>!!e.mem.juDying||(s1&&(unit.skill?.ready||unit.skill?.pending)&&e.hpRatio>.5)};
        battle.on('fatal',c=>{
          const e=c.unit;
          if(c.source!==unit||e.side!=='enemy'||c.prevented||e.mem.juDying)return;
          c.prevented=true;e.hp=1;
          e.mem.juDying={until:battle.time+num(talent.interval,10),sp:num(talent.sp,2)};marked.add(e);
          battle.addBuff(e,{key:'ju:dying',source:unit,flags:{unblockable:true,noHeal:true,healFree:true,disarm:e.def?.applyWay!=='RANGED'},
            mods:{moveMul:1+num(talent.move_speed,-.8)},tags:['debuff'],visible:true});
          battle._unblock(e);
          battle.fx('debuff',{id:e.id,x:e.x,y:e.y,kind:'juDying',dur:num(talent.interval,10)});
        },{owner:unit});
        battle.on('hit',c=>{
          if(c.source!==unit||c.target.side!=='enemy')return;
          if(num(talent.atk_scale,1)>1&&c.dmg.isAttack&&c.target.weight>=num(talent.value,3))c.dmg.amount*=num(talent.atk_scale,1);
          const bonus=num(talent.damage_scale??talent.damage_scale_s1);
          if(bonus&&c.target.hpRatio<.5)c.dmg.mul*=1+bonus;
        },{owner:unit});
        battle.every(.2,()=>{
          if(!unit.alive||!unit.deployed||!unit.skill?.active||unit.skill.id!=='skchr_ju_2')return;
          for(const e of battle.enemiesInKeys(unit.rangeKeys,unit,unit.profile)){
            if(e.hpRatio>=num(unit.skill.bb.hp_ratio,.5)||e.findBuff('ju:rule'))continue;
            battle.addBuff(e,{key:'ju:rule',source:unit,tags:['debuff']});
            const due=Math.max(battle.time+.9,unit.mem.juNextExtra||0);unit.mem.juNextExtra=due+.3;
            battle.after(due-battle.time,()=>{
              if(!canTargetEnemy(unit,e,{canHitFly:true}))return;
              battle.dealDamage(unit,e,{amount:unit.s.atk*unit.s.atkScaleMul*num(bb.atk_scale_s2_extra,1),type:'phys',isSkill:true,canDodge:false,tags:['skill','ju:extra']});
            });
          }
        },{owner:unit});
      },
    };
  },
};
