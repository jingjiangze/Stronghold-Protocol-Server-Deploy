// Owner balance: price means the existing kill-bounty amount, never a new reward or an edited card price.
import {enemyThreat,normalEnemyMinRound,isRangedThreat} from './enemyThreat.js';
import {isYanDeathProduct} from './enemyRoles.js';
import {bountyLeaderRound} from './bountyDifficulty.js';
// Both pursuit additions and bounded ambush actors have a verified zero-LP spawn source.
export const isHuntEntry = entry => (entry?.mods?.ambushDrop===1&&entry.mods.ambushEscaping!==1)||(Number.isInteger(entry?.mods?.huntNoLp) && entry.mods.huntNoLp > 0);
/** Curated old bounty lists must not bypass the opening gates of the expanded roster. */
export function openingBountyAllowed(raw,card,round){
 if(round>8)return true;const e=raw.enemies?.[card?.enemyKey];
 if(!e||e.tokenOnly||e.contractSupportOnly||e.rank==='BOSS')return false;
 // Voluntary original initial bounties are a separate 0–3-coin challenge, not automatic wave troops.
 if(card.draftPool==='initial'&&Number(card.coin)>=0&&Number(card.coin)<=3)return true;
 return !e.miniBoss&&!e.bountyOnly&&normalEnemyMinRound(e)<=round;
}
export const huntStage = round => {
  if (round <= 2) return {min:0,max:3,power:13000,hp:7000,atk:650};
  if (round <= 4) return {min:0,max:3,power:28000,hp:18000,atk:800};
  if (round <= 6) return {min:0,max:4,power:32000,hp:20000,atk:1000};
  if (round <= 8) return {min:1,max:4,power:36000,hp:22000,atk:1100};
  if (round <= 10) return {min:1,max:5,power:65000,hp:42000,atk:1300};
  if (round <= 12) return {min:3,max:6,power:80000,hp:50000,atk:2000};
  if (round <= 14) return {min:4,max:7,power:150000,hp:100000,atk:3500};
  if (round <= 16) return {min:5,max:8,power:250000,hp:150000,atk:5000};
  return {min:6,max:8,power:Infinity,hp:Infinity,atk:Infinity};
};

/** One entry per enemy. Multi-round discounts and perfect-clear bonuses do not define an enemy's kill price. */
export function progressiveBounties(raw,round,inactive=new Set(),{includeLower=false}={}) {
  const band=huntStage(round),byEnemy=new Map();
  for(const card of raw.choices?.cards?.bounty||[]){
    const e=raw.enemies?.[card.enemyKey],coin=Number(card.coin);
    if(!e||e.rank==='BOSS'||e.tokenOnly||e.contractSupportOnly||e.eliteBountyOnly||isYanDeathProduct(e.key)||inactive.has(e.key))continue;
    if(card.payout!=='kill'||card.multiRound||!Number.isInteger(coin)||coin<(includeLower?0:band.min)||coin>band.max)continue;
    if((card.minRound||0)>round||(e.contractMinRound||0)>round)continue;
    if(e.miniBoss&&round<bountyLeaderRound(e))continue;
    const originalEarly=round>=3&&card.draftPool==='initial'&&coin<=3&&card.count===1&&!e.miniBoss;
    if(!e.miniBoss&&!originalEarly&&normalEnemyMinRound(e)>round)continue;
    const text=(e.abilities||[]).map(a=>a.text||'').join(' ');
    if(round<5&&isRangedThreat(e)&&/隐匿|隐形|迷彩/.test(text))continue;
    if(!e.miniBoss&&round<11&&/变化形态|重生|复生|全场|永久|强制击倒/.test(text))continue;
    const threat=enemyThreat(e),s=e.stats||{},power=Math.max(e.attrPower||0,threat.power);
    if(power>band.power||threat.hp>band.hp||(s.atk||0)>band.atk)continue;
    const old=byEnemy.get(e.key);
    // Prefer a card inside the requested band; lower prices are a separate reserve,
    // never a rewrite of the enemy's reward. Official variants keep their own price.
    const lower=coin<band.min;
    if(!old||old.lowerPrice&&!lower||old.lowerPrice===lower&&coin<old.coin)byEnemy.set(e.key,{enemy:e,coin,card,lowerPrice:lower});
  }
  return [...byEnemy.values()];
}
