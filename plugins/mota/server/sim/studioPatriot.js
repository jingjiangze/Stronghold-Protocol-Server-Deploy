import {DataSource} from './simdata.js';
import {buildBattleSpec,createBattleFromSpec} from './spec.js';
import {GEO} from '../../shared/constants.js';
import {PatriotAtmosphere} from './studioPatriotAtmosphere.js';
/** Isolated real-combat demonstration. Operator data and raid HP in production are never edited. */
export class PatriotArena{
 constructor(data,{poolMax=4800000,stageId='act1autochess_m01',seed=20261021,compiledSpec=null}={}){
  const target=(charId,id,name,ground)=>{const original=Object.values(data.raw.chess).find(x=>x.charId===charId&&!x.isGolden);if(!original)throw Error(name+' data missing');return{...structuredClone(original),chessId:id,charId:null,spine:charId,avatar:charId,name,profession:ground?'TANK':'CASTER',subProfessionId:ground?'protector':original.subProfessionId,skill:null,skills:[],talents:[],stats:{...original.stats,maxHp:1e9,atk:ground?0:original.stats.atk,def:0,res:0,blockCnt:ground?99:0,cost:0,respawnTime:0,hpRecoveryPerSec:0}};};
  const id='studio_patriot_ulpianus',dusk='studio_patriot_dusk',raw=target('char_4145_ulpia',id,'乌尔比安',true),duskRaw=target('char_2015_dusk',dusk,'夕',false);
  stageId=compiledSpec?.stageId||stageId;poolMax=compiledSpec?.boss?.poolMax||poolMax;
  this.data=new DataSource({chess:{[id]:raw,[dusk]:duskRaw}},data);this.stage=data.getStage(stageId).raw||data.rawStage(stageId);this.fieldId='patriot-demo';this.poolMax=Math.max(1,poolMax);this.lastDamage=0;
  const units=[{playerId:'left',side:'L',units:[{chessId:id,uid:1,row:3,col:4,abs:true,dir:'RIGHT'},{chessId:dusk,uid:3,row:3,col:8,abs:true,dir:'RIGHT'}]},{playerId:'right',side:'R',units:[{chessId:id,uid:2,row:3,col:16,abs:true,dir:'LEFT'},{chessId:dusk,uid:4,row:3,col:12,abs:true,dir:'LEFT'}]}];
  // The page supplies the real studio compiler's Hard spec. The fixed fallback is only for isolated offline tests.
  const spec=compiledSpec?{...structuredClone(compiledSpec),battleId:'patriot-demo',fieldId:this.fieldId,players:units,flags:{...compiledSpec.flags,startOpCooldown:0,dpPerSec:0}}:buildBattleSpec({battleId:'patriot-demo',fieldId:this.fieldId,kind:'boss',round:14,modeId:'mode_multi_hard',stageId,seed,rect:GEO.BOSS_RECT,players:units,bossId:'boss_patriot',boss:{poolHp:this.poolMax,poolMax:this.poolMax},flags:{startOpCooldown:0,dpPerSec:0},routes:[{motion:'WALK',start:[4,10],end:[1,3],checkpoints:[]},{motion:'WALK',start:[4,10],end:[1,17],checkpoints:[]}],spawns:[{enemyKey:'enemy_1506_patrt',time:0,count:1,pos:[4,10],routeIndex:0,tag:'boss',countInTotal:false,mods:{atkMul:2.143589,speedMul:1,slot:'N'}}]});
  this.battle=createBattleFromSpec(spec,this.data,{quiet:true});this.atmosphere=new PatriotAtmosphere(seed);this.battle.autoFinish=false;this.battle._spawnStageDevices=()=>{};this.battle.start();for(const u of this.battle.allyUnits){u.profile.noAttack=u.def.spine!=='char_2015_dusk';u.ground=u.def.spine==='char_4145_ulpia';this.battle.addBuff(u,{key:'studio:fixed-target',persist:true,allowDead:true,flags:{invulnerable:true,noMove:true,noDisplace:true}});}this.step();
 }
 get time(){return this.battle.time;}get errors(){return this.battle.errors||[];}
 root(){return this.battle.enemies.find(e=>e.defId==='enemy_1506_patrt'&&e.alive)||null;}
 layoutGuards(){for(const guard of this.battle.enemies){const off=guard.mem.patriotGuard;if(!guard.alive||!off)continue;off.dx=off.sign*(off.phase===1?.85:.45);guard.x=off.body.x+off.dx;guard.y=off.body.y+off.dy;}}
 step(){this.layoutGuards();this.battle.step();this.layoutGuards();this.atmosphere.sync(this.battle);}
 fieldMeta(){const meta=this.battle.fieldMeta();return{...meta,fieldId:this.fieldId,units:[...meta.units,...this.atmosphere.infos()]};}
 snapshot(){const snap=this.battle.snapshot();return{...snap,units:[...snap.units,...this.atmosphere.tuples()]};}
 drainEvents(){return[...this.battle.drainEvents(),...this.atmosphere.drainEvents()];}
 damage(){const e=this.root();if(!e)return 0;const before=e.bossPool?.hp??e.hp;this.battle.loseHp(e,100000,{source:null});this.lastDamage=Math.max(0,before-(e.bossPool?.hp??e.hp));this.step();return this.lastDamage;}
 breakShields(){for(const u of [...this.battle.enemies])if(u.alive&&u.mem.patriotGuard)this.battle.kill(u,null);this.atmosphere.sync(this.battle);}
 killRandomShield(){const guards=this.battle.enemies.filter(u=>u.alive&&u.mem.patriotGuard);if(!guards.length)return null;const guard=this.battle.rng.pick(guards);this.battle.kill(guard,null);this.atmosphere.sync(this.battle);return guard.id;}
}
