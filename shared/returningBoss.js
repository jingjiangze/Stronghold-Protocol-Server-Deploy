import {isHuntEntry} from './huntProgression.js';
// Hunt additions are free leaks; the returning bounty otherwise keeps its weighted debt.
export const RETURNING_BOSS_KEY='enemy_1571_mirbst';
export const returningEnemy=entry=>entry?.enemyKey===RETURNING_BOSS_KEY;
export function leakCharge(entry){if(isHuntEntry(entry))return 0;if(!returningEnemy(entry))return 1;const n=Number(entry.lpr??entry.mods?.returnLpDebt??3);return Number.isFinite(n)?Math.max(0,Math.min(10,n)):3;}
