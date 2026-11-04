import {T,hurt,elem,areaAllies} from './helpers.js';
import {alive,adds} from './additional-leader-helpers.js';

export const ADDITIONAL_SUPPORT_KITS=Object.freeze({
  enemy_1138_tumor:ab=>[{iv:.2,tick(b,e){const u=e.blockedBy;if(alive(u))b.addBuff(u,{key:`additional:tumor:${e.id}`,duration:.3,mods:{aspd:u.base.aspd*(T(ab,'atkSpeedDown.attack_speed')??-.8)}});}}],
  enemy_1164_bmbmot_3:ab=>[
    {iv:1,tick(b,e){b.loseHp(e,e.s.maxHp*(T(ab,'Bleed.hp_ratio')??.05),{source:e});}},
    {sil:true,death(c,b,e){for(const u of areaAllies(b,e,e.x,e.y,1.5)){hurt(b,e,u,e.s.atk*(T(ab,'Boom.atk_scale')??2),'phys');elem(b,e,u,'erosion',e.s.atk*(T(ab,'Boom.ep_damage_ratio')??1.7));}}},
  ],
  enemy_1360_dfello:ab=>[{
    hitOut(c,_b,_e){if(c.dmg.isAttack)c.dmg.amount*=1+(c.target?.blocking?.length||0)*(T(ab,'DamageUp.scale_ratio')??.2);},
    dealt(c,b,e){b.heal(e,e,c.amount*(T(ab,'vampire.heal_scale')??2.2));},
    death(c,b,e){adds(b,e,'enemy_1367_dseed',1,4);},
  }],
  enemy_2013_csbot:ab=>[{iv:1,tick(b,e){if(!e.blockedBy&&!e.mem.leaderObjective)for(const u of areaAllies(b,e,e.x,e.y,99))hurt(b,e,u,T(ab,'poison.damage')??100,'arts');}}],
});
export const ADDITIONAL_SUPPORT_STATS=Object.freeze({
  enemy_1137_plasm:'ordinary spawned aberration; native movement and goal life cost',
  enemy_1334_ristar:'attackable scene star; parent controls protection and explosion',
  enemy_2040_syrott:'attackable corruption tear; parent controls charging and suppression',
  enemy_1367_dseed:'blood amber; native immobile marker transformed by the bloodlord',
});
