import {N_} from './i18n.js';
import {enemyFamilyKey,isEnhancedVariant} from './enemyVariants.js';

// Official CR / Operation Lucent Arrowhead roster, enemy handbook R18–R35.
// [ASSUMED] Round gates are Stronghold adaptations; existing faction budgets still apply.
const pair = name => ['enemy_' + name, 'enemy_' + name + '_2'];
export const BOLIVAR_ARMY_KEYS = Object.freeze([
  ...pair('1401_pogpro'), ...pair('1402_tgshd'), ...pair('1403_gunsho'),
  ...pair('1404_msnip'), ...pair('1405_boomer'), ...pair('1406_chghmr'),
  ...pair('1407_hummbd'), ...pair('1408_scotcn'), ...pair('1409_bdguad'),
]);
export const BOLIVAR_ARMY_BRANCHES = Object.freeze([
  {faction:'BOLIVAR', id:'jointScouts', name:N_('联合政府军先遣队'), minRound:3, maxRound:8, elite:false,
    members:[...pair('1401_pogpro'), ...pair('1403_gunsho'), ...pair('1404_msnip'), ...pair('1405_boomer'), ...pair('1407_hummbd')]},
  {faction:'BOLIVAR', id:'jointArmy', name:N_('联合政府军'), minRound:8, maxRound:12, elite:false,
    members:BOLIVAR_ARMY_KEYS.filter(k=>!/^enemy_1409_|^enemy_1406_.*_2$/.test(k))},
  {faction:'BOLIVAR', id:'jointVeterans', name:N_('联合政府军精锐'), minRound:12, maxRound:20, elite:true,
    members:[...BOLIVAR_ARMY_KEYS]},
  {faction:'BOLIVAR', id:'jointArtillery', name:N_('联合政府军炮兵支援'), minRound:9, maxRound:20,
    subdivision:true,kindExempt:true,chance:.35,maxKinds:1,maxCount:1,members:pair('1408_scotcn')},
]);
const armyKeys=new Set(BOLIVAR_ARMY_KEYS);
/** Choose only an already-valid upgrade of the selected family; the wave's shared quota runs afterwards. */
export function pickBolivarVariant(list,round,rng,enemies){
  const first=list[0];if(!first||!armyKeys.has(first)||round<8)return first;
  const family=enemyFamilyKey(enemies,first),upgrades=list.filter(k=>armyKeys.has(k)&&enemyFamilyKey(enemies,k)===family&&isEnhancedVariant(enemies,k));
  // [ASSUMED] Owner-approved conservative variation: 20% at R8–11, 30% at R12+.
  if(!upgrades.length||rng()>=(round>=12?.3:.2))return first;
  return upgrades[Math.floor(rng()*upgrades.length)];
}
