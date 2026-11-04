import {isPressureEnemy,capEnemyBurstHit} from '../../../../shared/enemyPressure.js';
/** The single-hit fallback includes collateral HP damage after attacker modifiers; multi-hit skills divide their budget in their kit. */
export function installEnemyPressure(b){
 if(b._enemyPressureInstalled)return;
 b._enemyPressureInstalled=true;
 b.on('hit',c=>{
  const e=c.source;
  if(e?.side!=='enemy'||!isPressureEnemy(e.defId))return;
  c.dmg.amount=capEnemyBurstHit(b,e,c.dmg.amount);
 },{priority:0,owner:'enemy-pressure'});
}
