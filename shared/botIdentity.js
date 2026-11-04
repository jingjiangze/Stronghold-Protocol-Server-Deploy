// Stable presentation identities for AI teammates. These characters have original art in the installed roster.
export const BOT_OPERATORS = Object.freeze([
 ['char_171_bldsk','华法琳'],['char_306_leizi','惊蛰'],['char_003_kalts','凯尔希'],['char_498_inside','隐现'],['char_102_texas','德克萨斯'],
 ['char_469_indigo','深靛'],['char_496_wildmn','野鬃'],['char_199_yak','角峰'],['char_4137_udflow','深巡'],['char_4100_caper','跃跃'],
 ['char_127_estell','艾丝黛尔'],['char_253_greyy','格雷伊'],['char_107_liskam','雷蛇'],['char_279_excu','送葬人'],['char_181_flower','调香师'],
 ['char_143_ghost','幽灵鲨'],['char_4114_harold','哈洛德'],['char_491_humus','休谟斯'],['char_4016_kazema','风丸'],['char_172_svrash','银灰'],
].map(([charId,name])=>Object.freeze({charId,name})));
export const botName = operator => 'AI·'+operator.name;
export function roomBotIdentities(seats=[]) {
 const result=new Map(),used=new Set(),pending=[];
 for(const seat of seats){if(!seat?.isBot)continue;const op=BOT_OPERATORS.find(x=>x.charId===seat.botCharId||botName(x)===seat.name);if(op&&!used.has(op.charId)){result.set(seat.playerId,op);used.add(op.charId);}else pending.push(seat);}
 for(const seat of pending){const op=BOT_OPERATORS.find(x=>!used.has(x.charId));if(op){result.set(seat.playerId,op);used.add(op.charId);}}
 return result;
}
/** Fill visual identity fields when connecting to an older local server; never changes combat input or player IDs. */
export function withBotPresentation(players){
 if(!Array.isArray(players))return players;const identities=roomBotIdentities(players);
 return players.map(player=>{if(!player?.isBot||player.namecard?.charId||player.profile?.namecard?.charId)return player;const op=identities.get(player.playerId);if(!op)return player;const namecard={charId:op.charId,skinId:null,theme:'mint',zoom:1.4};return {...player,name:botName(op),botCharId:op.charId,avatar:op.charId,namecard,profile:{...player.profile,namecard}};});
}
