// Shared enums & constants (server + browser). Pure ESM, no Node APIs.

import { N_ } from './i18n.js';
import { EXTRA_EMOTE_THEMES } from './emoteExtraPack.js';

export const PROTOCOL_VERSION = 1;
/** Release version shown to players (title screen, server banner, /healthz). Kept equal to package.json "version"
 * (test/version.test.js); PROTOCOL_VERSION above is the separate wire-format number. */
export const APP_VERSION = '0.4.3';
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

/**
 * Four players remain the BASELINE for economy, leader HP and the pool layout; capacity is how many may sit down.
 *
 * Ported from the `feat/IncreasePlayerCapacity` fork (LongQianChen/Stronghold-Protocol, docs/PLAYER_CAPACITY.md). The
 * owner asked for a 20-seat ceiling, which is the fork's own MAX_SEATS, so every proportional rule below keeps the
 * fork's arithmetic: a group of at most BASE_SEATS shares one shop pool, and anything that scaled with players is
 * expressed as `players / BASE_SEATS` rather than against MAX_SEATS.
 *
 * Capacity count includes AI seats (a room may be filled with bots), so `players` in those formulas is the number of
 * seated participants, not the number of humans.
 */
export const BASE_SEATS = 4;
export const MAX_SEATS = 20;
/** Seats a room opens with: 4 keeps the original game exactly as it was, and the host raises it explicitly. */
export const DEFAULT_SEATS = 4;

/**
 * 房间简介的最大长度,按**码点**计(owner:「打开可以给房间写简介」)。
 *
 * 放在 shared 而不是 server:协议层(`shared/protocol.js` 的 `room.setDesc` 校验)
 * 和服务端净化(`server/lobby.js` 的 `cleanRoomDesc`)**都要用同一个数**。
 * `shared/` 不能 import `server/`,所以只能定义在这里。
 *
 * 60 个码点:够写「新手友好 只打合约 欢迎躺赢」这类一句话,又不会把房间列表撑成两行。
 */
export const ROOM_DESC_MAX = 60;
/**
 * Selectable room capacities.
 *
 * 3 的倍数 (owner):12 = 三组各 4 人 (`poolGroupSizes(12)` → [4,4,4]),每个分队刚好满员 —— 分队人数与
 * BASE_SEATS 一致,商店池最整齐。8 与 16 同理([4,4] / [4,4,4,4]),4 是原版基准。20 是房间上限。
 *
 * ⚠ 5/6/7 **现在**也能分队了(`poolGroupSizes(5)` → [3,2],6 → [3,3],7 → [4,3]),所以"会留下单人组"
 * 这个旧理由不再成立 —— 这份清单只列 3 的倍数,是 owner 定的档位,不是技术限制。
 */
export const ROOM_CAPACITIES = Object.freeze([4, 8, 12, 16, 20]);
/**
 * Display names of the shop-pool groups ("squads", 分队) by 1-based pool id.
 *
 * Shared because BOTH sides name them: the member panel (public/js/ui/teamPanel.js) labels the squad rows, and the
 * match announces a 联防 defence group as 「Alpha分队 × Beta分队」 (server/match/match/unitePhase.js). Five pools is
 * the most a 20-seat room has, so the first five are all that can ever show; the rest is a safety margin.
 */
export const SQUAD_NAMES = Object.freeze(['Alpha', 'Beta', 'Gamma', 'Delta', 'Epsilon', 'Zeta', 'Eta', 'Theta']);
/**
 * Cards a draft of this game mode is DEALT, and therefore the largest `g.choice` index the protocol accepts.
 *
 * Sized by capacity: `coopDraftCardCount` hands out a base of two cards plus one per living player, uncapped, so a full
 * 20-seat room deals 22 and the last index is 21. Keep this in step with that formula — if it ever falls below the real
 * deal, the server rejects a pick the client is showing (the index fails validation before the match ever sees it).
 */
export const MAX_DRAFT_CARDS = MAX_SEATS + 2;
/**
 * Spectator seats of a co-op room (community report #26, owner's decision 2026-10-04) — a remake feature: the official
 * room has 1–4 players and no spectator seat (there only eliminated players and 联防 bystanders watch, research 09 §3.1).
 * A spectator never counts as a player, may not act, and watches like an eliminated player (server/lobby.js spectate,
 * server/match/match/watch.js addSpectator).
 */
