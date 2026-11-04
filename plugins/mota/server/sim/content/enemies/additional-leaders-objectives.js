// Stage devices are explicit attackable objectives, never invisible invulnerability gates.
import {hurt,elem,targetsNear,areaAllies} from './helpers.js';
import {skill,unblockable,reborn,splashAttack,blinkForward} from './archetypes.js';
import {alive,friends,phase2,ranged,target,stop,pulse,dot,objective,objectives,adds,nextForm,lives,seal} from './additional-leader-helpers.js';

function chip(b,e,ratio,killer){if(!alive(e)||e.mem.additionalRebirthing)return;b.fx('shieldBreak',{id:e.id,x:e.x,y:e.y});b.loseHp(e,e.s.maxHp*ratio,{source:killer});}
const kristen=ab=>{
  const star=(b,e)=>objective(b,e,{key:'enemy_1334_ristar',name:'星环',hp:5000,onBreak:()=>{if(phase2(e)){pulse(b,e,1);for(const u of friends(b,e))b.addBuff(u,{key:`additional:heatDeath:${e.id}`,persist:true,refresh:'stack',stacks:1,maxStacks:6,mods:{moveMul:1.1}});}}});
  return[{
    spawn(b,e){ranged(e,3);star(b,e);},iv:.5,
    tick(b,e){const n=objectives(e).length;e.blockWeight=1+n;e.mem.starCount=n;for(const o of objectives(e))for(const u of areaAllies(b,e,o.x,o.y,1.5))b.addBuff(u,{key:`additional:starSlow:${e.id}`,duration:.6,mods:{aspd:-25}});},
    hitIn(c,b,e){if(['phys','arts'].includes(c.dmg.type))for(let i=0;i<(e.mem.starCount||0);i++)c.dmg.mul*=.7;},
    death(c,b,e){pulse(b,e,1+objectives(e).length*.5);},
  },reborn({dur:5,invincible:5,onReborn(b,e){pulse(b,e,1+objectives(e).length*.5);nextForm(b,e,2,{atkPct:.2});e.profile.maxTargets=2;for(let i=objectives(e).length;i<3;i++)star(b,e);}}),
  skill(ab.sk.BecomeStar,(b,e)=>{if(objectives(e).length<3)star(b,e);},{cond:(b,e)=>!phase2(e)})];
};
const gardener=ab=>{
  const answer=(b,e)=>objective(b,e,{key:'bounty_scene_cledub_answer',name:'花匠的回答',hp:4000,onBreak:killer=>{chip(b,e,.2,killer);if(alive(e)&&e.hpRatio<=.5)e.mem.additionalPhase2=true;}});
  return[unblockable(),{
    spawn(b,e){stop(b,e);ranged(e,99);e.profile.noAttack=true;b.addBuff(e,{key:'additional:gardenerSafe',persist:true,flags:{invulnerable:true}});answer(b,e);},
  },skill(null,(b,e)=>{if(objectives(e).length<3)answer(b,e);},{cd:8,icd:4}),
  skill(ab.sk.M1MakeTrouble,(b,e,a)=>{const n=(a.n=(a.n||0)+1)%3;for(const u of targetsNear(b,e,99))b.addBuff(u,{key:`additional:gardenerDebuff:${e.id}:${n}`,persist:true,mods:n===1?{aspd:phase2(e)?-50:-35}:n===2?{blockCnt:phase2(e)?-2:-1}:{hpPct:phase2(e)?-.5:-.3}});}),
  skill(ab.sk.M2SummonEnemy,(b,e)=>adds(b,e,'enemy_1002_nsabr',2,6),{cond:(b,e)=>phase2(e)})];
};
const bloodlord=ab=>{
  const throne=(b,e)=>{e.mem.throneAlive=true;const o=objective(b,e,{key:'trap_127_bldore',name:'沥血王座',hp:9000,onBreak:()=>{e.mem.throneAlive=false;b.removeBuff(e,'additional:throneSafe');nextForm(b,e,2,{atkPct:.5});e.hp=e.s.maxHp;}});if(!o){e.mem.throneAlive=false;b.removeBuff(e,'additional:throneSafe');nextForm(b,e,2,{atkPct:.5});e.hp=e.s.maxHp;}};
  return[{
    spawn(b,e){ranged(e,4);},
    killed(c,b,e,a){if(a.used)return false;a.used=true;e.hp=1;e.profile.noAttack=true;b.addBuff(e,{key:'additional:throneSafe',persist:true,flags:{invulnerable:true,noMove:true}});throne(b,e);return true;},
    hitIn(c,b,e){if(phase2(e)&&!e.mem.bloodExposed&&['phys','arts'].includes(c.dmg.type))c.dmg.mul*=.2;},
    iv:1,tick(b,e){if(phase2(e)){e.profile.noAttack=false;for(const u of friends(b,e))b.addBuff(u,{key:`additional:bloodRegen:${e.id}`,duration:1.2,mods:{hpRegen:u.s.maxHp*.005}});}if(e.mem.bloodExposed&&b.time>=e.mem.bloodExposed)e.mem.bloodExposed=0;},
    dealt(c,b,e){if(phase2(e))dot(b,e,c.target,{key:'additional:badBlood',duration:10,amount:()=>e.s.atk*.2});},
  },skill(ab.sk.BloodFog,(b,e)=>{const u=target(b,e);if(!u)return;const x=u.x,y=u.y;for(let i=1;i<=10;i++)b.after(i,()=>{if(!alive(e))return;for(const v of areaAllies(b,e,x,y,1.7)){hurt(b,e,v,50+15*i,'arts');b.addBuff(v,{key:`additional:bloodSlow:${e.id}`,duration:1.1,mods:{aspd:-40,redeployMul:2}});}for(const seed of friends(b,e).filter(n=>n.defId==='enemy_1367_dseed'&&!n.mem.leaderObjective)){b.kill(seed,e);adds(b,e,'enemy_1360_dfello',1,6);}},{owner:e});}),
  skill(null,(b,e)=>{if(!phase2(e)||objectives(e).length>=3)return;objective(b,e,{key:'enemy_1367_dseed',name:'反巫术血珀',hp:3500,onBreak:()=>{e.mem.bloodExposed=b.time+15;b.applyStatus(e,'stun',{source:e,duration:3});}});},{cd:12,icd:8})];
};
const witch=ab=>{
  const mark=(b,e,u)=>{
    const key=`additional:witchMark:${e.id}`;b.addBuff(u,{key,persist:true,flags:{stun:true},visible:true});
    objective(b,e,{key:'enemy_1380_dthmak',name:'慵钝之印',link:{unit:u,key},pos:[u.y,u.x],hp:2000,onBreak:()=>b.removeBuff(u,key),onClear:()=>b.removeBuff(u,key)});
  };
  return[unblockable(),splashAttack({unblocked:false,radius:1}),{
    spawn(b,e){ranged(e,5);e.mem.witchMarks=[];},
    hitIn(c,b,e){if(phase2(e)&&c.source?.x>e.x&&['phys','arts'].includes(c.dmg.type))c.dmg.mul*=.2;},
    taken(c,b,e,a){if(a.moved||e.hpRatio>.5)return;a.moved=true;for(const u of targetsNear(b,e,99).slice(0,2)){
      const tiles=[];for(let r=b.rect.r0;r<=b.rect.r1;r++)for(let c=b.rect.c0;c<=b.rect.c1;c++)if(b.grid.isLow(r,c)&&!b.isReservedTile(r,c))tiles.push([r,c]);
      if(tiles.length){const [r,c]=b.rng.pick(tiles);b.moveRedeploy(u,r,c);}
    }},
  },reborn({dur:10,onReborn(b,e){nextForm(b,e,2,{atkPct:-.5,defPct:.5});ranged(e,99);stop(b,e);}}),
  skill(ab.sk.BlinkS1,(b,e)=>blinkForward(b,e,2),{cond:(b,e)=>!phase2(e)}),
  skill(ab.sk.DeathmarkS1,(b,e)=>{for(const u of e.mem.witchMarks)if(alive(u)&&u.findBuff(`additional:witchMark:${e.id}`))b.kill(u,e);e.mem.witchMarks=targetsNear(b,e,99).slice(0,phase2(e)?1:2);for(const u of e.mem.witchMarks)mark(b,e,u);}),
  skill(ab.sk.SwitchAudioType,(b,e)=>{for(const u of friends(b,e))b.addBuff(u,{key:`additional:witchTempo:${e.id}`,duration:20,mods:{atkPct:.1,aspd:10}});},{cond:(b,e)=>phase2(e)})];
};
const cerberus=ab=>{
  const ingredientKeys=['enemy_1137_plasm','enemy_1138_tumor','enemy_1002_nsabr'];
  return[{
    spawn(b,e){e.mem.food=0;e.mem.additionalPhase=1;b.on('death',({unit,reason})=>{if(reason==='killed'&&unit.mem.ingredientFor===e.id)e.mem.food=Math.min(8,e.mem.food+1);});},
    hitIn(c,b,e){if(['phys','arts'].includes(c.dmg.type))c.dmg.mul*=Math.min(1,.2+e.mem.food*.1);},
    taken(c,b,e){if(e.hpRatio<.5&&!e.findBuff('additional:cerberusRage')){b.addBuff(e,{key:'additional:cerberusRage',persist:true,mods:{atkPct:.5,moveMul:2.2}});ab.immune=new Set(['stun','freeze','sleep','levitate','bind','slow','sluggish']);}},
    before(c,b,e,a){a.power=((a.n||0)+1)%3===0;e.profile.atkScale=a.power?1.5:1;},
    attack(c,b,e,a){a.n=(a.n||0)+1;},
    dealt(c,b,e,a){if(a.power)b.addBuff(c.target,{key:`additional:cerberusArmor:${e.id}`,persist:true,refresh:'stack',stacks:1,maxStacks:10,mods:{defFlat:-150}});},
  },lives({count:3,delay:3,onPhase(b,e,i){nextForm(b,e,i);e.mem.food=0;ab.immune=null;b.removeBuff(e,'additional:cerberusRage');}}),
  skill(null,(b,e)=>{for(const u of adds(b,e,ingredientKeys[(e.mem.additionalPhase||1)-1],2,6))u.mem.ingredientFor=e.id;},{cd:10,icd:2}),
  skill(ab.sk.P2Skill,(b,e)=>{for(const u of areaAllies(b,e,e.x,e.y,1.6))b.applyStatus(u,'stun',{source:e,duration:4.5});},{cond:(b,e)=>e.mem.additionalPhase===2}),
  skill(ab.sk.P3Skill,(b,e)=>{const u=target(b,e);if(!u)return;for(let i=1;i<=15;i++)b.after(i*.5,()=>{if(!alive(e))return;if(alive(u))hurt(b,e,u,e.s.atk*Math.min(.25,.025+.03*i),'arts');else if(i===1||e.mem.cerberusBurstTarget!==u.id){e.mem.cerberusBurstTarget=u.id;for(const v of areaAllies(b,e,u.x,u.y,2.5))hurt(b,e,v,e.s.atk*2,'arts');}},{owner:e});},{cond:(b,e)=>e.mem.additionalPhase===3})];
};
const host=_ab=>{
  const assistant=(b,e)=>objective(b,e,{key:'trap_054_dancdol',name:'报幕助手',hp:4500,onBreak:killer=>chip(b,e,.1,killer)});
  return[{
    spawn(b,e){stop(b,e);ranged(e,99);e.profile.maxTargets=2;b.addBuff(e,{key:'additional:hostSafe',persist:true,flags:{invulnerable:true}});assistant(b,e);},iv:1,
    tick(b,e){for(const o of objectives(e))for(const u of areaAllies(b,e,o.x,o.y,1.5)){hurt(b,e,u,e.s.atk*.2,'true');b.addBuff(u,{key:`additional:hostWeak:${e.id}`,duration:1.2,mods:{atkPct:-.3}});}},
    dealt(c,b,e){elem(b,e,c.target,'neural',e.s.atk*.2);},
  },lives({count:2,delay:10,onPhase(b,e){if(!objectives(e).length)assistant(b,e);}}),skill(null,(b,e)=>{if(objectives(e).length<3)assistant(b,e);},{cd:5,icd:2})];
};
const playwright=ab=>[unblockable(),splashAttack({unblocked:false,tiles:1}),{
  spawn(b,e){ranged(e,99);b.on('beforeUnitExit',({unit})=>{if(unit.mem.writerMark?.source===e&&unit.mem.writerMark.until>b.time&&alive(e))seal(b,unit.tileR,unit.tileC,e);});},
  taken(c,b,e,a){if(a.rage||e.hpRatio>.5)return;a.rage=true;nextForm(b,e,2,{defPct:1,resPct:.8});for(const ability of e.mem.ab.list)if(ability.id==='writerAOE'||ability.id==='writerDOT'){ability.cd=15;ability.left=Math.min(ability.left,5);}},
},skill(ab.sk.aoe,(b,e)=>{const marks=targetsNear(b,e,99).map(u=>[u.x,u.y]);for(const[x,y]of marks)b.fx('telegraph',{id:e.id,x,y,r:1,dur:1,kind:'arts'});b.after(1,()=>{if(!alive(e))return;for(const[x,y]of marks)for(const u of areaAllies(b,e,x,y,1))hurt(b,e,u,e.s.atk*.8,'arts');},{owner:e});},{id:'writerAOE'}),
skill(ab.sk.dot,(b,e)=>{const u=target(b,e);if(!u)return;u.mem.writerMark={source:e,until:b.time+15};dot(b,e,u,{key:'additional:writerDOT',duration:15,amount:()=>u.s.maxHp*.04,mods:{aspd:-u.base.aspd*.5}});},{id:'writerDOT'})];
const isharmla=ab=>{
  const tear=(b,e)=>objective(b,e,{key:'enemy_2040_syrott',name:'伊莎玛拉之泪',hp:3000});
  const transform=(b,e)=>{if(e.mem.isharmlaMonster)return;e.mem.isharmlaMonster=true;nextForm(b,e,2,{hpPct:.5,atkPct:.625,defPct:.3,resPct:.5,moveMul:.8});e.hp=e.s.maxHp;ranged(e,4);};
  return[{
    spawn(b,e,a){ranged(e,3);e.mem.tearEnergy=0;a.next=0;},iv:1,
    tick(b,e){if(e.mem.isharmlaMonster)return;for(const o of objectives(e)){if(areaAllies(b,e,o.x,o.y,.6).length)continue;e.mem.tearEnergy+=8;}if(e.mem.tearEnergy>=120)transform(b,e);},
    taken(c,b,e){if(e.mem.isharmlaMonster&&e.hpRatio<.5&&!e.findBuff('additional:isharmlaRage'))b.addBuff(e,{key:'additional:isharmlaRage',persist:true,mods:{atkPct:.5}});},
    killed(c,b,e,a){if(a.used||e.mem.isharmlaMonster)return false;a.used=true;e.hp=1;transform(b,e);return true;},
  },skill(ab.sk.Corrupt,(b,e)=>{if(objectives(e).length<3)tear(b,e);},{cond:(b,e)=>!e.mem.isharmlaMonster})];
};

export const ADDITIONAL_OBJECTIVE_KITS=Object.freeze({enemy_1543_cstlrs:kristen,enemy_1544_cledub:gardener,enemy_1547_blord:bloodlord,enemy_1548_ltniak:witch,enemy_1557_trcerb:cerberus,enemy_2019_cshost:host,enemy_2020_cswrtr:playwright,enemy_2039_syskad:isharmla});
