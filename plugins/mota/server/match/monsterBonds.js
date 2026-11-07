// plugins/mota/server/match/monsterBonds.js — 怪物方的**独立盟约**（攻方专属，业主 2026-11-04 口径）。
//
// 业主口径（2026-11-04，v2 按阵营）：**攻方完全没有干员盟约、没有干员商店，只有怪物方的独立盟约** ——
// 22 条**按阵营**（data/monster-factions.json 的 22 个 id：0.4.3 的 20 个 + 业主 2026-11-04 新增的「源石协议」
// ORIGINIUM（第 21 个）+ 业主 2026-11-05 新增的「假想敌协议」IMAGINARY（第 22 个，假想敌 SP01–SP18 系列单列））
// + 3 条通用，层数制，**只影响本回合**。
// 所以本模块与 `bondsMeta.js`（干员盟约：整局持久、ps.layers / ps.bonds 被 invariants.js 钉死）是**平行结构**，
// 两套数据 / 状态 / installer 一律不共用：
//   · 状态 `m.monsterBonds` = Map<key, Record<bondId, layers>>，key 与怪物池同口径（monsterMode === 'solo' ? playerId
//     : teamId，见 monsterPool.js monsterPoolFor）—— 共享池时同队两名攻方的层数合成一份；
//   · 生命周期**每回合重置**（match/match/phases.js 的回合边界调 closeMonsterBondRound）；
//   · 涨层 = `monsterShop.js` 的 placeMonster / buyMonster（只算攻方投放的怪，官方波次不算），dropMonster 回退；
//   · 效果 = spawn 的 `mods` 乘区（hpMul / atkMul / defMul / resMul / speedMul / aspdMul），在 match/match/confront.js 的
//     applyConfront（投放怪）与 _confrontBossSpawns（事件期 boss）合并；资金类（增援 / 回收）在回合收尾发放。
//
// 【阵营归属（2026-11-04）】只认 `data/monster-factions.json` 的 `map`（敌人 key → 阵营 id 数组）：一只怪属于哪些
// 阵营是**数据**，不是从 acType / rank 现推的。读法与 `gamedata.js` 同源：GameData 的 `raw` 就是 server/data.js
// `loadData()` 把 data/*.json 按 basename 装进来的对象（`gd.raw['monster-factions']`）；拿不到 `gd.raw` 的直测 / stub
// 走同一个 `getData()` 单例（与 builtinMeta.js 的懒取法一致），**不另造读数层**。2026-11-04 业主裁决「剩余全部归类」
// 之后 map 已覆盖 enemies.json 的 491/491（0.4.3 的 297 条 + 规则补全的 194 条，规则顺序见该文件的 `rules` 段）；
// 「没有阵营的怪不进任何阵营条、只在 3 条通用条里计数」这条分支保留作**防御性兜底**（老数据 / 新增怪 / 数据缺文件时）。
//
// 【阈值（2026-11-05 改分母）】阵营条不再用绝对 [2,4,6]：按该阵营在**商店卡池**（monsterPool.js 的
// monsterPoolKeys：`data/enemies.json` 全表 − tokenOnly − BOSS，实测 408 只）里的**只数** n 取比例：
//   t1 = max(1, ceil(n × 0.15))，t2 = max(t1+1, ceil(n × 0.30))，t3 = max(t2+1, ceil(n × 0.45))
// 池子小的阵营阈值低（补偿可选卡少），池子大的阵营阈值高。n = 0（该阵营在全表里一只都没有）时才回落到 [1,2,3]。
// **旧分母（2026-11-04）** = 本回合可投放池（monsterCardKeys：对抗档 = 本回合官方出怪）：实测 R1–R13 只有
// 7 个 key / 3 个阵营 ⇒ 其余 19 个阵营的分母恒 0、阈值退化成常量 [1,2,3]，而它们的卡在 408 只商店池里能买；
// REUNION / SARKAZ 反被推到 6 / 12 / 18 只才 1/2/3 阶。业主 2026-11-05：分母统一改成商店池（与「能不能买」
// 同一张表）。3 条通用条仍是绝对阈值（见各自的常量）。
//
// 【aspdMul（攻速乘区）】2026-11-04 起两棵 sim 树的 `spawns.js`（`server/sim/battle/spawns.js` 与
// `plugins/mota/server/sim/battle/spawns.js`）的 enemy mods 都认 `aspdMul`：`aspd = def.aspd * (m.aspdMul ?? 1)`，
// 下游 `units.js` 的 `clamp(..., ASPD_MIN, ASPD_MAX)` 照旧兜底。**两棵树必须同步改**，否则客户端与服务端结果会漂。
//
// 守卫：`m.monsterShopOn === false`（opts.monsterShop === false / 非对抗局）时**整段不跑** —— 不建状态、不发帧、
// 不发放资金，旧对局的行为与字节完全不变。

// 盟约阈值分母 = 商店卡池（`monsterPoolKeys`，业主 2026-11-05 改口径）；官方只数只给「增援」当 1.5 倍基准用。
// 阶梯价给「回收」当漏过奖励的基准价（2026-11-06 价值同源）。
import { monsterPoolKeys, officialSpawnCounts, MONSTER_PRICE_BY_TIER } from './monsterPool.js';
// 怪物资金账户的唯一入口（业主 2026-11-04 裁决 2）：shared 落队级账户、solo 落个人账户。
// 与 monsterShop.js 互为 import（它 import 本文件的 addMonsterBonds / monsterBondView）：两边都只在函数体内取用，
// 模块顶层不互相求值（与 monsterPool ↔ match/confront 的循环同一口径），因此安全。
// `monsterLeakReward` 也一样：**只在函数体内调**（closeMonsterBondRound），顶层不跨 import 求值。
import { addMonsterFundsTo, monsterLeakReward } from './monsterShop.js';
// data/*.json 的进程级单例（server/data.js 的再导出）；只在拿不到 gd.raw 的直测 / stub 路径上懒取一次。
import { getData } from '../data.js';

/** 层数阈值（通用条用；阵营条的阈值按池子集动态算，见文件头与 monsterBondThresholds）。 */
export const MONSTER_BOND_THRESHOLDS = [2, 4, 6];
/** 会战只看「同队有几名攻方投过」（2V2 上限 2 人 / 4V4 上限 4 人），阈值因此单独一张。 */
export const MONSTER_BOND_CONCERT_THRESHOLDS = [2, 3, 4];
/** 增援：投放只数超过「官方只数 × 1.5」的部分才算增援（与 monsterPool.js 的池口径、confront.js 的
 *  CONFRONT_VOLUME_SHARE 同一个 1.5）。 */
