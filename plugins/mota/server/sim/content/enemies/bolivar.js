// Official CR enemies, handbook R18–R35 and enemy_database level 0.
// The pre-existing scout, heavy crossbow and drone implementations keep priority.
import {SPECIAL_KITS} from './special.js';
import {INVISIBLE_KITS} from './invisible.js';
import {FLY_KITS} from './fly.js';
import {skill} from './archetypes.js';
import {T,hurt,expose,areaAlliesInTiles,abilityAttackFx,castSlot,setForm} from './helpers.js';
import {canTargetAlly} from '../../targeting.js';
import {hypot} from '../../detmath.js';
import {capEnemyBurstHit} from '../../../../shared/enemyPressure.js';

// Owner feedback 2026-10-27: a complete ordinary multi-hit burst stays within 3000 raw damage.
// [ASSUMED] Reuse the existing heavy-crossbow reach; lane skills hit their first selectable target.
const CROSS_REACH = 6;
const present = u => u?.alive && u.deployed && !u.removed;
const aligned = (b,e) => b.allies().filter(u => canTargetAlly(e,u,true)
  && (Math.abs(u.x-e.x)<.5 || Math.abs(u.y-e.y)<.5) && hypot(u.x-e.x,u.y-e.y)<=CROSS_REACH)
  .sort((a,z)=>hypot(a.x-e.x,a.y-e.y)-hypot(z.x-e.x,z.y-e.y)||a.id-z.id);
const direction = (e,t) => Math.abs(t.x-e.x)>=Math.abs(t.y-e.y) ? [Math.sign(t.x-e.x),0] : [0,Math.sign(t.y-e.y)];
const inDirection = (e,t,[dx,dy]) => dx ? Math.sign(t.x-e.x)===dx && Math.abs(t.y-e.y)<.5 : Math.sign(t.y-e.y)===dy && Math.abs(t.x-e.x)<.5;
const actReady = e => present(e) && !e.hidden && !e.s.flags.stun && !e.s.flags.freeze && !e.s.flags.sleep && !e.s.flags.silence;

function crossShot(ab,{count=1,bomb=false}={}) {
  const s=bomb?ab.sk.CrossBomb:ab.sk.CrossAttack;
  return skill(s,(b,e)=>{
    const first=aligned(b,e)[0]; if(!first)return;
    const aim=direction(e,first),scale=s.bb.atk_scale??1,n=Math.max(1,Math.trunc(s.bb.times??count));
    // Local native prefab MultiRangedAttack.triggerDelta = 0.1s; interruption stops unfired shots.
    const amount=capEnemyBurstHit(b,e,e.s.atk*scale,n);
    b.addBuff(e,{key:'bolivar:crossCast',duration:.1*(n-1)+.1,flags:{noMove:true,disarm:true}});
    const fire=()=>{
      if(!actReady(e))return;
      const target=aligned(b,e).find(u=>inDirection(e,u,aim));if(!target)return;
      abilityAttackFx(b,e,target);
      b.addProjectile({from:e,target,speed:12,visual:'enemy',source:e,onHit:c=>{
        const t=c.target;if(!present(t))return;
        if(bomb){
          b.fx('explode',{id:e.id,x:t.x,y:t.y,r:s.bb.projectile_range??1.1,kind:'bolivarBomb'});
          // The official blast radius is 1.1; areaAllies respects ground/stealth selection.
          const victims=b.alliesInRadius(t.x,t.y,s.bb.projectile_range??1.1);
          for(const u of victims)if(u===t||canTargetAlly(e,u,true))hurt(b,e,u,amount,'phys',{canDodge:true});
        }else hurt(b,e,t,amount,'phys',{canDodge:true});
      }});
    };
    for(let i=0;i<n;i++)if(i)b.after(.1*i,fire,{owner:e});else fire();
  },{sil:true,cond:(b,e)=>aligned(b,e).length>0});
}

function grenadier(ab) {
  const s=ab.sk.Bomb;
  return [{sil:true,taken(_c,b,e,a){
    if(a.used||e.blockedBy||!present(e))return;a.used=true;
    const amount=capEnemyBurstHit(b,e,e.s.atk*(s.bb.atk_scale??2)),spent=new Map();
    castSlot(b,e,s);
    for(const aim of [[1,0],[-1,0],[0,1],[0,-1]]){
      const t=aligned(b,e).find(u=>inDirection(e,u,aim));
      if(t)abilityAttackFx(b,e,t);
      b.addProjectile({from:e,...(t?{target:t}:{to:{x:e.x+aim[0]*CROSS_REACH,y:e.y+aim[1]*CROSS_REACH}}),speed:12,visual:'enemy',source:e,onHit:c=>{
        b.fx('explode',{id:e.id,x:c.x,y:c.y,r:s.bb.projectile_range??1.1,kind:'bolivarBomb'});
        for(const u of b.alliesInRadius(c.x,c.y,s.bb.projectile_range??1.1))
          if(u===c.target||canTargetAlly(e,u,true)){
            const dealt=Math.min(amount,capEnemyBurstHit(b,e,Infinity)-(spent.get(u.id)||0));
            spent.set(u.id,(spent.get(u.id)||0)+dealt);hurt(b,e,u,dealt,'phys',{canDodge:true});
          }
      }});
    }
    b.addBuff(e,{key:'bolivar:light',persist:true,mods:{moveFlat:T(ab,'Light.move_speed')??.7,massFlat:T(ab,'Light.mass_level')??-2}});
    setForm(b,e,'form2');
  }}];
}

function breakthrough(ab) {
  const scale=1+(ab.sk.PowerHit?.bb.atk??.8);
  return [{sil:true,blocked(_c,_b,_e,a){a.armed=true;},before(_c,b,e,a){if(a.armed)castSlot(b,e,ab.sk.PowerHit);},
    hitOut(c,b,e,a){if(!c.dmg.isAttack||!a.armed)return;a.armed=false;c.dmg.amount=capEnemyBurstHit(b,e,c.dmg.amount*scale);},
  }];
}
function observer(ab) {
  return [{hitOut(c,b,e){
    if(!c.dmg.isAttack||!present(c.target))return;
    const t=c.target;expose(b,t,T(ab,'Attack.attack@weak[limit]')??5,T(ab,'Attack.attack@damage_scale')??1.2);
    for(const u of areaAlliesInTiles(b,e,t.tileR,t.tileC,'box',1))if(u!==t)hurt(b,e,u,capEnemyBurstHit(b,e,e.s.atk),'phys',{canDodge:true});
  }}];
}
function guard(ab) {
  return [{hitIn(c,_b,e){if(!e.blockedBy&&['phys','arts'].includes(c.dmg.type))c.dmg.mul*=1-(T(ab,'DmgResist.damage_resistance')??.4);}},crossShot(ab,{count:2,bomb:true})];
}
const families={
  '1401_pogpro':()=>[],
  '1402_tgshd':SPECIAL_KITS.enemy_1402_tgshd_2,
  '1403_gunsho':ab=>[crossShot(ab,{count:3})],
  '1404_msnip':INVISIBLE_KITS.enemy_1404_msnip,
  '1405_boomer':grenadier,
  '1406_chghmr':breakthrough,
  '1407_hummbd':FLY_KITS.enemy_1407_hummbd,
  '1408_scotcn':observer,
  '1409_bdguad':guard,
};
export const BOLIVAR_KITS=Object.freeze(Object.fromEntries(Object.entries(families).flatMap(([id,kit])=>[['enemy_'+id,kit],['enemy_'+id+'_2',kit]])));
