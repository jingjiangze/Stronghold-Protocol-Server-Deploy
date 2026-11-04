// tools/build-rogue-maps-v2.mjs — 官方肉鸽（ISW ro4）关卡 → data/stages.json / data/waves.json 的**真实**转换
// （2026-11-03；旧版 tools/build-rogue-maps.mjs 只借地图与路线、出怪用本作 autochess 模板，本文件替换那套产物）。
//
// 与旧版的区别（本文件实现的是审计规格，不另起一套）：
//   · 地图：mapData.map + tiles → 19×21 rows（rows[0] 最下行）；同一 tileKey 在不同 height/buildable/passable
//     下用复合键另起字形；deployTiles 扫**整张画框**（rogueFrame 的 row/col/h/w，clamp 到 19×21）；H>19 或 W>21 的图**显式 skip**。
//   · 路线：在**整张画框**内用**引擎同款** Grid.findPath（server/sim/grid.js，rect = rogueFrame 边界，不是
//     GEO.NORMAL_RECT）算；官方 routeIndex → 新 routeIndex 建**映射表**（不是 % 复用）。自己算不出路径时用官方
//     非零 route 的 start/end 作种子强制 BFS（先吸附到最近可走格），仍不行才复用最近的可达路线；一条都不通时
//     合成一条画框内路线。
//   · Boss 节点（2026-11-03 审计）：`code` 以 `b-` 开头的变体图按普通战斗打（官方图在 Boss 半场没有部署格），
//     但追加 1 条 `tag:'boss'` 的 spawn：key 按 code 稳定散列从 4 个已验 BOSS 里选，routeIndex 取第一条可走
//     WALK 路线（没有则 0），time 0 / count 1 / interval 0。
//   · 出怪：waves[].fragments[].actions[] 只取 SPAWN；时间摊平成绝对秒；count/interval/routeIndex（映射后）；
//     保留 hiddenGroup→hidden、randomSpawnGroupKey→group、weight、unharmful；BOSS 打 tag。
//     未知 enemy key 一律不写进 spawns：先试本文件 enemyDbRefs 的 overwrittenData.prefabKey 映射，再不行记 unmapped。
//   · 装置：predefines.tokenInsts → stage.devices（不在 waves 里重复）。
//
// 用法：
//   node tools/build-rogue-maps-v2.mjs --levels <dir> [--prefix ro4] [--report <report.json>] [--dry] [--verify]
//   --levels  官方 `level_rogue<N>_<code>.json` 所在目录
//   --prefix  只处理 `<prefix>`（默认 ro4）；文件名决定 id：level_rogue4_1-1.json → rogue_ro4_1-1
//   --report  报告路径（默认 ../rogue-rebuild-2026-11-03/report.json，相对本仓库根）
//   --dry     只算不写（报告仍然可写）
//   --verify  写完后跑只读校验（结构 / 寻路 / 出怪计数 / 引擎归一化链），结果并入报告
//
// 已知降级（有证据，不臆造数据）：
//   · OCCLUSION（2026-11-03 起不再降级）：模拟场地 rect 改为**该图画框**（rogueFrame 边界），官方 route 端点/checkpoints
//     落在画框内即可原样保留；此前用 GEO.NORMAL_RECT（rows 9–12）导致大量端点被吸附、传送 steps 失效。
//     逐图数字见报告 maps[].routes（officialTeleports / teleports / stepsDropped / forcedSnapped / reusedNearest）。
//   · H>19 或 W>21 的图（b-7 8×25、b-8 9×36）显式 skip，报告 skipped 里带原因。
//   · 本作 enemies.json 缺官方大量敌方 key：未知 key 先按 overwrittenData.prefabKey 映射，仍未知则不写出怪（记 unmapped）。
//
// 写边界：只写 data/stages.json、data/waves.json（rogue_* 记录）与报告；其它 data 文件与代码一律不动。
// 旧记录按前缀删除后重建（幂等）；非 rogue_* 记录原样保留。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Grid, DEPLOY_REFUSED_TILES } from '../server/sim/grid.js';
import { normalizeRoute, normalizeStage, spawnsFromTemplate } from '../server/sim/simdata.js';
import { compileRoute } from '../server/sim/ai.js';
import { GEO } from '../shared/constants.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** 本作棋盘几何真源（shared/constants.js GEO），不再各自写死一份。 */
const FRAME = Object.freeze({ rows: GEO.ROWS, cols: GEO.COLS, r0: GEO.FIELD.r0, r1: GEO.FIELD.r1, c0: GEO.FIELD.c0, c1: GEO.FIELD.c1 });
/** 模拟场地的矩形：normal 战斗用它做寻路边界（Battle 的 DEFAULT_RECTS.normal）。 */
const SIM_RECT = Object.freeze({ ...GEO.NORMAL_RECT });
/** 官方 maxPlayTime = -1（不限时）时本作普通回合的兜底时长：肉鸽模式 round 1–2 的 combatTimeLimit 即 45（data/config.json）。 */
const DEFAULT_PLAY_TIME = 45;
/**
 * 肉鸽 Boss 节点可用的敌将：4 个都在 data/enemies.json（rank BOSS）且 kit 已验（2026-11-03 审计）。
 * 官方 b-* 变体图在 Boss 半场（rows 0–5）没有部署格，故按普通战斗打、由转换器补一条 boss spawn。
 */
const ROGUE_BOSS_KEYS = Object.freeze(['enemy_1515_bsnake', 'enemy_1506_patrt', 'enemy_1520_empgrd', 'enemy_2126_dycyue']);

// ===== 小工具 ===================================================================================

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const numOr = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const cleanNum = (v) => {
  if (typeof v !== 'number' || !Number.isFinite(v)) return v;
  if (Number.isInteger(v) || Math.abs(v) >= 1e6) return v;
  return Math.round(v * 1e6) / 1e6;
};
/** 官方 `{m_defined, m_value}` 包装取真值；未定义返回 undefined（= 该字段没被覆盖）。 */
const defined = (v) => (v && typeof v === 'object' && 'm_defined' in v ? (v.m_defined ? v.m_value : undefined) : v);

/**
 * 官方 overwrittenData → 已定义字段的扁平表（与 tools/build-data.mjs 的 definedFields 同口径）。
 * 只认 m_defined=true 的字段；`attributes` 递归展开。
 */
export function definedFields(over) {
  const out = {};
  if (!over) return out;
  for (const [k, v] of Object.entries(over)) {
    if (v && typeof v === 'object' && 'm_defined' in v) {
      if (v.m_defined) out[k] = v.m_value;
    } else if (k === 'attributes' && v) {
      Object.assign(out, definedFields(v));
    } else if ((k === 'talentBlackboard' || k === 'skills') && v != null) {
      out[k] = v;
    }
  }
  return out;
}

/** 官方 blackboard 列表 → { bb, bbStr }（与 server/plugins/officialUnitBuilder.js 的 flattenBB 同语义）。 */
export function flattenBB(list) {
  const bb = {};
  const bbStr = {};
  for (const e of Array.isArray(list) ? list : []) {
    if (!e || typeof e.key !== 'string') continue;
    let k = e.key;
    const taken = (x) => Object.hasOwn(bb, x) || Object.hasOwn(bbStr, x);
    if (taken(k)) {
      let i = 1;
      while (taken(`${e.key}_${i}`)) i++; // loop-cap: 最多 list.length 个同名键
      k = `${e.key}_${i}`;
    }
    const n = cleanNum(typeof e.value === 'number' ? e.value : Number(e.value) || 0);
    const hasStr = e.valueStr != null && e.valueStr !== '';
    if (!hasStr || n !== 0) bb[k] = n;
    if (hasStr) bbStr[k] = String(e.valueStr);
  }
  return { bb, bbStr };
}

