// Shared enums & constants (server + browser). Pure ESM, no Node APIs.

import { N_ } from './i18n.js';

export const PROTOCOL_VERSION = 1;
/** Release version shown to players (title screen, server banner, /healthz). Kept equal to package.json "version"
 * (test/version.test.js); PROTOCOL_VERSION above is the separate wire-format number. */
export const APP_VERSION = '0.3.3';
/** A development build (the public `dev` branch): the title screen, the boot banner and the README say so, and
 * tools/package.mjs refuses to build a release zip from it without --allow-dev. */
export const DEV_BUILD = /-dev$/.test(APP_VERSION);
/**
 * The plugin API levels this build supports (DESIGN §32, shared/plugins/manifest.js): a manifest 2 states the level it
 * is written for (`api`); a level outside min…current keeps the plugin out. The level rises when the data shapes, the
 * DSL vocabulary or the SDK a plugin relies on change incompatibly (CHANGELOG says how to migrate). Level 2 adds the
 * declarative `offers` part (docs/PLUGINS.md): a manifest that uses it states `"api": 2`, and a build that knows only
 * level 1 refuses that plugin instead of loading it without the part. [ASSUMED]
 */
export const PLUGIN_API = Object.freeze({ current: 2, min: 1 });

// 座位上限：原版 4。放开到 20（20 人方案阶段 1）。
// DEFAULT_SEATS 是「默认房间大小」——UI 的「人数上限」只在 MAX_SEATS > DEFAULT_SEATS 时出现。
/** 0.4.3 sim 需要的基准座位数（一个商店池多少人）；比例规则一律按 `players / BASE_SEATS` 计，不按 MAX_SEATS。 */
export const BASE_SEATS = 4;
export const MAX_SEATS = 20;
export const DEFAULT_SEATS = 4;
/** 分队（阶段 2）：4 个颜色组，每组最多 TEAM_MAX 人 */
export const TEAMS = Object.freeze(['red', 'yellow', 'blue', 'green']);
export const TEAM_NAMES = Object.freeze({ red: '红队', yellow: '黄队', blue: '蓝队', green: '绿队' });
export const TEAM_MAX = 5;
/**
 * Spectator seats of a co-op room (community report #26, owner's decision 2026-10-04) — a remake feature: the official
 * room has 1–4 players and no spectator seat (there only eliminated players and 联防 bystanders watch, research 09 §3.1).
 * A spectator never counts as a player, may not act, and watches like an eliminated player (server/lobby.js spectate,
 * server/match/match/watch.js addSpectator).
 */
// 观战席上限（2026-10-23 业主口径：默认不限）。SP_MAX_SPECTATORS 可设正整数收窄；
// 浏览器侧没有 process，取默认 Infinity —— 显示端对非有限值不渲染「/N」。
export const MAX_SPECTATORS = (() => {
  const raw = typeof process !== 'undefined' && process.env ? Number(process.env.SP_MAX_SPECTATORS) : NaN;
  return Number.isInteger(raw) && raw > 0 ? raw : Infinity;
})();
/** 房间简介最大长度（码点）：协议层 room.setDesc 校验与服务端 cleanRoomDesc 共用一个数。 */
export const ROOM_DESC_MAX = 60;
/** 可选房间档位：3 的倍数（12 = 三组各 4 人，分队刚好满员），4 是原版基准，20 是房间上限。 */
export const ROOM_CAPACITIES = Object.freeze([4, 8, 12, 16, 20]);
/** 商店池分队的显示名（按 1 起的 pool id）；20 席最多 5 组，其余是余量。 */
export const SQUAD_NAMES = Object.freeze(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta']);
/** 一局发牌的最大张数 = 最大 g.choice 下标 + 1（20 席发 22 张 → 上限 22）。 */
export const MAX_DRAFT_CARDS = MAX_SEATS + 2;
/** 摊还拦截 (联防) 提前撤离所需的存活玩家同意比例。 */
export const UNITE_ABANDON_RATIO = 0.8;
export const ROOM_CODE_LEN = 4;
export const NAME_MAX_LEN = 12;

// 难度档（2026-11-02，业主：共 20 档替换原来的 4 档，以 4 档为基准）。
//   · `DIFFICULTY_TIERS` = 界面上可选的全部 20 档；`DIFFICULTIES` 就是它（协议/大厅/版本/内容集都读这个）；
//   · 旧 4 档（FUNNY/NORMAL/HARD/ABYSS）作为**兼容别名**保留：协议仍接受、数据里仍有对应 mode 记录，
//     但不再出现在选择器里 —— 老房间、老客户端、历史统计都不会炸；
//   · 锚点关系：N1=FUNNY、N8=NORMAL、N14=HARD、N20=ABYSS（`tools/build-nmodes.mjs` 按这四点插值生成数据）。
export const LEGACY_DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
export const DIFFICULTY_TIERS = Array.from({ length: 20 }, (_, i) => `N${i + 1}`);
export const DIFFICULTIES = [...DIFFICULTY_TIERS];
/**
 * 2026-11-03 业主：N1–N20 只属于肉鸽；标准/同盟/对抗/协同共竞仍用旧 4 档。
 * 协议层继续同时接受两套（老房间 / 老客户端 / 历史统计不炸），选择器与大厅/版本校验读这张表。
 */
export const difficultiesFor = (roomMode) => (roomMode === 'rogue' ? DIFFICULTY_TIERS : LEGACY_DIFFICULTIES);
/** 旧档名 → 新档（只在需要「同一难度」语义的地方用：默认档、统计归并）。 */
export const LEGACY_DIFFICULTY_ALIAS = Object.freeze({ FUNNY: 'N1', NORMAL: 'N8', HARD: 'N14', ABYSS: 'N20' });
const LEGACY_NAMES = { FUNNY: N_('标准模拟'), NORMAL: N_('险境模拟'), HARD: N_('绝境模拟'), ABYSS: N_('终极模拟') };
const LEGACY_COLORS = { FUNNY: '#f6a329', NORMAL: '#e85a1a', HARD: '#e73118', ABYSS: '#ff0024' };
/** 20 档的色阶：在 4 个锚点颜色之间线性插值，保证从暖橙到预警红平滑过渡。 */
const TIER_DIFFICULTY_COLORS = (() => {
  const hex = (s) => parseInt(s.slice(1), 16);
  const anchors = [[1, '#f6a329'], [8, '#e85a1a'], [14, '#e73118'], [20, '#ff0024']];
  const out = {};
  for (let n = 1; n <= 20; n++) {
    let a = anchors[0], b = anchors[anchors.length - 1];
    for (let i = 0; i < anchors.length - 1; i++) if (n >= anchors[i][0] && n <= anchors[i + 1][0]) { a = anchors[i]; b = anchors[i + 1]; }
    const t = b[0] === a[0] ? 0 : (n - a[0]) / (b[0] - a[0]);
    const pa = hex(a[1]), pb = hex(b[1]);
    const mix = [16, 8, 0].map((sh) => Math.round(((pa >> sh) & 255) + (((pb >> sh) & 255) - ((pa >> sh) & 255)) * t));
    out[`N${n}`] = '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('');
  }
  return out;
})();
/** 难度阶梯上的序（N1..N20 = 1..20；旧档按锚点映射：FUNNY 1 / NORMAL 8 / HARD 14 / ABYSS 20）。 */
export const difficultyRank = (d) => {
  const tier = DIFFICULTY_TIERS.indexOf(d);
  if (tier >= 0) return tier + 1;
  const alias = LEGACY_DIFFICULTY_ALIAS[d];
  if (alias) return DIFFICULTY_TIERS.indexOf(alias) + 1;
  return 0;
};
export const DIFFICULTY_NAMES = {
  ...LEGACY_NAMES,
  ...Object.fromEntries(DIFFICULTY_TIERS.map((d) => [d, N_('难度 {d}').replace('{d}', d)])),
};
export const DIFFICULTY_COLORS = { ...LEGACY_COLORS, ...TIER_DIFFICULTY_COLORS };

/**
 * 2026-11-05 业主裁决：除肉鸽外，难度一律走「四个正常难度」（标准 / 险境 / 绝境 / 终极模拟）。
 * 肉鸽保留 20 档（它的关卡与名称是按 N 档铺的）。
 * 注意：DIFFICULTIES 本身不动 —— 那是数据侧 20 档的完整清单，服务端校验与版本回退仍要用它。
 * @param {string} roomMode 房间模式（'solo' | 'coop' | 'versus' | 'rogue' | 'xie' …）
 * @returns {readonly string[]}
 */
export function difficultyOptionsFor(roomMode) {
  return roomMode === 'rogue' ? DIFFICULTIES : LEGACY_DIFFICULTIES;
}

// 救援（促融共竞 / DESIGN §29）: LP 归零不再当场淘汰。结算期开一个窗口，**其余全体存活队友同意**后，从共享池
// 按人头各扣 REVIVAL_COST_PER 点（第 2 次起每人 +REVIVAL_COST_STEP，依次叠加）把目标救回 1 点 LP。
// 窗口只在结算期、且队伍还没输（teamLp 仍为 null）时开放。
export const REVIVAL_COST_PER = 5;
export const REVIVAL_COST_STEP = 5;
/** Why a downed player could not be rescued — carried on the player and shown to the room (never a raw code). */
export const REVIVAL_UNAVAILABLE_REASONS = Object.freeze(['left', 'already-used', 'disabled', 'match-ended', 'no-voter', 'pool', 'window-closed', 'window-expired']);


// 训练模式 (入门协议): data/config.json `mode_training_1` is a LOCAL (solo) mode, so its id does not follow the
// single/multi naming rule. The host client imports these from /shared/constants.js (the plugin copy is what the
// browser overlay serves), so keep the same names here.
export const TRAINING_DIFFICULTY = 'TRAINING';
export const TRAINING_MODE_ID = 'mode_training_1';

// modeId in data/config.json = `mode_${type}_${difficulty.toLowerCase()}` with type single|multi; a room `variant`
// (e.g. 'xie' = 协同共竞) overrides the type, giving `mode_<variant>_<difficulty>` (DESIGN §29).
export const modeIdFor = (roomMode, difficulty, variant = null) =>
  difficulty === TRAINING_DIFFICULTY
    ? TRAINING_MODE_ID
    : `mode_${variant || (roomMode === 'solo' ? 'single' : 'multi')}_${difficulty.toLowerCase()}`;

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  INFO_CHECK: 'INFO_CHECK',
  BAND_DRAFT: 'BAND_DRAFT',
  BATTLE_CHECK: 'BATTLE_CHECK',
  ROUND_START: 'ROUND_START',
  SP_DRAFT: 'SP_DRAFT',
  PREP: 'PREP',
  COMBAT: 'COMBAT',
  UNITE: 'UNITE',
  EVENT: 'EVENT',         // 对抗模式：事件期（2V2 / 4V4）
  CONFRONT: 'CONFRONT',   // 对抗模式：狩猎期（2V2 / 4V4）
  SETTLE: 'SETTLE',
  FINAL_ASSAULT: 'FINAL_ASSAULT',
  HIDDEN_CORE: 'HIDDEN_CORE',
  RESULT: 'RESULT',
});

