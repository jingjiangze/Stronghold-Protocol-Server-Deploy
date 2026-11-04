// 奥斯塔: unblocked victims bleed independently of the front-row trait; S2 doubles that bleed.
import { num, talentBb, batMod } from '../shared/tier1.js';
import { altSkills, statSkill } from '../shared/tier3.js';

export default {
  char_346_aosta: (bb, chess, def) => ({
    skills: altSkills(chess, def, bb, {
      'skcom_quickattack[3]': statSkill,
      skchr_aosta_2: s => ({ kind: 'duration', mods: { atkPct: num(s.bb.atk), batPct: batMod(s.bb.base_attack_time, chess) },
        attack: { onHitStatus: { key: 'bind', duration: num(s.bb['attack@frozen_duration']) } } }),
    }),
    talents: [{ install(battle, unit) {
      const t = talentBb(chess);
      battle.on('damaged', c => {
        if (c.source !== unit || !c.dmg?.isAttack || !c.target.alive || c.target.side !== 'enemy' || c.target.blockedBy) return;
        const scale = unit.skill?.active && unit.skill.id === 'skchr_aosta_2' ? num(unit.skill.bb.talent_scale, 2) : 1;
        const amount = unit.s.atk * unit.s.atkScaleMul * num(t.atk_scale) * scale;
        battle.addBuff(c.target, { key: `aosta:bleed:${unit.id}`, source: unit, duration: num(t.duration, 3), interval: 1,
          tags: ['dot', 'talent'], onTick({ battle: b, unit: victim }) {
            b.dealDamage(unit, victim, { amount, type: 'arts', isAttack: false, canDodge: false, tags: ['dot', 'aosta:bleed'] });
          } });
      }, { owner: unit });
    } }],
  }),
};
