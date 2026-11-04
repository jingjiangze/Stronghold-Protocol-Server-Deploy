// Display-only state, derived from the four current native character modes and the existing authored kit state.
export const OPERATOR_SFX_IDS_20261101 = Object.freeze(['char_4245_alga', 'char_4247_oxi', 'char_4244_tocka', 'char_4246_dminon']);
const MODES = Object.freeze({ skchr_alga_2: 1, skchr_oxi_3: 1, skchr_tocka_3: 1,
  skchr_dminon_1: 1, skchr_dminon_2: 2, skchr_dminon_3: 3 });
export function operatorSfxState20261101(unit) {
  const id = unit?.def?.charId ?? unit?.def?.raw?.charId;
  if (!OPERATOR_SFX_IDS_20261101.includes(id)) return null;
  const mode = unit.skill?.active ? MODES[unit.skill.id] ?? 0 : 0;
  // These are real child ability suffixes, not filename guesses: Oxi BuffedAttack/Attack and Tocka buffed/normal shot.
  const branch = mode ? String(mode) : id === 'char_4247_oxi' ? (unit.findBuff?.('oxi:s2:stack') ? '0.1' : '0.2')
    : id === 'char_4244_tocka' ? (unit.mem?.tockaSnow ? '0.1' : '0.2') : '0';
  return { mode, branch };
}