export const MONSTER_BOND_SURPLUS_SHARE = 1.5;
/** 增援：超出部分按**单价 × 20%** 返还怪物资金。 */
export const MONSTER_BOND_SURPLUS_REFUND = 0.2;
/** 回收：漏过的投放怪每只的**既有奖励基准**（2026-11-06 与卡价同源）。
 *  真源 = `monsterShop.js` 的 `monsterLeakReward(price)`（= max(1, round(price × 0.5))），结算时按下面这个基准价
 *  现算（见 closeMonsterBondRound）；这里另给一个常量是为了让本模块**顶层**不跨 import 求值（循环 import，见上方
 *  的 import 说明），它的值与 `monsterLeakReward(MONSTER_LEAK_REWARD_REF_PRICE)` 恒等。
 *  基准价取 3 阶卡（阶梯价 4）⇒ 2，与旧硬编码 2 同值。settle 已经在发这一笔，所以本盟约只发「额外 +50%」，
 *  不重复发全额。 */
export const MONSTER_LEAK_REWARD_REF_PRICE = MONSTER_PRICE_BY_TIER[2];
/** = monsterLeakReward(MONSTER_LEAK_REWARD_REF_PRICE)（同一式子；保留导出给老调用方 / 诊断）。 */
export const MONSTER_LEAK_REWARD_BASE = Math.max(1, Math.round(MONSTER_LEAK_REWARD_REF_PRICE * 0.5));
/** 回收：在 settle 既有发奖之上再 +50%。 */
export const MONSTER_BOND_LEAK_EXTRA = 0.5;
/** 资金类盟约的层数档倍率（下标 = tier，0 = 未达一阶 = 不发钱）。 */
export const MONSTER_BOND_TIER_MUL = [0, 1, 1.5, 2];
/** 会战的固定加成（同队两名攻方都投过 ≥1 只即生效）。 */
export const MONSTER_BOND_CONCERT_BONUS = 0.05;

/** data/monster-factions.json 在 loadData() 里的 basename（server/data.js 的键 = 文件名去掉 .json）。 */
const FACTION_DATA_KEY = 'monster-factions';

/** 直测 / stub 路径的懒取缓存：null = 还没取，false = 取失败或文件缺失。 */
let factionDataFallback = null;

/**
 * `data/monster-factions.json`（只读）。优先 `gd.raw[FACTION_DATA_KEY]` —— GameData 的 raw 就是 server/data.js
 * `loadData()` 的产物（data/*.json 按 basename 装、deepFreeze），与 gamedata.js 的 factions getter 同一套读法，
 * 不另造读数层；stub / 直测没有 raw 时用 getData() 单例懒取一次（builtinMeta.js 的同一手法）。
 * @param {object} gd GameData（或用 gd.enemy(key) 的 stub）
 * @returns {{ map?: Object<string, string[]> }|null}
 */
function monsterFactionData(gd) {
  const raw = gd && gd.raw;
  const own = raw && typeof raw === 'object' ? raw[FACTION_DATA_KEY] : null;
  if (own && typeof own === 'object' && own.map && typeof own.map === 'object') return own;
  if (factionDataFallback === null) {
    try {
      const data = getData({ log: { warn() {}, error() {}, info() {} } });
      factionDataFallback = (data && data[FACTION_DATA_KEY]) || false;
    } catch { factionDataFallback = false; }
  }
  return factionDataFallback || null;
}

/**
 * 一只怪属于哪些阵营（`data/monster-factions.json` 的 map；没有 = []）。纯数据查询，不看敌人属性。
 * @param {object} gd GameData / stub @param {string} enemyKey
 * @returns {string[]} 阵营 id 列表（map 里按 id 排序）
 */
export function monsterFactionIds(gd, enemyKey) {
  const data = monsterFactionData(gd);
  const list = data && typeof enemyKey === 'string' ? data.map[enemyKey] : null;
  return Array.isArray(list) ? list.filter((id) => typeof id === 'string' && id) : [];
}

/**
 * 25 条盟约的固定定义（业主 2026-11-04 裁决 v2：21 条按**阵营** + 3 条通用；2026-11-05 追加「假想敌协议」
 * IMAGINARY 后 = 22 条按阵营 + 3 条通用）。
 * 阵营条的 id == data/monster-factions.json 的阵营 id（也是 MONSTER_BOND_MODS 的键）；归属判据是 map 命中，
 * 不再看 acType / rank / tags。阵营条的 `thresholds` **不写死** —— 按本回合可投放池里该阵营的只数算
 * （见 monsterBondThresholds），所以这里只有 3 条通用条带绝对阈值。
 */
export const MONSTER_BOND_DEFS = [
  // ---- 22 条按阵营（前 20 条顺序 = 0.4.3 factions.json 的 types 顺序；monsterBondIdForEnemy 取第一条命中的） ----
  // 第 21 条「源石协议」= 业主 2026-11-04 新增（源石虫 / 源石造物单独一类），**追加在末尾**：既有 20 条的相对顺序
  // 不变，所以同时命中多阵营的老怪（如 1010_demon = REUNION+SARKAZ）的「第一条命中」与卡面徽标不受影响。
  { id: 'REUNION', name: '整合运动', faction: 'REUNION' },
  { id: 'URSUS', name: '乌萨斯', faction: 'URSUS' },
  { id: 'DEEP_POOL', name: '深池', faction: 'DEEP_POOL' },
  { id: 'VICTORIA', name: '维多利亚', faction: 'VICTORIA' },
  { id: 'SARKAZ', name: '萨卡兹', faction: 'SARKAZ' },
  { id: 'LEITHANIEN', name: '莱塔尼亚', faction: 'LEITHANIEN' },
  { id: 'YAN', name: '大炎', faction: 'YAN' },
  { id: 'SEA_BORN', name: '海嗣', faction: 'SEA_BORN' },
  { id: 'KAZIMIERZ', name: '卡西米尔', faction: 'KAZIMIERZ' },
  { id: 'KJERAG', name: '谢拉格', faction: 'KJERAG' },
  { id: 'SIRACUSA', name: '叙拉古', faction: 'SIRACUSA' },
  { id: 'LATERANO', name: '拉特兰', faction: 'LATERANO' },
  { id: 'IBERIA', name: '伊比利亚', faction: 'IBERIA' },
  { id: 'SIESTA', name: '汐斯塔安保', faction: 'SIESTA' },
  { id: 'SARGON', name: '萨尔贡', faction: 'SARGON' },
  { id: 'BOLIVAR', name: '玻利瓦尔', faction: 'BOLIVAR' },
  { id: 'DURIN', name: '杜林', faction: 'DURIN' },
  { id: 'HIGASHI', name: '东国', faction: 'HIGASHI' },
  { id: 'SAMI', name: '萨米', faction: 'SAMI' },
  { id: 'COLUMBIA', name: '哥伦比亚', faction: 'COLUMBIA' },
  // 第 21 条（业主 2026-11-04 裁决）：源石协议 —— 专收源石虫 / 源石造物系（data 侧 32 只，见 monster-factions.json
  // 的 rules 段第 1 条）。追加在末尾，不插队（见上方「22 条按阵营」注释）。
  { id: 'ORIGINIUM', name: '源石协议', faction: 'ORIGINIUM' },
  // 第 22 条（业主 2026-11-05 裁决）：假想敌协议 —— 「假想敌」SP01–SP18 系列单列成营（enemy_9006…enemy_9023 及其
  // 部件，data 侧 21 只），不再与整合运动 / 源石协议混放。同样**追加在末尾**：既有 21 条的相对顺序不变，
  // 老怪的「第一条命中」与卡面徽标不受影响（IMAGINARY 的 21 只都是单阵营，与老阵营无交集）。
  { id: 'IMAGINARY', name: '假想敌协议', faction: 'IMAGINARY' },
  // ---- 3 条通用 ----
  // 增援：投放只数 ≥ 官方只数 × 1.5（层数 = 投放只数），效果走资金返还
  { id: 'reinforce', name: '增援', thresholds: MONSTER_BOND_THRESHOLDS, classify: null, kind: 'funds' },
  // 会战：同队两名攻方都投放 ≥1 只（层数 = 投过的攻方人数），效果走全队速度乘区
  { id: 'concert', name: '会战', thresholds: MONSTER_BOND_CONCERT_THRESHOLDS, classify: null },
  // 回收：本回合有投放怪漏过（层数 = 漏过只数），效果走资金返还（额外 +50%）
  { id: 'recover', name: '回收', thresholds: MONSTER_BOND_THRESHOLDS, classify: null, kind: 'funds' },
];

