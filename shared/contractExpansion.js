// Owner-designed expansion: risk families are exclusive tiers; support never awards risk points.
export const EXTRA_CONTRACT_SETS=Object.freeze([
 {id:'rush',order:8,name:'指标集：奔袭',nameEn:'ONSLAUGHT'},
 {id:'bulwark',order:9,name:'指标集：壁垒',nameEn:'BULWARK'},
 {id:'hunt',order:10,name:'指标集：围猎',nameEn:'THE HUNT'},
 {id:'attrition',order:11,name:'指标集：耗竭',nameEn:'ATTRITION'},
 {id:'sovereign',order:12,name:'指标集：王权',nameEn:'SOVEREIGN'},
 {id:'benefit',order:13,name:'指标集：增益',nameEn:'SUPPORT PROTOCOLS'},
]);
export const BENEFIT_THRESHOLDS=Object.freeze([25,50,100,150,200]);
const set=(id,name,nameEn)=>({id,name,nameEn});
const anni=set('anni','指标集：湮灭','ANNIHILATION'),rush=EXTRA_CONTRACT_SETS[0],wall=EXTRA_CONTRACT_SETS[1],hunt=EXTRA_CONTRACT_SETS[2],attrition=EXTRA_CONTRACT_SETS[3],sovereign=EXTRA_CONTRACT_SETS[4],benefit=EXTRA_CONTRACT_SETS[5];
function tiers(prefix,names,points,values,effect,group,icons) {
 const ids=values.map((_,i)=>prefix+(i+1));
 const english={anniMobilize:['ARMED ASSEMBLY','COMBAT READINESS','DENSE FRONT','SATURATION ASSAULT','TOTAL MOBILIZATION'],rushMarch:['FORCED MARCH','RAPID FRONT','BLITZ TORRENT'],rushFervor:['RISING FERVOR','FERVOR ORDERS','UNENDING ASSAULT'],bulwarkRes:['ARTS COATING','ARTS-RESISTANT ARMOR','ARTS BULWARK'],bulwarkRegen:['EMERGENCY REPAIRS','REGENERATIVE TISSUE','INEXHAUSTIBLE BODIES'],huntArmor:['DEFENSIVE POSTURE','TENACIOUS FRONT','UNYIELDING LINE'],attritionRedeploy:['SLOW REORGANIZATION','ROTATION BREAKDOWN','EXHAUSTED RESERVES'],bossFervor:['ROYAL FERVOR','TYRANT TEMPO','SOVEREIGN FURY'],bossAegis:['ROYAL GUARD','SOVEREIGN AEGIS','IMPREGNABLE CROWN']};
 return values.map((value,i)=>({id:ids[i],name:names[i],nameEn:english[prefix][i],points:points[i],set:group,icon:icons[i]||icons[0],effect:effect(value),excludes:ids.filter(id=>id!==ids[i]),tier:i+1}));
}
export const EXPANDED_CONTRACTS=Object.freeze([
 {id:'mechFenceLock',name:'围栏封锁',nameEn:'FENCELINE DENIAL',points:3,icon:'fenceLock',set:set('mech','指标集：机制','MECHANISM'),effect:{noFenceTiles:true}},
 {id:'huntFullGuard',name:'精锐重整',nameEn:'ELITE REFORMATION',points:5,icon:'shield',set:hunt,effect:{eliteMul:{hp:1.25,def:1.25},bossMul:{hp:1.15,def:1.15}}},
 {id:'attritionReserve',name:'后勤封锁',nameEn:'LOGISTICS DENIAL',points:4,icon:'lock',set:attrition,effect:{incomeAdd:-1,priceAdd:1}},
 {id:'rushPressure',name:'压境协同',nameEn:'COORDINATED PRESSURE',points:4,icon:'chevrons',set:rush,effect:{mobAspdAdd:12,mobSpeedMul:1.1}},
 ...tiers('anniMobilize',['武装集结','战备升级','密集阵线','饱和攻势','全面动员'],[1,3,5,7,10],[1.12,1.22,1.35,1.55,1.8],m=>({normalMul:{hp:m,atk:m,def:m}}),anni,['horde1','horde2','horde3','horde4','horde5']),
 ...tiers('rushMarch',['急行军','疾行阵线','闪击洪流'],[2,4,7],[1.12,1.25,1.4],m=>({mobSpeedMul:m}),rush,['chevrons','signal','horde4']),
 ...tiers('rushFervor',['战意升温','狂热指令','不息攻势'],[2,4,7],[12,24,40],v=>({mobAspdAdd:v}),rush,['sword','horde2','horde5']),
 ...tiers('bulwarkRes',['术式镀层','抗术装甲','法术壁垒'],[3,6,9],[8,16,24],v=>({mobResAdd:v}),wall,['shield','horde3','horde5']),
 ...tiers('bulwarkRegen',['应急修复','再生组织','不竭躯壳'],[3,6,10],[.001,.002,.0035],v=>({mobRegenRatio:v}),wall,['plus','horde2','horde5']),
 ...tiers('huntArmor',['守势准备','顽强阵线','不破战线'],[3,6,11],[.92,.84,.72],m=>({mobDamageTakenMul:m}),hunt,['shield','horde3','horde5']),
 ...tiers('attritionRedeploy',['重整迟缓','轮换失调','后备枯竭'],[2,4,8],[1.15,1.3,1.5],m=>({opRedeployMul:m}),attrition,['warn','horde3','horde5']),
 ...[
  ['doomNoVanguard','先锋撤离','VANGUARD WITHDRAWAL','chevrons',4,'先锋'],
  ['doomNoGuard','近卫缺席','GUARD ABSENCE','sword',5,'近卫'],
  ['doomNoSniper','远火沉寂','SILENT OVERWATCH','signal',4,'狙击'],
  ['doomNoSupporter','协同断链','BROKEN COORDINATION','horde3',4,'辅助'],
  ['doomNoSpecialist','特种撤收','SPECIALIST RECALL','close',4,'特种'],
 ].map(([id,name,nameEn,icon,points,profession])=>({id,name,nameEn,icon,points,set:set('doom','指标集：毁灭','DESTRUCTION'),effect:{banProfession:profession}})),
 ...tiers('bossFervor',['首领·战意','首领·狂攻','首领·暴君'],[2,4,8],[10,20,35],v=>({bossAspdAdd:v}),sovereign,['crown','warn','horde5']),
 ...tiers('bossAegis',['首领·御卫','首领·庇护','首领·不落'],[3,5,9],[.95,.88,.8],m=>({bossDamageTakenMul:m}),sovereign,['shield','crown','horde5']),
 ...[
  ['benefitVanguard','先锋号令','VANGUARD ORDERS','chevrons',25,'PIONEER',{trigger:'deploy',sp:4,cooldown:9,maxTriggers:2}],
  ['benefitSniper','狙击校准','SNIPER CALIBRATION','signal',25,'SNIPER',{trigger:'attack',every:4,sp:1}],
  ['benefitGuard','近卫战意','GUARD FERVOR','sword',25,'WARRIOR',{trigger:'damaged',cooldown:4,sp:1}],
  ['benefitDefender','重装坚守','DEFENDER VIGIL','shield',25,'TANK',{trigger:'blocking',interval:5,sp:1}],
  ['benefitMedic','医疗急救','MEDIC RESCUE','plus',25,'MEDIC',{trigger:'healRescue',atkRatio:.4,hpBelow:.35,cooldown:7,maxTriggers:3}],
  ['benefitCaster','术师蓄能','CASTER CHARGE','signal',25,'CASTER',{trigger:'pulse',interval:5,sp:1}],
  ['benefitSupporter','辅助牵制','SUPPORTER RESTRAINT','horde3',25,'SUPPORT',{trigger:'slow',moveMul:.82,duration:3,cooldown:6,maxTriggers:4}],
  ['benefitSpecialist','特种扰袭','SPECIALIST DISRUPTION','sword',25,'SPECIAL',{trigger:'aspdDebuff',aspd:-12,duration:4,cooldown:7,maxTriggers:4}],
  ['benefitShield','危急掩护','CRITICAL COVER','shield',100,null,{trigger:'lowHpShield',hpBelow:.25,hpRatio:.05,duration:4,maxTriggers:2}],
  ['benefitCastWindow','精准窗口','PRECISE WINDOW','signal',100,null,{trigger:'castAspd',aspd:12,duration:4,maxTriggers:2}],
  ['benefitRegen','战备呼吸','BRIEF RESPITE','plus',25,null,{trigger:'openingRegen',hpRegenRatio:.0025,duration:10,maxTriggers:1}],
  ['benefitSquadSP','邻位策应','NEIGHBOR SUPPORT','horde3',100,null,{trigger:'squadSP',every:5,sp:2,cooldown:7,maxTriggers:6}],
  ['benefitArtsRes','术式防护','ARTS RESPONSE','shield',100,null,{trigger:'artsRes',res:6,duration:4,maxTriggers:2}],
  ['benefitBlock','阻击准备','INTERCEPTION READY','shield',100,null,{trigger:'firstBlock',block:1,duration:6,maxTriggers:1}],
  ['benefitOpening','开局部署','OPENING DEPLOYMENT','horde5',150,null,{trigger:'opening',sp:2,maxTriggers:1}],
  ['benefitRelay','战损接棒','FALLEN COMRADES','plus',150,null,{trigger:'deathRelay',cooldown:12,maxTriggers:3,sp:2}],
  ['benefitOpening200','全线策应','FRONTLINE RESONANCE','signal',200,null,{trigger:'opening',sp:4,maxTriggers:1}],
  ['benefitShield200','应急护壁','EMERGENCY BULWARK','shield',200,null,{trigger:'lowHpShield',hpBelow:.35,hpRatio:.1,duration:5,maxTriggers:2}],
 ].map(([id,name,nameEn,icon,minScore,profession,rule])=>({id,name,nameEn,icon,minScore,points:0,set:benefit,benefit:true,
  supportProfession:profession,effect:{supportProtocol:{...rule,profession}},excludes:['benefitOpening','benefitOpening200','benefitRelay','benefitSquadSP'].includes(id)?['benefitOpening','benefitOpening200','benefitRelay','benefitSquadSP'].filter(other=>other!==id):id==='benefitShield'?['benefitShield200']:id==='benefitShield200'?['benefitShield']:[]})),
]);
