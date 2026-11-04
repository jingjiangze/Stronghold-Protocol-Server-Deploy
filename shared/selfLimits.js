import {N_} from './i18n.js';
export const SELF_LIMIT_DRAFT_SECONDS=90;
export const SELF_LIMIT_RULES=Object.freeze({deploymentMax:2,bondsMax:2,layersMax:3,bondBase:7,hpFactor:.94,redeployFactor:1.08,rotationMax:4,incomeMax:2,incomeFromRound:6});
export const SELF_LIMITS=Object.freeze([
 {id:'deployment',name:N_('收缩防线'),icon:'shield',desc:N_('自身可部署干员数减少1，最多选择2次，最低保留1位。')},
 {id:'bonds',name:N_('盟约取舍'),icon:'horde3',desc:N_('自身可激活盟约数减少1，最多选择2次；无其他限制时依次限制为6个、5个。')},
 {id:'layers',name:N_('限制叠层'),icon:'signal',desc:N_('自身盟约叠层上限降低一档，默认依次为600、400、250；已有更低上限时继续降低，最多选择3次。')},
 {id:'vitality',name:N_('轻装出击'),icon:'heart',desc:N_('自身干员最大生命值降低6%，重复选择乘算。')},
 {id:'rotation',name:N_('轮换滞后'),icon:'hourglass',desc:N_('自身干员再部署时间增加8%，最多选择4次。')},
 {id:'supplies',name:N_('军需压缩'),icon:'lock',desc:N_('从第6回合起，自身每回合基础收入减少1资金，最多减少2资金。')},
].map(Object.freeze));
export const SELF_BENEFITS=Object.freeze([
 {id:'attack',name:N_('战术校准'),icon:'sword',desc:N_('自身干员攻击力增加2%，最多增加8%。'),max:4},
 {id:'armor',name:N_('轻型护甲'),icon:'shield',desc:N_('自身干员防御力增加3%，最多增加12%。'),max:4},
 {id:'vitality',name:N_('应急补给'),icon:'heart',desc:N_('自身干员最大生命值增加4%，最多增加16%。'),max:4},
 {id:'opening',name:N_('开场协作'),icon:'signal',desc:N_('自身干员首次部署获得1点技力，最多额外获得3点。'),max:3},
].map(Object.freeze));
export const selfLimitRequired=score=>Math.max(0,Math.floor((Number.isFinite(score)?score:0)/50));
export function selfLimitEffects(picks=[],context={}){
 const n=id=>picks.filter(x=>x===id).length,layers=n('layers'),bonds=n('bonds');
 let cap=context.layerCap??999;for(let i=0;i<Math.min(layers,SELF_LIMIT_RULES.layersMax);i++)cap=[600,400,250,150,100,75,50,25,10,5,1].find(v=>v<cap)??1;
 return {deployReduction:Math.min(SELF_LIMIT_RULES.deploymentMax,n('deployment')),bondCap:bonds?Math.max(1,(context.activeBondCap??SELF_LIMIT_RULES.bondBase)-Math.min(bonds,SELF_LIMIT_RULES.bondsMax)):null,layerCap:layers?cap:null,hpMul:SELF_LIMIT_RULES.hpFactor**n('vitality'),redeployMul:SELF_LIMIT_RULES.redeployFactor**Math.min(SELF_LIMIT_RULES.rotationMax,n('rotation')),incomePenalty:Math.min(SELF_LIMIT_RULES.incomeMax,n('supplies'))};
}
export const selfBenefitAvailable=(picks,id)=>{const c=SELF_BENEFITS.find(c=>c.id===id);return !!c&&picks.filter(k=>k===id).length<c.max;};
export function selfBenefitEffects(picks=[]){const n=id=>picks.filter(k=>k===id).length;return {atk:1+Math.min(4,n('attack'))*.02,def:1+Math.min(4,n('armor'))*.03,hp:1+Math.min(4,n('vitality'))*.04,openingSP:Math.min(3,n('opening'))};}
