import { COSMETIC_SKILL_HITS, COSMETIC_HIT_LIMITS as L } from '../../shared/cosmeticSkillHitPolicy20261102.js';
// Separate bounded presentation storage: no cosmetic tuple enters the real EVENT_BUFFER_CAP queue.
const states = new WeakMap();
const bucket = (at, burst) => ({ at, tokens: burst });
const ready = (b, at, rate, burst) => { b.tokens = Math.min(burst, b.tokens + Math.max(0, at - b.at) * rate); b.at = at; return b.tokens >= 1; };
const clearPending = s => { s.pending.length = 0; s.keys.clear(); s.queuedOwners.clear(); s.queue = null; };
export function queueCosmeticSkillHit(b, owner, target, skill, action) {
  if (!b.recordEvents || b.finished || !COSMETIC_SKILL_HITS.includes(skill) || !Array.isArray(b._evq) || b._evq.length > L.baseQueue) return false;
  const id = owner?.id, tid = target?.id, x = target?.x, y = target?.y;
  if (owner?.kind !== 'op' || owner.side !== 'ally' || !Number.isInteger(id) || id < 1 || id > 2147483647 || !Number.isInteger(tid) || tid < 1 || tid > 2147483647
    || !Number.isSafeInteger(action) || action < 0 || !Number.isFinite(x) || !Number.isFinite(y) || Math.abs(x) > 1000 || Math.abs(y) > 1000) return false;
  const at = b.time; let s = states.get(b);
  if (!s) { s = { global: bucket(at, L.globalBurst), owners: new Map(), queue: null, pending: [], keys: new Set(), queuedOwners: new Map() }; states.set(b, s); }
  if (s.queue !== b._evq) { clearPending(s); s.queue = b._evq; }
  const key = `${id}:${action}:${tid}`;
  if (s.keys.has(key) || s.pending.length >= L.pendingGlobal || (s.queuedOwners.get(id) || 0) >= L.pendingOwner) return false;
  let own = s.owners.get(id);
  if (!own) {
    for (const [k, v] of s.owners) if (at - v.at > L.idle) s.owners.delete(k);
    if (s.owners.size >= L.owners) return false;
    s.owners.set(id, own = bucket(at, L.ownerBurst));
  }
  if (!ready(own, at, L.ownerRate, L.ownerBurst) || !ready(s.global, at, L.globalRate, L.globalBurst)) return false;
  own.tokens--; s.global.tokens--; s.keys.add(key); s.queuedOwners.set(id, (s.queuedOwners.get(id) || 0) + 1);
  s.pending.push({ at: b._evq.length, event: ['fx', 'skillPulse', Math.round(x * 100) / 100, Math.round(y * 100) / 100, { id, target: tid, cosmetic: true }] });
  return true;
}
export function drainCosmeticSkillHits(b, real) {
  const s = states.get(b);
  if (!s) return real;
  // Original queue overflow/congestion has priority. Discard only our cosmetics; never trim/reorder real events.
  if (s.queue !== real || !s.pending.length || real.length > L.baseQueue) { clearPending(s); return real; }
  const out = []; let i = 0;
  for (const p of s.pending) { while (i < p.at && i < real.length) out.push(real[i++]); out.push(p.event); }
  while (i < real.length) out.push(real[i++]);
  clearPending(s); return out;
}
