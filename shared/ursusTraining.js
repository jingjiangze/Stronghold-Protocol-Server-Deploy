// Owner 2026-10-29: ordinary Ursus training only. Native boss escorts keep their previous roster.
import {N_} from './i18n.js';
const keys=s=>s.split(/\s+/).filter(Boolean).map(k=>'enemy_'+k);
export const URSUS_WAR_CASTERS=Object.freeze(keys('10210_muwiz 10210_muwiz_2'));
export const URSUS_TRAINING_BRANCHES=Object.freeze([
 {faction:'URSUS',id:'regular',name:'乌萨斯常规作战单位',minRound:1,maxRound:6,elite:false,members:keys('1107_uoffcr 1107_uoffcr_2 1108_uterer 1108_uterer_2 1109_uabone 1110_uamord 1111_ucommd')},
 {faction:'URSUS',id:'army',name:'乌萨斯集团军单位',minRound:6,maxRound:14,elite:true,members:keys('1109_uabone 1110_uamord 1111_ucommd 1112_emppnt 1113_empace 10120_uaghst 10121_uasnip 10122_uacann 10124_uashld 10125_uacomd 10127_rkmbst')},
 {faction:'URSUS',id:'armyElite',name:N_('乌萨斯集团军精锐单位'),minRound:12,maxRound:20,elite:true,members:keys('1109_uabone_2 1110_uamord_2 1111_ucommd_2 1112_emppnt_2 1113_empace_2 10120_uaghst_2 10121_uasnip_2 10122_uacann_2 10123_uareap 10123_uareap_2 10124_uashld 10124_uashld_2 10125_uacomd 10125_uacomd_2 10210_muwiz 10210_muwiz_2')},
].map(b=>Object.freeze({...b,members:Object.freeze(b.members)})));
const eliteOnly=new Set(URSUS_TRAINING_BRANCHES[2].members.filter(k=>!URSUS_TRAINING_BRANCHES.slice(0,2).some(b=>b.members.includes(k))));
// A faction-specific R12 gate replaces the old R13 strength floor for this exact elite roster.
// Artillery counts, burst caps, stat modifiers and wave pressure budgets remain in waves.js.
export const ursusTrainingMinRound=(type,key,fallback)=>type==='URSUS'&&eliteOnly.has(key)?12:fallback;
export function applyUrsusTrainingType(type,enemies){
 if(!type)return;
 // These snapshots are consumed only by the pre-existing boss/mechanism paths.
 type.nativeEscortPool||=[...(type.pool||[])].filter(k=>!URSUS_WAR_CASTERS.includes(k));
 type.mechanicBranches||=structuredClone([...(type.branches||[]),...(type.eliteBranches||[])]);
 type.branches=URSUS_TRAINING_BRANCHES.map(b=>({...b,members:b.members.filter(k=>enemies[k])}));
 type.eliteBranches=[];type.authoredBranches=true;
 type.pool=[...new Set([...type.nativeEscortPool,...type.branches.flatMap(b=>b.members)])];
 type.regularSupport={...(type.regularSupport||{}),id:'regularSupport',name:'常规支援',minRound:8,maxRound:20,members:type.pool.filter(k=>enemies[k]?.rank==='NORMAL')};
}
export function ursusTrainingRoundAllowed(type,key,round){
 if(!type?.branches)return true;
 const rows=type.branches,latest=Math.max(...rows.map(b=>b.maxRound));
 return rows.some(b=>b.members.includes(key)&&b.minRound<=round&&(round<=b.maxRound||round>latest&&b.maxRound===latest))||
  round>=type.regularSupport?.minRound&&round<=type.regularSupport?.maxRound&&type.regularSupport.members.includes(key)&&(!eliteOnly.has(key)||round>=12);
}
export function ursusCommandGroup(branch,round){
 if(branch?.id==='army'&&round>=10&&round<=14)return ['enemy_10125_uacomd','enemy_10124_uashld','enemy_10124_uashld'];
 if(branch?.id==='armyElite'&&round>=12&&round<=20)return ['enemy_10125_uacomd_2','enemy_10124_uashld_2','enemy_10124_uashld_2'];
 return [];
}
/** All three use one already-valid route/action. No extra bodies, route or random draws. */
export function synchronizeUrsusCommandGroup(spawns){
 const groups=new Map();
 for(const row of spawns)if(row.mods?.ursusCommandGroup){const owner=row.sourcePlayerId??'',group=groups.get(owner)||[];group.push(row);groups.set(owner,group);}
 for(const rows of groups.values()){const first=rows[0];for(const row of rows){row.time=first.time;row.routeIndex=first.routeIndex;row.actionIndex=first.actionIndex;row.preview={...row.preview,gate:first.preview?.gate,start:first.preview?.start};}}
}
