// Runtime additions for the requested, already playable operators. Source equip IDs pin each behavior.
// Horn004 alone is web-activated by hornWebModule20261101.js (owner 2026-11-01); other mode-only modules keep their gates.
import { bodyInRange } from '../../../body.js';
import { num, live, ops, aura } from './ark-update-20261101.js';
const moduleBb = (raw) => Object.assign({}, ...(raw.talents ?? []).filter((t) => t.index === -1).map((t) => t.bb));

export function installHalo2Module20261101(b, u, raw) {
  if (!raw.module?.active || raw.module.id !== 'uniequip_003_halo2') return;
  const bb = moduleBb(raw), rate = num(bb.sp_recovery_per_sec), scale = num(bb.damage_scale, 1);
  aura(b, u, () => {
    const occupied = b.enemiesInKeys(u.rangeKeys, u, u.profile).length > 0;
    b.addBuff(u, { key: 'halo2:decX:sp', duration: 0.15, mods: { spRecoveryFlat: occupied ? rate : 0 } });
    if (!(scale > 1)) return;
    // 术法充盈: shared buff key; repeated sources do not multiply one another.
    for (const a of ops(b)) if (Math.abs(a.tileR - u.tileR) + Math.abs(a.tileC - u.tileC) <= 1) {
      const old = a.findBuff('magicarcane');
      if (!old || num(old.mods?.artsDealtMul, 1) <= scale) b.addBuff(a, { key: 'magicarcane', duration: 0.15, mods: { artsDealtMul: scale } });
    }
  });
}

export function installMlyssModule20261101(b, u, raw, tokenId) {
  if (!raw.module?.active || raw.module.id !== 'uniequip_004_mlyss') return;
  const bb = moduleBb(raw), ratio = num(bb.ep_damage_ratio), scale = num(bb.atk_scale), sp = num(bb.sp);
  const mine = (a) => a && (a === u || (a.kind === 'token' && a.ownerUnit === u && a.defId === tokenId));
  b.on('damaged', (c) => {
    if (!live(u) || !mine(c.source) || !(c.amount > 0) || c.target.side !== 'enemy' || !['phys', 'arts', 'true', 'elemental'].includes(c.type) || !live(c.target)) return;
    b.dealDamage(c.source, c.target, { amount: c.amount * ratio, type: 'element', element: 'erosion', isSkill: c.dmg.isSkill, tags: ['mlyss:erosion'] });
  }, { owner: u });
  if (!(scale > 0)) return;
  b.on('elementBurst', ({ target, element }) => {
    if (!live(u) || element !== 'erosion' || target.side !== 'enemy') return;
    const tokens = b.allyUnits.filter((a) => a !== u && mine(a) && live(a));
    if (!bodyInRange(target, u.rangeKeySet) && !tokens.some((a) => bodyInRange(target, a.rangeKeySet))) return;
    b.dealDamage(u, target, { amount: u.s.atk * scale, type: 'elemental', element: 'erosion', isSkill: false, canDodge: false, tags: ['mlyss:moduleBurst'] });
    for (const a of tokens) a.skill?.gainSp(sp, 'talent');
  }, { owner: u });
}

export function installSvash2Module20261101(b, u, raw) {
  if (!raw.module?.active || raw.module.id !== 'uniequip_002_svash2') return;
  const bb = moduleBb(raw), t0 = raw.talents?.find((t) => t.index === 0)?.bb ?? {};
  const buff = (a) => b.addBuff(a, { key: 'svash2:moduleAtk', duration: 0.15, mods: { atkPct: num(t0.atk) } });
  aura(b, u, () => { for (const a of ops(b)) if (a.ownerId === u.ownerId && (a === u || a.base.cost < num(u.mem.eyeCost))) buff(a); });
  const first = ({ unit: a }) => {
    if (a !== u || u.mem.svashModuleFirst) return;
    u.mem.svashModuleFirst = true;
    // Match the existing kit's cost-sorted waiting-area adaptation. No prep/shop price is touched.
    const waiting = b.allyUnits.filter((x) => x.kind === 'op' && x !== u && x.ownerId === u.ownerId && !x.deployed && !x.removed)
      .sort((x, z) => x.base.cost - z.base.cost || x.id - z.id);
    const left = waiting[0];
    if (left) { left.base.cost = Math.max(0, left.base.cost + num(bb.value)); left.markDirty(); }
  };
  b.on('deploy', first, { owner: u });
}
