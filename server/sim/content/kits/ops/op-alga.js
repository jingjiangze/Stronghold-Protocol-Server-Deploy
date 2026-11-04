// 奥尔佳 char_4245_alga. Pinned CN character/skill/equip tables 63c7cec, 2026-11-01.
// PRTS 奥尔佳 S2 notes: physical ordinary damage applies taunt/sluggish; one marked enemy per source.
// Instructor's unblocked ATK multiplier is supplied by professions.js, including INS-X's replacement.
import { num, live, skill, talent, ops, enemies, elite, aura } from '../shared/ark-update-20261101.js';

export default { char_4245_alga: (_bb, raw) => {
  const s1 = skill(raw, 'skchr_alga_1'), s2 = skill(raw, 'skchr_alga_2');
  const b1 = s1?.bb ?? {}, b2 = s2?.bb ?? {}, t = talent(raw, 0);
  return {
    skills: {
      skchr_alga_1: { kind: 'instant', attack: { atkScale: num(b1.atk_scale, 1), hits: 2 } },
      skchr_alga_2: { kind: 'duration', mods: { atkPct: num(b2.atk) }, targeting: { rangeGrid: s2?.rangeGrid } },
    },
    install(b, u) {
      const active2 = () => u.skill?.id === 'skchr_alga_2' && u.skill.active;
      const key = `alga:mark:${u.id}`;
      aura(b, u, () => {
        const boss = enemies(b, u).some(elite), scale = active2() ? num(b2.talent_scale, 1) : 1;
        const atk = (num(t['alga[atk_up].atk']) + (boss ? num(t['alga[check_enemy].atk']) : 0)) * scale;
        for (const a of ops(b)) if (Math.abs(a.tileR - u.tileR) <= 1 && Math.abs(a.tileC - u.tileC) <= 1) {
          b.addBuff(a, { key: 'alga:voice', duration: 0.15, mods: { atkPct: atk } });
        }
      });
      b.on('beforeAttack', (c) => {
        if (c.attacker !== u || !live(u)) return;
        const choices = enemies(b, u).filter(elite).sort((a, z) => z.s.atk - a.s.atk || a.spawnSeq - z.spawnSeq);
        if (choices.length) c.targets = [choices[0]];
      }, { owner: u });
      b.on('damaged', (c) => {
        if (c.source !== u || c.type !== 'phys' || !(c.amount > 0) || !c.dmg?.isAttack || !active2() || c.target.side !== 'enemy') return;
        const old = u.mem.algaMarked;
        if (old && old !== c.target) b.removeBuff(old, key);
        u.mem.algaMarked = c.target;
        b.addBuff(c.target, { key, duration: num(b2['attack@debuff_duration']), mods: { taunt: num(b2['attack@taunt_level']), moveMul: 0.2 }, source: u });
      }, { owner: u });
      b.on('beforeUnitExit', ({ unit }) => { if (unit === u) { if (u.mem.algaMarked) b.removeBuff(u.mem.algaMarked, key); u.mem.algaMarked = null; } }, { owner: u });
    },
  };
} };
