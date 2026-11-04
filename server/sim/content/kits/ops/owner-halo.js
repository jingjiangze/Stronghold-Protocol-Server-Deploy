// 星源: two independent chain origins, preserving the profession's jump falloff and sluggish duration.
import { num, talentBb } from '../shared/tier1.js';
import { altSkills, instantKindOf } from '../shared/tier3.js';

export default {
  char_135_halo: (bb, chess, def) => ({
    skills: altSkills(chess, def, bb, {
      skchr_halo_1: s => ({ kind: instantKindOf(s), attack: { atkScale: num(s.bb.atk_scale, 1), maxTargets: num(s.bb.max_target, 2) } }),
      skchr_halo_2: s => ({ kind: 'duration', mods: { atkPct: num(s.bb.atk) }, attack: { maxTargets: num(s.bb['attack@max_target'], 2) } }),
    }),
    talents: [{ install(battle, unit) {
      const t = talentBb(chess), interval = num(t.interval, 15), cap = num(t.max_stack_cnt, 5);
      let deployedAt = null, stacks = 0;
      battle.on('deploy', c => { if (c.unit === unit) { deployedAt = battle.time; stacks = 0; battle.removeBuff(unit, 'talent:halo_research'); } }, { owner: unit });
      battle.every(.1, () => {
        if (!unit.alive || !unit.deployed || deployedAt == null) return;
        const next = Math.min(cap, Math.floor((battle.time - deployedAt + 1e-8) / interval));
        if (next === stacks) return;
        stacks = next;
        battle.addBuff(unit, { key: 'talent:halo_research', mods: { aspd: stacks * num(t.attack_speed) } });
      }, { owner: unit });
    } }],
  }),
};
