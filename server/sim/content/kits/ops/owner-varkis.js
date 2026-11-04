// 摆渡人: overflow healing becomes a capped barrier, then decays by the native blackboard amount each second.
import {num,talentBb} from '../shared/tier1.js';
import {altSkills,instantKindOf} from '../shared/tier3.js';
const MINOS=new Set(['char_159_peacok','char_4166_varkis','char_333_sidero','char_163_hpsts','char_4043_erato','char_485_pallas']);
const KEY='varkis:barrier';
export default {
  char_4166_varkis:(bb,chess,def)=>({
    skills:altSkills(chess,def,bb,{
      skchr_varkis_1:s=>({kind:instantKindOf(s),attack:{hits:3,atkScale:num(s.bb.atk_scale,1)}}),
      skchr_varkis_2:s=>({kind:'duration',attack:{atkScale:num(s.bb['attack@s2_atk_scale'],1)},onAttack({battle,unit}){
        battle.heal(unit,unit,unit.s.maxHp*num(s.bb['attack@hp_ratio']),{self:true,tags:['skill']});
      }}),
    }),install(b,u){
      b.on('heal',c=>{
        if(c.target!==u||c.source!==u||!u.skill?.active||u.skill.id!=='skchr_varkis_2')return;
        const overflow=Math.max(0,c.amount-(u.s.maxHp-u.hp));if(!overflow)return;
        const have=u.findBuff(KEY)?.shield||0,cap=u.s.maxHp*num(bb.max_hp_ratio,1);
        b.addBuff(u,{key:KEY,shield:Math.min(cap,have+overflow),source:u,visible:true,tags:['skill']});
      },{owner:u,priority:-50});
      b.every(.1,()=>{
        const shield=u.findBuff(KEY);if(!shield||!u.alive||u.skill?.active&&u.skill.id==='skchr_varkis_2')return;
        shield.shield=Math.max(0,shield.shield-num(bb.dynamic_dec_per_sec,100)*.1);if(!shield.shield)b.removeBuff(u,KEY);
      },{owner:u});
      b.on('hit',c=>{
        const a=c.source;if(!u.alive||!u.deployed||!a||a.ownerId!==u.ownerId||!MINOS.has(a.def?.charId)||c.target.side!=='enemy'||!c.dmg.isAttack||c.target.hpRatio>a.hpRatio)return;
        const best=b.allyUnits.filter(v=>v.alive&&v.deployed&&v.ownerId===u.ownerId&&v.def?.charId==='char_4166_varkis')
          .sort((a,z)=>num(talentBb(z.def).talent_atk_scale,1)-num(talentBb(a.def).talent_atk_scale,1)||a.id-z.id)[0];
        if(best===u)c.dmg.amount*=num(talentBb(chess).talent_atk_scale,1);
      },{owner:u});
    },
  }),
};
