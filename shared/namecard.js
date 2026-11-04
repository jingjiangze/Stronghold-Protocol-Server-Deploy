/** Public namecards contain asset identifiers only, never paths, markup or arbitrary URLs. */
export const uploadedNamecardId = (owner, revision) => `namecard:${owner}/${revision}`;
export function parseUploadedNamecardId(value) {
  const match = typeof value === 'string' && /^namecard:([a-f0-9]{16})\/([a-f0-9]{16})$/.exec(value);
  return match ? { owner: match[1], revision: match[2] } : null;
}
export function normalizeNamecard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const theme = ['mint','amber','red'].includes(value.theme) ? value.theme : 'mint';
  const zoom = Number.isFinite(value.zoom) ? Math.max(1,Math.min(2,value.zoom)) : 1;
  if (value.uploadId != null) return parseUploadedNamecardId(value.uploadId) ? { uploadId: value.uploadId, theme, zoom } : null;
  const charId = value.charId;
  if (typeof charId !== 'string' || !/^char_[0-9]+_[A-Za-z0-9_]+$/.test(charId) || charId.length>64) return null;
  const skinId = typeof value.skinId==='string' && value.skinId.length<=128 && value.skinId.startsWith(charId+'@') && /^[A-Za-z0-9_@#-]+$/.test(value.skinId) ? value.skinId : null;
  return {charId,skinId,theme,zoom};
}
export const validNamecard = value => value == null || !!normalizeNamecard(value);
