// Explicit maintainer default, available choices only. No stored preference is changed here.
export const DEFAULT_MODULE_CHAR = 'char_1045_svash2';
export const DEFAULT_MODULE_ID = 'uniequip_002_svash2';

/** Keep the caller's existing fallback for every other operator and when the module is unavailable. */
export function operatorDefaultModule(charId, modules, fallback = null) {
  return charId === DEFAULT_MODULE_CHAR && Array.isArray(modules)
    && modules.some((m) => (typeof m === 'string' ? m : m?.uniEquipId) === DEFAULT_MODULE_ID)
    ? DEFAULT_MODULE_ID : fallback;
}
