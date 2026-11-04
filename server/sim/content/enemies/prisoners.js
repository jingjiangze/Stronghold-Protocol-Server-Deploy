import {kitPrisoner} from './archetypes.js';
import {T} from './helpers.js';
const present=u=>u?.alive&&u.deployed&&!u.removed;
const prisoner=key=>ab=>{
 const list=kitPrisoner(key.startsWith('enemy_1121_'))(ab),state=list[0],caster=key.startsWith('enemy_1120_'),shooter=key.startsWith('enemy_1117_'),liberate=state.liberate,spawn=state.spawn;
 state.spawn=(b,e,a)=>{spawn(b,e,a);if(caster)e.profile.noAttack=true;};
 // The handbook exposes NO_DAMAGE for the confined caster; [ASSUMED] its liberated Arts attack follows the caster role.
 state.liberate=(b,e,a)=>{liberate(b,e,a);if(!a.free)return;if(caster){e.profile.noAttack=false;e.profile.melee=false;e.profile.dmgType='arts';e.profile.maxTargets=T(ab,'liberty.attack@max_target')??2;}if(shooter)e.profile.dmgType='arts';};
 if(shooter)list.push({hitOut(c,_b,_e){if(state.free&&c.dmg.isAttack)c.dmg.type='arts';}});
 if(caster)list.push({iv:.2,tick(b){const casters=b.enemies.filter(u=>present(u)&&/^enemy_1120_vofwiz/.test(u.defId));const bonus=Math.max(0,...casters.map(u=>T(u.mem.ab,'atkspeedup.attack_speed')??30));for(const u of b.enemies)if(present(u))b.addBuff(u,{key:'prisoner:casterAura',duration:.3,mods:{aspd:bonus}});}});
 return list;
};
export const PRISONER_KEYS=Object.freeze(['enemy_1116_liprr','enemy_1116_liprr_2','enemy_1117_liiprr','enemy_1117_liiprr_2','enemy_1118_lidbox','enemy_1118_lidbox_2','enemy_1119_vofsd','enemy_1119_vofsd_2','enemy_1120_vofwiz','enemy_1120_vofwiz_2','enemy_1121_lifbos','enemy_1121_lifbos_2']);
export const PRISONER_KITS=Object.freeze(Object.fromEntries(PRISONER_KEYS.map(key=>[key,prisoner(key)])));
