// Owner-requested other leaders; never members of the scheduled raid boss pool.
import { T, hurt, areaAllies, castSlot } from './helpers.js';
import { reborn, skill, onHitStatus, ep, nthAttackPower } from './archetypes.js';
const present = u => u?.alive && u.deployed && !u.removed;

const winter = ab => [onHitStatus('cold', T(ab, 'attackfreeze.freeze') ?? 5),
  reborn({ dur: T(ab, 'reborn.duration') ?? 10, invincible: T(ab, 'reborn.reborn_invincible.duration') ?? 20,
    onReborn(b, e) { e.mem.winterPhase2 = true; b.addBuff(e, { key: 'winter:reborn', persist: true, mods: { atkPct: T(ab, 'reborn.atk') ?? .5 } }); } }),
  skill(ab.sk.IceBurst, (b, e) => {
    const s = ab.sk[e.mem.winterPhase2 ? 'IceBurst[Reborn]' : 'IceBurst'] || ab.sk.IceBurst;
    castSlot(b, e, s); b.fx('frostNova', { id: e.id, x: e.x, y: e.y, r: 2.5 });
    for (const target of areaAllies(b, e, e.x, e.y, 2.5)) {
      hurt(b, e, target, e.s.atk * (s?.bb.atk_scale ?? 1), 'arts');
      b.applyStatus(target, 'cold', { source: e, duration: s?.bb.freeze ?? 10 });
    }
  }, { cond: (b, e) => areaAllies(b, e, e.x, e.y, 2.5).length > 0 }),
];

const fortuna = ab => {
  const dress = (b, e) => {
    const m = e.mem.fortuna;
    b.removeBuff(e, 'fortuna:ammo'); e.profile.melee = m.ammo <= 0; e.profile.blockFree = m.ammo > 0;
    if (m.ammo > 0) b.addBuff(e, { key: 'fortuna:ammo', persist: true, mods: { aspd: T(ab, 'frtuna_fire_t.attack_speed') ?? 300 } });
    const list = b.allyUnits.filter(present).slice(); b.rng.shuffle(list); m.order = new Map(list.map((u, i) => [u.id, i]));
    e.profile.priority = u => m.order.get(u.id) ?? 999; e.markDirty();
  };
  return [{
    spawn(b, e) { e.mem.fortuna = { ammo: e.def.raw.spData?.initSp ?? 6, max: e.def.raw.spData?.maxSp ?? 6, check: b.time + (T(ab, 'Reload.interval') ?? 35), reload: 0, next: 0 }; dress(b, e); },
    before(_c, _b, e, a) { a.loaded = e.mem.fortuna.ammo > 0; },
    hitOut(c, b, _e, a) { if (a.loaded && c.dmg.isAttack) c.dmg.amount *= b.rng() < (T(ab, 'frtuna_fire_t.prob') ?? .7) ? 2 : 0; },
    attack(_c, b, e, a) { if (a.loaded) { e.mem.fortuna.ammo--; castSlot(b, e, ab.sk.Fire); dress(b, e); } },
    tick(b, e) {
      const m = e.mem.fortuna;
      if (m.reload > 0) {
        if (!e.canAct) { m.reload = 0; e.profile.noAttack = false; dress(b, e); return; }
        if (b.time + 1e-9 >= m.next) { m.next++; m.ammo = Math.min(m.max, m.ammo + 1); }
        if (b.time + 1e-9 >= m.reload) { m.reload = 0; e.profile.noAttack = false; dress(b, e); }
      } else if (b.time + 1e-9 >= m.check) {
        m.check += T(ab, 'Reload.interval') ?? 35;
        if (!m.ammo) { const duration = ab.sk.Charge?.bb.duration ?? 6; m.reload = b.time + duration; m.next = b.time + 1; e.profile.noAttack = true; castSlot(b, e, ab.sk.Charge, duration); }
      }
    },
  }];
};

const oren = ab => [{
  spawn(_b, e) { e.profile.melee = false; e.profile.priority = u => u.s.flags.disarm ? 1 : 0; },
  hitOut(c) { if (c.dmg.isAttack && !c.target?.s.flags.disarm) c.dmg.amount *= T(ab, 'shotbuff.attack@headshot_atk_scale') ?? 1.5; },
  dealt(c, b, e) { if (c.dmg.isAttack && present(c.target) && !c.target.s.flags.disarm) b.applyStatus(c.target, 'disarm', { source: e, duration: T(ab, 'shotbuff.attack@headshot_disarmed_duration') ?? 10 }); },
}];
// Native SP recovery is attack-based: three ordinary attacks, then one powered shot.
export const lazurite = ab => [ep('erosion', T(ab, 'EpDamage.attack@ep_damage_ratio') ?? .35),
  nthAttackPower((ab.sk.PowerAttack?.sp ?? 3) + 1, ab.sk.PowerAttack?.bb.atk_scale ?? 1.5, null, 0, ab.sk.PowerAttack)];
export const FACTION_LEADER_KITS = Object.freeze({ enemy_1510_frstar2: winter, enemy_1342_frtuna: fortuna, enemy_1219_mtrbty_2: oren,
  enemy_1182_flasrt_3: lazurite, enemy_1183_mlasrt_3: lazurite });
