// Native RO5 定乾坤 blackboards/branches. Owner adaptation: two flank shells, then one central second form.
import {hypot,powi} from '../../detmath.js';
import {COLS} from '../../constants.js';
import {SUI_CENTER,SUI_STAGE,SUI_BALANCE} from '../../../../shared/suiArena.js';
import {canTargetAlly} from '../../targeting.js';
import {suiCorePoint,suiBodyPoint} from './sui-layout.js';
import {T,hurt,elem,castSlot,setForm,spawnChildren,stayRoute,allTargets,byPriority,canCast,lpLoss} from '../enemies/helpers.js';

export const SUI_KEY='enemy_2126_dycyue';
export const SUI_FORM2='enemy_2127_dysuih';
export const SUI_BODY_KEYS=Object.freeze(['enemy_2128_dysuib','enemy_2128_dysuib_s1','enemy_2128_dysuib_sp']);
export const SUI_SWORD='enemy_2130_dyswrd',SUI_FIRE='enemy_2131_dyfire';
const live=u=>!!(u?.alive&&u.deployed&&!u.removed);
const bodyLive=u=>live(u)&&u.mem.suiBody?.active;
const clipTime=(e,name,fallback)=>e.def.raw?.nativeAnimations?.durations?.[name]??fallback;
const hitTime=(e,name,fallback)=>e.def.raw?.nativeAnimations?.hits?.[name]?.[0]??fallback;
const stopped=e=>e.s.flags.stun||e.s.flags.sleep||e.s.flags.freeze||e.s.flags.levitate||e.s.flags.palsy;
const blocked=e=>stopped(e)||e.s.flags.disarm;
function at(b,side=0){if(b.stage?.id===SUI_STAGE&&!side)return [...SUI_CENTER];const r=b.rect;return[Math.floor((r.r0+r.r1)/2),side<0?Math.round(r.c0+(r.c1-r.c0)*.3):side>0?Math.round(r.c0+(r.c1-r.c0)*.7):Math.round((r.c0+r.c1)/2)];}
function state(b){
 if(b._sui)return b._sui;
 const s=b._sui={phase:1,roots:[],bodies:new Set(),hands:new Map(),seals:new Map(),bodyIndex:0,phase2:null,transitionAt:null,spawned:0,serial:0};
 for(const p of b.players)s.hands.set(p.playerId,{sword:0,fire:0,readyAt:0});
 b.useSuiCard=(playerId,r,c)=>useSuiCard(b,playerId,r,c);
 b.on('death',({unit})=>{
  if(!unit?.mem.suiBody)return;
  unseal(b,unit);s.bodies.delete(unit);
  if(live(s.phase2)&&!s.phase2.mem.sui?.ending){
   const e=s.phase2;if(!stopped(e)&&!e.buffs.some(x=>x.key!=='sui:casting'&&x.flags?.disarm)){if(e.mem.sui.channel)b.fx('enemyChannelCancel',{id:e.id,x:e.x,y:e.y});e.mem.sui.channel=null;e.mem.sui.busyUntil=b.time+15;b.removeBuff(e,'sui:casting');b.removeBuff(e,'palsy');
    b.addBuff(e,{key:'sui:dizz',duration:15,flags:{noMove:true,disarm:true}});castSlot(b,e,e.mem.ab.sk.StunAnimation,15);setForm(b,e,'suiDizz');
    b.after(15,()=>{if(live(e)&&e.form==='suiDizz')setForm(b,e,'suiDizzEnd');},{owner:e});}
  }
 },{priority:-80});
 b.on('battleEnd',()=>{for(const u of s.bodies)unseal(b,u);});
 return s;
}
function handFor(b,e){
 const s=state(b),owners=b.players.map(p=>p.playerId);if(!owners.length)return null;
 const index=e.mods?.suiSide>0?owners.length-1:0;return s.hands.get(owners[index]);
}
function seal(b,e){
 const s=state(b),row=Math.round(e.y),col=Math.round(e.x);e.mem.suiBody.keys=[];
 b._sealedDeployTiles||=new Set();
 for(let c=col-1;c<=col+1;c++){
  if(!b.grid.inRect(row,c))continue;const key=row*COLS+c;
  let rec=s.seals.get(key);if(!rec){rec={count:0,already:b._sealedDeployTiles.has(key)};s.seals.set(key,rec);}rec.count++;b._sealedDeployTiles.add(key);e.mem.suiBody.keys.push(key);
 }
 for(const u of b.allies()){
  if(!live(u)||Math.round(u.y)!==row||Math.abs(Math.round(u.x)-col)>1)continue;
  b.retreat(u);if(Number.isFinite(u.respawnAt))u.respawnAt=b.time+(u.respawnAt-b.time)*(T(e.mem.ab,'WithdrawAlly.attack@respawn_time')??.15);
 }
 b.fx('suiBodySeal',{id:e.id,x:e.x,y:e.y,tiles:e.mem.suiBody.keys.map(k=>[Math.floor(k/COLS),k%COLS])});
}
function unseal(b,e){
 const s=b._sui;for(const key of e.mem.suiBody?.keys||[]){const rec=s?.seals.get(key);if(!rec)continue;if(--rec.count<=0){if(!rec.already)b._sealedDeployTiles?.delete(key);s.seals.delete(key);}}
 if(e.mem.suiBody)e.mem.suiBody.keys=[];
}
function ownSpawn(b,parent,key,pos,extra={}){
 const s=state(b);if(!extra.boss&&(s.spawned>=400||b.enemies.filter(u=>live(u)&&u.mem.suiOwned).length>=78))return null;
 const u=spawnChildren(b,parent,key,1,{pos,route:stayRoute({y:pos[0],x:pos[1]}),countInTotal:false,tag:extra.boss?'boss':null,mods:{...(extra.boss?parent.mods:{}),suiRoot:1,...extra}})[0];
 if(u){u.mem.suiOwned=true;u.bounty=null;u.lpr=0;s.spawned++;}return u;
}
// [ASSUMED] Native branch locations are re-laid onto the owner's bilateral 21-column raid field. Three-tile bodies
// retain their actual footprint; mirrored positions give both players reachable mechanics instead of a wide left zone.
function bodyPoint(b,row,col){
 const s=state(b),R=b.rect,cx=(R.c0+R.c1)/2;
 const raid=b.stage?.id===SUI_STAGE,offset=raid?4:3;
 // The source second form and its initial body stand three columns apart. Never put the body inside the raid boss.
 // [ASSUMED] Mirror these outer body lanes for the owner's two prepared fronts; each footprint still reaches col7/13.
 const flank=col<=2||(raid&&col>=8);
 const x=flank?(s.bodyIndex++%2===0?cx-offset:cx+offset):col>=8?cx:cx+(col-6);
 return[Math.max(R.r0,Math.min(R.r1,Math.round(R.r0+(row/8)*(R.r1-R.r0)))),Math.max(R.c0+1,Math.min(R.c1-1,Math.round(x)))];
}
function body(b,e,key,row,col){return ownSpawn(b,e,key,e.defId===SUI_FORM2?(suiBodyPoint(b,row,col)||bodyPoint(b,row,col)):bodyPoint(b,row,col));}
function summonBody(b,e,initial=false){
 const s=state(b),p2=e.defId===SUI_FORM2;
 if(initial&&p2)return body(b,e,SUI_BODY_KEYS[2],4,8); // stage BornSummon.action_index = 2
 if([...s.bodies].some(live))return null;
 if(p2){body(b,e,SUI_BODY_KEYS[0],5,2);body(b,e,SUI_BODY_KEYS[0],3,2);return true;}
 const i=s.serial++%3;return body(b,e,i===2?SUI_BODY_KEYS[2]:SUI_BODY_KEYS[1],i===0?5:i===1?3:4,2);
}
function cue(b,e,skill,form,clip){
 const duration=clipTime(e,clip,3);castSlot(b,e,e.mem.ab.sk[skill],duration);setForm(b,e,form);e.mem.sui.busyUntil=b.time+duration;
 b.addBuff(e,{key:'sui:casting',duration,flags:{noMove:true,disarm:true}});
 b.after(duration,()=>{if(live(e)&&e.form===form)setForm(b,e,'suiIdle');},{owner:e});return duration;
}
function targetFor(b,e,range=Infinity){return byPriority(e,allTargets(b,e).filter(u=>hypot(u.x-e.x,u.y-e.y)<=range));}
function missile(b,e,target,key,pos=null){
 const p=pos||[e.y,e.x+(e.defId===SUI_FORM2?-1:0)];
 const u=ownSpawn(b,e,key,p,{suiTarget:target?.id,suiTargetSeq:target?.deploySeq});
 if(u){u.mem.suiMissile={target,seq:target?.deploySeq,retargeted:false};}return u;
}
function cards(b,e,p2){
 const s=state(b),limit=e.mem.ab.sk[p2?'SendFireCard':'SendPunchCard']?.bb.max_cards??8;
 if(p2){const ids=[...s.hands.keys()],id=ids[(s.cardOwner||0)%ids.length];s.cardOwner=(s.cardOwner||0)+1;const h=s.hands.get(id);if(h)h.fire=Math.min(limit,h.fire+1);}
 else{const h=handFor(b,e);if(h)h.sword=Math.min(limit,h.sword+1);}
}
export function useSuiCard(b,playerId,r,c){
 const s=b._sui,h=s?.hands.get(playerId),ps=b.getPlayer(playerId);if(!s||!h||!ps||s.phase===0||s.phase===3||b.time<h.readyAt||!Number.isInteger(r)||!Number.isInteger(c)||!b.grid.inRect(r,c)||!b.grid.blockable(r,c)||b.isReservedTile(r,c)||ps.dp<25)return false;
 const type=s.phase===2?'fire':'sword';if(h[type]<1)return false;
 const root=s.phase===2?s.phase2:s.roots.find(u=>live(u)&&u.mem.sui.phase===1);if(!live(root))return false;
 // The native trap can be placed without an ally target; the resulting enemy then heads for the nearest goal.
 const target=targetFor(b,{...root,x:c,y:r})[0]||null;
 const spawned=missile(b,root,target,type==='fire'?SUI_FIRE:SUI_SWORD,[r,c]);if(!spawned)return false;
 h[type]--;ps.dp-=25;h.readyAt=b.time+5;return true;
}
function enterSecond(b,s,e){
 if(s.phase===2||s.phase===3)return;s.phase=2;
 for(const h of s.hands.values()){h.fire=Math.min(8,h.fire+h.sword);h.sword=0;}
 const p=suiCorePoint(b)||at(b),u=ownSpawn(b,e,SUI_FORM2,p,{boss:1});if(!u)return;
 for(const root of s.roots)if(live(root))b._remove(root,'expired');
}
function beginTransition(b,e){
 const s=state(b);if(e.mem.sui.phase===0){e.hp=1;return true;}
 e.mem.sui.phase=0;e.hp=1;e.profile.noAttack=true;b._unblock(e);
 b.addBuff(e,{key:'sui:transition',persist:true,flags:{noMove:true,invulnerable:true,untargetable:true,unblockable:true}});setForm(b,e,'suiCollapse');
 if(e.bossPool&&e.bossPool.hp>s.boundary)e.bossPool.damage(null,e.bossPool.hp-s.boundary);
 if(s.transitionAt==null&&(e.bossPool||s.roots.every(u=>!live(u)||u.mem.sui.phase===0))){s.phase=0;s.transitionAt=b.time+clipTime(e,'Die',5.5);b.after(clipTime(e,'Die',5.5),()=>enterSecond(b,s,e));}
 return true;
}
export function suiShellKit(ab){return[{
 spawn(b,e){const s=state(b);s.roots.push(e);s.boundary=e.bossPool?.maxHp*.5;
  e.mem.sui={phase:1,nextCard:b.time+(ab.sk.SendPunchCard?.icd??5),nextShot:b.time+(ab.sk.Punch?.icd??10),nextBody:b.time+(ab.sk.SummonBody?.icd??20),busyUntil:b.time+clipTime(e,'Start',2)};
  if(e.bossPool){e.bossHpWindow={min:s.boundary,max:e.bossPool.maxHp};b._syncBossHp(e);}e.profile.melee=true;e.profile.canTarget=u=>!u.isFlying&&!u.s.flags.liftoff;
  // The owner asked for one shell on each flank; stationary slots keep both partners' prepared fronts relevant.
  b.addBuff(e,{key:'sui:flank',persist:true,flags:{noMove:true,noDisplace:true}});
 },
 hitIn(c,b,e){if(['phys','arts'].includes(c.dmg.type)&&(!e.blockedBy||c.source!==e.blockedBy)&&b.rng.chance(Math.min(T(ab,'MasterBlcok.prob')??.5,SUI_BALANCE.shellDodge))){c.dmg.cancel=true;b.fx('dodge',{id:e.id,x:e.x,y:e.y});}},
 killed(_c,b,e){return beginTransition(b,e);},
 tick(b,e){const s=state(b),a=e.mem.sui;
  if(a.phase===1&&e.bossPool?.hp<=s.boundary+1e-8){b.kill(e);return;}
  if(a.phase!==1)return;
  const n=[...s.bodies].filter(bodyLive).length;
  if(n&&!e.findBuff('sui:bodyProtect'))b.addBuff(e,{key:'sui:bodyProtect',persist:true,flags:{invulnerable:true},visible:true});
  if(!n)b.removeBuff(e,'sui:bodyProtect');
  const atkPct=(handFor(b,e)?.sword||0)*Math.min(T(ab,'MasterBlcok.base_atk')??.3,SUI_BALANCE.cardAttack);
  const oldAttack=e.findBuff('sui:cardAttack');
  // Same value and no pre-buff observers: renew the original 0.2s lifetime without rebuilding stats every tick.
  // Keep the ordinary addBuff path when hooks exist, the value changes, or a dispel removed the buff.
  if(oldAttack?.duration===.2&&oldAttack.mods?.atkPct===atkPct&&!b._hooks.beforeBuff)oldAttack.timeLeft=.2;
  else b.addBuff(e,{key:'sui:cardAttack',duration:.2,mods:{atkPct}});
  if(blocked(e)||b.time<a.busyUntil)return;
  if(b.time>=a.nextBody&&![...s.bodies].some(live)){const d=cue(b,e,'SummonBody','suiBodyCast','Skill_2');b.after(hitTime(e,'Skill_2',3.1),()=>{if(live(e)&&a.phase===1)summonBody(b,e);},{owner:e});a.nextBody=b.time+d+(ab.sk.SummonBody?.cd??54);return;}
  if(b.time>=a.nextCard){const d=cue(b,e,'SendPunchCard','suiCardCast','Skill_1');b.after(hitTime(e,'Skill_1',1.467),()=>{if(live(e)&&a.phase===1)cards(b,e,false);},{owner:e});a.nextCard=b.time+d+(ab.sk.SendPunchCard?.cd??36);return;}
  if(b.time>=a.nextShot){const picks=targetFor(b,e,ab.sk.Punch?.bb.range_radius??13),n=(handFor(b,e)?.sword||0)+1;if(picks.length){const d=cue(b,e,'Punch','suiCardCast','Skill_1');b.after(hitTime(e,'Skill_1',1.467),()=>{if(live(e)&&a.phase===1)for(const u of picks.slice(0,n))if(live(u))missile(b,e,u,SUI_SWORD);},{owner:e});a.nextShot=b.time+d+(ab.sk.Punch?.cd??30);}}
 },
}];}
export function suiSecondKit(ab){return[{
 spawn(b,e){const s=state(b);s.phase=2;s.phase2=e;e.mem.sui={phase:2,busyUntil:b.time+clipTime(e,'Start',7.533),nextCard:b.time+(ab.sk.SendFireCard?.icd??15),nextShot:b.time+(ab.sk.SummonFire?.icd??5),nextChannel:b.time+(ab.sk.FireToFarthestTile?.icd??40),nextBody:b.time+(ab.sk.SummonBody?.icd??20),doom:b.time+(ab.sk.GiantTailStrike?.icd??3000),hpStage:1,channel:null};
  // Owner's two prepared fronts stand at columns7/13. The centred giant's raid hitbox reaches both fronts;
  // otherwise native single-lane width2.95 leaves both melee teams unable to participate after the phase change.
  e.hitArea={w:5.5,h:2.95,dx:0,dy:1};e.profile.noAttack=true;
  b.addBuff(e,{key:'sui:center',persist:true,flags:{noMove:true,noDisplace:true,unblockable:true}});
  if(e.bossPool){e.bossHpWindow={min:0,max:s.boundary||e.bossPool.maxHp*.5};b._syncBossHp(e);}
  for(const h of s.hands.values()){h.fire=Math.min(8,h.fire+h.sword);h.sword=0;}
  summonBody(b,e,true);
 },
 hitIn(c,b){if(['phys','arts'].includes(c.dmg.type))c.dmg.mul*=powi(SUI_BALANCE.bodyDamageMul,[...state(b).bodies].filter(bodyLive).length);},
 tick(b,e){const s=state(b),a=e.mem.sui;
  const lost=1-e.hp/e.s.maxHp,threshold=T(ab,'HpTriggerSummon.hp_ratio')??.3;
  if(e.hp>0&&lost>threshold*a.hpStage){a.hpStage=Math.floor(lost/threshold)+1;const step=Math.min(3,a.hpStage-1);if(step===1){body(b,e,SUI_BODY_KEYS[0],1,6);body(b,e,SUI_BODY_KEYS[0],2,7);}else if(step===2){body(b,e,SUI_BODY_KEYS[2],6,8);body(b,e,SUI_BODY_KEYS[0],7,6);}else{body(b,e,SUI_BODY_KEYS[0],7,2);body(b,e,SUI_BODY_KEYS[0],4,2);}}
  if(a.channel){if(stopped(e)||e.findBuff('sui:dizz')){a.channel=null;b.removeBuff(e,'sui:casting');b.fx('enemyChannelCancel',{id:e.id,x:e.x,y:e.y});return;}if(b.time>=a.channel.next&&b.time<a.channel.until){const picks=targetFor(b,e),target=b.rng.pick(picks);if(target)missile(b,e,target,SUI_FIRE);a.channel.next+=ab.sk.FireToFarthestTile?.bb['enemy_dysuih_summon_fire_to_farthest.interval']??.49;}if(b.time>=a.channel.until){a.channel=null;setForm(b,e,'suiChannelEnd');}return;}
  if(!canCast(e,false,b)||blocked(e)||b.time<a.busyUntil)return;
  if(b.time>=a.doom){a.ending=true;const duration=cue(b,e,'GiantTailStrike','suiDoom','Skill_3');b.after(hitTime(e,'Skill_3',6.3),()=>{if(live(e))lpLoss(b,50,'suiTail',e);},{owner:e});b.after(duration+.2,()=>{if(live(e)){cleanup(b,e);b._remove(e,'expired');b.forceEnd('timeout');}},{owner:e});a.doom=Infinity;return;}
  if(b.time>=a.nextBody&&![...s.bodies].some(live)){const d=cue(b,e,'SummonBody','suiCardCast','Skill_1');b.after(hitTime(e,'Skill_1',2.167),()=>{if(live(e))summonBody(b,e);},{owner:e});a.nextBody=b.time+d+(ab.sk.SummonBody?.cd??60);return;}
  if(b.time>=a.nextCard){const d=cue(b,e,'SendFireCard','suiCardCast','Skill_1');b.after(hitTime(e,'Skill_1',2.167),()=>{if(live(e))cards(b,e,true);},{owner:e});a.nextCard=b.time+d+(ab.sk.SendFireCard?.cd??30);return;}
  const picks=targetFor(b,e,ab.sk.SummonFire?.bb.range_radius??15);
  if(b.time>=a.nextChannel&&picks.length){const duration=ab.sk.FireToFarthestTile?.bb.duration??10;a.channel={next:b.time+2.5,until:b.time+duration};a.busyUntil=b.time+duration;castSlot(b,e,ab.sk.FireToFarthestTile,duration);setForm(b,e,'suiChannel');b.addBuff(e,{key:'sui:casting',duration,flags:{noMove:true,disarm:true}});a.nextChannel=b.time+duration+(ab.sk.FireToFarthestTile?.cd??40);return;}
  if(b.time>=a.nextShot&&picks.length){const n=Math.min(ab.sk.SummonFire?.bb.max_target??15,1+[...s.hands.values()].reduce((n,h)=>n+h.fire,0)),d=cue(b,e,'SummonFire','suiCardCast','Skill_1');b.after(hitTime(e,'Skill_1',2.167),()=>{if(live(e))for(const u of picks.slice(0,n))if(live(u))missile(b,e,u,SUI_FIRE);},{owner:e});a.nextShot=b.time+d+(ab.sk.SummonFire?.cd??12);return;}
  if(b.time>=(a.nextAttack??0)&&picks.length){const target=picks[0],seq=target.deploySeq;b.fx('enemyCue',{id:e.id,to:target.id,x:e.x,y:e.y,clip:'Attack'});a.busyUntil=b.time+clipTime(e,'Attack',4);b.after(hitTime(e,'Attack',2.3),()=>{if(live(e)&&live(target)&&target.deploySeq===seq)missile(b,e,target,SUI_FIRE);},{owner:e});a.nextAttack=b.time+e.s.bat;}
 },
 death(_c,b,e){cleanup(b,e);},
}];}
function cleanup(b,e){const s=state(b);s.phase=3;for(const u of s.bodies)unseal(b,u);for(const u of b.enemies)if(live(u)&&u!==e&&(u.mem.suiOwned||u.mem.suiBody))b._remove(u,'expired');}
export function suiBodyKit(){return[{
 spawn(b,e){const s=state(b);s.bodies.add(e);e.mem.suiBody={active:false,keys:[]};e.profile.noAttack=true;e.hitArea={w:2.95,h:.95,dx:0,dy:0};
  b.addBuff(e,{key:'sui:bodyFixed',persist:true,flags:{noMove:true,noDisplace:true,unblockable:true}});b.addBuff(e,{key:'sui:bodyBorn',duration:3.1,flags:{invulnerable:true,untargetable:true}});
  b.after(3.1,()=>{if(live(e)){e.mem.suiBody.active=true;seal(b,e);}},{owner:e});
 },
}];}
export function suiMissileKit(_ab,e){if(!e.mods?.suiRoot)return[];return[{
 spawn(_b,e){e.profile.noAttack=true;e.profile.melee=true;e.mem.suiOwned=true;e.mem.suiMissile||={target:null,seq:null,retargeted:false};e.lpr=1;},
 tick(b,e,_a,dt){const s=e.mem.suiMissile;if(s.dying)return;
  // Deployment identity belongs to the tracked unit, never to an interceptor. A redirected enemy can still be blocked.
  const interceptor=live(e.blockedBy)?e.blockedBy:null;
  if(!s.retargeted&&(!live(s.target)||s.target.deploySeq!==s.seq||!canTargetAlly(e,s.target,true))){s.retargeted=true;const end=(b.routes||[]).map(r=>r.end).filter(Boolean).sort((a,z)=>hypot(a[1]-e.x,a[0]-e.y)-hypot(z[1]-e.x,z[0]-e.y))[0]||[e.y,b.rect.c0];s.goal={x:end[1],y:end[0]};}
  const target=interceptor||(!s.retargeted?s.target:null),goal=target||s.goal;if(!goal)return;
  const distance=hypot(goal.x-e.x,goal.y-e.y);
  if(target&&(distance<=(e.def.raw?.stats?.rangeRadius??1.3)*.5||interceptor)){s.dying=true;const amount=e.s.atk,seq=target.deploySeq;b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip:'Attack'});b.after(hitTime(e,'Attack',.1),()=>{if(!live(e))return;if(live(target)&&target.deploySeq===seq){b.fx('suiMissileHit',{id:e.id,x:target.x,y:target.y});hurt(b,e,target,amount,e.defId===SUI_FIRE?'arts':'phys',{canDodge:true});if(e.defId===SUI_FIRE)elem(b,e,target,'burn',amount*.25);}b.after(1/30,()=>{if(live(e))b.kill(e);},{owner:e});},{owner:e});return;}
  if(distance<=.2&&s.retargeted){b.leak(e);return;}
  const step=Math.min(distance,e.s.moveSpeed*dt);if(distance>0){e.x+=(goal.x-e.x)/distance*step;e.y+=(goal.y-e.y)/distance*step;e.moving=true;}
  e.atkStandUntil=Infinity;
 },
}];}
