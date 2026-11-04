// 卡达: one released, persistent-lock funnel, with independent body/drone stun rolls.
import {num,talentBb,statBuff} from '../shared/tier1.js';
import {altSkills,statSkill,funnelMap,installFunnelPrune} from '../shared/tier3.js';
import {kjeraRelease} from './chess_char_3_20-kjera.js';
export default {
  char_328_cammou:(bb,chess,def)=>{
    const release=kjeraRelease(bb,{status:'stun',includeSkillBody:true});
    return {trait:{funnelMul:funnelMap},skills:altSkills(chess,def,bb,{
      'skcom_atk_up[2]':statSkill,
      skchr_cammou_2:s=>({...kjeraRelease(s.bb,{status:'stun',includeSkillBody:true}).skill,...(s.rangeGrid?{targeting:{rangeGrid:s.rangeGrid}}:{})}),
    }),install(b,u){
      installFunnelPrune(b,u);
      statBuff(b,u,'talent:cammou_sync',{aspd:num(talentBb(chess).attack_speed)});
      if(def.skill?.id==='skchr_cammou_2')release.install(b,u);
    }};
  },
};
