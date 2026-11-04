// Read-only route inspection. No Battle construction, start/step, hooks, RNG or skill execution.
import {Grid} from './grid.js';
import {compileRoute,predictRouteLegs} from './ai.js';
import {normalizeRoute,normalizeStage,toDataSource} from './simdata.js';
import {BLACKSNAKE_KEY,BLACKSNAKE_TUNING,blackSnakeZone,blackSnakeGroundStart,blackSnakePatrolNodes,
  blackSnakeRoute,blackSnakeBlinkTarget,blackSnakeSummonTiles,blackSnakeAddRoute} from './content/bosses/blacksnake-tactics.js';
import {pursuerBodySlots,PURSUER_KEY} from '../../shared/pursuerEncounter.js';
import {pursuerPatrolRoute,fitPursuerRoute} from '../../shared/pursuerRoutes.js';

// Exact stationary talent roster; tested against bosses.js SELF_BOUND, not a broad "humanoid" tag.
const STATIONARY=new Set(['enemy_9013_acstmk','enemy_9013_acstmk_2','enemy_9021_acduml','enemy_9021_acduml_2',
  'enemy_1521_dslily','enemy_9032_aclionk','enemy_9033_acdeer','enemy_2126_dycyue']);
const CACHE=new WeakMap(),WORK=new WeakMap(),MAX_PLANS=48;
export function routePredictionStats(b){return {...(WORK.get(b)||{staticBuilds:0,liveBuilds:0})};}
const halfOf=(b,x)=>x>(b.rect.c0+b.rect.c1)/2?'R':'L';
const routeOf=(b,s)=>normalizeRoute(s.route||b.routes[s.routeIndex??0]||b.routes[0]);
const ownedHalf=(b)=>b.players.length===1?(b.players[0].half??b.players[0].side??'L'):null;

function templateOf(b){
  const explicit=b.opts.waveId||b.opts.waveTemplate;
  if(explicit)return typeof explicit==='string'?b.data.getWave(explicit):explicit;
  const signature=JSON.stringify(b.routes.map(normalizeRoute));
  for(const id of b.data.waveIds()){
    const w=b.data.getWave(id);
    if(w.kind!=='boss'&&w.kind!=='hidden')continue;
    if(JSON.stringify((w.routes||[]).map(normalizeRoute))===signature)return w;
  }
  return null;
}
function rawRoute(b,route,tpl){
  const signature=JSON.stringify(route);
  return [...(tpl?.routes||[]),...(tpl?.extraRoutes||[])].find(r=>JSON.stringify(normalizeRoute(r))===signature);
}
function snakeSource(b,start,half){
  const p=blackSnakeGroundStart(b,start,half),nodes=blackSnakePatrolNodes(b,half,p);
  return {x:p[1],y:p[0],motion:'WALK',profile:{zoneBounds:blackSnakeZone(b,half),routePlanner:blackSnakeRoute},
    route:{legs:[...nodes,...nodes.slice(0,1)].map(([r,c])=>({t:'move',r,c})),legIdx:0}};
}
function safeProfile(source){
  // Inspection never invokes arbitrary plugin callbacks. Only the built-in pure snake planner is allowed.
  return source.profile?.routePlanner===blackSnakeRoute?{zoneBounds:source.profile.zoneBounds,routePlanner:blackSnakeRoute}:{};
}

