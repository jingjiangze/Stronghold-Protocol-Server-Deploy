// tools/rogue-stages.mjs — 把官方集成战略（ISW/肉鸽）的关卡 JSON 转成本作的 stage / wave 记录
// （业主 2026-11-02「能不能提取肉鸽地图进去」→ 2026-11-03 审计确认可做，这里做转换层）。
//
// 输入：官方 `levels/obt/roguelike/ro<N>/level_rogue*.json`（与本作 autochess level 同一 schema：
//       `mapData.map` 是 H×W 的 tile id 网格、`mapData.tiles` 是 id→tile 定义、`routes` / `waves` / `options`）。
// 输出：`data/stages.json` / `data/waves.json` 里同形状的记录。
//
// **嵌入 19×21 画框**（关键取舍）：本作棋盘窗口固定（部署区 rows 9–12 / cols 2–10，见 server/match/board.js），
// 而官方肉鸽图是 5×12 / 7×9 这类尺寸。直接改棋盘几何会牵动放置 / 相机 / 渲染三层，所以这里把官方地图
// **原样（不缩放）**放进 19×21 画框、居中于棋盘窗口，画框其余部分填 '#' 禁区：
//   · 官方地形、路线、部署格语义全部保留；
//   · glyph 用本作渲染器同一张 `TILEKEY_GLYPH` 表 ⇒ 材质仍走官方图集（road/floor/wall/start/end/telin/telout/deepsea）；
//   · 部署格只算窗口内的（与 buildDeployMap 同一条规则，test/match/board.test.js 会逐图比对）。

import { TILEKEY_GLYPH } from '../public/js/render/style.js';

export const FRAME = Object.freeze({ rows: 19, cols: 21, r0: 9, r1: 12, c0: 2, c1: 10 });

/** 官方 tile 的部署类别（与 buildDeployMap 的判据一致）：'melee' / 'rangedOnly' / null。 */
export function deployKindOf(t) {
  if (!t) return null;
  const b = String(t.buildableType || 'NONE').toUpperCase();
  if (b === 'NONE') return null;
  const high = t.heightType === 'HIGHLAND';
  if (!high && (b === 'ALL' || b === 'MELEE')) return 'melee';
  if (high && (b === 'ALL' || b === 'RANGED')) return 'rangedOnly';
  if (!high && b === 'RANGED') return 'rangedOnly';
  return null;
}

/** 官方 tileKey → 本作 glyph（与渲染器同一张表）；表里没有的按高度兜底。 */
export function glyphOfTile(t) {
  const k = t && t.tileKey;
  const g = k ? TILEKEY_GLYPH[k] : null;
  if (g) return g;
  return t && t.heightType === 'HIGHLAND' ? '#' : 'r';
}

/** 画框里的空位（官方地图之外）：'#' 禁区，和 autochess 的空白一致。 */
export const FRAME_GLYPH = '#';

/** 官方图在画框里的偏移（stage 与路线换算共用，必须一致）。 */
export function frameOf(lv) {
  const map = lv && lv.mapData && Array.isArray(lv.mapData.map) ? lv.mapData.map : [];
  const H = map.length;
  const W = H ? Math.max(...map.map((row) => (Array.isArray(row) ? row.length : 0))) : 0;
  // 行：尽量让整张图落在**相机可见的行带 6–13** 内（渲染器 bandFor 的 prep/normal 取景），
  // 装不下（H>8）时贴到 6，底下的行就在取景外（不可见也不可部署，仍是合法数据）。
  const rowMin = 6, rowMaxVisible = Math.min(13, FRAME.rows - 1) - H + 1;
  const rowWant = Math.round(10.5 - H / 2);
  const row = H <= 8 ? Math.max(rowMin, Math.min(rowMaxVisible, rowWant)) : rowMin;
  return {
    row: Math.max(0, Math.min(FRAME.rows - H, row)),
    col: Math.max(0, Math.min(FRAME.cols - W, Math.round(6 - W / 2))),
  };
}

/**
 * 一份官方肉鸽关卡 → stage 记录（嵌进 19×21 画框）。
 * @param {any} lv 官方 level JSON
 * @param {{ id?: string, name?: string, modes?: string[], active?: boolean }} [meta]
 */
