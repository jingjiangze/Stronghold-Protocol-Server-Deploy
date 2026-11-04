// Maintainer 2026-10-25: route scan and one deployment start together; combat may begin .6 s later.
export const ROUTE_PREVIEW_SPEED = 8;
export const ROUTE_PREVIEW_TAIL = .5;
export const WAVE_SPAWN_GAP_MS = 600;
export const WAVE_SPAWN_INTERVAL_MULTIPLIER = 1.3;
export const WAVE_INTRO_MS = Object.freeze({COMBAT:1760,UNITE:2960,FINAL_ASSAULT:3550,HIDDEN_CORE:2750});

export function routePreviewSeconds(routes) {
  let longest=0;
  for(const route of routes||[]){
    let length=0;
    for(const points of route.segments||[])for(let i=1;i<points.length;i++)length+=Math.sqrt((points[i].x-points[i-1].x)**2+(points[i].y-points[i-1].y)**2);
    longest=Math.max(longest,length/ROUTE_PREVIEW_SPEED+ROUTE_PREVIEW_TAIL);
  }
  return longest;
}

// Keep simultaneous groups simultaneous. Slow scheduled spacing, never enemy movement or runtime summons.
export function paceWaveSpawns(opts) {
  const rows=opts.spawns||[],times=rows.map(s=>Number(s.time??0)).filter(Number.isFinite);
  const first=times.length?Math.max(0,Math.min(...times)):0,mul=WAVE_SPAWN_INTERVAL_MULTIPLIER;
  let extension=0;
  const spawns=rows.map(s=>{
    const old=Number(s.time??0);if(!Number.isFinite(old))return {...s};
    const interval=Math.max(0,Number(s.interval)||0),time=Math.max(0,old-first)*mul;
    const count=Math.max(1,Math.floor(Number(s.count)||1));
    extension=Math.max(extension,time+(count-1)*interval*mul-(old+(count-1)*interval));
    return {...s,time,interval:interval*mul};
  });
  return {...opts,spawns,timeLimit:Number.isFinite(opts.timeLimit)?opts.timeLimit+extension:opts.timeLimit};
}
