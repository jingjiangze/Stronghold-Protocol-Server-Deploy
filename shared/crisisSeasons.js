import { crisisCounts } from './crisisScore.js';

export const CURRENT_CRISIS_SEASON = Object.freeze({ id: 'shenqi-202610', name: '危机合约：神启' });
export function crisisSeason(raw) {
  return raw && /^[A-Za-z0-9_-]{1,64}$/.test(raw.id) && !['__proto__', 'constructor', 'prototype'].includes(raw.id) && typeof raw.name === 'string'
    ? { id: raw.id, name: raw.name.slice(0, 64) } : { ...CURRENT_CRISIS_SEASON };
}
const n = v => Math.max(0, Math.min(1e12, Math.round(Number(v) || 0)));
export function normalizeCrisis(raw = {}) {
  return { bestHard: n(raw.bestHard), bestAbyss: n(raw.bestAbyss), totalPoints: n(raw.totalPoints),
    clears: n(raw.clears), matches: n(raw.matches), tiers: { clear: n(raw.tiers?.clear), hold: n(raw.tiers?.hold), fallen: n(raw.tiers?.fallen) } };
}
/** Old unlabelled totals are migrated once into the current season, never erased. */
export function crisisSeasons(raw, legacy = {}) {
  const out = {};
  for (const [id, row] of Object.entries(raw && typeof raw === 'object' ? raw : {})) {
    if (/^[A-Za-z0-9_-]{1,64}$/.test(id) && !['__proto__', 'constructor', 'prototype'].includes(id) && row && typeof row === 'object') out[id] = { name: String(row.name || id).slice(0, 64), ...normalizeCrisis(row) };
  }
  if (!Object.keys(out).length) out[CURRENT_CRISIS_SEASON.id] = { name: CURRENT_CRISIS_SEASON.name, ...normalizeCrisis(legacy) };
  return out;
}
export function addCrisisRun(previous, row, score) {
  const cr = normalizeCrisis(previous), counts = crisisCounts(score), won = row.won ?? row.victory;
  if (counts && row.difficulty === 'HARD') cr.bestHard = Math.max(cr.bestHard, score.points);
  if (counts && row.difficulty === 'ABYSS') cr.bestAbyss = Math.max(cr.bestAbyss, score.points);
  if (counts) cr.totalPoints += score.points;
  if (row.contractPoints > 0) { cr.matches++; if (won) cr.clears++; }
  if (Object.hasOwn(cr.tiers, score.tier)) cr.tiers[score.tier]++;
  return cr;
}
