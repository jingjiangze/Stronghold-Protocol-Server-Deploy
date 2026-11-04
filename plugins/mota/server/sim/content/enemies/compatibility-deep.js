import {T,hurt,elem,targetsNear,byPriority,areaAllies,castSlot,setForm,abilityAttackFx} from './helpers.js';
import {capEnemyBurstHit} from '../../../../shared/enemyPressure.js';
import {skill,stealth} from './archetypes.js';
import {passengerBus} from './passengers.js';
import {hypot} from '../../detmath.js';
import {present,spawnOwned,animationTiming,fireNative,channel} from './compatibility-helpers.js';
const family=(e,key)=>e.defId===key||e.defId===key+'_2';
const cue=(b,e,clip)=>b.fx('enemyCue',{id:e.id,x:e.x,y:e.y,clip});
const mounted=ab=>[passengerBus(ab,false,{max:1,radius:.2,filter:p=>family(p,'enemy_10046_pshark'),unloadDelay:.9,onChange(b,e,n){setForm(b,e,n?'mounted':null);b.addBuff(e,{key:'compat:mountedWeight',persist:true,mods:{weight:n}});}}),{
 spawn(_b,_e,a){a.left=ab.sk.M0SplashCannon?.icd??15;},
 tick(b,e,a,dt){a.left-=dt;if(a.left>0||e.s.flags.stun)return;const u=byPriority(e,targetsNear(b,e,e.base.rangeRadius))[0];if(!u)return;
  const loaded=!!e.mem.ab.list.find(x=>x.passengers?.length),s=loaded?ab.sk.M1SplashCannon:ab.sk.M0SplashCannon;
  a.left=s?.cd??15;const windup=animationTiming(e,[loaded?'2_Skill_1':'1_Skill_1'],2),x=u.x,y=u.y;castSlot(b,e,s,windup);e.atkCd=Math.max(e.atkCd,windup);const cast=channel(b,e,'compat:charge',windup,{},false);
  b.after(windup,()=>{if(cast.cancelled||!present(e)||e.s.flags.stun)return;fireNative(b,e,u,'projectile_enemy_shrknt_s',()=>{for(const v of areaAllies(b,e,x,y,1.5))if(v.tileR===Math.round(y)||v.tileC===Math.round(x)){hurt(b,e,v,e.s.atk*(s?.bb.magic_atk_scale??3),'arts');if(v.alive)b.applyStatus(v,'stun',{duration:s?.bb.stun??8,source:e});}},{point:{x,y}});},{owner:e});
 },
}];
// PRTS: radius 1.5, shield-side physical/Arts reduction 60%; first acquired same-name aura wins.
const chef=()=>[{
 spawn(b,e){(b._compatChefs||=new Set()).add(e);if(b._compatChefHook)return;b._compatChefHook=true;
  b.on('hit',c=>{const u=c.target,s=c.source;if(u?.side!=='enemy'||!s||!['phys','arts'].includes(c.dmg.type))return;
   const inRange=p=>present(p)&&(p.x-u.x)*(p.x-u.x)+(p.y-u.y)*(p.y-u.y)<=2.25;
   let guard=u.mem.compatChef;if(!inRange(guard))guard=u.mem.compatChef=[...b._compatChefs].find(inRange)||null;
   if(guard&&(s.x-guard.x)*(guard.mem.compatChefFacing??-1)>1e-6)c.dmg.mul*=.4;
  });
 },
 tick(_b,e,a){if(a.px!=null&&Math.abs(e.x-a.px)>1e-6)e.mem.compatChefFacing=e.x>a.px?1:-1;a.px=e.x;},
}];
const shadow=ab=>[stealth(),{iv:.1,tick(b,e){const r=T(ab,'traitAbility.range_radius')??1.5;if(b.enemiesInRadius(e.x,e.y,r).some(o=>o!==e&&present(o)&&family(o,'enemy_1174_dufrgd')))b.addBuff(e,{key:'compat:shadowFriend',duration:.15,mods:{batPct:(T(ab,'traitAbility.base_attack_time')??-1.2)/e.base.bat}});}}];
const fireball=ab=>[{
 spawn(b,e,a){a.started=b.time;e.profile.noAttack=true;e.mem.compatTravel=0;b.addBuff(e,{key:'compat:flameBody',persist:true,flags:{unblockable:true,noDisplace:true}});},
 tick(b,e,a){if(a.px!=null)e.mem.compatTravel+=hypot(e.x-a.px,e.y-a.py);a.px=e.x;a.py=e.y;
  const u=targetsNear(b,e,.6).find(v=>v.ground&&!v.s.flags.liftoff);if(!u)return;
  // Travel decay uses the native Weaken attack modifier, reaching -70% after ten seconds.
  const age=b.time-a.started,scale=Math.max(.3,1-.7*Math.min(1,Math.max(0,age)/(T(ab,'Weaken.duration')??10)));
  for(const v of areaAllies(b,e,e.x,e.y,1.8))if(!v.s.flags.liftoff){hurt(b,e,v,e.s.atk*scale,'arts');elem(b,e,v,'burn',e.s.atk*scale*(T(ab,'epdamage.attack@ep_damage_ratio')??1));}b.kill(e,u);
 },
}];
const fireCaster=ab=>{
 const make=(s,blocked)=>skill(s,(b,e)=>{const key=s.bs.enemy_key||'enemy_1177_dufrbl';spawnOwned(b,e,key,1,{cap:6,totalCap:32});},{cond:(_b,e)=>!!e.blockedBy===blocked});
 return[make(ab.sk.SummonFireBall,false),make(ab.sk.SummonFireBall2,true)];
};
const flamethrower=ab=>[{
 silAware:true,
 spawn(_b,e,a){a.left=0;},
 tick(b,e,a,dt){if(a.dying)return;a.left-=dt;
  if(a.target){if(!present(a.target)||e.s.flags.stun||b.time>=a.until){a.target=null;b.removeBuff(e,'compat:flameChannel');return;}
   a.pulse-=dt;if(a.pulse<=0){a.pulse+=ab.sk.Flame?.bb.hit_interval??.5;const target=a.target,hits=Math.ceil((ab.sk.Flame?.bb['duspfr_flame[cd].interval']??6)/(ab.sk.Flame?.bb.hit_interval??.5));fireNative(b,e,target,'projectile_enemy_duspfr',()=>{if(!present(target))return;hurt(b,e,target,capEnemyBurstHit(b,e,e.s.atk*(ab.sk.Flame?.bb.atk_scale??.12),hits),'arts');elem(b,e,target,'burn',e.s.atk*(ab.sk.Flame?.bb.ep_damage_ratio??.06));});}return;
  }
  if(a.left>0||e.s.flags.stun)return;const u=byPriority(e,targetsNear(b,e,2.5))[0];if(!u)return;
  const s=ab.sk.Flame;a.target=u;a.until=b.time+(s?.bb['duspfr_flame[cd].interval']??6);a.pulse=0;a.left=(s?.bb['duspfr_flame[cd].duration']??10.6)+(s?.bb['duspfr_flame[cd].cooldown']??10);
  castSlot(b,e,s,a.until-b.time);b.addBuff(e,{key:'compat:flameChannel',duration:a.until-b.time,flags:{noMove:true,disarm:true}});
 },
 killed(c,b,e,a){if(a.dying||e.s.flags.silence)return false;a.dying=true;a.target=null;e.hp=1;e.profile.noAttack=true;b._unblock(e);b.addBuff(e,{key:'compat:deathChannel',persist:true,flags:{invulnerable:true,untargetable:true,unblockable:true,noMove:true}});
  const delay=animationTiming(e,['DieBoom'],1.5);castSlot(b,e,ab.sk.DeadBoom,delay);cue(b,e,'DieBoom');
  b.after(delay,()=>{if(!e.alive)return;for(const u of areaAllies(b,e,e.x,e.y,1.5)){abilityAttackFx(b,e,u);hurt(b,e,u,e.s.atk*(ab.sk.DeadBoom?.bb.atk_scale??1),'arts');}for(const other of b.enemiesInRadius(e.x,e.y,1.5))if(other!==e&&family(other,'enemy_1173_duspfr')&&present(other))b.kill(other,c.killer);b.removeBuff(e,'compat:deathChannel');b.kill(e,c.killer);});return true;
 },
}];
const crackShield=()=>[{
 spawn(b,e){b.addBuff(e,{key:'compat:crackShield',persist:true,shield:e.s.maxHp*.05,mods:{aspd:100},visible:true});},
 hitIn(c,_b,e){if(e.findBuff('compat:crackShield'))c.dmg.mul*=.5;},
}];
const families=[['enemy_10047_shrknt',mounted],['enemy_10048_prtsld',chef],['enemy_1175_dushdo',shadow],['enemy_1176_dusocr',fireCaster],['enemy_1173_duspfr',flamethrower]];
export const COMPATIBILITY_DEEP_KITS=Object.freeze(Object.fromEntries([...families.flatMap(([key,fn])=>[[key,fn],[key+'_2',fn]]),['enemy_1177_dufrbl',fireball],['enemy_10127_rkmbst',crackShield]]));
