// act55side TL-10 base bodies, client 2.7.91 / 26-10-29-15-36-11-33649006.
// Evidence: bounties/{buff-templates.json,prefabs/*-tree.json,source-evidence.json}.
// No boss_11, enemy_1515_bsnake, enhanced *2 body, partner gate, raid pool or reward handler.
// [ASSUMED] Standalone board adaptation: existing deployable HIGH tiles protect from
// Black Snake's terminal skill as trenches; no terrain or other damage rule changes.
// [ASSUMED] Kingdom anchors become the highest-priority operator's tile (fallback:
// the caster's tile), with native x-1 13-tile diamond and -70 ASPD to both sides.
// [ASSUMED] Hand-only ignition maps to already-created, currently undeployed operators;
// board/hand inventories are not part of BattleSpec. New summons are never marked.
// [ASSUMED] Horizontal fireballs resolve the first current collision at emission;
// no old Black Snake projectile/music or full-map per-frame collision job is installed.
import {COLS} from '../../constants.js';
import {areaSelectable} from '../../targeting.js';
import {roundHalfEven} from '../../detmath.js';
import {areaAllies,byPriority,hurt,castSlot} from './helpers.js';
import {skill} from './archetypes.js';
import {bountyNativeSfxHooks20261101,emitBountyNativeSfx20261101,scheduleBountyNativeLeave20261101} from './ark-update-bounty-sfx-20261101.js';

const KINGDOM_ASPD=-70;
const X1=Object.freeze([[2,0],[1,-1],[1,0],[1,1],[0,-2],[0,-1],[0,0],[0,1],[0,2],[-1,-1],[-1,0],[-1,1],[-2,0]]);
const HIT_TIME=5/6; // A_Skill_1 OnAttack at 0.833333 s in both native skeletons.
const DEATH_HIT=3; // Both A_Skill_2 OnAttack events are exactly 3 s.
const CAST_TIME=Object.freeze({enemy_1602_blksnk:8/3,enemy_1603_hlystp:7/3});
const END_TIME=Object.freeze({enemy_1602_blksnk:6,enemy_1603_hlystp:188/30});
const STATE=new WeakMap();
const tileKey=u=>roundHalfEven(u.y)*COLS+roundHalfEven(u.x);
const present=u=>u?.alive&&u.deployed&&!u.hidden&&!u.removed;
const kingdomKey='ark55:kingdom';
const hasBuff=(u,key)=>(u.buffs||[]).some(b=>b.key===key);

