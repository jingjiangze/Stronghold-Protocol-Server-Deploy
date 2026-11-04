// Owner 2026-11-01: port only Horn ISW-A into ordinary web matches. All other mode gates remain intact.
export const HORN_WEB_MODULE_ID = 'uniequip_004_horn';
export function hornWebModuleActive(record) {
  const raw = record?.raw ?? record;
  return (record?.charId ?? raw?.charId) === 'char_4039_horn'
    && raw?.module?.id === HORN_WEB_MODULE_ID && raw.module.active === true;
}
export function hornWebGoalTile(tile) {
  return !!tile && tile.height === 'LOW' && ((tile.tileKey ?? tile.key) === 'tile_end' || tile.special === 'end');
}
