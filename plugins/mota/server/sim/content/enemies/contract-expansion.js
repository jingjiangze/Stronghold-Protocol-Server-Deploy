// Additional official enemies for extended contract pools. Sources: official database + PRTS ability pages.
import {kitRefraction,noAirTargets} from './archetypes.js';
// [ASSUMED] A cross uses the central 1×3 and 3×1 tile rectangles, centred on the impact position, without grid snapping.
const mage=()=>[noAirTargets(),{spawn(b,e){e.profile.noProjectile=true;},hitOut(c,b,e){const t=c.target;if(!t||!c.dmg.isAttack||c.dmg.tags?.includes('contract:cross'))return;
 b.fx('explode',{x:t.x,y:t.y,r:1.5,kind:'artsSplash'});
 for(const u of b.allyUnits){if(u===t||!u.alive||!u.deployed||u.removed||u.isFlying)continue;const x=Math.abs(u.x-t.x),y=Math.abs(u.y-t.y);if((x<=1.5&&y<=.5)||(x<=.5&&y<=1.5))b.dealDamage(e,u,{amount:e.s.atk,type:'arts',canDodge:true,isAttack:false,tags:['contract:cross']});}
}}];
// AOEDamage.range_id x-4 is the official 3x3 square. No regrouping beams exist on Stronghold maps.
const towerMage=()=>[{spawn(_b,e){e.profile.maxTargets=2;},hitOut(c,b,e){
 const t=c.target;if(!t||!c.dmg.isAttack||c.dmg.tags?.includes('contract:towerSplash'))return;
 b.fx('explode',{x:t.x,y:t.y,r:1.5,kind:'artsSplash'});
 for(const u of b.allyUnits)if(u!==t&&u.alive&&u.deployed&&!u.removed&&Math.abs(u.x-t.x)<=1.5&&Math.abs(u.y-t.y)<=1.5)b.dealDamage(e,u,{amount:e.s.atk,type:'arts',canDodge:true,isAttack:false,tags:['contract:towerSplash']});
}}];
export const CONTRACT_ENEMY_KITS=Object.freeze({enemy_1018_aoemag:mage,enemy_1018_aoemag_2:mage,enemy_1167_dubow:kitRefraction,enemy_1167_dubow_2:kitRefraction,enemy_1241_ltmage:towerMage,enemy_1241_ltmage_2:towerMage});
export const CONTRACT_ENEMY_STATS=Object.freeze({enemy_1011_wizard_2:'plain ranged Arts',enemy_1015_litamr_2:'plain armored infantry',enemy_1035_haxe:'plain heavy infantry',enemy_1035_haxe_2:'plain heavy infantry',enemy_1108_uterer:'plain trained beast',enemy_1108_uterer_2:'plain trained beast',enemy_1109_uabone:'ordinary ranged infantry; airdrop is a stage spawn rule',enemy_1109_uabone_2:'same',enemy_1110_uamord:'armored ranged Arts',enemy_1110_uamord_2:'same',enemy_1111_ucommd_2:'block weight two is official data; civilian targets absent',enemy_1003_ncbow_2:'plain ranged infantry'});