export const PHASE_NAMES = {
  LOBBY: N_('等待中'), INFO_CHECK: N_('确认本局信息'), BAND_DRAFT: N_('选择策略'), BATTLE_CHECK: N_('协议启动'),
  ROUND_START: N_('回合开始'), SP_DRAFT: N_('机变阶段'), PREP: N_('休整期'), COMBAT: N_('作战中'), UNITE: N_('联防阶段'),
  EVENT: N_('事件期'),
  CONFRONT: N_('狩猎期'),
  SETTLE: N_('结算'), FINAL_ASSAULT: N_('最终攻势'), HIDDEN_CORE: N_('隐秘核心'), RESULT: N_('模拟结束'),
};

// Board geometry on the 19x21 stage grid (row 0 = bottom). See DESIGN §3.
export const GEO = Object.freeze({
  ROWS: 19, COLS: 21,
  FIELD: { r0: 9, r1: 12, c0: 2, c1: 10 },        // own deployable board region
  NORMAL_RECT: { r0: 9, r1: 12, c0: 0, c1: 10 },  // simulation rect for a normal battle
  UNITE_RECT: { r0: 9, r1: 12, c0: 0, c1: 20 },
  BOSS_RECT: { r0: 0, r1: 5, c0: 0, c1: 20 },
  HAND_ROW: 7, HAND_SIZE: 10,                      // hand slot idx = col 0..9
  TEMP_ROW: 8, TEMP_C0: 4, TEMP_SIZE: 5,           // temp slot idx 0..4 = cols 4..8
  PARTNER_COL_OFFSET: 8,
});

export const AREA = Object.freeze({ BOARD: 'board', HAND: 'hand', TEMP: 'temp', OUTSIDE: 'outside' });

export const PIECE_KIND = Object.freeze({ CHESS: 'chess', ITEM: 'item', TOKEN: 'token' });

/**
 * Whether the placed piece of a skill's summon (赫默's 医疗探机, 巫恋's 诅咒娃娃) also deploys once, for free, at the
 * battle start. true = the PRTS reading (卫戍协议/帮助 §作战阶段: "所有手动部署的召唤物，无视所属干员的持有状态…作战开始时
 * 立即部署一次", example 赫默's drone), settled by the user on 2026-10-01 after playtest #6 (DESIGN §20); false = the
 * playtest #4 reading ("是赫默开技能释放一次，不是开局直接就部署了"): it takes its tile only when the owner's skill gives one.
 * Either way the piece re-appears on its tile each time the owner's skill gives one.
 * One switch for everything that depends on it: the sim (server/sim/content/tokens.js dockSkillSummons) and the summon
 * card's hint (public/js/ui/detailPanel.js summonDeployHint). docs/PLAYING.md §4 and docs/SIM.md (token pieces) state
 * the rule in prose — test/ui/playtest6_summons.test.js fails until they match the value.
 */
export const SKILL_SUMMON_START_DEPLOY = true;

/**
 * Official per-bond layer cap (docs/research/11-limits-official.md §1): the client's
 * `Torappu.Battle.AutoChessBattleConst.MAX_GARRISON_STACK = 999`, and its bond counter (`AddBondCount`) stores
 * `min(L + n, 999)` — each bond stops at 999 on its own; the community reports bonds sitting at 999 while fed (巴哈姆特
 * 12534 "每把都能999层", 12316 "999謝"; research 02 §layers). The only implementation of the cap (DESIGN §20.12). Every
 * writer of a bond's layers goes through `layerGainRoom`: the prep-side gains (server/match/player/economy.js addLayers —
 * 特质, items, bands, 机变 cards, bonds), the settle of the in-battle gains (server/match/match/settle.js) and the live in-battle
 * copy (server/sim/battle/economy.js addLayers, as the client's AddBondCount) — and the dev tools' direct writes (tools/matchrun.mjs
 * --layers, tools/balance.mjs applyBoard); a gain at the cap adds 0 (no onLayers, no 'layer'
 * event), and the client-result check (server/match/fields.js) bounds a reported gain by the room left. Milestones paid
 * per N layers (远见, 奇迹, 维多利亚 …) stop with the count. 0 / Infinity = no cap.
 */
export const BOND_LAYER_CAP = 999;

