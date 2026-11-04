import {LEADER_BOUNTIES} from './bountyRewards.js';
import {enemyThreat,enemyAbilityText} from './enemyThreat.js';
/** Owner tiers for standalone leaders; scheduled raid bosses never enter this pool. */
export function bountyDifficulty(e){
 if(e?.bountyDifficulty)return e.bountyDifficulty;
 const t=enemyThreat(e),text=enemyAbilityText(e);
 return t.hp>42000||t.atk>1100||t.def>1000||t.res>70||t.dps>550||/重生|复活|第二形态|第二阶段|强制击倒|强制撤退|吞噬|全场|全图|永久|国度/.test(text)||e?.returnsToOwnField?'hard':'normal';
}
export const bountyLeaderRound=e=>bountyDifficulty(e)==='hard'?13:9;
export function newLeaderBounty(e){if(LEADER_BOUNTIES[e?.key]!=null)return LEADER_BOUNTIES[e.key];const t=enemyThreat(e);return bountyDifficulty(e)==='normal'?(t.hp<=30000&&t.atk<=850?3:4):(t.power<=65000&&t.hp<=45000?5:6);}
