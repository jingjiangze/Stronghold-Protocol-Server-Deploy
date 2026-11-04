import {T,hurt,targetsNear,allTargets,byPriority,castSlot,setHits,hitCount,remainingRoute,abilityAttackFx} from './helpers.js';
import {skill,unblockable} from './archetypes.js';
import {present,spawnOwned} from './compatibility-helpers.js';
const PAPER='enemy_2101_dyspll';
const getHost=e=>e.mem.compatPaperHost;
const attach=(b,e,u)=>{if(!present(u)||u.mem.compatPaper?.alive)return false;e.mem.compatPaperHost=u;u.mem.compatPaper=e;e.profile.noAttack=true;b.addBuff(e,{key:'compat:paperStop',persist:true,flags:{noMove:true}});b.addBuff(u,{key:'compat:paperSeal',persist:true,visible:true,flags:{silence:true}});b.fx('beam',{from:e.id,to:u.id,x:e.x,y:e.y,kind:'paper',dur:.3});return true;};
const detach=(b,e)=>{const u=getHost(e);if(u?.mem.compatPaper===e){delete u.mem.compatPaper;b.removeBuff(u,'compat:paperSeal');}delete e.mem.compatPaperHost;b.removeBuff(e,'compat:paperStop');if(e.alive&&e.route){e.route.pts=null;e.route.ptIdx=0;e.route.version=-1;}};
const paper=()=>[unblockable(),{
 spawn(b,e){e.mem.fixedHitCount=12;setHits(e,12);hitCount(b,e,true);e.profile.noAttack=true;},
 tick(b,e,a,dt){let u=getHost(e);if(u){if(!present(u)){detach(b,e);return;}e.x=u.x+.12;e.y=u.y+.12;a.pulse=(a.pulse||0)-dt;if(a.pulse<=0){a.pulse+=1;hurt(b,e,u,e.s.atk,'arts',{ignoreSelect:true});}return;}
  u=byPriority(e,targetsNear(b,e,.35)).find(v=>!v.mem.compatPaper?.alive);if(u)attach(b,e,u);
 },death(_c,b,e){detach(b,e);},
}];
const sendPaper=(b,e,u,{direct=false,speed=false}={})=>{const route=remainingRoute(e);route.motion='FLY';route.steps=[{t:'move',p:[u.y,u.x]},...(route.steps||[])];const child=spawnOwned(b,e,PAPER,1,{cap:8,totalCap:32,route,pos:direct?[u.y,u.x]:null})[0];if(child){if(direct)attach(b,child,u);if(speed)b.addBuff(child,{key:'compat:sentPaperSpeed',duration:2,mods:{moveMul:2}});}return child;};
const swordsman=()=>[{
 spawn(_b,e){e.mem.compatPaperAmmo=e.def.raw.spData?.initSp??3;},dealt(c,b,e){if(e.mem.compatPaperAmmo>0&&!c.target.mem.compatPaper?.alive){if(sendPaper(b,e,c.target,{direct:true}))e.mem.compatPaperAmmo--;}}
}];
const scholar=ab=>[skill(ab.sk.Eat,(b,e)=>{const token=b.enemiesInRadius(e.x,e.y,ab.sk.Eat.bb.range_radius??1.5).find(x=>present(x)&&x.defId===PAPER&&!getHost(x));if(!token)return;b._remove(token,'consumed');b.heal(e,e,e.s.maxHp*(ab.sk.Eat.bb.hp_ratio??.6),{self:true});e.mem.compatAtePaper=true;},{cond:(b,e)=>!e.mem.compatAtePaper&&e.hpRatio<(T(ab,'Eat.hp_ratio')??.4)&&b.enemiesInRadius(e.x,e.y,ab.sk.Eat?.bb.range_radius??1.5).some(x=>present(x)&&x.defId===PAPER&&!getHost(x))})];
const caster=ab=>[{spawn(_b,e){e.profile.noAttack=true;}},skill(ab.sk.GlobalAttack,(b,e)=>{const list=byPriority(e,allTargets(b,e)),u=list.find(x=>!x.mem.compatPaper?.alive)||list[0];if(!u)return;abilityAttackFx(b,e,u);hurt(b,e,u,e.s.atk*(ab.sk.GlobalAttack.bb.atk_scale??1),'arts');if(!u.mem.compatPaper?.alive)sendPaper(b,e,u,{speed:true});},{cond:(b,e)=>allTargets(b,e).length>0})];
const deathSplit=ab=>[{
 death(c,b,e){if(c.reason==='killed')spawnOwned(b,e,ab.tS['DeadSpawn.enemy_key'],T(ab,'DeadSpawn.cnt')??1,{cap:20,totalCap:20});},
}];
const porcelain=ab=>[...deathSplit(ab),{
 spawn(_b,_e,a){a.n=0;},attack(c,b,e,a){const s=ab.sk.PowerAttack;if(++a.n%((s?.sp??5)+1))return;castSlot(b,e,s);for(const u of c.targets||[]){const life=u.deploySeq,n=s?.bb.times??4;for(let i=1;i<=n;i++)b.after(i*(s?.bb.duration??20)/n,()=>{if(present(u)&&u.deploySeq===life)hurt(b,e,u,e.s.atk*((s?.bb.atk_scale_init??.3)+(i-1)*(s?.bb.atk_scale_add??.3)),'arts',{ignoreSelect:true,tags:['dot']});});}},
}];
export const COMPATIBILITY_PAPER_KITS=Object.freeze({[PAPER]:paper,enemy_2102_dytmbr:scholar,enemy_2103_dykens:swordsman,enemy_2104_dycast:caster,enemy_1201_sfzhi:deathSplit,enemy_1201_sfzhi_2:deathSplit,enemy_1205_sfpin:porcelain,enemy_1205_sfpin_2:porcelain});
