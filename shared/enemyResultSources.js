// Narrow result identity for the owner's pressure families and the six identification spies.
// Canonicalization matches a bounded wire record; callers always restore the complete original server mods.
import {contractBountyIdentityMods} from './contractBountyEconomy.js';
import {isPressureEnemy,compactPressureMods} from './enemyPressure.js';
import {isInvestigationSpy,spyStaticMods} from './spyInvestigation.js';
export const hasScopedEnemySource=key=>isPressureEnemy(key)||isInvestigationSpy(key);
export function enemySourceIdentity(key,mods){
 const identity=compactPressureMods(spyStaticMods(key,contractBountyIdentityMods(mods)),isInvestigationSpy(key)?14:16);
 return identity&&Object.keys(identity).length?identity:null;
}
export function requiresPressureSourceAuthority(spec){
 const seen=new Map();
 for(const spawn of spec?.spawns||[]){
  if(!isPressureEnemy(spawn.enemyKey))continue;
  const identity=JSON.stringify([spawn.sourcePlayerId??null,enemySourceIdentity(spawn.enemyKey,spawn.mods)]);
  if(seen.has(spawn.enemyKey)&&seen.get(spawn.enemyKey)!==identity)return true;
  seen.set(spawn.enemyKey,identity);
 }
 return false;
}
