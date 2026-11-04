import {setForm} from './helpers.js';
import {negativeBuff,negativeStatus} from '../../negativeBuff.js';
export const RIFT_RAGE_SECONDS=45,RIFT_RAGE_SPEED=1.8;
// Owner adaptation: rage pursues operators; flee alone goes to a goal, returns with preserved HP.
const KEY='enemy_1571_mirbst';
const present=u=>u?.side==='ally'&&u.kind==='op'&&u.alive&&u.deployed&&!u.removed&&!u.hidden&&!u.isFlying&&!u.s.flags.untargetable&&!u.s.flags.camou&&!u.s.flags.stealth;
const d2=(a,b)=>(a.x-b.x)*(a.x-b.x)+(a.y-b.y)*(a.y-b.y);
function targetOf(b,e){const state=e.mem.returningBoss;if(present(state.lastAttacker))return state.lastAttacker;let best=null;for(const u of b.allyUnits)if(present(u)&&(!best||d2(u,e)<d2(best,e)||(d2(u,e)===d2(best,e)&&u.id<best.id)))best=u;return best;}
function rage(b,e){const m=e.mem.returningBoss;m.state='rage';setForm(b,e,'rage');m.until=b.kind==='unite'?Infinity:b.time+RIFT_RAGE_SECONDS;e.name='狂躁异质裂兽 · 狂暴';e.profile.noAttack=false;e.profile.melee=false;e.profile.noProjectile=true;e.profile.pursuit=()=>targetOf(b,e);e.profile.canTarget=u=>e.blockedBy?u===e.blockedBy:u===targetOf(b,e);b.removeBuff(e,'contract:riftFlee');for(const buff of e.buffs.slice())if(negativeBuff(buff,e))b.removeBuff(e,buff);b.addBuff(e,{key:'contract:riftRage',mods:{atkMul:1.25,aspd:80,dmgTakenMul:.7,moveMul:RIFT_RAGE_SPEED},flags:{noDisplace:true},persist:true});b.fx('buff',{id:e.id,x:e.x,y:e.y,kind:'rage'});}
function flee(b,e){const m=e.mem.returningBoss;m.state='flee';setForm(b,e,'flee');e.name='狂躁异质裂兽 · 逃跑';e.profile.noAttack=true;e.profile.pursuit=null;e.profile.canTarget=null;b.removeBuff(e,'contract:riftRage');b.addBuff(e,{key:'contract:riftFlee',mods:{moveMul:3},flags:{unblockable:true},persist:true});b._unblock(e);const R=b.rect,goals=b.grid.specialTiles('end').filter(([r,c])=>r>=R.r0&&r<=R.r1&&c>=R.c0&&c<=R.c1);goals.sort((a,z)=>d2(e,{x:a[1],y:a[0]})-d2(e,{x:z[1],y:z[0]})||a[0]-z[0]||a[1]-z[1]);const goal=goals[0]||[Math.round(e.y),R.c0];b.rerouteEnemy(e,goal);b.fx('buff',{id:e.id,x:e.x,y:e.y,kind:'speed'});}
function install(b){if(b._returningBossHooks)return;b._returningBossHooks=true;
 const raging=e=>e?.defId===KEY&&e.alive&&e.mem.returningBoss?.state==='rage';
 b.on('beforeBuff',c=>{if(raging(c.target)&&negativeBuff(c.buff,c.target))c.cancel=true;});
 b.on('beforeStatus',c=>{if(raging(c.target)&&negativeStatus(c.status))c.cancel=true;});
 b.on('tick',()=>{for(const e of b.enemies)if(e.defId===KEY&&e.alive&&!e.removed&&e.mem.returningBoss?.state==='rage'&&b.time+1e-9>=e.mem.returningBoss.until)flee(b,e);});
 b.on('damaged',({source,target,amount,credit})=>{if(target?.defId!==KEY||!(amount>0)||!target.mem.returningBoss)return;const actor=source?.kind==='op'?source:source?.ownerUnit?.kind==='op'?source.ownerUnit:credit?.kind==='op'?credit:null;if(present(actor))target.mem.returningBoss.lastAttacker=actor;});
 b.on('enemyLeak',({enemy:e})=>{if(e.defId!==KEY||b.kind==='unite'||b.finished||!e.returnSpawn)return;const hp=e.returnHpPct??1,request={...e.returnSpawn,returnHpPct:hp,returningId:e.returningId,inTotal:false};b.after(2,()=>{if(!b.finished)b.spawnEnemy(KEY,request);},{holdsBattle:true});});
 b.on('death',({unit:e,reason})=>{if(e.defId!==KEY||reason!=='killed')return;for(const pp of Object.values(b._perPlayer))for(const leak of pp.leaked||[])if(leak.enemyKey===KEY&&leak.returningId===e.returningId)leak.returningDefeated=true;});
}
export const RETURNING_BOSS_KITS=Object.freeze({[KEY]:()=>[{spawn(b,e){e.mem.returningBoss={state:'rage',until:0,lastAttacker:null};install(b);rage(b,e);}}]});