// enemy_database 属性 → enemies.json 统计字段（与 build-data.mjs ENEMY_STAT_FIELDS 同一张表）。
const ENEMY_STAT_FIELDS = {
  maxHp: 'maxHp', atk: 'atk', def: 'def', magicResistance: 'res', moveSpeed: 'moveSpeed',
  baseAttackTime: 'bat', attackSpeed: 'aspd', blockCnt: 'blockCnt', massLevel: 'massLevel',
  hpRecoveryPerSec: 'hpRecoveryPerSec', tauntLevel: 'tauntLevel', epDamageResistance: 'elementDmgRes',
  epResistance: 'elementRes', damageHitratePhysical: 'hitRatePhys', damageHitrateMagical: 'hitRateArts',
  rangeRadius: 'rangeRadius', lifePointReduce: 'lpr',
};

/** 近战只打阻挡者：rangeRadius 归 0，官方值留在 rawRangeRadius（同 build-data.effectiveRangeRadius）。 */
const effectiveRangeRadius = (applyWay, raw) => (applyWay === 'MELEE' || typeof raw !== 'number' || !Number.isFinite(raw) ? 0 : Math.max(0, raw));

/** 官方 override → waves.overrides 记录（白名单同 build-data.enemyOverrideRecord）。 */
export function enemyOverrideRecord(over) {
  const stats = {};
  const extra = {};
  for (const [k, v] of Object.entries(over)) {
    if (ENEMY_STAT_FIELDS[k]) stats[ENEMY_STAT_FIELDS[k]] = cleanNum(v);
    else if (k === 'talentBlackboard') extra.talents = flattenBB(v);
    else if (k === 'skills') extra.skills = (Array.isArray(v) ? v : []).map((sk) => {
      const { bb, bbStr } = flattenBB(sk.blackboard);
      return { prefabKey: sk.prefabKey, priority: sk.priority, cooldown: sk.cooldown, initCooldown: sk.initCooldown, spCost: sk.spCost, bb, bbStr };
    });
    else if (k === 'motion' || k === 'applyWay' || k === 'levelType' || k === 'notCountInTotal' || k === 'name') extra[k] = v;
    else if (/Immune$/.test(k)) (extra.immunities ||= {})[k.replace(/Immune$/, '')] = !!v;
  }
  return { ...(Object.keys(stats).length ? { stats } : {}), ...extra };
}

// ===== 地形 / 图例 ===============================================================================

/** 字形偏好（与 tools/build-data.mjs 的 TILE_LEGEND 同一套字母；渲染器 GLYPH 表之外的字符按 legend.tileKey 回退）。 */
const PREFERRED_GLYPH = {
  tile_forbidden: '#', tile_road: 'r', tile_floor: 'f', tile_wall: 'h', tile_fence_bound: 'b', tile_fence: 'b',
  tile_achand: 'a', tile_start: 'S', tile_end: 'E', tile_telin: 'I', tile_telout: 'O', tile_mire: 'm',
  tile_smog: 'g', tile_deepsea: 'd', tile_infection: 'i', tile_hole: 'o',
};
const GLYPH_ALPHABET = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
/** 画框空隙：'#' 禁区（与 autochess 空白一致）。 */
const FRAME_GLYPH = '#';

/** 官方图在画框里的偏移：把图的行带居中到模拟场地 rows 9–12，列带居中到 cols 2–10。 */
export function frameOf(h, w) {
  return {
    row: clamp(Math.round((FRAME.r0 + FRAME.r1) / 2 + 0.5 - h / 2), 0, FRAME.rows - h),
    col: clamp(Math.round(6 - w / 2), 0, FRAME.cols - w),
    h,
    w,
  };
}

/**
 * `rogueFrame`（{row, col, h, w}）→ 模拟场地的完整矩形 `{r0, r1, c0, c1}`（含端点），clamp 到 19×21。
 * 这是肉鸽图**唯一**的寻路 / 部署 / 编译边界：官方图高 5–9 行、宽 8–18 列，用 GEO.NORMAL_RECT 会切掉半张图。
 */
export function frameRectOf(frame) {
  const h = Math.max(1, Math.trunc(Number(frame && frame.h)) || 1);
  const w = Math.max(1, Math.trunc(Number(frame && frame.w)) || 1);
  const r0 = clamp(Math.trunc(Number(frame && frame.row)) || 0, 0, FRAME.rows - 1);
  const c0 = clamp(Math.trunc(Number(frame && frame.col)) || 0, 0, FRAME.cols - 1);
  return {
    r0,
    r1: clamp(r0 + h - 1, r0, FRAME.rows - 1),
    c0,
    c1: clamp(c0 + w - 1, c0, FRAME.cols - 1),
  };
}

/** stage 的模拟场地矩形：肉鸽图用 rogueFrame，其它（无画框）回落 GEO.NORMAL_RECT。 */
export function rectOfStage(stage) {
  const frame = stage && stage.rogueFrame;
  return frame ? frameRectOf(frame) : { ...SIM_RECT };
}

/** 官方 tile → 本作 legend 记录（buildable 用**有效值**：深水区拒绝部署）。 */
function legendEntryOf(t) {
  const buildable = DEPLOY_REFUSED_TILES.has(t.tileKey) ? 'NONE' : String(t.buildableType || 'NONE').toUpperCase();
  const passable = String(t.passableMask || 'NONE').toUpperCase();
  return {
    tileKey: t.tileKey,
    height: t.heightType === 'HIGHLAND' ? 'HIGH' : 'LOW',
    buildable,
    passable,
    groundPassable: passable === 'ALL',
    flyPassable: passable !== 'NONE',
  };
}

/** legend 记录 → 部署类别（与 server/match/board.js buildDeployMap 同一判据）。 */
function deployKindOf(e) {
  if (!e) return null;
  if (e.height === 'LOW' && (e.buildable === 'ALL' || e.buildable === 'MELEE')) return 'melee';
  if ((e.height === 'HIGH' && (e.buildable === 'ALL' || e.buildable === 'RANGED')) || (e.height === 'LOW' && e.buildable === 'RANGED')) return 'rangedOnly';
  return null;
}

// 已知机关的玩法角色（同 build-data.mjs DEVICE_ROLES；board.js 只用得到 obstacle / platform 几类）。
const DEVICE_ROLES = {
  trap_1105_accrate: 'crate', trap_1106_achplat: 'platform', trap_032_mound: 'mound', trap_013_blower: 'blower',
  trap_098_mire: 'mireController', trap_042_tidectrl: 'tideController', trap_1104_aclasert: 'turret',
  trap_1112_acblzd: 'coldWind', trap_036_storm: 'sandstorm', trap_040_canoe: 'waterPlatform',
  trap_1107_acblock: 'sealedFloor', trap_218_fttree: 'bush', trap_039_dstnta: 'bossSpawn',
};

/**
 * 官方关卡 → stage 记录（地图原样嵌进 19×21 画框，不缩放）。
 * @param {any} lv 官方 level JSON
 * @param {{ id: string, name?: string }} meta
 */
