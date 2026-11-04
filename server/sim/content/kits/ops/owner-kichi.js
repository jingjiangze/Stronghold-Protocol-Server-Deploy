// 吉星: per-attack S1 stacking and S2 status rotation, with unique defeated-enemy kinds tracked per deployment.
import { num, talentBb, batMod } from '../shared/tier1.js';
import { altSkills } from '../shared/tier3.js';

export default {
  char_4203_kichi: (bb, chess, def) => ({
    skills: altSkills(chess, def, bb, {
      skchr_kichi_1: s => ({ kind: 'duration', mods: { batPct: batMod(s.bb.base_attack_time, chess) },
        onStart({ unit }) { unit.mem.kichiStacks = 0; },
        onAttack({ battle, unit }) {
          unit.mem.kichiStacks = Math.min(num(s.bb.max_stack_cnt, 4), unit.mem.kichiStacks + 1);
          battle.addBuff(unit, { key: 'skill:kichi_atk', mods: { atkPct: unit.mem.kichiStacks * num(s.bb.atk) } });
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'skill:kichi_atk'); },
      }),
      skchr_kichi_2: s => ({ kind: 'duration', mods: { atkPct: num(s.bb.atk), batPct: batMod(s.bb.base_attack_time, chess) },attack:{},
        onStart({ unit }) { unit.mem.kichiCycle = 0; },
      }),
    }),
    install(battle, unit) {
      battle.on('beforeAttack', c => {
        if (c.attacker !== unit || !unit.skill?.active || unit.skill.id !== 'skchr_kichi_2') return;
        const statuses = [['sluggish', 'attack@sluggish'], ['bind', 'attack@unmoveable'], ['stun', 'attack@stun']];
        const [key, durationKey] = statuses[unit.mem.kichiCycle++ % statuses.length];
        c.profile.onHitStatus = { key, duration: num(unit.skill.bb[durationKey]) };
      }, { owner: unit });
      const t = talentBb(chess);
      battle.on('deploy', c => { if (c.unit === unit) { unit.mem.kichiKinds = new Set();battle.removeBuff(unit, 'talent:kichi_luck'); } }, { owner: unit });
      battle.on('kill', c => {
        if (c.killer !== unit || c.victim.side !== 'enemy') return;
        const seen = unit.mem.kichiKinds || (unit.mem.kichiKinds = new Set());
        seen.add(c.victim.defId);
        battle.addBuff(unit, { key: 'talent:kichi_luck', mods: { dmgDealtMul: 1 + Math.min(seen.size, num(t.max_stack_cnt, 3)) * num(t.damage_scale) } });
      }, { owner: unit });
    },
  }),
};