/**
 * 效果表（乘区）：每条阵营的「每层增量」与单条上限。`key` 只允许 spawn mods 认的六个键
 * （server/sim/battle/spawns.js 的 `mm()`：hpMul / atkMul / defMul / resMul / speedMul / aspdMul）。
 * 乘数语义 = 1 + Δ（sim 里 `base.maxHp * m.hpMul`），所以 Δ 是**加法叠加**的百分比。
 *
 * 数值依据（写死的是**基线池**口径：data/factions.json 的 confrontPool 120 只，见 monsterPool.js 文件头）：
 *   · 每层 per 按该阵营在这 120 只里的只数 n 给：n ≥ 10 → 0.03，5..9 → 0.04，0..4 → 0.05
 *     （池子小 = 可选牌少，单层给得重一些补偿）；单条上限 cap = 0.3（0.03 要 10 层、0.05 要 6 层到顶）。
 *   · 六个乘区按 n 降序**轮转分配**（hp → atk → def → res → speed → aspd），避免同队多阵营全部堆同一个乘区；
 *     并列时按 MONSTER_BOND_DEFS 的顺序。
 *   · 基线分布（实测）：SARKAZ 19 / COLUMBIA 16 / DEEP_POOL 15 / REUNION 13 / SEA_BORN 9 / YAN 8 / BOLIVAR 8 /
 *     KJERAG 4 / URSUS 3 / SIRACUSA 3 / IBERIA 3 / LATERANO 2 / SIESTA 1 / 其余 7 个阵营 0。
 *   · 2026-11-04 补全 194 条后（map 491/491）基线池的增量只有两处：REUNION 13 → 20（17 只无阵营的里有 7 只落兜底）、
 *     ORIGINIUM 0 → 10（源石虫 2 + 源石植物 2 + 假想敌 6）。既有 20 条的键位与 per **不重排**（重排会改既有阵营的
 *     实机乘区、且与「按本回合池子只数取比例」的阈值口径无关），新阵营按下面 ORIGINIUM 条目的注释取同级值。
 *   · 2026-11-05（业主裁决「假想敌系列独立为 IMAGINARY」）后的基线池 120 只：ORIGINIUM 10 → 4（假想敌 6 只移出），
 *     IMAGINARY 0 → 6；其余阵营不变（REUNION 仍是 20 —— 本次归位的 vt* / mh* / cs* / redace* 都不在这 120 只里）。
 */
export const MONSTER_BOND_MODS = {
  // n=19 → per 0.03，rank0 → hpMul
  SARKAZ: { key: 'hpMul', per: 0.03, cap: 0.3 },
  // n=16 → 0.03，rank1 → atkMul
  COLUMBIA: { key: 'atkMul', per: 0.03, cap: 0.3 },
  // n=15 → 0.03，rank2 → defMul
  DEEP_POOL: { key: 'defMul', per: 0.03, cap: 0.3 },
  // n=13 → 0.03，rank3 → resMul
  REUNION: { key: 'resMul', per: 0.03, cap: 0.3 },
  // n=9 → 0.04，rank4 → speedMul
  SEA_BORN: { key: 'speedMul', per: 0.04, cap: 0.3 },
  // n=8 → 0.04，rank5 → aspdMul
  YAN: { key: 'aspdMul', per: 0.04, cap: 0.3 },
  // n=8 → 0.04，rank6 → hpMul
  BOLIVAR: { key: 'hpMul', per: 0.04, cap: 0.3 },
  // n=4 → 0.05，rank7 → atkMul
  KJERAG: { key: 'atkMul', per: 0.05, cap: 0.3 },
  // n=3 → 0.05，rank8 → defMul
  URSUS: { key: 'defMul', per: 0.05, cap: 0.3 },
  // n=3 → 0.05，rank9 → resMul
  SIRACUSA: { key: 'resMul', per: 0.05, cap: 0.3 },
  // n=3 → 0.05，rank10 → speedMul
  IBERIA: { key: 'speedMul', per: 0.05, cap: 0.3 },
  // n=2 → 0.05，rank11 → aspdMul
  LATERANO: { key: 'aspdMul', per: 0.05, cap: 0.3 },
  // n=1 → 0.05，rank12 → hpMul
  SIESTA: { key: 'hpMul', per: 0.05, cap: 0.3 },
  // n=0 → 0.05，rank13 → atkMul
  VICTORIA: { key: 'atkMul', per: 0.05, cap: 0.3 },
  // n=0 → 0.05，rank14 → defMul
  LEITHANIEN: { key: 'defMul', per: 0.05, cap: 0.3 },
  // n=0 → 0.05，rank15 → resMul
  KAZIMIERZ: { key: 'resMul', per: 0.05, cap: 0.3 },
  // n=0 → 0.05，rank16 → speedMul
  SARGON: { key: 'speedMul', per: 0.05, cap: 0.3 },
  // n=0 → 0.05，rank17 → aspdMul
  DURIN: { key: 'aspdMul', per: 0.05, cap: 0.3 },
  // n=0 → 0.05，rank18 → hpMul
  HIGASHI: { key: 'hpMul', per: 0.05, cap: 0.3 },
  // n=0 → 0.05，rank19 → atkMul
  SAMI: { key: 'atkMul', per: 0.05, cap: 0.3 },
  // 源石协议（业主 2026-11-04 新增，第 21 条）：键按六键轮转**续位** —— rank19 SAMI 是 atkMul，rank20 回到 defMul。
  // per/cap 取「与相邻阵营同级」：末位两条（HIGASHI / SAMI）都是 0.05 / 0.3，本条第 21 条同档，cap 也同是 0.3
  // （cap 相同 ⇒ 到顶层数只由 per 决定：0.05 需 6 层）。
  // 备查（未采用的另一口径）：补全后基线池 120 只里 ORIGINIUM 实测 10 只，若按本文件上面「n ≥ 10 → 0.03」的分档
  // 应给 0.03；业主口径是「不重排既有 20 条、与相邻阵营同级」，故本条取 0.05。要切回 n 分档时只改这一行即可。
  ORIGINIUM: { key: 'defMul', per: 0.05, cap: 0.3 },
  // 假想敌协议（业主 2026-11-05 新增，第 22 条）：键按六键轮转**续位** —— rank20 ORIGINIUM 是 defMul，rank21 回到 resMul。
  // per/cap 取「与相邻阵营同级」：末位三条（HIGASHI / SAMI / ORIGINIUM）都是 0.05 / 0.3，本条同档，cap 也同是 0.3
  // （cap 相同 ⇒ 到顶层数只由 per 决定：0.05 需 6 层）。
  // 备查（未采用的另一口径）：2026-11-05 后的基线池 120 只里 IMAGINARY 实测 6 只，若按本文件上面「n=5..9 → 0.04」
  // 的分档应给 0.04；业主口径是「不重排既有条目、与相邻阵营同级」，故本条取 0.05。要切回 n 分档时只改这一行即可。
  IMAGINARY: { key: 'resMul', per: 0.05, cap: 0.3 },
};

