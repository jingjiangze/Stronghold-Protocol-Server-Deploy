/** A report leader is a scheduled Boss/Core, not merely a handbook BOSS-rank enemy. */
export const YAN_DEATH_PRODUCTS = Object.freeze([
  'enemy_1196_msfyin','enemy_1198_msfshu','enemy_1200_msfjin','enemy_1202_msfzhi',
  'enemy_1204_msfhu','enemy_1206_msfpin','enemy_1208_msfji','enemy_1210_msfden',
].flatMap(key => [key,key+'_2']));
export const isYanDeathProduct = key => YAN_DEATH_PRODUCTS.includes(key);
export const BOSS_MECHANISM_PARTS = Object.freeze(['enemy_9014_acstma','enemy_9015_acstmb','enemy_9018_actrpa','enemy_9019_actrpb','enemy_9020_actrpc','enemy_9022_acdumm','enemy_9023_acdums']);

export function leaderEnemyKeys(bosses) {
  return new Set((Array.isArray(bosses) ? bosses : Object.values(bosses || {})).map(b => b?.enemyKey).filter(Boolean));
}
export function enemyReportRank(enemy, bosses) {
  if (enemy?.rank !== 'BOSS') return enemy?.rank || 'NORMAL';
  return leaderEnemyKeys(bosses).has(enemy.key) ? 'BOSS' : 'ELITE';
}
