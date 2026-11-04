// Waiting-room music wire contract. No URLs, client timestamps or client-owned sequence numbers.
// [ASSUMED] A host migration ends the invitation; joining it is always a local, explicit choice.
export const ROOM_MUSIC_MODES = Object.freeze(['shuffle', 'sequence', 'repeat']);
export const ROOM_MUSIC_MAX_POSITION = 24 * 60 * 60;
export const roomMusicId = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(v);
export const roomMusicPosition = v => Number.isFinite(v) && v >= 0 && v <= ROOM_MUSIC_MAX_POSITION;
export const roomMusicVersion = v => Number.isSafeInteger(v) && v >= 0;
export function validRoomMusicCommand(v) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return false;
  if (!['publish', 'stop'].includes(v.action) || !roomMusicVersion(v.expectedRev)) return false;
  if (v.action === 'stop') return true;
  return roomMusicId(v.trackId) && roomMusicPosition(v.position) && typeof v.paused === 'boolean'
    && ROOM_MUSIC_MODES.includes(v.mode);
}
// `now` is in server milliseconds (the existing ping clock, or receive-time fallback).
export function roomMusicPositionAt(state, now, duration = Infinity) {
  const p = state.position + (state.paused ? 0 : Math.max(0, now - state.at) / 1000);
  return Number.isFinite(duration) && duration > 0 ? Math.min(p, Math.max(0, duration - 0.02)) : p;
}
