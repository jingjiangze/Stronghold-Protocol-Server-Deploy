// 肉鸽地图缩略图模型（2026-11-02；2026-11-04 加地形种类给叠加面板用）：**纯函数、无 import** —— 组件与 node 单测共用。

/**
 * 一格的渲染种类（叠加面板的地图页按这个上色；浮层的旧缩略图仍只读 `floor`）：
 *   `ground` 可走地面（含坑/传送点等 groundPassable 的格）· `high` 高台/墙（LOW 不可走的其余格 → `blocked`）
 *   `forbidden` 禁入（tile_forbidden 或地面与飞行都不可过）· `blocked` 其它不可走格。
 * 与 `floor` 同源：`floor[r][c] === true` ⇔ `kinds[r][c] === 'ground'`。
 */
export const TERRAIN = Object.freeze({ GROUND: 'ground', HIGH: 'high', FORBIDDEN: 'forbidden', BLOCKED: 'blocked' });

/** 一格 tile 定义 → TERRAIN（纯函数；缺定义按 blocked）。 */
export function terrainKind(tile) {
  if (!tile || typeof tile !== 'object') return TERRAIN.BLOCKED;
  if (tile.groundPassable === true || String(tile.passable || '').includes('WALK')) return TERRAIN.GROUND;
  if (String(tile.tileKey || '') === 'tile_forbidden' || tile.flyPassable === false) return TERRAIN.FORBIDDEN;
  if (String(tile.height || '').toUpperCase() === 'HIGH') return TERRAIN.HIGH;
  return TERRAIN.BLOCKED;
}

/**
 * 把一份 stage 数据规约成缩略图模型（纯函数，便于单测）：
 * `{ width, height, floor: [[bool]], kinds: [[TERRAIN]], marks: [{ r, c, kind: 'melee'|'ranged' }] }`。
 * 坐标已翻成「最上行在上」的屏幕方向（引擎 `rows[0]` 是最下行）。
 * 肉鸽官方小图嵌在 19×21 画框里：有 `stage.rogueFrame` 时只取 frame 内的 tiles（clamp 到画框），
 * `width/height` 是裁剪后的尺寸；没有 frame 保持整张 rows 原样。
 */
export function buildMinimapModel(stage) {
  if (!stage || !Array.isArray(stage.rows) || !stage.rows.length) return null;
  const rows = stage.rows;
  const fullH = rows.length;
  const fullW = Math.max(...rows.map((r) => String(r).length));
  if (!fullW) return null;
  const f = stage.rogueFrame && typeof stage.rogueFrame === 'object' ? stage.rogueFrame : null;
  const r0 = f ? Math.max(0, Math.min(fullH - 1, Number(f.row) || 0)) : 0;
  const c0 = f ? Math.max(0, Math.min(fullW - 1, Number(f.col) || 0)) : 0;
  const height = f ? Math.max(1, Math.min(fullH - r0, Number(f.h) || 1)) : fullH;
  const width = f ? Math.max(1, Math.min(fullW - c0, Number(f.w) || 1)) : fullW;
  const tiles = stage.tiles && typeof stage.tiles === 'object' ? stage.tiles : {};
  const walkable = (ch) => {
    const t = tiles[ch];
    if (!t) return false;
    return t.groundPassable === true || String(t.passable || '').includes('WALK');
  };
  const floor = [];
  const kinds = [];
  for (let r = 0; r < height; r++) {
    const line = String(rows[r0 + r]);
    const row = [];
    const krow = [];
    for (let c = 0; c < width; c++) {
      const ch = line[c0 + c];
      const ok = walkable(ch);
      row.push(ok);
      krow.push(ok ? TERRAIN.GROUND : terrainKind(tiles[ch]));
    }
    floor.push(row);           // floor[0] = rows[r0] = 引擎最下行
    kinds.push(krow);
  }
  const marks = [];
  const dep = stage.deployTiles && stage.deployTiles.normal ? stage.deployTiles.normal : null;
  if (dep) {
    // frame 外的部署格不要；frame 内的平移到裁剪坐标系
    const inside = (r, c) => r >= r0 && r < r0 + height && c >= c0 && c < c0 + width;
    for (const [r, c] of (Array.isArray(dep.melee) ? dep.melee : [])) if (inside(r, c)) marks.push({ r: r - r0, c: c - c0, kind: 'melee' });
    for (const [r, c] of (Array.isArray(dep.rangedOnly) ? dep.rangedOnly : [])) if (inside(r, c)) marks.push({ r: r - r0, c: c - c0, kind: 'ranged' });
  }
  return { width, height, floor, kinds, marks };
}