const defById = new Map(MONSTER_BOND_DEFS.map((d) => [d.id, d]));

/**
 * 盟约图标（2026-11-05：25 条盟约各自一个图标 —— 此前每条都画同一个骷髅）。
 * 这张表只收**有官方素材**的 14 个阵营：键 = `data/assets.json` 的 `ui` 键（`campLogo/logo_*`）。
 *
 * **2026-11-05 真机修复**：此前 URL 是运行时从 `m.data.assets.ui` 现取，但真机 Match 上拿不到资产清单
 * （`m.data.assets` 为空 / 不存在），实测 14 条官方徽标全部退化成 `glyph:'skull'`。现在改成按**确定的 URL 模式**
 * 直接拼：`/assets/ui/` + key + `.png`（`campLogo/logo_ursus` → `/assets/ui/campLogo/logo_ursus.png`，
 * 与 `data/assets.json` 里这 14 条的值逐字一致），不依赖运行时清单；有清单时仍优先用清单值（见 bondIconUrlOf）。
 *
 * 映射按「同名阵营」逐一对照，**不做就近硬套** —— `logo_egir`（阿戈尔）**不**给 SEA_BORN（海嗣）；`logo_lungmen`
 * （龙门）/ `logo_minos`（米诺斯）/ `logo_rhodes`（罗德岛）/ `logo_rim`（雷姆必拓）在本模式没有对应阵营，一律不取用。
 */
export const MONSTER_BOND_ICON = Object.freeze({
  URSUS: 'campLogo/logo_ursus',
  VICTORIA: 'campLogo/logo_victoria',
  LEITHANIEN: 'campLogo/logo_leithanien',
  YAN: 'campLogo/logo_yan',
  KAZIMIERZ: 'campLogo/logo_kazimierz',
  KJERAG: 'campLogo/logo_kjerag',
  SIRACUSA: 'campLogo/logo_siracusa',
  LATERANO: 'campLogo/logo_laterano',
  IBERIA: 'campLogo/logo_iberia',
  SARGON: 'campLogo/logo_sargon',
  BOLIVAR: 'campLogo/logo_bolivar',
  HIGASHI: 'campLogo/logo_higashi',
  SAMI: 'campLogo/logo_sami',
  COLUMBIA: 'campLogo/logo_columbia',
});

/**
 * 没有官方素材的 8 个阵营 + 3 条通用 → 客户端内联 SVG 字形（`client/js/ui/gameComponents.js` 的 GLYPHS 里那 11 条
 * `mb-*`，原创形状，不抄官方 logo）。服务端只下发名字，画法在客户端。
 */
export const MONSTER_BOND_GLYPH = Object.freeze({
  REUNION: 'mb-reunion',
  DEEP_POOL: 'mb-deeppool',
  SARKAZ: 'mb-sarkaz',
  SEA_BORN: 'mb-seaborn',
  SIESTA: 'mb-siesta',
  DURIN: 'mb-durin',
  ORIGINIUM: 'mb-originium',
  IMAGINARY: 'mb-imaginary',
  reinforce: 'mb-reinforce',
  concert: 'mb-concert',
  recover: 'mb-recover',
});

/** 两张表都漏掉的 id（将来新增阵营没配图标）回落老图标，帧形状不变。 */
const MONSTER_BOND_GLYPH_FALLBACK = 'skull';

/** 官方营地徽标 URL 的固定前缀：`data/assets.json` 的 `ui` 块里 19 条 campLogo 全是 `/assets/ui/<key>.png`。 */
const MONSTER_BOND_ICON_BASE = '/assets/ui/';

/**
 * 某条盟约的官方素材 URL（14 个有官方徽标的阵营；没有 = null）。
 *
 * 路径是**确定的模式**（`campLogo/logo_<slug>` → `/assets/ui/campLogo/logo_<slug>.png`），所以**先拼**：
 * 真机 Match 上 `m.data.assets` 拿不到（实测为空 / 不存在），只靠清单会让 14 条官方徽标全退化成 skull。
 * 清单**有**才用它（资产表改名 / 换 CDN 前缀时以清单为准）：
 *   · `m.data.assets`（Match 的 `this.data` = getData() 的产物，`assets` 是 server/data.js DATA_FILES 之一）；
 *   · 直测 / stub 只给了 `m.gd` 时退回 `m.gd.raw.assets`（与上面 monsterFactionData 的懒取口径一致）。
 * @param {object} m @param {string} id
 * @returns {string|null}
 */
function bondIconUrlOf(m, id) {
  const key = MONSTER_BOND_ICON[id];
  if (!key) return null;
  const assets = (m && m.data && m.data.assets) || (m && m.gd && m.gd.raw && m.gd.raw.assets) || null;
  const ui = assets && typeof assets === 'object' ? assets.ui : null;
  const url = ui && typeof ui === 'object' ? ui[key] : null;
  if (typeof url === 'string' && url) return url;
  // 清单拿不到（真机常态）→ 按固定模式拼，保证这一行一定有 URL。
  return MONSTER_BOND_ICON_BASE + key + '.png';
}

/** 阵营条的三阶阈值比例（层数 = 本回合投放只数 n；见 factionThresholdsOf）。 */
export const MONSTER_BOND_FACTION_THRESHOLD_SHARES = Object.freeze([0.15, 0.3, 0.45]);