/**
 * The layers a gain of `n` actually adds to a bond holding `before` under BOND_LAYER_CAP: min(n, cap − before), never
 * negative (a count already at or over the cap gains 0 and is never lowered); 0 for a non-positive / non-finite `n`
 * except +Infinity (= "the room left").
 */
export function layerGainRoom(before, n) {
  if (!(n > 0)) return 0;
  const cap = BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity;
  const b = Number.isFinite(before) && before > 0 ? before : 0;
  return Math.max(0, Math.min(n, cap - b));
}

/**
 * Official boss-hit limit "限伤" (docs/research/11-limits-official.md §2): `AutoChessBattleConst.MAX_BATTLE_DAMAGE =
 * 300000`. In a boss battle outside training — our battle kinds 'boss' (Final Assault) and 'hidden' (Hidden Core) — a
 * single hit on a leader (`AutoChessBattleUtil.IsBossEnemy`: an enemyId of activity_table autoChessData.bossInfoDict
 * = data/bosses.json `enemyKey`; in the sim the tag-'boss' units: those leaders and their mirrored copies, never parts,
 * escorts or drones) whose `ceil(final damage)` ≥ this is CANCELLED: 0 damage, nothing credited to the shared pool
 * (`AutoChessStepModeManager._OnBossEnemyTakeDamage` → `modifier.Cancel()`). It is not a clamp: a hit of 299999 lands.
 * Checked in server/sim/damage.js (dealDamage after DEF / RES and every multiplier, before shields; Battle.loseHp — not
 * the 胄 drone link's pool share, `noHitLimit`, DESIGN §25.13.4). Minions, normal rounds and 联防 are unaffected.
 * 0 / Infinity = off.
 *
 * 本树 2026-11-03 裁决：新 boss 血量 40 万 ~ 500 万，官方的 300000 会把主力一击全部吃掉，故上限提到 1000000。
 * 命中时的具体处置以消费方为准（0.4.3 sim 的 server/sim/damage.js leaderHitDamage 是钳制而非作废）。
 */
export const BOSS_HIT_LIMIT = 1000000;

// Snapshot unit flag bits (DESIGN §8.2)
export const UF = Object.freeze({
  BLOCKED: 1, STUNNED: 2, FROZEN: 4, STEALTH: 8, SKILL: 16, SHIELD: 32, INVULN: 64, COLD: 128, SLEEP: 256, FLYING: 512,
});

export const ANIM = Object.freeze({ IDLE: 0, MOVE: 1, ATTACK: 2, SKILL: 3, DIE: 4, STUN: 5, DEPLOY: 6 });

export const ERR = Object.freeze({
  BAD_MSG: 'BAD_MSG',             // malformed / unknown message
  SESSION_IN_USE: 'SESSION_IN_USE', // a local recovery candidate cannot replace the connected holder
  RATE: 'RATE',                   // rate limited
  NOT_IN_ROOM: 'NOT_IN_ROOM',
  ROOM_NOT_FOUND: 'ROOM_NOT_FOUND',
  ROOM_FULL: 'ROOM_FULL',
  ROOM_STARTED: 'ROOM_STARTED',
  NOT_HOST: 'NOT_HOST',
  NOT_READY: 'NOT_READY',
  WRONG_PHASE: 'WRONG_PHASE',
  NO_FUNDS: 'NO_FUNDS',
  HAND_FULL: 'HAND_FULL',
  BOARD_FULL: 'BOARD_FULL',
  BAD_TILE: 'BAD_TILE',
  BAD_TARGET: 'BAD_TARGET',
  SOLD_OUT: 'SOLD_OUT',
  MAX_LEVEL: 'MAX_LEVEL',
  NOT_YOUR_TURN: 'NOT_YOUR_TURN',
  ALREADY: 'ALREADY',
  TEMP_NOT_EMPTY: 'TEMP_NOT_EMPTY',
  ELIMINATED: 'ELIMINATED',
  SPECTATOR: 'SPECTATOR',
  MAINTENANCE: 'MAINTENANCE',
  CONFRONT_COUNT: 'CONFRONT_COUNT',   // 狩猎期布阵超过上限
  CONFRONT_BUDGET: 'CONFRONT_BUDGET', // 狩猎期布阵超出本回合预算（缺这个常量会让超预算提交静默丢弃：{error: undefined} 被当成成功）
  CONFRONT_ROUTE: 'CONFRONT_ROUTE',   // 狩猎期路线/投放时刻不合法（越界/不可达/超时/超长）
  // 这份表是核心 shared/constants.js 的**整份覆盖**：核心新增的错误码必须同步过来，否则客户端拿到码却没有文案。
  // 2026-10-27 的反向事故（插件有 CONFRONT_*、核心没有 ⇒ 被兜底成 INTERNAL）已把三条补进核心；这里补齐核心独有的键。
  SERVER_FULL: 'SERVER_FULL',
  ROOM_CODE_TAKEN: 'ROOM_CODE_TAKEN',
  VERSION_UNKNOWN: 'VERSION_UNKNOWN',
  VERSION_UNSUPPORTED: 'VERSION_UNSUPPORTED',
  VERSION_VOTE: 'VERSION_VOTE',
  // room.setPlugins (DESIGN §32): a plugin this server has not installed; one a room cannot switch on in this version
  // (not a cosmetic or content plugin it loads, not of the room's scope, or not allowed by the server owner's
  // plugins/config.json); a requirement missing or out of range, or a load-order cycle; two plugins in conflict; a set
  // over the art size limit
  PLUGIN_SCRIPT_CONFLICT: 'PLUGIN_SCRIPT_CONFLICT',
  PLUGIN_SCRIPT_OVERRIDE: 'PLUGIN_SCRIPT_OVERRIDE',
  PLUGIN_SCRIPT_CHECK: 'PLUGIN_SCRIPT_CHECK',
  PLUGIN_SCRIPTS_DISABLED: 'PLUGIN_SCRIPTS_DISABLED',
  PLUGIN_TRUST_PIN: 'PLUGIN_TRUST_PIN',
  PLUGIN_TRUST_PUBLIC: 'PLUGIN_TRUST_PUBLIC',
  PLUGIN_CONSENT: 'PLUGIN_CONSENT',
  PLUGIN_UNKNOWN: 'PLUGIN_UNKNOWN',
  PLUGIN_BLOCKED: 'PLUGIN_BLOCKED',
  PLUGIN_DEPENDENCY: 'PLUGIN_DEPENDENCY',
  PLUGIN_CONFLICT: 'PLUGIN_CONFLICT',
  PLUGIN_RULE_CONFLICT: 'PLUGIN_RULE_CONFLICT',
  PLUGIN_LIMIT: 'PLUGIN_LIMIT',
  // P1c (DESIGN §32.6): a gameplay plugin made for other game versions or another plugin API (refused unless the server
  // owner allows it: plugins/config.json allowIncompatible); the server already runs as many plugin content sets as its
  // limit allows (plugins/config.json limits.maxSets); room.ready / room.start before every player's page has loaded and
  // checked the room's content (room.contentReady)
  PLUGIN_INCOMPATIBLE: 'PLUGIN_INCOMPATIBLE',
  PLUGIN_BUSY: 'PLUGIN_BUSY',
  CONTENT_NOT_READY: 'CONTENT_NOT_READY',
  // match test mode (DESIGN §34.8 phase 2): the process switch is off, or this room was not created as a test room
  TEST_CONFIRM: 'TEST_CONFIRM',
  TEST_DISABLED: 'TEST_DISABLED',
  TEST_FORBIDDEN: 'TEST_FORBIDDEN',
  INTERNAL: 'INTERNAL',
});

