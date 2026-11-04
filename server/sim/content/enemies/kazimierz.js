// Native knight abilities; fog-of-war devices are absent on Stronghold boards.
import { T, targetsNear, watchDeaths } from './helpers.js';
import { reborn, skill } from './archetypes.js';
import { lazurite } from './faction-leaders.js';

const gale = ab => [{ spawn(b, e) {
  b.addBuff(e, { key: 'kazimierz:gale', duration: T(ab, 'buff.duration') ?? 30,
    mods: { defFlat: T(ab, 'buff.def') ?? 3000, resFlat: T(ab, 'buff.magic_resistance') ?? 95 }, visible: true });
} }];
const sanguine = ab => [{
  spawn(b, e) { watchDeaths(b, e); },
  otherDeath(c, b, e) {
    if (c.reason !== 'killed' || !c.unit || c.unit === e || c.unit.kind !== 'enemy') return;
    b.addBuff(e, { key: 'kazimierz:sanguine', persist: true, refresh: 'stack', maxStacks: T(ab, 'enhance.max_stack_cnt') ?? 10,
      mods: { atkPct: T(ab, 'enhance.atk') ?? .1, aspd: T(ab, 'enhance.attack_speed') ?? 5 }, visible: true });
  },
}];
const shield = ab => [reborn({ dur: T(ab, 'reborn.duration') ?? 5 }),
  skill(ab.sk.AtkDesWeaken, (b, e) => {
    const target = targetsNear(b, e, 99).sort((a, z) => z.s.atk - a.s.atk || a.id - z.id)[0];
    if (target) b.addBuff(target, { key: `kazimierz:weaken:${e.id}`, duration: ab.sk.AtkDesWeaken?.bb.duration ?? 25,
      mods: { atkPct: ab.sk.AtkDesWeaken?.bb.atk ?? -.5 }, visible: true });
  }, { sil: true, cond: (b, e) => targetsNear(b, e, 99).length > 0 })];

export const KAZIMIERZ_KITS = Object.freeze({
  enemy_1101_plkght: gale, enemy_1101_plkght_2: gale,
  enemy_1103_wdkght: sanguine, enemy_1103_wdkght_2: sanguine,
  enemy_1104_lfkght: shield, enemy_1104_lfkght_2: shield,
  enemy_1182_flasrt: lazurite, enemy_1182_flasrt_2: lazurite,
});
