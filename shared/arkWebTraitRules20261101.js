// Owner's final rules, 2026-11-01. Pure metadata: no source-profession overrides.
export const WEB_TRAITS = Object.freeze({
  char_4245_alga: Object.freeze({ key: 'alga', bond: 'skillfulShip', cap: 20, attacks: 15, eliteAttacks: 10, gain: 2 }),
  char_4247_oxi: Object.freeze({ key: 'oxi', bond: 'arcaneShip', cap: 20, contributionGain: 1, eliteContributionGain: 2, burstGain: 1, eliteBurstGain: 3, progressScope: 'player-grade-round', lethalPolicy: 'explicit-rider-fold' }),
  char_4244_tocka: Object.freeze({ key: 'tocka', bond: 'swiftShip', cap: 20, eliteCap: 25, gain: 1 }),
  char_4246_dminon: Object.freeze({ key: 'dminon', interval: 15, spread: 1, eliteSpread: 2, reward: 5, eliteReward: 10, spreadStrategy: 'toward-uncovered-allies', fullBehavior: 'retain', bossRegionPolicy: 'battle-owner-half' }),
});
export const WEB_BONDS = Object.freeze(['skillfulShip', 'arcaneShip', 'swiftShip']);
export const WEB_REALM_POLICY = 'recipient-bond-max'; // user confirmed: one highest actual coverage per player/bond
