// Owner 2026-11-01. Source-scoped additions only; native escort/mechanism pools stay frozen.
import {N_} from './i18n.js';
const families=['10253_dsjxb','10254_dsjarc','10255_dsjmgc','10256_dsjsld','10257_dsjtsz','10258_dsjccs','10259_dsjpgg','10260_dsjzds','10261_dsjcmd'];
export const ARK_URSUS_KEYS=Object.freeze(families.flatMap(id=>['enemy_'+id,'enemy_'+id+'_2']));
const members=new Set(ARK_URSUS_KEYS);
export const ARK_URSUS_BRANCH='specialBureau';
export const ARK_URSUS_ELITE_BRANCH='specialBureauElite';
// Exact owner-named removals; NORMAL/ELITE rank is deliberately not a roster filter.
export const ARK_URSUS_REGULAR_EXCLUSIONS=Object.freeze(["enemy_10260_dsjzds_2","enemy_10261_dsjcmd_2","enemy_10258_dsjccs_2"]);
export const ARK_URSUS_REGULAR_KEYS=Object.freeze(ARK_URSUS_KEYS.filter(key=>!ARK_URSUS_REGULAR_EXCLUSIONS.includes(key)));
// One verified enhanced identity from each canonical base/enhanced family pair.
export const ARK_URSUS_ENHANCED_KEYS=Object.freeze(["enemy_10253_dsjxb_2","enemy_10254_dsjarc_2","enemy_10255_dsjmgc_2","enemy_10256_dsjsld_2","enemy_10257_dsjtsz_2","enemy_10258_dsjccs_2","enemy_10259_dsjpgg_2","enemy_10260_dsjzds_2","enemy_10261_dsjcmd_2"]);
const regularMembers=new Set(ARK_URSUS_REGULAR_KEYS),eliteMembers=new Set(ARK_URSUS_ENHANCED_KEYS);
export const ARK_URSUS_WINDOW=Object.freeze({minRound:5,maxRound:14});
export const ARK_URSUS_ELITE_WINDOW=Object.freeze({minRound:10,maxRound:20});
export function arkUrsusSourceEntry(key,sourceMode,branchId=null){
 if(!members.has(key))return null;
 if(sourceMode==='regularSupport')return {faction:'URSUS',sourceMode,branchId:null,key,...ARK_URSUS_WINDOW};
 if(sourceMode!=='factionBranch')return null;
 if(branchId===ARK_URSUS_BRANCH&&regularMembers.has(key))return {faction:'URSUS',sourceMode,branchId,key,...ARK_URSUS_WINDOW};
 if(branchId===ARK_URSUS_ELITE_BRANCH&&eliteMembers.has(key))return {faction:'URSUS',sourceMode,branchId,key,...ARK_URSUS_ELITE_WINDOW};
 return null;
}
/** null delegates to existing rules; a boolean applies only to the exact source and roster. */
export function arkUrsusSourceAllowed({faction,sourceMode,branchId=null,key,round}){
 if(faction!=='URSUS'||!members.has(key)||!['factionBranch','regularSupport'].includes(sourceMode))return null;
 const entry=arkUrsusSourceEntry(key,sourceMode,branchId);
 return !!entry&&round>=entry.minRound&&round<=entry.maxRound;
}
export function arkUrsusSupportMembers(type,round){
 const legacy=(type?.regularSupport?.members||[]).filter(k=>!members.has(k));
 const active=round>=(type?.regularSupport?.minRound??8)&&round<=(type?.regularSupport?.maxRound??20)?legacy:[];
 return round>=5&&round<=14?[...new Set([...active,...(type?.arkUpdate20261101?.members||[])])]:active;
}
/** Called after applyUrsusTrainingType, never before its nativeEscortPool/mechanicBranches snapshots. */
export function applyArkUrsusType(type,enemies){
 if(!type?.nativeEscortPool||!type?.mechanicBranches)throw Error('Ursus native snapshots must exist before 20261101 additions');
 const present=ARK_URSUS_KEYS.filter(k=>enemies[k]);
 const legacy=(type.branches||[]).filter(b=>![ARK_URSUS_BRANCH,ARK_URSUS_ELITE_BRANCH].includes(b.id));
 const regular=ARK_URSUS_REGULAR_KEYS.filter(key=>enemies[key]),enhanced=ARK_URSUS_ENHANCED_KEYS.filter(key=>enemies[key]),branches=[];
 if(regular.length)branches.push({faction:'URSUS',sourceMode:'factionBranch',id:ARK_URSUS_BRANCH,name:N_('特辖局'),...ARK_URSUS_WINDOW,elite:false,members:regular});
 // Roster/window split only: do not opt this branch into generic elite-army quota bonuses or armyElite command groups.
 if(enhanced.length)branches.push({faction:'URSUS',sourceMode:'factionBranch',id:ARK_URSUS_ELITE_BRANCH,name:N_('精锐特辖局'),...ARK_URSUS_ELITE_WINDOW,elite:false,members:enhanced});
 // The existing extended-round picker uses the last branch. Keep armyElite last so neither bounded new source extends past R20.
 const at=legacy.findIndex(b=>b.id==='armyElite');
 type.branches=at<0?[...legacy,...branches]:[...legacy.slice(0,at),...branches,...legacy.slice(at)];
 type.pool=[...new Set([...type.pool,...present])];
 type.arkUpdate20261101={faction:'URSUS',sourceMode:'regularSupport',...ARK_URSUS_WINDOW,members:present};
}