export function buildStage(lv, meta) {
  const map = lv && lv.mapData && Array.isArray(lv.mapData.map) ? lv.mapData.map : null;
  const tilesById = lv && lv.mapData && lv.mapData.tiles && typeof lv.mapData.tiles === 'object' ? lv.mapData.tiles : {};
  if (!map || !map.length) return { skip: 'no-mapData' };
  const h = map.length;
  const w = Math.max(...map.map((row) => (Array.isArray(row) ? row.length : 0)));
  if (!w) return { skip: 'empty-map' };
  if (h > FRAME.rows || w > FRAME.cols) return { skip: `map-too-large:${h}x${w}` };

  const frame = frameOf(h, w);
  const tileAt = (r, c) => tilesById[map[h - 1 - r] ? map[h - 1 - r][c] : undefined] || null;

  const tiles = { [FRAME_GLYPH]: { tileKey: 'tile_forbidden', height: 'HIGH', buildable: 'NONE', passable: 'FLY_ONLY', groundPassable: false, flyPassable: true } };
  // 字形身份 = tileKey + 高度 + 可建造 + 通行（官方同一 tileKey 在不同格语义可能不同），冲突时另起字母。
  const glyphByKey = new Map();
  const glyphFor = (t) => {
    const key = `${t.tileKey}|${t.heightType}|${t.buildableType}|${t.passableMask}`;
    if (glyphByKey.has(key)) return glyphByKey.get(key);
    const entry = legendEntryOf(t);
    const taken = new Set(glyphByKey.values());
    let g = PREFERRED_GLYPH[t.tileKey] || null;
    if (!g || taken.has(g) || g === 'X') g = null;
    if (!g) for (const ch of GLYPH_ALPHABET) if (!taken.has(ch) && ch !== 'X') { g = ch; break; }
    if (!g) g = FRAME_GLYPH;
    glyphByKey.set(key, g);
    if (!tiles[g]) tiles[g] = entry;
    return g;
  };

  const rows = [];
  const melee = [];
  const rangedOnly = [];
  const glyphCounts = {};
  // 部署格扫整张官方画框（不是 GEO.FIELD rows 9–12 × cols 2–10）：肉鸽图的棋盘就是官方图本身。
  const rect = frameRectOf(frame);
  for (let r = 0; r < FRAME.rows; r++) {
    let line = '';
    for (let c = 0; c < FRAME.cols; c++) {
      const or = r - frame.row;
      const oc = c - frame.col;
      const t = or >= 0 && or < h && oc >= 0 && oc < w ? tileAt(or, oc) : null;
      const g = t ? glyphFor(t) : FRAME_GLYPH;
      line += g;
      glyphCounts[g] = (glyphCounts[g] || 0) + 1;
      if (t && r >= rect.r0 && r <= rect.r1 && c >= rect.c0 && c <= rect.c1) {
        const kind = deployKindOf(tiles[g]);
        if (kind === 'melee') melee.push([r, c]);
        else if (kind === 'rangedOnly') rangedOnly.push([r, c]);
      }
    }
    rows.push(line);
  }

  const o = lv.options || {};
  const devices = [];
  for (const t of (lv.predefines && Array.isArray(lv.predefines.tokenInsts) ? lv.predefines.tokenInsts : [])) {
    const key = t && t.inst && t.inst.characterKey;
    const p = t && t.position;
    if (!key || !p || !Number.isFinite(Number(p.row)) || !Number.isFinite(Number(p.col))) continue;
    const rec = { key, alias: t.alias || null, pos: [Number(p.row) + frame.row, Number(p.col) + frame.col], dir: t.direction || 'RIGHT', hidden: !!t.hidden };
    const role = DEVICE_ROLES[key];
    if (role) rec.role = role;
    rec.active = !rec.hidden;
    devices.push(rec);
  }

  const stage = {
    id: meta.id,
    name: meta.name || meta.id,
    weight: 1,
    active: true,
    modes: [],
    size: [FRAME.rows, FRAME.cols],
    rows,
    tiles,
    devices,
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
    options: {
      characterLimit: numOr(o.characterLimit, 6),
      moveMultiplier: numOr(o.moveMultiplier, 0.5),
      maxPlayTime: Number(o.maxPlayTime) > 0 ? Number(o.maxPlayTime) : DEFAULT_PLAY_TIME,
      initialCost: numOr(o.initialCost, 10),
      maxCost: numOr(o.maxCost, 99),
      costIncreaseTime: numOr(o.costIncreaseTime, 1),
    },
    config: {},
    rogueFrame: { row: frame.row, col: frame.col, h, w },
  };
  return { stage, glyphCounts, deploy: { melee: melee.length, rangedOnly: rangedOnly.length } };
}

// ===== 路线 =====================================================================================

function motionOf(r) {
  const m = String((r && r.motionMode) || 'WALK').toUpperCase();
  return m === 'FLY' ? 'FLY' : 'WALK';
}

/** 在 rect 内从 [r,c] 出发找最近的可走格（螺旋扩圈；找不到返回 null）。 */
function snapWalkable(grid, [r, c]) {
  const R = grid.rect;
  const inside = (rr, cc) => rr >= R.r0 && rr <= R.r1 && cc >= R.c0 && cc <= R.c1 && grid.walkable(rr, cc);
  if (inside(r, c)) return [r, c];
  for (let d = 1; d <= 6; d++) {
    for (let dr = -d; dr <= d; dr++) {
      for (let dc = -d; dc <= d; dc++) {
        if (Math.abs(dr) !== d && Math.abs(dc) !== d) continue;
        const rr = r + dr;
        const cc = c + dc;
        if (inside(rr, cc)) return [rr, cc];
      }
    }
  }
  return null;
}

/**
 * steps 的每一腿是否都走得通（引擎 planLeg 对不可达目标只会让敌人停在原地等重算）。
 * MOVE/PATROL 从当前点走到目标点；APPEAR 直接把当前位置挪过去；DISAPPEAR 之后当前位置未知（等 APPEAR）。
 */
function stepsConnected(grid, start, end, steps) {
  let cur = start;
  const leg = (a, b) => !!grid.findPath(a[0], a[1], b[0], b[1]);
  for (const st of steps) {
    if (st.t === 'disappear') { cur = null; continue; }
    if (st.t === 'appear') { cur = st.p; continue; }
    if ((st.t === 'move' || st.t === 'patrol') && st.p) {
      if (cur && !leg(cur, st.p)) return false;
      cur = st.p;
    }
  }
  return !cur || leg(cur, end);
}

/**
 * 官方 route 的 checkpoints → 本作 `steps`。
 * 位置落在 rect 内且可走才保留（compileRoute 会把越界坐标夹进 rect，保留越界点等于把敌人卡在不可达腿）；
 * WAIT_CURRENT_* 只记等待时长，不造伪坐标；DISAPPEAR 与随后的 APPEAR_AT_POS 成对保留，落单则一起丢。
 */
function stepsOf(r, frame, grid) {
  const stats = { kept: 0, dropped: 0, waits: 0, teleports: 0, unpaired: 0 };
  const raw = Array.isArray(r && r.checkpoints) ? r.checkpoints : [];
  const okPos = (p) => {
    if (!p || !Number.isFinite(Number(p.row)) || !Number.isFinite(Number(p.col))) return null;
    const pos = [Number(p.row) + frame.row, Number(p.col) + frame.col];
    return grid.walkable(pos[0], pos[1]) ? pos : null;
  };
  const out = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i] || {};
    switch (c.type) {
      case 'MOVE':
      case 'PATROL_MOVE': {
        const p = okPos(c.position);
        if (p) { out.push({ t: c.type === 'PATROL_MOVE' ? 'patrol' : 'move', p }); stats.kept += 1; }
        else stats.dropped += 1;
        break;
      }
      case 'WAIT_FOR_SECONDS':
        out.push({ t: 'wait', s: cleanNum(numOr(c.time, 0)) });
        stats.waits += 1;
        stats.kept += 1;
        break;
      case 'WAIT_CURRENT_WAVE_TIME':
      case 'WAIT_CURRENT_FRAGMENT_TIME':
        // 等待「当前 wave/fragment 的剩余时间」：只保留时长，不写 position（官方这里永远是 0,0 占位）。
        out.push({ t: 'wait', s: cleanNum(numOr(c.time, 0)) });
        stats.waits += 1;
        stats.kept += 1;
        break;
      case 'DISAPPEAR': {
        let j = i + 1;
        let appear = null;
        for (; j < raw.length; j++) {
          const t2 = raw[j] || {};
          if (t2.type === 'DISAPPEAR') break;
          if (t2.type === 'APPEAR_AT_POS') { appear = t2; break; }
          if (t2.type !== 'WAIT_FOR_SECONDS' && t2.type !== 'WAIT_CURRENT_WAVE_TIME' && t2.type !== 'WAIT_CURRENT_FRAGMENT_TIME') break;
        }
        const p = appear ? okPos(appear.position) : null;
        if (p) {
          out.push({ t: 'disappear' });
          if (appear.type === 'APPEAR_AT_POS' && numOr(appear.time, 0) > 0) out.push({ t: 'wait', s: cleanNum(numOr(appear.time, 0)) });
          out.push({ t: 'appear', p });
          stats.teleports += 1;
          stats.kept += 2;
          i = j;
        } else {
          stats.unpaired += 1;
          stats.dropped += 1;
        }
        break;
      }
      case 'APPEAR_AT_POS': {
        const p = okPos(c.position);
        if (p) { out.push({ t: 'appear', p }); stats.kept += 1; }
        else stats.dropped += 1;
        break;
      }
      default:
        stats.dropped += 1;
        break;
    }
  }
  return { steps: out, stats };
}

