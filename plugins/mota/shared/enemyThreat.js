import {waveProgression} from './waveProgression.js';
// Owner balance: assess actual opening protection and mechanics, not just the official NORMAL/ELITE label.
const positive=v=>Number.isFinite(v)?Math.max(0,v):0;
export const enemyAbilityText=e=>(e?.officialAbilities||e?.abilities||[]).map(a=>a.text||'').join('；');
/** Hovering troops may be WALK in the data but become airborne as soon as their kit starts. */
export const isAirborneThreat=e=>!!e&&(e.isFlyEnemy===true||e.stats?.motion==='FLY'||/近地悬浮|起飞|飞行模式|飞行状态/.test(enemyAbilityText(e)));
export const openingAirLimit=round=>round<=4?2:round<=8?3:Infinity;
// Ranged skills consume the same roster quota without extending ordinary melee attack range.
export const isRangedThreat=e=>!!e&&(e.stats?.atk||0)>0&&Math.max(e.stats?.rangeRadius||0,e.rangedSkillRange||0)>1.2;
export const isArtilleryThreat=e=>isRangedThreat(e)&&((e.stats?.rangeRadius||0)>=5||/集团军.*火炮|重炮/.test(e.name||''));
export const normalWaveRangedLimit=(round,count)=>Math.floor(count*(round<=7?.25:round<=12?.3:.35));
export const normalWaveArtilleryLimit=round=>round<9?0:round<=16?1:2;
/** Selected factions may field adapted ordinary ground troops while global/template candidates keep strict gates. */
export function openingFactionAllowed(e,round){
 if(round>=9&&['enemy_1002_nsabr','enemy_1003_ncbow','enemy_1006_shield'].includes(e?.key))return false;
 if(!e||round>12||round<1||!['NORMAL','ELITE'].includes(e.rank)||e.rank==='ELITE'&&round<3||e.tokenOnly||e.contractSupportOnly||e.miniBoss||e.bountyOnly||e.independentSpawn===false||!(e.stats?.moveSpeed>0)||isAirborneThreat(e)||isArtilleryThreat(e))return false;
 const t=enemyThreat(e),text=enemyAbilityText(e);
 if(round<5&&isRangedThreat(e)&&/隐匿|隐形|迷彩/.test(text))return false;
 return t.floor<=Math.max(round,5)&&(round>=5||!/寒冷|冻结|眩晕|沉睡/.test(text))&&(e.rank==='ELITE'?t.hp<=25000&&t.atk<=1500&&t.def<=2000&&t.res<=70:t.hp<=18000&&t.atk<=1100&&t.def<=2000&&t.res<=80);
}
export function enemyThreat(e){
 const s=e?.stats||{},bb=e?.talents?.bb||{},text=enemyAbilityText(e);
 let hp=positive(s.maxHp),atk=positive(s.atk),def=positive(s.def),res=positive(s.res),floor=1;
 // Guaranteed opening buffs, including Gale Knights' 30s +3000 DEF / +95 RES.
 def+=positive(bb['buff.def']);res+=positive(bb['buff.magic_resistance']);
 if(/折射/.test(text))res+=positive(bb['refracting.magic_resistance']??bb['Refracting.magic_resistance']??70);
 if(/重生|复生|首次倒下后/.test(text)){hp*=2;floor=13;}
 if(/吞噬|吞下|强制撤退|强制击倒|暂离队伍/.test(text))floor=Math.max(floor,13);
 if(/全场|全图|每有.*死亡|每有.*被击倒|最多提升10次|永久/.test(text))floor=Math.max(floor,11);
 if(/无敌|100%物理闪避|100%法术闪避|屏障/.test(text))floor=Math.max(floor,9);
 if(/初始防御力与法抗大幅提升/.test(text))floor=Math.max(floor,11);
 if(/精锐|精英|组长|队长|百战|高阶|高级|宗师|资深|头目/.test(e?.name||''))floor=Math.max(floor,5);
 if(e?.rank==='ELITE')floor=Math.max(floor,4);
 if(isArtilleryThreat(e))floor=Math.max(floor,/重型|重炮/.test(e.name||'')?13:9);
 if(/隐匿|隐形|迷彩/.test(text))floor=Math.max(floor,5);
 const protection=Math.max(positive(bb['act38side_scale.damage_resistance']),positive(bb['dmg_res.damage_resistance']),positive(bb['DamageReduce.damage_resistance']));
 if(protection>0){hp/=Math.max(.05,1-Math.min(.95,protection));floor=Math.max(floor,9);}
 if(/召唤|生成|重生造物|持续喷火|持续锁定|连续出拳/.test(text)||Object.keys(e?.runtimeSummons||{}).length)floor=Math.max(floor,9);
 if(positive(bb['DeadSpawn.cnt'])>0)floor=Math.max(floor,9);
 const ammoScale=positive(bb['shotbuff.attack@headshot_atk_scale']);if(ammoScale>1)atk*=ammoScale;
 const block=/阻挡数(?:大于等于|不小于|至少为|为)(\d)/.exec(text);
 if(block)floor=Math.max(floor,Number(block[1])>=4?11:7);
 // Multi-hit, healing and protected variants cannot masquerade as cheap basic troops.
 const bat=Math.max(.5,positive(s.bat)||2),dps=atk/bat;
 const extra=e?.formationExtraThreat;
 if(extra){hp+=positive(extra.hp);atk+=positive(extra.atk);def+=positive(extra.def);res+=positive(extra.res);}
 const power=hp+atk*5+def*3+res*3;
 return {hp,atk,def,res,dps,power,floor};
}
const BANDS=Object.freeze([
 {round:1,hp:2500,atk:240,def:180,res:20,dps:140},
 {round:3,hp:3500,atk:320,def:300,res:35,dps:180},
 {round:5,hp:6500,atk:550,def:550,res:50,dps:260},
 {round:7,hp:7000,atk:650,def:850,res:65,dps:320},
 {round:8,hp:10000,atk:800,def:850,res:65,dps:400},
 {round:9,hp:16000,atk:1100,def:1200,res:75,dps:650},
 {round:11,hp:26000,atk:1600,def:3500,res:100,dps:1000},
 {round:13,hp:45000,atk:2200,def:4500,res:100,dps:1600},
 {round:15,hp:Infinity,atk:Infinity,def:Infinity,res:Infinity,dps:Infinity},
]);
export function normalEnemyMinRound(e){
 if(!e)return Infinity;
 const t=enemyThreat(e),band=BANDS.find(b=>t.hp<=b.hp&&t.atk<=b.atk&&t.def<=b.def&&t.res<=b.res&&t.dps<=b.dps);
 const lightElite=e.rank==='ELITE'&&t.floor<=5&&t.hp<=6500&&t.atk<=550&&t.def<=550&&t.res<=50;
 const unlock=lightElite?3:band?.round||15;
 return Math.max(unlock,lightElite?3:t.floor,e.trainingMinRound||0,e.rank==='NORMAL'&&t.hp>5000?8:0);
}
export const normalWaveBudgetPerUnit=round=>round<=2?4500:round<=4?6500:round<=6?10000:round<=8?16000:round<=10?24000:round<=12?36000:round<=14?50000:round<=16?70000:round===17?90000:round===18?115000:150000;
// Original-generator sample: R5/R6/R7 average 21/24/27 bodies; retain a bounded band around that cadence.
export const normalWaveUnitLimit=round=>waveProgression(round).max;
export const normalWaveUnitFloor=round=>waveProgression(round).min;
/** Parent plus guaranteed death products; repeated combat summons use their own alive/lifetime caps. */
export function ordinarySpawnCost(enemy){return 1+Math.max(0,Math.trunc(enemy?.talents?.bb?.['DeadSpawn.cnt']||0),Math.trunc(enemy?.ordinarySummonCost||0));}
export const normalWaveEliteLimit=(round,slots)=>round<=3?0:round<=5?1:round<=7?2:Math.max(round<=10?6:8,Math.floor(slots*(round<=10?.3:round<=12?.35:round<=16?.4:.5)));
/** Retire weak opening troops later, while a thin faction keeps its strongest unlocked choices. */
export function normalWavePowerFloor(round,strongest=Infinity){
 const share=round<=4?0:round<=8?.12:round<=10?.2:round<=14?.3:round<=16?.35:.4;
 return Math.min(normalWaveBudgetPerUnit(round)*share,strongest*.65);
}
