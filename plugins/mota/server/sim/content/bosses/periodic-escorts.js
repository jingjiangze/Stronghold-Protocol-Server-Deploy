// Replays only the already-resolved native wave sequence. Native boss skills and body parts stay in their kits.
import {isOriginalEscortBoss,MIN_BOSS_ESCORT_COOLDOWN,NATIVE_BOSS_ESCORT_REPEAT_CYCLES,nativeBossEscortMods} from '../../../../shared/bossEscortSchedule.js';
import {MAX_ALIVE_ENEMIES,TICK} from '../../constants.js';

const INSTALLED=new WeakSet();
const live=e=>!!(e?.alive&&e.deployed&&!e.removed);

export function installNativeBossEscorts(b){
 if(INSTALLED.has(b)||!['boss','hidden'].includes(b.kind))return;
 const plan=b.flags?.nativeBossEscorts;
 if(!plan||plan.bossId!==b.opts?.bossId||!isOriginalEscortBoss(plan.bossId,plan.enemyKey)||!Array.isArray(plan.actions))return;
 if(!Number.isFinite(plan.period)||plan.period<MIN_BOSS_ESCORT_COOLDOWN||!(plan.maxLive>0))return;
 INSTALLED.add(b);
 const events=[],groups=[];
 const cycles=Math.min(NATIVE_BOSS_ESCORT_REPEAT_CYCLES,Math.max(0,Math.floor(plan.repeatCycles)));
 for(let cycle=1;cycle<=cycles;cycle++)for(const action of plan.actions){
  const count=Math.min(MAX_ALIVE_ENEMIES,Math.max(0,Math.floor(action.count)));
  const start=action.time+cycle*plan.period;
  if(start+1e-9<b.time||!count)continue; // late content installation never catches up old groups
  const group={action,count,remaining:count,start,cycle,admitted:false,cancelled:false,owner:null};groups.push(group);
  for(let i=0;i<count;i++)events.push({time:start+i*action.interval,index:i,group});
 }
 events.sort((a,z)=>a.time-z.time||a.group.cycle-z.group.cycle||a.group.action.source-z.group.action.source||a.index-z.index);
 let cursor=0,reserved=0;
 const cancel=group=>{
  if(group.admitted)reserved-=group.remaining;
  group.remaining=0;group.cancelled=true;
 };
 const bodyAlive=()=>!b.finished&&!b._endReq&&(!b.sharedBoss||b.sharedBoss.hp>0)
  &&b.enemies.some(e=>live(e)&&e.tag==='boss'&&e.defId===plan.enemyKey);
 const ownerFor=action=>{
  const route=action.route??b.routes[action.routeIndex];
  if(!route||!Array.isArray(route.end))return null;
  const side=route.end[1]>(b.rect.c0+b.rect.c1)/2?'R':'L';
  const owner=b.players.find(p=>(p.half??p.side??'L')===side&&p.eliminated!==true)??null;
  return owner&&(!action.ownerPlayerId||action.ownerPlayerId===owner.playerId)?owner:null;
 };
 b.on('death',({unit})=>{
  if(unit?.tag!=='boss'||unit.defId!==plan.enemyKey)return;
  if(b.enemies.some(e=>e!==unit&&live(e)&&e.tag==='boss'&&e.defId===plan.enemyKey))return;
  for(const group of groups)if(group.admitted&&group.remaining>0)cancel(group);
 },{owner:'nativeBossEscorts'});
 b.on('tick',()=>{
  while(cursor<events.length&&events[cursor].time<=b.time+1e-9){ // loop-cap: <=3 finite native timelines
   const event=events[cursor++],group=event.group,a=group.action;
   if(group.cancelled)continue;
   if(!bodyAlive()||event.time<b.time-TICK-1e-9){cancel(group);continue;}
   const owner=ownerFor(a);
   if(!owner||!b.data.getEnemy(a.enemyKey)){cancel(group);continue;}
   if(!group.admitted){
    const living=b.enemies.filter(e=>live(e)&&e.mods?.nativeBossEscortSource>0).length;
    // Reserve the complete original group, including its future staggered members. Skip the group if it cannot fit.
    if(living+reserved+group.count>plan.maxLive||b.aliveEnemies().length+reserved+group.count>MAX_ALIVE_ENEMIES){cancel(group);continue;}
    group.admitted=true;group.owner=owner.playerId;reserved+=group.remaining;
   }
   if(b.aliveEnemies().length>=MAX_ALIVE_ENEMIES){cancel(group);continue;}
   const route=a.route??b.routes[a.routeIndex],mods={...nativeBossEscortMods(a.mods,a.source),nativeBossEscortCycle:group.cycle};
   // enemySpawn/death handlers run synchronously. Spend this member before a callback can cancel its siblings.
   group.remaining--;reserved--;
   const child=b.spawnEnemy(a.enemyKey,{route,mods,tag:a.tag,bounty:null,countInTotal:true,inTotal:false,
    ownerPlayerId:a.ownerPlayerId??group.owner,sourcePlayerId:a.sourcePlayerId??group.owner});
   if(child)child.bounty=null;else cancel(group);
  }
 },{owner:'nativeBossEscorts'});
}

