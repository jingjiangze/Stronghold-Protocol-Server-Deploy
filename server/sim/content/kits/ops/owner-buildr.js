// 青枳: the first S2 is timed; subsequent activations persist and generate DP every four seconds.
import { num, talentBb } from '../shared/tier1.js';
import { altSkills } from '../shared/tier3.js';

export default {
  char_488_buildr: (bb, chess, def) => ({
    skills: altSkills(chess, def, bb, {
      'skcom_charge_cost[3]': s => ({ kind: 'instant', trigger: 'SP_FULL', onStart({ battle, unit }) { battle.addDp(unit.ownerId, num(s.bb.cost)); } }),
      skchr_buildr_2: s => ({
        kind: 'duration', mods: { atkPct: num(s.bb.atk), defPct: num(s.bb.def) },
        onStart({ battle, unit, skill }) {
          battle.addDp(unit.ownerId, num(s.bb.cost));
          unit.mem.buildrUses = (unit.mem.buildrUses || 0) + 1;
          unit.mem.buildrNextDp = battle.time + num(s.bb['buildr_s_2[b].interval'], 4);
          if (unit.mem.buildrUses >= 2) { skill.kind = 'toggle';skill.timeLeft = Infinity; }
        },
        onTick({ battle, unit }) {
          if (unit.mem.buildrUses < 2) return;
          const interval = num(s.bb['buildr_s_2[b].interval'], 4);
          while (battle.time + 1e-9 >= unit.mem.buildrNextDp) {
            unit.mem.buildrNextDp += interval;
            battle.addDp(unit.ownerId, num(s.bb['buildr_s_2[b].cost'], 1));
          }
        },
      }),
    }),
    talents: [{ install(battle, unit) {
      const t = talentBb(chess);
      battle.on('deploy', c => {
        if (c.unit !== unit) return;
        unit.mem.buildrUses = 0;
        if (unit.skill?.id === 'skchr_buildr_2') unit.skill.kind = 'duration';
        const deployedAt = unit.deployedAt;
        battle.after(num(t.interval, 30), () => {
          if (unit.alive && unit.deployed && unit.deployedAt === deployedAt) battle.addBuff(unit, { key: 'talent:buildr_hp', mods: { hpPct: num(t.max_hp) } });
        }, { owner: unit });
      }, { owner: unit });
    } }],
  }),
};
