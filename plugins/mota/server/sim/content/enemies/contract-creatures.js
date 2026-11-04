// Official level-0 blackboards; contract-only enemies, plus explicit battlefield adaptations for stage devices.
import {T,elem,hurt,areaAllies,setForm} from './helpers.js';
import {ep,resist,maxTargets,taunt} from './archetypes.js';
import {SPECIAL_KITS} from './special.js';
import {investigation} from './investigation.js';
// [ASSUMED] Prefab-only aura geometry: two tiles for reapers, 2.2 tiles for urchin bursts.
const REAPER_RADIUS=2,URCHIN_RADIUS=2.2;
const priority=key=>({spawn(b,e){e.profile.priority=key;}});
const jelly=ab=>[ep('neural',T(ab,'epdamage.attack@ep_damage_ratio')??0)];
const piercer=()=>[priority('lowestHpRatio')];
const hunter=()=>[priority('lowDef')];
const tank=ab=>[{
 tick(b,e,a){if(a.on||e.hpRatio>=.5)return;a.on=true;
  b.addBuff(e,{key:'contract:steamRage',persist:true,mods:{aspd:T(ab,'Rage.attack_speed')??100,moveMul:1+(T(ab,'Rage.move_speed')??1)}});
  ab.immune=new Set([...(ab.immune||[]),'stun','cold','freeze','sleep','levitate']);
  for(const status of ['stun','cold','freeze','sleep','levitate'])b.removeStatus(e,status);
  b.fx('buff',{id:e.id,x:e.x,y:e.y,kind:'rage'});
 }
}];
const reaper=ab=>[ep('neural',T(ab,'epdamage.attack@ep_damage_ratio')??0),{
 iv:.1,
 spawn(_b,e,a){a.awake=false;a.nextPulse=Infinity;e.profile.noAttack=true;},
 taken(c,b,e,a){if(a.awake||!e.alive||!(c.amount>0))return;a.awake=true;a.nextPulse=b.time+(T(ab,'scream.interval')??1);e.profile.noAttack=false;b.addBuff(e,{key:'contract:reaperAwake',persist:true,mods:{moveMul:1+(T(ab,'revive.move_speed')??0)}});setForm(b,e,'awake');},
 tick(b,e,a,dt){
  if(!a.awake)return;
  b.loseHp(e,e.s.maxHp*(T(ab,'revive.hp_ratio')??.04)*dt,{source:e});if(!e.alive)return;
  if(b.time+1e-9<a.nextPulse)return;a.nextPulse+=T(ab,'scream.interval')??1;
  for(const u of areaAllies(b,e,e.x,e.y,REAPER_RADIUS))elem(b,e,u,'neural',e.s.atk*(T(ab,'scream.ep_damage_ratio')??.2));
 }
}];
const urchin=ab=>[{
 spawn(b,e,a){a.lost=0;e.profile.noAttack=true;},
 taken(c,b,e,a){
  if(!(c.amount>0)||!e.alive)return;a.lost+=c.amount;const step=e.s.maxHp*(T(ab,'damage_trigger.hp_ratio')??.15);
  if(a.lost+1e-9<step)return;
  // [ASSUMED] Coalesce thresholds crossed by one hit into one pulse, avoiding simultaneous repeated skill casts.
  a.lost%=step;const skill=ab.sk.Stab;b.fx('explode',{id:e.id,x:e.x,y:e.y,r:URCHIN_RADIUS,kind:'artsSplash'});
  for(const u of areaAllies(b,e,e.x,e.y,URCHIN_RADIUS)){hurt(b,e,u,e.s.atk*(skill?.bb.atk_scale??1),'arts');elem(b,e,u,'neural',e.s.atk*(skill?.bb.ep_damage_ratio??1));}
 }
}];
const coldCaster=ab=>[maxTargets(2),resist(),{
 spawn(b,e,a){a.count=0;},attack(c,b,e,a){if(++a.count%3)return;for(const u of c.targets)b.applyStatus(u,'cold',{source:e,duration:ab.sk.coldattack?.bb.freeze??5});}
}];
const berserker=ab=>[resist(),{hitOut(c){if(c.target?.s.flags.freeze&&c.dmg.isAttack)c.dmg.amount*=T(ab,'atkup.enemy_krgbsk_t[frozen].atk_scale')??1.6;}}];
export const CONTRACT_CREATURE_KITS=Object.freeze({
 enemy_1150_dsjely:jelly,enemy_1150_dsjely_2:jelly,
 enemy_1151_dslntc:reaper,enemy_1151_dslntc_2:reaper,
 enemy_1152_dsurch:urchin,enemy_1152_dsurch_2:urchin,
 enemy_1153_dsexcu:piercer,enemy_1153_dsexcu_2:piercer,
 enemy_1273_stmgun:SPECIAL_KITS.enemy_1273_stmgun_2,
 enemy_1274_stmram:tank,enemy_1274_stmram_2:tank,
 enemy_1314_wdnjd:investigation('scout'),enemy_1314_wdnjd_2:investigation('scout'),
 enemy_1315_wdyjd:investigation('sentry'),enemy_1315_wdyjd_2:investigation('sentry'),
 enemy_1316_wdpjd:investigation('armed'),enemy_1316_wdpjd_2:investigation('armed'),
 enemy_1190_krgbow:hunter,enemy_1190_krgbow_2:hunter,
 enemy_1192_krgscr:coldCaster,enemy_1192_krgscr_2:coldCaster,
 enemy_1193_krgbsk:berserker,enemy_1193_krgbsk_2:berserker,
 enemy_1279_sgbdg:ab=>[taunt(T(ab,'DeathRattle.taunt_level')??1)],
 enemy_1279_sgbdg_2:ab=>[taunt(T(ab,'DeathRattle.taunt_level')??1)],
 enemy_1062_rager:SPECIAL_KITS.enemy_1062_rager_2,
});
export const CONTRACT_CREATURE_STATS=Object.freeze(Object.fromEntries([
 'enemy_1147_dshond','enemy_1147_dshond_2','enemy_1149_dsbow','enemy_1149_dsbow_2',
 'enemy_1099_nbkght','enemy_1102_sdkght','enemy_1102_sdkght_2',
 'enemy_1189_krgaxe','enemy_1189_krgaxe_2',
 'enemy_1012_dcross','enemy_1012_dcross_2','enemy_1298_ymmonk','enemy_1298_ymmonk_2','enemy_1043_zomsbr_2',
].map(key=>[key,'official basic stats; stage-only identity, blood-debt and construction devices are absent'])));
