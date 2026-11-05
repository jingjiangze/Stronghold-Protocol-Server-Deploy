// 肉鸽官方图在 data/stages.json 里 name === id（tools/build-rogue-maps-v2.mjs:805 写 name: idn.id），
// 直接渲染 stage.name 等于把资源 ID 摆给玩家。规则与插件 roguePanel.js 的 mapLabel() 同一条
// （plugins/mota/client/js/ui/roguePanel.js:226）；核心不得 import 插件，所以这里独立实现。
const ROGUE_ID = /^rogue_(ro\d+)_([0-9a-z]+(?:-[0-9a-z]+)*?)(?:_dlc(\d+))?$/i;

/** `rogue_ro5_3-3_dlc1` → `RO5 · 3-3 · DLC1`；不是肉鸽 id → '' */
export function rogueStageLabel(stageId) {
  const m = ROGUE_ID.exec(String(stageId || ''));
  if (!m) return '';
  return `${m[1].toUpperCase()} · ${m[2]}${m[3] ? ` · DLC${m[3]}` : ''}`;
}

/**
 * 简报/抽屉里的战场名。非肉鸽保留数据名（`战场#05(上半) 涨潮/特制水上平台` 之类，一字不改）；
 * 肉鸽把 id 还原成短名；数据名缺失也不再退回原始 id（返回 '' 由调用方显示「—」）。
 */
export function stageDisplayName(stageId, stage) {
  const id = typeof stageId === 'string' ? stageId : '';
  const name = stage && typeof stage.name === 'string' ? stage.name : '';
  if (name && name !== id) return name;
  return rogueStageLabel(id) || name;
}
