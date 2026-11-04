// [ASSUMED] Owner 2026-10-27: a selected ordinary enemy's complete attack/cast deals at most 3000 raw HP damage
// to one target without crisis terms. Native round growth and commander orders are already in the incoming amount.
export const ENEMY_BURST_BUDGET=3000;
export const PRESSURE_PROTECTED_CHALLENGE_KEYS=Object.freeze(['enemy_1025_reveng','enemy_1025_reveng_2','enemy_1539_reid']);
const protectedKeys=new Set(PRESSURE_PROTECTED_CHALLENGE_KEYS);
export const PRESSURE_BURST_FAMILIES=Object.freeze([
 'enemy_10027_vtsk','enemy_1273_stmgun','enemy_10123_uareap','enemy_1072_dlancer','enemy_1320_wdrrl',
 'enemy_1427_lrnazg','enemy_1173_duspfr','enemy_1174_duholy','enemy_1184_cadkgt','enemy_10219_klhjdd',
 'enemy_1401_pogpro','enemy_1402_tgshd','enemy_1403_gunsho','enemy_1404_msnip','enemy_1405_boomer',
 'enemy_1406_chghmr','enemy_1407_hummbd','enemy_1408_scotcn','enemy_1409_bdguad',
 'enemy_1057_gansho','enemy_10165_tjggb',
 'enemy_1331_cbsisy',
]);
export const PRESSURE_HIGH_HIT_FAMILIES=Object.freeze([
 'enemy_1006_shield','enemy_1045_hammer','enemy_1062_rager','enemy_1092_mdgint','enemy_1112_emppnt',
 'enemy_1121_lifbos','enemy_1160_hvyslr','enemy_1170_dushld','enemy_1207_sfji','enemy_1283_sgkill',
 'enemy_1299_ymkilr','enemy_1302_ymtro','enemy_1329_cbshld','enemy_1364_spnaxe','enemy_1415_mmkabi',
 'enemy_1425_lrcmra','enemy_1438_dspred','enemy_2002_bearmi','enemy_9010_acpupp','enemy_9011_acrefr',
 'enemy_10084_hlegle','enemy_10124_uashld','enemy_10127_rkmbst','enemy_10144_xdelk','enemy_1035_haxe',
 'enemy_1316_wdpjd','enemy_1193_krgbsk','enemy_10086_hltigr','enemy_10088_hlsnip','enemy_10044_wintun',
 'enemy_10046_pshark','enemy_10125_uacomd','enemy_10215_klhjd','enemy_10220_kljbp','enemy_1048_hirman',
 'enemy_1063_rageth','enemy_1076_bsthmr','enemy_10114_ymgsld','enemy_1091_mdhmmr','enemy_1098_cchmpn',
 'enemy_1264_durgrd','enemy_10048_prtsld','enemy_1163_hvymot','enemy_1216_cansld','enemy_1281_sgcar',
 'enemy_1322_wdgyht','enemy_1226_dklord','enemy_1271_nhkodo','enemy_1362_dfat','enemy_1363_spnshd',
 'enemy_1419_mmcike','enemy_2136_shcolo','enemy_1255_lybgpa','enemy_1256_lyacpa','enemy_1330_cbrush',
 'enemy_1332_cbterm','enemy_10039_cnvber','enemy_1025_reveng','enemy_1539_reid',
]);
const families=new Set([...PRESSURE_BURST_FAMILIES,...PRESSURE_HIGH_HIT_FAMILIES]);
export const pressureEnemyFamily=key=>String(key||'').replace(/_[234]$/,'');
export const isPressureEnemy=key=>families.has(pressureEnemyFamily(key));
/** A tag alone grants no exemption. The match mints this marker only for the explicit challenge list. */
export function protectedPressureChallenge(e){
 return protectedKeys.has(e?.defId)&&e?.mods?.pressureProtectedChallenge===1&&typeof e.mods.bountyId==='string'&&e.mods.bountyId.length>0&&e.tag==='bounty';
}
/** Stable wire identity within RESULT_LIMITS.mods; callers reserve spy runtime slots before passing `limit`. */
export function compactPressureMods(mods,limit=16){
 if(!mods||typeof mods!=='object')return null;
 const priority=['bountyId','pressureProtectedChallenge','pressureContractAtkMul','contractBountySource','huntNoLp','returningId','returnLpDebt','returnHpPct','hpMul','atkMul','defMul','speedMul'];
 const keys=[...priority.filter(key=>Object.hasOwn(mods,key)),...Object.keys(mods).filter(key=>!priority.includes(key)).sort()];
 const out={};let n=0;
 for(const key of keys){
  if(n>=limit)break;
  if(key.length>32)continue;
  const value=mods[key];
  if((typeof value==='number'&&Number.isFinite(value))||typeof value==='boolean'||(typeof value==='string'&&value.length<=64)||value===null){out[key]=value;n++;}
 }
 return out;
}
/** `hits` is the worst complete-chain hit count against ONE target, including commanded missiles and extra hits. */
export function capEnemyBurstHit(b,e,amount,hits=1){
 if(!(amount>0)||e?.tag==='boss'||e?.isBoss||protectedPressureChallenge(e))return amount;
 const rank=e?.def?.raw?.rank||'ELITE',explicit=e?.mods?.pressureContractAtkMul,fallback=b?.flags?.pressureContractAtkMul?.[rank];
 const contract=Number.isFinite(explicit)&&explicit>0?explicit:Number.isFinite(fallback)&&fallback>0?fallback:1;
 const outgoing=e?.s?.dmgDealtMul>0?e.s.dmgDealtMul:1;
 return Math.min(amount,ENEMY_BURST_BUDGET*contract/Math.max(1,hits)/outgoing);
}
