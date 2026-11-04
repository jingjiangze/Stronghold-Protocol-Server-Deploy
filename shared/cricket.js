// Owner's unranked blind-box room mode. [ASSUMED] Boss odds: 5% at R1, +3.5 points/round, capped at 65%.
export const validCricket=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).every(k=>['enabled','count'].includes(k))&&typeof v.enabled==='boolean'&&Number.isInteger(v.count)&&v.count>=1&&v.count<=5;
export const cricketSettings=v=>validCricket(v)?{enabled:v.enabled,count:v.count}:{enabled:false,count:1};
export const cricketBossChance=r=>Math.min(.65,.05+Math.max(0,r-1)*.035);

export const cricketCombatTime=(m,seconds)=>m.cricket?.enabled&&Number.isFinite(seconds)?Math.max(180,seconds*2):seconds;
