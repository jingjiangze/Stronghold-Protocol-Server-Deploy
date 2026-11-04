import { dminonRealmKeys, dminonRealmTileAllowed, dminonRealmSeedAllowed } from '../../dminonRealm20261101.js';
// Four custom web traits; no native kit/profession is replaced. Deterministic and browser-safe.
import * as S from '../support/index.js';
import { COLS } from '../../constants.js';
import { bodyInKeys, bodyKeys } from '../../body.js';
import { layerGainRoom } from '../../../../shared/constants.js';
import { WEB_TRAITS, WEB_BONDS, emptyWebRound, webClone, webInstanceKey, encodeWebCells, decodeWebCells } from '../../../../shared/arkWebTraits20261101.js';

const live = (u) => !!(u?.alive && u.deployed && !u.hidden && !u.removed);
const trait = (u) => S.isOp(u) && u.side === 'ally' ? WEB_TRAITS[u.def?.charId] : null;
const keyOf = (u) => webInstanceKey(u.def.charId, u.uid, S.isElite(u));
function state(b, u) { return b.getPlayer(u.ownerId)?.webTraits; }
function progress(b, u) {
  const st = state(b, u);
  if (!st || u.uid == null) return null;
  return st.progress[keyOf(u)] ??= { attacks: 0, action: 0, realmTicks: 0, cells: '' };
}
function capOpts(b, ps) {
  const a = b.data?.contractLayerCap?.cap, c = ps.input?.contractLayerCap?.cap;
  const cap = a == null ? c : c == null ? a : Math.min(a, c);
  return cap == null ? null : { cap, capAbove: cap };
}

function grant(b, u, n) {
  const tr = trait(u), ps = b.getPlayer(u.ownerId), st = ps?.webTraits;
  if (!b.flags.layerGainsEnabled || !tr?.bond || !st || !ps.bonds[tr.bond] || !(n > 0)) return;
  if (tr.key === 'tocka' && S.isElite(u)) st.tockaCap = 25;
  const cap = tr.key === 'tocka' ? st.tockaCap : tr.cap;
  const want = Math.min(n, Math.max(0, cap - st.used[tr.key]));
  const permanent = want > 0 ? b.addLayers(u.ownerId, tr.bond, want, 'webTrait', { source: u, webTrait: true, maxAmount: want }) : 0;
  st.used[tr.key] += permanent;
  ps.webTraitGains[tr.key] += permanent;
  if (permanent < want) return; // rejection/reduction is not source-quota overflow
  const bond = ps.bonds[tr.bond];
  if (!bond) return;
  // Only the source-quota overflow is temporary. A rejected/capped permanent grant is never converted.
  const temporary = layerGainRoom(bond.layers || 0, Math.max(0, n - want), capOpts(b, ps));
  if (!(temporary > 0)) return;
  st.temporary[tr.bond] = (st.temporary[tr.bond] || 0) + temporary;
  bond.layers = (bond.layers || 0) + temporary;
  // Same refresh bus as permanent gains, a distinct reason, no recursive native garrison award.
  b.emit('layerGain', { playerId: u.ownerId, bondId: tr.bond, n: temporary, source: u, reason: 'webTemporary', temporary: true, tile: b._sourceTile(u) });
}

/** A source-scoped native cast/talent action. An aura-maintenance loop must never call this. */
export function nextWebAction(b, source) {
  if (source?.def?.charId !== 'char_4244_tocka') return null;
  const p = progress(b, source);
  return p ? ++p.action : null;
}
/** Successful compound package: source + action + target once. Self follows the native beneficiary list. */
export function webGrantReceipt(b, source, target, action) {
  if (!live(source) || source.def?.charId !== 'char_4244_tocka' || !S.isOp(target) || target.side !== 'ally' || !live(target) || !Number.isInteger(action)) return;
  const p = progress(b, source);
  if (!p) return;
  // Only current actions need receipts. Native synchronous nested grants can retain a few earlier actions.
  const store = source.mem.webGrantReceipts ??= new Map();
  let seen = store.get(action);
  if (!seen) { seen = new Set(); store.set(action, seen); }
  if (seen.has(target.id)) return;
  seen.add(target.id);
  for (const old of store.keys()) if (old < action - 64) store.delete(old);
  grant(b, source, 1);
}
/** Caller declares a genuinely positive native buff action, after addBuff has accepted it. */
export function grantWebBuff(b, source, target, spec, action) {
  const old = target?.findBuff(spec.key), before = old ? { shield: old.shield || 0, shieldHits: old.shieldHits || 0, time: old.timeLeft, mods: { ...old.mods }, stacks: old.stacks } : null;
  const added = b.addBuff(target, { ...spec, source });
  if (!added || spec.refresh === 'keep' && old) return added;
  const positive = (added.shield || 0) > 0 || (added.shieldHits || 0) > 0 || Object.entries(added.mods || {}).some(([k, v]) => Number.isFinite(v) && (k.endsWith('Mul') ? v > 1 : v > 0));
  // New action + real duration renewal is a recast. Plain TTL maintenance never receives an action id.
  const changed = !before || added.shield > before.shield || added.shieldHits > before.shieldHits || added.stacks > before.stacks || added.timeLeft > before.time + 1e-9 || Object.entries(added.mods || {}).some(([k, v]) => v > (before.mods[k] ?? (k.endsWith('Mul') ? 1 : 0)));
  if (positive && changed) webGrantReceipt(b, source, target, action);
  return added;
}
export function grantWebSp(b, source, target, amount, action) {
  const rt = target?.skill, before = rt?.spTotal || 0;
  const n = rt?.gainSp(amount, 'talent') || 0;
  if (n > 0 && rt.spTotal > before + 1e-9) webGrantReceipt(b, source, target, action);
  return n;
}
/** Preserve native decaying buff timer and count only its first actual application, never maintenance. */
export function grantWebDecay(b, source, target, key, duration, mods, action, decay) {
  const before = target.findBuff(key), old = before ? { time: before.timeLeft, mods: { ...before.mods } } : null;
  const timer = decay(b, target, key, duration, mods);
  const after = target.findBuff(key);
  if (after && (!old || after.timeLeft > old.time + 1e-9 || Object.entries(after.mods || {}).some(([k, v]) => v > (old.mods[k] || 0)))) webGrantReceipt(b, source, target, action);
  return timer;
}

