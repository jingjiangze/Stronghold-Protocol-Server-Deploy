/** Owner-requested extra guards. They supplement each leader without carrying its bounty. */
export function leaderEscortGroups(key,round,{paired=false}={}){
 // [ASSUMED] R13 is the late-game boundary, matching existing elite growth and leader bounty unlocks.
 const late=round>=13,variant=base=>base+(late?'_2':''),halves=paired?2:1;
 // The official _2 grey hat is the weaker trainee, unlike most enhanced variants.
 const hat=late?'enemy_1322_wdgyht':'enemy_1322_wdgyht_2';
 if(/^enemy_9013_acstmk(?:_2)?$/.test(key))return [[hat,halves]];
 if(/^enemy_9017_achunt(?:_2)?$/.test(key))return ['enemy_10087_hlchgr','enemy_10088_hlsnip','enemy_10089_hlsprt','enemy_10090_hlgrd'].map(k=>[variant(k),halves]);
 if(key==='enemy_9032_aclionk')return [['enemy_1273_stmgun_2',1],[hat,halves],[variant('enemy_1316_wdpjd'),halves],['enemy_10027_vtsk',halves]];
 if(key==='enemy_1502_crowns')return [['enemy_1002_nsabr',2]];
 if(key==='enemy_1500_skulsr')return [['enemy_1015_litamr',2]];
 if(key==='enemy_1511_mdrock')return [[variant('enemy_1091_mdhmmr'),3],[variant('enemy_1092_mdgint'),1]];
 return [];
}

/** Eight guards per wave; commanders and breakers appear together only in every third formation. */
export { PURSUER_ARMY_DESCRIPTION } from './pursuerEncounter.js';
export const PURSUER_ARMIES=Object.freeze([
 Object.freeze(['enemy_10120_uaghst','enemy_10121_uasnip','enemy_10124_uashld','enemy_1112_emppnt','enemy_10120_uaghst','enemy_10121_uasnip','enemy_10121_uasnip','enemy_10120_uaghst']),
 Object.freeze(['enemy_10120_uaghst_2','enemy_10121_uasnip_2','enemy_10122_uacann','enemy_1112_emppnt_2','enemy_10124_uashld_2','enemy_10122_uacann_2','enemy_10121_uasnip_2','enemy_10120_uaghst_2']),
]);
export const PURSUER_SPECIAL_GUARDS=Object.freeze([
 Object.freeze(['enemy_10125_uacomd','enemy_10123_uareap']),
 Object.freeze(['enemy_10125_uacomd_2','enemy_10123_uareap_2']),
]);
/** Zero-based wave number. No extra RNG draws: the two ordinary waves precede each sparse specialist wave. */
export function pursuerArmyForWave(wave){
 const variant=wave%PURSUER_ARMIES.length,ordinary=PURSUER_ARMIES[variant];
 return (wave+1)%3===0?[...ordinary.slice(0,-2),...PURSUER_SPECIAL_GUARDS[variant]]:ordinary;
}
export const PURSUER_ESCORT_KEYS=Object.freeze([...new Set([...PURSUER_ARMIES.flat(),...PURSUER_SPECIAL_GUARDS.flat()])]);
