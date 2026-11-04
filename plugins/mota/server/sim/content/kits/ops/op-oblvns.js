// 丰川祥子 (char_4182_oblvns), owned DIY exception approved by the maintainer.
// Official skill/talent/module BB: tools/data/sakiko-source.json. Native flight notes: PRTS 丰川祥子.
// [ASSUMED] Safe bounds: 192 live notes and 12s for untargeted notes. Tracking notes finish after caster exit.
import { num, talentBb, moduleOn, up, skillRec } from '../shared/tier1.js';
import { canTargetEnemy, sortEnemyTargets, tileKeyOf } from '../../../targeting.js';
import { dirVec } from '../../../dir.js';
import { hypot, atan2, sin, cos } from '../../../detmath.js';
const S1 = 'skchr_oblvns_1', S2 = 'skchr_oblvns_2', S3 = 'skchr_oblvns_3';
export const NOTE_LIMIT = 192, NOTE_LIFETIME = 12, FEVER_LIMIT = 450;
const PI = 3.141592653589793;
const bbOf = (chess, id) => skillRec(chess, id)?.bb || {};
const inRange = (u, x, y) => !!u.rangeKeySet?.has(tileKeyOf({ x, y }));
const valid = (u, e) => !!e && canTargetEnemy(u, e, { canHitFly: true });
// Native MovementSwitchControllerOblvns / AdvancedMovement from the installed
// client (public/assets/local/fx/index.json); PRTS 丰川祥子, 音符的移动逻辑.
// `turn` is a velocity blend per second, not an angular speed.
const MOTION = {
  normal: { tick: 0.4, delay: 0.1, free: 2, trace: 2, turn: 5 },
  empty: { tick: 0.4, delay: 0.1, free: 1.3, trace: 2, turn: 7, wave: true },
  s1: { tick: 0.2, delay: 0.6, free: 1.7, trace: 2.2, turn: 5 },
  piano: { tick: 0.2, delay: 0.4, free: 1.9, trace: 3.5, turn: 15, wave: true },
  organ: { tick: 0.4, delay: 0.4, free: 0.7, trace: 1, turn: 2.5, wave: true },
  s3: { tick: 0.4, delay: 0.8, free: 0.8, trace: 1.3, turn: 7.5, wave: true },
};
const distanceToSegment = (e, x0, y0, x1, y1) => {
  const dx = x1 - x0, dy = y1 - y0, den = dx * dx + dy * dy;
  const t = den > 0 ? Math.max(0, Math.min(1, ((e.x - x0) * dx + (e.y - y0) * dy) / den)) : 0;
  return hypot(e.x - x0 - t * dx, e.y - y0 - t * dy);
};
export default {
  char_4182_oblvns: (_bb, chess) => {
    const t1 = talentBb(chess), t2 = talentBb(chess, 1), b1 = bbOf(chess, S1), b2 = bbOf(chess, S2), b3 = bbOf(chess, S3);
    const selected = chess.skill?.skillId, mod = moduleOn(chess);
    const tone = (battle, unit) => {
      battle.removeBuff(unit, 'oblvns:tone');
      if (selected === S2) battle.addBuff(unit, { key: 'oblvns:tone', persist: true, allowDead: true,
        mods: unit.mem.oblvnsOrgan ? { aspd: num(b2['attack@attack_speed']) } : { atkPct: num(b2['attack@atk']) } });
      if (selected === S2) { unit.form = unit.mem.oblvnsOrgan ? 'oblvns_organ' : 'oblvns_piano'; battle.fx('phase', { x: unit.x, y: unit.y, id: unit.id, form: unit.form }); }
    };
    const targets = (battle, unit) => sortEnemyTargets(battle, unit, battle.enemies.filter(e => valid(unit, e) && inRange(unit, e.x, e.y)));
    const launch = (battle, unit, type, scale = 1, offset = 0, fever = true, pierce = false, projectile = null) => {
      const m = unit.mem.oblvns;
      if (!m || m.notes.length >= NOTE_LIMIT) return;
      const isS1 = !!projectile, isS3 = selected === S3 && unit.skill.active;
      const mode = isS1 ? 's1' : isS3 ? 's3' : selected === S2 ? type === 'arts' ? 'organ' : 'piano' : 'normal';
      const enemies = targets(battle, unit);
      if (isS3) enemies.sort((a, b) => (type === 'phys' ? b.s.res - a.s.res : b.s.def - a.s.def) || a.spawnSeq - b.spawnSeq);
      const target = enemies[0] || null;
      const motion = MOTION[mode === 'normal' && !target ? 'empty' : mode];
      const [dy, dx] = dirVec(unit.dir);
      const spread = isS1 ? 0 : battle.rng.range(-num(t1['attack@angle'], 20), num(t1['attack@angle'], 20)) * PI / 180;
      const angle = atan2(dy, dx) + offset + spread;
      // The module removes the ranged penalty from stage 2, not stage 1.
      const moduleRanged = mod && /不再降低攻击力/.test(t1.desc || chess.talents?.[0]?.desc || '');
      const penalty = unit.blocking.length || moduleRanged && (unit.skill.active || isS1) ? 1 : num(chess.trait?.bb?.atk_scale, 0.8);
      const n = { x: unit.x, y: unit.y, angle, origin: angle, age: 0, outside: 0, target, seen: new Set(),
        amount: unit.s.atk * unit.s.atkScaleMul * scale * penalty,
        type, scale, fever, pierce, mode, isSkill: isS1 || isS3 || selected === S2, motion, state: 'free', control: 0,
        freeAge: 0, freeX: unit.x, freeY: unit.y, wave: battle.rng() < 0.5 ? -1 : 1,
        pass: 0, seq: ++m.seq,
        projectile: projectile || (selected === S2 ? `projectile_chr_oblvns_s2${type === 'arts' ? '_slow' : ''}${target ? '' : '_t'}`
          : isS3 ? `projectile_chr_oblvns_s3_${type === 'arts' ? 'mag' : 'phy'}` : `projectile_chr_oblvns${target ? '' : '_talent'}`) };
      m.notes.push(n);
      battle.fx('musicNote', { x: n.x, y: n.y, id: unit.id, kind: n.type, note: n.seq,
        projectile: n.projectile, angle: n.angle, phase: 'spawn', mode: n.mode, skill: selected });
    };
    const feverStart = (battle, unit) => {
      const m = unit.mem.oblvns;
      if (m.fever > 0 || m.gauge < FEVER_LIMIT) return;
      m.fever = 20; m.gauge = 0;
      battle.fx('sonic', { x: unit.x, y: unit.y, id: unit.id, skill: 'oblvns:fever' });
    };
    const expire = (battle, unit, n, reason) => battle.fx('musicNote', { x: n.x, y: n.y, id: unit.id, note: n.seq, phase: 'end', reason });
    const clear = (battle, unit) => { if (unit.mem.oblvns) { for (const n of unit.mem.oblvns.notes) expire(battle, unit, n, 'caster'); unit.mem.oblvns.notes = []; unit.mem.oblvns.fever = 0; } };
    return {
      trait: { noAttack: true, canHitFly: true },
      skills: {
        [S1]: { kind: 'charges', charges: 2, trigger: 'MANUAL', onStart({ battle, unit, reason }) {
          // Native fan: total angle BB/4 per note, 13.125 degrees either side at BB=15.
          for (let i = 0; i < 8; i++) launch(battle, unit, 'arts', num(b1[i ? `atk_scale_${i + 1}` : 'atk_scale'], 0.04), (i - 3.5) * num(b1.angle, 15) * PI / 720, true, false, `projectile_chr_oblvns_s1_${i + 1}`);
          if (reason !== 'full-charge') feverStart(battle, unit);
        } },
        [S2]: { kind: 'instant', trigger: 'MANUAL', onStart({ battle, unit }) { unit.mem.oblvnsOrgan = !unit.mem.oblvnsOrgan; tone(battle, unit); feverStart(battle, unit); } },
        [S3]: { kind: 'duration', trigger: 'MANUAL', targeting: { rangeGrid: skillRec(chess, S3)?.rangeGrid },
          onTick({ unit, skill, dt }) { if (unit.mem.oblvns?.fever > 0) skill.timeLeft += dt; },
          onStart({ battle, unit }) { feverStart(battle, unit); } },
      },
      install(battle, unit) {
        // One bounded note runner per caster, separate from the unit's hooks so
        // a permanently withdrawn caster's already-tracking projectiles can finish.
        const noteOwner = { side: unit.side, ownerId: unit.ownerId, mods: unit.mods };
        const advance = dt => {
          const m = unit.mem.oblvns;
          m.draw -= dt;
          const keep = [];
          let live = m.notes.length;
          for (const n of m.notes) {
            n.age += dt;
            // A target leaving the caster's range is still a valid homing target.
            // Losing it resumes free movement from HERE, rather than turning back
            // toward the launch direction or selecting any enemy across the board.
            if (n.state !== 'pass' && !valid(unit, n.target)) {
              n.target = null;
              if (n.state === 'trace') { n.state = 'free'; n.origin = n.angle; n.freeX = n.x; n.freeY = n.y; n.freeAge = 0; }
            }
            if (n.detached && n.state !== 'trace') { expire(battle, unit, n, 'caster'); live--; continue; }
            n.outside = inRange(unit, n.x, n.y) || n.target ? 0 : n.outside + dt;
            if ((!n.target && n.age >= NOTE_LIFETIME) || n.outside + 1e-9 >= num(t1.delay, 1) || n.state === 'pass' && (n.pass -= dt) <= 1e-9) {
              expire(battle, unit, n, 'expired'); live--; continue;
            }
            n.freeAge += dt; n.control -= dt;
            if (n.state === 'free' && n.control <= 1e-9) {
              n.control += n.motion.tick;
              if (!n.target) {
                const candidates = battle.enemies.filter(e => valid(unit, e) && !n.seen.has(e.id) && hypot(e.x - n.x, e.y - n.y) <= 1);
                candidates.sort((a, b) => hypot(a.x - n.x, a.y - n.y) - hypot(b.x - n.x, b.y - n.y) || a.spawnSeq - b.spawnSeq);
                n.target = candidates[0] || null;
              }
              if (n.target && n.age + 1e-9 >= n.motion.delay) n.state = 'trace';
            }
            const x0 = n.x, y0 = n.y;
            if (n.state === 'trace') {
              const dist = hypot(n.target.x - n.x, n.target.y - n.y);
              const blend = Math.min(1, n.motion.turn * dt);
              const dx = cos(n.angle) * (1 - blend) + (dist ? (n.target.x - n.x) / dist : 0) * blend;
              const dy = sin(n.angle) * (1 - blend) + (dist ? (n.target.y - n.y) / dist : 0) * blend;
              n.angle = atan2(dy, dx);
              n.x += cos(n.angle) * n.motion.trace * dt; n.y += sin(n.angle) * n.motion.trace * dt;
            } else if (n.state === 'free' && n.motion.wave) {
              const along = n.freeAge * n.motion.free;
              const wave = sin(along) * 0.3 * Math.min(3, 1 + Math.floor(along / (2 * PI))) * n.wave;
              n.x = n.freeX + cos(n.origin) * along - sin(n.origin) * wave;
              n.y = n.freeY + sin(n.origin) * along + cos(n.origin) * wave;
              n.angle = atan2(n.y - y0, n.x - x0);
            } else {
              const speed = n.state === 'pass' ? 3 : n.motion.free;
              n.x += cos(n.angle) * speed * dt; n.y += sin(n.angle) * speed * dt;
            }
            let hit = false;
            const collisions = n.state === 'pass' ? battle.enemies.filter(e => valid(unit, e)) : n.state === 'trace' ? [n.target] : [];
            collisions.sort((a, b) => hypot(a.x - x0, a.y - y0) - hypot(b.x - x0, b.y - y0) || a.spawnSeq - b.spawnSeq);
            for (const e of collisions) {
              if (!e.alive || n.seen.has(e.id) || distanceToSegment(e, x0, y0, n.x, n.y) > 0.3) continue;
              n.seen.add(e.id); hit = true;
              battle.dealDamage(unit, e, { amount: n.amount, type: n.type,
                isSkill: n.isSkill, tags: ['oblvns:note'], defIgnorePct: Math.min(1, Math.min(live, num(t1.max_cnt, 10)) * num(t1.def_penetrate_ratio)),
                resIgnorePct: Math.min(1, Math.min(live, num(t1.max_cnt, 10)) * num(t1.magic_resist_penetrate_ratio)) });
              battle.fx('musicNote', { x: e.x, y: e.y, id: unit.id, target: e.id, kind: n.type, note: n.seq,
                projectile: n.projectile, angle: n.angle, phase: 'hit', pierce: n.pierce, mode: n.mode, skill: selected, detached: !!n.detached });
              if (up(unit) && n.fever && m.fever <= 0) m.gauge = Math.min(FEVER_LIMIT, m.gauge + num(t2.cnt, 3));
              if (!n.pierce) break;
              if (n.state !== 'pass') { n.pass = num(b2['attack@passby_delay'], 0.5); n.state = 'pass'; n.target = null; }
            }
            if (hit && !n.pierce) { live--; continue; }
            if (m.draw <= 0) battle.fx('musicNote', { x: n.x, y: n.y, id: unit.id, kind: n.type, note: n.seq,
              projectile: n.projectile, angle: n.angle, skill: selected, detached: !!n.detached });
            keep.push(n);
          }
          m.notes = keep;
          if (m.draw <= 0) m.draw = 0.1;
        };
        const exit = () => {
          const m = unit.mem.oblvns, keep = [];
          if (!m) return;
          m.fever = 0;
          for (const n of m.notes) {
            if (n.state === 'trace' && valid(unit, n.target)) {
              n.detached = true; keep.push(n);
              battle.fx('musicNote', { x: n.x, y: n.y, id: unit.id, kind: n.type, note: n.seq,
                projectile: n.projectile, angle: n.angle, phase: 'detach', detached: true, skill: selected });
            } else expire(battle, unit, n, 'caster');
          }
          m.notes = keep;
        };
        const reset = () => { const gauge = unit.mem.oblvns?.gauge || 0, seq = unit.mem.oblvns?.seq || 0;
          const notes = unit.mem.oblvns?.notes.filter(n => n.detached) || [];
          unit.mem.oblvns = { notes, seq, cd: 0, draw: 0, aura: 0, gauge, fever: 0, feverCd: 0, deferredDeath: false };
          unit.mem.oblvnsOrgan = false; tone(battle, unit); };
        reset();
        battle.on('deploy', c => { if (c.unit === unit && !c.move) reset(); }, { owner: unit });
        battle.on('death', c => { if (c.unit === unit) exit(); }, { owner: unit });
        battle.on('battleEnd', () => { clear(battle, unit); battle.offOwner(noteOwner); }, { owner: noteOwner });
        battle.on('kill', ({ victim }) => { if (victim === unit && selected === S3 && unit.skill.active && unit.mem.oblvns?.fever > 0) { unit.hp = 1; unit.mem.oblvns.deferredDeath = true; } }, { owner: unit });
        battle.on('tick', ({ dt }) => {
          const m = unit.mem.oblvns;
          if (!up(unit)) return;
          const feverWasActive = m.fever > 0;
          m.fever = Math.max(0, m.fever - dt); m.cd -= dt; m.aura -= dt; m.feverCd -= dt;
          if (feverWasActive && m.fever <= 0 && m.deferredDeath) { battle.retreat(unit, { reason: 'oblvns:fever-end', dying: true }); return; }
          const enemies = targets(battle, unit);
          const actionable = !unit.hidden && !unit.s.flags.stun && !unit.s.flags.frozen && !unit.s.flags.sleep && !unit.s.flags.noAttack;
          if (actionable && m.fever > 0 && selected === S1 && m.feverCd <= 0) {
            m.feverCd = Math.max(0.1, unit.s.interval);
            unit.skill.activate('fever', { free: true });
          }
          if (actionable && unit.skill.ready && !unit.skill.active && !unit.skill.opCooling) {
            if (selected === S1 && (enemies.length || unit.skill.charges >= 2)) unit.skill.activate(enemies.length ? 'enemy' : 'full-charge');
            else if (selected === S3 && enemies.length) unit.skill.activate('enemy');
            else if (selected === S2 && enemies.length) {
              // [ASSUMED] Automatic operations choose the better tone; manual activation always switches it.
              const target = enemies[0], wantOrgan = target.s.def > unit.s.atk * Math.max(0.2, target.s.res / 100);
              if (wantOrgan !== unit.mem.oblvnsOrgan || m.gauge >= FEVER_LIMIT) unit.skill.activate('tone');
            }
          }
          if (actionable && m.cd <= 1e-9) {
            m.cd += Math.max(0.1, unit.s.interval);
            const skill3 = selected === S3 && unit.skill.active;
            if (skill3) for (let i = 0; i < 2; i++) { launch(battle, unit, 'phys', num(b3['attack@atk_scale'], 1.8), (i ? 1 : -1) * 0.15); launch(battle, unit, 'arts', num(b3['attack@atk_scale'], 1.8), (i ? 1 : -1) * 0.25); }
            else for (let i = 0; i < (selected === S2 && m.fever > 0 ? 2 : 1); i++) launch(battle, unit, selected === S2 && unit.mem.oblvnsOrgan ? 'arts' : 'phys', 1, i * 0.12, true, selected === S2 && !unit.mem.oblvnsOrgan);
            battle._ev(['atk', unit.id, enemies[0]?.id ?? unit.id, 'none']);
            battle.emit('attack', { attacker: unit, targets: enemies.slice(0, 1), isSkill: skill3 });
            unit.skill.onAttackPerformed(enemies.slice(0, 1), skill3);
          }
          if (m.aura <= 0) {
            m.aura = 0.2;
            for (const ally of battle.allyUnits) {
              if (!up(ally) || ally.ownerId !== unit.ownerId) continue;
              const key = `oblvns:aura:${unit.id}`;
              battle.removeBuff(ally, key);
              if (inRange(unit, ally.x, ally.y) && num(t2.attack_speed) > 0) battle.addBuff(ally, { key, duration: 0.3, mods: { aspd: num(t2.attack_speed) } });
            }
          }
        }, { owner: unit });
        battle.on('tick', ({ dt }) => {
          advance(dt);
          if (unit.removed && !unit.mem.oblvns.notes.length) battle.offOwner(noteOwner);
        }, { owner: noteOwner });
      },
    };
  },
};