export const MAX_SPECTATORS = 10;
/**
 * 分组拦截 (联防) tunables.
 *
 * `UNITE_ABANDON_RATIO` is the share of LIVING players that must agree before the current defence group is pulled off
 * its zone early (the owner's rule: 80 %). It is a ratio rather than a head count so the same rule reads the same in a
 * 4-seat room and a 20-seat one; the count is `ceil(living × ratio)`, and a room of one always passes.
 */
export const UNITE_ABANDON_RATIO = 0.8;
export const ROOM_CODE_LEN = 4;
export const NAME_MAX_LEN = 12;

export const DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
// Labels / colours only — the two name→text maps are looked up by key, never iterated, so a key the pickers do not
// list (训练模式, see TRAINING_DIFFICULTY) costs nothing to a normal mode and gives its card a real name when shown.
export const DIFFICULTY_NAMES = { FUNNY: N_('标准模拟'), NORMAL: N_('险境模拟'), HARD: N_('绝境模拟'), ABYSS: N_('终极模拟'), TRAINING: N_('入门协议') };
export const DIFFICULTY_COLORS = { FUNNY: '#f6a329', NORMAL: '#e85a1a', HARD: '#e73118', ABYSS: '#ff0024', TRAINING: '#4ed8af' };

/**
 * 训练模式 (入门协议, data/config.json `mode_training_1`: type LOCAL, difficulty TRAINING, lastRound/bossRound 4,
 * spRounds [3]). Deliberately NOT a member of DIFFICULTIES / LEGACY_DIFFICULTIES: every mode picker, reward table,
 * ban list and difficulty ladder keys off those two lists, and the training mode is a solo-only local mode that
 * awards nothing (server/match/results.js). It is gated on its own — solo rooms whose data carries the mode record
 * (server/lobby.js `offersTraining`).
 */
export const TRAINING_DIFFICULTY = 'TRAINING';
export const TRAINING_MODE_ID = 'mode_training_1';

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

// modeId in data/config.json = `mode_${type}_${difficulty.toLowerCase()}` with type single|multi.
// 训练模式 has no single/multi family in its id: it is always `mode_training_1` (whatever the room mode — a LOCAL mode
// is single-player by gamedata `isSolo`, the caller gates which room modes may ask for it).
// 肉鸽（`mode: 'rogue'` 独立模式，或老写法 `variant: 'rogue'`）有自己的一族 `mode_rogue_<难度>`（数据里 20 档齐全）：
// 不传第三个参数时老的两参调用结果一个字都不变（solo → single，其余 → multi）。
export const modeIdFor = (roomMode, difficulty, variant) =>
  difficulty === TRAINING_DIFFICULTY
    ? TRAINING_MODE_ID
    : `mode_${variant === 'rogue' || roomMode === 'rogue' ? 'rogue' : roomMode === 'solo' ? 'single' : 'multi'}_${difficulty.toLowerCase()}`;

export const PHASE = Object.freeze({
  LOBBY: 'LOBBY',
  INFO_CHECK: 'INFO_CHECK',
  BAND_DRAFT: 'BAND_DRAFT',
  SELF_LIMIT_DRAFT: 'SELF_LIMIT_DRAFT',
  BATTLE_CHECK: 'BATTLE_CHECK',
  ROUND_START: 'ROUND_START',
  SP_DRAFT: 'SP_DRAFT',
  PREP: 'PREP',
  WAVE_PREVIEW: 'WAVE_PREVIEW',
  COMBAT: 'COMBAT',
  UNITE: 'UNITE',
  SETTLE: 'SETTLE',
  FINAL_ASSAULT: 'FINAL_ASSAULT',
  HIDDEN_CORE: 'HIDDEN_CORE',
  RESULT: 'RESULT',
});

