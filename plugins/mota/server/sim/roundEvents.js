import {startCricket} from './cricket.js';
import {flattenedEvents} from '../../shared/roundEvents.js';
import {createRng,deriveSeed} from './rng.js';
import {eventOwned,eventTiles,shuffleEventUnits,autoChessEvent,dragonEvent} from './roundEventGeometry.js';
import {rearEvent,bearEvent,boxEvent} from './roundEventEnemies.js';
export function prepareRoundSpawns(b,source){
 if(!b.flags.roundEvents)return source;
 let out=source.map(s=>({...s,mods:{...s.mods}}));
 for(const item of b.flags.roundEvents.players||[]){
  if(!flattenedEvents(item.events).some(e=>e.id==='enemyFusion'))continue;
  b._eventFusionActive=true;const own=out,valid=own.filter(s=>b.data.getEnemy(s.enemyKey));
  if(!valid.length)continue;
  const rng=createRng(deriveSeed(b.seed,'event:fusion:'+item.playerId)),carrier=valid.find(s=>s.tag==='boss')||rng.pick(valid),d=b.data.getEnemy(carrier.enemyKey),sum={hp:0,atk:0,def:0,res:0,aspd:0},extraHp=0;
  for(const s of valid){const e=b.data.getEnemy(s.enemyKey),n=Math.max(1,Math.floor(s.count||1)),m=s.mods||{};sum.hp+=e.maxHp*(m.hpMul??1)*n;sum.atk+=e.atk*(m.atkMul??1)*n;sum.def+=e.def*(m.defMul??1)*n;sum.res+=(e.res*(m.resMul??1)+(m.resAdd||0))*n;sum.aspd+=(e.aspd+(m.aspdAdd||0))*n;}
  const fused={...carrier,time:0,count:1,interval:0,mods:{...carrier.mods,hpMul:sum.hp/Math.max(1,d.maxHp),atkMul:sum.atk/Math.max(1,d.atk),defMul:sum.def/Math.max(1,d.def),resMul:0,resAdd:Math.min(95,sum.res),aspdAdd:sum.aspd-d.aspd,eventFusion:1}};
  // Shared boss phases retain their pool/window; absorbed escorts become a real HP shield instead of a new pool.
  if(carrier.tag==='boss'){fused.mods.hpMul=carrier.mods?.hpMul??1;fused.mods.eventFusionShield=Math.max(extraHp,sum.hp-d.maxHp*fused.mods.hpMul);}
  out=[fused];break;
 }
 return out;
}
/** Absorb runtime summons too: no extra model, leak, reward, or unresolved HUD body. */
export function absorbEventSummon(b,e){
 const host=b._eventFusionCarrier;if(!b._eventFusionActive||!host?.alive||e.mods?.eventTeam)return false;
 const hp=e.s.maxHp;for(const key of ['maxHp','atk','def','res','aspd'])host.base[key]+=(e.base[key]||0);host.base.res=Math.min(95,host.base.res);host.markDirty();
 if(host.bossPool)b.addBuff(host,{key:'event:runtimeFusion:'+e.id,shield:hp,persist:true});else host.hp=Math.min(host.s.maxHp,host.hp+hp);
 if(e.inTotal){b.total--;const pp=b._pp(e.ownerId);if(pp)pp.total--;}
 e.alive=false;e.deployed=false;e.removed=true;e.counted=false;e.inTotal=false;e.bounty=null;b._toRelease.push(e);
 b.fx('eventFusion',{id:host.id,x:host.x,y:host.y});return true;
}
function fuseAllies(b,p,rng){
 const all=eventOwned(b,p),ops=all.filter(u=>u.kind==='op');if(!ops.length)return;
 const chosen=rng.pick(ops),sum={maxHp:0,atk:0,def:0,res:0,aspd:0};for(const u of all)for(const k of Object.keys(sum))sum[k]+=u.s[k]||0;
 const before={...chosen.s};for(const k of ['maxHp','atk','def','res','aspd']){
  const desired=k==='res'?Math.min(95,sum[k]):sum[k],ratio=chosen.base[k]>0?before[k]/chosen.base[k]:1;
  chosen.base[k]+=Math.max(0,desired-before[k])/Math.max(.01,ratio);
 }
 chosen.markDirty();chosen.hp=chosen.s.maxHp;
 for(const u of all)if(u!==chosen)b._remove(u,'eventFusion',null,true);
 b.fx('eventFusion',{id:chosen.id,x:chosen.x,y:chosen.y,r:2});
}
export function startRoundEvents(b){
 startCricket(b);
 const config=b.flags.roundEvents;if(!config||b._roundEventsStarted)return;b._roundEventsStarted=true;
 b.on('enemySpawn',({enemy:e})=>{if(e.mods?.eventFusionShield>0)b.addBuff(e,{key:'event:fusion',shield:e.mods.eventFusionShield,persist:true});});
 for(const p of b.players){const entry=config.players?.find(v=>v.playerId===p.playerId),events=flattenedEvents(entry?.events);if(config.swap?.[p.playerId]&&!events.some(e=>e.id==='teamShuffle'))events.push({id:'teamShuffle',seed:deriveSeed(b.seed,'event:swap:'+p.playerId)});
  for(let i=0;i<events.length;i++){
   const e=events[i],rng=createRng(e.seed||deriveSeed(b.seed,'event:'+p.playerId+':'+i+':'+e.id));
   b.fx('roundEvent',{event:e.id,playerId:p.playerId});
   if(e.id==='fragile')rearEvent(b,p,rng);
   else if(e.id==='ursusRoar')bearEvent(b,p,rng);
   else if(e.id==='artillery')b.every(10,()=>{const point=rng.pick(eventTiles(b,p));if(!point)return;const[y,x]=point;
    b.fx('eventArtilleryWarning',{x,y,r:1.2,dur:1.2});b.after(1.2,()=>{b.fx('explosion',{x,y,r:1.2});for(const u of b.units)if(u.alive&&u.deployed&&u.kind!=='device'&&(u.x-x)*(u.x-x)+(u.y-y)*(u.y-y)<=1.44)b.dealDamage(null,u,{amount:700+Math.max(0,b.round-1)*70,type:'phys',isSkill:true,isSplash:true,canDodge:false});});
   },{delay:10});
   else if(e.id==='roulette'){if(rng()<.5){const apply=u=>b.addBuff(u,{key:'event:roulette',mods:{atkPct:.25},persist:true});for(const u of eventOwned(b,p))apply(u);b.on('deploy',({unit:u})=>{if(u.side==='ally'&&u.ownerId===p.playerId)apply(u);});}else{const u=rng.pick(eventOwned(b,p).filter(a=>a.kind==='op'));if(u)b.kill(u);}}
   else if(e.id==='dragon')dragonEvent(b,p,rng);
   else if(e.id==='autoChess')autoChessEvent(b,p);
   else if(e.id==='enemyBox'||e.id==='allyBox')boxEvent(b,p,rng,e.id==='allyBox');
   else if(e.id==='allyFusion')fuseAllies(b,p,rng);
   else if(e.id==='shuffle'||e.id==='teamShuffle')shuffleEventUnits(b,p,rng);
  }
 }
}
