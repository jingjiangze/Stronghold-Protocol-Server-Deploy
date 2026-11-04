// Exact legal score ceiling, including non-stacking set completion rewards.
import {contractCompletionModel,contractPoints,contractsAllowedAt,resolvePicked} from './contracts.js';
import {maximumWithCompletion} from './contractCompletion.js';
const cache=new Map();
export function maximumChallenge(players=20,difficulty='ABYSS'){
 const n=Math.max(0,Math.min(20,Math.floor(players)||0)),key=n+':'+difficulty;if(cache.has(key))return cache.get(key);
 if(!contractsAllowedAt(difficulty)){const result=Object.freeze({points:0,ids:Object.freeze([])});cache.set(key,result);return result;}
 const best=maximumWithCompletion(contractCompletionModel(n,difficulty)),ids=resolvePicked(best.ids,n,difficulty),result=Object.freeze({points:contractPoints(ids,difficulty,n),ids:Object.freeze(ids)});cache.set(key,result);return result;
}
