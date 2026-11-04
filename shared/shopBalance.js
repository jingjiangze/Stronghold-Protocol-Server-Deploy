// Owner's explicit 2026-10-27 weights. Only ordinary
// shop draws use these weights; capacities, grants, rewards and DIY slot records do not.
export const MUELSYSE_SHOP_CHAR_ID='char_249_mlyss';
export const SHOP_BALANCE = Object.freeze({ conversionRate: 0.82, inactiveConversionBonus: 0.12, diyWeight: 1.32, activeOperatorWeight: 1.20, muelsyseWeight: 1.14 });

export function shopBalance(gd) {
  const cfg = gd?.economy?.shopBalance;
  const read = (key, min, max) => Number.isFinite(cfg?.[key]) && cfg[key] >= min && cfg[key] <= max ? cfg[key] : SHOP_BALANCE[key];
  return { conversionRate: read('conversionRate', 0, 1), inactiveConversionBonus: read('inactiveConversionBonus', 0, 1), diyWeight: read('diyWeight', 1, 2), activeOperatorWeight: read('activeOperatorWeight', 1, 2), muelsyseWeight: read('muelsyseWeight', 1, 2) };
}