export const PHASE_NAMES = {
  LOBBY: N_('等待中'), INFO_CHECK: N_('确认本局信息'), BAND_DRAFT: N_('选择策略'), SELF_LIMIT_DRAFT:N_('自限抉择'), BATTLE_CHECK: N_('协议启动'),
  ROUND_START: N_('回合开始'), SP_DRAFT: N_('机变阶段'), PREP: N_('休整期'), WAVE_PREVIEW: N_('准备迎敌'), COMBAT: N_('作战中'), UNITE: N_('联防阶段'),
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
 * The layers a gain of `n` actually adds to a bond holding `before` under the cap: min(n, cap − before), never
 * negative (a count already at or over the cap gains 0 and is never lowered); 0 for a non-positive / non-finite `n`
 * except +Infinity (= "the room left").
 *
 * ── 危机合约的盟约叠层上限(信号微弱 500 / 信号屏蔽 300 / 信号消失 200 / 失友 100 / 失信 50)─────────────
 *
 * 数据里的 `bondLayerCap`(上限)+ `bondLayerCapAbove`(从多少层起开始管)是一对。卡面的说法是
 * 「所有最高叠层可达 N 层以上的盟约,**本局最高只能叠到 N 层**」—— 所以 `cap` 是**硬顶**:
 * 一次叠很多也不能越过它。
 *
 * ⚠⚠ 这里曾经只处理"**已经**叠到 capAbove 以上"的情形(`if (b >= above)`),于是**一次大幅叠层会冲过上限**:
 *   层数 480、本次 +30、上限 500 → 因为 480 < 500 走了基线余量 → 落到 510,而且此后按"不倒扣"永远卡在 510,
 *   卡面承诺的"最高只能叠到 500"就不成立了(实测口径:上限越接近常见层数量级越容易撞上,500 档尤其)。
 *   现在**无条件**把本次增量压到 `cap` 以内 —— 到不了上限的盟约行为完全不变(它本来就碰不到那条线),
 *   能碰到的则严格停在上限。`capAbove` 仍然接受(数据里一直是与 `cap` 同值:`500/500`…`50/50`),
 *   但在新口径下它只是注释性的:真正决定"能到多少"的是 `cap` 本身。
 *
 * 注意**不是把现有层数砍下来**(那会回退玩家的进度):`before` 已经超过 `cap` 时按"没有余量"处理(只能保持不变)。
 * 所以是"卡住增长",不是"倒扣"。
 *
 * @param {number} before 当前层数
 * @param {number} n 想加多少
 * @param {{ cap?: number|null, capAbove?: number|null }} [opts] 合约给的额外上限
 */
export function layerGainRoom(before, n, opts = null) {
  if (!(n > 0)) return 0;
  const cap = BOND_LAYER_CAP > 0 ? BOND_LAYER_CAP : Infinity;
  const b = Number.isFinite(before) && before > 0 ? before : 0;
  let room = Math.max(0, Math.min(n, cap - b));
  const fxCap = opts && Number.isFinite(opts.cap) ? opts.cap : null;
  if (fxCap != null && fxCap < cap) room = Math.max(0, Math.min(room, Math.max(0, fxCap - b)));
  return room;
}

/** Owner override (2026-10-19): each boss HP-damage instance is capped at 1,000,000 after mitigation and
 * multipliers, before shields. Applies to every boss, including the hidden core. Excess is truncated; the hit still
 * lands and is credited. Scripted pool shares (`noHitLimit`) are not attack damage and retain their intended size.
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
  SPECTATOR: 'SPECTATOR',         // a spectator seat only watches (MAX_SPECTATORS)
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
  // 被封禁 (server/admin.js): 名字 / 玩家 id 命中封禁名单时 net.js 用它回绝一次 hello
  BANNED: 'BANNED',
  /*
   * 登录准入令牌不对 (server/access.js): 服务器设了准入码、而这次 hello 没带或带错时用它回绝。
   *
   * 单独一个码而不是复用 BAD_MSG:客户端要据此**清掉本地存的码并提示"需要令牌请加 QQ"**,
   * 混在通用错误里玩家只会看到一句无意义的失败。
   */
  ACCESS_DENIED: 'ACCESS_DENIED',
  // 管理端关掉了建房 (server/admin.js roomBanReason): 原来借用 RATE,客户端把它显示成「操作过于频繁」——
  // 那是限流的意思,和「管理员关了这个功能」完全是两回事
  ROOM_DISABLED: 'ROOM_DISABLED',
});

