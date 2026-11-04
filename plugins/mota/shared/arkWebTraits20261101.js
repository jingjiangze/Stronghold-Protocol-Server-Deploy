// Owner's web-only traits. Native profession/talent/skill data is intentionally separate.
import { layerGainRoom } from './constants.js';

import { WEB_BONDS, WEB_TRAITS } from './arkWebTraitRules20261101.js';
export { WEB_TRAITS, WEB_BONDS, WEB_REALM_POLICY } from './arkWebTraitRules20261101.js';
export const webInstanceKey = (charId, uid, elite) => `${charId}:${uid}:${elite ? 1 : 0}`;
export const webInt = (n, lo, hi) => Number.isInteger(n) && n >= lo && n <= hi;
export const webClone = (x) => JSON.parse(JSON.stringify(x));
// 37x41 relative offsets, fixed-size 190-byte hex bitmap; avoids a large per-copy JSON coordinate list.
export function encodeWebCells(cells) {
  if (!cells.length) return '';
  const bytes = new Uint8Array(190);
  for (const [r, c] of cells) { const k = (r + 18) * 41 + c + 20; if (k >= 0 && k < 1517) bytes[k >> 3] |= 1 << (k & 7); }
  return [...bytes].map((n) => n.toString(16).padStart(2, '0')).join('');
}
export function decodeWebCells(cells) {
  if (!cells) return [];
  const out = [];
  for (let k = 0; k < 1517; k++) if (parseInt(cells.slice((k >> 3) * 2, (k >> 3) * 2 + 2), 16) & (1 << (k & 7))) out.push([Math.floor(k / 41) - 18, k % 41 - 20]);
  return out;
}
export function emptyWebRound(round) {
  return { v: 2, round, burnProgress: { normal: 0, elite: 0 }, used: { alga: 0, oxi: 0, tocka: 0 }, tockaCap: 20, temporary: {}, progress: {} };
}
export function withWebTemporary(bonds, temporary, capOpts = null) {
  if (!temporary || !Object.keys(temporary).length) return bonds;
  const out = { ...bonds };
  for (const id of WEB_BONDS) {
    const b = out[id];
    if (!b) continue;
    const n = layerGainRoom(b.layers || 0, temporary[id] || 0, capOpts);
    out[id] = { ...b, permanentLayers: b.layers || 0, temporaryLayers: n, layers: (b.layers || 0) + n };
  }
  return out;
}

/** Cheap wire-size/type bound. Semantic ownership and action bounds belong to the server's BattleSpec validator. */
export function webWireShape(x) {
  const obj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
  if (!obj(x) || x.v !== 2 || !webInt(x.round, 0, 10000) || !obj(x.used) || !obj(x.gains) || !obj(x.temporary) || !obj(x.progress) || ![20, 25].includes(x.tockaCap)) return false;
  if (!obj(x.burnProgress) || Object.keys(x.burnProgress).length !== 2 || ['normal', 'elite'].some(k => !Number.isFinite(x.burnProgress[k]) || x.burnProgress[k] < 0 || x.burnProgress[k] >= 1)) return false;
  if (Object.keys(x.used).length !== 3 || Object.keys(x.gains).length !== 3 || Object.keys(x.temporary).length > 3 || Object.keys(x.progress).length > 256) return false;
  if (['alga', 'oxi', 'tocka'].some((k) => !webInt(x.used[k], 0, 25) || !webInt(x.gains[k], 0, 25))) return false;
  if (Object.entries(x.temporary).some(([k, n]) => !WEB_BONDS.includes(k) || !webInt(n, 0, 999))) return false;
  for (const [k, p] of Object.entries(x.progress)) {
    if (k.length > 100 || !obj(p) || !webInt(p.attacks, 0, 14) || !webInt(p.action, 0, 1e9) || !webInt(p.realmTicks, 0, WEB_TRAITS.char_4246_dminon.interval * 30 - 1) || typeof p.cells !== 'string' || p.cells && (p.cells.length !== 380 || !/^[0-9a-f]+$/.test(p.cells) || parseInt(p.cells.slice(-2), 16) >= 32)) return false;
  }
  return Array.isArray(x.realms) && x.realms.length <= 64 && x.realms.every((r) => obj(r) && webInt(r.uid, 0, 1e9) && typeof r.elite === 'boolean' && Array.isArray(r.targets) && r.targets.length <= 256 && r.targets.every((a) => obj(a) && webInt(a.playerIndex, 0, 3) && webInt(a.uid, 0, 1e9)));
}
export function webDigest(x) {
  const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().filter((k) => !(WEB_BONDS.includes(k) && v[k] === 0)).map((k) => [k, stable(v[k])])) : v;
  return stable(x);
}