export function convertRogueLevel(lv, meta = {}) {
  const map = lv && lv.mapData && Array.isArray(lv.mapData.map) ? lv.mapData.map : null;
  const tilesById = lv && lv.mapData && lv.mapData.tiles && typeof lv.mapData.tiles === 'object' ? lv.mapData.tiles : {};
  if (!map || !map.length) throw new Error('rogue level without mapData.map');
  const H = map.length;
  const W = Math.max(...map.map((row) => (Array.isArray(row) ? row.length : 0)));
  if (!W) throw new Error('rogue level with empty map rows');
  const tileAt = (r, c) => tilesById[map[H - 1 - r] ? map[H - 1 - r][c] : undefined];

  const { row: rowOff, col: colOff } = frameOf(lv);
  const rows = [];
  const tiles = {
    [FRAME_GLYPH]: { tileKey: 'tile_forbidden', height: 'HIGH', buildable: 'NONE', passable: 'FLY_ONLY', groundPassable: false, flyPassable: true },
  };
  // tileKey → glyph（一个字符只代表一种 tileKey；冲突时另起字符，渲染器会按 legend 的 tileKey 回退到正确材质）
  const glyphByKey = new Map();
  const alphabet = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const glyphFor = (t) => {
    // ⚠ 官方同一个 tileKey 在不同格子可能是不同地形（tile_smog 既有 LOW/MELEE 也有 HIGHLAND/RANGED），
    // 所以字符身份按**语义**分：tileKey + 高度 + 可建造 + 通行。
    const key = `${t.tileKey}|${t.heightType}|${t.buildableType}|${t.passableMask}`;
    if (glyphByKey.has(key)) return glyphByKey.get(key);
    const base = glyphOfTile(t);
    const taken = new Set(glyphByKey.values());
    let g = !taken.has(base) ? base : null;
    if (!g) for (const ch of alphabet) if (!taken.has(ch) && ch !== FRAME_GLYPH && ch !== 'X') { g = ch; break; }
    if (!g) g = FRAME_GLYPH;
    glyphByKey.set(key, g);
    return g;
  };
  const melee = [];
  const rangedOnly = [];
  for (let r = 0; r < FRAME.rows; r++) {
    let line = '';
    for (let c = 0; c < FRAME.cols; c++) {
      const or = r - rowOff, oc = c - colOff;
      const inMap = or >= 0 && or < H && oc >= 0 && oc < W;
      const t = inMap ? tileAt(or, oc) : null;
      const g = t ? glyphFor(t) : FRAME_GLYPH;
      line += g;
      if (t && !tiles[g]) {
        tiles[g] = {
          tileKey: t.tileKey,
          height: t.heightType === 'HIGHLAND' ? 'HIGH' : 'LOW',
          buildable: String(t.buildableType || 'NONE').toUpperCase(),
          passable: t.passableMask,
          groundPassable: t.passableMask === 'ALL',
          flyPassable: t.passableMask !== 'NONE',
        };
      }
      if (t && r >= FRAME.r0 && r <= FRAME.r1 && c >= FRAME.c0 && c <= FRAME.c1) {
        const kind = deployKindOf(t);
        if (kind === 'melee') melee.push([r, c]);
        else if (kind === 'rangedOnly') rangedOnly.push([r, c]);
      }
    }
    rows.push(line);
  }

  const o = lv.options || {};
  return {
    id: meta.id || lv.levelId || `rogue_${lv.mapId || 'x'}`,
    name: meta.name || lv.levelId || '肉鸽战场',
    weight: 0,
    active: meta.active === true,
    modes: Array.isArray(meta.modes) ? meta.modes : [],
    size: [FRAME.rows, FRAME.cols],
    rows,
    tiles,
    devices: [],
    mapChars: [],
    special: {},
    runes: [],
    globalBuffs: [],
    deployTiles: {
      normal: { melee, rangedOnly, changedByDevices: [] },
      bossLeft: { melee: [], rangedOnly: [], changedByDevices: [] },
      bossRight: { melee: [], rangedOnly: [], changedByDevices: [] },
    },
    groundPaths: {},
    groundPathsWithDevices: {},
    options: { characterLimit: o.characterLimit ?? 6, moveMultiplier: o.moveMultiplier ?? 0.5 },
    config: {},
    // 官方地图在画框里的偏移（路线换算也用它）
    rogueFrame: { row: rowOff, col: colOff, h: H, w: W },
  };
}

/**
 * 在画框里用 BFS 算「可走路线」（2026-11-03）：官方 `routes` 会穿过地面不可走的格子（实测 tile_forbidden），
 * 与本作的寻路前置校验冲突，所以肉鸽地图的出怪路线按**本作画框自己算**：
 *   入口 = 地图 bbox 四边上可走的格子（优先 `tile_start` / `tile_telout`），终点 = `tile_end`，没有就用地图中心最近的可走格。
 * 最多 4 条；条数不够时复用同一条（上游会按 routeIndex % 条数取）。
 */