/**
 * 官方 routes/extraRoutes → 本作 route 列表 + **映射表**（official idx → new idx）。
 *
 * 取舍：路径用 Grid.findPath（引擎同款流场）算，因此每条发出的路线在模拟场地 rect 内**可达**；
 * 官方起点/终点不可走或走不通时，先吸附到最近可走格强制 BFS，仍不行才复用最近的官方可达路线；
 * 一条都不通时合成一条 rect 内的可达路线（记 synthetic），绝不放官方原始 routes 直通。
 */
export function planRoutes(officialRoutes, stage, grid) {
  const frame = stage.rogueFrame;
  const routes = [];
  const idxMap = (Array.isArray(officialRoutes) ? officialRoutes : []).map(() => -1);
  const byKey = new Map();
  const stats = {
    official: idxMap.length, zeroLength: 0, outOfMap: 0, seeds: 0, reached: 0, deduped: 0,
    forcedSnapped: 0, reusedNearest: 0, synthetic: 0, unmapped: 0,
    stepsKept: 0, stepsDropped: 0, stepsDroppedRoutes: 0, waits: 0, teleports: 0, unpairedTeleports: 0,
    officialTeleports: 0, officialWaits: 0, officialMoves: 0,
    noPlayableRoute: false,
  };
  const inMap = (p) => !!p && Number.isFinite(Number(p.row)) && Number.isFinite(Number(p.col)) && p.row >= 0 && p.row < frame.h && p.col >= 0 && p.col < frame.w;
  const toFrame = (p) => [Number(p.row) + frame.row, Number(p.col) + frame.col];
  const pathBetween = (start, end) => {
    if (start[0] === end[0] && start[1] === end[1]) return null;
    if (!grid.walkable(start[0], start[1]) || !grid.walkable(end[0], end[1])) return null;
    return grid.findPath(start[0], start[1], end[0], end[1]);
  };
  const addRoute = (start, end, motion, stepRec) => {
    const steps = stepRec && stepRec.steps.length ? stepRec.steps : null;
    // 去重键 = 起终点 + steps：同一对起终点但走法不同（传送 / 等待 / 途经点）的官方路线是两条，不能压成一条。
    const key = `${start[0]},${start[1]}|${end[0]},${end[1]}|${steps ? JSON.stringify(steps) : ''}`;
    if (byKey.has(key)) { stats.deduped += 1; return byKey.get(key); }
    const rec = { motion, start, end, checkpoints: [] };
    if (steps) rec.steps = steps;
    routes.push(rec);
    const idx = routes.length - 1;
    byKey.set(key, idx);
    if (stepRec) {
      stats.stepsKept += stepRec.stats.kept;
      stats.stepsDropped += stepRec.stats.dropped;
      stats.waits += stepRec.stats.waits;
      stats.teleports += stepRec.stats.teleports;
      stats.unpairedTeleports += stepRec.stats.unpaired;
    }
    return idx;
  };

  const pending = [];
  (officialRoutes || []).forEach((r, i) => {
    for (const c of Array.isArray(r && r.checkpoints) ? r.checkpoints : []) {
      if (c && c.type === 'DISAPPEAR') stats.officialTeleports += 1;
      else if (c && String(c.type || '').startsWith('WAIT')) stats.officialWaits += 1;
      else if (c && c.type === 'MOVE') stats.officialMoves += 1;
    }
    if (!inMap(r && r.startPosition) || !inMap(r && r.endPosition)) { stats.outOfMap += 1; pending.push({ i, why: 'out-of-map', start: null, end: null }); return; }
    const start = toFrame(r.startPosition);
    const end = toFrame(r.endPosition);
    if (start[0] === end[0] && start[1] === end[1]) { stats.zeroLength += 1; pending.push({ i, why: 'zero-length', start, end: null }); return; }
    stats.seeds += 1;
    if (!pathBetween(start, end)) { pending.push({ i, why: 'unreachable', start, end }); return; }
    const stepRec = stepsOf(r, frame, grid);
    // 有 steps 但任一腿走不通（例如 MOVE 点与起点不在同一连通块）：整条退化成 start→end 的流场行走。
    if (stepRec.steps.length && !stepsConnected(grid, start, end, stepRec.steps)) {
      stats.stepsDroppedRoutes += 1;
      idxMap[i] = addRoute(start, end, motionOf(r), null);
      stats.reached += 1;
      return;
    }
    idxMap[i] = addRoute(start, end, motionOf(r), stepRec);
    stats.reached += 1;
  });

  // 强制 BFS：官方端点吸附到画框内最近可走格后再算一次（unreachable 的那些）。
  for (const p of pending) {
    if (idxMap[p.i] >= 0 || !p.start || !p.end) continue;
    const s = snapWalkable(grid, p.start);
    const e = snapWalkable(grid, p.end);
    if (!s || !e) continue;
    const path = pathBetween(s, e);
    if (!path) continue;
    idxMap[p.i] = addRoute(s, e, 'WALK', null);
    stats.forcedSnapped += 1;
  }

  // 仍然映射不到：复用最近的官方可达路线（按官方起点曼哈顿距离，平手取最小 idx）。
  const reached = idxMap.map((v, i) => (v >= 0 ? i : -1)).filter((i) => i >= 0);
  for (const p of pending) {
    if (idxMap[p.i] >= 0) continue;
    if (!reached.length) break;
    let best = reached[0];
    let bestD = Infinity;
    for (const i of reached) {
      const q = officialRoutes[i].startPosition;
      const d = p.start ? Math.abs(Number(q.row) + frame.row - p.start[0]) + Math.abs(Number(q.col) + frame.col - p.start[1]) : i;
      if (d < bestD) { bestD = d; best = i; }
    }
    idxMap[p.i] = idxMap[best];
    stats.reusedNearest += 1;
  }

  // 一条都不通：合成一条画框内可达路线（从官方起点侧入口出发，走到同一连通块的另一头）。
  if (!routes.length) {
    const seedStarts = pending.filter((p) => p.start).map((p) => p.start);
    const seedEnds = pending.filter((p) => p.end).map((p) => p.end);
    const synth = synthesizeRoute(grid, seedStarts, seedEnds);
    if (synth) {
      addRoute(synth.start, synth.end, 'WALK', null);
      stats.synthetic = 1;
      for (let i = 0; i < idxMap.length; i++) if (idxMap[i] < 0) idxMap[i] = 0;
    } else {
      stats.noPlayableRoute = true;
    }
  }
  if (!routes.length) stats.unmapped = idxMap.filter((v) => v < 0).length;
  return { routes, idxMap, stats };
}

/**
 * 画框内合成一条**可达**路线：起点优先取官方起点（或 tile_start）吸附后的可走格，
 * 终点取其流场里距离最远、且贴近官方终点的可走格（必须同一连通块，否则 findPath 为 null）。
 */
