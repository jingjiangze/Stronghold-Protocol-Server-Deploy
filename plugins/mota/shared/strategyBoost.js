import {contractPoints,crisisActive} from './contracts.js';
export const STRATEGY_BOOST_SCORE = 20;
export const strategyBoostEnabled = (ids,difficulty,players=20) => crisisActive(ids,difficulty) && contractPoints(ids,difficulty,players)>=STRATEGY_BOOST_SCORE;
const cache=new WeakMap();
const HP={band_bldsk:30,band_amiya:28,band_sarkazb:50,band_orchid:32,band_justin:25,band_pepe:24,band_mberry:30,band_yu:30,band_doberm:35,band_cathy:28,band_chen:26,band_damaztic:30,band_ducklord:25,band_lisa:24,band_vodfox:26,band_mlyss:23};
const DESCS={
 band_bldsk:'【重点监护】开始作战时，使场上每个不同等阶的1个随机我方干员的所属盟约层数+3。',
 band_amiya:'【众志合一】场上存在3、4或5种以上激活盟约时，所有干员攻击力+20/30/40%，生命值+25/35/50%。',
 band_duyaoy:'【广交豪杰】每回合前3次主动刷新为特殊刷新：优先刷新出1名【炎】干员。',
 band_sarkazb:'【坚不可摧】初始目标生命值为50点。',
 band_orchid:'【猎头顾问】每次主动刷新必定刷新2名同名干员，并冻结其中1名；第7、10回合各获得1个寻呼模块，第12回合获得1个信标。',
 band_justin:'【私募基金】第1、4、7、10、12回合各获得1个骑士储蓄罐。',
 band_ermengard:'【命结之秘】每场战斗前4个被击倒的干员立即复活。',
 band_lmlee:'【得闲饮茶】第1、2回合资金暂存至第3回合发放；第3回合获得二、三、四阶随机干员各1名。',
 band_kirara:'【通关奖励】每使用18资金，获得1名不高于当前调度中心等级的随机干员。',
 band_pepe:'【博学多通】升级调度中心至2、4、6级后获得1次特殊刷新，优先出现【萨尔贡】干员；该次刷出的【萨尔贡】干员购买费用−1。',
 band_harold:'【人才盲盒】从第3回合开始，每2回合获得1名【维多利亚】干员。',
 band_paganini:'【定制铳械】累计花费55资金后，获得1名5阶及以上随机精锐【拉特兰】干员。',
 band_clementia:'【崇高牺牲】【阿戈尔】干员被击倒时和复活后，各提供等同于其等阶的【阿戈尔】盟约层数。',
 band_emperor:'【加急调派】我方干员每次部署后，再部署时间减少50%；部署所需费用减少30%。',
 band_mberry:'【药枚实验】战斗开始时，最右边的所有我方单位每次攻击有28%概率获得1层护盾（最多1层）。',
 band_humus:'【回收利用】地面干员技能结束时，使周围四格随机1名干员获得4点技力。',
 band_quintus:'【不稳定要素】第2回合获得1件突变细胞。',
 band_yu:'【文火慢炖】第8回合开始时，若仅激活1个盟约，使其增加40层；否则使所有已激活盟约各增加15层。',
 band_malkie:'【商业包装】初始获得普通商业包装方案；每回合默认商店首格干员的最终购买费用为1资金，刷新不再触发。',
 band_qalaisa:'【食腐之蝶】我方干员被击倒时，场上剩余我方单位攻击力+25%，最多10层（250%），持续至其被击倒或战斗结束。',
 band_pith:'【优等生】第1回合获得属于调和盟约的特殊辅助预备干员；调度中心升至4级后，使最初获得且仍持有的该干员变为精锐。调和不占合约的同时激活盟约名额。',
 band_dusk:'【墨色真颜】场上同名干员攻击力+35%；第1回合获得画卷。',
 band_cannot:'【利滚利】剩余资金可以继承，剩余至少4资金时，每回合额外获得1资金。',
 band_ducklord:'【神秘顾客】从第5回合起仅自己遭遇的部分敌人可替换为鸭爵、高普尼克、流泪小子、圆仔；队友从第6回合起生效。击倒者获得1资金，包含联防。',
 band_ioleta:'【统御号令】战斗开始时，场上每有1名精锐干员，精锐干员生命值+20%、攻击力+15%。',
 band_jesica:'【集结指示】第1、4、7、10、13、15回合各获得1个寻呼模块。',
 band_mlyss:'【至纯凝结】第1回合获得1个进阶博士投影；调度中心升至5级后，额外获得1个普通博士投影。',
 band_makiri:'【九流之缘】偶数回合进入休整期时，随机免费获得调度中心的1名干员；每逢4的倍数回合额外获得1名。',
 band_fang:'【协力共进】第6、8、10、12、14、16回合各获得1个信标，原干员下回合发送给指定存活队友。',
 band_mlynar:'【业务指标】每购买1名【卡西米尔】干员，下回合开始时资金+2，每回合至多3资金。',
 band_chiave:'【团伙行动】主动刷新5次调度中心后，获得1名不高于调度中心等级的【叙拉古】干员，每回合至多2名。',
 band_narant:'【见者有份】偶数回合进入休整期时，特殊刷新3件装备，免费选择1件；原萨尔贡六人效果替换机制保留。',
 band_tulip:'【人才荟萃】每次升级调度中心，随机获得1名原型协防干员；累计每升级2次，随机使1名在场普通原型协防干员变为精锐。协防干员盟约不占合约的同时激活盟约名额。',
};
const numeric={
 band_bldsk:{layer:3},band_amiya:{max_hp_1:.25,max_hp_2:.35,max_hp_3:.5},band_duyaoy:{refresh_limit:3},
 band_ermengard:{max_respawn_cnt:4},band_kirara:{coin_cnt:18},band_harold:{round:3},band_paganini:{min_tier:5},
 band_mberry:{prob:.28},band_humus:{sp:4},band_quintus:{round:2},band_yu:{count1:40,count2:15},
 band_qalaisa:{atk:.25},band_dusk:{atk:.35},band_cannot:{capital:4},band_ioleta:{atk_per_cnt:.15,max_hp_per_cnt:.2},
 band_makiri:{count:1},band_mlynar:{count:2,max_count:3},band_chiave:{refresh_count:5},band_narant:{refresh_cnt:3},
};
const gift=(round,chess)=>({key:'preparation_start_gain_chess_from_round',bb:{round,count:1},bbStr:{chess}});
const special=key=>({key,bb:{},bbStr:{}});
/** Immutable view. Original records remain exact below the threshold and in ordinary matches. */
export function boostedStrategy(record,enabled){
 if(!record||!enabled||(!DESCS[record.bandId]&&!HP[record.bandId]))return record;
 if(cache.has(record))return cache.get(record);
 const b=structuredClone(record),id=b.bandId;b.contractBoosted=true;
 if(HP[id]!=null)b.totalHp=HP[id];
 if(DESCS[id])b.desc=b.descRaw=DESCS[id];
 if(numeric[id])for(const buff of b.buffs||[]){
  const values=numeric[id];
  for(const [key,value]of Object.entries(values))if(Object.hasOwn(buff.bb||{},key)||['refresh_limit','min_tier','any_bond'].includes(key)){buff.bb||={};buff.bb[key]=value;}
 }
 if(id==='band_orchid')b.buffs.push(gift(7,'chess_item_4_01_e_a'),gift(12,'chess_item_5_04_e_a'));
 if(id==='band_justin')b.buffs.push(gift(12,'chess_item_3_12_e_a'));
 if(id==='band_lmlee')b.buffs.push({key:'prep_start_gain_chess_from_pool_in_round',bb:{round:3,count:1},bbStr:{pool:'pool_chess_shop_3_reward'}});
 if(id==='band_pepe')for(const p of b.buffs)if(p.key==='up_shop_next_refresh_must_present_bond_char')p.bb.discount=1;
 if(id==='band_makiri')for(const p of b.buffs)if(p.key==='round_start_gain_char_chess_in_shop_every_n_round'){p.bb.bonus_round=4;p.bb.bonus_count=1;}
 if(id==='band_malkie')b.buffs.push(special('owner_malkie_discount'));
 if(id==='band_pith')b.buffs.push(special('owner_pith_promotion'));
 if(id==='band_mlyss')b.buffs.push(special('owner_mlyss_projection'));
 if(id==='band_jesica')b.buffs.push(gift(1,'chess_item_4_01_e_a'),gift(15,'chess_item_4_01_e_a'));
 if(id==='band_fang')b.buffs.push(gift(6,'chess_item_5_04_e_a'),gift(16,'chess_item_5_04_e_a'));
 if(id==='band_emperor')for(const p of b.buffs)if(p.bbStr?.key==='act1autochess_band16_buff')p.bb.deploy_cost_mul=.7;
 if(id==='band_clementia')for(const p of b.buffs)if(p.bbStr?.key==='act1autochess_band13_buff')p.bb.revive_layers=1;
 if(id==='band_ducklord')for(const p of b.buffs)if(p.key==='round_start_all_player_change_enemy_2')p.bb.teammate_round=6;
 cache.set(record,b);return b;
}