export const ERR_TEXT = {
  SESSION_IN_USE: N_('此对局仍在其他窗口中，或当前浏览器无法安全恢复。请关闭原窗口后重试。'),
  BAD_MSG: N_('无效的请求'), RATE: N_('操作过于频繁'), NOT_IN_ROOM: N_('你不在房间中'), ROOM_NOT_FOUND: N_('未找到该同盟密钥对应的房间'),
  ROOM_FULL: N_('房间已满'), MAINTENANCE: N_('服务器维护中，请稍后再来'), ROOM_STARTED: N_('模拟已开始'), NOT_HOST: N_('只有房主可以操作'), NOT_READY: N_('仍有玩家未就绪'),
  WRONG_PHASE: N_('当前阶段无法进行该操作'), NO_FUNDS: N_('资金不足'), HAND_FULL: N_('整备区已满'), BOARD_FULL: N_('已达到部署上限'),
  BAD_TILE: N_('无法部署在该位置'), BAD_TARGET: N_('无效的目标'), SOLD_OUT: N_('已售出'), MAX_LEVEL: N_('调度中心已达最高等级'),
  NOT_YOUR_TURN: N_('尚未轮到你'), ALREADY: N_('已完成该操作'), TEMP_NOT_EMPTY: N_('临时整备区不为空'), ELIMINATED: N_('你已被淘汰'),
  SPECTATOR: N_('观战中无法进行该操作'), INTERNAL: N_('服务器内部错误'),
  CONFRONT_COUNT: N_('派出的怪物数量超出上限'), CONFRONT_BUDGET: N_('派出的怪物超出本回合预算'),
  CONFRONT_ROUTE: N_('路线或投放时刻不可用（超出地图 / 时间或不可达）'),
  SERVER_FULL: N_('服务器已满'),
  ROOM_CODE_TAKEN: N_('固定同盟密钥已被另一个房间占用，请先关闭那个房间'),
  VERSION_UNKNOWN: N_('本服务器没有启用这个版本'),
  VERSION_UNSUPPORTED: N_('这个版本无法服务本房间'),
  VERSION_VOTE: N_('房间的版本表决正在进行中'),
  PLUGIN_UNKNOWN: N_('本服务器没有安装该插件'), PLUGIN_BLOCKED: N_('该插件不能在房间中启用'), PLUGIN_DEPENDENCY: N_('缺少该插件需要的其他插件'),
  PLUGIN_CONFLICT: N_('所选插件互相冲突'), PLUGIN_LIMIT: N_('所选插件的素材总量超出本服务器的上限'),
  PLUGIN_RULE_CONFLICT: N_('两个插件把同一个规则开关设成了不同的选项'),
  PLUGIN_INCOMPATIBLE: N_('该插件不适配本服务器的游戏版本'), PLUGIN_BUSY: N_('本服务器同时运行的插件组合已达上限，请稍后再试'),
  PLUGIN_CONSENT: N_('还有玩家未同意运行受信任插件'),
  PLUGIN_SCRIPTS_DISABLED: N_('服主没有启用脚本插件'),
  PLUGIN_TRUST_PIN: N_('插件的锁文件或文件内容与服主钉住的哈希不符'),
  PLUGIN_TRUST_PUBLIC: N_('公网监听默认禁止受信任插件'),
  PLUGIN_SCRIPT_CONFLICT: N_('两个插件注册了同一个效果'),
  PLUGIN_SCRIPT_OVERRIDE: N_('插件未声明要替换的官方技能'),
  PLUGIN_SCRIPT_CHECK: N_('脚本未通过兼容性检查'),
  CONTENT_NOT_READY: N_('仍有博士未载入房间的插件内容'),
  TEST_CONFIRM: N_('这是测试房间，不计入任何记录。确认加入？'),
  TEST_DISABLED: N_('测试模式未开启'),
  TEST_FORBIDDEN: N_('这不是测试房间'),
};