function synthesizeRoute(grid, seedStarts = [], seedEnds = []) {
  const R = grid.rect;
  const walk = [];
  for (let r = R.r0; r <= R.r1; r++) for (let c = R.c0; c <= R.c1; c++) if (grid.walkable(r, c)) walk.push([r, c]);
  if (walk.length < 2) return null;
  let start = null;
  for (const s of seedStarts) { start = snapWalkable(grid, s); if (start) break; }
  if (!start) start = walk[0];
  const field = grid.flowField(start[0], start[1]);
  const target = seedEnds[0] || null;
  let end = null;
  let bestD = 0;
  let bestTie = Infinity;
  for (const [r, c] of walk) {
    const d = field.dist[grid.key(r, c)];
    if (!(d > 0)) continue;
    const tie = target ? Math.abs(r - target[0]) + Math.abs(c - target[1]) : 0;
    if (d > bestD || (d === bestD && tie < bestTie)) { bestD = d; bestTie = tie; end = [r, c]; }
  }
  if (!end) return null;
  const path = grid.findPath(start[0], start[1], end[0], end[1]);
  return path ? { start, end } : null;
}

// ===== 出怪 =====================================================================================

/** 本文件 enemyDbRefs 的 overwrittenData.prefabKey 映射（只做映射，不造数据）。 */
function prefabMapOf(lv) {
  const out = new Map();
  for (const r of lv.enemyDbRefs || []) {
    const p = r && r.overwrittenData ? defined(r.overwrittenData.prefabKey) : null;
    if (typeof p === 'string' && p) out.set(r.id, p);
  }
  return out;
}

/**
 * actions 摊平成绝对时间 SPAWN 列表（同 build-data.expandActions 的时序：上一段最后一波之后接下一段）。
 * 只取 SPAWN；其它 actionType 只计数。未知 enemy key 不写入 spawns（映射表 + unmapped 记录）。
 */
function expandActions(groups, routePlan, ctx) {
  const spawns = [];
  const stats = { actions: 0, nonSpawn: 0, nonSpawnByType: {}, officialSpawn: 0, emitted: 0, filteredUnknown: 0, filteredNoRoute: 0, unharmful: 0, remapped: 0, danglingRoute: 0 };
  let cursor = 0;
  const mapIdx = (i) => {
    const idx = Number.isInteger(i) ? i : 0;
    if (idx >= 0 && idx < routePlan.idxMap.length && routePlan.idxMap[idx] >= 0) return routePlan.idxMap[idx];
    stats.danglingRoute += 1;
    const first = routePlan.idxMap.findIndex((v) => v >= 0);
    return first >= 0 ? routePlan.idxMap[first] : 0;
  };
  for (const g of groups) {
    const start = cursor + numOr(g.preDelay, 0);
    let end = start;
    for (const a of g.actions || []) {
      if (!a) continue;
      stats.actions += 1;
      const time = cleanNum(Math.max(0, start + numOr(a.preDelay, 0)));
      const count = Math.max(1, Math.floor(numOr(a.count, 1)) || 1);
      const interval = Math.max(0, numOr(a.interval, 0));
      end = Math.max(end, time + Math.max(0, count - 1) * interval);
      if (a.actionType !== 'SPAWN') {
        stats.nonSpawn += 1;
        const t = String(a.actionType || '<none>');
        stats.nonSpawnByType[t] = (stats.nonSpawnByType[t] || 0) + 1;
        continue;
      }
      stats.officialSpawn += count;
      // 一条可用路线都没有：宁可不出怪，也不写出指向不存在 route 的 spawn（validate 会直接报错）。
      if (!routePlan.routes.length) { stats.filteredNoRoute += count; continue; }
      const resolved = ctx.resolveEnemy(a.key);
      if (!resolved.key) {
        stats.filteredUnknown += count;
        ctx.noteUnmapped(a.key, count, ctx.file);
        continue;
      }
      if (resolved.via === 'prefab') stats.remapped += 1;
      const rec = { time, key: resolved.key, count, interval, routeIndex: mapIdx(a.routeIndex) };
      if (a.hiddenGroup) rec.hidden = true;
      if (a.randomSpawnGroupKey) { rec.group = a.randomSpawnGroupKey; rec.weight = numOr(a.weight, 0); }
      if (a.isUnharmfulAndAlwaysCountAsKilled) { rec.unharmful = true; rec.countInTotal = false; stats.unharmful += count; }
      if (ctx.bossKeys.has(resolved.key)) rec.tag = 'boss';
      else if (a.isUnharmfulAndAlwaysCountAsKilled || a.randomSpawnGroupKey) rec.tag = 'part';
      spawns.push(rec);
      stats.emitted += count;
    }
    cursor = end;
  }
  if (groups.length > 1) stats.multiFragment = true;
  return { spawns, stats };
}

const hashString = (s) => {
  let h = 0x811c9dc5; // FNV-1a 32 位：稳定、与引擎随机流无关（重跑同一张图选同一个 Boss）
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h >>> 0;
};

/** 第一条**可走**的 WALK 路线（起终点可走且 findPath 通）；没有返回 null。 */
function firstWalkableWalkRoute(routes, grid) {
  for (let i = 0; i < (routes || []).length; i++) {
    const r = routes[i];
    if (!r || r.motion !== 'WALK') continue;
    const s = r.start || [];
    const e = r.end || [];
    if (!grid.walkable(s[0], s[1]) || !grid.walkable(e[0], e[1])) continue;
    if (!grid.findPath(s[0], s[1], e[0], e[1])) continue;
    return i;
  }
  return null;
}

/**
 * `b-*` 变体图补 1 条 Boss spawn（2026-11-03）：官方图在 Boss 半场（rows 0–5）没有部署格，Boss 节点只能按普通
 * 战斗打，于是把 Boss 本体放进这张图的出怪表。`wave.kind` 保持 'normal'，`wave.bossId` 仍为 null。
 * @returns {{ key:string, routeIndex:number }|null} 注入的记录（没有可用路线/敌将时 null）
 */
function injectBossSpawn(code, wave, routes, grid, enemies) {
  if (typeof code !== 'string' || !code.startsWith('b-')) return null;
  if (!Array.isArray(routes) || !routes.length) return null;
  const key = ROGUE_BOSS_KEYS[hashString(code) % ROGUE_BOSS_KEYS.length];
  if (!Object.hasOwn(enemies, key)) return null;
  const walk = firstWalkableWalkRoute(routes, grid);
  const routeIndex = walk == null ? 0 : walk;
  wave.spawns.push({ time: 0, key, count: 1, interval: 0, routeIndex, tag: 'boss' });
  return { key, routeIndex };
}

/** 官方分支：branches{name:{phases:[{preDelay,actions}]}} → branches{name:[[spawn...],[...]]}（routeIndex 走 extraRoutes）。 */
function buildBranches(lv, extraPlan, ctx) {
  const branches = {};
  const stats = { count: 0, phases: 0, spawns: 0, officialSpawn: 0, filteredNoRoute: 0, filteredUnknown: 0 };
  for (const [name, b] of Object.entries(lv.branches || {})) {
    const phases = Array.isArray(b && b.phases) ? b.phases : [];
    const built = phases.map((ph) => expandActions([{ preDelay: ph.preDelay, actions: ph.actions }], extraPlan, ctx));
    branches[name] = built.map((x) => x.spawns);
    stats.count += 1;
    stats.phases += phases.length;
    stats.filteredNoRoute += built.reduce((n, x) => n + x.stats.filteredNoRoute, 0);
    stats.filteredUnknown += built.reduce((n, x) => n + x.stats.filteredUnknown, 0);
    stats.officialSpawn += built.reduce((n, x) => n + x.stats.officialSpawn, 0);
    for (const list of branches[name]) stats.spawns += list.reduce((n, s) => n + s.count, 0);
  }
  return { branches, stats };
}

