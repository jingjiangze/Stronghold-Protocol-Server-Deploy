// Pure presentation observer: never changes any of the four frozen kits, attacks, damage, SP, RNG, or timers.
import { operatorSfxState20261101, OPERATOR_SFX_IDS_20261101 } from '../../../../../shared/operatorSfxModes20261101.js';
export function withOperatorSfxSignals20261101(kit, unit) {
  if (!OPERATOR_SFX_IDS_20261101.includes(unit?.def?.charId) || kit.operatorSfx20261101) return kit;
  return { ...kit, operatorSfx20261101: true, install(b, u) {
    kit.install?.(b, u);
    let previous = '';
    b.on('beforeAttack', (c) => {
      if (c.attacker !== u) return;
      const state = operatorSfxState20261101(u), key = state ? `${state.mode}:${state.branch}` : '';
      if (key && key !== previous) { previous = key; b._ev(['opSfx', u.id, state.mode, state.branch]); }
    }, { owner: u, priority: 1000 }); // before Tocka consumes the one-shot snow attack flag
    b.on('deploy', ({ unit: a }) => { if (a === u) previous = ''; }, { owner: u });
  } };
}
