// Reward-only lethal-rider receipt. Never fills a gauge, calls elementHit, damages HP or triggers a burst.
export function recordOxiLethalContribution(b, source, damageContext, rider) {
  const h = damageContext?.hpReceipt, target = damageContext?.target;
  if (!b._hooks.elementContribution || !h || h.used || h.source !== source || h.target !== target || h.damage !== damageContext.dmg
    || !(h.beforeHp > 0) || !(h.dealt > 0) || !Number.isFinite(h.afterHp) || h.afterHp > 0 || !h.element?.eligible
    || !target || target.side !== 'enemy'
    || target.alive && (Object.values(target.burstPending || {}).some(Boolean)
      || target.buffs.some(b => b.flags?.burstLock || b.flags?.invulnerable || b.mods?.elemTakenMul === 0))
    || source?.def?.charId !== 'char_4247_oxi' || damageContext.type !== 'arts'
    || rider.type !== 'element' || rider.element !== 'burn' || !rider.tags?.includes('oxi:burn')) return;
  h.used = true; // one native HP damage receipt, even if a callback is duplicated
  const e = h.element;
  // Exact original kit rider descriptor and pre-lethal intake/remaining slot; never reverse-engineer from a kill.
  const amount = Math.min(Math.max(0, e.threshold - e.before), Math.max(0, rider.amount * (rider.mul ?? 1) * e.intake));
  if (!(amount > 0) || !Number.isFinite(amount) || !(e.threshold > 0)) return;
  const check = { source, target, rider, amount, threshold: e.threshold, cancel: false, kind: 'lethalRider' };
  // Read-only eligibility metadata extension for content with additional imperative elementHit rules.
  // It may reject/reduce a reward receipt; native elementHit side effects are deliberately never replayed on a corpse.
  if (b._hooks.elementContributionCheck) b.emit('elementContributionCheck', check);
  if (check.cancel || !(check.amount > 0) || !Number.isFinite(check.amount)) return;
  b.emit('elementContribution', { source, target, element: 'burn', effective: Math.min(amount, check.amount), threshold: e.threshold, kind: 'lethalRider', hpDealt: h.dealt });
}
