// 安哲拉: S2 excludes low-health targets; the team talent uses the official abyssal group membership.
import { num, talentBb } from '../shared/tier1.js';
import { altSkills, statSkill } from '../shared/tier3.js';
const ABYSSAL = new Set(['char_143_ghost', 'char_218_cuttle', 'char_474_glady', 'char_1023_ghost2', 'char_4145_ulpia', 'char_263_skadi']);

export default {
  char_218_cuttle: (bb, chess, def) => ({
    skills: altSkills(chess, def, bb, {
      'skcom_atk_up[3]': statSkill,
      skchr_cuttle_2: s => ({ kind: 'duration', mods: { atkPct: num(s.bb.atk) },
        attack: { skipEnemy: e => e.hpRatio < .5, onHitStatus: { key: 'slow', duration: num(s.bb['attack@duration']), value: -num(s.bb['attack@move_speed']) } } }),
    }),
    talents: [{ install(battle, unit) {
      const aspd = num(talentBb(chess).attack_speed);
      for (const a of battle.allyUnits) if (a.kind === 'op' && a.ownerId === unit.ownerId && ABYSSAL.has(a.def?.charId)) {
        battle.addBuff(a, { key: 'talent:cuttle_intuition', mods: { aspd }, persist: true, allowDead: true, source: unit });
      }
    } }],
  }),
};
