// 复奏: PRTS /w/Ripresa documents 1.7 splash, three reselected shots and 1.2/1.6/2.0 impact times.
import {num,talentBb} from '../shared/tier1.js';
import {altSkills,instantKindOf} from '../shared/tier3.js';
import {sortEnemyTargets} from '../../../targeting.js';
const RADIUS=1.7;
export default {
  char_4031_liesel:(bb,chess,def)=>{
    const t=talentBb(chess),mult=(b,x,y,r)=>b.foesInRadius(x,y,r,true).length>=num(t.min_target_cnt,3)?num(t.damage_scale,1):1;
    return {skills:altSkills(chess,def,bb,{
      skchr_liesel_1:s=>({kind:instantKindOf(s),attack:{atkScale:num(s.bb.atk_scale,1),splashRadius:RADIUS}}),
      skchr_liesel_2:s=>({kind:'instant',onStart({battle,unit}){
        for(let i=0;i<num(s.bb.max_target_cnt,3);i++)battle.after(i*.4,()=>{
          if(!unit.alive||!unit.deployed)return;
          const targets=battle.enemiesInKeys(unit.rangeKeys,unit,{...unit.profile,skipEnemy:e=>!!e.findBuff('liesel:main-lock')});
          sortEnemyTargets(battle,unit,targets,unit.profile.priority);const target=targets[0];if(!target)return;
          battle.addBuff(target,{key:'liesel:main-lock',source:unit,duration:1.5});
          const dot=unit.s.atk*unit.s.atkScaleMul*num(s.bb['liesel_s_2[dot].atk_scale']);
          battle._ev(['atk',unit.id,target.id,'bolt']);
          battle.after(1.2,()=>{
            const foes=battle.foesInRadius(target.x,target.y,RADIUS,true).filter(e=>!e.s.flags.untargetable),mul=mult(battle,target.x,target.y,RADIUS);
            for(const e of foes){
              battle.dealDamage(unit,e,{amount:unit.s.atk*unit.s.atkScaleMul*num(s.bb.atk_scale,1),mul,type:'arts',isSkill:true,canDodge:false,tags:['skill','liesel:burst']});
              if(e.alive)battle.addBuff(e,{key:`liesel:dot:${unit.id}`,duration:num(s.bb['liesel_s_2[dot].duration'],6),interval:1,source:unit,tags:['dot'],
                onTick({battle:b,unit:v}){b.dealDamage(unit,v,{amount:dot,type:'arts',sourceless:true,canDodge:false,tags:['dot','liesel:dot']});}});
            }
          });
        });
      }}),
    }),install(b,u){
      const attacks=new Map();
      b.on('beforeAttack',c=>{if(c.attacker===u)attacks.set(b._attackSeq+1,{target:c.targets[0],radius:c.profile.splashRadius||1.1,mul:null});},{owner:u});
      b.on('hit',c=>{
        if(c.source!==u||!c.dmg.isAttack)return;
        const shot=attacks.get(c.dmg.attackId);if(!shot?.target)return;
        if(shot.mul==null)shot.mul=mult(b,shot.target.x,shot.target.y,shot.radius);
        c.dmg.mul*=shot.mul;
      },{owner:u});
    }};
  },
};
