// Battle-only effects from the maintainer's 2026-10-26 tables.
import * as S from '../support/index.js';

export function installOwnerBattle(battle) {
  const revive = [], fly = [], foresight = [];
  const knocked = new Set();
  for (const unit of battle.allyUnits) {
    if (!S.isOp(unit)) continue;
    for (const id of unit.def.raw?.garrisonIds || []) {
      const g = S.garrisonRecord(id);
      if (g?.effectKey === 'OWNER_REVIVE_NEAREST') revive.push({ unit, g });
      if (g?.effectKey === 'OWNER_ATTACK_FLY') fly.push({ unit, g });
      if (g?.effectKey === 'OWNER_FORESIGHT_ATTRITION') foresight.push({ unit, g });
    }
  }
  if (revive.length) battle.on('deploy', ({ unit }) => knocked.delete(unit));
  if (revive.length || foresight.length) battle.on('death', ({ unit, reason }) => {
    if (reason !== 'killed' || !S.isOp(unit)) return;
    knocked.add(unit);
    for (const it of foresight) {
      // A knocked-out holder still participates in this battle; retreating it does not trigger a loss.
      if (it.unit.ownerId === unit.ownerId && S.bondActive(battle, unit.ownerId, 'visiShip'))
        battle.removeLayers(unit.ownerId, 'visiShip', it.g.bb.count);
    }
    for (const it of revive) {
      if (it.unit !== unit) continue;
      const origin = battle.restTile(unit);
      const targets = battle.allyUnits.filter(t => t !== unit && t.ownerId === unit.ownerId && S.isOp(t)
        && !t.alive && !t.removed && knocked.has(t) && t.ground);
      const distance = t => { const p = battle.restTile(t), dr = p[0] - origin[0], dc = p[1] - origin[1]; return dr * dr + dc * dc; };
      // Equal distances retain the deterministic unit/deployment order; the source cannot revive itself.
      targets.sort((a, b) => distance(a) - distance(b) || a.id - b.id);
      let n = 0;
      for (const target of targets) if (battle.redeploy(target, { free: true }) && ++n >= it.g.bb.count) break;
    }
  });
  if (fly.length) battle.on('hit', ({ source, target, dmg }) => {
    if (!target || target.side !== 'enemy' || !target.isFlying || !dmg?.isAttack) return;
    for (const it of fly) if (it.unit === source) dmg.amount *= it.g.bb.atk_scale;
  });
}