export const ERR_TEXT = {
  SESSION_IN_USE: N_('此对局仍在其他窗口中，或当前浏览器无法安全恢复。请关闭原窗口后重试。'),
  BAD_MSG: N_('无效的请求'), RATE: N_('操作过于频繁'), NOT_IN_ROOM: N_('你不在房间中'), ROOM_NOT_FOUND: N_('未找到该同盟密钥对应的房间'),
  ROOM_FULL: N_('房间已满'), ROOM_STARTED: N_('模拟已开始'), NOT_HOST: N_('只有房主可以操作'), NOT_READY: N_('仍有玩家未就绪'),
  WRONG_PHASE: N_('当前阶段无法进行该操作'), NO_FUNDS: N_('资金不足'), HAND_FULL: N_('整备区已满'), BOARD_FULL: N_('已达到部署上限'),
  BAD_TILE: N_('无法部署在该位置'), BAD_TARGET: N_('无效的目标'), SOLD_OUT: N_('已售出'), MAX_LEVEL: N_('调度中心已达最高等级'),
  NOT_YOUR_TURN: N_('尚未轮到你'), ALREADY: N_('已完成该操作'), TEMP_NOT_EMPTY: N_('临时整备区不为空'), ELIMINATED: N_('你已被淘汰'),
  SPECTATOR: N_('观战中无法进行该操作'), INTERNAL: N_('服务器内部错误'),
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
  BANNED: N_('你已被管理员封禁'),
  /*
   * 登录准入令牌不对 (server/access.js)。owner 的原话要在界面上说清楚 ——
   * 玩家只会看到这一句,不该让他以为"服务器坏了"。
   */
  ACCESS_DENIED: N_('需要登录令牌：请在登录界面填写服务器发放的令牌。本服务器因被未经授权收录到统计网站而设此限制，需要令牌请添加审核群 442017376'),
  ROOM_DISABLED: N_('目前禁止创建房间'),
  TEST_CONFIRM: N_('这是测试房间，不计入任何记录。确认加入？'),
  TEST_DISABLED: N_('测试模式未开启'),
  TEST_FORBIDDEN: N_('这不是测试房间'),
};

// ---- Emotes (交流, research 09 §4) -----------------------------------------------------------------------------
// The official in-match emotes: display_meta_table emoticonData, scene AUTOCHESS_BATTLE, 6 themes × 6, one wheel
// page per theme in activity_table autoChessData.enabledEmoticonThemeIdList order, emotes by sortId. `g.emote { id }`
// / `m.emote { playerId, id }` carry the official emoji id. Generated reference: data/emotes.json
// (tools/build-emotes.mjs). ⚠ 第 7 套「团长加料」是**本分叉自己加的**(owner 给的图),不在那份官方数据里 ——
// 所以上面那句"和 data/emotes.json 保持一致"只对前 6 套成立(那个对账测试已经不存在了,见下面那套的注释)。
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
  /*
   * ── 团长带来的额外表情 (owner:「然后这两个做成额外表情包 所有人都能用」) ────────────────────────────
   *
   * ⚠ 这一套**不来自官方数据** —— 前 6 套是 `data/emotes.json`(display_meta_table)的副本,
   *   而这一套是 owner 直接给的图,所以 `themeId` / `id` / `picId` 都是我们自己起的。
   *   它和官方那几套走**完全相同**的机制(同一张 `EMOTE_CATALOG`、同一个 `g.emote` 协议、
   *   同一套 `/assets/local/emoticon/<dir>/<picId>.png` 取图),所以不需要任何特判。
   *
   * `sortId` 给 2000 起 —— 官方那几套用的是 1001~1065 与 2001~2006(`slug` 占了 2001),
   * 这里从 2100 开始,和所有官方条目都不撞,排序上也稳定排在最后。
   *
   * `dir` = `emoticon/<dir>` 那个目录名,要和服务端 `/assets/local/emoticon/<dir>/` 下的文件一致。
   *
   * 图是 **120×120 带原背景的 PNG**(和官方那几套的规格一致)。
   * ⚠ 我一开始按官方表情"透明底"的样子去抠图,结果这几张人物身上的浅色(皮肤、浅绿头发、
   *   白帽子)与背景只差几个色阶,洪水填充**穿进人物把它抠没了** —— owner 一句
   *   「不用抠图啊」点醒:保留背景既好看又省事。别再试图抠它们。
   */
  { themeId: 'emoticon_commander_extra', dir: 'commander', sortId: 2000, isBasic: false, name: N_('表情套组：团长加料'), emotes: [
    emo('commander_battle_hat_peek', 2100, 'pic_hat_peek', N_('偷看')),
    emo('commander_battle_angel_mozu', 2101, 'pic_angel_mozu', N_('魔族佬')),
    emo('commander_battle_black_horn', 2102, 'pic_black_horn', N_('拿棍')),
  ] },
  ...EXTRA_EMOTE_THEMES,
].map((t) => Object.freeze({ ...t, emotes: Object.freeze(t.emotes) })));
/** Every emote with its theme: `{ id, sortId, picId, label, themeId, dir }`, in wheel order. */
export const EMOTE_CATALOG = Object.freeze(EMOTE_THEMES.flatMap((t) => t.emotes.map((e) => Object.freeze({ ...e, themeId: t.themeId, dir: t.dir }))));
/** Every emote id we accept (`g.emote` protocol whitelist) — the official 36 plus the extra set. */
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
/** Canonical URL from the fixed catalog; official PNG defaults and original custom GIF/JPEG formats. */
export const emoteArtPath = (id) => { const e = emoteInfo(id); return e ? `/assets/local/emoticon/${e.dir}/${e.picId}.${e.ext || 'png'}` : null; };
export const EMOTE_COOLDOWN_MS = 1000; // activity_table autoChessData.constData.chatCD (s)
/**
 * How long an emote bubble lives, in ms. 3000 → 4000 → **6000**, each step following a slower fly-through
 * (`emotes.css` `emo-fly`: 2800ms → 3800ms → 5200ms): the flight must fit inside the lifetime or it is cut off
 * mid-crossing, which is a bug this pair has already produced once. `data/config.json` `timers.chatBubble`
 * carries the same number for the live path (`screens/game.js` reads the config first) — keep the two in step.
 */
