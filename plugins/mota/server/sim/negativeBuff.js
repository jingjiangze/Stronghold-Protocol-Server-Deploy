// Semantic classification for temporary immunity to debuffs. Damage is still resolved by the damage pipeline.
const GOOD_STATUS = new Set(['stealth', 'camou', 'invulnerable', 'resist', 'unblockable']);
const BAD_FLAGS = new Set(['stun', 'freeze', 'cold', 'sleep', 'bind', 'noMove', 'noAttack', 'noSkill', 'noSp', 'silence',
  'fear', 'tremble', 'disarm', 'attract', 'levitate', 'groundbind', 'noHeal', 'palsy', 'burstLock']);
const INVERSE = /^(?:dmg|phys|arts|true|elem|elemental|dot)Taken|(?:Interval|Cooldown|Cost)Mul$|^bat(?:Mul|Flat|Pct)$|^healDown/;
export const negativeStatus = key => !GOOD_STATUS.has(key);
export function negativeBuff(buff, target = null) {
  if (buff.status && negativeStatus(buff.status)) return true;
  if (buff.tags?.some(t => /debuff|poison|burn|bleed|dot|weak|fragile|slow|neural|necro|erosion|apoptosis/i.test(t))) return true;
  if (buff.onTick && /debuff|poison|burn|bleed|\bdot\b|necro|erosion|apoptosis/i.test(buff.key || '')) return true;
  if (target && buff.source?.side && buff.source.side !== target.side) return true;
  if (buff.flags && Object.entries(buff.flags).some(([k, v]) => v && BAD_FLAGS.has(k))) return true;
  for (const [key, value] of Object.entries(buff.mods || {})) {
    if (!Number.isFinite(value)) continue;
    const mul = key.endsWith('Mul'), inverse = INVERSE.test(key);
    if (mul ? (inverse ? value > 1 : value < 1) : inverse ? value > 0 : value < 0) return true;
  }
  return false;
}
