import {N_} from './i18n.js';
export const EVENT_CHANCES=Object.freeze([.05,.1,.2,.5,1]);
export const EVENT_MODES=Object.freeze(['same','independent','together']);
export const DEFAULT_RANDOM_EVENTS=Object.freeze({enabled:false,chance:.2,mode:'same'});
export const validRandomEvents=v=>!!v&&typeof v==='object'&&!Array.isArray(v)&&typeof v.enabled==='boolean'&&EVENT_CHANCES.includes(v.chance)&&EVENT_MODES.includes(v.mode)&&Object.keys(v).every(k=>['enabled','chance','mode'].includes(k));
export const randomEventSettings=v=>validRandomEvents(v)?{enabled:v.enabled,chance:v.chance,mode:v.mode}:{...DEFAULT_RANDOM_EVENTS};
export const ROUND_EVENTS=Object.freeze([
 {id:'fragile',name:N_('脆弱的防线'),story:N_('我们的防线脆弱不堪，已经被敌人攻陷，后方出现大批敌人。'),effect:''},
 {id:'ursusRoar',name:N_('乌萨斯的咆哮'),story:N_('一头失控的巨熊闯入了我们的防线。'),effect:N_('失控巨熊会攻击双方，狂暴结束后穿过最近的门，再从另一侧带着狂暴返回。击杀奖励4资金。')},
 {id:'artillery',name:N_('乌萨斯炮击'),story:N_('战场远处响起了阵阵炮火。'),effect:N_('每10秒随机轰炸一处我方区域，对范围内双方单位造成伤害。')},
 {id:'roulette',name:N_('乌萨斯轮盘赌'),story:N_('一把转轮式铳放在桌上。'),effect:N_('50%概率本轮全员攻击力+25%，50%概率一名随机干员被击倒。')},
 {id:'dragon',name:N_('龙吟'),story:N_('远处传出了一阵刀鞘和龙吼声。'),effect:N_('开战5秒后，一条游龙从蓝门出发，弹射前往红门，对沿途双方造成伤害。')},
 {id:'autoChess',name:N_('真正的自走棋'),story:N_('原来你们会走路呀。'),effect:N_('本轮地面干员向红门推进，到达后从蓝门重现并继续前进。')},
 {id:'enemyBox',name:N_('惊吓盲盒'),story:N_('Surprise'),effect:N_('随机一名其他首领级敌人作为敌方支援登场。'),wheel:true},
 {id:'allyBox',name:N_('惊喜盲盒'),story:N_('Surprise'),effect:N_('随机一名其他首领级单位作为我方支援登场。'),wheel:true},
 {id:'enemyFusion',name:N_('众人之心'),story:N_('他们汇聚在了一起。'),effect:N_('本轮敌军合为一名单位，继承全部基础属性总和。首领战保留领袖作为载体。')},
 {id:'allyFusion',name:N_('我来同你玩'),story:N_('我做业，你放100个炮芯。'),effect:N_('本轮仅保留一名随机干员，继承己方所有干员的基础属性总和。')},
 {id:'meaning',name:N_('何意味'),story:N_('何意味'),effect:N_('本轮没有特殊效果。')},
 {id:'shuffle',name:N_('666还有转换位置'),story:N_('一阵光束之后，你发现你站在了其他的地方。'),effect:N_('本轮随机变换干员的合法部署位置，回合结束后恢复。')},
 {id:'teamShuffle',name:N_('666还有加强版'),story:N_('一阵光束之后，你发现大家的干员都变了。'),effect:N_('本轮与队友随机对调编队并重新分配合法位置，回合结束后恢复。')},
 {id:'double',name:N_('超级加倍'),story:N_('王炸'),effect:N_('追加抽取两项事件，不会递归抽取超级加倍。')},
]);
const BY_ID=new Map(ROUND_EVENTS.map(e=>[e.id,e]));
export const roundEventById=id=>BY_ID.get(id)||null;
export const flattenedEvents=events=>(events||[]).flatMap(e=>e.id==='double'?(e.children||[]):[e]);
