// Two-stage identification on the deterministic game clock; vision, not damage, reveals a spy.
import {absoluteRangeKeys} from '../../targeting.js';
import {bodyInRange} from '../../body.js';
import {setForm,T} from './helpers.js';
import {INVESTIGATION_KEYS,SPY_INVESTIGATION_RULES as RULES,spyInvestigationState} from '../../../../shared/spyInvestigation.js';
export {INVESTIGATION_KEYS};
export const investigation=kind=>ab=>{
 const reveal=(b,e)=>{
  b.removeBuff(e,'spy:unidentified');e.profile.noAttack=false;setForm(b,e,'revealed');
  const move=T(ab,'moveSpeed.move_speed')??0;if(move)b.addBuff(e,{key:'spy:revealedSpeed',persist:true,mods:{moveFlat:move}});
  if(kind==='scout')e.mem.contractSpyStrike=!e.mem.spyStrikeSpent;
  if(kind==='sentry')b.addBuff(e,{key:'spy:revealedStealth',persist:true,flags:{stealth:true}});
  b.fx('appear',{id:e.id,x:e.x,y:e.y});
 };
 return [{
 iv:RULES.interval,
 spawn(b,e,a){
  const state=spyInvestigationState(e.mods);a.stage=Math.floor(state.spyInvestigation/RULES.stagePoints);a.progressUnits=Math.round((state.spyInvestigation%RULES.stagePoints)*RULES.pointScale);
  e.mem.investigation=state.spyInvestigation;e.mem.spyStrikeSpent=state.spyStrikeSpent;
  if(a.stage===2){reveal(b,e);return;}
  e.profile.noAttack=true;setForm(b,e,'disguised');b.addBuff(e,{key:'spy:unidentified',persist:true,flags:{invulnerable:true,untargetable:true}});
 },
 tick(b,e,a){
  if(a.stage===2)return;
  const seen=!!e.blockedBy||b.allyUnits.some(u=>u.alive&&u.deployed&&!u.hidden&&!u.removed&&!u.profile.noAttack&&bodyInRange(e,absoluteRangeKeys(u.profile.rangeGrid||u.def.rangeGrid||[[0,0]],u.tileR,u.tileC,u.dir,u.s.rangeExtend||0)));
  a.progressUnits=Math.max(0,a.progressUnits+(seen?(a.stage===0?RULES.firstGainUnits:RULES.secondGainUnits):-RULES.unseenLoss*RULES.pointScale));
  if(a.progressUnits>=RULES.stagePoints*RULES.pointScale){a.stage++;a.progressUnits=0;}
  e.mem.investigation=a.stage*RULES.stagePoints+a.progressUnits/RULES.pointScale;
  if(a.stage!==2)return;
  reveal(b,e);
 },
 hitOut(c,_b,e){if(!e.mem.contractSpyStrike||!c.dmg.isAttack)return;e.mem.contractSpyStrike=false;e.mem.spyStrikeSpent=true;c.dmg.amount*=T(ab,'EnhancedAttack.atk_scale')??2;},
}];
};