function origin(source) {
  const seen = new Set();
  while (source && !seen.has(source)) {
    seen.add(source);
    if (source.kind === 'op' && source.def?.charId === 'char_4247_oxi') return source;
    source = source.ownerUnit;
  }
  return null;
}
function realmKeys(b, u) { return dminonRealmKeys(b, u); }
function legal(b, u, r, c) { return dminonRealmTileAllowed(b, u, r, c); }
function spreadRealm(b, u) {
  const keys = realmKeys(b, u), frontier = new Set();
  for (const k of keys) {
    const r = Math.floor(k / COLS), c = k % COLS;
    for (const [dr, dc] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const rr = r + dr, cc = c + dc, next = rr * COLS + cc;
      if (!keys.has(next) && legal(b, u, rr, cc)) frontier.add(next);
    }
  }
  if (!frontier.size) return; // saturated: retain the same realm, no reset/reseed/cycle
  // Once per fifteen-second expansion, find shortest legal paths toward still-uncovered allied operators.
  // Multi-source BFS is bounded by this Battle's grid; no per-frame map scan or same-tick chaining.
  const distance = new Map(), queue = [];
  for (const a of b.allyUnits) if (S.isOp(a) && a.side === 'ally' && live(a) && !bodyInKeys(a, keys)) {
    for (const k of bodyKeys(a)) if (!keys.has(k) && !distance.has(k) && legal(b, u, Math.floor(k / COLS), k % COLS)) { distance.set(k, 0); queue.push(k); }
  }
  const limit = (b.rect.r1 - b.rect.r0 + 1) * (b.rect.c1 - b.rect.c0 + 1);
  for (let head = 0; head < queue.length && head < limit; head++) {
    const k = queue[head], r = Math.floor(k / COLS), c = k % COLS;
    for (const [dr, dc] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const rr = r + dr, cc = c + dc, next = rr * COLS + cc;
      if (!distance.has(next) && legal(b, u, rr, cc)) { distance.set(next, distance.get(k) + 1); queue.push(next); }
    }
  }
  const order = [...frontier].sort((a, z) => { const da = distance.get(a) ?? Infinity, dz = distance.get(z) ?? Infinity; return da === dz ? a - z : da - dz; });
  for (const k of order.slice(0, S.isElite(u) ? 2 : 1)) u.mem.dminonTiles.add(k);
  u.mem.dminonRevision++;
}

