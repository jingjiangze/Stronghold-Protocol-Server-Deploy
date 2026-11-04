// Maintainer-approved 2026-10-30. These rules only qualify the two trusted mandatory bounty sources.
import {PRESSURE_PROTECTED_CHALLENGE_KEYS} from './enemyPressure.js';
export const CONTRACT_BOUNTY_SOURCES=Object.freeze(['pactEveryBounty','pactLateBounty']);
export const CONTRACT_BOUNTY_ECONOMY=Object.freeze({fromRound:9,fullCoins:3,extraDivisor:2,netCap:5,hpBase:.04,hpPerCoin:.02,hpCap:.20});
export const isContractBountySource=id=>CONTRACT_BOUNTY_SOURCES.includes(id);
export const contractBountyQuote=card=>{const n=card?.contractBountyQuote??card?.coin;return Number.isFinite(Number(n))?Math.max(0,Math.trunc(Number(n))):0;};
export function contractBountyNet(round,gross){
 const value=Number(gross),b=Number.isFinite(value)?Math.max(0,Math.trunc(value)):0,r=CONTRACT_BOUNTY_ECONOMY;
 return round<r.fromRound?b:Math.min(b,r.fullCoins)+Math.min(r.netCap-r.fullCoins,Math.floor(Math.max(b-r.fullCoins,0)/r.extraDivisor));
}
export function contractBountyHpBonus(card,enemyKey){
 const quote=contractBountyQuote(card);
 if(!isContractBountySource(card?.sourceContractId)||card?.payout==='perfect'||!(quote>0)||PRESSURE_PROTECTED_CHALLENGE_KEYS.includes(enemyKey))return 0;
 const r=CONTRACT_BOUNTY_ECONOMY;return Math.min(r.hpCap,r.hpBase+r.hpPerCoin*quote);
}
export function contractBountyCardPayout(round,card){
 if(!isContractBountySource(card?.sourceContractId))return Math.max(0,Math.trunc(Number(card?.coin)||0));
 if(card?.payout==='perfect'||Math.max(1,Math.trunc(Number(card?.count)||1))!==1)throw Error('Mandatory contract bounty must be one kill-reward body');
 return contractBountyNet(round,contractBountyQuote(card));
}
export function contractBountySpawnMods(mods,card,enemy){
 // Called only for independent bounty SpawnSpecs; formal shared-pool leaders never pass this boundary.
 const bonus=contractBountyHpBonus(card,enemy?.key);
 if(!bonus||mods?.contractBountyHpMul>1)return mods;
 return {...mods,hpMul:(mods?.hpMul??1)*(1+bonus),contractBountyHpMul:1+bonus};
}
/** Real phase/relay bodies retain the prepared factor; ordinary children must not inherit it. */
export function withoutContractBountyHp(mods){
 if(!isContractBountySource(mods?.contractBountySource)||!Object.hasOwn(mods,'contractBountyHpMul')&&!Object.hasOwn(mods,'contractBountyQuote'))return mods;
 const copy={...mods};if(copy.contractBountyHpMul>1)copy.hpMul=(copy.hpMul??1)/copy.contractBountyHpMul;delete copy.contractBountyHpMul;delete copy.contractBountyQuote;return copy;
}
export function contractBountyCardFields(card,round,sourceContractId=card?.sourceContractId){
 if(!isContractBountySource(sourceContractId))return{};
 const quote=contractBountyQuote(card),gross=quote*Math.max(1,Math.trunc(Number(card?.count)||1));
 return{sourceContractId,contractBountyQuote:quote,contractBountyEconomy:{version:1,round,gross,net:contractBountyNet(round,gross),fee:gross-contractBountyNet(round,gross),hpPercent:Math.round(contractBountyHpBonus({...card,sourceContractId},card.enemyKey)*100)}};
}

/** Derived HP bookkeeping is not wire identity; hpMul and trusted provenance still bind the original source. */
export function contractBountyIdentityMods(mods){
 if(!isContractBountySource(mods?.contractBountySource)||!Object.hasOwn(mods,'contractBountyHpMul'))return mods;
 const copy={...mods};delete copy.contractBountyHpMul;return copy;
}
