// Owner: stationary bounty leaders arrive visibly in midfield; their descendants cannot cost LP.
export const FIXED_LEADER_WARNING=2;
export function fixedLeader(raw){return !!raw&&(['enemy_1519_bgball','enemy_2018_csdoll'].includes(raw.key)||!!raw.miniBoss&&raw.stats?.moveSpeed===0);}