/**
 * 本回合「买得下几只」= 一名攻方的军费 ÷ 池中位价（至少 1）。**盟约一阶的上界**。
 *
 * 业主 2026-11-06 裁决（审计 PENDING 第 4 条）：阵营条阈值按「该阵营在整张池里的只数」取比例，池是 408 只的
 * 全表 ⇒ REUNION 一阶要 14 只，而 R1 每人军费只有 5 —— 一阶点不亮，等于这条盟约在前期**根本不存在**。
 * 现在一阶被压到「本回合真能买下的只数」以内，二 / 三阶仍是长期目标（严格递增）。
 *
 * 商店关着 / 拿不到军费或中位价（旧对局、非对抗局）⇒ `Infinity` = 不设上界，行为与改造前逐字节一致。
 * @param {object} m
 * @returns {number}
 */
function roundAffordableUnits(m) {
  try {
    const share = typeof m?.monsterFundsSharePerAttacker === 'function' ? Number(m.monsterFundsSharePerAttacker()) : NaN;
    const price = typeof m?.confrontPoolMedianValue === 'function' ? Number(m.confrontPoolMedianValue()) : NaN;
    if (!Number.isFinite(share) || !Number.isFinite(price) || price <= 0) return Infinity;
    return Math.max(1, Math.floor(share / price));
  } catch { return Infinity; }
}

/**
 * 阵营条的阈值（按该阵营在本回合可投放池里的**只数** n 取比例）：纯函数。
 *   t1 = max(1, ceil(n × 0.15))，t2 = max(t1+1, ceil(n × 0.30))，t3 = max(t2+1, ceil(n × 0.45))
 * 严格递增（`max(t1+1, …)`）保证三阶不会塌成同一层；n = 0 → [1,2,3]（形态占位，该阵营本回合无牌）。
 * @param {number} poolCount 该阵营在本回合可投放池里的只数
 * @returns {number[]} 三阶阈值
 */
export function factionThresholdsOf(poolCount) {
  const n = Math.max(0, Math.floor(Number(poolCount) || 0));
  const [s1, s2, s3] = MONSTER_BOND_FACTION_THRESHOLD_SHARES;
  const t1 = Math.max(1, Math.ceil(n * s1));
  const t2 = Math.max(t1 + 1, Math.ceil(n * s2));
  const t3 = Math.max(t2 + 1, Math.ceil(n * s3));
  return [t1, t2, t3];
}

/**
 * 每个阵营在**商店卡池**里的只数（阈值分母）。来源与建池同口径：`monsterPoolKeys(m)`
 * （`data/enemies.json` 全表 − tokenOnly − BOSS + 本回合官方成员保证，实测 408 只），每 key 记 1 只。
 *
 * 业主 2026-11-05 改分母：旧口径用 `monsterCardKeys(m)`（对抗档 = 本回合官方出怪），实测 R1–R13 只有 7 个 key /
 * 3 个阵营 ⇒ 19 个阵营分母恒 0（阈值退化常量 [1,2,3]）而它们的卡在商店池里能买；REUNION / SARKAZ 反被推到
 * 6 / 12 / 18 只才 1/2/3 阶。现在分母 = 玩家真能买到的那张表（池 + 阶位），与「能不能投放」同源。
 * 缓存挂在 match 上：官方快照（成员保证会往里补 key）的**引用**或回合号一变就失效。
 * @param {object} m
 * @returns {Map<string, number>} 阵营 id → 只数（无阵营的 key 不计）
 */
function factionPoolCounts(m) {
  if (!m) return new Map();
  const official = Array.isArray(m._roundOfficialSpawns) && m._roundOfficialSpawns.length ? m._roundOfficialSpawns : null;
  const stamp = official || null;
  const cache = m._bondFactionPool;
  if (cache && cache.stamp === stamp && cache.round === m.round) return cache.counts;
  let keys = [];
  try { keys = monsterPoolKeys(m) || []; } catch { keys = []; }
  const counts = new Map();
  for (const key of keys) {
    const ids = monsterFactionIds(m.gd, key);
    if (!ids.length) continue;
    // 分母是「池里有多少只**可买的卡**」：每 key 1 只（不再乘官方合计只数 —— 那是旧口径的加权）。
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1);
  }
  m._bondFactionPool = { stamp, round: m.round, counts };
  return counts;
}

/**
 * 某条盟约的阈值表：阵营条按本回合池子动态算，通用条用定义上的绝对阈值。
 * @param {object} m @param {string} id
 * @returns {number[]}
 */
export function monsterBondThresholds(m, id) {
  const d = defById.get(id);
  if (!d) return MONSTER_BOND_THRESHOLDS;
  if (Array.isArray(d.thresholds) && d.thresholds.length) return d.thresholds;
  const counts = factionPoolCounts(m);
  const [t1, t2, t3] = factionThresholdsOf(counts.get(d.id) || 0);
  // 一阶压进「本回合买得下」（业主 2026-11-06 第 4 条；见 roundAffordableUnits）。二 / 三阶保持严格递增的长期目标。
  const cap = roundAffordableUnits(m);
  if (!Number.isFinite(cap)) return [t1, t2, t3];
  const c1 = Math.max(1, Math.min(t1, cap));
  const c2 = Math.max(c1 + 1, t2);
  return [c1, c2, Math.max(c2 + 1, t3)];
}

/** 内部别名（旧调用点少写一个参数名）。 */
function thresholdsOf(m, id) { return monsterBondThresholds(m, id); }

/**
 * 层数 → 阶（tier）：达到几个阈值就是几阶（0 = 未激活）。纯函数。
 * @param {number} layers @param {number[]} [thresholds]
 * @returns {number} 0..thresholds.length
 */
export function monsterBondTier(layers, thresholds = MONSTER_BOND_THRESHOLDS) {
  const n = Math.max(0, Number(layers) || 0);
  let tier = 0;
  for (const th of thresholds) if (Number.isFinite(th) && n >= th) tier += 1;
  return tier;
}

/**
 * 攻方回合的角色判据（三处服务端闸门共用）：本回合是攻守回合**且**这个席位属于进攻方。
 * R14/R15 这类 `attackingTeam == null` 的回合 `m.isAttacker` 自带保护（infra.js），这里再用 `isRoleRound()`
 * 兜一道 —— **不要**改写成 `!isDefender`（非攻守回合两者都是 false）。
 * @param {object} m @param {object} ps
 * @returns {boolean}
 */
export function isAttackerRound(m, ps) {
  if (!m || !ps) return false;
  if (typeof m.isRoleRound !== 'function' || m.isRoleRound() !== true) return false;
  return typeof m.isAttacker === 'function' && m.isAttacker(ps) === true;
}

