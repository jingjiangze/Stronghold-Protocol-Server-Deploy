// Placement only. Existing fixedLeader descendant/LP semantics are deliberately unchanged.
import {fixedLeader} from '../../shared/leaderSpawns.js';
import {COLS} from './constants.js';
const AUTHORED_FIXED_SPAWNS=new Set(['enemy_2019_cshost','enemy_1544_cledub']);
export const isCentralLeaderSpawn=raw=>fixedLeader(raw)||!!raw&&AUTHORED_FIXED_SPAWNS.has(raw.key);
/** Field-space only; board ownership has already been mapped for this defence group.
 * [ASSUMED] Central-quarter preference adapts fixed-stage actors to these boards. A pair's
 * boards need not share a walkable seam: shared coverage is preferred, never a birth veto.
 */
export function selectCentralLeaderSpawn(b,preferred=null){
 const rect=b.rect,players=b.players||[],gateKeys=new Set([...b.grid.specialTiles('start'),...b.grid.specialTiles('end')].map(([r,c])=>r*COLS+c));
 const low=(r,c)=>b.grid.groundPassable(r,c)&&b.grid.tile(r,c).height==='LOW';
 const boardCells=[];
 for(let r=rect.r0;r<=rect.r1;r++)for(let c=rect.c0;c<=rect.c1;c++)if(players.some(p=>b.onOwnBoard(p,r,c)))boardCells.push([r,c]);
 if(!boardCells.length)return null;
 const boardKeys=new Set(boardCells.map(([r,c])=>r*COLS+c));
 const r0=Math.min(...boardCells.map(p=>p[0])),r1=Math.max(...boardCells.map(p=>p[0])),c0=Math.min(...boardCells.map(p=>p[1])),c1=Math.max(...boardCells.map(p=>p[1]));
 const cr=(r0+r1)/2,cc=(c0+c1)/2;
 const insideCenter=(r,c)=>Math.abs(r-cr)<=Math.max(.5,(r1-r0+1)/4)&&Math.abs(c-cc)<=Math.max(1,(c1-c0+1)/4);
 const groups=players.map(player=>{
  const owned=boardCells.filter(([r,c])=>b.onOwnBoard(player,r,c)&&low(r,c));
  const deployable=owned.filter(([r,c])=>b.grid.canStand(r,c)),anchors=deployable.length?deployable:owned;
  const reached=new Set(anchors.map(([r,c])=>r*COLS+c)),queue=anchors.slice();
  for(let i=0;i<queue.length;i++){
   const[r,c]=queue[i];for(const[dr,dc]of [[-1,0],[0,-1],[0,1],[1,0]]){const rr=r+dr,ccc=c+dc,key=rr*COLS+ccc;if(!low(rr,ccc)||reached.has(key))continue;reached.add(key);queue.push([rr,ccc]);}
  }
  return {anchors,reached,attackers:player.units.filter(u=>u.alive&&u.deployed&&!u.hidden&&u.kind==='op'&&!u.profile?.heal&&u.profile?.dmgType!=='heal')};
 });
 const candidate=(r,c)=>{
  // A rectangle border is not necessarily a gate. Gate exclusion comes from actual stage tiles.
  if(!Number.isInteger(r)||!Number.isInteger(c)||!low(r,c)||gateKeys.has(r*COLS+c))return null;
  const key=r*COLS+c;
  let approach=0,attacks=0,reachable=0;
  for(const group of groups){
   const fire=group.attackers.some(u=>u.rangeKeys?.includes(key)),connected=group.reached.has(key);
   if(fire)attacks++;if(connected)reachable++;
   if(fire||connected&&group.anchors.some(([ar,ac])=>Math.abs(ar-r)+Math.abs(ac-c)<=1))approach++;
  }
  // Never use an absent helper's board. An out-of-board road requires an actual current attacker.
  if(!boardKeys.has(key)&&!attacks||!reachable&&!attacks)return null;
  const occupied=b.allyUnits.some(u=>u.alive&&u.deployed&&!u.hidden&&Math.abs(u.x-c)<.5&&Math.abs(u.y-r)<.5);
  return {r,c,central:insideCenter(r,c),approach,attacks,occupied,d:(r-cr)*(r-cr)+(c-cc)*(c-cc)};
 };
 // Keep a warned legal point stable. Occupancy is a soft preference: an enemy can enter a
 // blocker's legal ground tile; a full player board must not suppress a scheduled boss.
 if(Array.isArray(preferred)&&insideCenter(preferred[0],preferred[1])&&candidate(preferred[0],preferred[1]))return preferred.slice();
 const candidates=[];
 for(let r=rect.r0;r<=rect.r1;r++)for(let c=rect.c0;c<=rect.c1;c++){const row=candidate(r,c);if(row)candidates.push(row);}
 candidates.sort((a,z)=>Number(z.central)-Number(a.central)||z.approach-a.approach||z.attacks-a.attacks||Number(a.occupied)-Number(z.occupied)||a.d-z.d||a.r-z.r||a.c-z.c);
 return candidates.length?[candidates[0].r,candidates[0].c]:null;
}
