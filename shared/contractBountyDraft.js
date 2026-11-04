import {progressiveBounties} from './huntProgression.js';
import {LEADER_BOUNTIES} from './bountyRewards.js';
import {enemyThreat} from './enemyThreat.js';
export const contractBountyDue=(gd,round)=>!!(gd.fx?.bountyEveryRound||gd.fx?.bountyLateFrom&&round>=gd.fx.bountyLateFrom&&((round-gd.fx.bountyLateFrom)%2===0||gd.isBossRound(round)));
/** Named leaders enter by reward in voluntary drafts, independently of automatic pursuit threat gates. */
export function bountyOfferBand(round){
 if(round<9)return null;
 const max=Math.min(8,4+Math.floor((round-9)/2));
 return {min:Math.max(0,max-4),max};
}
export function bountyOfferPool(raw,round,inactive=new Set()){
 const band=bountyOfferBand(round);
 if(!band)return progressiveBounties(raw,round,inactive);
 const byEnemy=new Map(progressiveBounties(raw,round,inactive,{includeLower:true}).filter(x=>x.coin>=band.min&&x.coin<=band.max).map(x=>[x.enemy.key,x]));
 for(const card of raw.choices?.cards?.bounty||[]){
  const enemy=raw.enemies?.[card.enemyKey],coin=LEADER_BOUNTIES[card.enemyKey];
  if(coin==null||coin<band.min||coin>band.max||!enemy||inactive.has(enemy.key)||enemy.tokenOnly||enemy.contractSupportOnly||enemy.rank==='BOSS')continue;
  if(card.payout!=='kill'||card.multiRound||card.count!==1)continue;
  // The owner price table, rather than the old normal/hard generated-card gate, controls these named offers.
  if(!byEnemy.has(enemy.key)||byEnemy.get(enemy.key).coin!==coin)byEnemy.set(enemy.key,{enemy,coin,card:{...card,coin}});
 }
 return [...byEnemy.values()];
}
/** Mandatory opening bounties must fit the developing squad; voluntary 3-coin opening challenges remain optional. */
export function openingContractBountyBand(round){
 if(round<=2)return {coin:1,hp:7000,atk:550,power:13000};
 if(round===3)return {coin:2,hp:10000,atk:600,power:16000};
 if(round===4)return {coin:2,hp:12000,atk:650,power:20000};
 if(round===5)return {coin:3,hp:14000,atk:750,power:24000};
 if(round===6)return {coin:3,hp:16000,atk:850,power:28000};
 return null;
}
export function contractBountyOffer(raw,round,inactive,rng,context={}){
 return highBountyOffer(raw,round,inactive,rng,5,{...context,mandatory:true});
}
/** Fresh enemies before repeats. Scarce tiers use the nearest unused legal tier. */
export function highBountyOffer(raw,round,inactive,rng,count,{previous=[],seen=new Set(),mandatory=false}={}){
 const opening=mandatory?openingContractBountyBand(round):null;
 const pool=bountyOfferPool(raw,round,inactive).filter(x=>{
  if(!opening)return true;const threat=enemyThreat(x.enemy);
  return x.coin<=opening.coin&&threat.hp<=opening.hp&&(x.enemy.stats?.atk||0)<=opening.atk&&threat.power<=opening.power;
 });if(!pool.length)return[];
 const max=Math.max(...pool.map(x=>x.coin)),levels=[...new Set(pool.map(x=>x.coin))].sort((a,b)=>a-b);
 const lower=levels.filter(p=>p<=max-3),even=levels.filter(p=>p%2===0);
 // Spread the page across reward tiers; the extra even slot prevents 2/4/6 being squeezed out by repeated odd tops.
 const wanted=[max,Math.max(0,max-1),Math.max(0,max-2),lower.length?rng.pick(lower):levels[0],even.length?even.at(-1):levels[0]];
 while(wanted.length<count)wanted.push(max-1);
 const used=new Set(),last=new Set(previous),out=[];
 for(const price of wanted.slice(0,count)){
  const fresh=pool.filter(x=>!used.has(x.enemy.key)),available=fresh.length?fresh:pool;
  const delta=Math.min(...available.map(x=>Math.abs(x.coin-price)));
  let legal=available.filter(x=>Math.abs(x.coin-price)===delta);
  const next=legal.filter(x=>!last.has(x.enemy.key));if(next.length)legal=next;
  const other=legal.filter(x=>!seen.has(x.enemy.key));if(other.length)legal=other;
  const picked=rng.pick(legal);used.add(picked.enemy.key);seen.add(picked.enemy.key);
  out.push({...picked.card,rounds:1,multiRound:false});
 }
 return rng.shuffle(out);
}
