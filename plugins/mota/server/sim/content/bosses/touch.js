// Owned Rank-III blackboards; PRTS clarifies additive rebirth HP, status compensation and absorption timing.
import {hypot} from '../../detmath.js';
import {canTargetAlly} from '../../targeting.js';
import {reborn} from '../enemies/archetypes.js';
import {T,hurt,elem,fieldAllies,byPriority,remainingRoute,spawnChildren,castSlot,watchDeaths,canCast,setForm} from '../enemies/helpers.js';
export const TOUCH_KEY='enemy_8018_etouch';
export const TOUCH_POLLUT_KEYS=Object.freeze(['enemy_8019_pollut','enemy_8019_pollut_2','enemy_8019_pollut_3']);
const CONTROL=new Set(['cold','freeze','stun','fear','attract','palsy']);
// env_049_act3break_etouch shares sleeping_immune through its abnormal-combo entry as well as flag entries.
const INHERITED=new Set([...CONTROL,'levitate','bind','tremble','sluggish','sleep']);
const live=u=>!!(u?.alive&&u.deployed&&!u.removed);
const tile=u=>`${Math.round(u.y)},${Math.round(u.x)}`;
const interrupted=e=>e.s.flags.stun||e.s.flags.freeze||e.s.flags.sleep||e.s.flags.levitate||e.s.flags.disarm;

