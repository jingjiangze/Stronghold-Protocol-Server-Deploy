// Deterministic, bounded support. SP grants share a 16-SP offer budget per operator and battle.
const fieldOp=u=>u?.side==='ally'&&u.kind==='op'&&u.alive&&u.deployed&&!u.hidden&&!u.removed;
export function installContractSupports(battle) {
 const spOffered=new Map();
 const grant=(u,sp)=>{if(!fieldOp(u))return 0;const n=Math.min(sp,16-(spOffered.get(u)||0));if(!(n>0))return 0;const gained=u.skill?.gainSp(n,'contractSupport')||0;if(gained>0)spOffered.set(u,(spOffered.get(u)||0)+n);return gained;};
 for(const ps of battle.players)for(const rule of ps.input?.contractSupports||[]) {
  const match=u=>fieldOp(u)&&u.ownerId===ps.playerId&&(!rule.profession||u.def.profession===rule.profession);
  const last=new Map(),counts=new Map(),hits=new Map(),targetsUsed=new Set();
  const ready=u=>{if((counts.get(u)||0)>=(rule.maxTriggers??Infinity))return false;const before=last.get(u);if(before!=null&&battle.time-before+1e-9<(rule.cooldown||0))return false;last.set(u,battle.time);counts.set(u,(counts.get(u)||0)+1);return true;};
  const gain=u=>{if(match(u))return grant(u,rule.sp);return 0;};
  const buff=(u,mods)=>battle.addBuff(u,{key:'contractSupport:'+rule.trigger,source:ps.playerId,duration:rule.duration,mods,refresh:'replace'});
  if(['deploy','opening','openingRegen'].includes(rule.trigger))battle.on('deploy',({unit,initial})=>{
   if(!match(unit)||((rule.trigger==='opening'||rule.trigger==='openingRegen')&&!initial)||!ready(unit))return;
   if(rule.trigger==='openingRegen')buff(unit,{hpRegenRatio:rule.hpRegenRatio});else gain(unit);
  });
  if(['attack','slow','aspdDebuff','squadSP'].includes(rule.trigger))battle.on('attack',({attacker,isSkill,targets=[]})=>{
   if(!match(attacker)||isSkill)return;
   if(rule.trigger==='attack'||rule.trigger==='squadSP'){
    const n=(hits.get(attacker)||0)+1;hits.set(attacker,n);if(n%rule.every!==0)return;
    if(rule.trigger==='attack')gain(attacker);
    else if(ready(ps)){
     const units=battle.allyUnits.filter(u=>u!==attacker&&fieldOp(u)&&u.ownerId===ps.playerId&&u.skill&&!u.skill.noSkill&&u.skill.kind!=='passive');
     units.sort((a,b)=>(Math.abs(a.x-attacker.x)+Math.abs(a.y-attacker.y))-(Math.abs(b.x-attacker.x)+Math.abs(b.y-attacker.y))||a.id-b.id);
     if(units[0])grant(units[0],rule.sp);
    }
   }else{
    const target=targets.find(e=>e?.side==='enemy'&&e.alive&&!e.removed&&['NORMAL','ELITE'].includes(e.def.rank));if(!target||!ready(attacker))return;
    buff(target,rule.trigger==='slow'?{moveMul:rule.moveMul}:{aspd:rule.aspd});
   }
  });
  if(['damaged','lowHpShield','artsRes'].includes(rule.trigger))battle.on('damaged',({target,amount,source,type})=>{
   if(!(amount>0)||source?.side!=='enemy'||!match(target)||!(target.hp>0))return;
   if(rule.trigger==='damaged'){if(ready(target))gain(target);}
   else if(rule.trigger==='artsRes'){if(type==='arts'&&ready(target))buff(target,{resFlat:rule.res});}
   else if(target.hp/target.s.maxHp<rule.hpBelow&&ready(target))battle.addBuff(target,{key:'contractSupport:cover',source:ps.playerId,duration:rule.duration,shield:target.s.maxHp*rule.hpRatio,refresh:'replace'});
  });
  if(rule.trigger==='blocking'||rule.trigger==='pulse')battle.every(rule.interval,()=>{for(const u of battle.allyUnits)if(match(u)&&(rule.trigger==='pulse'||u.blocking?.length>0))gain(u);});
  if(rule.trigger==='healRescue')battle.on('heal',({source,target,amount,opts})=>{
   if(opts.regen||opts.contractRescue||!(amount>0)||!match(source)||!fieldOp(target)||target.ownerId!==ps.playerId||!(target.hp>0)||target.hp/target.s.maxHp>=rule.hpBelow||targetsUsed.has(target)||!ready(source))return;
   targetsUsed.add(target);battle.heal(source,target,source.s.atk*rule.atkRatio,{contractRescue:true});
  });
  if(rule.trigger==='castAspd')battle.on('skillStart',({unit})=>{if(match(unit)&&ready(unit))buff(unit,{aspd:rule.aspd});});
  if(rule.trigger==='firstBlock')battle.on('blocked',({blocker})=>{if(match(blocker)&&ready(blocker))buff(blocker,{blockCnt:rule.block});});
  if(rule.trigger==='deathRelay')battle.on('death',({unit,reason})=>{
   if(reason!=='killed'||unit.side!=='ally'||unit.kind!=='op'||unit.ownerId!==ps.playerId||!ready(ps))return;
   for(const u of battle.allyUnits)if(u!==unit&&fieldOp(u)&&u.ownerId===ps.playerId)grant(u,rule.sp);
  });
 }
}
