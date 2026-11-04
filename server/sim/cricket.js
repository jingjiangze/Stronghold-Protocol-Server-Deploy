import {eventHostile} from './eventTeams.js';
import {hypot} from './detmath.js';
import {eventGate} from './roundEventGeometry.js';
/** Native enemy kits on both sides; temporary allies never consume inventory or shop copies. */
export function cricketOpponents(b,e){
 if(!b.flags.cricket)return [];
 return b.enemies.filter(u=>u!==e&&u.alive&&u.deployed&&!u.hidden&&!u.removed&&eventHostile(e,u));
}
/** Re-plan toward the opponent on legal ground, then restore the original goal once the opposing army is gone. */
export function cricketPursuit(b,e){
 if(!b.flags.cricket||!b._cricketStarted||!e.alive||e.isBoss)return;
 const state=e.mem.cricketPursuit||={goal:null,next:0,chasing:false};if(b.time<state.next)return;state.next=b.time+.5;
 if(!state.goal){const end=e.route?.legs?.filter(l=>l.t==='move').at(-1);if(end)state.goal=[end.r,end.c];}
 const target=cricketOpponents(b,e).sort((a,z)=>hypot(a.x-e.x,a.y-e.y)-hypot(z.x-e.x,z.y-e.y)||a.id-z.id)[0];
 if(!target){if(state.chasing){state.chasing=false;b.removeBuff(e,'cricket:pursuit');if(state.goal)b.rerouteEnemy(e,state.goal);}return;}
 if(!state.chasing)state.chasing=true;
 if(e.blockedBy)return;
 // Enemy melee actors have contact attacks while event armies exist; avoid interrupting an in-range swing.
 const reach=(e.profile?.melee??e.def.applyWay==='MELEE')?.8:Math.max(.8,e.base.rangeRadius);
 if(hypot(e.x-target.x,e.y-target.y)<=reach){e.moving=false;e.pauseUntil=Math.max(e.pauseUntil,b.time+.5);return;}
 const points=[];for(let r=b.rect.r0;r<=b.rect.r1;r++)for(let c=b.rect.c0;c<=b.rect.c1;c++)if(b.grid.groundPassable(r,c)&&b.grid.tile(r,c).height!=='HIGH'&&b.grid.tile(r,c).key!=='tile_achand')points.push([r,c]);
 points.sort((a,z)=>hypot(a[1]-target.x,a[0]-target.y)-hypot(z[1]-target.x,z[0]-target.y));
 const point=points.find(a=>e.motion==='FLY'||b.grid.findPath(Math.round(e.y),Math.round(e.x),...a)?.length);
 if(point)b.rerouteEnemy(e,point);
}
export function startCricket(b){
 const cfg=b.flags.cricket;if(!cfg||b._cricketStarted)return;b._cricketStarted=true;
 b.on('beforeEnemyLeak',ctx=>{const e=ctx.enemy;if(cricketOpponents(b,e).length){ctx.cancelled=true;ctx.stopPropagation=true;e.moving=false;return;}if(e.tag==='cricketAlly'){ctx.cancelled=true;ctx.stopPropagation=true;b._remove(e,'eventExit');}},{priority:100});
 for(const p of b.players){const row=cfg.players?.find(v=>v.playerId===p.playerId);if(!row)continue;
  for(const friendly of [true,false])for(const [i,card]of (row[friendly?'friendly':'enemy']||[]).entries()){
   const blue=eventGate(b,p,'end'),red=eventGate(b,p,'start'),pos=friendly?blue:red,end=friendly?red:blue,delay=2+i*.35;
   b.fx('eventWheel',{event:friendly?'allyBox':'enemyBox',playerId:p.playerId,enemyKey:card.enemyKey,choices:row[friendly?'friendly':'enemy'].map(c=>c.enemyKey),dur:delay});
   b.after(delay,()=>{const def=b.data.getEnemy(card.enemyKey);if(!def)return;
    const e=b.spawnEnemy(card.enemyKey,{pos,route:{motion:def.motion,start:pos,end,checkpoints:[]},ownerPlayerId:p.playerId,countInTotal:!friendly,tag:friendly?'cricketAlly':'cricketEnemy',mods:{...card.mods,cricket:1,...(friendly?{eventTeam:1}:{bountyCoins:card.coin||0})},bounty:!friendly&&card.coin>0?{coins:card.coin,ownerPlayerId:p.playerId}:null});
    if(e)b.fx('eventWheelResult',{event:friendly?'allyBox':'enemyBox',playerId:p.playerId,enemyKey:card.enemyKey,id:e.id,x:e.x,y:e.y});
   },{holdsBattle:true});
  }
 }
}