function state(b){
 let s=STATE.get(b);
 if(!s){s={zones:new Map(),slow:new Set(),timer:null};STATE.set(b,s);}
 return s;
}
function inKingdom(b,u){
 const key=tileKey(u);
 for(const anchors of state(b).zones.values())for(const zones of anchors.values())if(zones.has(key))return true;
 return hasBuff(u,'under_kingdom[tile]');
}
function syncKingdom(b){
 const s=state(b),keys=new Set();
 for(const anchors of s.zones.values())for(const zones of anchors.values())for(const key of zones)keys.add(key);
 const next=new Set();
 if(keys.size)for(const u of b.units){
  if(!present(u)||u.kind==='device'||!keys.has(tileKey(u))||u.defId==='enemy_1603_hlystp')continue;
  next.add(u);b.addBuff(u,{key:kingdomKey,duration:.6,mods:{aspd:KINGDOM_ASPD},visible:true});
 }
 for(const u of s.slow)if(!next.has(u))b.removeBuff(u,kingdomKey);
 s.slow=next;
}
function emitKingdom(b,id){
 const anchors=state(b).zones.get(id)||new Map();
 b.fx('arkBountyKingdom',{id,enemyKey:'enemy_1603_hlystp',zones:[...anchors].map(([key,tiles])=>({key,tiles:[...tiles].sort((a,z)=>a-z).map(k=>[Math.floor(k/COLS),k%COLS])}))});
}
function clearKingdom(b,e){
 const s=state(b);s.zones.delete(e.id);syncKingdom(b);emitKingdom(b,e.id);
 if(!s.zones.size&&s.timer){s.timer.cancel();s.timer=null;}
}
function addKingdom(b,e){
 const s=state(b),anchors=s.zones.get(e.id)||new Map();s.zones.set(e.id,anchors);
 const target=byPriority(e,areaAllies(b,e,e.x,e.y,e.base.rangeRadius)).find(u=>u.kind==='op')||e;
 const r=roundHalfEven(target.y),c=roundHalfEven(target.x),zones=new Set();
 anchors.set(r*COLS+c,zones);
 for(const [dr,dc]of X1)if(b.grid.inRect(r+dr,c+dc))zones.add((r+dr)*COLS+c+dc);
 syncKingdom(b);
 emitKingdom(b,e.id);
 if(!s.timer)s.timer=b.every(.5,()=>{
  if(b.finished){s.timer.cancel();s.timer=null;return;}
  syncKingdom(b);
 }); // At most one bounded half-second zone pass per field; never per hit/frame.
}
function clearNearbyKingdom(b,u){
 const r=roundHalfEven(u.y),c=roundHalfEven(u.x),s=state(b);
 // Native remove-zones-in-range removes each whole anchor on overlap.
 for(const [id,anchors]of s.zones){
  let changed=false;
  for(const [anchor,zones]of anchors)if([...zones].some(k=>Math.abs(Math.floor(k/COLS)-r)+Math.abs(k%COLS-c)<=2)){anchors.delete(anchor);changed=true;}
  if(!anchors.size)s.zones.delete(id);
  if(changed)emitKingdom(b,id);
 }
 syncKingdom(b);
 if(!s.zones.size&&s.timer){s.timer.cancel();s.timer=null;}
}
function castLock(b,e,duration){
 const previous=e.profile.noAttack;e.profile.noAttack=true;
 b.addBuff(e,{key:'ark55:casting',duration,flags:{noMove:true}});
 b.after(duration,()=>{if(e.alive&&!e.mem.ark55Dying)e.profile.noAttack=previous;},{owner:e});
}
function fireballs(b,e,u,snapshot){
 const units=b.allies().filter(v=>v!==u&&present(v)&&areaSelectable(e,v)&&Math.abs(v.y-u.y)<=.35);
 for(const direction of [-1,1]){
  const first=units.filter(v=>(v.x-u.x)*direction>0).sort((a,z)=>(a.x-z.x)*direction||a.id-z.id)[0];
  if(!first)continue;
  b.fx('arkBountyNative',{id:e.id,enemyKey:e.defId,action:'fireball',x:u.x,y:u.y,from:u.id,to:first.id});
  // Native projectile source is the deploying operator, not Black Snake: it
  // snapshots that operator's ATK; source side is temporarily left untouched.
  hurt(b,u,first,snapshot.atk*snapshot.scale,'arts',{canDodge:true,tags:['ark55Ignition']});
 }
}
function ignitionDeployment(b,e,a,u){
 const snapshot=a.pending.get(u.id);if(!snapshot||!present(u)||u.kind!=='op')return;
 a.pending.delete(u.id);clearNearbyKingdom(b,u);
 b.fx('arkBountyNative',{id:e.id,enemyKey:e.defId,action:'igniteDeploy',x:u.x,y:u.y,target:u.id});
 // Native DamageViaMaxHpRatio is nonlethal and not an enemy attack.
 b.loseHp(u,Math.min(Math.max(0,u.hp-1),u.s.maxHp*snapshot.hpRatio),{sourceless:true,tags:['ark55IgnitionHpLoss']});
 fireballs(b,e,u,{...snapshot,atk:u.s.atk});
}
function terminal(ab,holy){
 return {
  killed(c,b,e,a){
   if(a.ending)return false;
   if(a.started){e.hp=1;return true;}
   a.started=true;e.mem.ark55Dying=true;e.hp=1;e.profile.noAttack=true;
   const s=ab.sk.Skill2Hp0;castSlot(b,e,s,END_TIME[e.defId]);
   scheduleBountyNativeLeave20261101(b,e);
   b.addBuff(e,{key:'ark55:terminal',persist:true,flags:{invulnerable:true,noMove:true,unblockable:true}});
   b.after(DEATH_HIT,()=>{
    if(!e.alive)return;
    emitBountyNativeSfx20261101(b,e,'skillOn',s.slot);
    const victims=[];
    for(const u of b.allies()){
     if(!present(u)||u.kind!=='op'||!areaSelectable(e,u))continue;
     const kingdom=inKingdom(b,u),t=b.tileInfo(u.tileR,u.tileC);
     const trench=hasBuff(u,'under_trench[tile]')||t.key==='tile_trench'||(t.height==='HIGH'&&t.build!=='NONE');
     if(holy?!kingdom:trench||kingdom)continue;
     // Native wipe_kill explicitly skips reborn: force exit once, retain the
     // mode's normal ally redeployment instead of firing revive/kill handlers.
     victims.push({id:u.id,x:u.x,y:u.y});
     b.retreat(u,{reason:'killed',dying:true});
    }
    if(victims.length)b.fx('arkBountyNative',{id:e.id,enemyKey:e.defId,action:'terminalHit',x:e.x,y:e.y,targets:victims});
   },{owner:e});
   b.after(END_TIME[e.defId],()=>{
    if(!e.alive)return;a.ending=true;b.removeBuff(e,'ark55:terminal');b.kill(e,c.killer);
   },{owner:e});
   return true; // No bounty/LP death until this single terminal cast ends.
  },
  death(c,b,e){if(holy)clearKingdom(b,e);},
 };
}
function snake(ab){
 const s=ab.sk.IgniteHand,passive={
  spawn(b,e,a){
   a.pending=new Map();
   b.on('deploy',c=>{if(e.alive&&!e.mem.ark55Dying&&!c.move)ignitionDeployment(b,e,a,c.unit);},{owner:e});
  },
  death(c,b,e,a){a.pending.clear();},
 };
 return[bountyNativeSfxHooks20261101(),passive,terminal(ab,false),skill(s,(b,e)=>{
  if(e.mem.ark55Dying)return;
  castLock(b,e,CAST_TIME[e.defId]);
  b.after(HIT_TIME,()=>{
   if(!e.alive||e.mem.ark55Dying)return;
   emitBountyNativeSfx20261101(b,e,'skillOn',s.slot);
   for(const u of areaAllies(b,e,e.x,e.y,e.base.rangeRadius))hurt(b,e,u,e.s.atk*s.bb.atk_scale,'phys',{canDodge:true});
   // Source CreateDeckBuff only targets operators currently in hand. BattleSpec
   // has no hand, so only undeployed existing operators receive this explicit adapter.
   for(const u of b.allyUnits)if(u.kind==='op'&&!u.deployed&&!u.removed&&!passive.pending.has(u.id))passive.pending.set(u.id,{hpRatio:s.bb.hp_ratio,scale:s.bb.atk_scale});
  },{owner:e});
 },{cond:(b,e)=>!e.mem.ark55Dying,cd:s.cd+CAST_TIME.enemy_1602_blksnk,fxDuration:CAST_TIME.enemy_1602_blksnk})];
}
function holy(ab){
 const s=ab.sk.SummonKingdom;
 return[bountyNativeSfxHooks20261101(),terminal(ab,true),skill(s,(b,e)=>{
  if(e.mem.ark55Dying)return;
  castLock(b,e,CAST_TIME[e.defId]);
  b.after(HIT_TIME,()=>{
   if(!e.alive||e.mem.ark55Dying)return;
   emitBountyNativeSfx20261101(b,e,'skillOn',s.slot);
   for(const u of areaAllies(b,e,e.x,e.y,e.base.rangeRadius))hurt(b,e,u,e.s.atk*s.bb.atk_scale,'arts',{canDodge:true});
   addKingdom(b,e);
  },{owner:e});
 },{cond:(b,e)=>!e.mem.ark55Dying,cd:s.cd+CAST_TIME.enemy_1603_hlystp,fxDuration:CAST_TIME.enemy_1603_hlystp})];
}
export const ARK_UPDATE_ELITE_BOUNTY_KITS=Object.freeze({enemy_1602_blksnk:snake,enemy_1603_hlystp:holy});
