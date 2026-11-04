// Sui's native branch cells belong to a different board. Only its dedicated raid needs this layout.
// [ASSUMED] Use the neutral strip between the actual shell anchors, within one row of their shared front.
// This preserves native hitboxes/counts and lets both fronts' ordinary three-column ranged attacks reach bodies.
import {SUI_STAGE} from '../../../../shared/suiArena.js';
const clamp=(v,a,z)=>Math.max(a,Math.min(z,v));
export const suiRaidLayout=b=>b.stage?.id===SUI_STAGE||b.stage?.suiRaid===true||b.stage?.raw?.suiRaid===true;
const safe=(b,r,c)=>b.grid.inRect(r,c)&&b.grid.groundPassable(r,c)&&b.grid.isLow(r,c)&&!b.grid.tile(r,c).special;
export function suiCorePoint(b){
 if(!suiRaidLayout(b))return null;
 const R=b.rect,roots=b._sui?.roots||[];
 const x=roots.length?roots.reduce((n,e)=>n+(e.spawnX??e.x),0)/roots.length:(R.c0+R.c1)/2;
 const y=roots.length?roots.reduce((n,e)=>n+(e.spawnY??e.y),0)/roots.length:Math.min(4,R.r1);
 const row=clamp(Math.round(y),R.r0,R.r1),col=clamp(Math.round(x),R.c0,R.c1),points=[];
 for(let r=R.r0;r<=R.r1;r++)for(let c=R.c0;c<=R.c1;c++)if(safe(b,r,c))points.push([r,c]);
 points.sort((a,z)=>(Math.abs(a[0]-row)+Math.abs(a[1]-col))-(Math.abs(z[0]-row)+Math.abs(z[1]-col))||a[0]-z[0]||a[1]-z[1]);
 return points[0]||[row,col];
}
export function suiBodyPoint(b,nativeRow,nativeCol){
 const core=suiCorePoint(b);if(!core)return null;
 const [r0,c0]=core,R=b.rect;
 const sides=new Set(b.players.map((p,i)=>p.side==='R'?1:p.side==='L'?-1:i===0?-1:1));
 const paired=sides.has(-1)&&sides.has(1),sign=sides.has(1)?1:-1;
 const desiredRow=clamp(r0+(nativeRow<=2?1:nativeRow>=6?-1:nativeCol>=8?-1:0),Math.max(R.r0,r0-1),Math.min(R.r1,r0+1));
 const desiredCol=c0+(paired?(nativeCol===6?-1:nativeCol===7?1:0):sign);
 const bodies=[...(b._sui?.bodies||[])].filter(e=>e.alive&&e.deployed&&!e.removed),candidates=[];
 for(let r=Math.max(R.r0,r0-1);r<=Math.min(R.r1,r0+1);r++){
  for(let c=Math.max(R.c0+1,c0-2);c<=Math.min(R.c1-1,c0+2);c++){
   if(r===r0&&c===c0||!paired&&(c-c0)*sign<0)continue;
   if(![-1,0,1].every(dc=>safe(b,r,c+dc)))continue;
   const occupied=bodies.filter(e=>Math.round(e.y)===r&&Math.round(e.x)===c).length;
   const edge=paired?Math.max(0,Math.abs(c-c0)-1):0;
   candidates.push({pos:[r,c],score:occupied*100+edge*20+Math.abs(r-desiredRow)+Math.abs(c-desiredCol)});
  }
 }
 candidates.sort((a,z)=>a.score-z.score||a.pos[0]-z.pos[0]||a.pos[1]-z.pos[1]);
 // A malformed custom raid can have no three-tile low-ground footprint; retain the safe core row/column.
 return candidates[0]?.pos||core;
}
