// OB01–OB18, pinned raw data 63c7cec73c3858d0ae913f85cc89af3cef4d744f.
// No trench exists on current garrison boards. Trench-specific actions remain conditional through
// the explicit map adapter below; absent infrastructure is reported, never replaced with random hits.
import {arkUrsusStaticMods} from '../../../../shared/arkUrsusCarry20261101.js';
import {enemyStealthed,canTargetAlly} from '../../targeting.js';
import {hypot,roundHalfEven} from '../../detmath.js';
import {T,hurt,targetsNear,spawnChildren,setForm,castSlot} from './helpers.js';
import {skill,setFloat} from './archetypes.js';
import {channel,present,animationTiming} from './compatibility-helpers.js';
const DRILL='arkUrsusDrillSurfaced';
const d2=(a,z)=>(a.x-z.x)*(a.x-z.x)+(a.y-z.y)*(a.y-z.y);
const nearest=(e,units)=>units.slice().sort((a,z)=>d2(e,a)-d2(e,z)||a.spawnSeq-z.spawnSeq||a.id-z.id)[0]||null;
// Adapter contract: isInside(unit), nearestOpen(unit,radius), occupants(tile), cover(tile,token),
// breakCoverAt(unit). No current board installs it: all units therefore remain outside trenches.
const trenches=b=>b.arkUrsusTrenches||null;
const inside=(b,u)=>trenches(b)?!!trenches(b).isInside(u):b.grid.tile(roundHalfEven(u.y),roundHalfEven(u.x))?.key==='tile_trench';
const breakCover=(b,e)=>trenches(b)?.breakCoverAt(e);
function replan(e){if(e.route){e.route.pts=null;e.route.ptIdx=0;e.route.version=-1;}}
function nativeAttack(e,name){const meta=e.def.raw.nativeAnimations,dur=meta?.durations?.[name];if(dur>0)e.def={...e.def,attackAnim:{dur,hit:meta.hits?.[name]?.[0]??dur/2}};}
function ensureGround(b,e){
 const r=roundHalfEven(e.y),c=roundHalfEven(e.x);
 if(b.grid.groundPassable(r,c))return true;
 const leg=e.route?.legs?.slice(e.route.legIdx).find(l=>l.t==='move'),bounds=e.profile.zoneBounds||b.rect,choices=[];
 for(let rr=bounds.r0;rr<=bounds.r1;rr++)for(let cc=bounds.c0;cc<=bounds.c1;cc++){
  if(!b.grid.groundPassable(rr,cc)||leg&&!b.grid.waypoints(rr,cc,roundHalfEven(leg.r),roundHalfEven(leg.c)))continue;
  choices.push({r:rr,c:cc,d:(rr-e.y)*(rr-e.y)+(cc-e.x)*(cc-e.x)});
 }
 choices.sort((a,z)=>a.d-z.d||a.r-z.r||a.c-z.c);
 if(!choices.length)return false;
 e.y=choices[0].r;e.x=choices[0].c;replan(e);return true;
}
function surface(b,e,ab){
 if(e.mem[DRILL])return;
 // Staying at an already legal position preserves blocking, checkpoint progress and faction source.
 // A malformed/high-tile entry is recovered deterministically; no death, damage or arbitrary jump.
 if(!ensureGround(b,e))return;
 e.mem[DRILL]=true;e.mods={...(e.mods||{}),[DRILL]:1};
 b.removeBuff(e,'arkUrsus:buried');e.profile.noAttack=false;nativeAttack(e,'Attack_B');replan(e);
 const duration=animationTiming(e,['Out'],0);castSlot(b,e,ab.sk.Out,duration);
 if(duration>0)b.addBuff(e,{key:'arkUrsus:emerge',duration,flags:{noMove:true,disarm:true}});
 setForm(b,e,'arkUrsusSurface','phase',{dur:duration});
 if(duration>0)b.after(duration,()=>{if(present(e))setForm(b,e,'arkUrsusGround');},{owner:e});
}
const drill=ab=>[{
 spawn(b,e){
  e.mem[DRILL]=!!(e.mem[DRILL]||e.mods?.[DRILL]);
  if(e.mem[DRILL]){e.profile.noAttack=false;nativeAttack(e,'Attack_B');setForm(b,e,'arkUrsusGround');return;}
  ensureGround(b,e);e.profile.noAttack=true;
  b.addBuff(e,{key:'arkUrsus:buried',persist:true,flags:{stealth:true,unblockable:true}});
  setForm(b,e,'arkUrsusBuried');
 },
 tick(b,e){
  if(e.mem[DRILL])return;
  // Evaluate the same effective invisibility used by targeting/snapshots. HP loss is irrelevant.
  // A reveal aura already covering the spawn is a real suppression and emerges on this tick.
  if(!enemyStealthed(e))surface(b,e,ab);
 },
}];
const worm=()=>[{
 spawn(b,e){if(e.mods?.arkUrsusDriveLeft>0)b.addBuff(e,{key:'arkUrsus:driven',duration:e.mods.arkUrsusDriveLeft,mods:{...e.def.raw.arkUrsusDriven}});},
 tick(b,e){
  const drive=e.findBuff('arkUrsus:driven'),driven=!!drive,target=driven?nearest(e,b.allies().filter(u=>canTargetAlly(e,u,true))):null;
  if(driven||e.mods?.arkUrsusDriveLeft)e.mods={...(e.mods||{}),arkUrsusDriveLeft:drive?Math.max(0,drive.timeLeft??0):0};
  if(driven&&!e.mem.arkUrsusDriven){e.mem.arkUrsusDriven=true;setForm(b,e,'arkUrsusDriven');}
  else if(!driven&&e.mem.arkUrsusDriven){e.mem.arkUrsusDriven=false;setForm(b,e,'arkUrsusNormal');}
  if(target){e.profile.pursuit=(bb,ee)=>nearest(ee,bb.allies().filter(u=>canTargetAlly(ee,u,true)));}
  else if(e.profile.pursuit){delete e.profile.pursuit;delete e.mem.pursuitMove;replan(e);}
 },
}];
const mosquito=()=>[{
 spawn(b,e){const prior=e.profile.canTarget;e.profile.canTarget=u=>(!prior||prior(u))&&inside(b,e)===inside(b,u);},
}];
const fly=ab=>[{
 before(c,b,e,a){a.power=(a.attacks||0)+1>=(ab.sk.MultiAttack?.sp??2)+1;if(!a.power)return;
  const max=ab.sk.MultiAttack?.bb.max_target??3;
  c.targets=[...c.targets,...targetsNear(b,e,e.base.rangeRadius).filter(u=>!c.targets.includes(u))].slice(0,max);castSlot(b,e,ab.sk.MultiAttack);
 },
 attack(c,b,e,a){a.attacks=a.power?0:(a.attacks||0)+1;},
 hitOut(c,b){if(c.dmg.isAttack&&inside(b,c.target))c.dmg.amount*=T(ab,'Passive.damage_scale')??.5;},
}];
const beetle=()=>[{tick(b,e){breakCover(b,e);}}];
const labour=ab=>[skill(ab.sk.ThrowSoil,(b,e)=>{
 const s=ab.sk.ThrowSoil,t=trenches(b),tile=t?.nearestOpen(e,s.bb.range_radius);if(!tile)return;
 const token=channel(b,e,'arkUrsus:throw',s.bb.loop_duration,{},false);
 b.after(s.bb.loop_duration,()=>{if(token.cancelled||!present(e))return;
  for(const u of t.occupants(tile)||[])if(canTargetAlly(e,u,true)){hurt(b,e,u,e.s.atk*s.bb.atk_scale,'phys');if(u.alive)b.applyStatus(u,'stun',{duration:s.bb.stun,source:e});}
  t.cover(tile,s.bs.token_key);
 },{owner:e});
},{cond:(b,e)=>!!trenches(b)?.nearestOpen(e,ab.sk.ThrowSoil.bb.range_radius)})];
const surveillance=ab=>[{
 spawn(b,e){if(e.mods?.arkUrsusLanded){e.mem.arkUrsusLanded=true;e.profile.melee=true;nativeAttack(e,'Attack_B');e.base.bat+=T(ab,'GroundPassive.base_attack_time')??3.5;e.markDirty();setForm(b,e,'arkUrsusLandedStable');}else setFloat(b,e,true);},
 tick(b,e){if(e.mem.arkUrsusLanded||e.hpRatio>=(T(ab,'PassiveCheckHp.hp_ratio')??.5))return;
  e.mem.arkUrsusLanded=true;e.mods={...(e.mods||{}),arkUrsusLanded:1};setFloat(b,e,false);
  e.profile.melee=true;nativeAttack(e,'Attack_B');
  // Native prefab attributeType=BASE_ATTACK_TIME, formulaItem=ADDITION: +3.5 seconds.
  e.base.bat+=T(ab,'GroundPassive.base_attack_time')??3.5;e.markDirty();replan(e);breakCover(b,e);b.addBuff(e,{key:'arkUrsus:landing',duration:1,flags:{noMove:true,disarm:true}});setForm(b,e,'arkUrsusLanded');
 },
}];
function forwardTargets(b,e){
 const p=e.route?.pts?.[e.route.ptIdx]||e.route?.legs?.[e.route.legIdx];
 const dx=(p?.x??p?.c??e.x+e.facing)-e.x,dy=(p?.y??p?.r??e.y)-e.y,len=hypot(dx,dy);if(!(len>0))return[];
 // [ASSUMED] Raw table supplies no detector length/width. The current straight path segment,
 // one tile wide, is the conservative trigger; no high-platform charge.
 return b.allies().filter(u=>canTargetAlly(e,u,true)&&b.grid.groundPassable(roundHalfEven(u.y),roundHalfEven(u.x))&&
  (u.x-e.x)*dx+(u.y-e.y)*dy>0&&Math.abs((u.x-e.x)*dy-(u.y-e.y)*dx)/len<=.5);
}
const wasp=ab=>[{
 spawn(b,e,a){a.used=!!e.mods?.arkUrsusRushUsed;if(e.mods?.arkUrsusStunnedAtk){b.addBuff(e,{key:'arkUrsus:stunnedAtk',persist:true,mods:{atkMul:1+(T(ab,'CheckStun.atk')??-.5)}});nativeAttack(e,'Attack_B');setForm(b,e,'arkUrsusWeak');}},
 tick(b,e,a){if(a.rushing&&a.target&&d2(e,a.target)<=.01){a.rushing=false;b.removeBuff(e,'arkUrsus:rush');delete e.profile.pursuit;delete e.mem.pursuitMove;replan(e);setForm(b,e,e.mods?.arkUrsusStunnedAtk?'arkUrsusWeak':'arkUrsusNormal');}
  if(a.used||e.blockedBy||e.s.flags.stun||e.s.flags.freeze)return;const target=nearest(e,forwardTargets(b,e));if(!target)return;a.target={x:target.x,y:target.y};e.profile.pursuit=()=>a.target;
  a.used=true;a.rushing=true;e.mods={...(e.mods||{}),arkUrsusRushUsed:1};setForm(b,e,'arkUrsusRush');castSlot(b,e,ab.sk.rush);
  // Native prefab FINAL_SCALER uses the blackboard delta, consistently with CheckStun.atk=-0.5.
  b.addBuff(e,{key:'arkUrsus:rush',persist:true,mods:{moveMul:1+(T(ab,'CollideChar.move_speed')??1.2)}});
 },
 blocked(c,b,e,a){if(!a.rushing)return;hurt(b,e,c.blocker,e.s.atk*(T(ab,'CollideChar.atk_scale_collide')??3),'phys',{isSkill:false,canDodge:true});a.rushing=false;b.removeBuff(e,'arkUrsus:rush');delete e.profile.pursuit;delete e.mem.pursuitMove;replan(e);setForm(b,e,e.mods?.arkUrsusStunnedAtk?'arkUrsusWeak':'arkUrsusNormal');castSlot(b,e,ab.sk.rushEndNormal);},
 attack(c,b,e,a){if(a.rushing){a.rushing=false;b.removeBuff(e,'arkUrsus:rush');setForm(b,e,e.mods?.arkUrsusStunnedAtk?'arkUrsusWeak':'arkUrsusNormal');castSlot(b,e,ab.sk.rushEndNormal);}},
 status(c,b,e,a){if(c.status!=='stun')return;a.used=true;e.mods={...(e.mods||{}),arkUrsusRushUsed:1,arkUrsusStunnedAtk:1};
  // Native enemy_dsjccs_skill_disable has INFINITY lifetime. A running charge resumes after stun.
  nativeAttack(e,'Attack_B');setForm(b,e,a.rushing?'arkUrsusRushWeak':'arkUrsusWeak');
  b.addBuff(e,{key:'arkUrsus:stunnedAtk',persist:true,mods:{atkMul:1+(T(ab,'CheckStun.atk')??-.5)}});
 },
}];
const spider=ab=>[skill(ab.sk.Summon,(b,e,a)=>{
 a.done=true;e.mods={...(e.mods||{}),arkUrsusSummoned:1};const s=ab.sk.Summon,token=channel(b,e,'arkUrsus:summon',s.bb.loop_duration,{},true);
 b.after(s.bb.loop_duration,()=>{if(token.cancelled||!present(e)||e.s.flags.silence)return;
  const key=s.bs.enemy_key;
  spawnChildren(b,e,key,s.bb.cnt,{pos:[e.y,e.x],countInTotal:false,mods:arkUrsusStaticMods(e.defId,e.mods)});
  // [ASSUMED] Commit at the 2.1 s channel boundary; native scheduler/attack-frame alignment is unverified.
  // Native CastAura uses GlobalRange and the commander[buff] marker carried by both worm variants.
  for(const u of b.enemies)if(present(u)&&/^enemy_10253_dsjxb(?:_2)?$/.test(u.defId)){
   b.addBuff(u,{key:'arkUrsus:driven',duration:s.bb.buff_duration,mods:{moveMul:1+s.bb.move_speed,aspdAdd:s.bb.attack_speed}});
  }
 },{owner:e});
},{sil:true,cond:(_b,e,a)=>!a.done&&!e.mods?.arkUrsusSummoned})];
const families=[['10253_dsjxb',worm],['10254_dsjarc',mosquito],['10255_dsjmgc',fly],['10256_dsjsld',beetle],['10257_dsjtsz',labour],['10258_dsjccs',wasp],['10259_dsjpgg',surveillance],['10260_dsjzds',drill],['10261_dsjcmd',spider]];
export const ARK_UPDATE_URSUS_KITS=Object.freeze(Object.fromEntries(families.flatMap(([key,fn])=>[['enemy_'+key,fn],['enemy_'+key+'_2',fn]])));
