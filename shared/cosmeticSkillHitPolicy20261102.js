// Pure presentation policy. Never feeds combat rules, RNG, damage, SP or target selection.
// [ASSUMED] New cosmetic HIT density is capped for readability/performance, not game balance.
export const COSMETIC_SKILL_HITS = Object.freeze(['skchr_mostma_2', 'skchr_hsguma_3', 'skchr_huang_3']);
export const COSMETIC_HIT_LIMITS = Object.freeze({
  ownerRate: 32, ownerBurst: 32, globalRate: 128, globalBurst: 128,
  pendingOwner: 32, pendingGlobal: 128, baseQueue: 4096, owners: 256, idle: 12,
});