export const EMOTE_BUBBLE_MS = 6000;

/**
 * 对局文字聊天 (typed chat in a match).
 *
 * `CHAT_MAX_LEN` is in CHARACTERS, not bytes: a Chinese line is the normal case here, so a byte budget would cut it
 * to a third. 40 fits a full sentence plus punctuation without letting one player flood the log.
 *
 * The cooldown is its own, not the emotes': a text line is more disruptive than an emote, so it is longer — and
 * sharing one budget would mean an emote could block a line the player actually needed to send.
 */
export const CHAT_MAX_LEN = 40;
export const CHAT_COOLDOWN_MS = 2000;
/** How long a line stays on screen before it fades (user brief; +3 s per the owner on 2026-10-08: 15 s → 18 s). */
export const CHAT_LINE_MS = 18000;
/** How many lines are shown at once; beyond this the oldest fades out early (user brief). */
export const CHAT_VISIBLE = 6;
/** How many lines the client keeps for the history view. */
export const CHAT_KEEP = 60;

/**
 * 房间聊天 (room.chat / m.roomChat) — how many lines a ROOM keeps.
 *
 * Shared because BOTH sides bound the same list against each other: the server keeps the room's log (it replays the
 * whole thing in `room.state` on every join, so it cannot grow without limit) and the client trims its copy to the
 * same number, so the two never disagree about how far back the conversation goes.
 *
 * Separate from `CHAT_KEEP` on purpose: that one is the in-match HISTORY view (60 lines the player can scroll), while
 * this is the room panel's whole log — a room is a short-lived place, and a joiner should not receive a screenful.
 */
export const ROOM_CHAT_KEEP = 60;

// --- 0.3.3 服务端兼容：0.4.3 shared 移除但 0.3.3 match 仍导入的常量 ---
export const SETUP_REROLL_COOLDOWN_MS = 30_000;

// --- 0.3.3 服务端兼容：N1–N20 / 旧 4 档别名 ---
export const LEGACY_DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
export const DIFFICULTY_TIERS = Array.from({ length: 20 }, (_, i) => `N${i + 1}`);
export const LEGACY_DIFFICULTY_ALIAS = Object.freeze({ FUNNY: 'N1', NORMAL: 'N8', HARD: 'N14', ABYSS: 'N20' });
export const difficultiesFor = (roomMode) => (roomMode === 'rogue' ? DIFFICULTY_TIERS : LEGACY_DIFFICULTIES);
export const difficultyRank = (d) => {
  const i = DIFFICULTY_TIERS.indexOf(d);
  if (i >= 0) return i + 1;
  const a = LEGACY_DIFFICULTY_ALIAS[d];
  return a ? DIFFICULTY_TIERS.indexOf(a) + 1 : 0;
};
