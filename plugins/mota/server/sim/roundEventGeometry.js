import {COLS} from './constants.js';
import {hypot} from './detmath.js';
export const eventOwned=(b,p)=>b.allyUnits.filter(u=>u.ownerId===p.playerId&&u.alive&&u.deployed&&u.kind!=='device');
export function eventRect(b,p){
 const r={...b.rect};if(b.players.length>1){if(p.half==='R')r.c0=Math.max(r.c0,11);else r.c1=Math.min(r.c1,10);}return r;
}
export function eventTiles(b,p,ground=true){
 const R=eventRect(b,p),out=[];
 for(let r=R.r0;r<=R.r1;r++)for(let c=R.c0;c<=R.c1;c++){
  const t=b.grid.tile(r,c);if(t.key==='tile_achand'||t.special||t.build==='NONE')continue;
  if(ground?b.grid.groundPassable(r,c)&&t.height!=='HIGH':t.height==='HIGH')out.push([r,c]);
 }return out;
}
export function eventGate(b,p,kind){
 const R=eventRect(b,p),all=b.grid.specialTiles(kind),local=all.filter(a=>a[1]>=R.c0&&a[1]<=R.c1);
 if(local.length)return local[0];if(all.length)return all.slice().sort((a,z)=>Math.abs(a[1]-(R.c0+R.c1)/2)-Math.abs(z[1]-(R.c0+R.c1)/2))[0];
 const route=b.routes.find(r=>{const a=kind==='start'?r.start:r.end;return a?.[1]>=R.c0&&a?.[1]<=R.c1;})||b.routes[0];
 return (kind==='start'?route?.start:route?.end)||eventTiles(b,p)[0]||[R.r0,R.c0];
}
export function shuffleEventUnits(b,p,rng){
 const units=eventOwned(b,p).filter(u=>u.kind==='op'||u.kind==='token');
 const original=new Map(units.map(u=>[u,[u.tileR,u.tileC]]));
 for(const u of units){const k=u.tileR*COLS+u.tileC;if(b._occ[k]===u)b._occ[k]=null;}
 const used=new Set();for(const u of units){const positions=eventTiles(b,p,u.ground!==false).filter(a=>!used.has(a[0]*COLS+a[1])&&!b.unitAt(...a));rng.shuffle(positions);
  const old=original.get(u),point=positions.find(a=>a[0]!==old[0]||a[1]!==old[1])||positions[0]||old;
  if(!b.relocate(u,...point))b.relocate(u,...old);used.add(u.tileR*COLS+u.tileC);u.homeR=u.tileR;u.homeC=u.tileC;
  b.fx('appear',{id:u.id,x:u.x,y:u.y});
 }
}
export function autoChessEvent(b,p){
 const blue=eventGate(b,p,'end'),red=eventGate(b,p,'start');
 b.every(.75,()=>{for(const u of eventOwned(b,p)){
  if(u.kind!=='op'||!u.ground||u.s.flags.noMove||u.s.flags.bind||u.s.flags.stun||u.s.flags.sleep)continue;
  const sr=u.tileR,sc=u.tileC;
  if(Math.abs(sr-red[0])+Math.abs(sc-red[1])<=1){
   const choices=[blue,...eventTiles(b,p)].filter(a=>Math.abs(a[0]-blue[0])+Math.abs(a[1]-blue[1])<=2&&!b.unitAt(...a));
   if(choices.length&&b.relocate(u,...choices[0]))b.fx('appear',{id:u.id,x:u.x,y:u.y});continue;
  }
  const path=b.grid.findPath(sr,sc,...red);if(!path?.length)continue;
  const next=path.find(a=>a[0]!==sr||a[1]!==sc);if(!next||b.grid.tile(...next).height==='HIGH'||b.grid.tile(...next).key==='tile_achand')continue;
  if(b.relocate(u,...next)){u.homeR=u.tileR;u.homeC=u.tileC;u.dir=red[1]>=sc?'RIGHT':'LEFT';b.refreshRange(u);b.fx('eventMarch',{id:u.id,x:u.x,y:u.y,fromX:sc,fromY:sr,dur:.75});}
 }},{delay:.75});
}
export function dragonEvent(b,p,rng){
 b.after(5,()=>{
  const blue=eventGate(b,p,'end'),red=eventGate(b,p,'start'),tiles=eventTiles(b,p),via=rng.shuffle(tiles.slice()).slice(0,4);
  const points=[blue,...via,red],w={x:blue[1],y:blue[0],index:1,hit:new Set(),done:false};
  const timer=b.every(.1,()=>{
   if(w.done){timer.cancelled=true;return;}const target=points[w.index];if(!target){w.done=true;timer.cancelled=true;return;}
   const dx=target[1]-w.x,dy=target[0]-w.y,d=hypot(dx,dy),step=Math.min(.6,d),oldX=w.x,oldY=w.y;
   if(d>0){w.x+=dx/d*step;w.y+=dy/d*step;}
   b.fx('chen3Wave',{x:w.x,y:w.y,fromX:oldX,fromY:oldY,dr:d?dy/d:0,dc:d?dx/d:1,skill:'event:dragon'});
   for(const u of b.units){if(!u.alive||!u.deployed||u.hidden||u.kind==='device'||w.hit.has(u.id))continue;
    const vx=w.x-oldX,vy=w.y-oldY,l=vx*vx+vy*vy,t=l?Math.max(0,Math.min(1,((u.x-oldX)*vx+(u.y-oldY)*vy)/l)):0;
    if(hypot(u.x-oldX-t*vx,u.y-oldY-t*vy)>.65)continue;
    w.hit.add(u.id);b.dealDamage(null,u,{amount:650+Math.max(0,b.round-1)*65,type:'arts',isSkill:true,canDodge:false});
   }
   if(d<=.6+1e-9){w.index++;w.hit.clear();}
  },{delay:.1});timer.holdsBattle=true;
 },{holdsBattle:true});
}
