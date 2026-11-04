// Descriptions are derived from the same effect fields consumed by gameplay, avoiding a second numeric rule table.
const pct=v=>Math.round(v*10000)/100;
export function contractEffectRows(c) {
 const e=c.effect||{},rows=[],push=(key,params={})=>rows.push({key,params});
 if(e.mode==='pact') {
  const rounds=e.bossRounds||[],last=Math.max(...rounds.map(b=>b.round));
  push('常规战线共 {rounds} 回合，随后第 {core} 回合进入隐秘核心。',{rounds:e.maxRounds,core:last+1});
  for(const b of rounds)push('第 {round} 回合首领：血池 ×{hp}，攻击 ×{atk}，防御 ×{def}。',{round:b.round,hp:b.hpMul??1,atk:1+(b.atkAdd??b.statAdd??0),def:1+(b.defAdd??b.statAdd??0)});
  for(const b of rounds)if(b.aliveFull)push('第 {round} 回合首领的人数加成最多计算 {n} 人。',{round:b.round,n:b.aliveFull});
  if(e.forceHidden)push('击败终局首领后必定解锁核心，无需满足血量或盟约层数门槛。');
  push('隐秘核心：血池 ×{hp}，攻击与防御 ×{stat}。',{hp:e.hiddenHpMul??1,stat:1+(e.hiddenStatAdd??0)});
  if(e.lateHpFrom)push('从第 {round} 回合起，普通小怪每回合生命 ×{hp}、攻击和防御 ×{stat}，逐回合相乘；第13回合起精英也参与，正式首领不参与。',{round:e.lateHpFrom,hp:1+(e.lateHpStep||0),stat:1+(e.lateStatStep||0)});
 }
 if(e.maxRefreshesPerRound!=null)push('每个休整期最多手动刷新商店 {n} 次，免费刷新也计数。',{n:e.maxRefreshesPerRound});
 if(e.noLpSharing)push('取消漏怪生命损失分摊，各防线独自承担损失。');
 if(e.uniteDisabled)push('无法参与联防。');
 if(e.uniteMaxHelpers!=null)push('每次联防最多由 {n} 名玩家支援。',{n:e.uniteMaxHelpers});
 if(e.incomeAdd)push('从第 {round} 回合起，每回合基础资金收入 {n}。',{round:e.incomeFromRound||1,n:e.incomeAdd>0?'+'+e.incomeAdd:String(e.incomeAdd)});
 if(e.priceAdd)push('从第 {round} 回合起，所有商品价格 +{n}。',{round:e.priceFromRound||1,n:e.priceAdd});
 if(e.maxShopLevel!=null)push('商店等级上限为 {n}。',{n:e.maxShopLevel});
 if(e.startLpAdd)push('每名玩家所选策略的开局生命值 {n}，最低为 1。',{n:e.startLpAdd>0?'+'+e.startLpAdd:String(e.startLpAdd)});
 if(e.deployCapAdd)push('可部署干员数量 {n}，最低保留 1 个位置。',{n:e.deployCapAdd>0?'+'+e.deployCapAdd:String(e.deployCapAdd)});
 if(e.noRangedTiles)push('禁止在高台部署；地面不受本条限制。');
 if(e.noFenceTiles)push('禁止在围栏格部署；正常地面和高台不受本条限制。');
 if(e.banProfession)push('禁止部署「{profession}」职业干员，自选与补位也按实际职业检查。',{profession:e.banProfession});
 if(e.opStatMul){if(e.opStatMul.hp===e.opStatMul.atk&&e.opStatMul.atk===e.opStatMul.def)push('所有干员的攻击力、防御力和最大生命值各 ×{mul}。',{mul:e.opStatMul.hp});else for(const [key,value] of Object.entries(e.opStatMul))push('所有干员的{stat} ×{mul}。',{stat:{atk:'攻击力',def:'防御力',hp:'最大生命值'}[key]||key,mul:value});}
 if(e.healMul)push('我方治疗量 ×{mul}，自然回复不受影响。',{mul:e.healMul});
 for(const [field,scope]of [['normalMul','普通小怪'],['eliteMul','精英敌人'],['bossMul','首领战领袖与隐秘核心']])if(e[field]){
  const m=e[field];if(m.hp===m.atk&&m.atk===m.def&&m.hp!=null&&!m.speed)push('{scope}的生命值、攻击力和防御力各 ×{mul}。',{scope,mul:m.hp});
  else for(const[key,value]of Object.entries(m))push('{scope}的{stat} ×{mul}。',{scope,stat:{hp:'最大生命值',atk:'攻击力',def:'防御力',speed:'移动速度'}[key]||key,mul:value});
 }
 if(e.normalMul)push('此条不影响精英、首领战领袖与隐秘核心。');
 if(e.eliteMul||e.eliteBlockAdd)push('按实际敌人等级判定精英，不以波次占位槽代替。');
 if(e.eliteBlockAdd)push('精英敌人占用阻挡数 +{n}，最多提升至 {cap}；原本超过上限者不会降低。',{n:e.eliteBlockAdd,cap:e.eliteBlockMax??99});
 if(e.bondLayerCap!=null)push('可叠加超过 {above} 层的盟约，上限降为 {cap} 层。',{above:e.bondLayerCapAbove??e.bondLayerCap,cap:e.bondLayerCap});
 if(e.maxActiveBonds!=null)push('最多同时激活 {n} 个盟约；绝技（按精锐人数计数）不占用名额。',{n:e.maxActiveBonds});
 if(e.mobSpeedMul)push('普通与精英敌人的移动速度 ×{mul}，首领不受影响。',{mul:e.mobSpeedMul});
 if(e.mobAspdAdd)push('普通与精英敌人的攻击速度 +{n} 点，不改变固定技能间隔；首领不受影响。',{n:e.mobAspdAdd});
 if(e.mobResAdd)push('普通与精英敌人法术抗性 +{n}，最多提升至 90；原本更高者不降低，首领不受影响。',{n:e.mobResAdd});
 if(e.mobRegenRatio)push('普通与精英敌人每秒回复初始最大生命值的 {pct}%，首领不受影响。',{pct:pct(e.mobRegenRatio)});
 if(e.supportProtocol) {
  const r=e.supportProtocol,prof={PIONEER:'先锋',SNIPER:'狙击',WARRIOR:'近卫',TANK:'重装',MEDIC:'医疗',CASTER:'术师',SUPPORT:'辅助',SPECIAL:'特种'}[r.profession];
  const params={profession:prof,sp:r.sp,n:r.every,seconds:r.cooldown??r.interval,cap:r.maxTriggers,duration:r.duration};
  const texts={
   deploy:'{profession}干员部署获得 {sp} 技力，每人每 {seconds} 秒最多一次，每场最多 {cap} 次。',
   attack:'{profession}干员每进行 {n} 次普通攻击，获得 {sp} 技力。',
   damaged:'{profession}干员受到敌人伤害时获得 {sp} 技力，每人每 {seconds} 秒最多触发一次。',
   blocking:'{profession}干员每 {seconds} 秒若正在阻挡敌人，获得 {sp} 技力。',
   pulse:'场上的{profession}干员每 {seconds} 秒获得 {sp} 技力。',
   healRescue:'医疗有效治疗生命低于25%的自方干员时，额外治疗自身攻击力的25%；每人10秒一次、每场2次，同一目标每场一次。',
   slow:'辅助普攻使选中的首名普通或精英敌人移速降低10%，持续2秒；每人8秒一次、每场3次，不影响首领。',
   aspdDebuff:'特种普攻使选中的首名普通或精英敌人攻速降低8，持续3秒；每人10秒一次、每场3次，不影响首领。',
   lowHpShield:'干员首次受敌人伤害后仍存活且生命低于20%时，获得最大生命3%的护盾，持续3秒；每人每场一次。',
   castAspd:'干员每场首次发动技能时，攻速+8，持续3秒。',
   openingRegen:'开场成功部署的干员获得8秒自然回复，每秒回复最大生命的0.15%；每人每场一次。',
   squadSP:'干员每7次普攻为最近的另一名自方干员回复1技力；每位玩家10秒一次、每场6次，与其他队伍充能增益互斥。',
   artsRes:'干员每场首次受到法术伤害后仍存活时，法抗+3，持续3秒。',
   firstBlock:'干员每场首次阻挡敌人时，阻挡数+1，持续4秒。',
   opening:'开场成功部署的干员获得 {sp} 技力，每人每场仅一次。',
   deathRelay:'干员被击倒时，其他自方在场干员获得1技力；每位玩家20秒一次、每场3次，与其他队伍充能增益互斥。',
  };
  if(texts[r.trigger])push(texts[r.trigger],params);
  if(r.sp) {push('每名干员每场由全部增益投放的基础技力合计最多16；满条、阻回或技能锁期间不消耗投放额度。');push('遵守技能持续期间、阻回及储存上限规则；被动或无技力技能不生效，联防沿用技力时不重复发放开场收益。');}
  if(prof)push('禁用该职业时不可选；高台封锁时也不可选择狙击、术师、医疗或辅助专属增益。');
 }
 if(e.mobDamageTakenMul)push('波次中普通与精英敌人受到的物理、法术、真实伤害 ×{mul}，不影响首领与元素伤害。',{mul:e.mobDamageTakenMul});
 if(e.opRedeployMul)push('我方干员再部署时间 ×{mul}；明确免再部署时间的效果仍为零。',{mul:e.opRedeployMul});
 if(e.bossAspdAdd)push('首领战领袖与隐秘核心攻速 +{n}，不改变固定技能间隔；普通与精英敌人不受影响。',{n:e.bossAspdAdd});
 if(e.bossDamageTakenMul)push('首领战领袖与隐秘核心受到的物理、法术、真实伤害 ×{mul}；元素伤害、普通与精英敌人不受影响。',{mul:e.bossDamageTakenMul});
 if(e.banProfession)push('职业禁选最多同时启用2条，避免过度缩小干员卡池。');
 if(e.prepTimeMul)push('整备时间 ×{mul}，最低10秒；单人也会开启计时，无基础时间时按120秒计算。',{mul:e.prepTimeMul});
 if(e.combatClockMul)push('普通与联防战斗时限、首领倒计时与加时起点各 ×{mul}；普通出怪时间轴同步压缩，普通战时限最低10秒。',{mul:e.combatClockMul});
 if(e.randomEliteCount)push('每轮每个战场追加 {n} 名追猎敌人：优先金额为1—4轮0—3资金，5—6轮0—4，7—8轮1—4，9—10轮1—5，11—12轮3—6，13—14轮4—7，15—16轮5—8，第17轮起6—8；仍按回合与基础强度筛选。剩余名额无主档候选时用低金额敌人补位，奖励原值不变；普通小首领第9轮、困难小首领第13轮起加入；第17轮前最多1名，第17轮最多2名，此后最多3名，其中困难小首领最多1名。追猎敌人不奖励资金，进入蓝门不扣血，包含首领与核心轮。',{n:e.randomEliteCount});
 if(e.lateReinforcementRatio)push('第13回合起，普通波次中普通与精英数量增加 {pct}%；不增加首领回合护卫，追加量按整波累计取整。',{pct:pct(e.lateReinforcementRatio)});
 if(e.bountyLeakPenalty)push(e.bountyLeakPenalty<1?'悬赏目标在联防最终仍漏掉时，原委托者下回合收益扣除该目标赏金的50%，向上取整且至少1资金；队友在联防击倒则不扣款。':'悬赏目标在联防最终仍漏掉时，原委托者下回合收益扣除该目标的全部赏金；队友在联防击倒则不扣款。');
 if(e.bountyEveryRound)push('每轮按分队共同轮选5项悬赏，每人选择1项，已选项不可重复领取，仅持续本轮；5项为2个当前最高赏金、1个低1资金、1个低2资金，另1个等概率取最高、低1或低2资金。各分队独立抽取，每回合优先更换目标；同页不重复，人数不足时取最近合法档。首领与核心轮也选择，超时或AI自动选择，奖励按原卡结算。');
 if(e.bountyLateFrom)push('第{round}回合起每隔两回合追加分队共享5项悬赏，每人选择1项；此后的首领与核心轮也选择。5项为2个当前最高赏金、1个低1资金、1个低2资金，另1个等概率取最高、低1或低2资金。各分队独立抽取，每回合优先更换目标；同页不重复，人数不足时取最近合法档。仅持续本轮，奖励按原卡结算。超时或AI自动选择。',{round:e.bountyLateFrom});
 if(e.bountyEveryRound||e.bountyLateFrom){
  push('合约悬赏本体额外生命按原赏金1—8增加6%—20%且只计算一次；0赏金、普通悬赏、护卫和衍生物不增加，既有具名挑战保护保留。');
  push('前8回合赏金全额；第9回合起按原委托者每轮前3资金全额，超出部分减半向下取整，净回款最多5；4→3、5→4、6→4、7→5、8→5。尾刀、分队或重连不重置。');
  push('原赏金和违约规则不变：原赏金8、净回款5的目标失败时，半额违约仍为4、全额仍为8；普通悬赏不并入递减。');
 }
 if(c.requiresAny?.length)push('需要先选择任一延长战线合同；不同战线模式互斥。');
 if(c.benefit)push('挑战分达到 {n} 后可选，占用 1 个增益名额，不增加危机分数。',{n:c.minScore});
 return rows;
}
export function renderEffectRow(row,t=null) {
 const params=Object.fromEntries(Object.entries(row.params).map(([key,value])=>[key,t&&typeof value==='string'&&!/^[+\-\d.]+$/.test(value)?t(value):value]));
 return t?t(row.key,params):row.key.replace(/\{(\w+)\}/g,(_,key)=>String(params[key]??''));
}
export const contractSummary=(c,t=null)=>renderEffectRow(contractEffectRows(c)[0]||{key:c.desc||'',params:{}},t);
export const contractDetails=(c,t=null)=>contractEffectRows(c).map(row=>renderEffectRow(row,t)).join('\n\n');
