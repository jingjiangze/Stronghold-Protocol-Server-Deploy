// Each enemy has one primary mechanism; faction memberships remain independent and may overlap.
export const MECHANIC_TYPES=Object.freeze(['SPECIAL','FLY','TIMES','ELEMENT','DOT','INVISIBLE','REFLECTION','AMBUSH','GHOST','HEAVY']);
const textOf=e=>(e?.officialAbilities||e?.abilities||[]).map(a=>a.text||'').join('；');
export function blockingRequirement(e){
 const text=textOf(e),n=/阻挡数(?:大于等于|不小于|至少为|为)(\d+)|占用\s*(\d+)\s*(?:个)?阻挡/.exec(text);
 return Math.max(1,e?.stats?.blockCnt||1,Number(n?.[1]||n?.[2]||1));
}
export function primaryMechanic(e){
 const text=textOf(e),bb=e?.talents?.bb||{};
 if(e?.fixedHitCount||bb['DeadSpawn.times']>0||/需要.{0,12}次.{0,8}(伤害|攻击)|受到.{0,8}次.{0,3}伤害|伤害次数/.test(text))return 'TIMES';
 // Owner also admits native ghosts with unblockability alone; their kit is never given invented stealth.
 if(/无法.{0,3}阻挡|不能.{0,3}阻挡|不可.{0,3}阻挡|不会被阻挡|不被阻挡/.test(text))return 'GHOST';
 if(blockingRequirement(e)>=2)return 'HEAVY';
 if(e?.ambushEligible)return 'AMBUSH';
 if(/折射|法术抗性.{0,5}70/.test(text))return 'REFLECTION';
 if(/神经损伤|侵蚀损伤|灼燃损伤|凋亡损伤|狂躁损伤|元素损伤/.test(text))return 'ELEMENT';
 if(/持续.{0,12}伤害|每秒.{0,16}伤害|流失生命|燃烧区域|出血|毒性/.test(text))return 'DOT';
 if(/隐匿|隐形|迷彩/.test(text))return 'INVISIBLE';
 if(e?.isFlyEnemy||e?.stats?.motion==='FLY'||/近地悬浮|起飞|飞行模式|飞行状态/.test(text))return 'FLY';
 return 'SPECIAL';
}
export function assignEnemyMechanics(enemies){
 const mechanisms=new Set(MECHANIC_TYPES);
 for(const e of Object.values(enemies)){
  const mechanic=primaryMechanic(e),factions=[...new Set([...(e.acTypes||[]),...(e.contractTrainingTags||[])])].filter(t=>!mechanisms.has(t));
  e.mechanicType=mechanic;e.acTypes=[mechanic,...factions];e.contractTrainingTags=[...factions,mechanic];
  if(!e.acType||mechanisms.has(e.acType))e.acType=mechanic;
 }
}