/** 官方 enemyDbRefs 里对**已存在** enemy key 的覆盖 → waves.overrides。 */
function buildOverrides(lv, enemies, stats) {
  const overrides = {};
  for (const r of lv.enemyDbRefs || []) {
    if (!r || !r.overwrittenData) continue;
    if (!Object.hasOwn(enemies, r.id)) { stats.skippedUnknownRef += 1; continue; }
    const rec = enemyOverrideRecord(definedFields(r.overwrittenData));
    if (!Object.keys(rec).length) continue;
    const way = rec.applyWay || enemies[r.id].applyWay;
    if (rec.stats && 'rangeRadius' in rec.stats) {
      rec.stats.rawRangeRadius = rec.stats.rangeRadius;
      rec.stats.rangeRadius = effectiveRangeRadius(way, rec.stats.rangeRadius);
    } else if (rec.applyWay && enemies[r.id].stats) {
      const eff = effectiveRangeRadius(rec.applyWay, enemies[r.id].stats.rawRangeRadius);
      if (eff !== enemies[r.id].stats.rangeRadius) rec.stats = { ...(rec.stats || {}), rangeRadius: eff };
    }
    overrides[r.id] = rec;
    stats.count += 1;
  }
  return overrides;
}

// ===== 单图转换 =================================================================================

/** `level_rogue4_1-1.json` → `{ theme:'ro4', code:'1-1', id:'rogue_ro4_1-1' }`。 */
export function idOfFile(file) {
  const m = /^level_rogue(\d+)_(.+)\.json$/i.exec(path.basename(file));
  if (!m) return null;
  return { theme: `ro${m[1]}`, code: m[2], id: `rogue_ro${m[1]}_${m[2]}` };
}

/**
 * 一份官方关卡 → { stage, wave, report }（无地图 / 超画框时返回 { skip }）。
 * @param {any} lv 官方 level JSON
 * @param {string} file 文件路径（只用于 id 与报告）
 * @param {object} ctx { enemies, unmapped:Map }
 */
export function convertLevel(lv, file, ctx) {
  const idn = idOfFile(file);
  if (!idn) return { skip: 'bad-name' };
  const built = buildStage(lv, { id: idn.id, name: idn.id });
  if (built.skip) return { skip: built.skip, id: idn.id, file };
  const stage = built.stage;
  // 模拟场地 rect = 该图画框（clamp 19×21）：官方图就是棋盘，不能再用 GEO.NORMAL_RECT 切窗口。
  const rect = rectOfStage(stage);
  const grid = new Grid({ ...stage, legend: stage.tiles }, rect);

  const plan = planRoutes(lv.routes || [], stage, grid);
  const extraPlan = planRoutes(lv.extraRoutes || [], stage, grid);

  const bossKeys = new Set();
  for (const k of Object.keys(ctx.enemies)) if (ctx.enemies[k] && ctx.enemies[k].rank === 'BOSS') bossKeys.add(k);

  const groups = [];
  (lv.waves || []).forEach((w) => {
    (w.fragments || []).forEach((f, fi) => {
      groups.push({ preDelay: (fi === 0 ? numOr(w.preDelay, 0) : 0) + numOr(f.preDelay, 0), actions: f.actions || [] });
    });
  });
  const waveCtx = {
    file: path.basename(file),
    resolveEnemy: (key) => {
      if (typeof key === 'string' && key && Object.hasOwn(ctx.enemies, key)) return { key, via: 'direct' };
      const p = key ? ctx.prefabMap.get(key) : null;
      if (p && Object.hasOwn(ctx.enemies, p)) return { key: p, via: 'prefab' };
      return { key: null, via: 'none' };
    },
    noteUnmapped: (key, count, f) => {
      const k = key || '<empty-key>';
      if (ctx.fileUnmapped) ctx.fileUnmapped.set(k, (ctx.fileUnmapped.get(k) || 0) + count);
      const rec = ctx.unmapped.get(k) || { key: k, count: 0, files: [] };
      rec.count += count;
      if (!rec.files.includes(f)) rec.files.push(f);
      ctx.unmapped.set(k, rec);
    },
    bossKeys,
  };
  const main = expandActions(groups, plan, waveCtx);
  const branches = buildBranches(lv, extraPlan, waveCtx);
  const overStats = { count: 0, skippedUnknownRef: 0 };
  const overrides = buildOverrides(lv, ctx.enemies, overStats);

  const o = lv.options || {};
  const dpInit = numOr(o.initialCost, 10);
  const perSecRaw = Number(o.costIncreaseTime);
  const wave = {
    id: idn.id,
    kind: 'normal',
    solo: false,
    bossId: null,
    maxPlayTime: Number(o.maxPlayTime) > 0 ? Number(o.maxPlayTime) : DEFAULT_PLAY_TIME,
    dp: { init: dpInit, perSec: perSecRaw > 0 ? cleanNum(1 / perSecRaw) : 1, max: numOr(o.maxCost, 99) },
    characterLimit: numOr(o.characterLimit, 6),
    moveMultiplier: numOr(o.moveMultiplier, 0.5),
    bgm: lv.bgmEvent || null,
    routes: plan.routes,
    extraRoutes: extraPlan.routes,
    spawns: main.spawns,
    branches: branches.branches,
    overrides,
    devices: [],
    totalCount: main.spawns.reduce((n, s) => n + (s.unharmful ? 0 : s.count), 0),
    slotCounts: {},
    usedBy: [],
  };
  // Boss 节点（b-*）：追加 1 条 tag:'boss' 的 spawn；kind 仍是 'normal'，bossId 仍为 null。
  const bossSpawn = injectBossSpawn(idn.code, wave, plan.routes, grid, ctx.enemies);
  if (bossSpawn) wave.totalCount += 1;

  const report = {
    id: idn.id,
    file: path.basename(file),
    frame: stage.rogueFrame,
    rect,
    deploy: built.deploy,
    routes: {
      official: plan.stats.official, emitted: plan.routes.length, reached: plan.stats.reached,
      zeroLength: plan.stats.zeroLength, outOfMap: plan.stats.outOfMap, deduped: plan.stats.deduped,
      forcedSnapped: plan.stats.forcedSnapped, reusedNearest: plan.stats.reusedNearest, synthetic: plan.stats.synthetic,
      stepsKept: plan.stats.stepsKept, stepsDropped: plan.stats.stepsDropped, stepsDroppedRoutes: plan.stats.stepsDroppedRoutes, waits: plan.stats.waits,
      teleports: plan.stats.teleports, unpairedTeleports: plan.stats.unpairedTeleports,
      officialTeleports: plan.stats.officialTeleports, officialWaits: plan.stats.officialWaits, officialMoves: plan.stats.officialMoves,
      noPlayableRoute: plan.stats.noPlayableRoute,
    },
    extraRoutes: {
      official: extraPlan.stats.official, emitted: extraPlan.routes.length, reached: extraPlan.stats.reached,
      forcedSnapped: extraPlan.stats.forcedSnapped, reusedNearest: extraPlan.stats.reusedNearest,
      synthetic: extraPlan.stats.synthetic, zeroLength: extraPlan.stats.zeroLength, outOfMap: extraPlan.stats.outOfMap,
    },
    spawns: {
      actions: main.stats.actions, nonSpawn: main.stats.nonSpawn, nonSpawnByType: main.stats.nonSpawnByType, officialSpawn: main.stats.officialSpawn,
      emitted: main.stats.emitted, filteredUnknown: main.stats.filteredUnknown, filteredNoRoute: main.stats.filteredNoRoute,
      unharmful: main.stats.unharmful, remapped: main.stats.remapped, danglingRoute: main.stats.danglingRoute,
      multiFragmentTiming: !!main.stats.multiFragment, totalCount: wave.totalCount,
      bossInjected: bossSpawn ? 1 : 0, bossKey: bossSpawn ? bossSpawn.key : null, bossRouteIndex: bossSpawn ? bossSpawn.routeIndex : null,
    },
    branches: {
      count: branches.stats.count, phases: branches.stats.phases, spawns: branches.stats.spawns,
      officialSpawn: branches.stats.officialSpawn, filteredUnknown: branches.stats.filteredUnknown, filteredNoRoute: branches.stats.filteredNoRoute,
    },
    devices: stage.devices.length,
    devicesHidden: stage.devices.filter((d) => d.hidden).length,
    unmappedKeyCount: ctx.fileUnmapped ? ctx.fileUnmapped.size : 0,
    unmappedTop: ctx.fileUnmapped ? [...ctx.fileUnmapped.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([key, count]) => ({ key, count })) : [],
    overrides: overStats.count,
    overridesUnknownRef: overStats.skippedUnknownRef,
  };
  return { id: idn.id, stage, wave, report };
}