/**
 * 盟约状态的归属键：与怪物池（monsterPool.js monsterPoolFor）**同口径** ——
 * solo 按人（playerId）、shared / master 按队（teamId；master 只是投放权单人，资源仍是队级）。
 * 取不到时回落 0（与池的 `: 0` 一致）。
 */
export function monsterBondKey(m, ps) {
  if (!m || !ps) return null;
  if (m.monsterMode === 'solo') return ps.playerId != null ? ps.playerId : 0;
  return typeof m.teamIdOf === 'function' ? m.teamIdOf(ps) : 0;
}

/** 全席位（m.order 是数组；StubMatch / 直测可能只给 Map）。 */
function allPlayers(m) {
  if (Array.isArray(m && m.order)) return m.order;
  if (m && m.players instanceof Map) return [...m.players.values()];
  return [];
}

/**
 * 一只怪属于哪几条**阵营**盟约（可同时属于多条，例如 1010_demon 同时是 REUNION 与 SARKAZ）。
 * 判据 = `data/monster-factions.json` 的 map 命中，不看敌人属性。纯数据查询，不抛异常。
 * @param {object} gd GameData（用 gd.raw）/ 或用 gd.enemy(key) 的 stub（会回落到 getData() 单例）
 * @param {string} enemyKey
 * @returns {string[]} 盟约 id 列表（顺序 = MONSTER_BOND_DEFS，便于稳定取「第一条」）
 */
export function monsterBondIdsOf(gd, enemyKey) {
  const ids = new Set(monsterFactionIds(gd, enemyKey));
  if (!ids.size) return [];
  const out = [];
  for (const def of MONSTER_BOND_DEFS) if (def.faction && ids.has(def.id)) out.push(def.id);
  return out;
}

/**
 * 一只怪属于**第一条**阵营盟约（商店卡面的小徽标用；业主 2026-11-04 报障：卡片要显示名称与怪物盟约）。
 * 顺序 = MONSTER_BOND_DEFS（同时命中多个阵营时取第一条命中的）；3 条通用（增援 / 会战 / 回收）不参与 ——
 * 它们不是怪物本身的属性。命不中（map 未覆盖这只怪）→ null。
 * @param {object} gd GameData / stub @param {string} enemyKey
 * @returns {string|null} 盟约 id（'REUNION' / 'SARKAZ' …）
 */
export function monsterBondIdForEnemy(gd, enemyKey) {
  const ids = monsterBondIdsOf(gd, enemyKey);
  return ids.length ? ids[0] : null;
}

/**
 * 盟约 id → 显示名（'REUNION' → '整合运动'）。未知 id 原样返回（调用方只管显示，不做判据）；空 → null。
 * @param {string|null} id
 * @returns {string|null}
 */
export function monsterBondName(id) {
  if (typeof id !== 'string' || !id) return null;
  const def = defById.get(id);
  return def ? def.name : id;
}

/** 本回合的盟约记录（懒建）。空记录 = `{ round, layers:{}, placed:0, cost:0, byPlayer:{} }`。 */
export function monsterBondState(m, ps) {
  const key = monsterBondKey(m, ps);
  if (key == null) return null;
  if (!(m.monsterBonds instanceof Map)) m.monsterBonds = new Map();
  let st = m.monsterBonds.get(key);
  if (!st) {
    st = { round: Number(m.round) || 0, layers: {}, placed: 0, cost: 0, byPlayer: {} };
    m.monsterBonds.set(key, st);
  }
  return st;
}

/** 某席位当前的盟约记录（没有就 null，**不建**）。 */
function recordOf(m, ps) {
  if (!m || !(m.monsterBonds instanceof Map)) return null;
  const key = monsterBondKey(m, ps);
  return key == null ? null : (m.monsterBonds.get(key) || null);
}

/**
 * 投放涨层（monsterShop.js 的 placeMonster / buyMonster 成功后调用）：该怪命中的**阵营盟约**各 + 投放只数，
 * 通用「增援」也按投放只数累加；同时记下总只数 / 总花费 / 每名攻方投了几只（会战与资金分摊要用）。
 * 只算**攻方投放的怪**（官方波次不进这里）。
 * @param {object} m @param {object} ps
 * @param {{ enemyKey: string, count?: number, price?: number }} placement
 * @returns {{ ids: string[], layers: object }|null} null = 商店关着 / 参数不对
 */
export function addMonsterBonds(m, ps, { enemyKey, count = 1, price = 0 } = {}) {
  if (!m || m.monsterShopOn !== true || !ps) return null;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!(n > 0)) return null;
  const st = monsterBondState(m, ps);
  if (!st) return null;
  const ids = monsterBondIdsOf(m.gd, enemyKey);
  for (const id of ids) st.layers[id] = Math.max(0, Number(st.layers[id]) || 0) + n;
  st.layers.reinforce = Math.max(0, Number(st.layers.reinforce) || 0) + n;
  st.placed = Math.max(0, Number(st.placed) || 0) + n;
  st.cost = Math.max(0, Number(st.cost) || 0) + Math.max(0, Number(price) || 0) * n;
  st.byPlayer[ps.playerId] = Math.max(0, Number(st.byPlayer[ps.playerId]) || 0) + n;
  return { ids, layers: st.layers };
}

/**
 * 撤回（monsterShop.js 的 dropMonster）：把那一只的层数 / 只数 / 花费退回去（下限 0）。**不追回已发的资金**
 * （资金只在回合收尾发一次，届时按最终口径算）。
 * @param {object} m @param {object} ps @param {string} enemyKey @param {number} [count]
 * @returns {object|null} 新的 layers
 */
export function dropMonsterBonds(m, ps, enemyKey, count = 1) {
  if (!m || m.monsterShopOn !== true || !ps) return null;
  const st = recordOf(m, ps);
  if (!st) return null;
  const n = Math.max(0, Math.floor(Number(count) || 0));
  if (!(n > 0)) return null;
  const ids = monsterBondIdsOf(m.gd, enemyKey);
  for (const id of ids.concat('reinforce')) st.layers[id] = Math.max(0, (Number(st.layers[id]) || 0) - n);
  const before = Math.max(0, Number(st.placed) || 0);
  const placed = Math.max(0, before - n);
  // 花费按撤回前的均价退（总价 / 总只数），退到 0 为止
  const avg = before > 0 ? (Number(st.cost) || 0) / before : 0;
  st.cost = Math.max(0, (Number(st.cost) || 0) - avg * n);
  st.placed = placed;
  const mine = Math.max(0, Number(st.byPlayer[ps.playerId]) || 0);
  st.byPlayer[ps.playerId] = Math.max(0, mine - n);
  return st.layers;
}

