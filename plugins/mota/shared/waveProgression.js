import {enemyFamilyKey} from './enemyVariants.js';
// Owner 2026-10-22: compact waves; ordinary contract reinforcements share these limits.
export function waveProgression(round){
 const r=Math.max(1,Math.floor(round));
 // [ASSUMED] Owner 2026-10-27: fewer late bodies; preserve the existing early cadence and species budget.
 return {min:r<=7?r+3:Math.min(19,r+3),max:r<=7?2*r+5:Math.min(28,r+12),minKinds:r<=4?2:r<=8?3:4,maxKinds:r===1?3:r<=3?4:r===4?5:r<=8?6:7};
}
// Small authored subdivisions use population slots, not the main species budget.
export const displayedWaveKinds=spawns=>new Set((spawns||[]).filter(s=>!s.mods?.trainingSubdivision).map(s=>s.enemyKey)).size;
export const countedWaveKinds=(spawns,enemies)=>new Set((spawns||[]).filter(s=>!s.mods?.trainingSubdivision).map(s=>enemyFamilyKey(enemies,s.enemyKey))).size;
