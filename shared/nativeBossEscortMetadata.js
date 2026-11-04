// Fingerprints of the rejected first-version metadata, used only for exact cleanup. No spawn rules live here.
const TYPES={
 helm:{family:'helm',faction:'VICTORIA',early:[['enemy_1322_wdgyht_2',1],['enemy_1316_wdpjd',1]],late:[['enemy_1322_wdgyht',1],['enemy_1316_wdpjd_2',1]]},
 gun:{family:'gun',faction:'LATERANO',early:['enemy_10087_hlchgr','enemy_10088_hlsnip','enemy_10089_hlsprt','enemy_10090_hlgrd'].map(key=>[key,1]),late:['enemy_10087_hlchgr_2','enemy_10088_hlsnip_2','enemy_10089_hlsprt_2','enemy_10090_hlgrd_2'].map(key=>[key,1])},
 pipe:{family:'pipe',faction:'LEITHANIEN',early:[['enemy_1086_ltsodr',2]],late:[['enemy_1086_ltsodr_2',2]]},
 quintus:{family:'quintus',faction:'SEA_BORN',early:[['enemy_1148_dssbr',1],['enemy_1149_dsbow',1]],late:[['enemy_1148_dssbr_2',1],['enemy_1149_dsbow_2',1]]},
 lucien:{family:'lucien',faction:'SCARLET',early:[['enemy_2009_csaudc',1],['enemy_2010_csdcr',1]],late:[['enemy_2009_csaudc',1],['enemy_2010_csdcr',1]]},
 lion:{family:'lion',faction:'VICTORIA',early:[['enemy_1322_wdgyht_2',1],['enemy_1316_wdpjd',1],['enemy_10027_vtsk',1]],late:[['enemy_1322_wdgyht',1],['enemy_1316_wdpjd_2',1],['enemy_10027_vtsk',1]]},
 deer:{family:'deer',faction:'SAMI',early:[['enemy_2043_smsbr',1],['enemy_2044_smwiz',1]],late:[['enemy_2043_smsbr',1],['enemy_2044_smwiz',1]]},
};
const ORIGINAL={boss_1:['enemy_9013_acstmk','helm'],boss_2:['enemy_9017_achunt','gun'],boss_3:['enemy_9021_acduml','pipe'],boss_4:['enemy_1521_dslily','quintus'],boss_5:['enemy_2016_csphtm','lucien'],boss_6:['enemy_9032_aclionk','lion'],boss_7:['enemy_9033_acdeer','deer'],boss_8:['enemy_9013_acstmk_2','helm'],boss_9:['enemy_9017_achunt_2','gun'],boss_10:['enemy_9021_acduml_2','pipe']};
export const ORIGINAL_BOSS_ESCORT_IDS=Object.freeze(Object.keys(ORIGINAL));
const FIELDS=['cooldown','firstDelay','family','faction','livePerFamily','totalPerFamily','livePerField','totalPerField','early','late'];
const groupsMatch=(actual,expected)=>Array.isArray(actual)&&actual.length===expected.length&&actual.every((row,i)=>row&&Object.keys(row).length===2&&Object.hasOwn(row,'key')&&Object.hasOwn(row,'count')&&row.key===expected[i][0]&&row.count===expected[i][1]);
function ownLegacyField(id,boss){
 const [key,type]=ORIGINAL[id],expected=TYPES[type],field=boss?.periodicEscorts;
 if(!boss||boss.enemyKey!==key||boss.isMod||boss.escortMode==='scripted'||!field||typeof field!=='object')return false;
 if(Object.keys(field).length!==FIELDS.length||!FIELDS.every(name=>Object.hasOwn(field,name)))return false;
 return field.cooldown===35&&field.firstDelay===35&&field.livePerFamily===8&&field.totalPerFamily===40&&field.livePerField===16&&field.totalPerField===80
  &&field.family===expected.family&&field.faction===expected.faction&&groupsMatch(field.early,expected.early)&&groupsMatch(field.late,expected.late);
}
export function stripLegacyBossEscortMetadata(bosses){
 for(const id of ORIGINAL_BOSS_ESCORT_IDS)if(ownLegacyField(id,bosses?.[id]))delete bosses[id].periodicEscorts;
 return bosses;
}