// ---- Emotes (交流, research 09 §4) -----------------------------------------------------------------------------
// The 36 official in-match emotes: display_meta_table emoticonData, scene AUTOCHESS_BATTLE, 6 themes × 6, one wheel
// page per theme in activity_table autoChessData.enabledEmoticonThemeIdList order, emotes by sortId. `g.emote { id }`
// / `m.emote { playerId, id }` carry the official emoji id. Generated reference: data/emotes.json
// (tools/build-emotes.mjs); test/ui/emotes.test.js keeps this table identical to it.
// Official emotes have no text (desc is null): `label` is ours and only ever an aria-label, never displayed.
// Art: extracted from a local client (tools/local-extract) to /assets/local/emoticon/<dir>/<picId>.png and listed in
// data/local-assets.json group `emoticon/<dir>`; also downloaded from the public mirror by tools/fetch-assets.mjs
// (tools/assets/plan.mjs UI_EXTRAS → data/assets.json ui['emoticon/<dir>/<picId>'], GitHub issue #42). The UI takes the
// local picture first, then the mirror copy, and shows a neutral glyph when neither is there. The picId is not
// derived from the id (autochess_battle_fooldoctor_03…06 → pic_fooldoctor_04/05/06/08_battle).
const emo = (id, sortId, picId, label) => Object.freeze({ id, sortId, picId, label });
export const EMOTE_THEMES = Object.freeze([
  { themeId: 'emoticon_autochess_basic', dir: 'basic', sortId: 100000, isBasic: true, name: N_('表情套组：卫戍协议'), emotes: [
    emo('autochess_battle_happy', 1001, 'pic_happy_battle', N_('开心')),
    emo('autochess_battle_scared', 1002, 'pic_scared_battle', N_('害怕')),
    emo('autochess_battle_sorry', 1003, 'pic_sorry_battle', N_('对不起')),
    emo('autochess_battle_thanks', 1004, 'pic_thanks_battle', N_('谢谢')),
    emo('autochess_battle_thinking', 1005, 'pic_thinking_battle', N_('思考')),
    emo('autochess_battle_nice_cooperate', 1006, 'pic_cooperate_battle', N_('合作愉快')),
  ] },
  { themeId: 'emoticon_originium_slug', dir: 'slug', sortId: 1001, isBasic: false, name: N_('表情套组：虫动'), emotes: [
    emo('slug_autochess_battle_nice_work', 2001, 'pic_nice_work_battle', N_('合作愉快！')),
    emo('slug_autochess_battle_thanks', 2002, 'pic_thanks_battle', N_('谢谢！')),
    emo('slug_autochess_battle_sorry', 2003, 'pic_sorry_battle', N_('对不起！')),
    emo('slug_autochess_battle_bye', 2004, 'pic_bye_battle', N_('再见！')),
    emo('slug_autochess_battle_distrust', 2005, 'pic_distrust_battle', '？？？'),
    emo('slug_autochess_battle_very_soon', 2006, 'pic_very_soon_battle', N_('很快就好！')),
  ] },
  { themeId: 'emoticon_autochess_basic_2', dir: 'basic_2', sortId: 100001, isBasic: true, name: N_('表情套组：卫戍协议'), emotes: [
    emo('autochess_battle_noproblem', 1007, 'pic_noproblem_battle', N_('没问题！')),
    emo('autochess_battle_respect', 1008, 'pic_respect_battle', N_('敬礼！')),
    emo('autochess_battle_call', 1009, 'pic_call_battle', N_('欢呼！')),
    emo('autochess_battle_playingcool', 1010, 'pic_playingcool_battle', N_('酷！')),
    emo('autochess_battle_sad', 1011, 'pic_sad_battle', N_('伤心')),
    emo('autochess_battle_dying', 1012, 'pic_dying_battle', N_('快死了')),
  ] },
  { themeId: 'emoticon_foolsday_doctor', dir: 'fooldoctor', sortId: 1002, isBasic: false, name: N_('表情套组：博士士'), emotes: [
    emo('autochess_battle_fooldoctor_01', 1020, 'pic_fooldoctor_01_battle', N_('博士士 1')),
    emo('autochess_battle_fooldoctor_02', 1021, 'pic_fooldoctor_02_battle', N_('博士士 2')),
    emo('autochess_battle_fooldoctor_03', 1022, 'pic_fooldoctor_04_battle', N_('博士士 3')),
    emo('autochess_battle_fooldoctor_04', 1023, 'pic_fooldoctor_05_battle', N_('博士士 4')),
    emo('autochess_battle_fooldoctor_05', 1024, 'pic_fooldoctor_06_battle', N_('博士士 5')),
    emo('autochess_battle_fooldoctor_06', 1025, 'pic_fooldoctor_08_battle', N_('博士士 6')),
  ] },
  { themeId: 'emoticon_foolsday_amiya', dir: 'foolamiya', sortId: 1003, isBasic: false, name: N_('表情套组：米米子'), emotes: [
    emo('autochess_battle_foolamiya_01', 1040, 'pic_foolamiya_01_battle', N_('米米子 1')),
    emo('autochess_battle_foolamiya_02', 1041, 'pic_foolamiya_02_battle', N_('米米子 2')),
    emo('autochess_battle_foolamiya_03', 1042, 'pic_foolamiya_03_battle', N_('米米子 3')),
    emo('autochess_battle_foolamiya_04', 1043, 'pic_foolamiya_04_battle', N_('米米子 4')),
    emo('autochess_battle_foolamiya_05', 1044, 'pic_foolamiya_05_battle', N_('米米子 5')),
    emo('autochess_battle_foolamiya_06', 1045, 'pic_foolamiya_06_battle', N_('米米子 6')),
  ] },
  { themeId: 'emoticon_foolsday_wisdel', dir: 'foolwisdel', sortId: 1004, isBasic: false, name: N_('表情套组：维维美'), emotes: [
    emo('autochess_battle_foolwisdel_01', 1060, 'pic_foolwisdel_01_battle', N_('维维美 1')),
    emo('autochess_battle_foolwisdel_02', 1061, 'pic_foolwisdel_02_battle', N_('维维美 2')),
    emo('autochess_battle_foolwisdel_03', 1062, 'pic_foolwisdel_03_battle', N_('维维美 3')),
    emo('autochess_battle_foolwisdel_04', 1063, 'pic_foolwisdel_04_battle', N_('维维美 4')),
    emo('autochess_battle_foolwisdel_05', 1064, 'pic_foolwisdel_05_battle', N_('维维美 5')),
    emo('autochess_battle_foolwisdel_06', 1065, 'pic_foolwisdel_06_battle', N_('维维美 6')),
  ] },
].map((t) => Object.freeze({ ...t, emotes: Object.freeze(t.emotes) })));
/** Every emote with its theme: `{ id, sortId, picId, label, themeId, dir }`, in wheel order. */
export const EMOTE_CATALOG = Object.freeze(EMOTE_THEMES.flatMap((t) => t.emotes.map((e) => Object.freeze({ ...e, themeId: t.themeId, dir: t.dir }))));
/** The 36 official emote ids (protocol whitelist: `EMOTES.includes(id)`). */
export const EMOTES = Object.freeze(EMOTE_CATALOG.map((e) => e.id));
const EMOTE_INDEX = new Map(EMOTE_CATALOG.map((e) => [e.id, e]));
/** Catalog record of an emote id, or null (safe for any input, including '__proto__'). */
export const emoteInfo = (id) => (typeof id === 'string' && EMOTE_INDEX.get(id)) || null;
// id-keyed maps without a prototype: a wire id like '__proto__' / 'toString' looks up undefined, never an Object method
const emoteMap = (pick) => Object.freeze(Object.assign(Object.create(null), Object.fromEntries(EMOTE_CATALOG.map((e) => [e.id, pick(e)]))));
/** Emote id → theme id. */
export const EMOTE_THEME = emoteMap((e) => e.themeId);
/** Emote id → our aria-label (never displayed). */
export const EMOTE_LABEL = emoteMap((e) => e.label);
/** data/local-assets.json group of an emote's art (`emoticon/<dir>`), or null. */
export const emoteArtGroup = (id) => { const e = emoteInfo(id); return e ? `emoticon/${e.dir}` : null; };
/** Canonical URL of an emote's extracted art (`/assets/local/emoticon/<dir>/<picId>.png`), or null for unknown ids. */
export const emoteArtPath = (id) => { const e = emoteInfo(id); return e ? `/assets/local/emoticon/${e.dir}/${e.picId}.png` : null; };
export const EMOTE_COOLDOWN_MS = 1000; // activity_table autoChessData.constData.chatCD (s)
export const EMOTE_BUBBLE_MS = 3000;   // constData.chatTime (s): how long a bubble stays up

// 对局文字聊天（0.4.3 shared 补齐）：长度按**字符**计（中文是常态），冷却独立于表情，避免表情阻塞聊天。
export const CHAT_MAX_LEN = 40;
export const CHAT_COOLDOWN_MS = 2000;
/** 一句话在屏幕上停留多久后淡出。 */
export const CHAT_LINE_MS = 18000;
/** 同时显示几行，超出时最旧的提前淡出。 */
export const CHAT_VISIBLE = 6;
/** 客户端历史视图保留的行数。 */
export const CHAT_KEEP = 60;
/** 房间聊天（room.chat / m.roomChat）保留的行数：服务端 room.state 重放与客户端裁剪共用。 */
export const ROOM_CHAT_KEEP = 60;

export const DEPLOY_CAP_MAX = 12;

// ===== 协同共竞 mod 口径层需要的常量（自 coop 分支补入；variants/behaviour/morph 使用）=====

// 协同共竞: SP_BOSS_HIT_LIMIT 解析（coop Match.js 的限伤 override 用）
export function bossHitLimitFrom(env) {
  const raw = env ? env.SP_BOSS_HIT_LIMIT : undefined;
  if (raw == null) return undefined;
  const s = String(raw).trim().toLowerCase();
  if (s === '') return undefined;
  if (s === 'off' || s === 'infinity' || s === 'inf') return Infinity;
  const n = Number(s);
  if (!Number.isFinite(n)) return undefined;
  if (n === 0) return Infinity;                 // the constant's own "0 = off"
  return n > 0 ? n : undefined;                 // negative / junk → the built-in default
}

// 协同共竞: 语音语言表（Forge voiceDubs / extensions 用）
export const VOICE_LANGS = Object.freeze(['cn', 'jp', 'en', 'kr']);

// 协同共竞: 房间座位下限（Forge B5 裁决的 seatCap 滑块；room.js 的 seatCapRoomRange 用）
export const MIN_SEATS = 2;

