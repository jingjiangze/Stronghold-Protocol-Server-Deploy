import {spawnChildren,remainingRoute,areaAlliesInTiles,hurt} from './helpers.js';
import {hypot} from '../../detmath.js';
import {PROJECTILE_SPEED} from '../../constants.js';
export const present=u=>!!(u?.alive&&u.deployed&&!u.hidden&&!u.removed);
/** One interruptible cast: short control effects cancel it permanently, including delayed pulses. */
export function channel(b,e,key,duration,flags={},silence=true){
 const token={cancelled:false,until:b.time+duration,silence};const active=b._compatChannels||=(new Map());
 const cancel=(u,k,t)=>{if(t.cancelled)return;t.cancelled=true;b.removeBuff(u,k);u.skillAnimUntil=-Infinity;b.fx('enemyChannelCancel',{id:u.id,x:u.x,y:u.y});};
 for(const[c,v]of active)if(v.e===e&&v.key===key){cancel(e,key,c);active.delete(c);}
 active.set(token,{e,key});b.addBuff(e,{key,duration,flags:{disarm:true,noMove:true,...flags}});
 if(!b._compatChannelHook){b._compatChannelHook=true;const controlled=(u,t)=>!present(u)||u.s.flags.stun||u.s.flags.freeze||u.s.flags.sleep||u.s.flags.levitate||(t.silence&&u.s.flags.silence);
  b.on('statusApplied',c=>{if(!['stun','freeze','sleep','levitate','silence'].includes(c.status))return;for(const[t,v]of active)if(v.e===c.target&&(c.status!=='silence'||t.silence)){cancel(v.e,v.key,t);active.delete(t);}});
  b.on('tick',()=>{for(const[t,v]of active){if(t.cancelled||b.time>t.until){active.delete(t);continue;}if(controlled(v.e,t)){cancel(v.e,v.key,t);active.delete(t);}}});
 }
 return token;
}
/** Shared live and lifetime caps bound summoners without passing a parent's bounty to its descendants. */
export function spawnOwned(b,parent,key,count=1,{cap=8,totalCap=32,pos=null,mods={},countInTotal=false,route=null}={}){
 if(!key)return[];
 const root=parent.mem.compatRoot??parent.id;
 const living=b.enemies.filter(u=>u.alive&&u.mem.compatRoot===root).length;
 const totals=b._compatSpawnTotals||=(new Map()),made=totals.get(root)||0;
 const n=Math.max(0,Math.min(count,cap-living,totalCap-made));if(!n)return[];
 const children=spawnChildren(b,parent,key,n,{pos:pos||[parent.y,parent.x],mods:{...(parent.mods||{}),...mods},route:route||remainingRoute(parent),countInTotal});
 for(const child of children){child.mem.compatRoot=root;child.mem.compatParent=parent.id;child.bounty=null;}
 totals.set(root,made+children.length);return children;
}
export function animationTiming(e,names,fallback){
 const meta=e.def.raw.nativeAnimations||{};
 for(const name of names){const hit=meta.hits?.[name]?.[0];if(Number.isFinite(hit)&&hit>0)return hit;const dur=meta.durations?.[name];if(Number.isFinite(dur)&&dur>0)return dur;}
 return fallback;
}
export function crossStrike(b,e,target,amount,type='phys',radius=1){
 if(!present(target))return;
 for(const u of areaAlliesInTiles(b,e,target.tileR,target.tileC,'cross',radius))hurt(b,e,u,amount,type);
}
export function fireNative(b,source,target,projectile,onHit,{point=null,speed=PROJECTILE_SPEED}={}){
 if(!present(target)&&!point)return null;
 const to=point||target,dur=Math.max(.04,Math.min(3,hypot(to.x-source.x,to.y-source.y)/speed));
 b.fx('enemyProjectile',{id:source.id,src:source.id,from:source.id,x:source.x,y:source.y,to:target?.id,projectile,dur,...(point?{tx:point.x,ty:point.y,fixed:true}:{})});
 return b.addProjectile({from:source,source,target:point?null:target,to:point||null,speed,visual:'enemyNative',onHit});
}
