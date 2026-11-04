// 渡桥 / Cherry-3: official token blackboards; PRTS 渡桥 and 樱桃三号 specify retreat, debris and tactical return.
import {num,talentBb} from '../shared/tier1.js';
import {altSkills} from '../shared/tier3.js';
const TOKEN='token_10037_mitm_trshrb';
const CROSS=[[0,1],[1,0],[0,-1],[-1,0]];
const standing=u=>u?.alive&&u.deployed&&!u.removed;
const carOf=u=>standing(u.trait.reinforcement)&&!u.trait.reinforcement.mem.mitmDebris?u.trait.reinforcement:null;

function debris(battle,car,owner){
  const bb=talentBb(car.def),ratio=1+num(bb['trshrb_t_1[trash_born].max_hp'],-.5);
  for(const[dr,dc]of CROSS){
    const r=car.tileR+dr,c=car.tileC+dc;
    // [ASSUMED] An occupied/non-standable square is omitted, following the simulation's single-occupant contract.
    if(!battle.grid.canStand(r,c)||battle.isReservedTile(r,c))continue;
    battle.spawnToken(owner,TOKEN,r,c,{anySource:true,kit:{skill:null,trait:{noAttack:true},install(b,t){
      t.mem.mitmDebris=true;
      t.form='mitm_debris';
      b.addBuff(t,{key:'mitm:debris',persist:true,allowDead:true,mods:{hpPct:ratio-1,atkPct:-1,defPct:-1,blockCnt:num(bb['trshrb_t_1[trash_born].block_cnt'],1)},flags:{noHeal:true,healFree:true}});
    }}});
  }
}

function carKit(owner){
  return {skill:null,install(battle,car){
    if(car.mem.mitmManaged)return;
    car.mem.mitmManaged=true;
    const bb=talentBb(car.def),block=num(bb.block_cnt,1);
    const apply=()=>{car.form=null;battle.addBuff(car,{key:'mitm:car',persist:true,allowDead:true,mods:{blockCnt:block},flags:{noHeal:true,healFree:true}});};
    apply();
    battle.on('deploy',c=>{if(c.unit===car){car.mem.mitmWaiting=null;apply();}},{owner:car});
    battle.on('death',c=>{
      if(c.unit!==car||!['killed','retreat'].includes(c.reason)||!standing(owner)||car.mem.mitmDebris)return;
      car.removed=false;
      const seq=(car.mem.mitmSequence||0)+1;car.mem.mitmSequence=seq;
      car.mem.mitmWaiting={until:battle.time+num(bb.interval,15),seq};
      battle.after(1/30,()=>{if(standing(owner))debris(battle,car,owner);});
      const restore=()=>{
        if(battle.finished||!standing(owner)||car.removed||car.mem.mitmWaiting?.seq!==seq)return;
        if(battle.redeploy(car,{free:true})){owner.trait.reinforcement=car;return;}
        battle.after(.25,restore,{owner:car});
      };
      battle.after(num(bb.interval,15),restore,{owner:car});
    },{owner:car});
    const taunt=Math.max(0,...(car.def.talents||[]).map(t=>num(t.bb?.taunt_level)));
    if(taunt)battle.every(.1,()=>{if(!standing(car))return;for(const e of car.blocking)battle.addBuff(e,{key:'mitm:taunt',source:car,duration:.2,mods:{taunt}});},{owner:car});
  }};
}

export default {
  char_4147_mitm:(bb,chess,def)=>({
    trait:{install(battle,owner){
      const prepare=()=>{
        if(!standing(owner))return;
        const units=battle.allyUnits.filter(t=>t.kind==='token'&&t.defId===TOKEN&&t.ownerUnit===owner&&!t.mem.mitmDebris&&!t.removed);
        let car=units.find(t=>standing(t)||t.mem.mitmWaiting);
        if(car){owner.trait.reinforcement=car;if(!car.mem.mitmManaged)carKit(owner).install(battle,car);return;}
        car=units.find(t=>t.uid!=null);
        if(car){carKit(owner).install(battle,car);if(battle.redeploy(car,{free:true})){owner.trait.reinforcement=car;return;}}
        const at=battle.findTacticalPoint(owner);if(!at)return;
        owner.trait.reinforcement=battle.spawnToken(owner,TOKEN,at[0],at[1],{kit:carKit(owner)});
      };
      battle.on('deploy',c=>{if(c.unit===owner)prepare();},{owner});
      battle.on('death',c=>{
        if(c.unit!==owner)return;
        for(const t of battle.allyUnits)if(t.kind==='token'&&t.defId===TOKEN&&t.ownerUnit===owner){
          t.mem.mitmWaiting=null;
          if(t.alive)battle.retreat(t,{reason:'expired',permanent:true});else t.removed=true;
        }
        owner.trait.reinforcement=null;
      },{owner});
    }},
    skills:altSkills(chess,def,bb,{
      skchr_mitm_1:s=>({kind:'instant',onStart({battle,unit}){
        battle.addDp(unit.ownerId,num(s.bb.cost));const car=carOf(unit);if(!car)return;
        const keys=[[0,0],...CROSS].map(([dr,dc])=>(car.tileR+dr)*21+car.tileC+dc);
        for(const e of battle.enemiesInKeys(keys,unit,{canHitFly:true}))battle.dealDamage(unit,e,{amount:unit.s.atk*unit.s.atkScaleMul*num(s.bb.aoe_damage_scale)*(e.blockedBy===car?num(unit.profile.reinforceScale,1.5):1),type:'phys',isSkill:true,canDodge:false,tags:['skill','mitm:blast']});
        battle.retreat(car,{reason:'retreat'});
      }}),
      skchr_mitm_2:s=>({kind:'duration',mods:{atkPct:num(s.bb.atk)},onStart({battle,unit}){
        unit.mem.mitmAcc=0;unit.mem.mitmPaid=0;const car=carOf(unit);unit.mem.mitmSkillCar=car;
        if(car){car.form='mitm_skill';battle.addBuff(car,{key:'mitm:mode',mods:{defPct:num(s.bb['mitm_s_2[to_token].def']),blockCnt:num(s.bb['mitm_s_2[to_token].block_cnt'],2)-num(talentBb(car.def).block_cnt,1)},flags:{disarm:true}});}
      },onTick({battle,unit,dt}){
        unit.mem.mitmAcc+=dt;const interval=num(s.bb['mitm_s_2[cost].interval'],1.25),cap=num(s.bb['mitm_s_2[cost].display'],12),amount=num(s.bb['mitm_s_2[cost].cost'],1);
        while(unit.mem.mitmAcc+1e-9>=interval&&unit.mem.mitmPaid<cap){unit.mem.mitmAcc-=interval;const gain=Math.min(amount,cap-unit.mem.mitmPaid);battle.addDp(unit.ownerId,gain);unit.mem.mitmPaid+=gain;}
      },onEnd({battle,unit,reason}){
        const car=unit.mem.mitmSkillCar;unit.mem.mitmSkillCar=null;
        if(car){car.form=null;battle.removeBuff(car,'mitm:mode');if(reason!=='death'&&standing(car))battle.retreat(car,{reason:'retreat'});}
      }}),
    }),
  }),
};
