import {AUTHORED_FACTION_BRANCHES,SARKAZ_FACTION_EXCLUSIONS} from './factionBranchRosters.js';
import {BOLIVAR_ARMY_BRANCHES} from './bolivarFaction.js';
import {N_} from './i18n.js';
import {applyUrsusTrainingType,ursusTrainingMinRound} from './ursusTraining.js';
// Explicit owner rosters, plus strength-adapted branches for every other selected faction.
const keys=s=>s.split(/\s+/).filter(Boolean).map(k=>'enemy_'+k);
// Owner addition: the ordinary black/red katana pair, distinct from named bounty enemy_1539_reid.
export const REUNION_SEEKERS=Object.freeze(keys('1025_reveng 1025_reveng_2'));
// Owner 2026-10-28: native shaman and Mudrock families may reinforce Leithanien branches.
// Keep their ELITE rank and the wave's existing round, variant and pressure budgets.
export const LEITHANIEN_MUDROCK_SUPPORT=Object.freeze(keys('1091_mdhmmr 1091_mdhmmr_2 1092_mdgint 1092_mdgint_2'));
export const LEITHANIEN_REGULAR_SUPPORT=Object.freeze([...keys('1089_ltlntc 1089_ltlntc_2'),...LEITHANIEN_MUDROCK_SUPPORT]);
// The owner's R12 native-army gate replaces only this faction's old strength gate.
// Mechanism training and independent bounty/leader sources keep their own rules.
export const factionEnemyMinRound=(type,key,fallback)=>ursusTrainingMinRound(type,key,type==='LEITHANIEN'&&LEITHANIEN_MUDROCK_SUPPORT.includes(key)?12:fallback);
export const REUNION_BRANCHES=Object.freeze([
 {id:'regular',name:N_('常规小队'),minRound:1,maxRound:10,members:keys('1000_gopro 1000_gopro_2 1000_gopro_3 1002_nsabr 1003_ncbow 1003_ncbow_2 1005_yokai 1005_yokai_2 1008_ghost 1009_lurker 1011_wizard 1011_wizard_2 1013_airdrp 1014_rogue 1014_rogue_2 1015_litamr 1015_litamr_2 1017_defdrn 1019_jshoot 1020_obsv 1023_jmage 1024_mortar 1024_mortar_2 1026_aghost 1029_shdsbr 1031_mrogue 1032_katar 1006_shield 1006_shield_2 1018_aoemag 1018_aoemag_2 1033_handax 1033_handax_2 1034_laxe 1035_haxe 1035_haxe_2 1043_zomsbr 1043_zomsbr_2 1062_rager 1062_rager_2 1076_bsthmr_2 1084_sotidm_3 1085_sotiwz_3')},
 {id:'snow',name:N_('雪怪小队'),minRound:3,maxRound:8,members:keys('1037_lunsbr 1038_lunmag 1038_lunmag_2 1039_breakr 1039_breakr_2 1041_lazerd 1043_zomsbr 1043_zomsbr_2 1064_snsbr 1065_snwolf 1065_snwolf_2 1066_snbow 1066_snbow_2 1068_snmage 1068_snmage_2 1042_frostd 1045_hammer 1045_hammer_2 1061_zomshd 1062_rager 1062_rager_2 1063_rageth 1063_rageth_2 1069_icebrk 1070_iced')},
 {id:'guerrilla',name:N_('游击队'),minRound:3,maxRound:8,members:keys('1077_sotihd 1077_sotihd_2 1078_sotisc 1078_sotisc_2 1079_sotisp 1079_sotisp_2 1080_sotidp 1076_bsthmr_2 1081_sotisd 1081_sotisd_2 1082_soticn 1083_sotiab 1083_sotiab_2 1084_sotidm_2 1084_sotidm_3 1085_sotiwz_2 1085_sotiwz_3 1114_rgrdmn')},
 {id:'elite',name:N_('精英小队'),minRound:10,maxRound:20,elite:true,members:keys('1006_shield 1006_shield_2 1062_rager 1062_rager_2 1076_bsthmr_2 1084_sotidm_3 1085_sotiwz_3 1033_handax_2 1034_laxe 1035_haxe 1035_haxe_2 1017_defdrn 1083_sotiab 1083_sotiab_2 1084_sotidm_2 1085_sotiwz_2 1114_rgrdmn 1045_hammer 1045_hammer_2 1070_iced 1081_sotisd 1081_sotisd_2 1082_soticn')},
].map(b=>['regular','elite'].includes(b.id)?{...b,members:[...b.members,...REUNION_SEEKERS]}:b));
export const REUNION_ADDONS=Object.freeze([
 {id:'sarkazMercenaries',name:N_('萨卡兹雇佣兵'),minRound:3,maxRound:20,chance:.35,maxKinds:1,maxCount:2,members:keys('1010_demon 1012_dcross 1022_dmage 1084_sotidm_3 1085_sotiwz_3 1084_sotidm_2 1085_sotiwz_2 1114_rgrdmn 1501_demonk'),leaderFromRound:10,leaderKeys:keys('1501_demonk')},
]);
const power=e=>(e.stats?.maxHp||0)+(e.stats?.atk||0)*5+(e.stats?.def||0)*3;
export function buildFactionBranches(types,enemies){
 for(const[type,t]of Object.entries(types)){
  if(t.category!=='faction')continue;
  const authored=[...AUTHORED_FACTION_BRANCHES,...BOLIVAR_ARMY_BRANCHES].filter(b=>b.faction===type);
  if(authored.length){
   t.authoredBranches=true;
   const clone=b=>({...b,members:b.members.filter(k=>enemies[k])});
   t.branches=authored.filter(b=>!b.subdivision).map(clone);t.eliteBranches=authored.filter(b=>b.subdivision).map(clone);
   t.pool=[...new Set(authored.flatMap(b=>b.members))].filter(k=>{const e=enemies[k];return e&&!e.miniBoss&&!e.tokenOnly&&!e.contractSupportOnly&&!e.bountyOnly&&e.independentSpawn!==false;});
   // Moving the master's branch must preserve the native pool order also consumed by boss escorts.
   if(type==='LEITHANIEN'){
    const base='enemy_1089_ltlntc',master='enemy_1089_ltlntc_2',at=t.pool.indexOf(master);
    if(at>=0&&t.pool.includes(base)){t.pool.splice(at,1);t.pool.splice(t.pool.indexOf(base)+1,0,master);}
   }
   for(const b of authored)for(const key of b.members){const e=enemies[key];if(!e)continue;e.contractTrainingTags=[...new Set([...(e.contractTrainingTags||[]),type])];e.acTypes=[...new Set([...(e.acTypes||[]),type])];}
   if(type==='SARKAZ'){t.pool=t.pool.filter(k=>!SARKAZ_FACTION_EXCLUSIONS.includes(k));for(const key of SARKAZ_FACTION_EXCLUSIONS){const e=enemies[key];if(e){e.contractTrainingTags=e.contractTrainingTags.filter(t=>t!=='SARKAZ');e.acTypes=e.acTypes.filter(t=>t!=='SARKAZ');if(e.acType==='SARKAZ')e.acType=e.mechanicType||'SPECIAL';}}}
   continue;
  }
  if(type==='REUNION'){t.branches=REUNION_BRANCHES.map(b=>({...b,members:b.members.filter(k=>enemies[k])}));t.eliteBranches=REUNION_ADDONS.map(b=>({...b,members:b.members.filter(k=>enemies[k])}));continue;}
  const all=(t.pool||[]).filter(k=>enemies[k]),normal=all.filter(k=>enemies[k].rank==='NORMAL').sort((a,b)=>power(enemies[a])-power(enemies[b])||(a<b?-1:a>b?1:0)),elite=all.filter(k=>enemies[k].rank==='ELITE');
  const basic=normal;
  t.branches=[{id:'basic',name:N_('基础小队'),minRound:1,maxRound:2,members:basic},{id:'mixed',name:N_('混成小队'),minRound:3,maxRound:12,members:all},{id:'elite',name:N_('精锐小队'),minRound:9,maxRound:99,elite:true,members:[...normal.slice(Math.floor(normal.length*.35)),...elite]}].filter(b=>b.members.length);
  t.eliteBranches=[];


 }
 for(const[type,t]of Object.entries(types))if(t.category==='faction')t.regularSupport={id:'regularSupport',name:N_('常规支援'),minRound:8,maxRound:20,members:(t.pool||[]).filter(k=>(enemies[k]?.rank==='NORMAL'||type==='REUNION'&&REUNION_SEEKERS.includes(k)||type==='LEITHANIEN'&&LEITHANIEN_REGULAR_SUPPORT.includes(k))&&!/^enemy_11(?:1[6-9]|2[01])_/.test(k))};
 if(types.URSUS)applyUrsusTrainingType(types.URSUS,enemies);
}
export function factionBranchChoices(type,round){
 const branches=type?.branches||[];let choices=branches.filter(b=>b.minRound<=round&&b.maxRound>=round);
 // Extended contract compatibility: keep the final branch after the authored roster ends.
 if(!choices.length&&branches.length&&round>Math.max(...branches.map(b=>b.maxRound))){
  const end=Math.max(...branches.map(b=>b.maxRound));
  choices=type.type==='BOLIVAR'?branches.filter(b=>b.maxRound===end):branches.slice(-1);
 }
 return choices;
}

// Owner excludes simultaneous low-priority training themes from match setup.
export const factionPrimaryWeight=type=>type==='DURIN'||type==='HIGASHI'?1:3;
export const factionPairAllowed=(a,b)=>!(a!==b&&['DURIN','HIGASHI'].includes(a)&&['DURIN','HIGASHI'].includes(b));
export function mechanicBranchRoundAllowed(types,key,round){
 let specified=false;
 for(const[type,t]of Object.entries(types||{})){
  if(!t.authoredBranches&&type!=='REUNION')continue;
  const rows=t.mechanicBranches||[...(t.branches||[]),...(t.eliteBranches||[])],end=Math.max(0,...rows.map(b=>b.maxRound));
  for(const b of rows)if(b.members.includes(key)){specified=true;if(b.minRound<=round&&(round<=b.maxRound||round>end&&b.maxRound===end))return true;}
 }
 return !specified;
}
