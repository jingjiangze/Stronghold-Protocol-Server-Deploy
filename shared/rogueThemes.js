// shared/rogueThemes.js — 肉鸽「地图主题池」的唯一常量表（2026-11-06）。
//
// 数据来源（权威）：官方 activity_table.json（data/.cache/gamedata/excel/activity_table.json）里
// type=ROGUELIKE 的六条 `dis_rogue_1`…`dis_rogue_6`，它们的 timeNodes[].title 给出主题全名：
//
//   dis_rogue_1  集成战略<傀影与猩红孤钻>   → 地图前缀 rogue_ro1_
//   dis_rogue_2  集成战略<水月与深蓝之树>   → 地图前缀 rogue_ro2_
//   dis_rogue_3  集成战略<探索者的银凇止境> → 地图前缀 rogue_ro3_
//   dis_rogue_4  集成战略<萨卡兹的无终奇语> → 地图前缀 rogue_ro4_
//   dis_rogue_5  集成战略<岁的界园志异>     → 地图前缀 rogue_ro5_
//   dis_rogue_6  集成战略<沉沦者的黑流树海> → 地图前缀 rogue_ro6_
//
// 刻俄柏的灰蕈迷境没有 `rogue_ro*` 官方图（data/stages.json 里一张都没有），所以不建池。
// 地图 id 形如 `rogue_ro<主题号>_<tier>-<编号>`（tools/build-rogue-maps-v2.mjs 生成，见 data/stages.json）；
// ro5 的 DLC 图带 `_dlc1` 后缀，前缀仍是 `rogue_ro5_`，所以自然归进 ro5 池。
//
// `all` = 不按主题过滤：`mapPool` 缺省（或非法）时一律按它处理，选图结果与加这个开关之前逐字节一致。
// 这张表同时被服务端（server/lobby.js、plugins/mota/server/match/**、plugins/roguelike-core/**）与
// 测试读取；浏览器侧的大厅选择器自带一份同值的短表 —— 插件客户端跑在挂载树上（/js/...），
// 不能 import 根 shared 的新文件（见 plugins/mota/client/js/screens/lobby.js 的 ROGUE_MAP_POOLS）。

/**
 * @typedef {'all'|'ro1'|'ro2'|'ro3'|'ro4'|'ro5'|'ro6'} RoguePoolId
 * @typedef {{ id: RoguePoolId, code: string, short: string, name: string, prefix: string }} RogueTheme
 */

/** @type {Readonly<Record<RoguePoolId, RogueTheme>>} */
export const ROGUE_THEMES = Object.freeze({
  all: Object.freeze({ id: 'all', code: 'ALL', short: '全部', name: '全部主题', prefix: '' }),
  ro1: Object.freeze({ id: 'ro1', code: 'R1', short: '傀影', name: '傀影与猩红孤钻', prefix: 'rogue_ro1_' }),
  ro2: Object.freeze({ id: 'ro2', code: 'R2', short: '水月', name: '水月与深蓝之树', prefix: 'rogue_ro2_' }),
  ro3: Object.freeze({ id: 'ro3', code: 'R3', short: '银凇', name: '探索者的银凇止境', prefix: 'rogue_ro3_' }),
  ro4: Object.freeze({ id: 'ro4', code: 'R4', short: '萨卡兹', name: '萨卡兹的无终奇语', prefix: 'rogue_ro4_' }),
  ro5: Object.freeze({ id: 'ro5', code: 'R5', short: '岁', name: '岁的界园志异', prefix: 'rogue_ro5_' }),
  ro6: Object.freeze({ id: 'ro6', code: 'R6', short: '黑流树海', name: '沉沦者的黑流树海', prefix: 'rogue_ro6_' }),
});

/** 全部可选的池 id（UI 顺序：全部 + 官方主题号顺序）。 @type {ReadonlyArray<RoguePoolId>} */
export const POOL_IDS = Object.freeze(['all', 'ro1', 'ro2', 'ro3', 'ro4', 'ro5', 'ro6']);

/**
 * 是不是一个合法的池 id（`all` / `ro1`…`ro6`）。
 * @param {unknown} id
 * @returns {boolean}
 */
export const isPool = (id) => typeof id === 'string' && Object.hasOwn(ROGUE_THEMES, id);

/**
 * 池的官方全名；非法 id 返回空串（不编造名字）。
 * @param {unknown} id
 * @returns {string}
 */
export const poolName = (id) => (isPool(id) ? ROGUE_THEMES[id].name : '');

/**
 * 池的图 id 前缀：`ro2` → `rogue_ro2_`；`all` 与非法 id → 空串（调用方据此跳过收窄）。
 * @param {unknown} id
 * @returns {string}
 */
export const poolPrefix = (id) => (isPool(id) ? ROGUE_THEMES[id].prefix : '');

/**
 * 把池 id 规整成可用值：合法的原样返回，其余（含缺省 / 非法 / 非字符串）回落 `'all'`。
 * @param {unknown} id
 * @returns {RoguePoolId}
 */
export const normalizePool = (id) => (isPool(id) ? id : 'all');
