import {T,hurt,elem,targetsNear,byPriority,areaAllies,castSlot,setForm} from './helpers.js';
import {ep,taunt,setFloat} from './archetypes.js';
import {ELEMENT_KITS} from './element.js';
import {SPECIAL_KITS} from './special.js';
import {present,spawnOwned,fireNative} from './compatibility-helpers.js';
const rebirthKey=(e,ab)=>ab.tS['deathrattle.enemy_key']||ab.tS['Attack.enemy_key'];
const rebirth=()=>({death(c,b,e,_a,ab){if(c.reason!=='killed')return;const key=rebirthKey(e,ab);if(key)b.after(T(ab,'deathrattle.delay','Attack.delay')??1,()=>spawnOwned(b,e,key,1,{cap:1,totalCap:1}));}});
const isCreation=u=>/^enemy_122[01]_/.test(u.defId);
const creation=ab=>[{
 hitIn(c){if(['phys','arts'].includes(c.dmg.type))c.dmg.mul*=1-(T(ab,'dmg_res.damage_resistance')??.9);},
 iv:.1,tick(b,e){const u=e.blockedBy;if(!present(u))return;const count=b.enemies.filter(x=>present(x)&&isCreation(x)&&x.blockedBy===u).length;b.addBuff(u,{key:'compat:creationBlock',duration:.15,mods:{blockCnt:Math.min(T(ab,'buff_to_blocker.max_valid_stack_cnt')??6,count)*(T(ab,'buff_to_blocker.block_cnt')??1)}});},
}];
const chainMage=ab=>[rebirth(),ep('apoptosis',T(ab,'epdamage.attack@ep_damage_ratio')??.3),{
 dealt(c,b,e){const seen=new Set([c.target.id]);let target=c.target,scale=1;for(let i=1;i<(T(ab,'epdamage.attack@max_target')??4);i++){const u=byPriority(e,targetsNear(b,e,T(ab,'epdamage.attack@projectile_range')??1.6,{x:target.x,y:target.y})).find(x=>!seen.has(x.id));if(!u)break;seen.add(u.id);scale*=T(ab,'epdamage.attack@chain.atk_scale')??.85;hurt(b,e,u,e.s.atk*scale,'arts');elem(b,e,u,'apoptosis',e.s.atk*scale*(T(ab,'epdamage.attack@ep_damage_ratio')??.3));b.fx('beam',{from:target.id,to:u.id,x:target.x,y:target.y,kind:'chain',dur:.2});target=u;}},
}];
const supplier=ab=>[{
 silAware:true,
 spawn(b,e){(b._compatSuppliers||=new Set()).add(e);if(b._compatSupplierHook)return;b._compatSupplierHook=true;b.on('damaged',c=>{const s=c.source;if(c.dmg.isAttack&&c.amount>0&&s&&isCreation(s)){const suppliers=[...b._compatSuppliers].filter(x=>present(x)&&!x.s.flags.silence);if(suppliers.length)elem(b,s,c.target,'apoptosis',s.s.atk*(T(suppliers[0].mem.ab,'aura.ep_damage_ratio')??.1));}});},
 iv:.2,tick(b,_e){const list=[...b._compatSuppliers].filter(x=>present(x)&&!x.s.flags.silence),n=Math.min(list.length,T(ab,'aura.enemy_dsuply_t[attr_buff].max_valid_stack_cnt')??5);for(const u of b.enemies)if(present(u)&&isCreation(u))b.addBuff(u,{key:'compat:supplier',duration:.25,mods:{atkPct:n*(T(ab,'aura.enemy_dsuply_t[attr_buff].atk')??.1)}});},
}];
const collector=ab=>[rebirth(),{iv:.2,tick(b,e){const n=b.enemies.filter(x=>present(x)&&isCreation(x)).length;b.addBuff(e,{key:'compat:creationPower',duration:.25,mods:{atkPct:Math.min(n,T(ab,'aura.max_valid_stack_cnt')??6)*(T(ab,'aura.atk')??.15)}});}}];
const bomber=ab=>[rebirth(),{
 hitOut(c,b,e){if(!c.dmg.isAttack)return;c.dmg.cancel=true;const x=c.target.x,y=c.target.y;fireNative(b,e,c.target,'projectile_enemy_dthrow',()=>b.after(T(ab,'Attack.attack@projectile_delay_time')??4,()=>{b.fx('explode',{x,y,r:1.1,kind:'descendantBomb',id:e.id});for(const u of areaAllies(b,e,x,y,T(ab,'Attack.attack@projectile_radius')??1.1))hurt(b,e,u,e.s.atk,'phys');}),{point:{x,y}});},
}];
const punisher=ab=>[rebirth(),{
 sil:true,spawn(_b,_e,a){a.n=0;},attack(_c,b,e,a){if(++a.n%((ab.sk.StunAttack?.sp??3)+1))return;castSlot(b,e,ab.sk.StunAttack);for(const u of areaAllies(b,e,e.x,e.y,1.5))b.applyStatus(u,'stun',{duration:ab.sk.StunAttack?.bb.stun??4,source:e});},
}];
const bones=ab=>[taunt(1),{
 taken(c,b,e){const u=c.source;if(present(u)&&u.side==='ally')b.addBuff(u,{key:'compat:boneRetaliation',duration:T(ab,'Summon.duration')??5,mods:{aspd:T(ab,'Summon.attack_speed')??-40},visible:true});},
 death(c,b,e){if(c.reason==='killed')spawnOwned(b,e,ab.tS['Summon.enemy_key']||'enemy_1367_dseed',T(ab,'Summon.cnt')??2,{cap:2,totalCap:2});},
}];
// A swallowed operator keeps identity, HP and tile reservation; it is returned on every removal path.
const swallow=fly=>ab=>[{
 iv:.1,tick(b,e,a){if(a.host||a.done||!present(e.blockedBy))return;const u=e.blockedBy;a.done=true;a.host=u;castSlot(b,e,ab.sk.Devour);u.swing=false;b.releaseBlocked(u);b._setHidden(u,true);b._unblock(e);e.profile.melee=false;
  if(fly){setFloat(b,e,true);b.addBuff(e,{key:'compat:devourFly',persist:true,mods:{defFlat:T(ab,'Fly.def')??-1500}});setForm(b,e,'fly');}
  else b.addBuff(e,{key:'compat:devourArmour',persist:true,mods:{defFlat:T(ab,'Stronger.def')??700,moveMul:1+(T(ab,'Stronger.move_speed')??-.3)}});
 },
 death(_c,b,_e,a){if(a.host?.alive)b._setHidden(a.host,false);a.host=null;},
}];
export const COMPATIBILITY_SARKAZ_KITS=Object.freeze({
 enemy_1220_dzoms:creation,enemy_1220_dzoms_2:creation,enemy_1221_dzomg:creation,enemy_1221_dzomg_2:creation,
 enemy_1222_dpvt:()=>[rebirth()],enemy_1222_dpvt_2:()=>[rebirth()],enemy_1225_dkmage:chainMage,enemy_1225_dkmage_2:chainMage,
 enemy_1224_dsuply:supplier,enemy_1224_dsuply_2:supplier,enemy_1226_dklord:collector,enemy_1226_dklord_2:collector,
 enemy_1361_dthrow:bomber,enemy_1362_dfat:punisher,enemy_1363_spnshd:bones,enemy_1363_spnshd_2:bones,
 enemy_1364_spnaxe:SPECIAL_KITS.enemy_1364_spnaxe_2,
 enemy_1271_nhkodo:swallow(false),enemy_1271_nhkodo_2:swallow(false),enemy_2105_dyrnge:swallow(true),
 enemy_1275_dwlock:ELEMENT_KITS.enemy_1275_dwlock_2,
});
