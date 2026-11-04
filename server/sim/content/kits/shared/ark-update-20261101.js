// Pure helpers for the four 2026-11-01 DIY operators. Source IDs and gaps live in the operators handoff.
export const num = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
export const live = (u) => !!(u?.alive && u.deployed && !u.hidden);
export const skill = (r, id) => r.skills?.find((s) => s.skillId === id || s.id === id) ?? (r.skill?.skillId === id ? r.skill : null);
export const talent = (r, index) => r.talents?.find((t) => t.index === index)?.bb ?? {};
export const talentValue = (r, key, fallback = 0) => {
  for (const t of r.talents ?? []) if (Number.isFinite(t.bb?.[key])) return t.bb[key];
  return fallback;
};
export const ops = (b) => b.allyUnits.filter((a) => a.kind === 'op' && live(a));
export const enemies = (b, u) => b.enemiesInKeys(u.rangeKeys, u, u.profile);
export const elite = (e) => e.isBoss || ['ELITE', 'BOSS'].includes(e.def?.rank);
export const ground = (e) => live(e) && !e.isFlying;
export function aura(b, u, fn, interval = 0.1) {
  return b.every(interval, () => { if (live(u)) fn(); }, { owner: u });
}
export function hit(b, u, e, scale, type = 'phys', tags = []) {
  return b.dealDamage(u, e, { amount: u.s.atk * scale, type, isSkill: true, tags: ['skill', ...tags] });
}
export function decayBuff(b, u, key, duration, mods) {
  const timers = u.mem.arkDecayTimers ??= new Map();
  timers.get(key)?.cancel();
  const started = b.time;
  const update = () => {
    const ratio = Math.max(0, 1 - (b.time - started) / duration);
    b.addBuff(u, { key, duration: Math.min(0.11, duration), mods: Object.fromEntries(Object.entries(mods).map(([k, v]) => [k, v * ratio])) });
  };
  update();
  const timer = b.every(0.1, () => { if (!live(u) || b.time - started >= duration) { timer.cancel(); if (timers.get(key) === timer) timers.delete(key); } else update(); }, { owner: u });
  timers.set(key, timer);
  return timer;
}
