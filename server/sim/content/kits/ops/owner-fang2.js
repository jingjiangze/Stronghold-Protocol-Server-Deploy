// 历阵锐枪芬. Initial formation deployment is free; this mode has no manual battle withdrawal/cost refund.
import {num} from '../shared/tier1.js';
import {altSkills,instantKindOf} from '../shared/tier3.js';
export default {
  char_1036_fang2:(bb,chess,def)=>({
    skills:altSkills(chess,def,bb,{
      skchr_fang2_1:s=>({kind:instantKindOf(s),attack:{hits:num(s.bb.cnt,2),atkScale:num(s.bb.atk_scale,1)}}),
      skchr_fang2_2:s=>({kind:'duration',mods:{atkPct:num(s.bb.atk),defPct:num(s.bb.def),blockCnt:num(s.bb.block_cnt)},attack:{hitAllBlocked:true}}),
    }),install(b,u){
      b.on('kill',c=>{if(c.killer===u&&c.victim.side==='enemy'&&u.skill?.active&&u.skill.id==='skchr_fang2_1')b.addDp(u.ownerId,num(bb.cost));},{owner:u});
    },
  }),
};
