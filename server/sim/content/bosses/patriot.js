import {hypot} from '../../detmath.js';
import {hurt,allTargets,areaAllies,castSlot,lpLoss,setForm,spawnChildren,stayRoute} from '../enemies/helpers.js';
import {present,fireNative} from '../enemies/compatibility-helpers.js';
export const PATRIOT_KEY='enemy_1506_patrt';
export const PATRIOT_RULES=Object.freeze({transition:20,guardRefresh1:25,guardRefresh2:32,centralEvery:20,guardCut1:.15,guardCut2:.25,shieldCut1:.05,shieldCut2:.1,guardHpMul1:2.3,guardHpMul2:2.68,guardResAdd:10,guardDamageMul:.9,guardShare:.2,gateLp:3,gateEvery:10,destructionMoveMul:.5,destructionRange:1.5,spear1:8,spearDamage1:1.52,spear2:17,thrust1:8,thrust:6});
const guardKey='enemy_1081_sotisd',commanderKey='enemy_1080_sotidp';
const side=(source,e)=>source.x<e.x?-1:1;
const raidOf=(b,e)=>b._patriotRaids?.get(e.mods?.patriotRoot??e.id);
const groundTarget=u=>present(u)&&!u.s.flags.liftoff;
const armoured=u=>u?.mem.patriotGuard;
// Seats in this field, including empty/downed boards, decide its lanes. Mode names and living operators do not.
export function patriotSides(b){const sides=new Set((b.players||[]).map(p=>(p.half??p.side)==='R'?1:-1));return[-1,1].filter(sign=>sides.has(sign));}
function routeTo(b,e,sign){const sides=patriotSides(b);sign=sides.includes(sign)?sign:sides[0];if(sign==null)return stayRoute(e);const center=(b.rect.c0+b.rect.c1)/2;const opts=(b.routes||[]).filter(r=>Array.isArray(r.end)&&(r.end[1]-center)*sign>0);const target=opts[0]?.end||b.grid.specialTiles('end').find(p=>(p[1]-center)*sign>0)||[e.y,sign<0?b.rect.c0:b.rect.c1];return{motion:'WALK',start:[e.y,e.x],end:target,checkpoints:[]};}
function applyRoute(b,e,route){b.restoreEnemyRoute(e,route);e.atkStandUntil=-Infinity;e.swing=false;e.swingTargets=null;}
function ownSpawn(b,raid,parent,key,count,pos,route,extra={}){
 if(!raid.sides.length)return[];
 const living=b.enemies.filter(u=>present(u)&&u.mem.patriotRaid===raid.id).length;
 const guard=!!extra.patriotShieldSlot,liveCap=guard?80:75,totalCap=guard?400:396;
 if(living>=liveCap||raid.spawned>=totalCap)return[];
 const n=Math.min(count,liveCap-living,totalCap-raid.spawned),out=spawnChildren(b,parent,key,n,{pos,route:route||stayRoute(parent),countInTotal:false,mods:{...(parent.mods||{}),patriotRoot:raid.id,...extra}});
 raid.spawned+=out.length;for(const u of out){u.mem.patriotRaid=raid.id;u.bounty=null;u.base.maxHp*=.95;u.base.atk*=.9;u.base.def*=.95;u.markDirty();u.hp=u.s.maxHp;if(!extra.patriotNormalAdd)u.lpr=0;}return out;
}
function makeGuard(b,raid,body,group,i,phase){
 const spacing=.6,sign=group.sign,dy=phase===1?(i-2)*.36:(i-.5)*.34;
 const guard=ownSpawn(b,raid,body,phase===1?guardKey:guardKey+'_2',1,[body.y+dy,body.x+sign*spacing],stayRoute(body),{patriotGuardScale:phase===1?.95:.9,patriotShieldSlot:1})[0];if(!guard)return;
 guard.mem.patriotGuard={raid,body,group,phase,slot:i,sign,dx:sign*spacing,dy};guard.profile.melee=true;
 // Phase two is exactly 268% of an ordinary leader with the same field scaling, before escort adjustments.
 if(phase===1)guard.base.maxHp*=PATRIOT_RULES.guardHpMul1;else guard.base.maxHp=guard.def.maxHp*(guard.mods?.hpMul??1)*PATRIOT_RULES.guardHpMul2;
 guard.base.res=Math.min(85,guard.base.res+PATRIOT_RULES.guardResAdd);guard.markDirty();guard.hp=guard.s.maxHp;
 guard.facing=sign;guard.profile.canTarget=u=>(u.x-body.x)*sign>=0;
 b.addBuff(guard,{key:'patriot:phalanx',persist:true,mods:{dmgTakenMul:PATRIOT_RULES.guardDamageMul},flags:{noDisplace:true,noMove:true},visible:true});group.slots[i]=guard;
}
function setupGuards(b,raid,e,phase){
 const groups=phase===1?raid.sides.map(sign=>({sign,max:5,slots:[],refillAt:null})): [{sign:e.mem.patriotSign,max:2,slots:[],refillAt:null}];e.mem.patriotGroups=groups;
 for(const group of groups)for(let i=0;i<group.max;i++)makeGuard(b,raid,e,group,i,phase);
}
function liveGuards(group){return group.slots.filter(present);}
function protection(e,source){
 const state=e.mem.patriot;if(state){if(state.phase===0||state.phase===1){const group=e.mem.patriotGroups?.find(g=>g.sign===side(source,e));return liveGuards(group||{slots:[]}).length*PATRIOT_RULES.guardCut1;}
  if(state.phase===2&&(source.x-e.x)*e.mem.patriotSign>1e-6)return liveGuards(e.mem.patriotGroups?.[0]||{slots:[]}).length*PATRIOT_RULES.guardCut2;
 }
 const g=armoured(e);if(g){const count=liveGuards(g.group).filter(x=>x!==e).length;return Math.min(g.phase===1?.2:.1,count*(g.phase===1?PATRIOT_RULES.shieldCut1:PATRIOT_RULES.shieldCut2));}return 0;
}
function spear(b,raid,e,phase){
 const targets=allTargets(b,e).filter(groundTarget),sign=e.mem.patriotSign??raid.sides[0];
 const picks=phase===0?raid.sides.map(s=>targets.filter(u=>side(u,e)===s).sort((a,z)=>hypot(a.x-e.x,a.y-e.y)-hypot(z.x-e.x,z.y-e.y)||a.id-z.id)[0]).filter(Boolean):targets.filter(u=>(u.x-e.x)*sign>=-.1).sort((a,z)=>hypot(a.x-e.x,a.y-e.y)-hypot(z.x-e.x,z.y-e.y)||a.id-z.id).slice(0,1);
 if(!picks.length)return;const skill=e.mem.ab.sk['throwspear[Rage]'];castSlot(b,e,skill);b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip:'Skill'});
 for(const u of picks){const x=u.x,y=u.y,life=u.deploySeq;const flight=Math.max(.04,Math.min(3,hypot(x-e.x,y-e.y)/8));b.fx('patriotSpearThrow',{id:e.id,x,y,t:flight});fireNative(b,e,u,'projectile_spear',()=>{b.fx('patriotSpearImpact',{x,y,r:phase===0?.65:1.2});if(phase===0){if(present(u)&&u.deploySeq===life)hurt(b,e,u,e.s.atk*PATRIOT_RULES.spearDamage1,'phys');return;}
  for(const target of areaAllies(b,e,x,y,1.2)){const before=target.hp;const old=target.persist?.redeployMul??1;if(target.persist)target.persist.redeployMul=old*1.5;hurt(b,e,target,e.s.atk*1.8,'phys');if(target.alive||!(before>0)){if(target.persist)target.persist.redeployMul=old;}else if(target.persist)target.persist.redeployMul=old;}
 },{point:{x,y}});}
}
function thrust(b,raid,e,phase){
 const signs=phase===0?raid.sides:[e.mem.patriotSign],range=phase===0?4:3.5;
 for(const sign of signs){const targets=allTargets(b,e).filter(u=>(u.x-e.x)*sign>=0&&(u.x-e.x)*sign<=range&&Math.abs(u.y-e.y)<=.8);
  for(const u of targets)hurt(b,e,u,e.s.atk*1.3,'phys');const u=targets.at(-1);if(u)b.fx('patriotThrust',{id:e.id,src:e.id,to:u.id,x:e.x,y:e.y});
 }b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip:'Attack_2'});
}
function reinforcements(b,raid,body){
 if(!raid.sides.length)return;
 const center=raid.center;for(const[key,count]of[['enemy_1083_sotiab',3],['enemy_1083_sotiab_2',1],[guardKey,1],[guardKey+'_2',1]]){
  const sign=raid.sides[raid.centralIndex++%raid.sides.length],route=routeTo(b,{x:center.x,y:center.y},sign);ownSpawn(b,raid,body,key,count,[center.y,center.x],route,{patriotNormalAdd:1});
 }
 b.fx('summon',{id:body.id,x:center.x,y:center.y,n:6,key:'patriotCentral'});
}
function gateReinforcements(b,raid,body){
 for(const sign of raid.sides){const gate=routeTo(b,body,sign).end;let commander=null;for(const[key,count]of[[commanderKey,1],['enemy_1078_sotisc_2',1],['enemy_1078_sotisc',3]]){
  const route={motion:'WALK',start:gate,end:[body.y,body.x],steps:[{t:'move',p:[body.y,body.x]},{t:'wait',s:99999}]};const out=ownSpawn(b,raid,body,key,count,gate,route);if(key===commanderKey)commander=out[0]||null;for(const u of out){u.mem.patriotEscort=key===commanderKey?body:commander||body;u.mem.patriotEscortBody=body;}
 }}
}
function install(b){if(b._patriotInstalled)return;b._patriotInstalled=true;
 b.on('hpDamage',c=>{const body=c.target;if(body?.defId!==PATRIOT_KEY||!body.mem.patriot||!(c.amount>0)||c.dmg.tags?.includes('hpLoss'))return;
  const guards=(body.mem.patriotGroups||[]).flatMap(liveGuards).filter(g=>hypot(g.x-body.x,g.y-body.y)<1.6);if(!guards.length)return;
  let remaining=c.amount*PATRIOT_RULES.guardShare,absorbed=0;for(let i=0;i<guards.length;i++){const g=guards[i],share=Math.min(g.hp,remaining/(guards.length-i)),loss=b.loseHp(g,share,{source:c.credit||c.source,tags:['patriotGuardShare']});absorbed+=loss;remaining-=loss;}
  c.amount=Math.max(0,c.amount-absorbed);if(absorbed>0)b.fx('shield',{id:body.id,x:body.x,y:body.y,n:Math.round(absorbed)});
 },{priority:-100});
 b.on('hit',c=>{if(!c.source||c.target?.side!=='enemy'||!['phys','arts','true'].includes(c.dmg.type)||c.dmg.tags?.includes('hpLoss'))return;const cut=protection(c.target,c.source);if(cut>0)c.dmg.mul*=Math.max(0,1-cut);},{priority:80});
 b.on('beforeEnemyLeak',c=>{const e=c.enemy;if(e.defId!==PATRIOT_KEY)return;const raid=raidOf(b,e),state=e.mem.patriot;if(!raid||state?.phase!==2)return;c.cancelled=true;if(b.time<(state.gateReady??0))return;state.gateReady=b.time+PATRIOT_RULES.gateEvery;
  lpLoss(b,PATRIOT_RULES.gateLp,'patriotGate',e);
  gateReinforcements(b,raid,e);b._unblock(e);e.x=raid.center.x+e.mem.patriotSign*.3;e.y=raid.center.y;applyRoute(b,e,routeTo(b,e,e.mem.patriotSign));b.fx('appear',{id:e.id,x:e.x,y:e.y});
 });
 b.on('death',c=>{const e=c.unit;if(e?.defId!==PATRIOT_KEY||!e.mem.patriot)return;const raid=raidOf(b,e);if(!raid||raid.bodies.some(present))return;for(const u of b.enemies)if(u.alive&&u.mem.patriotRaid===raid.id)b._remove(u,'expired');});
}
function phase2(b,raid,e,sign){
 sign=raid.sides.includes(sign)?sign:raid.sides[0];if(sign==null){b._remove(e,'expired');return;}
 e.hitArea={w:2,h:2,dx:.5,dy:.5};
 // Radius-based normal attacks still prefer their blocker; melee=true would discard the requested 1.5-tile range.
 const s=e.mem.patriot;s.phase=2;s.lastX=e.x;s.lastY=e.y;s.heading={x:sign,y:0};e.mem.patriotSign=sign;e.profile.noAttack=false;e.profile.melee=false;e.profile.blockFree=false;
 b.removeBuff(e,'patriot:stationary');b.removeBuff(e,'patriot:transition');b.addBuff(e,{key:'patriot:destruction',persist:true,mods:{atkPct:.5,aspd:80,moveMul:PATRIOT_RULES.destructionMoveMul},flags:{noDisplace:true},visible:true});e.base.rangeRadius=PATRIOT_RULES.destructionRange;e.markDirty();
 if(e.bossPool){e.bossHpWindow={min:0,max:raid.boundary};b._syncBossHp(e);}else e.hp=e.s.maxHp;
 setForm(b,e,'destruction','phase',{hitArea:e.hitArea});setupGuards(b,raid,e,2);applyRoute(b,e,routeTo(b,e,sign));s.nextSpear=b.time+PATRIOT_RULES.spear2;s.nextThrust=b.time+PATRIOT_RULES.thrust;
}
export function patriotKit(_ab,e,b){
 install(b);const roots=b._patriotRaids||=(new Map()),rootId=e.mods?.patriotRoot??e.id;let raid=roots.get(rootId);
 if(!raid){raid={id:rootId,center:{x:e.x,y:e.y},sides:patriotSides(b),bodies:[],spawned:0,boundary:e.bossPool?e.bossPool.maxHp*.6:null,nextCentral:b.time+20,centralIndex:0,lastTick:-1};roots.set(rootId,raid);}raid.bodies.push(e);
 return[{
 spawn(b,e,a){e.mem.patriot=a;e.mem.patriotRaid=raid.id;a.phase=0;a.nextSpear=b.time+PATRIOT_RULES.spear1;a.nextThrust=b.time+PATRIOT_RULES.thrust1;e.profile.maxTargets=1;e.profile.melee=false;e.profile.blockFree=true;e.base.rangeRadius=4;e.markDirty();
  if(e.mods?.patriotPhase2){phase2(b,raid,e,e.mods.patriotSign);return;}
  e.hitArea={w:3,h:3,dx:0,dy:0};e.profile.noAttack=true;b.addBuff(e,{key:'patriot:stationary',persist:true,flags:{noMove:true,noDisplace:true,unblockable:true}});
  if(e.bossPool){e.bossHpWindow={min:raid.boundary,max:e.bossPool.maxHp};b._syncBossHp(e);}setupGuards(b,raid,e,1);
  ownSpawn(b,raid,e,commanderKey,1,[e.y-.6,e.x],stayRoute(e));setForm(b,e,'phalanx','phase',{hitArea:e.hitArea});
 },
 tick(b,e,a,dt){if(a.phase===0&&e.bossPool&&e.bossPool.hp<=raid.boundary+1e-8)b.kill(e,null);
  if(a.phase===1){if(b.time>=raid.nextCentral){raid.nextCentral=b.time+PATRIOT_RULES.centralEvery;reinforcements(b,raid,e);}return;}
  if(a.phase===2){const dx=e.x-(a.lastX??e.x),dy=e.y-(a.lastY??e.y),distance=hypot(dx,dy);if(e.moving&&distance>1e-6&&distance<1)a.heading={x:dx/distance,y:dy/distance};else if(distance>=1)a.heading={x:e.mem.patriotSign,y:0};a.lastX=e.x;a.lastY=e.y;}
  for(const group of e.mem.patriotGroups||[]){for(const guard of liveGuards(group)){const off=guard.mem.patriotGuard,h=a.phase===2?a.heading:null,x=h?e.x+h.x*.6-h.y*off.dy:e.x+off.dx,y=h?e.y+h.y*.6+h.x*off.dy:e.y+off.dy;guard.moving=a.phase===2&&hypot(x-guard.x,y-guard.y)>1e-6&&hypot(x-guard.x,y-guard.y)<1;guard.x=x;guard.y=y;guard.facing=h?(h.x<0?-1:1):off.sign;}
   if(liveGuards(group).length<group.max){if(group.refillAt==null)group.refillAt=b.time+(a.phase===0?PATRIOT_RULES.guardRefresh1:PATRIOT_RULES.guardRefresh2);if(b.time>=group.refillAt){const i=Array.from({length:group.max},(_,i)=>i).find(i=>!present(group.slots[i]));makeGuard(b,raid,e,group,i,a.phase===0?1:2);group.refillAt=b.time+(a.phase===0?PATRIOT_RULES.guardRefresh1:PATRIOT_RULES.guardRefresh2);}}else group.refillAt=null;
  }
  if(b.time>=a.nextSpear&&!e.s.flags.stun){a.nextSpear=b.time+(a.phase===0?PATRIOT_RULES.spear1:PATRIOT_RULES.spear2);spear(b,raid,e,a.phase);}
  if((a.phase===0||a.phase===2)&&b.time>=a.nextThrust&&!e.s.flags.stun){a.nextThrust=b.time+(a.phase===0?PATRIOT_RULES.thrust1:PATRIOT_RULES.thrust);thrust(b,raid,e,a.phase);}
  if(raid.lastTick!==b.time){raid.lastTick=b.time;if(b.time>=raid.nextCentral){raid.nextCentral=b.time+PATRIOT_RULES.centralEvery;reinforcements(b,raid,e);}for(const u of b.enemies){let target=u.mem.patriotEscort;if(target&&!present(target))target=u.mem.patriotEscort=u.mem.patriotEscortBody;if(!present(u)||!present(target)||u.blockedBy)continue;if(hypot(u.x-target.x,u.y-target.y)>.9){u.mem.patriotFollowLeft=(u.mem.patriotFollowLeft||0)-dt;if(u.mem.patriotFollowLeft<=0){u.mem.patriotFollowLeft=.5;applyRoute(b,u,{motion:'WALK',start:[u.y,u.x],end:[target.y,target.x],steps:[{t:'move',p:[target.y,target.x]},{t:'wait',s:99999}]});}}}}
 },
 killed(_c,b,e,a){if(a.phase===2)return false;if(a.phase===1){e.hp=1;return true;}if(e.bossPool&&e.bossPool.hp>raid.boundary)e.bossPool.damage(null,e.bossPool.hp-raid.boundary);a.phase=1;e.hp=1;e.profile.noAttack=true;b._unblock(e);for(const g of e.mem.patriotGroups||[])for(const guard of g.slots)if(guard?.alive)b._remove(guard,'expired');e.mem.patriotGroups=[];
  b.addBuff(e,{key:'patriot:transition',duration:PATRIOT_RULES.transition,persist:true,flags:{invulnerable:true,unblockable:true,noMove:true,noDisplace:true},mods:{aspd:100},visible:true});setForm(b,e,'transition');
  b.after(PATRIOT_RULES.transition,()=>{if(!e.alive)return;phase2(b,raid,e,raid.sides[0]);for(const sign of raid.sides.slice(1)){const copy=b.spawnEnemy(PATRIOT_KEY,{pos:[e.y,e.x+sign*.3],route:routeTo(b,e,sign),tag:'boss',countInTotal:false,mods:{...(e.mods||{}),patriotRoot:raid.id,patriotPhase2:1,patriotSign:sign}});if(copy){copy.bounty=null;copy.lpr=0;}}},{owner:e});return true;
 },
 }];
}
