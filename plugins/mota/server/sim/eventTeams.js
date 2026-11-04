// Event reinforcements retain enemy kits and models; allegiance is independent of the engine's model side.
export const eventTeam=u=>u?.side==='ally'?1:(u?.mods?.eventTeam||0);
export const eventHostile=(a,b)=>a!==b&&(eventTeam(a)===2||eventTeam(b)===2||eventTeam(a)!==eventTeam(b));
export function withEventActor(b,actor,fn){
 if(!b._eventUnits?.size)return fn();
 const old=b._eventActor;if(actor)b._eventActor=actor;
 try{return fn();}finally{b._eventActor=old;}
}
export function eventOpponents(b){
 if(!b._eventUnits?.size)return b.allyUnits;
 const actor=b._eventActor;
 if(actor&&eventTeam(actor)!==0)return b.units.filter(u=>eventHostile(actor,u));
 return [...b.allyUnits,...b.enemies.filter(u=>eventTeam(u)!==0)];
}
export function eventCompanions(b){
 if(!b._eventUnits?.size||!b._eventActor)return b.enemies;
 const actor=b._eventActor;
 return b.units.filter(u=>u===actor||!eventHostile(actor,u));
}
export function registerEventActor(b,e){
 if(!e.mods?.eventTeam)return;
 (b._eventUnits||=new Set()).add(e);
 e.counted=false;e.inTotal=false;e.bounty=null;e.lpr=0;e.isBoss=false;e.bossPool=null;e.mem.noLeak=true;
 e.profile.melee=false;e.profile.blockFree=true;e.profile.unblockable=true;
 b.addBuff(e,{key:'event:allegiance',persist:true,flags:{unblockable:true}});
 e.base.rangeRadius=Math.max(1.6,e.base.rangeRadius);e.markDirty();
 b.on('beforeEnemyLeak',ctx=>{if(ctx.enemy===e){ctx.cancelled=true;b.rerouteEnemy(e,b.grid.specialTiles('start')[0]||[e.spawnY,e.spawnX]);}},{owner:e});
 if(eventTeam(e)===1){const p=b.getPlayer(e.ownerId);if(p&&!p.units.includes(e))p.units.push(e);}
}
