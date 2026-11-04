// Owner 2026-10-27: repeat only each original boss's existing opening-wave escort sequence.
// Native skills and parts keep their own cadence. Never compose an extra army here.
export const MIN_BOSS_ESCORT_COOLDOWN=40;
export const NATIVE_BOSS_ESCORT_REPEAT_CYCLES=3;
export const ORIGINAL_BOSS_ESCORTS=Object.freeze(Object.fromEntries([
 ['boss_1','enemy_9013_acstmk'],['boss_2','enemy_9017_achunt'],['boss_3','enemy_9021_acduml'],
 ['boss_4','enemy_1521_dslily'],['boss_5','enemy_2016_csphtm'],['boss_6','enemy_9032_aclionk'],
 ['boss_7','enemy_9033_acdeer'],['boss_8','enemy_9013_acstmk_2'],['boss_9','enemy_9017_achunt_2'],
 ['boss_10','enemy_9021_acduml_2'],
].map(([bossId,enemyKey])=>[bossId,Object.freeze({bossId,enemyKey})])));

export function isOriginalEscortBoss(bossId,enemyKey){
 return Object.hasOwn(ORIGINAL_BOSS_ESCORTS,bossId)&&ORIGINAL_BOSS_ESCORTS[bossId].enemyKey===enemyKey;
}

export function nativeBossEscortMods(mods,source){
 const clean={nativeBossEscortSource:source};
 // Only ordinary combat attributes travel. Hunt/ambush/return/debt/reward/one-shot contract provenance never does.
 for(const key of ['hpMul','atkMul','defMul','resMul','speedMul','supplyHpMul','aspdAdd','resAdd','hpRegenRatio','blockWeightAdd','blockWeightMax','damageTakenMul'])if(Number.isFinite(mods?.[key]))clean[key]=mods[key];
 if(typeof mods?.slot==='string'&&/^[NET]F?$/.test(mods.slot))clean.slot=mods.slot;
 return clean;
}

/** Read the already-authorized resolved SpawnSpecs, after placeholder/faction and specified-escort handling.
 * First-pass key/count/time/interval/route never change. Only a numeric provenance marker is added to guard mods.
 * Existing skill summons, echo opening objects, parts and unrelated supplements do not become wave repeats.
 */
export function buildNativeBossEscortSchedule(bossId,enemyKey,parts,{template,clockMul=1,bossDefinition}={}){
 if(!isOriginalEscortBoss(bossId,enemyKey)||!Array.isArray(template?.spawns))return null;
 if(bossDefinition&&(bossDefinition.isMod||bossDefinition.escortMode==='scripted'||!isOriginalEscortBoss(bossId,bossDefinition.enemyKey)))return null;
 const actions=[],clock=Number.isFinite(clockMul)&&clockMul>0&&clockMul<1?clockMul:1;
 for(const [index,spawn]of (parts.spawns||[]).entries()){
  const raw=Number.isInteger(spawn.actionIndex)?template.spawns[spawn.actionIndex]:null;
  const specified=spawn.tag==='leaderEscort'&&spawn.leaderEscortOf!=null;
  if(!raw&&!specified)continue;
  if(spawn.tag==='boss'||spawn.tag==='part'||spawn.countInTotal===false||spawn.bounty)continue;
  if(raw?.tag==='boss'||raw?.tag==='part'||raw?.unharmful)continue;
  if(raw?.key==='enemy_9023_acdums'||spawn.enemyKey==='enemy_9023_acdums')continue;
  if(!String(spawn.enemyKey||'').startsWith('enemy_')||!Number.isFinite(spawn.time??0))continue;
  const count=Math.max(1,Math.min(600,Math.floor(Number(spawn.count)||1)));
  // applyContractWaveChanges later compresses the opening clock; mirror that scalar here without capturing its adds.
  const time=Math.max(0,spawn.time||0)*clock,interval=Math.max(0,Number(spawn.interval)||0)*clock,source=index+1;
  const mods=nativeBossEscortMods(spawn.mods,source);
  spawn.mods={...(spawn.mods||{}),nativeBossEscortSource:source};
  actions.push({source,sourceAction:spawn.actionIndex??null,enemyKey:spawn.enemyKey,count,time,interval,
   routeIndex:spawn.routeIndex??0,tag:spawn.tag??null,mods,
   ...(spawn.route?{route:spawn.route}:{}),
   ...(spawn.ownerPlayerId?{ownerPlayerId:spawn.ownerPlayerId}:{}),
   ...(spawn.sourcePlayerId?{sourcePlayerId:spawn.sourcePlayerId}:{})});
 }
 if(!actions.length)return null; // no native source means no invented escort
 const first=Math.min(...actions.map(a=>a.time)),last=Math.max(...actions.map(a=>a.time+(a.count-1)*a.interval));
 const sourceCount=actions.reduce((n,a)=>n+a.count,0);
 // Owner 2026-10-27: preserve the complete native timeline, with 40s from last to next first.
 // At most three additional timelines, and at most one native timeline's worth of live ordinary escorts.
 return {v:1,bossId,enemyKey,first,last,period:last-first+MIN_BOSS_ESCORT_COOLDOWN,
  minimumGap:MIN_BOSS_ESCORT_COOLDOWN,repeatCycles:NATIVE_BOSS_ESCORT_REPEAT_CYCLES,
  sourceCount,maxLive:Math.min(600,sourceCount),maxRepeated:sourceCount*NATIVE_BOSS_ESCORT_REPEAT_CYCLES,actions};
}

