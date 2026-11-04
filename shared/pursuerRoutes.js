/** Fixed boss-board lanes. The owner-defined patrol stays within its assigned half. */
export function pursuerLane(side, upper, center = 10) {
  const c = offset => center + side * offset;
  return upper ? [[5, c(1)], [5, c(3)], [3, c(3)], [3, c(5)], [1, c(7)]]
    : [[1, c(1)], [1, c(3)], [1, c(5)], [1, c(7)]];
}
export function pursuerPatrolRoute(side, upper, start = [4, 10 + side], center = 10) {
  const out = pursuerLane(side, upper, center), back = pursuerLane(side, !upper, center).slice(0, -1).reverse();
  return { motion: 'WALK', start, end: [4, center + side], checkpoints: [],
    steps: [...out, ...back].map(p => ({ t: 'move', p })) };
}
/** Same disappear → wait → appear portal primitives as the existing boss-escort routes. */
export function pursuerArmyRoute(side, upper, start, center = 10) {
  const first = pursuerLane(side, upper, center), second = pursuerLane(side, !upper, center), gate = first.at(-1);
  return { motion: 'WALK', start, end: gate, checkpoints: [], steps: [
    ...first.map(p => ({ t: 'move', p })), { t: 'move', p: [0, gate[1]] },
    { t: 'disappear' }, { t: 'wait', s: 3 }, { t: 'appear', p: second[0] },
    ...second.slice(1, -1).map(p => ({ t: 'move', p })),
  ] };
}

/** Resolve the desired lane on this map's ground tiles; never use the hand row, high ground or an unreachable corner. */
export function fitPursuerRoute(route, grid, rect, side, center=10){
 const safe=Object.assign(Object.create(Object.getPrototypeOf(grid)),grid);
 safe.rect={...rect,...(side<0?{c1:Math.min(rect.c1,center)}:{c0:Math.max(rect.c0,center)})};safe._fields=new Map();
 safe.tiles=grid.tiles.map(t=>t.height==='HIGH'||t.key==='tile_achand'?{...t,pass:'NONE'}:t);
 const ground=[];for(let r=rect.r0;r<=rect.r1;r++)for(let c=safe.rect.c0;c<=safe.rect.c1;c++)if(safe.groundPassable(r,c))ground.push([r,c]);
 if(!ground.length)return route;
 const nearest=(p,from=null)=>ground.slice().sort((a,b)=>(Math.abs(a[0]-p[0])+Math.abs(a[1]-p[1]))-(Math.abs(b[0]-p[0])+Math.abs(b[1]-p[1]))||a[0]-b[0]||a[1]-b[1]).find(q=>!from||safe.findPath(...from,...q))||from||ground[0];
 const start=nearest(route.start);let previous=start;const steps=[];
 const move=p=>{const q=nearest(p,previous),path=safe.findPath(...previous,...q);if(path)for(const point of path.slice(1))steps.push({t:'move',p:point});previous=q;};
 for(const step of route.steps||[]){if(step.t==='move')move(step.p);else if(step.t==='appear'){previous=nearest(step.p);steps.push({...step,p:previous});}else steps.push({...step});}
 move(route.end);return{...route,start,end:previous,steps};
}
