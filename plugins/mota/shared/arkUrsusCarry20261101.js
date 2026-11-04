// Minimal runtime carry for exact OB families. No new authority, timer or replay policy.
const pair=id=>['enemy_'+id,'enemy_'+id+'_2'];
const fields=new Map([
 ...pair('10253_dsjxb').map(k=>[k,{arkUrsusDriveLeft:30}]),
 ...pair('10258_dsjccs').map(k=>[k,{arkUrsusRushUsed:1,arkUrsusStunnedAtk:1}]),
 ...pair('10259_dsjpgg').map(k=>[k,{arkUrsusLanded:1}]),
 ...pair('10260_dsjzds').map(k=>[k,{arkUrsusDrillSurfaced:1}]),
 ...pair('10261_dsjcmd').map(k=>[k,{arkUrsusSummoned:1}]),
]);
const reserved=new Set([...fields.values()].flatMap(v=>Object.keys(v)));
export const isArkUrsusStateful=key=>fields.has(key);
/** Strip only our reserved runtime fields, for an exact new stateful family. */
export function arkUrsusStaticMods(key,mods){
 if(!fields.has(key)||!mods)return mods;
 return Object.fromEntries(Object.entries(mods).filter(([field])=>!reserved.has(field)));
}
export function arkUrsusRuntimeMods(key,mods){
 const out={};
 for(const[field,max]of Object.entries(fields.get(key)||{})){
  const value=mods?.[field];
  if(max===1){if(value===1||value===true)out[field]=1;}
  else if(Number.isFinite(value)&&value>0)out[field]=Math.min(max,value);
 }
 return out;
}
/** Static source identity is selected by the existing validator before this merge. */
export function carryArkUrsusState(key,sourceMods,runtimeMods){
 if(!fields.has(key))return sourceMods;
 const state=arkUrsusRuntimeMods(key,runtimeMods);
 return {...(arkUrsusStaticMods(key,sourceMods)||{}),...state};
}