export function routesInFrame(stage) {
  const rows = stage && Array.isArray(stage.rows) ? stage.rows : [];
  const tiles = stage && stage.tiles ? stage.tiles : {};
  const frame = stage && stage.rogueFrame ? stage.rogueFrame : null;
  if (!rows.length || !frame) return [];
  const walk = (r, c) => {
    const line = rows[r];
    if (typeof line !== 'string' || c < 0 || c >= line.length) return false;
    const t = tiles[line[c]];
    return !!(t && t.groundPassable);
  };
  const { row: r0, col: c0, h, w } = frame;
  const r1 = r0 + h - 1, c1 = c0 + w - 1;
  const ends = [];
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
    const t = tiles[rows[r] && rows[r][c]];
    if (t && t.tileKey === 'tile_end') ends.push([r, c]);
  }
  const entries = [];
  const consider = (r, c) => {
    if (r < r0 || r > r1 || c < c0 || c > c1) return;
    if (!walk(r, c)) return;
    const t = tiles[rows[r][c]];
    const rank = t && (t.tileKey === 'tile_start' || t.tileKey === 'tile_telout') ? 0 : 1;
    entries.push({ r, c, rank });
  };
  for (let c = c0; c <= c1; c++) { consider(r0, c); consider(r1, c); }
  for (let r = r0 + 1; r < r1; r++) { consider(r, c0); consider(r, c1); }
  entries.sort((a, b) => a.rank - b.rank || a.r - b.r || a.c - b.c);
  if (!entries.length) return [];
  const goal = ends[0] || (() => {
    // 没有 tile_end：取地图几何中心最近的可走格
    const cr = Math.round((r0 + r1) / 2), cc = Math.round((c0 + c1) / 2);
    let best = null;
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
      if (!walk(r, c)) continue;
      const d = Math.abs(r - cr) + Math.abs(c - cc);
      if (!best || d < best.d) best = { r, c, d };
    }
    return best ? [best.r, best.c] : null;
  })();
  if (!goal) return [];

  const bfs = (start) => {
    const key = (r, c) => r * 1000 + c;
    const prev = new Map();
    const q = [start];
    prev.set(key(start[0], start[1]), null);
    while (q.length) {
      const [r, c] = q.shift();
      if (r === goal[0] && c === goal[1]) break;
      for (const [dr, dc] of [[0, 1], [1, 0], [0, -1], [-1, 0]]) {
        const nr = r + dr, nc = c + dc;
        if (nr < r0 || nr > r1 || nc < c0 || nc > c1) continue;
        if (!walk(nr, nc) && !(nr === goal[0] && nc === goal[1])) continue;
        const k = key(nr, nc);
        if (prev.has(k)) continue;
        prev.set(k, [r, c]);
        q.push([nr, nc]);
      }
    }
    if (!prev.has(key(goal[0], goal[1]))) return null;
    const path = [];
    let cur = [goal[0], goal[1]];
    while (cur) { path.push(cur); cur = prev.get(key(cur[0], cur[1])); }
    return path.reverse();
  };

  const routes = [];
  for (const e of entries) {
    if (routes.length >= 4) break;
    const path = bfs([e.r, e.c]);
    if (!path || path.length < 2) continue;
    routes.push({ motion: 'WALK', start: path[0], end: path[path.length - 1], checkpoints: path.slice(1, -1) });
  }
  return routes;
}

/**
 * 一张图里敌人从哪出发、往哪走（坐标换算到画框）。
 * 官方 `routes[].startPosition = { row, col }`：**row 从下往上数**（与 `mapData.map` 的 0=最上行相反）——
 * 实测按 `map[H-1-row][col]` 取到的正是 `tile_start` / `tile_road` / `tile_end`。所以这里直接用 row/col，
 * 再叠加画框偏移。与 `tools/build-data.mjs` 的 resolveRoute 同口径。
 */
export function routesOf(lv) {
  const frame = frameOf(lv);
  const pos = (q) => (q && Number.isFinite(Number(q.row)) && Number.isFinite(Number(q.col))
    ? [Number(q.row) + frame.row, Number(q.col) + frame.col] : null);
  const out = [];
  for (const r of (lv && Array.isArray(lv.routes) ? lv.routes : [])) {
    const start = pos(r && r.startPosition);
    const end = pos(r && r.endPosition);
    if (!start || !end) continue;
    if (r.startPosition.row === r.endPosition.row && r.startPosition.col === r.endPosition.col) continue;   // 官方占位空路由
    out.push({
      motion: r.motionMode || 'WALK',
      start,
      end,
      checkpoints: (Array.isArray(r.checkpoints) ? r.checkpoints : []).map((c) => pos(c && c.position)).filter(Boolean),
      ...(r.allowDiagonalMove === false ? { allowDiagonal: false } : {}),
    });
  }
  return out;
}

