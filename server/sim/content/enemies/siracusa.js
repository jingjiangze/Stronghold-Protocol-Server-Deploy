import {T,hurt,elem,targetsNear,byPriority,areaAllies,castSlot} from './helpers.js';
import {skill,stealth,taunt,maxTargets,blockWeight} from './archetypes.js';
import {present,spawnOwned,animationTiming,channel} from './compatibility-helpers.js';
const familyState=b=>b._siracusaDebt||=( {value:0,until:0,phases:0,root:null} );
const clearing=b=>b.time<familyState(b).until;
function debt(b,e,n){const st=familyState(b);if(clearing(b)||!(n>0))return;st.root||=e;st.value+=n;if(st.value<1000)return;st.value=0;st.until=b.time+30;st.phases++;b.fx('phase',{id:e.id,x:e.x,y:e.y,kind:'siracusaClearing',dur:30});if(st.phases<=2)spawnOwned(b,st.root,'enemy_1283_sgkill_2',2,{cap:4,totalCap:4});}
const ledger=ab=>({spawn(b,e){familyState(b);e.mem.siracusaSettlement=false;},death(c,b,e){if(c.reason==='killed')debt(b,e,T(ab,'DeathRattle.sp')??0);}});
const soldier=ab=>[ledger(ab)];
const intimidator=ab=>[ledger(ab),taunt(T(ab,'DeathRattle.taunt_level')??1)];
const bow=ab=>[ledger(ab),{tick(b,e){e.profile.dmgType=clearing(b)?'arts':'phys';}}];
const mage=ab=>[ledger(ab),maxTargets(2),skill(ab.sk.AddVG,(b,e)=>{const s=ab.sk.AddVG,dur=s?.bb.duration??8;const cast=channel(b,e,'siracusa:ledgerChannel',dur,{},false);for(let i=1;i<=dur;i++)b.after(i,()=>{if(!cast.cancelled&&present(e)&&!e.s.flags.stun)debt(b,e,s?.bb.sp??5);},{owner:e});},{cond:b=>!clearing(b)})];
const elder=ab=>[ledger(ab),{
 spawn(b,e){b.on('death',c=>{const u=c.unit;if(c.reason==='killed'&&present(e)&&u!==e&&u?.side==='enemy'&&(u.x-e.x)*(u.x-e.x)+(u.y-e.y)*(u.y-e.y)<=6.25)debt(b,e,T(ab,'AuraVG.sp')??40);},{owner:e});},
}];
const assassin=ab=>[ledger(ab),stealth(),{
 tick(b,e,a){const on=clearing(b);if(on&&!a.on){a.n=Math.min(T(ab,'Passive.max_stack_cnt')??5,(a.n||0)+1);b.addBuff(e,{key:'siracusa:clearingPower',persist:true,mods:{aspd:(T(ab,'Passive.attack_speed')??50)*a.n,atkPct:(T(ab,'Passive.atk')??.15)*a.n,defPct:(T(ab,'Passive.def')??.15)*a.n}});}a.on=on;},
}];
// Stronghold has no firework launcher. A local 20s preparation / 15s carnival cycle supplies the native mode switch.
function carnival(b){const s=b._siracusaCarnival||=( {next:b.time+20,on:false} );let n=0;while(b.time>=s.next&&n++<4){s.on=!s.on;s.next+=s.on?15:20;}return s.on;}
const revel=()=>({spawn(b){carnival(b);},tick(b,e,a){const on=carnival(b);e.mem.siracusaCarnival=on;if(on)b.addBuff(e,{key:'siracusa:carnivalReveal',duration:.12,flags:{stealthOff:true}});if(on!==a.on){a.on=on;b.fx('buff',{id:e.id,x:e.x,y:e.y,kind:on?'carnivalOn':'carnivalOff'});}}});
const contestant=()=>[stealth(),revel()];
const revealed=e=>!!(e.blockedBy||e.s.flags.stealthOff||e.mem.siracusaCarnival);
const fireDancer=ab=>[...contestant(),{
 tick(_b,e){e.profile.noAttack=!revealed(e);e.profile.dmgType='arts';},dealt(c,b,e){elem(b,e,c.target,'burn',e.s.atk*(T(ab,'mode.attack@ep_damage_ratio')??.1));},
}];
const sax=ab=>[...contestant(),{
 silAware:true,
 spawn(_b,_e,a){a.left=ab.sk.fire?.icd??3;},tick(b,e,a,dt){const open=revealed(e);e.profile.noAttack=!open;if(a.target){if(!present(a.target)||!open||e.s.flags.stun||e.s.flags.silence||b.time>=a.until){a.target=null;b.removeBuff(e,'siracusa:saxChannel');return;}a.pulse-=dt;if(a.pulse<=0){a.pulse+=ab.sk.fire?.bb.hit_interval??.5;hurt(b,e,a.target,e.s.atk*(ab.sk.fire?.bb.atk_scale??.2),'arts');elem(b,e,a.target,'burn',e.s.atk*(ab.sk.fire?.bb.ep_damage_ratio??.1));}return;}
  a.left-=dt;if(a.left>0||!open||!e.canAct||e.s.flags.silence)return;const u=byPriority(e,targetsNear(b,e,2.5))[0];if(!u)return;a.target=u;a.pulse=0;a.until=b.time+(ab.sk.fire?.bb['enemy_cnvsax[cd].interval']??6);a.left=ab.sk.fire?.bb['enemy_cnvsax[cd].cooldown']??10;castSlot(b,e,ab.sk.fire,a.until-b.time);b.addBuff(e,{key:'siracusa:saxChannel',duration:a.until-b.time,flags:{disarm:true,noMove:true}});
 },
}];
const dancing=ab=>[...contestant(),{
 iv:1,tick(b,e){e.profile.noAttack=true;const prefix=revealed(e)?'aura2.':'aura.';for(const u of areaAllies(b,e,e.x,e.y,T(ab,prefix+'range_radius')??1.5)){hurt(b,e,u,e.s.atk*(T(ab,prefix+'atk_scale')??1),'arts');elem(b,e,u,'burn',e.s.atk*(T(ab,prefix+'ep_damage_ratio')??.5));}},
}];
const guarded=ab=>({hitIn(c,b){if(!carnival(b)&&['phys','arts'].includes(c.dmg.type))c.dmg.mul*=1-(T(ab,'act38side_scale.damage_resistance')??.9);}});
const vendor=ab=>[blockWeight(3),revel(),guarded(ab),skill(ab.sk.summon,(b,e)=>spawnOwned(b,e,ab.sk.summon?.bs.enemy_key||(e.defId.endsWith('_2')?'enemy_10037_cnvpcar_2':'enemy_10037_cnvpcar'),1,{cap:4,totalCap:12}))];
const pizza=ab=>[blockWeight(3),revel(),guarded(ab),{
 iv:.1,tick(b,e,a){a.touching||=new Set();const now=new Set();for(const u of targetsNear(b,e,.7)){now.add(u.id);if(!a.touching.has(u.id))hurt(b,e,u,e.s.atk,'phys');}a.touching=now;},
}];
const beer=ab=>[blockWeight(3),revel(),guarded(ab),skill(ab.sk.bigAttack,(b,e)=>{const s=ab.sk.bigAttack,u=byPriority(e,targetsNear(b,e,1.5))[0];if(!u)return;const wind=animationTiming(e,['Skill'],2);castSlot(b,e,s,wind);const cast=channel(b,e,'siracusa:beerCharge',wind);const life=u.deploySeq;b.after(wind,()=>{if(cast.cancelled||!present(e)||!present(u)||u.deploySeq!==life||e.s.flags.silence||e.s.flags.stun)return;for(const v of areaAllies(b,e,u.x,u.y,1.5)){hurt(b,e,v,e.s.atk,'phys');b.addBuff(v,{key:'siracusa:beerBlock',duration:s?.bb.duration??10,mods:{blockCnt:s?.bb.block_cnt??-1},visible:true});}},{owner:e});},{sil:true,cond:(b,e)=>targetsNear(b,e,1.5).length>0})];
const balloon=()=>[revel(),{spawn(_b,e){e.profile.noAttack=true;},death(c,b,e){if(c.reason==='killed'&&carnival(b)){b._siracusaCarnival.next+=15*.03;b.fx('buff',{id:e.id,x:e.x,y:e.y,kind:'carnivalExtension'});}}}];
const families=[['enemy_1277_sgman',soldier],['enemy_1278_sgbow',bow],['enemy_1279_sgbdg',intimidator],['enemy_1280_sgmag',mage],['enemy_1282_sgelder',elder],['enemy_1283_sgkill',assassin],['enemy_10031_cnvsld',contestant],['enemy_10032_cnvsnp',contestant],['enemy_10033_cnvbsk',fireDancer],['enemy_10034_cnvsax',sax],['enemy_10035_cnvdnc',dancing],['enemy_10036_cnvpvd',vendor],['enemy_10038_cnvpiz',pizza],['enemy_10039_cnvber',beer],['enemy_10040_cnvbln',balloon]];
export const SIRACUSA_KITS=Object.freeze(Object.fromEntries(families.flatMap(([key,fn])=>[[key,fn],[key+'_2',fn]])));
