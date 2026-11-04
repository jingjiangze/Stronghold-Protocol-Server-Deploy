/** Owner music/escort affiliations. These do not add leaders to ordinary-wave pools. */
export const BOSS_FACTIONS = Object.freeze({
  boss_1: 'URSUS', boss_8: 'URSUS', boss_2: 'URSUS', boss_9: 'URSUS',
  boss_3: 'LEITHANIEN', boss_10: 'LEITHANIEN', boss_4: 'SEA_BORN',
  boss_5: 'SCARLET', boss_6: 'VICTORIA', boss_7: 'SAMI',
  boss_11: 'REUNION', boss_patriot: 'REUNION', boss_pursuer: 'URSUS',
});
/** Escort armies can change without replacing a boss's dedicated music. */
export const BOSS_ESCORT_FACTIONS = Object.freeze({
  ...BOSS_FACTIONS,
  boss_1: 'VICTORIA', boss_8: 'VICTORIA',
  boss_2: 'LATERANO', boss_9: 'LATERANO',
});
export const FACTION_THEMES = Object.freeze({
  REUNION: 'reunion', URSUS: 'ursus', DEEP_POOL: 'abyss', VICTORIA: 'victoria',
  SARKAZ: 'sarkaz', LEITHANIEN: 'leithanien', YAN: 'yan', SEA_BORN: 'sea_born',
  KAZIMIERZ: 'kazimierz', KJERAG: 'kjerag', SIRACUSA: 'siracusa', LATERANO: 'laterano',
  IBERIA: 'iberia', SIESTA: 'siesta', SARGON: 'sargon', BOLIVAR: 'bolivar',
  DURIN: 'durin', HIGASHI: 'higashi', SAMI: 'sami', COLUMBIA: 'columbia', SCARLET: 'scarlet',
});
export const SCRIPTED_ESCORT_BOSSES = Object.freeze(['boss_11', 'boss_patriot', 'boss_pursuer']);
export const SCARLET_ESCORTS = Object.freeze(['enemy_2009_csaudc', 'enemy_2010_csdcr', 'enemy_2011_csppt', 'enemy_2012_csbln']);
