import { nextWebAction, webGrantReceipt, grantWebBuff, grantWebSp, grantWebDecay } from '../../garrisons/webTraits20261101.js';
// 冻河 char_4244_tocka. Pinned official CN tables 63c7cec, 2026-11-01; PRTS 冻河 S2 notes.
// Trigger marks are one-shot objects shared across copies: another caster cannot stack the same effect.
// [ASSUMED] unspecified mark/heal ties use HP ratio then deployment order; S3 transfer uses SP ratio then order.
import { bodyInRange } from '../../../body.js';
import { num, live, skill, talent, ops, aura, decayBuff } from '../shared/ark-update-20261101.js';

export default { char_4244_tocka: (_bb, raw) => {
  const s1 = skill(raw, 'skchr_tocka_1'), s2 = skill(raw, 'skchr_tocka_2'), s3 = skill(raw, 'skchr_tocka_3');
  const b1 = s1?.bb ?? {}, b2 = s2?.bb ?? {}, b3 = s3?.bb ?? {}, t0 = talent(raw, 0), t1 = talent(raw, 1);
  const inRange = (u, a) => bodyInRange(a, u.rangeKeySet);
  const ratio = (a) => a.skill && a.skill.spCost > 0 ? (a.skill.charges + a.skill.sp / a.skill.spCost) : -1;
  const choices = (b, u, kind, global = false) => ops(b).filter((a) => a !== u && (global || inRange(u, a)) && !a.mem[`tocka:${kind}`])
    .sort((a, z) => a.hp / a.s.maxHp - z.hp / z.s.maxHp || a.aggroSeq - z.aggroSeq || a.id - z.id);
  const talentTrigger = (b, u, action) => {
    if (!live(u)) return;
    grantWebSp(b, u, u, num(t0.sp), action);
    const a = ops(b).filter((x) => inRange(u, x) && x.hp < x.s.maxHp && !x.s.flags.noHeal)
      .sort((x, z) => x.hp / x.s.maxHp - z.hp / z.s.maxHp || x.id - z.id)[0];
    if (a) b.heal(u, a, u.s.atk * num(t0.heal_scale));
  };
  const mark = (b, u, a, kind, action = nextWebAction(b, u)) => {
    if (!a) return false;
    a.mem[`tocka:${kind}`] = { owner: u, fire: (triggerAction = nextWebAction(b, u)) => {
      if (kind === 's1') for (const suffix of ['01', '02']) b.fx('arkOperatorFx', { id: u.id, effectId: `mark:${a.id}:${suffix}`, action: 'stop' });
      talentTrigger(b, u, triggerAction);
      return triggerAction;
    } };
    // Both loops are explicitly on the trigger targets in skchr_tocka_1's source buff graph.
    if (kind === 's1') for (const suffix of ['01', '02']) b.fx('arkOperatorFx', { x: a.x, y: a.y, id: u.id, target: a.id,
      effectId: `mark:${a.id}:${suffix}`, nativeKey: `tocka_skill_01_buff_${suffix}`, loop: true });
    webGrantReceipt(b, u, a, action);
    u.mem.tockaSnow = true;
    return true;
  };
  const transfer = (b, u, a, action = nextWebAction(b, u)) => {
    const held = a.mem['tocka:s3'];
    if (!held) return;
    delete a.mem['tocka:s3'];
    held.fire(action);
    grantWebDecay(b, u, a, `tocka:s3:atk:${u.id}`, num(b3.bonus_duration), { atkPct: num(b3.bonus_init_atk) }, action, decayBuff);
    grantWebDecay(b, u, u, `tocka:s3:atk:${u.id}`, num(b3.bonus_duration), { atkPct: num(b3.bonus_init_atk) }, action, decayBuff);
    const next = ops(b).filter((x) => x !== a && x !== u && inRange(u, x) && !x.mem['tocka:s3'])
      .sort((x, z) => ratio(z) - ratio(x) || x.id - z.id)[0];
    if (next) mark(b, u, next, 's3', action);
  };
  return {
    skills: {
      skchr_tocka_1: { kind: 'instant', trigger: 'NEVER', onStart({ battle, unit }) {
        const list = choices(battle, unit, 's1').slice(0, num(b1.max_target));
        for (const a of list) mark(battle, unit, a, 's1');
      } },
      skchr_tocka_2: { kind: 'instant', trigger: 'NEVER', onStart({ battle, unit }) {
        for (const a of choices(battle, unit, 's2', true).filter((x) => x.skill && !x.skill.noSkill).slice(0, num(b2.max_target))) mark(battle, unit, a, 's2');
      } },
      skchr_tocka_3: {
        kind: 'duration', mods: { aspd: num(b3.attack_speed) },
        targeting: { maxTargets: num(b3['attack@max_target']) },
        attack: { dmgType: 'phys', atkScale: num(b3['attack@atk_scale']), onHitStatus: { key: 'stun', duration: num(b3['attack@stun']) } },
        onStart({ battle, unit }) {
          const action = nextWebAction(battle, unit);
          // SkillRuntime applies the native self ASPD buff before onStart. Rejected buffs do not count.
          if ((unit.findBuff(unit.skill._buffKey)?.mods?.aspd || 0) > 0) webGrantReceipt(battle, unit, unit, action);
          const existing = ops(battle).find((a) => a !== unit && inRange(unit, a) && a.mem['tocka:s3']?.owner === unit);
          if (existing) transfer(battle, unit, existing, action);
          else {
            const a = choices(battle, unit, 's3').sort((x, z) => ratio(z) - ratio(x) || x.id - z.id)[0];
            if (a) mark(battle, unit, a, 's3', action);
          }
        },
        onTick({ battle, unit, dt }) {
          const action = nextWebAction(battle, unit);
          for (const a of ops(battle)) if (a.mem['tocka:s3']?.owner === unit) grantWebSp(battle, unit, a, num(b3.bonus_sp) * dt, action);
        },
      },
    },
    install(b, u) {
      // This new branch attacks physically and can hit air; no foreign operator profile is borrowed.
      u.profile.dmgType = 'phys'; u.profile.canHitFly = true;
      const triggerS2 = (a) => {
        const held = a.mem['tocka:s2'];
        if (held?.owner !== u) return;
        delete a.mem['tocka:s2']; const action = held.fire();
        a.mem.tockaAutoUntil = b.time + num(b2.buff_duration);
        grantWebBuff(b, u, a, { key: `tocka:s2:aspd:${u.id}`, duration: num(b2.buff_duration), mods: { aspd: num(b2.attack_speed) } }, action);
        b.fx('arkOperatorFx', { x: a.x, y: a.y, id: u.id, target: a.id, effectId: `s2:${a.id}`, nativeKey: 'tocka_skill_02_buff_02', loop: true, dur: num(b2.buff_duration) });
      };
      // Observe the existing SP event before an instant attack can spend its newly filled charge.
      b.on('spGain', (c) => {
        const a = c.unit, rt = c.skill;
        if (!live(u) || a?.mem?.['tocka:s2']?.owner !== u || !a.canAct || a.s.flags.silence || rt.active || !(c.amount > 0)) return;
        if (rt.ready || rt.sp + c.amount >= rt.spCost - 1e-9) triggerS2(a);
      }, { owner: u, priority: -1000 });
      b.on('hit', (c) => {
        const held = c.target?.mem?.['tocka:s1'];
        if (!held || held.owner !== u || !live(u) || !c.dmg.isAttack || c.source?.side !== 'enemy') return;
        delete c.target.mem['tocka:s1']; const action = held.fire();
        b.fx('arkOperatorFx', { x: c.target.x, y: c.target.y, id: u.id, target: c.target.id, nativeKey: 'tocka_skill_01_buff_02_start_01' });
        const amount = u.s.atk * num(b1.shield_atk_scale), duration = num(b1.shield_time);
        const barrier = grantWebBuff(b, u, c.target, { key: `tocka:shield:${u.id}`, shield: amount, duration, interval: 0.1,
          onTick({ buff }) { buff.shield = Math.max(0, buff.shield - amount * 0.1 / duration); }, source: u, visible: true }, action);
        if (barrier) b.fx('shield', { x: c.target.x, y: c.target.y, id: c.target.id });
        if (live(c.source)) b.applyStatus(c.source, 'stun', { duration: num(b1.stun), source: u });
      }, { owner: u, priority: 50 });
      aura(b, u, () => {
        if (u.canAct && !u.s.flags.silence && u.skill?.ready && !u.skill.active && b.time >= u.skill.nextCastAt) {
          const kind = u.skill.id === 'skchr_tocka_1' ? 's1' : u.skill.id === 'skchr_tocka_2' ? 's2' : null;
          if (kind && choices(b, u, kind, kind === 's2').some((a) => kind !== 's2' || (a.skill && !a.skill.noSkill))) u.skill.activate('TOCKA_TARGET');
        }
        for (const a of ops(b)) {
          const held = a.mem['tocka:s2'];
          if (held?.owner === u && a.skill?.ready && !a.skill.active && a.canAct && !a.s.flags.silence) {
            triggerS2(a);
          }
          if (b.time < num(a.mem.tockaAutoUntil, -Infinity) && a.canAct && !a.s.flags.silence && a.skill?.ready && !a.skill.active && !a.skill.opCooling) a.skill.activate('TOCKA_AUTO');
        }
      });
      b.on('skillStart', ({ unit: a }) => {
        if (a !== u && a.mem?.['tocka:s3']?.owner === u && live(u)) transfer(b, u, a);
      }, { owner: u });
      b.on('beforeAttack', (c) => {
        if (c.attacker !== u || !u.mem.tockaSnow) return;
        u.mem.tockaSnow = false;
        // A normal profile is shared between attacks; detach the next base before modifying this shot.
        if (c.profile === u.profile) u.profile = { ...u.profile };
        c.profile.splashRadius = num(t1['attack@projectile_range']);
        const prev = c.profile.onEachHit;
        c.profile.onEachHit = (bb, attacker, target, hc) => {
          prev?.(bb, attacker, target, hc);
          if (!live(target)) return;
          const duration = num(t1['attack@t2_buff_duration']);
          bb.applyStatus(target, 'weaken', { duration, value: -num(t1['attack@t2_atk']), source: u });
          bb.addBuff(target, { key: `tocka:snow:${u.id}`, duration, interval: 1, source: u,
            onTick() { if (live(target)) bb.dealDamage(u, target, { amount: u.s.atk * num(t1['attack@t2_magic_atk_scale']), type: 'arts', isSkill: false, canDodge: false, tags: ['dot', 'tocka:snow'] }); } });
        };
      }, { owner: u });
      b.on('beforeUnitExit', ({ unit: a }) => {
        if (a === u) b.fx('arkOperatorFx', { id: u.id, action: 'clearOwner' });
        for (const x of b.allyUnits) for (const kind of ['s1', 's2', 's3']) if ((a === u && x.mem[`tocka:${kind}`]?.owner === u) || a === x) delete x.mem[`tocka:${kind}`];
      }, { owner: u });
    },
  };
} };
