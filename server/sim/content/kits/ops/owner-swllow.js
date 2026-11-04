// 灰喉: official skill/talent blackboards from the local character/skill/module tables.
import { num, talentBb, statBuff } from '../shared/tier1.js';
import { altSkills, instantKindOf } from '../shared/tier3.js';

export default {
  char_367_swllow: (bb, chess, def) => {
    const t = talentBb(chess);
    return {
      skills: altSkills(chess, def, bb, {
        skchr_swllow_1: s => ({ kind: instantKindOf(s), attack: { hits: num(s.bb.cnt, 2), atkScale: num(s.bb.atk_scale, 1) } }),
        skchr_swllow_2: s => ({ kind: 'duration', mods: { atkPct: num(s.bb.atk) }, attack: { hits: 3 } }),
      }),
      talents: [{ install(battle, unit) {
        statBuff(battle, unit, 'talent:swllow_wind', { aspd: num(t.attack_speed) });
        battle.on('hit', c => {
          if (c.source === unit && c.dmg.isAttack && battle.rng.chance(num(t.prob))) c.dmg.mul *= num(t.atk_scale, 1);
        }, { owner: unit });
      } }],
    };
  },
};