// ===== 对抗模式（2V2 / 4V4，2026-10-24 移植自 Forge 的 versus 实现）=====
// 模式口径：`room.mode = 'versus'` + `teamSize`（2 → 4 席，4 → 8 席），模式 id 走既有 `mode_<variant>_<difficulty>`
// （本树用 variant 'versus' / 'versus4' 区分两队人数）。常量与 Forge 的 shared/constants.js 同值，便于逐文件移植。
export const VERSUS_TEAM_SIZE = 2;
/** 每队人数上限（业主 2026-10-27：总人数 2..20 偶数 ⇒ 每队 1..10） */
export const VERSUS_TEAM_MAX = 10;      // 2V2 的每队人数（room.create 的 teamSize 默认）
export const VERSUS_TEAMS = 2;          // 两队（红 / 蓝）
export const CONFRONT_ROSTER_MS = 5000; // 狩猎期布阵后的花名册亮相
export const EVENT_ROSTER_MS = 5000;    // 事件期布阵公布
const HUNT_RHYTHM = Object.freeze({
  ratioBase: 0.05, ratioStep: 0.02, ratioMax: 0.15,
  huntRound: 13, huntRatio: 0.5,
  positions: Object.freeze(['front', 'mid', 'back']),
  budgetMul: 2, rosterMs: CONFRONT_ROSTER_MS,
  traitShare: 0.3, traitStepScores: Object.freeze([0, 1, 2]),
  // maxPicks 64 → 80（业主 2026-10-31「控怪出怪量 = 官方 1.5 倍」）：R12/R13 官方 p90 约 50 只，
  // 1.5 倍要 75–77 只，64 会把「1.5 倍」重新压回 1.25 倍。协议侧 picks 硬上限是 128，80 安全。
  bountyCaps: Object.freeze([1, 1, 2, 2]), finalHuntBounty: 25, killIncomeShare: 1, maxPicks: 80,
  merchantRates: Object.freeze([0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.2, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 1]),
  merchantRoundCap: 4, merchantUncappedRound: 15,
});
export const VERSUS_CONFRONT = Object.freeze({ targetSeconds: 10, ...HUNT_RHYTHM, maxBosses: 32 });

/**
 * 投放名单「不给投放方看」的判据（业主 2026-11-06：「投放方不显示投放名单，仅对面显示」）。纯函数，放 shared 里
 * 是因为客户端（ui/confrontOverlay.js 的 ConfrontOverlay roster 分支 + ConfrontClash）与单测都要用，而客户端组件
 * 本身依赖 preact 的 vendor 模块、node 里 import 不了。
 *
 * 攻方自己这一回合投了什么，MonsterDropFloat 已经逐条列出来了（已投 N 只 + 撤回），再弹一块整屏 / 角落名单纯属
 * 重复且挡战场。
 *
 * 判据用**玩家自己的 `role`**（服务端 players[] 里的 'attack' | 'defend'），**不要**拿 `pub.attackingTeam` 跟
 * `players[].team` 比 —— 前者是队伍 id（0 / 1），后者是队伍名（'red' / 'blue'），2026-11-06 真机就是这么漏的
 * （两边永远不相等 ⇒ 攻方照样看到名单）。非攻守回合 role 为 null ⇒ 返回 false（照常渲染，与改造前一致）；
 * 观战 / 拿不到 role 同样 false。
 * @param {string|null|undefined} myRole
 * @returns {boolean}
 */
export function rosterHiddenFor(myRole) {
  return myRole === 'attack';
}

export const COOP_HUNT = Object.freeze({
  enabled: false, startRounds: Object.freeze([4, 5, 6]), ...HUNT_RHYTHM, targets: Object.freeze(['self', 'mate']),
});
export const merchantRateFor = (round, table = VERSUS_CONFRONT) => {
  const rates = table.merchantRates;
  const r = Math.max(1, Math.min(rates.length, Math.floor(Number(round) || 0)));
  return rates[r - 1];
};
export const merchantCapFor = (round, table = VERSUS_CONFRONT) =>
  (Math.floor(Number(round) || 0) === table.merchantUncappedRound ? Infinity : table.merchantRoundCap);
export const opponentRevealed = (round) => Math.floor(Number(round) || 0) > VERSUS_CONFRONT.huntRound;
/** 座位 → 队伍（0/1）。第二参**必须是对象**：`[0,1,2,3].map(teamOfSeat)` 会传下标当第二参。 */
export const teamOfSeat = (seat, opts = null) => {
  const size = opts && Number.isInteger(opts.teamSize) && opts.teamSize > 0 ? opts.teamSize : VERSUS_TEAM_SIZE;
  return Math.floor((Number(seat) || 0) / size) % VERSUS_TEAMS;
};
export const EVENT_FINAL_ROUND = 13;
export const EVENT_SECOND_OFFSET = 4;
export const eventRoundsFor = (contestStartRound) => {
  const first = Math.max(1, Math.min(EVENT_FINAL_ROUND, Math.trunc(Number(contestStartRound) || 0)));
  if (!contestStartRound || !first) return [];
  const out = [first];
  if (first + EVENT_SECOND_OFFSET < EVENT_FINAL_ROUND) out.push(first + EVENT_SECOND_OFFSET);
  if (out[out.length - 1] !== EVENT_FINAL_ROUND) out.push(EVENT_FINAL_ROUND);
  return out;
};

// ===== 对抗模式 · 事件期数据（移植自 Forge，2026-10-24）=====
export const EVENT_TARGETS = Object.freeze(['self', 'mate', 'oppA', 'oppB']);
/**
 * Every target key the event period may offer, in reading order: 自己 / 队友, then the opponents in seat order. A 2V2
 * room uses the first four (EVENT_TARGETS); a 4V4 room adds `oppC` / `oppD`, so all four opponents are reachable.
 * The protocol accepts this whole set and the match slices it by `teamSize` — a key outside the room's slice is a
 * plain ERR.BAD_TARGET.
 */
export const EVENT_TARGETS_ALL = Object.freeze(['self', 'mate', 'oppA', 'oppB', 'oppC', 'oppD', 'oppE', 'oppF', 'oppG', 'oppH', 'oppI', 'oppJ']);
/**
 * The target keys of a versus room with `teamSize` players per team.
 * @param {number} [teamSize] 2 = 2V2 (4 keys), 4 = 4V4 (6 keys)
 * @returns {readonly string[]}
 */
export const eventTargetsFor = (teamSize = 2) => {
  // 业主 2026-10-27：队伍规模改成偶数自定义、最大 20 人（每队 1..10），对手目标键随之扩到 oppJ
  const n = Math.max(1, Math.min(VERSUS_TEAM_MAX, Math.trunc(Number(teamSize) || 2)));
  return n <= 2 ? EVENT_TARGETS : EVENT_TARGETS_ALL.slice(0, 2 + n);
};
/** A self-targeted entry's magnitude multiplier (all numeric values in the entry, refresh uses included). */
export const EVENT_SELF_MUL = 2;
/**
 * How many rounds an ally entry stays in force (user 2026-10-17: 集市换货's 出售价 −1 lasted the whole match, so a sold
 * operator returned nothing — far too strong). An entry picked at round R is active in R, R+1, …, R+duration−1 and
 * expires at R+duration, for every effect (battle stats, deploy cap, income, prices, bounty). History keeps every pick:
 * only "currently in force" is filtered. Monster entries are NOT affected — they already act on their own single round
 * (foeEvent.round === this.round). One line to tune.
 */
export const EVENT_DURATION_ROUNDS = 4;
/** The event phase's selection window in seconds (a timed-out seat is auto-picked by EV: botEventTarget). */
export const EVENT_PICK_SECONDS = 20;
/**
 * The three sequence rows — the single source of the per-order odds and elite share ranges. The ally odds apply to the
 * ally channel as a whole (the target decides WHO receives it; "增" is good for the target), moving from friendly E1 to
 * debuff-heavy E3. The monster odds are from OUR side (favor = weakens the enemies). `eliteShares` are the two values
 * the 强力属性 share is drawn from in that period.
 */
