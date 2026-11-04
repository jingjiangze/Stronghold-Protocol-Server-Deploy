/** Owner raid protection. Simulation time only; player windows live on the pool across every field/body. */
export const BOSS_BURST_RULES=Object.freeze({single:.05,window:2,trigger:.15,duration:3,taken:.35,perSecond:.04,cooldown:8});
export const LATE_BOSS_BURST_RULES=Object.freeze({single:.025,window:2,trigger:.05,duration:4,taken:.5,perSecond:.02,cooldown:6,sustained:.03});
export function bossBurstDamage(state,time,phaseMax,phaseKey,amount,mode=null){
 if(!(amount>0)||!(phaseMax>0))return{amount:Math.max(0,amount||0),triggered:false};
 const rules=mode==='late'?LATE_BOSS_BURST_RULES:BOSS_BURST_RULES;
 if(state.phaseKey!==phaseKey)Object.assign(state,{phaseKey,lastTime:time,hits:[],guardHits:[],sustainedHits:[],until:-1,ready:-1});
 const now=Math.max(state.lastTime,time);state.lastTime=now;
 state.hits=state.hits.filter(h=>h.t>now-rules.window+1e-9);
 state.guardHits=state.guardHits.filter(h=>h.t>now-1+1e-9);
 state.sustainedHits=(state.sustainedHits||[]).filter(h=>h.t>now-1+1e-9);
 let damage=Math.min(amount,phaseMax*rules.single);
 if(now<state.until)damage=Math.min(damage*rules.taken,Math.max(0,phaseMax*rules.perSecond-state.guardHits.reduce((n,h)=>n+h.n,0)));
 if(rules.sustained)damage=Math.min(damage,Math.max(0,phaseMax*rules.sustained-state.sustainedHits.reduce((n,h)=>n+h.n,0)));
 if(damage>0){if(now<state.until)state.guardHits.push({t:now,n:damage});if(rules.sustained)state.sustainedHits.push({t:now,n:damage});}
 if(damage>0)state.hits.push({t:now,n:damage});
 let triggered=false;if(now>=state.ready&&state.hits.reduce((n,h)=>n+h.n,0)>=phaseMax*rules.trigger-1e-8){state.until=now+rules.duration;state.ready=now+rules.cooldown;state.guardHits=[];triggered=true;}
 return{amount:damage,triggered,until:state.until};
}

/** Freeze the real fight-start roster and the ACTUAL HP multiplier (including legacy/fixed-HP modes).
 * [ASSUMED] Independent, non-transferable player allowances use unscaled phase HP. N/2 is the conservative
 * envelope derived from the current HP curve 1 + N/2: even a fixed/legacy pool reserves at most twice the old
 * aggregate allowance in guaranteed lanes (plus the unchanged opportunistic shared lane). A one-player fight retains the exact original reference HP and rules.
 */
export function bossBurstRoster(playerIds, hpScale) {
  const ids = [...new Set((Array.isArray(playerIds) ? playerIds : []).filter(id => typeof id === 'string' && id.length > 0))];
  const scale = Number(hpScale);
  if (!ids.length || ids.length > 20 || !Number.isFinite(scale) || !(scale > 0)) return null;
  return Object.freeze({ playerIds: Object.freeze(ids), hpScale: scale });
}

/** Independent guaranteed lanes plus the legacy shared lane for opportunistic excess.
 * Take the larger grant, never add both grants for the same hit. Keeping the original shared lane means a
 * carry with auxiliary teammates cannot lose its old allowance; exhausting it cannot erase anyone's own lane.
 * Personal reductions/triggers stay personal. Only personal triggers produce the protection effect.
 * Unknown ids never allocate a lane. Missing metadata retains legacy replays/tools exactly.
 */
export function bossPlayerBurstDamage(pool, playerId, time, phaseMax, phaseKey, amount, mode = null) {
  const roster = pool.burstGuard;
  if (!roster) return bossBurstDamage(pool._burstGuard ||= {}, time, phaseMax, phaseKey, amount, mode);
  if (playerId != null && !roster.playerIds.includes(playerId)) return { amount: 0, triggered: false };
  const n = roster.playerIds.length;
  const shared = bossBurstDamage(pool._burstGuard ||= {}, time, phaseMax, phaseKey, amount, mode);
  // Trusted environmental damage has no player reservation. A one-player fight is bit-for-bit legacy.
  if (playerId == null || n === 1) return shared;
  const divisor = Math.max(1, roster.hpScale, n / 2);
  const states = pool._playerBurstGuards ||= new Map();
  const state = states.get(playerId) || {};
  states.set(playerId, state);
  const own = bossBurstDamage(state, time, phaseMax / divisor, phaseKey, amount, mode);
  return { amount: Math.max(shared.amount, own.amount), triggered: own.triggered, until: own.until };
}
