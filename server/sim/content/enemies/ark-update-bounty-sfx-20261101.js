// Sound-only hooks for the two act55side base bounties. No stats, RNG, attacks, FX state or rewards change.
const IDS=new Set(['enemy_1602_blksnk','enemy_1603_hlystp']);
// Native A_Skill_2 OnPlayAudio strings: blksnk_skill_leave at154/30;
// hlystp_skill_leave at138/30. Parsed from the same official skeletons used by V1.
const LEAVE=Object.freeze({enemy_1602_blksnk:154/30,enemy_1603_hlystp:138/30});
export function emitBountyNativeSfx20261101(b,e,phase,slot=null){
 if(IDS.has(e.defId))b.fx('nativeSfx',{id:e.id,enemyKey:e.defId,phase,slot,x:e.x,y:e.y});
}
export function bountyNativeSfxHooks20261101(){return{
 spawn(b,e){e.profile.attackWindupFx='nativeSfx';}, // existing ai.js one-shot wind-up event
 dealt(c,b,e){if(c.dmg.isAttack)emitBountyNativeSfx20261101(b,e,'attackHit');},
};}
export function scheduleBountyNativeLeave20261101(b,e){
 const at=LEAVE[e.defId];if(at!=null)b.after(at,()=>{if(e.alive)emitBountyNativeSfx20261101(b,e,'leave');},{owner:e});
}