/**
 * 本回合「投放怪漏过 **by 归属键**」的快照（2026-11-04 复验修复 3：回收盟约恒发 0）。
 *
 * 为什么需要它：`settle()` 在**发完攻方奖励之后**就把 `this.fields` 清掉了（match/match/settle.js:238），
 * 而回合边界（match/match/phases.js:472 的 `closeMonsterBondRound`）必然在 settle 之后才跑 ——
 * 那时 `leaksForKey` 直接读 `this.fields` 只能读到 `[]`，实测「回收」盟约发放恒为 0。
 * 修法（B 的变体）：在 settle 里**清 fields 之前**把漏怪数钉成快照，回合边界只读这份快照。
 * 触发点不在 settle.js（不在本次改动清单内），而是 settle 已经在调的两个允许文件入口：
 *   · `monsterShop.js` 的 `addMonsterFundsTo`（settle 的击杀 / 漏过奖励经 Match.js 改道到这里；shared 模式）；
 *   · `match/match/confront.js` 的 `monsterShopOn` getter（settle.js:112 的闸门；两种怪物模式都会读，补 solo 的缺口）。
 * 快照只在 `this.fields` 非空、且至少一场结果已就绪时写：settle 清空之后（以及下一回合 PREP 里）的调用一律 no-op，
 * 不会把好数据覆盖成 0。
 * @param {object} m
 * @returns {{ round: number, leaks: Map<any, number> }|null} 当前生效的快照
 */
export function captureMonsterBondLeaks(m) {
  // 注意：**不能**读 m.monsterShopOn —— 本函数会从 monsterShopOn 之外的两个入口被调，
  // 而其中的 getter 若也调本函数就会自递归。这里用同一个判据的直接写法（与 confront.js 的 getter 等价）。
  if (!m || m.isVersus !== true || (m.opts && m.opts.monsterShop === false)) return null;
  if (!Array.isArray(m.fields) || !m.fields.length) return m._bondRoundStats || null;
  const byKey = new Map();
  const players = allPlayers(m);
  let saw = false;
  for (const f of m.fields) {
    // 与 settle.js 的 placedFieldResult 同一取源：优先 f.result，没有就问 battle.result()（clientCombat / 直测）
    let fr = f && f.result;
    if (!fr && f && f.battle && typeof f.battle.result === 'function') {
      try { fr = f.battle.result(); } catch { fr = null; }
    }
    if (!fr || typeof fr !== 'object') continue;
    saw = true;
    const leaks = fr.confrontLeaks;
    if (!leaks || typeof leaks !== 'object') continue;
    for (const [seatStr, v] of Object.entries(leaks)) {
      const owner = players.find((x) => x && x.seat === Number(seatStr));
      if (!owner) continue;
      const key = monsterBondKey(m, owner);
      if (key == null) continue;
      byKey.set(key, (byKey.get(key) || 0) + Math.max(0, Number(v) || 0));
    }
  }
  // 一场结果都还没出来（战斗进行中 / fields 只是占位）→ 不覆盖已钉好的快照，也不凭空写一份空快照
  if (!saw) return m._bondRoundStats || null;
  m._bondRoundStats = { round: Number(m.round) || 0, leaks: byKey };
  return m._bondRoundStats;
}

/**
 * 本回合某个归属键下**投放怪漏过**的只数：优先读 `captureMonsterBondLeaks` 钉下的快照（settle 清 fields 之前），
 * 没有快照（例如战斗还没打完）才回落到 `m.fields` 的 `confrontLeaks`（sim/battle/lifecycle.js 按**投放席位**汇总）。
 */
function leaksForKey(m, key) {
  const snap = m && m._bondRoundStats;
  if (snap && snap.leaks instanceof Map) return Math.max(0, Number(snap.leaks.get(key)) || 0);
  if (!Array.isArray(m && m.fields) || !m.fields.length) return 0;
  const players = allPlayers(m);
  let n = 0;
  for (const f of m.fields) {
    const fr = (f && f.result) || null;
    const leaks = fr && fr.confrontLeaks;
    if (!leaks || typeof leaks !== 'object') continue;
    for (const [seatStr, v] of Object.entries(leaks)) {
      const owner = players.find((x) => x && x.seat === Number(seatStr));
      if (!owner) continue;
      if (monsterBondKey(m, owner) !== key) continue;
      n += Math.max(0, Number(v) || 0);
    }
  }
  return n;
}

/** 本席归属键下投放怪漏过的只数（视图与收尾共用）。 */
export function monsterBondLeaks(m, ps) {
  if (!m || m.monsterShopOn !== true) return 0;
  const key = monsterBondKey(m, ps);
  return key == null ? 0 : leaksForKey(m, key);
}

/** 本回合官方出怪的**合计只数**（增援的 1.5 倍基准；没有快照 → 0 = 增援不成立）。 */
function officialTotalCount(m) {
  const counts = officialSpawnCounts(m);
  if (!counts) return 0;
  let n = 0;
  for (const v of counts.values()) n += Math.max(0, Number(v) || 0);
  return n;
}

/**
 * 本席此刻的盟约层数（含通用条：增援 = 投放只数、会战 = 投过的攻方人数、回收 = 漏过只数）。
 * @returns {Object<string, number>}
 */
export function monsterBondLayers(m, ps) {
  const st = recordOf(m, ps);
  const out = {};
  if (!st) return out;
  for (const def of MONSTER_BOND_DEFS) {
    let n = 0;
    if (def.id === 'concert') {
      const byPlayer = st.byPlayer || {};
      n = Object.keys(byPlayer).filter((pid) => (Number(byPlayer[pid]) || 0) > 0).length;
    } else if (def.id === 'recover') {
      n = monsterBondLeaks(m, ps);
    } else {
      n = Math.max(0, Number(st.layers[def.id]) || 0);
    }
    if (n > 0) out[def.id] = n;
  }
  return out;
}

/**
 * 本席此刻的怪物盟约**乘区乘数**（供 spawn 的 mods 用）：`{ hpMul: 1.12, atkMul: 1.09, speedMul: 1.05, aspdMul: 1.15 }`。
 * 没有盟约 / 商店关着 → null（调用方原样返回 roundMods 的对象）。
 * @param {object} m @param {object} ps 投放者（applyConfront 里由 sub 反查到的攻方）
 * @returns {Object<string, number>|null}
 */
export function monsterBondMods(m, ps) {
  if (!m || m.monsterShopOn !== true || !ps) return null;
  const st = recordOf(m, ps);
  if (!st) return null;
  const delta = {};
  for (const [id, cfg] of Object.entries(MONSTER_BOND_MODS)) {
    const layers = Math.max(0, Number(st.layers[id]) || 0);
    if (!(layers > 0)) continue;
    const add = Math.min(cfg.cap, cfg.per * layers);
    if (add > 0) delta[cfg.key] = (delta[cfg.key] || 0) + add;
  }
  // 会战：同队两名攻方都投过 ≥1 只 → 全队速度 +5%（一阶；更上层数由 concert 的阈值决定，效果仍是这一个固定值）
  const placing = Object.keys(st.byPlayer || {}).filter((pid) => (Number(st.byPlayer[pid]) || 0) > 0).length;
  if (monsterBondTier(placing, thresholdsOf(m, 'concert')) > 0) delta.speedMul = (delta.speedMul || 0) + MONSTER_BOND_CONCERT_BONUS;
  const keys = Object.keys(delta);
  if (!keys.length) return null;
  const out = {};
  for (const k of keys) out[k] = 1 + delta[k];
  return out;
}

