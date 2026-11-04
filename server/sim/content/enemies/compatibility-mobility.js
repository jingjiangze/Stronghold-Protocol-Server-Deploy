import {T,hurt,elem,areaAllies,targetsNear,byPriority,castSlot,setForm} from './helpers.js';
import {skill,stealth,setFloat,blinkForward,blockWeight,ep} from './archetypes.js';
import {present,spawnOwned,animationTiming,channel} from './compatibility-helpers.js';
import {AUTOMATON_RULES as AUTO,automatonTarget} from '../../../../shared/sanctumAutomaton.js';
const acceleration=fly=>ab=>[{
 spawn(b,e,a){a.next=b.time+(T(ab,'Rush.predelay_duration')??3);a.n=0;if(!fly)b.addBuff(e,{key:'compat:rushUnblock',persist:true,flags:{unblockable:true}});},
 tick(b,e,a){if(a.flying||b.time<a.next)return;a.next+=T(ab,fly?'Rush.ymggld_t[trigger].interval':'Rush.skzirn_t[trigger].interval')??.5;a.n++;
  const add=T(ab,fly?'Rush.ymggld_t[trigger].move_speed':'Rush.skzirn_t[trigger].move_speed')??.5;
  b.addBuff(e,{key:'compat:acceleration',persist:true,mods:{moveFlat:add*a.n}});
  if(fly&&a.n>=(T(ab,'Rush.ymggld_t[trigger].trigger_cnt')??28)){a.flying=true;setFloat(b,e,true);setForm(b,e,'fly');castSlot(b,e,ab.sk.TakeOff);b.addBuff(e,{key:'compat:acceleration',persist:true,mods:{moveFlat:T(ab,'FlyMoveSpeedAdd.move_speed')??8}});}
 },
 death(c,b,e){if(fly||c.reason!=='leak')return;for(const u of b.allies())hurt(b,e,u,e.s.atk,'phys');for(const u of b.enemies)if(present(u)&&u!==e)b.dealDamage(e,u,{amount:e.s.atk,type:'phys',canDodge:false,ignoreSelect:true});},
}];
const automaton=()=>[{
 spawn(b,e,a){
  a.next=b.time+AUTO.interval;a.n=0;e.profile.noAttack=true;
  b.addBuff(e,{key:'compat:rushUnblock',persist:true,flags:{unblockable:true}});
  b.addBuff(e,{key:'compat:acceleration',persist:true,mods:{moveFlat:AUTO.initialSpeed-e.base.moveSpeed}});
  a.goal=automatonTarget(b.rect,(r,c)=>b.grid.walkable(r,c));b.rerouteEnemy(e,a.goal);
  b.on('beforeEnemyLeak',ctx=>{if(ctx.enemy!==e||a.detonating)return;ctx.cancelled=true;if(a.armed)return;
   a.armed=true;a.explodeAt=b.time+AUTO.warning;b.addBuff(e,{key:'compat:automatonWarning',persist:true,flags:{noMove:true}});
   b.fx('automatonWarning',{id:e.id,x:e.x,y:e.y,r:1.1,dur:AUTO.warning});
  });
 },
 tick(b,e,a){if(a.armed){if(b.time+1e-9>=a.explodeAt){a.detonating=true;b.leak(e);}return;}if(b.time<a.next)return;a.next+=AUTO.interval;
  const speed=Math.min(AUTO.maxSpeed,AUTO.initialSpeed+AUTO.step*++a.n);b.addBuff(e,{key:'compat:acceleration',persist:true,mods:{moveFlat:speed-e.base.moveSpeed}});
 },
 death(c,b,e){if(c.reason!=='leak')return;b.fx('explode',{id:e.id,x:e.x,y:e.y,r:1.5});
  for(const u of [...b.allies(),...b.enemies])if(u!==e&&present(u))b.dealDamage(e,u,{amount:Math.min(e.s.atk*AUTO.damageScale,u.s.maxHp*AUTO.maxHpDamage),type:'phys',canDodge:false,ignoreSelect:true});
 },
}];
const jump=ab=>[skill(ab.sk.Jump,(b,e)=>{const dur=animationTiming(e,['Jump'],2);setFloat(b,e,true);setForm(b,e,'fly');b._unblock(e);b.addBuff(e,{key:'compat:ninjaLeap',duration:dur,mods:{moveMul:1+(T(ab,'JumpSpeedUp.move_speed')??3)},onExpire(){if(e.alive){setFloat(b,e,false);setForm(b,e,null);}}});},{cond:(_b,e)=>!!e.blockedBy})];
const assassin=ab=>[stealth(),{spawn(b,e){b.addBuff(e,{key:'compat:assassinEvade',persist:true,mods:{dodgePhys:T(ab,'Evade.prob')??.4,dodgeArts:T(ab,'Evade.prob')??.4}});},
 tick(_b,e,a){const revealed=!!e.blockedBy||!!e.s.flags.stealthOff;if(revealed&&!a.revealed)a.empowered=true;a.revealed=revealed;},
 hitOut(c,_b,_e,a){if(c.dmg.isAttack&&a.empowered)c.dmg.amount*=ab.sk.InvisibleCombat?.bb.atk_scale??2;},attack(_c,_b,_e,a){a.empowered=false;},
 taken(_c,b,e,a){if(a.blinked||e.hpRatio>=(ab.sk.Blink?.bb.max_hp_ratio??.5))return;a.blinked=true;castSlot(b,e,ab.sk.Blink);blinkForward(b,e,ab.sk.Blink?.bb.dist??1.5);},
}];
const outpost=ab=>[{
 tick(b,e,a){if(a.done||!targetsNear(b,e,e.base.rangeRadius).length)return;a.done=true;const dur=T(ab,'Attack.duration')??20;b.addBuff(e,{key:'compat:outpost',duration:dur,mods:{defFlat:T(ab,'Attack.def')??300},flags:{noMove:true},visible:true});castSlot(b,e,ab.sk.Attack,dur);},
}];
const mother=ab=>[{spawn(_b,e){e.profile.canTarget=u=>!u.isFlying;},dealt(c,b,e){spawnOwned(b,e,ab.tS['Attack.enemy_key']||'enemy_2024_synut',1,{cap:8,totalCap:32,pos:[c.target.y,c.target.x]});}}];
const guide=ab=>[skill(ab.sk.Guide,(b,e)=>{const s=ab.sk.Guide,u=byPriority(e,targetsNear(b,e,e.base.rangeRadius))[0];if(!u)return;const dur=s.bb.anim_duration??5,life=u.deploySeq;castSlot(b,e,s,dur);const cast=channel(b,e,'compat:guide',dur);
 b.after(dur,()=>{if(cast.cancelled||!present(e)||!present(u)||u.deploySeq!==life||e.s.flags.stun||e.s.flags.silence)return;hurt(b,e,u,e.s.atk*(s.bb.atk_scale??2),'arts');b.addBuff(e,{key:'compat:guidedHaste',duration:s.bb.duration??20,mods:{aspd:s.bb.attack_speed??100},visible:true});},{owner:e});
},{sil:true,cond:(b,e)=>targetsNear(b,e,e.base.rangeRadius).length>0})];
const transfer=ab=>[{iv:.1,tick(b,e){const u=b.enemiesInRadius(e.x,e.y,T(ab,'1.range_radius')??.8).find(x=>x!==e&&present(x)&&!/^enemy_10164_/.test(x.defId)&&(x.mem.compatTransfers||0)<(T(ab,'1.max_stack_cnt')??3));if(!u)return;u.mem.compatTransfers=(u.mem.compatTransfers||0)+1;b.addBuff(u,{key:'compat:transfer:'+e.id,persist:true,mods:{atkFlat:e.s.atk*(T(ab,'1.atk_scale')??.3),defFlat:e.s.def*(T(ab,'1.def_scale')??1),resFlat:e.s.res*(T(ab,'1.magic_resistance_scale')??1)}});b._remove(e,'disappear');}}];
const blinker=back=>ab=>[...(back?[ep('frenzy',T(ab,'epAttack.attack@ep_damage_ratio')??.25)]:[]),{
 taken(c,b,e,a){if(!present(c.source)||b.time<(a.next??(back?ab.sk.Blink?.icd??2:0)))return;const u=c.source;let x=u.x+(e.x>=u.x?.4:-.4),y=u.y;
  if(back){const dx=e.x-u.x,dy=e.y-u.y,n=Math.sqrt(dx*dx+dy*dy)||1,d=ab.sk.Blink?.bb.dist??2;x=e.x+dx/n*d;y=e.y+dy/n*d;}
  if(!b.grid.groundPassable(Math.round(y),Math.round(x)))return;a.next=b.time+(ab.sk.Blink?.cd??30);b._unblock(e);const fx=e.x,fy=e.y;e.x=x;e.y=y;if(e.route)e.route.pts=null;castSlot(b,e,ab.sk.Blink);b.fx('blink',{id:e.id,x,y,fx,fy});
 },
}];
const golem=ab=>[blockWeight(4),{
 spawn(_b,_e,a){a.n=0;a.stacks=0;},taken(c,b,e,a){if(!(c.amount>0)||c.dmg?.type==='element'||c.dmg?.tags?.includes('hpLoss'))return;if(++a.n<(T(ab,'HpReduce.attack_time')??10))return;a.n=0;a.stacks=Math.min(T(ab,'HpReduce.max_stack_cnt')??10,a.stacks+1);b.addBuff(e,{key:'compat:golemLoss',persist:true,interval:T(ab,'HpReduce.interval')??1,onTick(){if(e.alive)b.loseHp(e,(T(ab,'HpReduce.damage')??300)*a.stacks,{source:e});}});},
 tick(b,e,a){const tile=e.tileR+':'+e.tileC;if(a.tile===tile)return;const first=a.tile==null;a.tile=tile;if(first)return;for(const u of areaAllies(b,e,e.x,e.y,T(ab,'TileDamage.range_radius')??1.7))hurt(b,e,u,e.s.atk*(T(ab,'TileDamage.attack_scale')??.5),'phys');b.fx('slam',{id:e.id,x:e.x,y:e.y,r:1.7});},
}];
const parasite=mad=>ab=>[...(mad?[ep('frenzy',T(ab,'epAttack.attack@ep_damage_ratio')??.3)]:[]),{
 spawn(b,e,a){a.next=b.time+(mad?ab.sk.Jump?.icd??15:0);if(!b._compatBiteMissHook){b._compatBiteMissHook=true;const rolls=new WeakMap();b.on('hit',c=>{const u=c.source,d=c.dmg,buff=u?.findBuff('compat:biteBlind');if(!buff||!d.isAttack||!['phys','arts'].includes(d.type))return;const old=rolls.get(u);const miss=d.attackId&&old?.id===d.attackId?old.miss:b.rng()<.8;if(d.attackId)rolls.set(u,{id:d.attackId,miss});if(miss)d.cancel=true;});}},
 tick(b,e,a,dt){if(a.host){if(!present(a.host)||mad&&b.time>=a.until){b._setHidden(e,false);a.host=null;e.profile.noAttack=false;return;}e.x=a.host.x;e.y=a.host.y;a.pulse-=dt;if(a.pulse<=0){a.pulse+=mad?ab.sk.Jump?.bb.hit_interval??1.5:e.s.interval;hurt(b,e,a.host,e.s.atk,'phys',{ignoreSelect:true});if(mad){elem(b,e,a.host,'frenzy',e.s.atk*(ab.sk.Jump?.bb.ep_damage_ratio??.3));b.addBuff(a.host,{key:'compat:biteBlind',duration:1.6,visible:true});}}return;}
  if(b.time<a.next||e.s.flags.stun||e.s.flags.silence)return;const u=byPriority(e,targetsNear(b,e,e.base.rangeRadius||1))[0];if(!u)return;a.host=u;a.pulse=0;a.until=b.time+(ab.sk.Jump?.bb.duration??10);a.next=b.time+(ab.sk.Jump?.cd??40);e.profile.noAttack=true;b._unblock(e);b._setHidden(e,true);castSlot(b,e,ab.sk.Jump,a.until-b.time);
 },
 death(_c,b,e,a){if(a.host)b.removeBuff(a.host,'compat:biteBlind');a.host=null;},
}];
const mimic=()=>[{
 spawn(b,e){setForm(b,e,'disguised');},taken(_c,b,e,a){if(a.shown)return;a.shown=true;setForm(b,e,'normal');},
}];
const crossbow=ab=>[{
 tick(b,e){const commanded=e.buffs.some(x=>x.key.startsWith('training:command'));const r=T(ab,commanded?'ExtraPowerListener.radius_2':'ExtraPowerListener.radius_1')??(commanded?.5:1.5);e.profile.melee=targetsNear(b,e,r).length>0;e.profile.blockFree=!e.profile.melee;},
 hitOut(c,_b,e){if(c.dmg.isAttack&&!e.profile.melee)c.dmg.amount*=T(ab,'ExtraPowerListener.attack@atk_scale_2')??2.5;},
}];
const families=[['enemy_10117_ymggld',acceleration(true)],['enemy_10113_ymgung',jump],['enemy_1419_mmcike',assassin],['enemy_1300_ymmir',guide],['enemy_10164_tjgxb',transfer],['enemy_1399_dhtb',parasite(false)]];
export const COMPATIBILITY_MOBILITY_KITS=Object.freeze(Object.fromEntries([...families.flatMap(([key,fn])=>key==='enemy_1419_mmcike'?[[key,fn]]:[[key,fn],[key+'_2',fn]]),['enemy_2022_syzeni',outpost],['enemy_2023_sypult',mother],['enemy_2068_skzirn',automaton],['enemy_2134_shrshep',blinker(true)],['enemy_2135_shkrbt',blinker(false)],['enemy_2136_shcolo',golem],['enemy_2137_shsdgo',parasite(true)],['enemy_2133_shdopl',mimic],['enemy_10121_uasnip_2',crossbow]]));