export const EVENT_SEQUENCE = Object.freeze([
  Object.freeze({
    index: 1,
    allyOdds: Object.freeze({ down: 15, mid: 45, up: 40 }),
    foeOdds: Object.freeze({ favor: 35, mid: 40, unfavor: 25 }),
    eliteShares: Object.freeze([0.10, 0.15]),
  }),
  Object.freeze({
    index: 2,
    allyOdds: Object.freeze({ down: 30, mid: 40, up: 30 }),
    foeOdds: Object.freeze({ favor: 25, mid: 40, unfavor: 35 }),
    eliteShares: Object.freeze([0.15, 0.20]),
  }),
  Object.freeze({
    index: 3,
    allyOdds: Object.freeze({ down: 45, mid: 30, up: 25 }),
    foeOdds: Object.freeze({ favor: 20, mid: 35, unfavor: 45 }),
    eliteShares: Object.freeze([0.20, 0.25]),
  }),
]);
/** E2's neutral ally row (the match always reads EVENT_SEQUENCE; kept as the documented baseline for tools/tests). */
export const EVENT_ODDS = EVENT_SEQUENCE[1].allyOdds;
/** E2's neutral monster row (same note). */
export const EVENT_FOE_ODDS = EVENT_SEQUENCE[1].foeOdds;
/** E2's elite share range (same note). */
export const EVENT_FOE_ELITE_SHARES = EVENT_SEQUENCE[1].eliteShares;
/**
 * The 24 ally entries, in four classes (output / survival / sp / economy). The SP class replaced the removed range
 * class (射程 removal, user 2026-10-17): no entry carries `range` / `rangeExtend` / attack-distance data any more — the
 * battle side only uses existing engine mods.
 *
 * Class / entry (name is the comment; the UI slice maps the `key` to its i18n msgid). Magnitudes were scaled ×1.5
 * (user 2026-10-17, "方案 A 只 ×1.5"): percentages keep two decimals (half-percents round to the integer percent the
 * owner listed), flat points scale, fixed coins +2 → +3; the discrete values (SP cost ±1, deploy +1, the market's
 * refresh/sell integers) stay as they are. "给自己" still multiplies the FINAL magnitudes by 2.
 *   output    磨刃 atkPct +20% · 追风 aspd +18 · 破甲 defIgnorePct 22% · 钝口 atkPct −9% · 重弩 atkPct +20% / aspd −18 ·
 *             连击 aspd +27 / atkPct −15%
 *   survival  猎人披挂 hpPct +38% · 营地篝火 regenPct 9%/s · 铁衣 defPct +22% · 血痕 dmgTaken +12% · 轻装远行 hpPct +38% /
 *             atkPct −11% · 负甲 defPct +30% / moveMul 0.85 · 陷足 enemySpeed +22%
 *   sp        蓄势 spRecoveryMul 1.15 · 静息 spRecoveryFlat 0.15 · 轻省 spCostFlat −1 · 滞涩 spRecoveryMul 0.85 ·
 *             换息 spRecoveryMul 1.22 / spCostFlat +1 · 回环 spRecoveryFlat 0.15 / spCostFlat +1
 *   economy   猎人佣金 +3 金/回合 · 赏金嗅觉 投放怪赏金 +3/次 · 轻捷 上场人数 +1 · 空手而归 −3 金/回合 ·
 *             集市换货 刷新费 −1（每回合 2 次）/ 出售价 −1
 * Ratios are stored as plain percentages in this DATA table (a compact summary, not the battle rule). The battle
 * applies the event entries through the **环境buff乘区 / environment buff bucket**:
 *   ① every source multiplies once: `stat = base × Π(1 + p_i)` — two +20 % entries are 1.20 × 1.20 = 1.44;
 *   ② flat values (ASPD / SP recovery / SP cost) are highest priority: they are added to the panel first and are
 *      never scaled by the bucket;
 *   ③ the bucket is event-only: it never mixes with the additive pool of bonds / equipment / skills / 机变.
 * Flat points for aspd / spRecoveryFlat / spCostFlat, economy in fixed coins. `ev` = the AI heuristic (up > 0,
 * down < 0, mid ≈ 0), scaled with the continuous magnitudes (the unchanged discrete entries keep their ev).
 */
export const EVENT_CARDS = Object.freeze([
  // ---- output ---------------------------------------------------------------------------------------------------
  Object.freeze({ id: 1, key: 'whetstone', class: 'output', kind: 'up', atkPct: 0.20, ev: 15 }),        // 磨刃
  Object.freeze({ id: 2, key: 'tailwind', class: 'output', kind: 'up', aspd: 18, ev: 12 }),              // 追风
  Object.freeze({ id: 3, key: 'armor_break', class: 'output', kind: 'up', defIgnorePct: 0.22, ev: 12 }),  // 破甲
  Object.freeze({ id: 4, key: 'blunted', class: 'output', kind: 'down', atkPct: -0.09, ev: -12 }),       // 钝口
  Object.freeze({ id: 5, key: 'heavy_crossbow', class: 'output', kind: 'mid', atkPct: 0.20, aspd: -18, ev: 0 }), // 重弩
  Object.freeze({ id: 6, key: 'rapid_volley', class: 'output', kind: 'mid', aspd: 27, atkPct: -0.15, ev: 1.5 }),   // 连击
  // ---- survival -------------------------------------------------------------------------------------------------
  Object.freeze({ id: 7, key: 'hunter_cloak', class: 'survival', kind: 'up', hpPct: 0.38, ev: 18 }),    // 猎人披挂
  Object.freeze({ id: 8, key: 'campfire', class: 'survival', kind: 'up', regenPct: 0.09, ev: 21 }),      // 营地篝火
  Object.freeze({ id: 9, key: 'iron_hide', class: 'survival', kind: 'up', defPct: 0.22, ev: 12 }),       // 铁衣
  Object.freeze({ id: 10, key: 'bloodstain', class: 'survival', kind: 'down', dmgTaken: 0.12, ev: -15 }), // 血痕
  Object.freeze({ id: 11, key: 'light_travel', class: 'survival', kind: 'mid', hpPct: 0.38, atkPct: -0.11, ev: 3 }), // 轻装远行
  Object.freeze({ id: 12, key: 'burden_armor', class: 'survival', kind: 'mid', defPct: 0.30, moveMul: 0.85, ev: 1.5 }), // 负甲
  Object.freeze({ id: 13, key: 'mired', class: 'survival', kind: 'down', enemySpeed: 0.22, ev: -10.5 }),   // 陷足
  // ---- sp (技力; all engine-native mods) -------------------------------------------------------------------------
  Object.freeze({ id: 14, key: 'build_up', class: 'sp', kind: 'up', spRecoveryMul: 1.15, ev: 12 }),        // 蓄势
  Object.freeze({ id: 15, key: 'stillness', class: 'sp', kind: 'up', spRecoveryFlat: 0.15, ev: 10.5 }),      // 静息
  Object.freeze({ id: 16, key: 'frugal', class: 'sp', kind: 'up', spCostFlat: -1, ev: 9 }),              // 轻省
  Object.freeze({ id: 17, key: 'stagnant', class: 'sp', kind: 'down', spRecoveryMul: 0.85, ev: -12 }),     // 滞涩
  Object.freeze({ id: 18, key: 'breath_swap', class: 'sp', kind: 'mid', spRecoveryMul: 1.22, spCostFlat: 1, ev: 1.5 }), // 换息
  Object.freeze({ id: 19, key: 'cycle', class: 'sp', kind: 'mid', spRecoveryFlat: 0.15, spCostFlat: 1, ev: 0 }),      // 回环
  // ---- economy / mechanism --------------------------------------------------------------------------------------
  Object.freeze({ id: 20, key: 'hunter_commission', class: 'economy', kind: 'up', goldPerRound: 3, ev: 15 }), // 猎人佣金
  Object.freeze({ id: 21, key: 'bounty_scent', class: 'economy', kind: 'up', bountyGold: 3, ev: 9 }),    // 赏金嗅觉
  Object.freeze({ id: 22, key: 'nimble', class: 'economy', kind: 'up', deploy: 1, ev: 9 }),              // 轻捷
  Object.freeze({ id: 23, key: 'empty_handed', class: 'economy', kind: 'down', goldPerRound: -3, ev: -13.5 }), // 空手而归
  Object.freeze({ id: 24, key: 'market_swap', class: 'economy', kind: 'mid', refreshDiscount: 1, refreshUses: 2, sellDiscount: 1, ev: 1 }), // 集市换货
]);