/**
 * 把盟约乘区**乘**到 spawn mods 上（`roundMods` 的既有键不动，只乘不覆盖）。
 * @param {object} mods roundMods 的结果（可能已带 supplyHpMul 等） @param {object|null} bondMods monsterBondMods
 * @returns {object} 新的 mods 对象（bondMods 为 null 时原样返回）
 */
export function mergeMonsterBondMods(mods, bondMods) {
  if (!bondMods) return mods;
  const out = { ...mods };
  for (const [k, mul] of Object.entries(bondMods)) {
    const cur = Number(out[k]);
    out[k] = (Number.isFinite(cur) && cur > 0 ? cur : 1) * mul;
  }
  return out;
}

/**
 * 私有帧 `m.monsterShop.bonds` 的载荷：`[{ id, name, layers, tier, active, icon?|glyph? }]`，空则返回 null（帧里省略
 * 该字段，保持老帧形状）。层数语义见 monsterBondLayers（含三条通用）。
 *
 * 图标（2026-11-05）：14 个有官方素材的阵营多下 `icon`（`/assets/ui/campLogo/logo_*.png`，**按固定模式直接拼**，
 * 不依赖 `m.data.assets` —— 真机 Match 拿不到清单时会拼；有清单则用清单值，见 bondIconUrlOf）；
 * 其余 8 个阵营 + 3 条通用下 `glyph`（客户端 GLYPHS 的 `mb-*` 名，见 MONSTER_BOND_GLYPH）。两组**互斥**：
 * 有 icon 就不发 glyph，客户端按 `b.icon` 优先渲染（老客户端忽略这两个新键，照旧画骷髅）。
 * 两条表都漏掉的 id 回落 `glyph:'skull'`（只有兜底路径会走到，不丢行）。
 */
export function monsterBondView(m, ps) {
  if (!m || m.monsterShopOn !== true) return null;
  const layers = monsterBondLayers(m, ps);
  const rows = [];
  for (const def of MONSTER_BOND_DEFS) {
    const n = Math.max(0, Number(layers[def.id]) || 0);
    if (!(n > 0)) continue;
    const tier = monsterBondTier(n, thresholdsOf(m, def.id));
    const row = { id: def.id, name: def.name, layers: n, tier, active: tier > 0 };
    const icon = bondIconUrlOf(m, def.id);
    if (icon) row.icon = icon;
    else row.glyph = MONSTER_BOND_GLYPH[def.id] || MONSTER_BOND_GLYPH_FALLBACK;
    rows.push(row);
  }
  return rows.length ? rows : null;
}

/**
 * 回合收尾（phases.js 的回合边界）：把资金类盟约（增援 / 回收）按本回合最终口径发给投放者，然后清空
 * `m.monsterBonds`（每回合重置）。
 * 漏怪数读 `captureMonsterBondLeaks` 在 settle 里钉下的快照（`m._bondRoundStats`）—— settle 结尾会清 `m.fields`
 * （settle.js:238），所以这里读不到 fields 本身（2026-11-04 复验修复 3：此前「回收」恒发 0）。
 * 同队共享池时按各人投放只数的比例分摊。
 * @param {object} m
 * @returns {number} 实际发出的怪物资金总额
 */
export function closeMonsterBondRound(m) {
  if (!m || m.monsterShopOn !== true) return 0;
  const map = m.monsterBonds;
  if (!(map instanceof Map) || !map.size) { m.monsterBonds = null; m._bondRoundStats = null; return 0; }
  const players = allPlayers(m);
  const official = officialTotalCount(m);
  let paid = 0;
  for (const [key, rec] of map) {
    if (!rec || typeof rec !== 'object') continue;
    const mine = players.filter((ps) => ps && ps.alive !== false && (Number(rec.byPlayer[ps.playerId]) || 0) > 0 && monsterBondKey(m, ps) === key);
    if (!mine.length) continue;
    const totalPlaced = mine.reduce((n, ps) => n + (Number(rec.byPlayer[ps.playerId]) || 0), 0) || Math.max(0, Number(rec.placed) || 0);
    const shareOf = (ps) => (totalPlaced > 0 ? (Number(rec.byPlayer[ps.playerId]) || 0) / totalPlaced : 1 / mine.length);
    const pay = (ps, amount) => {
      const v = Math.max(0, Math.round(Number(amount) || 0));
      if (!(v > 0)) return;
      ps.monsterEarned = Math.max(0, Number(ps.monsterEarned) || 0) + v;
      // 账户走访问器（业主 2026-11-04 裁决 2）：shared 进队级账户（同队成员镜像同步），solo 进个人账户。
      addMonsterFundsTo(m, ps, v);
      paid += v;
    };
    // 增援：超出「官方只数 × 1.5」的部分按均价 ×20% 返还（× 层数档倍率）
    const placed = Math.max(0, Number(rec.placed) || 0);
    const surplus = Math.max(0, placed - official * MONSTER_BOND_SURPLUS_SHARE);
    const tierR = monsterBondTier(Math.max(0, Number(rec.layers.reinforce) || 0), thresholdsOf(m, 'reinforce'));
    if (surplus > 0 && tierR > 0) {
      const avg = placed > 0 ? (Number(rec.cost) || 0) / placed : 0;
      const amount = surplus * avg * MONSTER_BOND_SURPLUS_REFUND * (MONSTER_BOND_TIER_MUL[tierR] || 1);
      for (const ps of mine) pay(ps, amount * shareOf(ps));
    }
    // 回收：settle 已经按 monsterLeakReward(单价) 发过全额，这里只发「额外 +50%」
    // （2026-11-06 价值同源：基准奖励改从 monsterShop.monsterLeakReward 现算，不再读全局常数）。
    const leaked = leaksForKey(m, key);
    const tierV = monsterBondTier(leaked, thresholdsOf(m, 'recover'));
    if (leaked > 0 && tierV > 0) {
      const perLeak = monsterLeakReward(MONSTER_LEAK_REWARD_REF_PRICE);
      const amount = leaked * perLeak * MONSTER_BOND_LEAK_EXTRA * (MONSTER_BOND_TIER_MUL[tierV] || 1);
      for (const ps of mine) pay(ps, amount * shareOf(ps));
    }
  }
  m.monsterBonds = null;
  // 快照按回合消费一次：清掉之后本回合的漏怪数不会再被下一回合误读（下一回合的 settle 会重新钉一份）。
  m._bondRoundStats = null;
  return paid;
}