/**
 * 官方肉鸽关卡的出怪 → 本作 wave 模板（`data/waves.json` 里同一种记录）。
 * 官方层级 `waves[] → fragments[] → actions[]`，时间都是相对延迟；按 `tools/build-data.mjs` 的 `expandActions`
 * 同一套规则摊平成绝对时间（多 fragment 取「上一段最后一波之后」）。
 */
/** 肉鸽 wave 模板 id：`rogue_<关卡码>`（stageId 已带 `rogue_` 前缀时不会重复叠加）。 */
export function waveIdFor(stageId) {
  return `rogue_${String(stageId || '').replace(/^rogue_/, '')}`;
}

export function wavesOf(lv, stageId, routes = null) {
  const groups = [];
  for (const w of (lv && Array.isArray(lv.waves) ? lv.waves : [])) {
    const wPre = Number(w && w.preDelay) || 0;
    (w && Array.isArray(w.fragments) ? w.fragments : []).forEach((f, fi) => {
      // 与 build-rogue-maps-v2 一致：w.preDelay 只加到第一个 fragment，后续 fragment 只算自己的 preDelay。
      groups.push({ preDelay: (fi === 0 ? wPre : 0) + (Number(f && f.preDelay) || 0), actions: (f && Array.isArray(f.actions) ? f.actions : []) });
    });
  }
  const spawns = [];
  let cursor = 0;
  for (const g of groups) {
    const start = cursor + (g.preDelay || 0);
    let end = start;
    for (const a of g.actions || []) {
      if (!a || typeof a.key !== 'string' || !a.key) continue;
      const time = Math.max(0, start + (Number(a.preDelay) || 0));
      const count = Math.max(1, Math.min(50, Number.isInteger(a.count) ? a.count : 1));
      const interval = Math.max(0, Number(a.interval) || 0);
      const e = { time, key: a.key, count, interval, routeIndex: Number.isInteger(a.routeIndex) ? a.routeIndex : 0 };
      const isSpawn = a.actionType === 'SPAWN';
      if (!isSpawn) e.action = a.actionType;
      if (a.isUnharmfulAndAlwaysCountAsKilled || a.randomSpawnGroupKey) e.tag = 'part';
      if (a.randomSpawnGroupKey) { e.group = a.randomSpawnGroupKey; e.pack = a.randomSpawnGroupPackKey; e.weight = a.weight; }
      spawns.push(e);
      // 游标只由真正写出的 SPAWN 推进（2026-11-05 修，同 build-rogue-maps-v2）：非 SPAWN 行虽保留在 spawns 里，
      // 但不占时间轴，否则会把后面的 SPAWN 推到回合时限之外。
      if (isSpawn) end = Math.max(end, time + Math.max(0, count - 1) * interval);
    }
    cursor = end;
  }
  const o = (lv && lv.options) || {};
  const perSecRaw = Number(o.costIncreaseTime);
  return {
    id: waveIdFor(stageId),
    kind: 'normal',
    solo: false,
    bossId: null,
    // 官方 -1 = 不限时；本作普通回合要求正数时长（data.test.js 校验），<=0 回落到 45 秒
    maxPlayTime: Number(o.maxPlayTime) > 0 ? Number(o.maxPlayTime) : 45,
    dp: { init: Number(o.initialCost) || 10, perSec: perSecRaw > 0 ? 1 / perSecRaw : 1, max: Number(o.maxCost) || 99 },
    characterLimit: Number(o.characterLimit) || 6,
    moveMultiplier: Number.isFinite(Number(o.moveMultiplier)) ? Number(o.moveMultiplier) : 0.5,
    bgm: lv.bgmEvent || null,
    routes: Array.isArray(routes) && routes.length ? routes : routesOf(lv),
    extraRoutes: [],
    spawns,
    branches: {},   // 校验要求对象（shared/plugins/validate.js:257）
    overrides: {},
    devices: [],
    usedBy: [],          // 肉鸽模板按 stageId 直接取，不进「模式/回合」使用表
    totalCount: spawns.filter((s) => !s.action || String(s.action).toUpperCase() === 'SPAWN').reduce((n, s) => n + (Number(s.count) || 1), 0),
  };
}

export default { convertRogueLevel, deployKindOf, glyphOfTile, routesOf, wavesOf, frameOf, FRAME };
