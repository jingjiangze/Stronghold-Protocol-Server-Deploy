// Owner 2026-10-23: each player's normal round plan, including bounties, has at most 60 enemies.
export const ROUND_ENEMY_LIMIT=60;
const count=s=>typeof s?.enemyKey==='string'?Math.max(0,Math.trunc(s.count??1)):0;
export const plannedEnemyCount=spawns=>(spawns||[]).reduce((n,s)=>n+count(s),0);

/** Keep bounty obligations, then leaders and their required escorts, before apportioning ordinary units. */
export function capRoundEnemies(spawns,limit=ROUND_ENEMY_LIMIT){
 const rows=(spawns||[]).map((spawn,index)=>({spawn,index,count:count(spawn)}));
 limit=Math.max(0,Math.trunc(limit));
 if(rows.reduce((n,r)=>n+r.count,0)<=limit)return spawns;
 const result=new Map();
 const allocate=(group,budget)=>{
  const total=group.reduce((n,r)=>n+r.count,0),used=Math.min(total,budget);
  const shares=group.map(r=>{const exact=total?r.count*used/total:0,take=Math.floor(exact);result.set(r.index,take);return{...r,remainder:exact-take};});
  let remaining=used-shares.reduce((n,r)=>n+(result.get(r.index)||0),0);
  shares.sort((a,b)=>b.remainder-a.remainder||a.index-b.index);
  for(const r of shares)if(remaining>0&&result.get(r.index)<r.count){result.set(r.index,result.get(r.index)+1);remaining--;}
  return used;
 };
 const priority=rows.filter(r=>r.spawn.tag==='bounty'||r.spawn.bounty);
 const used=allocate(priority,limit);
 const rest=rows.filter(r=>!(r.spawn.tag==='bounty'||r.spawn.bounty));
 const reserved=rest.filter(r=>r.spawn.tag==='boss'||r.spawn.tag==='leaderEscort'||r.spawn.mods?.ursusCommandGroup);
 const reservedUsed=allocate(reserved,limit-used);
 allocate(rest.filter(r=>r.spawn.tag!=='boss'&&r.spawn.tag!=='leaderEscort'&&!r.spawn.mods?.ursusCommandGroup),limit-used-reservedUsed);
 return rows.flatMap(r=>{if(!r.count&&typeof r.spawn.enemyKey!=='string')return[r.spawn];const n=result.get(r.index)||0;return n?[{...r.spawn,count:n}]:[];});
}