// ===== 校验（只读） ===============================================================================

function verifyStageAndWave(stage, wave, enemies) {
  const problems = [];
  if (!Array.isArray(stage.rows) || stage.rows.length !== 19) problems.push('rows-not-19');
  if ((stage.rows || []).some((r) => typeof r !== 'string' || r.length !== 21)) problems.push('rows-not-21');
  const legend = stage.tiles || {};
  const glyphs = new Set((stage.rows || []).join(''));
  for (const g of glyphs) if (!Object.hasOwn(legend, g)) problems.push(`glyph-without-legend:${g}`);
  if (!(stage.deployTiles?.normal?.melee || []).length) problems.push('no-melee-deploy');
  if (!(wave.routes || []).length) problems.push('no-routes');
  for (const s of wave.spawns || []) {
    if (s.action) continue;
    if (!Object.hasOwn(enemies, s.key)) problems.push(`spawn-unknown-enemy:${s.key}`);
    if (!(wave.routes || [])[s.routeIndex]) problems.push(`spawn-route-oob:${s.routeIndex}`);
  }
  for (const [bn, phases] of Object.entries(wave.branches || {})) {
    for (const s of phases.flat()) {
      if (!Object.hasOwn(enemies, s.key)) problems.push(`branch-${bn}-unknown-enemy:${s.key}`);
      if (!(wave.extraRoutes || [])[s.routeIndex]) problems.push(`branch-${bn}-route-oob:${s.routeIndex}`);
    }
  }
  for (const k of Object.keys(wave.overrides || {})) if (!Object.hasOwn(enemies, k)) problems.push(`override-unknown:${k}`);
  return problems;
}

/** 用引擎同款 Grid 逐条路线验证可达性（rect = 该图画框）+ steps 合法性（位置可走、传送成对）。 */
function verifyRouting(stage, wave) {
  const grid = new Grid({ ...stage, legend: stage.tiles }, rectOfStage(stage));
  const out = { routes: 0, reachable: 0, unreachable: [], stepProblems: [] };
  for (const key of ['routes', 'extraRoutes']) {
    (wave[key] || []).forEach((r, i) => {
      const s = r.start || [];
      const e = r.end || [];
      const ok = grid.walkable(s[0], s[1]) && grid.walkable(e[0], e[1]) && !!grid.findPath(s[0], s[1], e[0], e[1]);
      out.routes += 1;
      if (ok) out.reachable += 1;
      else out.unreachable.push({ list: key, index: i, start: s, end: e });
      const steps = Array.isArray(r.steps) ? r.steps : [];
      if (!steps.length) return;
      let open = false;
      for (const st of steps) {
        if (st.t === 'disappear') open = true;
        if (st.t === 'appear') open = false;
        if (st.p && !grid.walkable(st.p[0], st.p[1])) out.stepProblems.push({ list: key, index: i, step: st });
        if (st.t === 'wait' && st.p) out.stepProblems.push({ list: key, index: i, step: st, why: 'wait-with-pos' });
      }
      if (open) out.stepProblems.push({ list: key, index: i, why: 'disappear-without-appear' });
    });
  }
  return out;
}

/**
 * 引擎运行路径复核：normalizeStage → spawnsFromTemplate → compileRoute（rect 夹取后每条腿的目标必须仍可走）。
 * 与 verifyRouting 的区别是这里走的是 sim 真正用的归一化/编译链，而不是直接读 JSON。
 */
function verifyEngine(stage, wave, enemies) {
  const norm = normalizeStage(stage.id, stage);
  const rect = rectOfStage(stage);
  const grid = new Grid(norm, rect);
  const tpl = spawnsFromTemplate(wave);
  const out = { problems: [], spawnEntries: tpl.spawns.length, spawnCount: 0, legs: 0, clamped: 0 };
  for (const s of tpl.spawns) {
    out.spawnCount += s.count;
    if (!Object.hasOwn(enemies, s.enemyKey)) out.problems.push(`runtime-unknown-enemy:${s.enemyKey}`);
    if (!tpl.routes[s.routeIndex]) out.problems.push(`runtime-route-oob:${s.routeIndex}`);
  }
  for (const raw of [...(wave.routes || []), ...(wave.extraRoutes || [])]) {
    const r = normalizeRoute(raw);
    for (const cp of r.checkpoints) {
      if (!cp.pos || cp.type === 'WAIT' || cp.type === 'DISAPPEAR') continue;
      const rr = Math.max(rect.r0, Math.min(rect.r1, cp.pos[0]));
      const cc = Math.max(rect.c0, Math.min(rect.c1, cp.pos[1]));
      if (rr !== cp.pos[0] || cc !== cp.pos[1]) { out.clamped += 1; out.problems.push(`runtime-step-clamped:${JSON.stringify(cp.pos)}`); }
    }
    const legs = compileRoute(r, rect);
    out.legs += legs.length;
    for (const l of legs) if ((l.t === 'move' || l.t === 'appear') && !grid.walkable(l.r, l.c)) out.problems.push(`runtime-leg-unwalkable:${l.r},${l.c}`);
  }
  for (const [bn, phases] of Object.entries(wave.branches || {})) {
    for (const s of phases.flat()) if (!(wave.extraRoutes || [])[s.routeIndex]) out.problems.push(`runtime-branch-${bn}-route-oob:${s.routeIndex}`);
  }
  return out;
}

// ===== 数据读写 ===============================================================================

/** 保留原键顺序地替换 `prefix` 记录（其它记录原样不动）。 */
function replaceKeys(order, next, prefix) {
  const out = {};
  const used = new Set();
  for (const k of order) {
    if (k.startsWith(prefix)) {
      if (Object.hasOwn(next, k)) { out[k] = next[k]; used.add(k); }
    } else out[k] = next[k];
  }
  for (const k of Object.keys(next).sort()) if (!used.has(k)) out[k] = next[k];
  return out;
}

function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

function listLevelFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && /^level_rogue\d+_.+\.json$/i.test(e.name))
    .map((e) => path.join(dir, e.name))
    .sort();
}

