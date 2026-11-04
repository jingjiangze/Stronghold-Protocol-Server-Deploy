import { recordOxiLethalContribution } from '../../../elementContribution20261101.js';
// 塔露拉 (operator char_4247_oxi), NOT the Black Snake boss. CN tables 63c7cec, 2026-11-01.
// PRTS 塔露拉 S3: overload starts at half duration; births no farther than 11 tiles behind her.
// [ASSUMED] idle amplification loses one arcane_step per attack; footprints refresh on a visited tile.
// [ASSUMED] S2 shelter decays linearly after its hold; S3 travelling fire uses continuous collider-radius contact.
import { COLS, ROWS } from '../../../constants.js';
import { dirVec, rotateOffset } from '../../../dir.js';
import { bodyInKeys, bodyInRadius, bodyKeys } from '../../../body.js';
import { num, live, skill, talent, ground, aura, hit } from '../shared/ark-update-20261101.js';
import { holdProtect } from '../shared/tier1.js';

export default { char_4247_oxi: (_bb, raw) => {
  const s1 = skill(raw, 'skchr_oxi_1'), s2 = skill(raw, 'skchr_oxi_2'), s3 = skill(raw, 'skchr_oxi_3');
  const b1 = s1?.bb ?? {}, b2 = s2?.bb ?? {}, b3 = s3?.bb ?? {}, t0 = talent(raw, 0), t1 = talent(raw, 1);
  return {
    skills: {
      skchr_oxi_1: { kind: 'instant', attack: {
        dmgType: 'arts', atkScale: num(b1.atk_scale), groundOnly: true,
        onHit({ battle, unit, target }) {
          if (!target) return;
          const keys = new Set([Math.round(target.y) * COLS + Math.round(target.x)]);
          for (const e of battle.enemies) if (ground(e) && bodyInKeys(e, keys)) {
            if (e !== target) hit(battle, unit, e, num(b1.atk_scale), 'arts', ['oxi:s1']);
            if (e.alive) battle.applyStatus(e, 'fear', { duration: num(b1.fear), source: unit });
          }
        },
      } },
      skchr_oxi_2: {
        kind: 'instant', trigger: 'NEVER', // source: AUTO after being attacked, not a normal DEFAULT next-attack skill
        onStart({ battle, unit }) {
          unit.mem.oxiShelterAt = battle.time;
          battle.addBuff(unit, { key: 'oxi:s2:stack', duration: num(b2.stack_duration), maxStacks: num(b2.max_stack_cnt), refresh: 'independent',
            mods: { atkPct: num(b2.atk), defPct: num(b2.def) }, tags: ['skill'], visible: true });
          const e = unit.mem.oxiRetaliate;
          if (!e) return;
          let damage = 0;
          for (const target of battle.foesInColliderRadius(e.x, e.y, num(b2.ability_range_radius))) damage += hit(battle, unit, target, num(b2.retaliate_atk_scale), 'arts', ['oxi:retaliate']);
          if (damage > 0) battle.heal(unit, unit, damage * num(b2.heal_ratio), { self: true });
          battle._ev(['nativeSkillSfx', unit.id, 'oxiS2Hit', unit.skill?.activations, 0]);
        },
      },
      skchr_oxi_3: {
        kind: 'duration', trigger: 'SP_FULL', mods: { atkPct: num(b3.atk) }, flags: { disarm: true },
        onStart({ unit }) { unit.mem.oxiWaveTime = 0; unit.mem.oxiElapsed = 0; unit.mem.oxiWaveSeq ??= 0; unit.mem.oxiV4OverloadCue = false; },
        onTick({ battle, unit, dt, skill: rt }) {
          unit.mem.oxiElapsed += dt; unit.mem.oxiWaveTime += dt;
          const overloaded = unit.mem.oxiElapsed >= rt.duration / 2;
          if (overloaded && !unit.mem.oxiV4OverloadCue) { unit.mem.oxiV4OverloadCue = true; battle._ev(['nativeSkillSfx', unit.id, 'oxiS3Overload', rt.activations, 0]); }
          const interval = overloaded ? num(b3.overload_interval) : num(b3.normal_interval);
          if (unit.mem.oxiWaveTime < interval - 1e-9) return;
          unit.mem.oxiWaveTime -= interval;
          const half = Math.floor(overloaded ? num(b3.overload_half_width) : num(b3.normal_half_width));
          const wave = { hits: new Map(), shots: [], active: true, seq: ++unit.mem.oxiWaveSeq };
          const [dr, dc] = dirVec(unit.dir);
          for (let lane = -half; lane <= half; lane++) {
            const [lr, lc] = rotateOffset(lane, 0, unit.dir);
            const r = unit.tileR + lr, c = unit.tileC + lc;
            if (r < 0 || r >= ROWS || c < 0 || c >= COLS) continue;
            let back = 0;
            for (let d = 1; d <= 11; d++) { const rr = r - dr * d, cc = c - dc * d; if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS) break; back = d; }
            const shot = { x: c - dc * back, y: r - dr * back, distance: 0, alive: true, effectId: `wave:${wave.seq}:${lane}` };
            const edge = dc > 0 ? COLS - 0.5 - shot.x : dc < 0 ? shot.x + 0.5 : dr > 0 ? ROWS - 0.5 - shot.y : shot.y + 0.5;
            shot.maxDistance = Math.min(num(b3.wave_speed) * 25, Math.max(0, edge) + num(b3.wave_exit_distance)); // native projectile lifeTime=25
            wave.shots.push(shot);
            battle.fx('arkOperatorFx', { x: shot.x, y: shot.y, id: unit.id, effectId: shot.effectId, nativeKey: 'oxi_skill_03_trail_01', loop: true,
              dc, dr, speed: num(b3.wave_speed), dur: shot.maxDistance / num(b3.wave_speed), surviveOwnerExit: true });
          }
          const timer = battle.every(1 / 30, () => {
            if (!wave.active) { timer.cancel(); return; }
            let remaining = 0;
            for (const shot of wave.shots) {
              if (!shot.alive) continue;
              shot.x += dc * num(b3.wave_speed) / 30; shot.y += dr * num(b3.wave_speed) / 30; shot.distance += num(b3.wave_speed) / 30;
              const contact = battle.enemiesInRadius(shot.x, shot.y, num(b3.projectile_range)).find((e) => live(e) && bodyInRadius(e, shot.x, shot.y, num(b3.projectile_range)));
              if (contact) {
                shot.alive = false;
                battle.fx('arkOperatorFx', { x: shot.x, y: shot.y, id: unit.id, effectId: shot.effectId, action: 'stop' });
                for (const e of battle.foesInColliderRadius(shot.x, shot.y, num(b3.range_radius))) {
                  const count = wave.hits.get(e) ?? 0; wave.hits.set(e, count + 1);
                  const scale = num(b3.heatwave_atk_scale) * (count ? num(b3.same_wave_repeat_damage_scale) : 1);
                  hit(battle, unit, e, scale, e.findBuff('burnBurst') ? 'elemental' : 'arts', ['oxi:heatwave']);
                }
                battle.fx('arkOperatorFx', { x: shot.x, y: shot.y, id: unit.id, effectId: shot.effectId, nativeKey: 'oxi_skill_03_hit_01' });
              } else if (shot.distance >= shot.maxDistance) { shot.alive = false; battle.fx('arkOperatorFx', { x: shot.x, y: shot.y, id: unit.id, effectId: shot.effectId, action: 'stop' }); }
              else remaining++;
            }
            if (!remaining) { wave.active = false; timer.cancel(); unit.mem.oxiWaveTimers.delete(timer); }
          }, { owner: unit, holdsBattle: true });
          unit.mem.oxiWaveTimers.add(timer);
        },
      },
    },
    install(b, u) {
      u.profile.dmgType = 'arts';
      u.mem.oxiArcane = 0; u.mem.oxiLastAttack = 0; u.mem.oxiFields = new Map(); u.mem.oxiBurnWalkers = new Map(); u.mem.oxiWaveTimers = new Set();
      const idle = Math.max(0.01, num(t0.arcane_step_interval));
      b.on('deploy', ({ unit }) => { if (unit === u) { u.mem.oxiArcane = 0; u.mem.oxiLastAttack = b.time; u.mem.oxiShelterAt = -Infinity; } }, { owner: u });
      aura(b, u, () => {
        if (b.time - u.mem.oxiLastAttack >= num(t0.arcane_idle_delay)) u.mem.oxiArcane = Math.min(num(t0.arcane_max), u.mem.oxiArcane + num(t0.arcane_step));
      }, idle);
      b.on('attack', ({ attacker }) => { if (attacker === u) { u.mem.oxiLastAttack = b.time; u.mem.oxiArcane = Math.max(0, u.mem.oxiArcane - num(t0.arcane_step)); } }, { owner: u });
      b.on('hit', (c) => {
        if (c.source === u && ['arts', 'elemental'].includes(c.dmg.type)) c.dmg.mul *= 1 + u.mem.oxiArcane;
        if (c.target !== u || !c.dmg.isAttack || c.source?.side !== 'enemy' || u.skill?.id !== 'skchr_oxi_2' || !u.canAct) return;
        if (u.skill.ready && !u.skill.active) { u.mem.oxiRetaliate = c.source; u.skill.activate('OXI_HURT'); }
        const elapsed = b.time - num(u.mem.oxiShelterAt, -Infinity), hold = num(b2.shelter_hold_duration), duration = num(b2.skill_duration);
        if (elapsed < duration) holdProtect(b, u, num(b2.damage_resistance) * (elapsed <= hold ? 1 : Math.max(0, 1 - (elapsed - hold) / (duration - hold))), 0.04, u);
      }, { owner: u, priority: 20 });
      b.on('beforeAttack', (c) => {
        if (c.attacker === u && u.skill?.id === 'skchr_oxi_2' && u.findBuff('oxi:s2:stack')) c.targets = u.blocking.filter((e) => e.alive);
      }, { owner: u });
      aura(b, u, () => {
        const elapsed = b.time - num(u.mem.oxiShelterAt, -Infinity), hold = num(b2.shelter_hold_duration), duration = num(b2.skill_duration);
        if (elapsed < duration) holdProtect(b, u, num(b2.damage_resistance) * (elapsed <= hold ? 1 : Math.max(0, 1 - (elapsed - hold) / (duration - hold))), 0.04, u);
      }, 1 / 30);
      b.on('damaged', (c) => {
        if (c.source !== u || c.type !== 'arts' || !(c.amount > 0) || c.target?.side !== 'enemy') return;
        const rider = { amount: c.amount * num(t0.ep_damage_ratio), type: 'element', element: 'burn', isSkill: c.dmg.isSkill, tags: ['oxi:burn'] };
        if (live(c.target)) b.dealDamage(u, c.target, rider); // original live gate and native path unchanged
        recordOxiLethalContribution(b, u, c, rider); // explicit source descriptor; reward only on this lethal hit
      }, { owner: u });
      b.on('elementBurst', ({ target, element }) => { if (live(u) && target.side === 'enemy' && element === 'burn') u.mem.oxiBurnWalkers.set(target, b.time + 5); }, { owner: u });
      aura(b, u, () => {
        const fields = u.mem.oxiFields;
        for (const [e, until] of u.mem.oxiBurnWalkers) {
          if (!live(e) || b.time >= until) { u.mem.oxiBurnWalkers.delete(e); continue; }
          const r = Math.round(e.y), c = Math.round(e.x), key = r * COLS + c;
          if (!b.grid.groundPassable(r, c)) continue;
          if (!fields.has(key)) {
            if (fields.size >= num(t1.max_count)) { const oldest = fields.keys().next().value; fields.delete(oldest); b.fx('arkOperatorFx', { id: u.id, effectId: `field:${oldest}`, action: 'stop' }); }
            b.fx('arkOperatorFx', { x: c, y: r, id: u.id, effectId: `field:${key}`, nativeKey: 'oxi_buff_01', loop: true, fixed: true });
          }
          fields.set(key, { r, c, until: b.time + num(t1.field_duration) });
        }
        for (const [key, f] of fields) if (f.until <= b.time) { fields.delete(key); b.fx('arkOperatorFx', { id: u.id, effectId: `field:${key}`, action: 'stop' }); }
      });
      aura(b, u, () => {
        if (!u.mem.oxiFields.size) return;
        for (const e of b.enemies) if (ground(e)) for (const key of bodyKeys(e)) if (u.mem.oxiFields.has(key)) hit(b, u, e, num(t1.field_atk_scale), 'arts', ['oxi:footprint']);
      }, Math.max(0.01, num(t1.field_interval, 0.3)));
      // Native SimpleProjectile._stopWhenSourceInvalid=0: released shots retain finite independent lives.
      // Owner-bound regions clear now; each in-flight timer removes itself on collision/boundary/lifeTime.
      b.on('beforeUnitExit', ({ unit }) => { if (unit === u) { u.mem.oxiFields.clear(); u.mem.oxiBurnWalkers.clear(); b.fx('arkOperatorFx', { id: u.id, action: 'clearOwner' }); } }, { owner: u });
    },
  };
} };
