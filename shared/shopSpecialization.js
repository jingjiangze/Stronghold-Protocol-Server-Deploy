/** Deterministic count-first ranking; only active bonds participate. */
export function topActiveBonds(bonds){return Object.entries(bonds||{}).filter(([,b])=>b.active).sort((a,b)=>b[1].count-a[1].count||(b[1].layers||0)-(a[1].layers||0)||(a[0]<b[0]?-1:1)).slice(0,3).map(([id])=>id);}
export function preferConversionItem(id,{gd,round,level,bonds,stock,rng}){
 const item=gd.item(id);if(!(round>6)||!item?.giveBondId)return id;
 const top=new Set(topActiveBonds(bonds));if(!top.size||top.has(item.giveBondId))return id;
 const candidates=[];
 for(let tier=1;tier<=Math.min(6,level);tier++)for(const key of gd.shopItemsByTier[tier]||[]){const rec=gd.item(key);if(rec?.giveBondId&&top.has(rec.giveBondId)&&(!stock||stock.canGain(key)))candidates.push(key);}
 if(!candidates.length)return id;
 const distance=Math.min(...candidates.map(key=>Math.abs(gd.item(key).tier-item.tier)));
 const nearest=candidates.filter(key=>Math.abs(gd.item(key).tier-item.tier)===distance);
 return stock?stock.pick(rng,nearest)||id:nearest[Math.floor(rng()*nearest.length)]||id;
}
