// Mon3tr's maintained roster trait increases a neighboring operator's SOURCE cap, never global/contract caps.
import { garrisonRecord } from './index.js';
export function ownerLayerCap(battle,source,cap){
 if(!source?.def?.charId?.startsWith('char_')||!Number.isFinite(cap)||!Number.isInteger(source.tileR)||!Number.isInteger(source.tileC))return cap;
 let ratio=0;
 for(const u of battle.units.values()){
  if(!u.alive||u.deployed===false||u.side!=='ally'||u.ownerId!==source.ownerId||u.def?.charId!=='char_4179_monstr')continue;
  const aura=u.def?.raw?.garrisonIds?.map(garrisonRecord).find(g=>g?.effectKey==='OWNER_ADJACENT_LAYER_CAP');
  if(!aura)continue;
  const dr=Math.abs(u.tileR-source.tileR),dc=Math.abs(u.tileC-source.tileC);
  // [ASSUMED] This named aura does not stack with another Mon3tr. The eight neighboring tiles exclude self.
  if(dr<=1&&dc<=1&&(dr||dc))ratio=Math.max(ratio,aura.bb.cap_ratio);
 }
 return Math.floor(cap*(1+ratio));
}
