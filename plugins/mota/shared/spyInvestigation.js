// Owner 2026-10-27: quicker real vision-based identification, preserving the two 300-point stages and UI scale.
export const INVESTIGATION_KEYS=Object.freeze(['enemy_1314_wdnjd','enemy_1314_wdnjd_2','enemy_1315_wdyjd','enemy_1315_wdyjd_2','enemy_1316_wdpjd','enemy_1316_wdpjd_2']);
// User-specified total: 10.2 game seconds = 306 fixed ticks. The stage split is 6s + 4.2s.
// Scaled integer progress prevents the 50/7-point second-stage step from accumulating floating-point error.
export const SPY_INVESTIGATION_RULES=Object.freeze({interval:.1,stagePoints:300,pointScale:7,firstGainUnits:35,secondGainUnits:50,unseenLoss:1,firstSeconds:6,secondSeconds:4.2,totalSeconds:10.2});
export const SPY_RUNTIME_MOD_KEYS=Object.freeze(['spyInvestigation','spyStrikeSpent']);
export const isInvestigationSpy=key=>INVESTIGATION_KEYS.includes(key);
export const hasInvestigationSpy=spec=>(spec?.spawns||[]).some(s=>isInvestigationSpy(s.enemyKey));

export function spyInvestigationState(mods){
 return {spyInvestigation:Number.isFinite(mods?.spyInvestigation)?Math.round(Math.max(0,Math.min(600,mods.spyInvestigation))*7)/7:0,
  spyStrikeSpent:mods?.spyStrikeSpent===true};
}

/** Use only with a server-owned spawn or simulation result; wire validation never accepts these dynamic fields. */
export function carrySpyInvestigation(key,base,state){
 if(!isInvestigationSpy(key))return base??null;
 const mods={...(base||{})},normalized=spyInvestigationState(state);
 for(const field of SPY_RUNTIME_MOD_KEYS)if(Object.hasOwn(state||{},field))mods[field]=normalized[field];
 return mods;
}

export function spyStaticMods(key,mods){
 if(!isInvestigationSpy(key))return mods??null;
 const entries=Object.entries(mods||{}).filter(([field])=>!SPY_RUNTIME_MOD_KEYS.includes(field));
 return entries.length?Object.fromEntries(entries):null;
}

const staticKey=(key,mods)=>JSON.stringify(Object.entries(spyStaticMods(key,mods)||{}).sort(([a],[b])=>a.localeCompare(b)));
/** Let server result normalization keep all sixteen ordinary mod slots before verified runtime state is restored. */
export function withoutSpyInvestigationRuntime(result){
 if(!result?.perPlayer)return result;
 return{...result,perPlayer:Object.fromEntries(Object.entries(result.perPlayer).map(([pid,p])=>[pid,{...p,
  leaked:(p.leaked||[]).map(row=>isInvestigationSpy(row.enemyKey)?{...row,mods:spyStaticMods(row.enemyKey,row.mods)}:row)}]))};
}
/** Copy just verified spy runtime state back onto the validator's normalized sources, rewards and attributes. */
export function verifiedSpyInvestigationResult(normalized,server){
 if(!normalized?.perPlayer)return normalized;
 const perPlayer={...normalized.perPlayer};
 for(const [pid,p]of Object.entries(perPlayer)){
  const available=new Set(server?.perPlayer?.[pid]?.leaked||[]);
  const leaked=(p.leaked||[]).map(row=>{
   if(!isInvestigationSpy(row.enemyKey))return row;
   const match=[...available].find(origin=>origin.enemyKey===row.enemyKey&&origin.sourcePlayerId===row.sourcePlayerId
    &&staticKey(origin.enemyKey,origin.mods)===staticKey(row.enemyKey,row.mods));
   if(!match)return row;
   available.delete(match);return{...row,mods:carrySpyInvestigation(row.enemyKey,row.mods,match.mods)};
  });
  perPlayer[pid]={...p,leaked};
 }
 return{...normalized,perPlayer};
}
