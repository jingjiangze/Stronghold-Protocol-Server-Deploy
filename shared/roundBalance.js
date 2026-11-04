// Owner 2026-10-23. HARD reference values; other difficulties retain their opening-scale ratio.
export const EARLY_HP=Object.freeze([1.38,1.50,1.68,1.92,2.22,2.58,3.00,3.35,3.75,4.20,4.75]);
export const EARLY_ATK=Object.freeze([1.188,1.22,1.27,1.33,1.40,1.47,1.55,1.63,1.70,1.77,1.82]);
/** [ASSUMED] Owner 2026-10-27: preserve R1-7; continuous HARD reference growth from R8 onward. */
export function ordinaryEnemyGrowth(round){
 const r=Math.max(8,Math.floor(round)),late=r-7;
 return {hp:3+Math.min(late,5)*.12+Math.max(0,late-5)*.16,atk:1.55+late*.04,def:Math.min(1.72,1+Math.max(0,r-9)*.06)};
}
/** [ASSUMED] Owner 2026-10-27: trim 10% of positive boss bonuses, once after composition; preserve base panels and authored reductions. */
export function softenBossBonus(multiplier){
 return multiplier>1?1+(multiplier-1)*.9:multiplier;
}
export function lateBossHpMultiplier(round,pact=false){
 if(!(round>12))return 1;
 const i=Math.max(0,Math.floor(round)-13);
 return pact?[2.4,3,3.8,4.8,5.8,7,8.2,9.5,11][Math.min(i,8)]:Math.min(3.5,2+i*.25);
}
export function lateEliteGrowth(round,leader=false,preserve=false){
 if(!(round>12))return {hpMul:1,atkMul:1,defMul:1};
 const n=Math.min(8,Math.floor(round)-12);
 // Boss fields retain their authored escort balance, including scripted leader reinforcements.
 if(!preserve)return {hpMul:(1.02+n*.025)*(leader?Math.min(1.2,1.03+n*.02):1),atkMul:1.01+n*.015,defMul:1.02+n*.02};
 return {hpMul:(1.02+n*.07)*(leader?Math.min(1.6,1.08+n*.065):1),atkMul:1.02+n*.03,defMul:1.03+n*.035};
}
