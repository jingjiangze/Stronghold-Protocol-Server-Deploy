// Owner adaptation: an interceptable mid-field bomb, with a bounded approach and a survivable detonation.
export const AUTOMATON_RULES=Object.freeze({initialSpeed:.12,maxSpeed:.42,step:.015,interval:.75,warning:2,damageScale:.5,maxHpDamage:.18});
export function automatonTarget(rect,walkable){
 const r=(rect.r0+rect.r1)/2,c=(rect.c0+rect.c1)/2;let best=null,distance=Infinity;
 for(let row=rect.r0;row<=rect.r1;row++)for(let col=rect.c0;col<=rect.c1;col++)if(walkable(row,col)){
  const d=(row-r)*(row-r)+(col-c)*(col-c);if(d<distance){distance=d;best=[row,col];}
 }
 return best||[Math.round(r),Math.round(c)];
}
