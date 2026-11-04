/** Pursuer-only owner rules, shared by combat, generated descriptions and preparation previews. */
export const PURSUER_KEY = 'enemy_1520_empgrd';
export const PURSUER_RULES = Object.freeze({
  rebirth: 7.2, rebirthDelay: .6, assassinationEvery: 60, strikeDelay: 1.067, redeployMul: 1.5,
  cloakEvery: 45, cloakDuration: 1, dodgeEvery: 24, dodgeDuration: .5, flashStep: .12, flashCount: 2,
  realmDuration: 40, realmSpreadEvery: 2, realmMaxTiles: 9, realmLiveCap: 4, realmAspd: -20, realmResistance: .2,
  armyEvery: 29, armyLiveCap: 80, armyTotalCap: 400,
});

export const PURSUER_ARMY_DESCRIPTION = '每29秒召集8名乌萨斯集团军敌人，普通与精锐轮换；每3波仅第3波各有1名指挥官、破城者，其余对应席位为机动弩手、潜行兵。护卫首次过门后隐藏3秒再战，第二次过门结算漏怪。';

/** Player IDs in a match pair use pair order; Battle players carry an explicit side. */
export function pursuerFieldSides(players) {
  if (!Array.isArray(players) || !players.length) return [-1];
  const sides = players.map((p, i) => p?.side === 'R' ? 1 : p?.side === 'L' ? -1 : i === 0 ? -1 : 1);
  return [-1, 1].filter(side => sides.includes(side));
}

/** Same fixed home tiles and outward facing as phase-one combat. */
export function pursuerBodySlots(players, rect = { c0: 0, c1: 20 }) {
  const center = (rect.c0 + rect.c1) / 2;
  return pursuerFieldSides(players).map(side => ({ side, start: [4, center + side], facing: side }));
}

/** Apply AFTER previewOf: its single scheduled body creates the other combat body at spawn time. */
export function pursuerPrepEntries(list, players, rect) {
  if (!Array.isArray(list)) return list;
  let expanded = false;
  return list.flatMap(entry => {
    if (!entry?.boss || entry.enemyKey !== PURSUER_KEY) return [entry];
    if (expanded) return [];
    expanded = true;
    return pursuerBodySlots(players, rect).map(slot => ({ ...entry, count: 1,
      start: slot.start, facing: slot.facing, pursuerSide: slot.side,
      previewId: `pursuer:${slot.side}` }));
  });
}
