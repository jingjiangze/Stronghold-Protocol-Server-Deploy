// Horn004 web port. Official battle_equip_table phases 1–3, pinned 63c7cec, plus owner's 2026-11-01 approval.
// The original 军事要塞 aura stays in the Horn kit, once. These are ONLY the module's extra blackboards.
// [ASSUMED until native equip prefab arrives] SP budget resets on a real Horn deployment; opening occupants count
// once, independent of automatic initial deploy order. Move/relocate never resets or grants SP (explicit owner rule).
import { hornWebModuleActive } from '../../../../../shared/hornWebModule20261101.js';
import { dirVec } from '../../../dir.js';
import { COLS } from '../../../constants.js';
import { AURA_IV, AURA_DUR, isOp } from './tier5.js';

export function installHornWebModule20261101(b, u, raw) {
  if (!hornWebModuleActive(raw)) return;
  const bb = Object.assign({}, ...(raw.talents ?? []).filter((t) => t.index === -1).map((t) => t.bb));
  const atk = bb.atk ?? 0, hp = bb.max_hp ?? 0, extend = bb.ability_range_forward_extend ?? 0;
  const per = bb.sp ?? 0, cap = bb.sp_max ?? 0;
  const state = { spGiven: 0, credited: new Map(), count: -1 };
  const live = () => u.alive && u.deployed && !u.hidden;
  const front = () => {
    const [dr, dc] = dirVec(u.dir), out = [];
    for (let i = 1; i <= 2; i++) {
      const r = u.tileR + dr * i, c = u.tileC + dc * i;
      if (!b.grid.inRect(r, c)) continue;
      const a = b._occ[r * COLS + c];
      if (a && a !== u && a.side === 'ally' && a.alive && a.deployed && !a.hidden) out.push(a);
    }
    return out;
  };
  const refreshFront = () => {
    if (!live() || !(extend > 0)) return;
    const count = front().length;
    if (count === state.count) return;
    state.count = count;
    if (count) b.addBuff(u, { key: 'horn:004:web:front', persist: true, mods: { rangeExtend: extend * count, maxTargets: count } });
    else b.removeBuff(u, 'horn:004:web:front');
    // Fortress melee selection always returns one target before targetCount; the extra targets are ranged only.
    b._refreshRange(u);
  };
  const credit = (a) => {
    if (!live() || !(per > 0 && cap > state.spGiven) || !u.skill || !front().includes(a)) return;
    if (state.credited.get(a.id) === a.deploySeq) return;
    state.credited.set(a.id, a.deploySeq);
    const amount = Math.min(per, cap - state.spGiven);
    state.spGiven += amount; // spent trigger allowance; no refund/retry if skill SP recovery is locked
    u.skill.gainSp(amount, 'talent');
  };
  b.on('deploy', (c) => {
    if (c.unit === u) {
      if (!c.move) { state.spGiven = 0; state.credited.clear(); state.count = -1; }
      refreshFront();
      if (!c.move) for (const a of front()) credit(a);
    } else if (c.unit?.side === 'ally') {
      refreshFront();
      if (!c.move) credit(c.unit);
    }
  }, { owner: u });
  b.on('beforeUnitExit', ({ unit }) => {
    if (unit !== u) return;
    state.credited.clear(); state.count = -1;
    for (const a of b.allyUnits) if (a.findBuff('horn:004:web:aura')?.source === u) b.removeBuff(a, 'horn:004:web:aura');
    b.removeBuff(u, 'horn:004:web:front');
  }, { owner: u });
  b.on('death', ({ unit }) => { if (unit?.side === 'ally') refreshFront(); }, { owner: u });
  b.on('relocate', ({ unit }) => { if (unit?.side === 'ally') refreshFront(); }, { owner: u });
  // Two occupancy reads handle movement without scanning the whole field or creating per-attack listeners.
  b.every(0.2, refreshFront, { owner: u });
  if (atk || hp) b.every(AURA_IV, () => {
    if (!live()) return;
    for (const a of b.allies()) if (isOp(a) && a.def?.profession === 'TANK') {
      const old = a.findBuff('horn:004:web:aura');
      if ((old?.mods?.atkPct ?? 0) > atk && old.source?.alive && old.source.deployed) continue;
      b.addBuff(a, { key: 'horn:004:web:aura', duration: AURA_DUR, mods: { atkPct: atk, hpPct: hp }, source: u });
    }
  }, { owner: u });
}