/**
 * The 12 monster entries, four classes × three (one favourable to us = weakens the enemies, one neutral exchange, one
 * unfavourable = strengthens them). One is drawn per event on its own seeded stream, independent of the target choices,
 * and merged into THAT round's normal wave (`Match.foeWaveSpawns`): hpMul / atkMul / defMul / speedMul are the engine's
 * spawn mods, `countAdd` adds to every spawn run's count (clamped to ≥ 1). A monster entry never enters a player's mods
 * and never changes a bounty (the 赏金 stays the placement's own coins). Magnitudes are ×1.5 (user 2026-10-17):
 *   攻击  锈刃 atkMul 0.85 · 换骨 atkMul 1.15 / hpMul 0.85 · 獠牙 atkMul 1.15
 *   生存  创口 hpMul 0.82 · 坚壳 defMul 1.22 / speedMul 0.78 · 厚皮 hpMul 1.18
 *   速度  迟缓 speedMul 0.78 · 盘踞 speedMul 0.7 / hpMul 1.18 · 疾行 speedMul 1.22
 *   数量  稀疏 countAdd −1 · 替换 countAdd −1 / hpMul 1.3 · 增援 countAdd +1
 * `ev` is from OUR side (+ favourable, − unfavourable). The per-sequence odds live in EVENT_SEQUENCE (E2 = 25 / 40 / 35,
 * expectation −0.10; E1 +0.10; E3 −0.25): the monster channel is a gentle sequence-driven difficulty ramp.
 */
export const EVENT_FOE_CARDS = Object.freeze([
  // ---- attack ---------------------------------------------------------------------------------------------------
  Object.freeze({ id: 1, key: 'rusted_blade', class: 'attack', kind: 'favor', atkMul: 0.85, ev: 1 }),      // 锈刃
  Object.freeze({ id: 2, key: 'bone_swap', class: 'attack', kind: 'mid', atkMul: 1.15, hpMul: 0.85, ev: 0 }), // 换骨
  Object.freeze({ id: 3, key: 'fangs', class: 'attack', kind: 'unfavor', atkMul: 1.15, ev: -1 }),          // 獠牙
  // ---- survival -------------------------------------------------------------------------------------------------
  Object.freeze({ id: 4, key: 'wound', class: 'survival', kind: 'favor', hpMul: 0.82, ev: 1 }),           // 创口
  Object.freeze({ id: 5, key: 'hard_shell', class: 'survival', kind: 'mid', defMul: 1.22, speedMul: 0.78, ev: 0 }), // 坚壳
  Object.freeze({ id: 6, key: 'thick_hide', class: 'survival', kind: 'unfavor', hpMul: 1.18, ev: -1 }),   // 厚皮
  // ---- speed ----------------------------------------------------------------------------------------------------
  Object.freeze({ id: 7, key: 'sluggish', class: 'speed', kind: 'favor', speedMul: 0.78, ev: 1 }),        // 迟缓
  Object.freeze({ id: 8, key: 'coiled', class: 'speed', kind: 'mid', speedMul: 0.7, hpMul: 1.18, ev: 0 }), // 盘踞
  Object.freeze({ id: 9, key: 'swift', class: 'speed', kind: 'unfavor', speedMul: 1.22, ev: -1 }),        // 疾行
  // ---- count / wave ---------------------------------------------------------------------------------------------
  Object.freeze({ id: 10, key: 'sparse', class: 'count', kind: 'favor', countAdd: -1, ev: 1 }),           // 稀疏
  Object.freeze({ id: 11, key: 'replace', class: 'count', kind: 'mid', countAdd: -1, hpMul: 1.3, ev: 0 }), // 替换
  Object.freeze({ id: 12, key: 'reinforce', class: 'count', kind: 'unfavor', countAdd: 1, ev: -1 }),       // 增援
]);

/**
 * 强力属性子集 (user 2026-10-17, tier 2): every event ALSO marks a share of that round's enemies as 强力 — the normal
 * wave AND the 赏金怪 (tag 'bounty'); the share range moves with the sequence (EVENT_SEQUENCE.eliteShares:
 * E1 10–15 %, E2 15–20 %, E3 20–25 %). One attribute is drawn per event (1 of these 4), and the marked units get its
 * multiplier ON TOP of the monster card's own mods. The bounty amount (`bounty.coins`) is never recalculated.
 *   獠牙 fangs      attack +25 %  (atkMul 1.25)
 *   厚皮 thick_hide health +30 %  (hpMul 1.30)
 *   坚壳 hard_shell armor  +25 %  (defMul 1.25)
 *   疾行 swift      move   +20 %  (speedMul 1.20)
 * The count is max(1, round(share × the wave's monster count, 赏金怪 included)).
 */
export const EVENT_FOE_ELITES = Object.freeze([
  Object.freeze({ key: 'fangs', atkMul: 1.25 }),
  Object.freeze({ key: 'thick_hide', hpMul: 1.30 }),
  Object.freeze({ key: 'hard_shell', defMul: 1.25 }),
  Object.freeze({ key: 'swift', speedMul: 1.20 }),
]);

// v0.3.3 上游新增（开局重抽冷却），插件这份 shared/constants.js 会顶替核心同名文件，必须同步，否则核心模块取不到这个导出。
export const SETUP_REROLL_COOLDOWN_MS = 30_000;


// ---- 干员强化（海克斯增益类会改写这几项）：从 hexmod 移植，纯数据 + 一个纯函数 ----
export const OPS_BUFF_STEP = 0.1;

export const OPS_BUFF_MAX = 10;

export const OPS_BUFF_ASPD_STEP = 10;

export const OPS_BUFF_STATS = Object.freeze(['hp', 'atk', 'def', 'res', 'aspd']);

export const OPS_BUFF_ZERO = Object.freeze({ hp: 0, atk: 0, def: 0, res: 0, aspd: 0 });

export function normalizeOpsBuffs(v) {
  const src = v && typeof v === 'object' ? v : {};
  const out = {};
  for (const k of OPS_BUFF_STATS) {
    const n = Math.trunc(Number(src[k]));
    out[k] = Number.isFinite(n) ? Math.max(0, Math.min(OPS_BUFF_MAX, n)) : 0;
  }
  return out;
}

export function opsBuffMods(v) {
  const n = normalizeOpsBuffs(v);
  if (OPS_BUFF_STATS.every((k) => n[k] === 0)) return null;
  return {
    hpMul: 1 + n.hp * OPS_BUFF_STEP,
    atkMul: 1 + n.atk * OPS_BUFF_STEP,
    defMul: 1 + n.def * OPS_BUFF_STEP,
    resMul: 1 + n.res * OPS_BUFF_STEP,
    aspdFlat: n.aspd * OPS_BUFF_ASPD_STEP,
  };
}


// ---- 房间旗子（海克斯/无尽等玩法开关）：从 hexmod 移植 ----
export const ROOM_FLAGS_ZERO = Object.freeze({ bondLayerUncap: false, bondShopBias: false, hexEnabled: true, hexTriple: false, endless: false, buySlot: false, keepFunds: false });

export const ROOM_FLAG_KEYS = Object.freeze(Object.keys(ROOM_FLAGS_ZERO));

export function normalizeRoomFlags(v) {
  const src = v && typeof v === 'object' ? v : {};
  const out = {};
  for (const k of ROOM_FLAG_KEYS) out[k] = typeof src[k] === 'boolean' ? src[k] : ROOM_FLAGS_ZERO[k];
  return out;
}
