const held=ctx=>[...ctx.board(),...ctx.hand(),...ctx.temp()].filter(p=>p?.kind==='chess');
export const OWNER_STRATEGY_KEYS={
 owner_malkie_discount:()=>({onPrice(ctx,ev){if(ev.kind==='chess'&&ev.slot?.malkieDefaultRound===ctx.round)ctx.setPrice(1);}}),
 owner_mlyss_projection:()=>({onLevelUp(ctx,ev){if(ev.level>=5&&!ctx.counter('band:mlyss:extra')){ctx.setCounter('band:mlyss:extra',1);ctx.grantItem('chess_item_5_06_e_a',{source:'band'});}}}),
 owner_pith_promotion:()=>({
  onRoundStart(ctx){if(ctx.round===1&&!ctx.counter('band:pith:original')){const p=held(ctx).find(p=>p.id==='chess_char_1_15_a'||p.id==='chess_char_1_15_b');if(p)ctx.setCounter('band:pith:original',p.uid);}},
  onLevelUp(ctx,ev){if(ev.level<4||ctx.counter('band:pith:promoted'))return;const uid=ctx.counter('band:pith:original'),p=held(ctx).find(p=>p.uid===uid);if(p){if(!ctx.gd.isGolden(p.id))ctx.promote(p.uid);ctx.setCounter('band:pith:promoted',1);}},
 }),
 owner_tulip_prototype:()=>({onLevelUp(ctx,ev){
  const key='band:tulip:level:'+ev.level;if(ctx.counter(key))return;ctx.setCounter(key,1);
  const options=Object.values(ctx.gd.raw.chess||{}).filter(c=>c.ownerPrototype&&!c.isGolden&&!ctx.gd.fx.banProfessions?.includes(c.profession)).sort((a,b)=>a.chessId<b.chessId?-1:1);
  if(options.length)ctx.grantChess(ctx.rng.pick(options).chessId,{source:'band',requirePool:false});
  const upgrades=ctx.incCounter('band:tulip:upgrades',1);
  if(!ctx.gd.strategyBoost||upgrades%2)return;
  const board=ctx.board().filter(p=>p?.kind==='chess'&&ctx.gd.chess(p.id)?.ownerPrototype&&!ctx.gd.isGolden(p.id));
  if(board.length)ctx.promote(ctx.rng.pick(board).uid);
 }}),
};