export function installWebTraits(b) {
  const holders = b.allyUnits.filter((u) => trait(u) && Number.isInteger(u.uid));
  for (const ps of b.players) {
    if (!holders.some((u) => u.ownerId === ps.playerId) && !ps.input.webTraits) continue;
    const seed = ps.input.webTraits;
    ps.webTraits = (seed?.v === 1 || seed?.v === 2) && seed.round === b.round ? webClone(seed) : emptyWebRound(b.round);
    ps.webTraits.v = 2;
    ps.webTraits.burnProgress ??= { normal: 0, elite: 0 };
    ps.webTraitGains = { alga: 0, oxi: 0, tocka: 0 };
  }
  if (!holders.length) return;
  const restored = new Set();
  b.on('deploy', ({ unit: u }) => {
    const tr = trait(u), p = tr && progress(b, u);
    if (!p) return;
    if (tr.key === 'tocka' && S.isElite(u)) state(b, u).tockaCap = 25;
    if (tr.key !== 'dminon' || restored.has(u)) return;
    restored.add(u);
    // Native deploy reset ran first. Carry only actual expansion cells, transformed to this field's coordinates.
    for (const [dr, dc] of decodeWebCells(p.cells)) if (dminonRealmSeedAllowed(b, u, u.tileR + dr, u.tileC + dc)) u.mem.dminonTiles.add((u.tileR + dr) * COLS + u.tileC + dc);
    u.mem.dminonRevision++;
  }, { priority: -100 });
  const attackReceipts = new WeakSet();
  b.on('attack', ({ attacker: u, action }) => {
    if (!live(u) || u.def?.charId !== 'char_4245_alga') return;
    if (!action || action.unit !== u || attackReceipts.has(action)) return;
    attackReceipts.add(action);
    const p = progress(b, u);
    const tr = WEB_TRAITS.char_4245_alga;
    if (p && ++p.attacks >= (S.isElite(u) ? tr.eliteAttacks : tr.attacks)) { p.attacks = 0; grant(b, u, tr.gain); }
  });
  const elementReceipts = new WeakSet();
  b.on('elementContribution', (receipt) => {
    const { source, target, element, effective, threshold } = receipt;
    if (element !== 'burn' || target?.side !== 'enemy' || !(effective > 0) || !(threshold > 0)
      || !Number.isFinite(effective) || !Number.isFinite(threshold) || !b.flags.layerGainsEnabled || elementReceipts.has(receipt)) return;
    const u = origin(source), st = u && state(b, u);
    if (!st || !b.getPlayer(u.ownerId)?.bonds.arcaneShip) return;
    elementReceipts.add(receipt);
    const grade = S.isElite(u) ? 'elite' : 'normal', tr = WEB_TRAITS.char_4247_oxi;
    const total = st.burnProgress[grade] + Math.min(effective, threshold) / threshold;
    const completed = Math.floor(total + 1e-10);
    st.burnProgress[grade] = Math.max(0, total - completed);
    if (completed) grant(b, u, completed * (S.isElite(u) ? tr.eliteContributionGain : tr.contributionGain));
  });
  b.on('elementBurst', ({ source, target, element }) => {
    if (element !== 'burn' || target?.side !== 'enemy') return;
    const u = origin(source);
    // A released projectile can cause its owner's burst after that owner exits; preserve native attribution.
    if (u && state(b, u)) { const tr = WEB_TRAITS.char_4247_oxi; grant(b, u, S.isElite(u) ? tr.eliteBurstGain : tr.burstGain); }
  });
  const realmIntervalTicks = Math.round(WEB_TRAITS.char_4246_dminon.interval / b.dt);
  b.on('tick', () => {
    for (const u of holders) {
      if (u.def.charId !== 'char_4246_dminon' || !live(u)) continue;
      const p = progress(b, u);
      if (++p.realmTicks >= realmIntervalTicks) { p.realmTicks -= realmIntervalTicks; spreadRealm(b, u); }
    }
  });
}

export function webTraitResult(b, ps) {
  if (!ps.webTraits) return null;
  const realms = [];
  for (const u of ps.units) {
    if (u.def?.charId !== 'char_4246_dminon' || u.kind !== 'op' || !Number.isInteger(u.uid)) continue;
    const p = progress(b, u);
    p.cells = live(u) ? encodeWebCells([...(u.mem.dminonTiles || [])].sort((a, z) => a - z).map((k) => [Math.floor(k / COLS) - u.tileR, k % COLS - u.tileC])) : '';
    const keys = realmKeys(b, u), targets = [];
    if (live(u)) for (const a of b.allyUnits) if (S.isOp(a) && a.side === 'ally' && live(a) && Number.isInteger(a.uid) && bodyInKeys(a, keys)) targets.push({ playerIndex: b.players.findIndex((p) => p.playerId === a.ownerId), uid: a.uid, bonds: [...S.unitBonds(a)] });
    realms.push({ uid: u.uid, elite: S.isElite(u), targets });
  }
  // One witness for each actually covered recipient/bond at the highest grade among this owner's domains.
  // Every source still has a row (possibly empty), so a later snapshot clears a retired domain exactly.
  const witnesses = new Map();
  for (const row of realms) for (const a of row.targets) for (const id of a.bonds) {
    const key = `${a.playerIndex}:${id}`, old = witnesses.get(key);
    if (!old || row.elite && !old.row.elite) witnesses.set(key, { row, target: a });
  }
  const picked = new Map(realms.map((r) => [r, new Map()]));
  for (const { row, target: a } of witnesses.values()) picked.get(row).set(`${a.playerIndex}:${a.uid}`, { playerIndex: a.playerIndex, uid: a.uid });
  for (const row of realms) row.targets = [...picked.get(row).values()];
  return { ...webClone(ps.webTraits), gains: { ...ps.webTraitGains }, realms };
}
export function webLayerView(b) {
  const out = {};
  for (const ps of b.players) {
    if (!ps.webTraits) continue;
    for (const id of WEB_BONDS) {
      const bond = ps.bonds[id];
      if (!bond) continue;
      (out[ps.playerId] ??= {})[id] = { layers: bond.layers || 0, temporaryLayers: Math.min(bond.layers || 0, ps.webTraits.temporary[id] || 0) };
    }
  }
  return out;
}
