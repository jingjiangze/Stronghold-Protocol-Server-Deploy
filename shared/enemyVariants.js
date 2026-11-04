/** Native numbered upgrades share their base enemy key and rank; phases/mini-bosses are not ordinary upgrades. */
export function baseEnemyVariant(enemies,key){
 const e=enemies?.[key],match=String(key).match(/^(.*)_(\d+)$/);if(!e||e.miniBoss||e.rank==='BOSS'||!match||Number(match[2])<2)return null;
 const base=enemies[match[1]];return base&&!base.miniBoss&&base.rank===e.rank?base.key||match[1]:null;
}
export const isEnhancedVariant=(enemies,key)=>baseEnemyVariant(enemies,key)!==null;
// [ASSUMED] Upgraded ordinary variants are independently rationed; they never consume the true elite quota.
export function enhancedVariantLimit(round,total){
 if(round<=2)return 0;const share=round<=5?.2:round<=7?.25:round<=10?.4:round<=14?.55:.7;
 return Math.min(round<=3?1:round<=5?1:round<=7?2:total,Math.max(1,Math.floor(total*share)));
}

/** Explicit native numbered relations only; unrelated names and boss phases never share a family. */
export function enemyFamilyKey(enemies,key){
 const e=enemies?.[key],m=String(key).match(/^(.*)_(\d+)$/),base=m&&Number(m[2])>=2?enemies?.[m[1]]:null;
 return e&&base&&!e.miniBoss&&!base.miniBoss&&['NORMAL','ELITE'].includes(e.rank)&&['NORMAL','ELITE'].includes(base.rank)?base.key||m[1]:key;
}
