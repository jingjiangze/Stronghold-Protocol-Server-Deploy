// Only market-triggered extra gains are budgeted. Wages, battle rewards, loans and direct purchases are unchanged.
import {N_} from './i18n.js';
export const ECONOMY_LIMITS=Object.freeze({funds:10,gifts:5,refreshes:5,layers:50});
export const MARKET_HOOKS=new Set(['onBuy','onSold','onRefresh','onGain','onTraitGain','onSpend']);
export function economyBudget(ps,kind,amount,explicitSource=null){
 const n=Number.isFinite(amount)?Math.max(0,Math.trunc(amount)):0;
 const source=explicitSource||ps._economySource;
 if(!source||!ps.round||!ECONOMY_LIMITS[kind]||!n)return n;
 const ledger=ps.round.economyGuard||=(Object.create(null)),key=source+':'+kind;
 const row=ledger[key]||=( {used:0,notified:false} );
 const allowed=Math.min(n,Math.max(0,ECONOMY_LIMITS[kind]-row.used));row.used+=allowed;
 if(allowed<n&&!row.notified){row.notified=true;ps.m?.toast?.(ps,'warn',N_('本回合该来源的额外收益已达上限'));}
 return allowed;
}
export function inheritedPurchaseCost(pieces,sellPrice){
 if(!pieces.some(p=>Number.isFinite(p.purchaseCost)))return undefined;
 return pieces.reduce((n,p)=>n+(Number.isFinite(p.purchaseCost)?p.purchaseCost:Math.max(0,sellPrice(p.id)||0)),0);
}
export function guardedSale(ps,piece,gain){
 if(!Number.isFinite(piece.purchaseCost))return gain;
 const refund=Math.min(gain,Math.max(0,piece.purchaseCost));
 return refund+economyBudget(ps,'funds',gain-refund,'trade:resale');
}