function install(b){
 if(b._touchInstalled)return;b._touchInstalled=true;b._touchStates=new Map();b._touchTiles=new Map();b._touchImmunities=new Set();
 b.on('beforeStatus',c=>{
  const state=c.target?.mem.touch;
  if(state&&live(c.target)&&CONTROL.has(c.status)){
   const old=state.controls.get(c.status),count=Math.min(4,(old?.until>b.time?old.count:0)+1);
   state.controls.set(c.status,{count,until:b.time+15});c.duration*=Math.max(0,1-.3*count);
  }
  if(TOUCH_POLLUT_KEYS.slice(1).includes(c.target?.defId)&&b._touchImmunities.has(c.status))c.cancel=true;
 },{priority:80});
 b.on('death',({unit})=>{
  if(unit?.kind==='op'&&b._touchTiles.has(tile(unit))&&Number.isFinite(unit.respawnAt)&&unit.respawnAt>b.time)unit.respawnAt=b.time+(unit.respawnAt-b.time)*2;
 },{priority:-900});
 let elapsed=0;
 b.on('tick',({dt})=>{
  const want=b.time<(b._touchBlockUntil||0)?1:0;
  for(const u of b.enemies){if(!live(u))continue;const old=u.mem.touchBlockExtra||0;if(old!==want){u.blockWeight=Math.max(1,(u.blockWeight||1)-old+want);u.mem.touchBlockExtra=want;}}
  elapsed+=dt;if(elapsed<1-1e-9)return;elapsed-=1;
  for(const u of b.allies()){
   if(!live(u)||u.isFlying||u.s.flags.liftoff||!b._touchTiles.has(tile(u))){delete u.mem.touchExposure;continue;}
   const data=b._touchTiles.get(tile(u)),time=u.mem.touchExposure??0;u.mem.touchExposure=time+1;
   b.dealDamage(null,u,{type:'arts',amount:Math.min(data.max,data.base+data.growth*time),isSkill:true,tags:['enemyAbility','touchChaos']});
   elem(b,null,u,'frenzy',data.element);
  }
 });
}
function chaos(b,e,targets){
 const s=e.mem.ab.sk.P1Pollute;
 for(const u of targets){
 b.fx('pulse',{id:e.id,x:u.x,y:u.y,r:.5,kind:'touchPolluteImpact'});
 for(const [dr,dc]of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]){
  const r=Math.round(u.y)+dr,c=Math.round(u.x)+dc;
  if(r<b.rect.r0||r>b.rect.r1||c<b.rect.c0||c>b.rect.c1)continue;
  const key=`${r},${c}`;if(b._touchTiles.has(key))continue;
  b._touchTiles.set(key,{base:s?.bb.base_damage??100,growth:s?.bb.add_value??18,max:s?.bb.max_value??1800,element:s?.bb.ep_damage??40});
  b.fx('zone',{id:e.id,x:c,y:r,r:.5,dur:86400,kind:'touchChaos'});
 }
 }
}
function cue(b,e,skill,clip,duration){
 castSlot(b,e,e.mem.ab.sk[skill],duration);e.skillAnimUntil=b.time+duration;
 const form={P1Pollute:'touchPollute',P2Pollute:'touchPollute2',RebornPollute:'touchPollute2',P1AuraBuff:'touchChannel',Summon:'touchSummon',Absorb:'touchAbsorb'}[skill];
 if(form){setForm(b,e,form,'phase',{dur:duration});if(form!=='touchChannel')b.after(duration,()=>{if(live(e)&&e.form===form)setForm(b,e,e.mem.touch.phase===2?'form2':'touchDefault');},{owner:e});}
 else b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip});
}
function stopChannel(b,e,success){
 const state=e.mem.touch,ch=state.channel;if(!ch)return;state.channel=null;e.profile.noAttack=ch.noAttack;b.removeBuff(e,'touch:channel');
 if(e.form==='touchChannel')setForm(b,e,'touchChannelEnd');
 state.nextAura=b.time+(e.mem.ab.sk.P1AuraBuff?.cd??35);
 if(success){state.blockUntil=b.time+(e.mem.ab.sk.P1AuraBuff?.bb.block_duration??30);b._touchBlockUntil=Math.max(b._touchBlockUntil||0,state.blockUntil);b.fx('buff',{id:e.id,x:e.x,y:e.y,kind:'touchBlock'});}
}
function blast(b,e){
 const ab=e.mem.ab;
 for(const u of fieldAllies(b,e)){
  hurt(b,e,u,e.s.atk*(T(ab,'AbsorbListener.atk_scale')??6),'arts');
  b.addBuff(u,{key:'touch:absorb:'+e.id,source:e,duration:T(ab,'AbsorbListener.duration')??5,interval:1,
   onTick:({battle,unit})=>elem(battle,null,unit,'frenzy',T(ab,'AbsorbListener.value')??250)});
 }
 b.fx('explode',{id:e.id,x:e.x,y:e.y,r:4,kind:'touchAbsorb'});
}
function endAbsorb(b,e){const s=e.mem.touch,a=s.absorb;if(!a)return;e.profile.noAttack=a.noAttack;s.absorb=null;b.removeBuff(e,'touch:absorbLock');}
function startAbsorb(b,e,target){
 const s=e.mem.touch;s.absorb={target,hitAt:b.time+.867,until:b.time+3,fired:false,noAttack:e.profile.noAttack};e.profile.noAttack=true;
 b.addBuff(e,{key:'touch:absorbLock',duration:3,flags:{noMove:true}});b.addBuff(target,{key:'touch:absorbed',duration:3,flags:{noMove:true}});
 cue(b,e,'Absorb','Skill_2_Absorb',3);
}
/** Follow the actual remaining route; short routes use a point half a tile back from their end. */
export function touchSummonPoint(e,distance=5){
 const r=remainingRoute(e),planned=(e.route?.pts||[]).slice(e.route?.ptIdx||0).map(p=>[p.y,p.x]);
 const points=[[e.y,e.x],...planned,...(r.steps||[]).filter(p=>p.t==='move').map(p=>p.p),...(r.checkpoints||[]).filter(p=>p.type==='MOVE').map(p=>p.pos),r.end].filter(Boolean);
 const lengths=points.slice(1).map((p,i)=>hypot(p[1]-points[i][1],p[0]-points[i][0]));
 const total=lengths.reduce((n,d)=>n+d,0);let left=total>=distance?distance:Math.max(0,total-.5);
 for(let i=0;i<lengths.length;i++){if(left<=lengths[i]&&lengths[i]>0){const k=left/lengths[i];return[points[i][0]+(points[i+1][0]-points[i][0])*k,points[i][1]+(points[i+1][1]-points[i][1])*k];}left-=lengths[i];}
 return points.at(-1);
}
function summon(b,e){
 const state=e.mem.touch,skill=e.mem.ab.sk.Summon;if(live(state.child))return false;
 const pos=touchSummonPoint(e,skill?.bb.dist??5),route={motion:'WALK',start:pos,end:[e.y,e.x],checkpoints:[]};
 const child=spawnChildren(b,e,skill?.bs.enemy_key||'enemy_8019_pollut_3',1,{pos,route,countInTotal:false,mods:{...(e.mods||{}),touchRoot:e.id}})[0];if(!child)return false;
 state.child=child;child.lpr=0;child.bounty=null;child.profile.noAttack=true;child.profile.pursuit=()=>live(e)?e:null;
 b.addBuff(child,{key:'touch:infused',persist:true,interval:1,
  onTick:({battle,unit})=>battle.loseHp(unit,unit.s.maxHp*(skill?.bb.hp_ratio??.06))});
 state.nextSummon=b.time+1+(skill?.cd??40);state.busyUntil=b.time+1;b.addBuff(e,{key:'touch:casting',duration:1,flags:{noMove:true,disarm:true}});cue(b,e,'Summon','Skill_2_Summon',1);return true;
}
function phaseInfusions(b,e,phase){
 // [ASSUMED] The bounty has no native training-stage waves. Supply one guard per mitigation stack so both
 // phases retain their counterplay; these boss-mechanic children carry neither bounty nor LP obligations.
 const count=T(e.mem.ab,phase===1?'P1DamageResist.stack_cnt':'P2DamageResist.stack_cnt')??(phase===1?6:12);
 const key=phase===1?'enemy_8019_pollut':'enemy_8019_pollut_2';
 for(let i=0;i<count;i++)b.after(.6+i*.8,()=>{
  if(!live(e)||e.mem.touch.phase!==phase)return;
  const child=spawnChildren(b,e,key,1,{route:remainingRoute(e),countInTotal:false,mods:{...(e.mods||{}),touchEscortRoot:e.id,touchEscortPhase:phase}})[0];
  if(child){child.lpr=0;child.bounty=null;}
 },{owner:e});
}
export function touchKit(ab){
 return [reborn({dur:T(ab,'Reborn.duration')??5,onKo(b,e){stopChannel(b,e,false);endAbsorb(b,e);e.mem.touch.phase=0;cue(b,e,'Reborning','Revive_Begin',5);},onReborn(b,e){
  const s=e.mem.touch;s.phase=2;s.stacks=T(ab,'P2DamageResist.stack_cnt')??12;e.base.maxHp*=1+(T(ab,'Reborn.max_hp')??.5);e.mem.moveSpeedFloor=0;e.markDirty();
  phaseInfusions(b,e,2);
  s.nextPollute=b.time+(ab.sk.P2Pollute?.icd??35);s.nextSummon=b.time+(ab.sk.Summon?.icd??10);
  b.after(1/30,()=>{
   if(!live(e)||e.mem.touch.phase!==2)return;
   cue(b,e,'RebornPollute','Skill_Ability_1',2.5);s.busyUntil=b.time+2.5;b.addBuff(e,{key:'touch:casting',duration:2.5,flags:{noMove:true,disarm:true}});
   const targets=b.allies().filter(u=>live(u)&&u.kind==='op').map(u=>({unit:u,seq:u.deploySeq}));
   b.after(1.833,()=>{if(live(e)&&e.mem.touch.phase===2)chaos(b,e,targets.filter(x=>live(x.unit)&&x.unit.deploySeq===x.seq).map(x=>x.unit));},{owner:e});
  },{owner:e});
 }}),{
  iv:.1,spawn(b,e){install(b);watchDeaths(b,e);e.mem.moveSpeedFloor=e.base.moveSpeed;e.markDirty();const s=e.mem.touch={phase:1,stacks:T(ab,'P1DamageResist.stack_cnt')??6,controls:new Map(),immunities:new Set(),nextPollute:b.time+(ab.sk.P1Pollute?.icd??7),nextAura:b.time+(ab.sk.P1AuraBuff?.icd??25),blockUntil:0,channel:null,absorb:null,child:null};b._touchStates.set(e.id,s);phaseInfusions(b,e,1);},
  hitIn(c,_b,e){if(['phys','arts'].includes(c.dmg.type)){const s=e.mem.touch;c.dmg.mul*=Math.max(0,1-s.stacks*(T(ab,s.phase===2?'P2DamageResist.per_damage_resistance':'P1DamageResist.per_damage_resistance')??.1));}},
  dealt(c,b,e){if(c.dmg?.isAttack&&live(c.target))elem(b,e,c.target,'frenzy',e.s.atk*(T(ab,e.mem.touch.phase===2?'Reborn.attack@ep_damage_ratio':'Attack.attack@ep_damage_ratio')??.5));},
  otherDeath(c,_b,e){if(TOUCH_POLLUT_KEYS.includes(c.unit?.defId))e.mem.touch.stacks=Math.max(0,e.mem.touch.stacks-1);},
  status(c,b,e){if(INHERITED.has(c.status)){e.mem.touch.immunities.add(c.status);b._touchImmunities.add(c.status);}if(e.mem.touch.channel&&interrupted(e))stopChannel(b,e,false);},
  tick(b,e){
   const s=e.mem.touch;
   if(s.phase===0)return;
   if(s.absorb){const a=s.absorb;if(interrupted(e)||!a.fired&&!live(a.target)){blast(b,e);endAbsorb(b,e);return;}if(!a.fired&&b.time>=a.hitAt){a.fired=true;if(live(a.target))b.kill(a.target,e);blast(b,e);}if(b.time>=a.until)endAbsorb(b,e);return;}
   if(s.channel){const ch=s.channel;if(interrupted(e)){stopChannel(b,e,false);return;}
    if(b.time>=ch.start+1)for(const u of b.enemies)if(live(u)&&u!==e)b.addBuff(u,{key:'touch:channelSpeed',duration:.2,mods:{moveMul:1+(ab.sk.P1AuraBuff?.bb.move_speed??.8)}});
    if(b.time>=ch.healAt){for(const u of b.enemies)if(live(u)&&u!==e)b.heal(e,u,e.s.atk*(ab.sk.P1AuraBuff?.bb.heal_scale??1.8));ch.healAt+=ab.sk.P1AuraBuff?.bb.interval??1;}
    if(b.time>=ch.until)stopChannel(b,e,true);return;
   }
   if(!canCast(e,false,b)||e.s.flags.disarm||b.time<(s.busyUntil||0))return;
   if(s.phase===2&&live(s.child)&&hypot(s.child.x-e.x,s.child.y-e.y)<=(T(ab,'AbsorbListener.range_radius')??.6)){startAbsorb(b,e,s.child);return;}
   if(b.time>=s.nextPollute){const skill=ab.sk[s.phase===1?'P1Pollute':'P2Pollute'],targets=byPriority(e,b.alliesInRadius(e.x,e.y,skill?.bb.range_radius??4.5).filter(u=>live(u)&&!b._touchTiles.has(tile(u))&&canTargetAlly(e,u,true)));if(targets.length){cue(b,e,s.phase===1?'P1Pollute':'P2Pollute','Skill_Ability_1',2.5);s.busyUntil=b.time+2.5;b.addBuff(e,{key:'touch:casting',duration:2.5,flags:{noMove:true,disarm:true}});const target=targets[0],life=target.deploySeq;b.after(1.833,()=>{if(live(e)&&live(target)&&target.deploySeq===life)chaos(b,e,[target]);},{owner:e});s.nextPollute=b.time+2.5+(skill?.cd??60);return;}}
   if(s.phase===2&&b.time>=s.nextSummon){summon(b,e);return;}
   if(s.phase===1&&b.time>=s.nextAura&&b.enemies.some(u=>live(u)&&u!==e)){
    const duration=ab.sk.P1AuraBuff?.bb.duration??8;s.channel={start:b.time,until:b.time+duration,healAt:b.time+(ab.sk.P1AuraBuff?.bb.first_trigger_interval??4),noAttack:e.profile.noAttack};e.profile.noAttack=true;b.addBuff(e,{key:'touch:channel',duration,flags:{noMove:true}});cue(b,e,'P1AuraBuff','Skill_1_Begin',duration);
   }
  },
  death(_c,b,e){stopChannel(b,e,false);endAbsorb(b,e);b._touchStates.delete(e.id);},
 }];
}
export function touchPollutKit(ab){return[{
 spawn(_b,e){e.blockWeight=2;if(e.defId!=='enemy_8019_pollut'){e.mem.moveSpeedFloor=e.base.moveSpeed;e.markDirty();}},
 hitIn(c,b,e){if(e.mods?.touchRoot&&['phys','arts'].includes(c.dmg.type))c.dmg.mul*=.2;if(c.source?.side==='ally'&&e.defId!=='enemy_8019_pollut')elem(b,e,c.source,'frenzy',T(ab,'InverseDamage.value')??30);},
}];}
