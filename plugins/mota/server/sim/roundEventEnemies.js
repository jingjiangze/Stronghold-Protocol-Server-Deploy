import {ADDITIONAL_LEADERS} from '../../shared/additionalLeaders.js';
import {eventTiles,eventGate} from './roundEventGeometry.js';
import {eventHostile} from './eventTeams.js';
import {hypot} from './detmath.js';
const waitRoute=pos=>({motion:'WALK',start:pos,end:pos,checkpoints:[{type:'WAIT',time:99999} ]});
export function rearEvent(b,p,rng,live=null,attempt=0){
 const shared=b.kind!=='normal',entries=(live||b.opts.spawns||[]).filter(s=>s.tag!=='boss'&&s.tag!=='part'&&(shared||(s.ownerPlayerId??b._ownerForTile(s.pos??b._routeFor(s.routeIndex??0,s.route)?.start))===p.playerId));
 const groups=new Map();for(const s of entries){const d=b.data.getEnemy(s.enemyKey);if(!d||d.raw?.independentSpawn===false||d.raw?.deathProduct||d.raw?.bountyOnly)continue;const g=groups.get(s.enemyKey)||{s,n:0};g.n+=s.count||1;groups.set(s.enemyKey,g);}
 const pool=[...groups.values()];if(!pool.length){if(attempt<25&&['boss','hidden'].includes(b.kind))b.after(1,()=>{const rows=b.enemies.filter(e=>e.alive&&!e.isBoss&&!e.mods?.eventTeam&&e.tag!=='eventRear').map(e=>({enemyKey:e.defId,count:1,mods:e.mods}));rearEvent(b,p,rng,rows,attempt+1);},{holdsBattle:true});return;}const total=pool.reduce((n,g)=>n+g.n,0),target=Math.max(1,Math.floor(total/2));
 rng.shuffle(pool);const kinds=pool.slice(0,Math.min(target,Math.max(1,Math.ceil(pool.length/2)))),counts=new Map(kinds.map(g=>[g,1]));
 for(let i=kinds.length;i<target;i++){const g=rng.weighted(kinds,a=>a.n);counts.set(g,(counts.get(g)||0)+1);}
 const blue=eventGate(b,p,'end'),red=eventGate(b,p,'start');
 for(const[g,count]of counts)b._queueSpawn({...g.s,time:b.time+1,count,interval:.6,pos:blue,route:{motion:b.data.getEnemy(g.s.enemyKey).motion,start:blue,end:red,checkpoints:[]},ownerPlayerId:p.playerId,bounty:null,tag:'eventRear',mods:{...g.s.mods,ambushDrop:0,huntNoLp:0,eventRear:1}},true);
 b._pending.sort((a,z)=>Number(!!a.centerPlacementFailed)-Number(!!z.centerPlacementFailed)||a.time-z.time||a.seq-z.seq);
}
export function bearEvent(b,p){
 const blue=eventGate(b,p,'end'),red=eventGate(b,p,'start'),key='enemy_2002_bearmi_2';
 if(!b.data.getEnemy(key))return;
 b.after(1,()=>{
  const e=b.spawnEnemy(key,{pos:blue,route:waitRoute(blue),mods:{eventTeam:2,hpMul:1.5,atkMul:1.1,defMul:1.2,aspdAdd:25},ownerPlayerId:p.playerId,countInTotal:false,tag:'eventBear'});if(!e)return;
  e.mem.eventBear={rageUntil:b.time+25,flee:false,gate:null};e.profile.noAttack=false;e.base.moveSpeed=Math.max(1.25,e.base.moveSpeed);e.markDirty();
  b.on('death',ctx=>{if(ctx.unit===e&&ctx.reason==='killed'){const id=ctx.killer?.ownerId??p.playerId;b.addCoins(id,4);}},{owner:e});
  b.on('beforeEnemyLeak',ctx=>{if(ctx.enemy!==e)return;ctx.cancelled=true;ctx.stopPropagation=true;
   const st=e.mem.eventBear;if(!st.flee)return;const exit=st.gate,target=exit===blue?red:blue;
   e.x=target[1];e.y=target[0];e.hidden=false;e.profile.noAttack=false;st.flee=false;st.rageUntil=b.time+25;e.atkCd=0;b.removeBuff(e,'event:bearFlee');b.fx('appear',{id:e.id,x:e.x,y:e.y});
  },{priority:20,owner:e});
  b.every(.5,()=>{if(!e.alive)return;const st=e.mem.eventBear;
   if(!st.flee&&b.time>=st.rageUntil){st.flee=true;st.gate=hypot(e.x-blue[1],e.y-blue[0])<=hypot(e.x-red[1],e.y-red[0])?blue:red;e.profile.noAttack=true;b.addBuff(e,{key:'event:bearFlee',mods:{moveMul:2},persist:true});b.rerouteEnemy(e,st.gate);}
   if(st.flee)return;
   const target=b.units.filter(u=>u.alive&&u.deployed&&!u.hidden&&u.kind!=='device'&&eventHostile(e,u)).sort((a,z)=>hypot(e.x-a.x,e.y-a.y)-hypot(e.x-z.x,e.y-z.y)||a.id-z.id)[0];
   if(!target)return;const tiles=eventTiles(b,p),at=tiles.sort((a,z)=>hypot(a[1]-target.x,a[0]-target.y)-hypot(z[1]-target.x,z[0]-target.y))[0];if(at)b.rerouteEnemy(e,at);
  },{delay:.5,owner:e});
 },{holdsBattle:true});
}
export function boxEvent(b,p,rng,friendly){
 const pool=ADDITIONAL_LEADERS.filter(key=>{const d=b.data.getEnemy(key);return !!d&&!d.raw?.deathProduct&&!d.raw?.nativeParticleOnly;});
 const key=rng.pick(pool);if(!key)return;const blue=eventGate(b,p,'end'),red=eventGate(b,p,'start'),pos=friendly?blue:red;
 b.fx('eventWheel',{event:friendly?'allyBox':'enemyBox',playerId:p.playerId,enemyKey:key,choices:rng.shuffle(pool.slice()).slice(0,12),dur:2});
 b.after(2,()=>{
  const e=b.spawnEnemy(key,{pos,route:{motion:b.data.getEnemy(key).motion,start:pos,end:friendly?red:blue,checkpoints:[]},ownerPlayerId:p.playerId,countInTotal:!friendly,tag:'eventLeader',mods:friendly?{eventTeam:1}:{eventLeader:1}});
  if(!e)return;if(friendly){e.facing=red[1]>=blue[1]?1:-1;b.fx('eventAlly',{id:e.id,x:e.x,y:e.y});}
  b.fx('eventWheelResult',{event:friendly?'allyBox':'enemyBox',playerId:p.playerId,enemyKey:key,id:e.id,x:e.x,y:e.y});
 },{holdsBattle:true});
}
