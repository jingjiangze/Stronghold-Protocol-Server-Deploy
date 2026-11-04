// Owner-designed contract variants. The original New Front remains R8/R14/R18/R20 + R21 Core.
const pact={id:'pact',name:'指标集：合同',nameEn:'CONTRACT'};
const modes=['pactExtension','pactFirewall','pactNewFront','pactDelayedFront'];
const needs={set:pact,requiresAny:modes};
const delayed={
  "mode": "pact",
  "maxRounds": 20,
  "bossRounds": [
    {
      "round": 10,
      "hpMul": 0.6,
      "defAdd": -0.5,
      "atkAdd": -0.5,
      "aliveFull": 5
    },
    {
      "round": 14,
      "hpMul": 1,
      "defAdd": 0,
      "atkAdd": 0
    },
    {
      "round": 18,
      "hpMul": 1.3,
      "defAdd": 0.1,
      "atkAdd": 0.1
    },
    {
      "round": 20,
      "hpMul": 1.6,
      "defAdd": 0.6,
      "atkAdd": 0.6
    }
  ],
  "forceHidden": true,
  "hiddenHpMul": 1.6,
  "hiddenStatAdd": 0.3,
  "lateHpFrom": 10,
  "lateHpStep": 0.06,
  "lateStatStep": 0.03
};
function tiers(prefix,names,english,points,values,key){const ids=values.map((_,i)=>prefix+(i+1));return values.map((value,i)=>({...needs,id:ids[i],name:names[i],nameEn:english[i],points:points[i],icon:'warn',effect:{[key]:value},tier:i+1,excludes:ids.filter(id=>id!==ids[i])}));}
export const PACT_VARIANTS=Object.freeze([
 {set:pact,id:'pactBountyDebtHalf',name:'悬赏违约',nameEn:'BOUNTY DEFAULT',points:3,icon:'coin',effect:{bountyLeakPenalty:.5},excludes:['pactBountyDebtFull']},
 {set:pact,id:'pactBountyDebtFull',name:'全额追偿',nameEn:'FULL RECOURSE',points:5,icon:'coin',effect:{bountyLeakPenalty:1},excludes:['pactBountyDebtHalf']},
 {id:'pactDelayedFront',name:'迟发战线',nameEn:'DEFERRED FRONT',points:3,icon:'sword',set:pact,effect:delayed,excludes:modes.filter(id=>id!=='pactDelayedFront'),layout:'h'},
 ...tiers('pactPrepClock',['整备压缩','整备紧迫','分秒必争'],['SHORT PREPARATION','URGENT PREPARATION','EVERY SECOND COUNTS'],[1,3,5],[.9,.8,.7],'prepTimeMul'),
 ...tiers('pactCombatClock',['交战提速','速决命令','极限时钟'],['ACCELERATED ENGAGEMENT','SWIFT RESOLUTION','CRITICAL CLOCK'],[2,4,7],[.95,.9,.85],'combatClockMul'),
 ...tiers('pactEliteHunt',['精英追猎','双重追猎','三重追猎'],['ELITE HUNT','DOUBLE HUNT','TRIPLE HUNT'],[3,6,9],[1,2,3],'randomEliteCount'),
 ...tiers('pactReinforce',['后期增援','后期集结','后期洪流'],['LATE REINFORCEMENTS','LATE ASSEMBLY','LATE TORRENT'],[2,4,7],[.15,.3,.45],'lateReinforcementRatio'),
 {...needs,id:'pactLateBounty',name:'后期委托',nameEn:'LATE COMMISSIONS',points:2,icon:'list',effect:{bountyLateFrom:13},excludes:['pactEveryBounty']},
 {...needs,id:'pactEveryBounty',name:'无休悬赏',nameEn:'RELENTLESS BOUNTIES',points:5,icon:'list',effect:{bountyEveryRound:true},excludes:['pactLateBounty']},
]);
