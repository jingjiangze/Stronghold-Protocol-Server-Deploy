import { dminonRealmKeys, dminonRealmTileAllowed, retainDminonRealm } from '../../../dminonRealm20261101.js';
// 国度 char_4246_dminon. CN tables 63c7cec (2026-11-01), PRTS 国度.
// The owner-approved persistent realm shares native tiles; S3 start/end must not reset a saturated domain.
// [ASSUMED] simultaneous realm reactions use stable damage-event order; the per-source cooldown is global.
import { COLS } from '../../../constants.js';
import { bodyInKeys } from '../../../body.js';
import { num, live, skill, talent, talentValue, ground, aura, hit } from '../shared/ark-update-20261101.js';

export default { char_4246_dminon: (_bb, raw) => {
  const s1 = skill(raw, 'skchr_dminon_1'), s2 = skill(raw, 'skchr_dminon_2'), s3 = skill(raw, 'skchr_dminon_3');
  const b1 = s1?.bb ?? {}, b2 = s2?.bb ?? {}, b3 = s3?.bb ?? {}, t0 = talent(raw, 0), t1 = talent(raw, 1);
  const keyOf = (r, c) => r * COLS + c;
  const realm = (battleOfRealm, u) => {
    const m = u.mem;
    if (m.dminonCachedRange !== u.rangeKeys || m.dminonCachedRevision !== m.dminonRevision || m.dminonCachedGrid !== battleOfRealm.grid.version) {
      m.dminonCachedRange = u.rangeKeys; m.dminonCachedRevision = m.dminonRevision;
      m.dminonCachedGrid = battleOfRealm.grid.version;
      m.dminonCachedKeys = dminonRealmKeys(battleOfRealm, u);
    }
    return m.dminonCachedKeys;
  };
  const inside = (b, u, e) => bodyInKeys(e, realm(b, u));
  const foes = (b, u) => b.enemies.filter((e) => ground(e) && inside(b, u, e));
  return {
    skills: {
      skchr_dminon_1: {
        kind: 'duration', mods: { aspd: num(b1.attack_speed) },
        onStart({ unit }) { unit.mem.dminonEntered = new Set(); },
      },
      skchr_dminon_2: {
        kind: 'duration', mods: { atkPct: num(b2.atk) }, targeting: { rangeGrid: s2?.rangeGrid },
        onStart({ battle, unit, skill: rt }) {
          unit.mem.dminonS2 = (unit.mem.dminonS2 ?? 0) + 1;
          if (unit.mem.dminonS2 > 1) {
            rt.timeLeft = Infinity;
            battle.addBuff(unit, { key: 'dminon:s2:aspd', mods: { aspd: num(b2.attack_speed) } });
          }
        },
        onEnd({ battle, unit }) { battle.removeBuff(unit, 'dminon:s2:aspd'); },
      },
      skchr_dminon_3: {
        kind: 'duration', mods: { atkPct: num(b3.atk), aspd: num(b3.attack_speed) }, targeting: { rangeGrid: s3?.rangeGrid },
        onStart({ battle, unit }) { retainDminonRealm(battle, unit); unit.mem.dminonReactAt = -Infinity; },
        onEnd({ battle, unit }) { if (live(unit)) retainDminonRealm(battle, unit); },
      },
    },
    install(b, u) {
      const is = (id) => live(u) && u.skill?.active && u.skill.id === `skchr_dminon_${id}`;
      u.mem.dminonTiles ??= new Set(); u.mem.dminonRevision ??= 0;
      b.on('deploy', ({ unit: a }) => {
        if (a !== u) return;
        u.mem.dminonS2 = 0; retainDminonRealm(b, u); u.mem.dminonEntered = new Set();
      }, { owner: u });
      aura(b, u, () => {
        const all = foes(b, u), modSlow = talentValue(raw, 'move_speed');
        const keys = realm(b, u), shown = u.mem.dminonShown ??= new Set();
        for (const key of keys) if (!shown.has(key)) { shown.add(key); b.fx('arkOperatorFx', { x: key % COLS, y: Math.floor(key / COLS), id: u.id, effectId: `realm:${key}`, nativeKey: 'dminon_talent_range_01', loop: true, fixed: true }); }
        for (const key of shown) if (!keys.has(key)) { shown.delete(key); b.fx('arkOperatorFx', { id: u.id, effectId: `realm:${key}`, action: 'stop' }); }
        for (const e of all) {
          b.addBuff(e, { key: `dminon:realm:${u.id}`, duration: 0.15, mods: { aspd: num(t0.attack_speed) }, source: u });
          if (is(1) && !u.mem.dminonEntered.has(e)) { u.mem.dminonEntered.add(e); b.applyStatus(e, 'sluggish', { duration: num(b1.sluggish), source: u }); }
        }
        // AMB-X trait is the operator's range, not the remotely spread realm, and includes air.
        if (modSlow) for (const e of b.enemies) if (live(e) && bodyInKeys(e, u.rangeKeySet)) b.addBuff(e, { key: 'dminon:moduleSlow', duration: 0.15, mods: { moveMul: 1 + modSlow }, source: u });
      });
      aura(b, u, () => { for (const e of foes(b, u)) hit(b, u, e, num(t0.atk_scale), 'arts', ['dminon:realm']); }, 1);
      b.on('beforeAttack', (c) => {
        if (c.attacker === u && is(3)) c.targets = foes(b, u);
      }, { owner: u });
      b.on('hit', (c) => {
        if (is(2) && c.target.side === 'enemy' && ground(c.target) && inside(b, u, c.target) && ['phys', 'arts'].includes(c.dmg.type)) c.dmg.canDodge = false;
        if (!is(3) || !c.dmg.isAttack || !ground(c.source) || c.source.side !== 'enemy' || !inside(b, u, c.target) || b.time < u.mem.dminonReactAt - 1e-9) return;
        u.mem.dminonReactAt = b.time + num(b3['attack@cd']);
        const r = Math.round(c.source.y), col = Math.round(c.source.x);
        const spread = new Set();
        for (const [dr, dc] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]]) if (b.grid.groundPassable(r + dr, col + dc)) { const k = keyOf(r + dr, col + dc); spread.add(k); if (dminonRealmTileAllowed(b, u, r + dr, col + dc)) u.mem.dminonTiles.add(k); }
        u.mem.dminonRevision++;
        for (const e of b.enemies) if (ground(e) && bodyInKeys(e, spread)) hit(b, u, e, num(b3['attack@aoe_atk_scale']), 'phys', ['dminon:spread']);
      }, { owner: u, priority: -20 });
      const depart = ({ unit: a }) => {
        if (a !== u) return;
        for (const e of foes(b, u)) { hit(b, u, e, num(t1.atk_scale), 'arts', ['dminon:retreat']); if (e.alive) b.applyStatus(e, 'stun', { duration: num(t1.stun), source: u }); }
        u.mem.dminonTiles.clear(); u.mem.dminonRevision++; u.mem.dminonEntered.clear(); u.mem.dminonShown?.clear();
        b.fx('arkOperatorFx', { x: u.x, y: u.y, id: u.id, nativeKey: 'dminon_talent_hit_01' });
        b.fx('arkOperatorFx', { id: u.id, action: 'clearOwner' });
      };
      b.on('beforeUnitExit', depart, { owner: u });
    },
  };
} };
