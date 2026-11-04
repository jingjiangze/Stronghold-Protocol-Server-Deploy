// Correct native support identities; never choose another enemy as a visual fallback.
import {areaAllies} from './helpers.js';
import {hypot} from '../../detmath.js';
const TRAPS=new Set(['trap_007_ballis','trap_041_fcanon','trap_054_dancdol','trap_127_bldore','trap_137_winfire','trap_043_dupilr']);
export function nativeObjectivePosition(b,parent,key,preferred,owned){
 const r0=Math.max(b.rect.r0,Math.min(b.rect.r1,Math.round(preferred[0]))),c0=Math.max(b.rect.c0,Math.min(b.rect.c1,Math.round(preferred[1])));
 // Marks are native non-solid anchors; overlap with their locked unit is intentional.
 if(!TRAPS.has(key))return preferred;
 const occupied=new Set(b.enemies.filter(u=>u.alive&&u.deployed&&(owned.includes(u)||u.def?.raw?.nativeActorType==='trap')).map(u=>`${Math.round(u.y)},${Math.round(u.x)}`)),tiles=[];
 for(let r=b.rect.r0;r<=b.rect.r1;r++)for(let c=b.rect.c0;c<=b.rect.c1;c++){
  const t=b.tileInfo(r,c);if(!b.grid.groundPassable(r,c)||t.height!=='LOW'||t.special||b.unitAt(r,c)||b.downOn(r,c)||occupied.has(`${r},${c}`))continue;
  tiles.push([r,c]);
 }
 tiles.sort((a,z)=>Math.abs(a[0]-r0)+Math.abs(a[1]-c0)-Math.abs(z[0]-r0)-Math.abs(z[1]-c0)||a[0]-z[0]||a[1]-z[1]);return tiles[0]||null;
}
export function nativeObjectiveFacing(b,parent,key,pos){
 if(key!=='trap_007_ballis')return undefined;
 const goals=b.grid.specialTiles('end').filter(([r,c])=>b.grid.inRect(r,c));
 goals.sort((a,z)=>Math.abs(a[0]-pos[0])+Math.abs(a[1]-pos[1])-Math.abs(z[0]-pos[0])-Math.abs(z[1]-pos[1])||a[0]-z[0]||a[1]-z[1]);
 return goals.length&&goals[0][1]!==pos[1]?(goals[0][1]<pos[1]?'LEFT':'RIGHT'):(parent.facing<0?'LEFT':'RIGHT');
}
export function configureNativeBountyObjective(b,parent,u,key,attack,link=null){
 // Only the two invulnerable objective-driven parents: nearby normal AI must prioritize their break target.
 if(parent.defId==='enemy_2019_cshost'&&key==='trap_054_dancdol'||parent.defId==='enemy_1544_cledub'&&key==='bounty_scene_cledub_answer')b.addBuff(u,{key:'nativeObjective:requiredTarget',persist:true,mods:{taunt:Math.max(1,(parent.s.taunt||0)+1-(u.s.taunt||0))}});
 if(TRAPS.has(key))b.addBuff(u,{key:'nativeObjective:fixed',persist:true,flags:{unblockable:true,noMove:true}});
 u.mem.noLeak=true;
 if(link?.unit&&link.key){
  const cleanup=()=>{const meta=u.mem.leaderObjective;if(!u.alive||meta?.cleanup)return;meta.cleanup=true;meta.onClear?.();b.kill(u,null);};
  const buff=link.unit.buffs.find(v=>v.key===link.key);
  if(!buff){cleanup();return;}
  u.mem.leaderObjective.link=link;
  for(const old of parent.mem.leaderObjectives||[]){const m=old.mem.leaderObjective;if(old!==u&&old.alive&&m?.link?.unit===link.unit&&m.link.key===link.key){m.cleanup=true;b.kill(old,null);}}
  if(buff){
   const prior=buff.onRemove,priorExpire=buff.onExpire;
   buff.onRemove=ctx=>{try{prior?.(ctx);}finally{cleanup();}};
   // Natural duration expiry is distinct from explicit removal in BattleStatus._tickBuffs.
   buff.onExpire=ctx=>{try{priorExpire?.(ctx);}finally{cleanup();}};
  }
  b.on('death',({unit})=>{if(unit===link.unit)cleanup();},{owner:u});
 }
 if(key!=='trap_007_ballis')return;
 u.facing=u.dir==='LEFT'?-1:1;u.profile.melee=false;u.profile.blockFree=true;u.profile.deferHit=true;u.profile.shot='none';
 u.profile.canTarget=a=>(a.x-u.x)*u.facing>0&&Math.abs(a.y-u.y)<=.35;
 if(!attack)return;
 b.on('attack',c=>{
  if(c.attacker!==u||!u.alive||!parent.alive)return;const target=c.targets?.[0];if(!target)return;
  const tx=target.x,ty=u.y,speed=10,dur=hypot(tx-u.x,ty-u.y)/speed;
  // Native projectile_ballis is FarthestPointMovement, speed10, source direction.
  // Existing engine has fixed-point arrivals, not swept lane collisions. Keep a
  // fixed impact (miss if vacated); never add a per-frame world scan or homing car.
  b.addProjectile({from:u,to:{x:tx,y:ty},speed,visual:'none',source:u,onHit:()=>{
   if(!u.alive||!parent.alive)return;
   const first=areaAllies(b,u,tx,ty,.35).sort((a,z)=>Math.abs(a.x-tx)-Math.abs(z.x-tx)||a.id-z.id)[0];
   if(first)b.dealDamage(u,first,{amount:u.s.atk,type:'phys',canDodge:true,isAttack:true,isProjectile:true});
  }});
  b.fx('enemyProjectile',{id:u.id,x:u.x,y:u.y,projectile:'projectile_ballis',fixed:true,tx,ty,dur});
 },{owner:u});
}
