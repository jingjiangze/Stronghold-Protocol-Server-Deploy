// eventFoe.js — retired shim.
//
// The 事件期 landed (server/match/match/event.js + ui/eventOverlay.js), so the monster-entry helpers now live in
// ui/eventOverlay.js. Kept as a one-line re-export so an older cached module graph cannot break on the old path.
export { FOE_NAMES, foeEffect, eliteEffect, eventFoeCard } from './eventOverlay.js';