/** Actual route legs of this field only. Cached at most once per game second, or when terrain changes. */
export function predictBossRoutes(b,{live:includeLive=true}={}){
  const slot=includeLive?'live':'static',stamp=`${b.grid.version}:${includeLive?Math.floor(b.time||0):'static'}`;
  const previous=CACHE.get(b)||{};
  if(previous[slot]?.stamp===stamp)return previous[slot].plans;
  const live=includeLive?(b.enemies||[]).filter(e=>e.alive&&!e.removed):[],scheduled=b.opts.spawns||[];
  const boss=e=>e.tag==='boss'||e.isBoss||b.data.getEnemy(e.enemyKey||e.defId)?.rank==='BOSS';
  if(!scheduled.some(boss)&&!live.some(boss))return [];
  const work=WORK.get(b)||{staticBuilds:0,liveBuilds:0};work[includeLive?'liveBuilds':'staticBuilds']++;WORK.set(b,work);
  const plans=[],tpl=templateOf(b),groups=new Map(),mid=(b.rect.c0+b.rect.c1)/2;
  const add=(entry,source,legs,{loop=false,stationary=false,conditional=false}={})=>{
    if(plans.length>=MAX_PLANS)return;
    const path=stationary?{segments:[],jumps:[],waits:[],blocked:false}:predictRouteLegs(b,{...source,profile:safeProfile(source)},legs);
    const plan={...entry,id:`prediction:${plans.length}`,rect:{...b.rect},stageId:b.stageId||b.opts.stageId,
      start:{x:source.x,y:source.y},...path,loop,stationary,conditional,
      boundary:entry.role==='boss'?'skills-targets-obstacles':'blocking-obstacles'};
    if(entry.enemyKey===BLACKSNAKE_KEY&&!stationary){
      const target=blackSnakeBlinkTarget(b,{...source,profile:safeProfile(source),route:{legs,legIdx:0}});
      plan.blinkLimit=BLACKSNAKE_TUNING.blinkDistance;
      if(target)plan.jumps.push({from:plan.start,to:{x:target[1],y:target[0]},kind:'blink',conditional:true});
    }
    plans.push(plan);
  };
  const addSnake=(entry,start,half)=>{
    const source=snakeSource(b,start,half);
    add({...entry,half},source,source.route.legs,{loop:true});
    // Pool composition and trigger time are dynamic; only the shared skill's real possible paths are shown.
    for(const at of blackSnakeSummonTiles(b)){
      const route=blackSnakeAddRoute(b,half,at);if(!route)continue;
      add({enemyKey:BLACKSNAKE_KEY,name:entry.name,half,role:'skillEscort',count:null,time:null},
        {x:at[1],y:at[0],motion:'WALK',profile:source.profile},compileRoute(route,b.rect),{conditional:true});
    }
  };
  for(const s of scheduled){
    if(s.tag==='part'||!Number.isFinite(Number(s.time??0)))continue;
    const def=b.data.getEnemy(s.enemyKey);if(!def)continue;
    const route=routeOf(b,s);if(!route?.start)continue;
    const isBoss=boss(s),start=s.pos||route.start,half=isBoss&&s.enemyKey===BLACKSNAKE_KEY?(ownedHalf(b)||halfOf(b,start[1])):halfOf(b,route.end?.[1]??start[1]);
    if(isBoss&&live.some(e=>e.defId===s.enemyKey&&boss(e)))continue;
    const entry={enemyKey:s.enemyKey,name:def.name,half,role:isBoss?'boss':'escort',count:s.count||1,time:s.time||0};
    const key=JSON.stringify([s.enemyKey,route,half,s.pos]);
    if(groups.has(key)){groups.get(key).count+=entry.count;continue;}
    groups.set(key,entry);
    if(s.enemyKey===BLACKSNAKE_KEY&&isBoss){
      addSnake(entry,start,half);
      if(b.players.length>1&&b.opts.bossMirror!==false)addSnake(entry,[start[0],mid+2],'R');
      continue;
    }
    if(s.enemyKey===PURSUER_KEY&&isBoss){
      for(const slot of pursuerBodySlots(b.players,b.rect)){
        const side=slot.side,source={x:slot.start[1],y:slot.start[0],motion:'WALK'};
        add({...entry,half:side>0?'R':'L'},source,[],{stationary:true});
        // Phase two draws upper/lower per lap. Show both legal possibilities without drawing RNG.
        for(const upper of [true,false]){
          const candidate=normalizeRoute(fitPursuerRoute(pursuerPatrolRoute(side,upper,slot.start,mid),b.grid,b.rect,side,mid));
          add({...entry,half:side>0?'R':'L',branch:upper?'upper':'lower',futurePhase:true},source,compileRoute(candidate,b.rect),{loop:true,conditional:true});
        }
      }
      continue;
    }
    const raw=rawRoute(b,route,tpl),loop=raw?.steps?.some(st=>st.t==='patrol')||false;
    const legs=compileRoute(route,b.rect);if(loop&&legs.at(-1)?.final)legs.pop();
    add(entry,{x:start[1],y:start[0],motion:def.motion},legs,{loop,stationary:STATIONARY.has(s.enemyKey)||s.enemyKey==='enemy_1506_patrt'});
    if(isBoss&&b.players.length>1&&b.opts.bossMirror!==false){
      for(const mirror of tpl?.branches?.boss_battle_multi_player?.[0]||[]){
        if((mirror.key||mirror.enemyKey)!==s.enemyKey)continue;
        const r=normalizeRoute(tpl.extraRoutes?.[mirror.routeIndex]);if(!r?.start)continue;
        const ls=compileRoute(r,b.rect);if(loop&&ls.at(-1)?.final)ls.pop();
        add({...entry,half:halfOf(b,r.start[1]===mid?r.checkpoints.find(cp=>cp.type==='MOVE')?.pos[1]??r.end[1]:r.start[1])},
          {x:r.start[1],y:r.start[0],motion:def.motion},ls,{loop,stationary:STATIONARY.has(s.enemyKey)});
      }
    }
  }
  for(const e of live){
    const isBoss=boss(e);
    if(!isBoss&&!e.mem?.bsAdd&&!e.mods?.nativeBossEscortSource&&e.tag!=='leaderEscort')continue;
    const half=e.mem?.bsSide||halfOf(b,e.x),legs=(e.route?.legs||[]).slice(e.route?.legIdx||0);
    const signature=JSON.stringify(e.route?.legs||[]),raw=[...(tpl?.routes||[]),...(tpl?.extraRoutes||[])].find(r=>JSON.stringify(compileRoute(normalizeRoute(r),b.rect))===signature);
    const loop=e.defId===BLACKSNAKE_KEY||raw?.steps?.some(st=>st.t==='patrol')||false;
    if(loop&&legs.at(-1)?.final)legs.pop();
    add({enemyKey:e.defId,name:e.name,half,role:isBoss?'boss':'escort',count:1,time:b.time||0,unitId:e.id,
      held:!!e._s?.flags?.noMove,phase:e.form||null},e,legs,{loop,
      stationary:STATIONARY.has(e.defId)||e.mem?.pursuer?.phase===0||e.mem?.patriot?.phase===0||e.mem?.patriot?.phase===1});
  }
  CACHE.set(b,{...previous,[slot]:{stamp,plans}});return plans;
}

/** Prep factory: only immutable stage/data + this player's already-resolved field wave are required. */
export function predictBossRoutesFromOptions(options){
  const data=toDataSource(options.data),raw=options.stage||data.getStage(options.stageId);
  const stage=raw&&!raw._norm?normalizeStage(raw.id||options.stageId,raw):raw;
  if(!stage||!options.rect)return [];
  const b={opts:options,data,rect:options.rect,grid:new Grid(stage,options.rect),players:options.players||[],
    routes:(options.routes||[]).map(normalizeRoute),enemies:[],started:false,time:0};
  if(options.devices!==false)for(const d of stage.devices||[]){
    const active=d.raw&&typeof d.raw.active==='boolean'?d.raw.active:!d.hidden&&d.active!==false;
    if(!active||!b.grid.inRect(d.row,d.col))continue;
    if(d.role==='platform'||d.role==='mound')b.grid.setObstacle(d.row,d.col,true);
    else if(d.role==='crate'||d.key==='trap_1105_accrate')b.grid.setObstacle(d.row,d.col,true,'crate');
  }
  return predictBossRoutes(b);
}