function main(argv) {
  const arg = (k, dflt = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  const levelsDir = arg('--levels');
  const prefix = arg('--prefix', 'ro4');
  const reportPath = path.resolve(arg('--report', path.join(ROOT, '..', '..', 'rogue-rebuild-2026-11-03', 'report.json')));
  const dry = argv.includes('--dry');
  const doVerify = argv.includes('--verify');
  if (!levelsDir) {
    console.error('usage: node tools/build-rogue-maps-v2.mjs --levels <dir> [--prefix ro4] [--report <path>] [--dry] [--verify]');
    process.exit(2);
  }

  const stagesPath = path.join(ROOT, 'data', 'stages.json');
  const wavesPath = path.join(ROOT, 'data', 'waves.json');
  const enemiesPath = path.join(ROOT, 'data', 'enemies.json');
  const stages = readJson(stagesPath);
  const waves = readJson(wavesPath);
  const enemies = readJson(enemiesPath);

  const files = listLevelFiles(levelsDir).filter((f) => idOfFile(f)?.theme === prefix);
  const ctx = { enemies, prefabMap: new Map(), unmapped: new Map() };

  const nextStages = {};
  const nextWaves = {};
  const reports = [];
  const skipped = [];
  const routeByMap = {};
  for (const f of files) {
    let lv = null;
    try { lv = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { skipped.push({ file: path.basename(f), reason: 'parse-error' }); continue; }
    ctx.prefabMap = prefabMapOf(lv);
    ctx.fileUnmapped = new Map();
    const one = convertLevel(lv, f, ctx);
    if (one.skip) { skipped.push({ file: path.basename(f), reason: one.skip }); continue; }
    nextStages[one.id] = one.stage;
    nextWaves[one.id] = one.wave;
    reports.push(one.report);
    routeByMap[one.id] = verifyRouting(one.stage, one.wave);
  }

  const stageOrder = Object.keys(stages);
  const waveOrder = Object.keys(waves);
  const outStages = replaceKeys(stageOrder, { ...stages, ...nextStages }, 'rogue_');
  const outWaves = replaceKeys(waveOrder, { ...waves, ...nextWaves }, 'rogue_');

  const total = {
    files: files.length,
    converted: reports.length,
    skipped: skipped.length,
    spawnsOfficial: reports.reduce((n, r) => n + r.spawns.officialSpawn, 0),
    spawnsEmitted: reports.reduce((n, r) => n + r.spawns.emitted, 0),
    spawnsFilteredUnknown: reports.reduce((n, r) => n + r.spawns.filteredUnknown, 0),
    spawnsFilteredNoRoute: reports.reduce((n, r) => n + r.spawns.filteredNoRoute + r.branches.filteredNoRoute, 0),
    spawnsRemapped: reports.reduce((n, r) => n + r.spawns.remapped, 0),
    unharmful: reports.reduce((n, r) => n + r.spawns.unharmful, 0),
    totalCount: reports.reduce((n, r) => n + r.spawns.totalCount, 0),
    branches: reports.reduce((n, r) => n + r.branches.count, 0),
    devices: reports.reduce((n, r) => n + r.devices, 0),
    routes: reports.reduce((n, r) => n + r.routes.emitted, 0),
    bossInjected: reports.reduce((n, r) => n + (r.spawns.bossInjected || 0), 0),
    deployMelee: reports.reduce((n, r) => n + r.deploy.melee, 0),
    deployRangedOnly: reports.reduce((n, r) => n + r.deploy.rangedOnly, 0),
    unmappedDistinct: ctx.unmapped.size,
    unmappedCount: [...ctx.unmapped.values()].reduce((n, u) => n + u.count, 0),
  };

  const report = {
    generatedAt: new Date().toISOString(),
    inputs: { levels: levelsDir, prefix, files: files.length },
    outputs: { stages: stagesPath, waves: wavesPath },
    totals: total,
    skipped,
    unmapped: [...ctx.unmapped.values()].sort((a, b) => b.count - a.count),
    maps: reports,
    routing: routeByMap,
  };

  if (doVerify) {
    const problems = {};
    let reachableMaps = 0;
    const stepProblems = {};
    for (const r of reports) {
      const p = verifyStageAndWave(nextStages[r.id], nextWaves[r.id], enemies);
      if (p.length) problems[r.id] = p;
      const rt = routeByMap[r.id];
      if (rt.reachable > 0) reachableMaps += 1;
      if (rt.stepProblems.length) stepProblems[r.id] = rt.stepProblems.slice(0, 20);
    }
    const countMismatch = [];
    for (const r of reports) {
      const expect = r.spawns.officialSpawn - r.spawns.filteredUnknown - r.spawns.filteredNoRoute - r.spawns.unharmful + (r.spawns.bossInjected || 0);
      if (r.spawns.totalCount !== expect) countMismatch.push({ id: r.id, totalCount: r.spawns.totalCount, expect });
    }
    // 引擎归一化链（normalizeStage → spawnsFromTemplate → compileRoute）复核。
    const engineProblems = {};
    let runtimeSpawns = 0;
    let runtimeLegs = 0;
    let runtimeClamped = 0;
    for (const r of reports) {
      const e = verifyEngine(nextStages[r.id], nextWaves[r.id], enemies);
      runtimeSpawns += e.spawnCount;
      runtimeLegs += e.legs;
      runtimeClamped += e.clamped;
      if (e.problems.length) engineProblems[r.id] = e.problems.slice(0, 20);
    }
    report.verification = {
      mapsWithProblems: Object.keys(problems).length,
      problems,
      mapsWithReachableRoute: reachableMaps,
      mapsTotal: reports.length,
      routesTotal: Object.values(routeByMap).reduce((n, v) => n + v.routes, 0),
      routesReachable: Object.values(routeByMap).reduce((n, v) => n + v.reachable, 0),
      unreachableMaps: reports.filter((r) => !(routeByMap[r.id].reachable > 0)).map((r) => ({ id: r.id, reasons: r.routes })),
      stepProblemMaps: Object.keys(stepProblems).length,
      stepProblems,
      countMismatch,
      engine: {
        mapsWithProblems: Object.keys(engineProblems).length,
        problems: engineProblems,
        runtimeSpawnCount: runtimeSpawns,
        runtimeLegs,
        clampedSteps: runtimeClamped,
      },
    };
  }

  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 1)}\n`);

  const fmt = (r) => `${r.id.padEnd(18)} routes ${String(r.routes.emitted).padStart(3)}/${String(r.routes.official).padStart(3)}  spawns ${String(r.spawns.emitted).padStart(4)}/${String(r.spawns.officialSpawn).padStart(4)}  branches ${String(r.branches.count).padStart(2)}  devices ${String(r.devices).padStart(2)}  deploy ${String(r.deploy.melee).padStart(2)}/${String(r.deploy.rangedOnly).padStart(2)}`;
  for (const r of reports) console.log(`build-rogue-maps-v2: ${fmt(r)}`);
  for (const s of skipped) console.log(`build-rogue-maps-v2: SKIP ${s.file} (${s.reason})`);
  console.log(`build-rogue-maps-v2: ${files.length} files → ${reports.length} stages / ${reports.length} waves; skipped ${skipped.length}; spawns ${total.spawnsEmitted}/${total.spawnsOfficial} (filtered unknown ${total.spawnsFilteredUnknown}, no-route ${total.spawnsFilteredNoRoute}, unharmful ${total.unharmful}); unmapped keys ${total.unmappedDistinct} (${total.unmappedCount} spawns)`);
  if (report.verification) {
    const v = report.verification;
    console.log(`build-rogue-maps-v2: verify maps-with-reachable-route ${v.mapsWithReachableRoute}/${v.mapsTotal} (routes ${v.routesReachable}/${v.routesTotal}); structural problems on ${v.mapsWithProblems} maps; step problems ${v.stepProblemMaps}; count mismatches ${v.countMismatch.length}; engine problems ${v.engine.mapsWithProblems} maps (runtime spawns ${v.engine.runtimeSpawnCount}, legs ${v.engine.runtimeLegs}, clamped steps ${v.engine.clampedSteps})`);
  }
  console.log(`build-rogue-maps-v2: report ${reportPath}`);

  if (dry) return;
  // 备份到 %TEMP%，写成功即删（派单要求：写前备份、成功后删除）。
  const stamp = `${process.pid}-${Date.now()}`;
  const backups = [
    { target: stagesPath, bak: path.join(os.tmpdir(), `stages.json.rogue-v2.${stamp}.bak`) },
    { target: wavesPath, bak: path.join(os.tmpdir(), `waves.json.rogue-v2.${stamp}.bak`) },
  ];
  for (const b of backups) fs.copyFileSync(b.target, b.bak);
  try {
    fs.writeFileSync(stagesPath, `${JSON.stringify(outStages)}\n`);
    fs.writeFileSync(wavesPath, `${JSON.stringify(outWaves)}\n`);
  } catch (e) {
    for (const b of backups) if (fs.existsSync(b.bak)) fs.copyFileSync(b.bak, b.target);
    throw e;
  }
  for (const b of backups) fs.rmSync(b.bak, { force: true });
  console.log('build-rogue-maps-v2: wrote data/stages.json + data/waves.json (rogue_* replaced, others untouched)');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
