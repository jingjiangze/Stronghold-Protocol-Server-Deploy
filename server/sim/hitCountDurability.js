// Owner 2026-10-29 R2: preserve relic tiers instead of capping every type at100.
// [ASSUMED] Share one smooth growth curve. Its multiplier approaches20/9:
// native45 approaches100 hits; native30/35 retain their relative durability.
// Reductions remain unchanged. Only kitTimes supplies the native hit baseline.

/** HP/contract/aura growth stays monotone, with no common late hard plateau. */
export function relicGrowth(multiplier) {
  return multiplier <= 1 ? multiplier : 1 + 11 / (9 + 11 / (multiplier - 1));
}

/** Apply once to final raw HP; ordinary units keep their exact original value. */
export function relicHitCount(hp, nativeHits) {
  if (!(nativeHits > 0)) return hp;
  return Math.max(1, Math.round(nativeHits * relicGrowth(hp / nativeHits)));
}
