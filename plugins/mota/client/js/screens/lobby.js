import { LobbyMusicButton } from '../ui/lobbyMusic.js';
import { AccountMeChip } from '../ui/accounts.js';
import { isOwnerName, decorateOwnerName } from '../ui/ownerName.js';
import { enabled as federationEnabled } from '../federation.js';
import { MatchmakingCount } from '../ui/matchmaking.js';
import { Emblem } from './title.js';
import { useHubBackdrop, HubBackdrop, HubRadar, BackdropSettings, BackdropGlyph, backdropTheme } from '../ui/hubBackdrop.js';
// Lobby screen — a hub (owner's request, 2026-10-13): an original backdrop (ui/hubBackdrop.js: generated night scenes or
// the player's own picture) with the game's dot-matrix emblem in the middle, a left column (密钥加入 · tips), a right
// column (缺人同盟 card · S.W.E.E.P.报告 (screens/sweep.js) · 干员调配) and four big entries at the bottom right:
// 独立模拟 / 同盟模拟 / 无限火力 open the start sheet (difficulty 标准/险境/绝境/终极, 无限火力's variant, private room,
// 快速匹配, create), 搜寻队友 opens the room list. The 密钥加入 dialog joins with a 同盟密钥 (recent codes remembered) —
// as a player (加入同盟) or in one of its MAX_SPECTATORS spectator seats (观战: room.spectate, also while its match
// runs; community report #26; the read-only test-room mark comes from the server). The top bar opens the read-only
// S.W.E.E.P.报告 (screens/sweep.js: 盟约 / 策略 / 敌方资料 and the enemy codex). The server is picked on the title screen.
//
// Difficulty descriptions come from data/config.json `modes[modeId]` when present, else from the
// official act2autochess `modeDataDict` texts embedded below (desc + effectDescList), so the
// screen is complete before data is generated. Rounds: solo 标准 = 9, everything else 14 (+R15
// hidden core on 险境+), per research 00-INDEX §2. Battlefield pool (`modes[].stages`): 标准 always
// plays 战场#01, 险境 draws one of 8, 绝境 / 终极 one of 7 (m01 excluded).
// Texts go through t() (docs/I18N.md); the module-level tables hold msgids (N_) translated where they are shown, the
// config.json mode texts come localized from data.js.

import { TestMark } from '../ui/testConsole.js';
import { ResumeMatchButton } from '../ui/resumeMatch.js';
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { DIFFICULTIES, LEGACY_DIFFICULTIES, difficultiesFor, DIFFICULTY_NAMES, DIFFICULTY_COLORS, ROOM_CODE_LEN, MAX_SEATS, MAX_SPECTATORS, modeIdFor, ERR, ERR_TEXT } from '../../../shared/constants.js';
import { RANDOM_MODE } from '../../../shared/randomMode.js';
import { html, confirmDialog, Button, Icon, MicroLabel, Panel, TextField, PingPill, Tooltip, Spinner, DifficultyIcon } from '../ui/components.js';

import { toast, toastError } from '../ui/toasts.js';
import { GuideButton, openGuide } from '../ui/guide.js';
import { openStats } from './stats.js';
import { AchievementEntry, AchievementPanel } from '../ui/achievements.js';
import { FriendsTile } from '../ui/friends.js';
import { SettingsButton } from '../ui/settings.js';
import { PwaInstallButton, fullscreen } from '../ui/device.js';
import { LoadoutButton } from './loadout.js';
import { SweepReport } from './sweep.js';
import { ProtocolScene } from '../ui/protocolScene.js';
import { SearchPanel, RadarScene, CreateArt, JoinArt } from '../ui/matchFlow.js';
import { useLeave } from '../ui/transitions.js';
import { net, identity } from '../net.js';
import { store, useStore, shallowEqual, loadPref, savePref } from '../store.js';
import { data, getConfig, getMode, getStage, useData } from '../data.js';
import {
  AnnouncementBoard, announcementRevision, announcementDismissed, dismissAnnouncement,
} from '../ui/announcements.js';
import { t, tc, N_ } from '../../../shared/i18n.js';
import { NoticesButton } from '../ui/notices.js';
// 官方版本（DESIGN §35.23）：与核心 screens/lobby.js 同一个 chip。插件不覆盖 ui/versionPicker.js 与 versions.js，
// 所以这里拿到的是核心组件；它只读 store 的 versions / lobbyVersion 与 content.js 的 contentSet（本插件 store.js 同口径）。
import { VersionSwitch } from '../ui/versionPicker.js';
import { C2S as SERVER_C2S } from '../../../shared/protocol.js';
import { DEFAULT_DIFFICULTY, parsePlaytestParam } from './lobbyLinks.js';   // 协同共竞: xieRoom 与深链共用（Forge 转发层）

// 对抗规则 dock 的样式只在插件里（css/screens/proto-dock.css），核心 index.html 不引用它：首次加载本模块时注入一次。
// 与 game.js 注入 hex.css 同法；插件的客户端覆盖按同路径顶替页面资源，所以 /css/screens/proto-dock.css 拿到的是插件那份。
if (typeof document !== 'undefined' && document.head && !document.querySelector('link[data-sp-plugin-css="proto-dock"]')) {
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/proto-dock.css';
  link.setAttribute('data-sp-plugin-css', 'proto-dock');
  document.head.appendChild(link);
}

/** Official mode texts (activity_table act2autochess.modeDataDict), fallback when config.json is absent. */
export const MODE_TEXT = {
  single: {
    FUNNY: { code: 'AC-1', desc: N_('时长较短的模拟训练'), effects: [N_('可以快速完成作战'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
  multi: {
    FUNNY: { code: 'AC-1', desc: N_('敌方攻击强度较低的模拟训练'), effects: [N_('作战环境较为温和'), N_('常规奖励')] },
    NORMAL: { code: 'AC-2', desc: N_('敌方攻击强度较高的模拟训练'), effects: [N_('可使用盟约数增加'), N_('大幅增加奖励')] },
    HARD: { code: 'AC-3', desc: N_('敌方攻击强度极高的模拟训练'), effects: [N_('作战环境困难'), N_('出现更加危险的敌人')] },
    ABYSS: { code: 'AC-4', desc: N_('敌方攻击强度到达极限的模拟训练'), effects: [N_('作战环境无比困难'), N_('出现极度危险的敌人')] },
  },
};

/** Battlefield pool per difficulty when config.json is absent (the modes' `stages` lists; same for solo and co-op). */
export const STAGE_POOL = { FUNNY: ['act1autochess_m01'], NORMAL: 8, HARD: 7, ABYSS: 7 };

/**
 * Display name of a stage: stages.json when it is loaded, else derived from the id (act1 m0N → 战场#0N, act2 m0N → 战场#0(N+4)).
 * From the data name only its 战场#NN part (with a (上半) / (下半) mark) — 'Battlefield #NN (First Half)' in English.
 * @param {string} id e.g. 'act1autochess_m01'
 */
export function stageLabel(id) {
  const rec = getStage(id);
  if (rec && typeof rec.name === 'string' && rec.name) {
    const m = rec.name.match(/^(.*?#\d+(?:\s*[(（][^)）]*[)）])?)/);
    return m ? m[1] : rec.name.split(/\s+/)[0];
  }
  const m = String(id || '').match(/^act(\d)autochess_m(\d+)$/);
  return m ? t('战场#{no}', { no: String(Number(m[2]) + (m[1] === '2' ? 4 : 0)).padStart(2, '0') }) : '';
}

/**
 * The battlefield note of a difficulty (official wording): a single-stage pool is fixed ("战场固定为 战场#01"), a larger
 * one is drawn at random ("战场随机（共8张）").
 * @param {string[] | number | null | undefined} stages the mode's `stages` list (or a count)
 * @returns {string} '' when unknown
 */
export function stageNote(stages) {
  if (Array.isArray(stages)) {
    const ids = stages.filter((s) => typeof s === 'string' && s);
    if (ids.length === 1) { const name = stageLabel(ids[0]); return name ? t('战场固定为 {name}', { name }) : t('战场固定'); }
    return ids.length > 1 ? t('战场随机（共{n}张）', { n: ids.length }) : '';
  }
  return Number.isInteger(stages) && stages > 1 ? t('战场随机（共{stages}张）', { stages }) : '';
}

/** 娱乐模式 → 肉鸽：直接进协议页时用的模式卡（MODE_CARDS 没有肉鸽这一格，标题与简介按它显示）。 */
const ROGUE_CARD = {
  id: 'rogue', name: N_('肉鸽模式'), en: 'ROGUELIKE', icon: 'rogue',
  desc: N_('开局与之后每 2 回合各抽一次藏品三选一（每人本局最多 3 件），每回合随机词缀、事件期出随机事件、每回合换战场；同时开启协同团队储备。'),
};

/**
 * 肉鸽「地图主题池」 (2026-11-06)：大厅「选择模拟协议」左列的选择器。
 * 池 id 与官方全名以 shared/rogueThemes.js 为权威（服务端按它过滤选图）；浏览器拿到的是插件挂载树
 * （/js/…，与 /shared/… 是两套路径），不能 import 根 shared 的新文件，所以这里留一份同值的短表 ——
 * 改池 id / 主题名时两处一起改。`acc` 只是该选项的强调色（`.vsopt` 的 `--acc`，与对抗规则 dock 同一套样式）。
 */
const ROGUE_MAP_POOLS = [
  { id: 'all', code: 'ALL', short: N_('全部'), name: N_('全部主题'), acc: 'var(--gold-2)',
    title: N_('全部主题：不按主题过滤，官方全部肉鸽图都可能成为战场') },
  { id: 'ro1', code: 'R1', short: N_('傀影'), name: N_('傀影与猩红孤钻'), acc: 'var(--red)',
    title: N_('傀影与猩红孤钻（ro1）：只从这一主题的官方地图里抽战场') },
  { id: 'ro2', code: 'R2', short: N_('水月'), name: N_('水月与深蓝之树'), acc: 'var(--ice)',
    title: N_('水月与深蓝之树（ro2）：只从这一主题的官方地图里抽战场') },
  { id: 'ro3', code: 'R3', short: N_('银凇'), name: N_('探索者的银凇止境'), acc: '#cfe6ff',
    title: N_('探索者的银凇止境（ro3）：只从这一主题的官方地图里抽战场') },
  { id: 'ro4', code: 'R4', short: N_('萨卡兹'), name: N_('萨卡兹的无终奇语'), acc: 'var(--orange)',
    title: N_('萨卡兹的无终奇语（ro4）：只从这一主题的官方地图里抽战场') },
  { id: 'ro5', code: 'R5', short: N_('岁'), name: N_('岁的界园志异'), acc: '#8fd6a8',
    title: N_('岁的界园志异（ro5，含 DLC 图）：只从这一主题的官方地图里抽战场') },
  { id: 'ro6', code: 'R6', short: N_('黑流树海'), name: N_('沉沦者的黑流树海'), acc: 'var(--violet)',
    title: N_('沉沦者的黑流树海（ro6）：只从这一主题的官方地图里抽战场') },
];

const MODE_CARDS = [
  {
    id: 'solo', name: N_('独立模拟'), en: 'SOLO SIMULATION', icon: 'user',
    desc: N_('一个人的完整对局：自己买人、布阵、升级，扛过官方排好的每一波。休整期与机变阶段不限时，可以慢慢想。'),
    points: [N_('1 名博士 · 无队友'), N_('官方波次 · 不分攻守'), N_('休整与机变不限时')],
  },
  {
    id: 'coop', name: N_('同盟模拟'), en: 'ALLIANCE SIMULATION', icon: 'users',
    desc: N_('官方合作：每人自己一套棋盘、自己的钱，共享干员池；敌人的漏怪会打到相邻阵地，最终攻势按全队生命合计。'),
    params: { n: MAX_SEATS - 1 },
    points: [N_('1–{n} 名博士 · 邀请真人队友'), N_('联防相邻阵地 · 最终攻势合并生命值'), N_('无协同资金')], pointParams: { n: MAX_SEATS },
  },
  {
    id: 'versus', name: N_('赏金 / 控怪'), badge: 'NEW', en: 'VERSUS', icon: 'sword',
    desc: N_('2V2 攻防：一队投放怪物、一队布防作战，攻守按回合交换。赏金＝官方出怪为主，你只能替换其中一部分，靠自家怪被击杀拿赏金；控怪＝这一波出什么怪、走哪条路线、什么时候进场，全部由你决定。'),
    points: [N_('固定 2V2（4 席）· 攻守轮换'), N_('赏金 / 控怪 两档 · 控怪可关掉攻守交换 · 事件期挑强化')],
  },
  {
    id: 'xie', name: N_('协同共竞'), badge: 'NEW', en: 'JOINT OP', icon: 'dice',
    desc: N_('两人共竞：全队共用一个团队储备——防守奖励和主动存入把钱攒起来，用它买商店升级、借给队友救急、给快死的人发救济，倒下的队友还能被救回来。'),
    points: [N_('1–2 名博士 · 可带 AI 队友'), N_('团队储备：商店升级 / 借贷 / 救济 / 救援')],
  },
];

/** 无限火力分支（随机模式 variant）：快速突袭 9 回合 / 持久鏖战 13 回合。 */
const VARIANT_CARDS = [
  {
    id: 'blitz', name: '快速突袭', en: 'BLITZ', desc: `固定 ${RANDOM_MODE.totalRounds} 回合短局，紧凑刺激的数值节奏。`,
  },
  {
    id: 'endurance', name: '持久鏖战', en: 'ENDURANCE', desc: `固定 ${RANDOM_MODE.endurance.totalRounds} 回合长局，曲线平滑拉长，供深度养成构筑。`,
  },
  { id: 'marathon', name: '最长时赛', en: 'MARATHON', desc: `固定 ${RANDOM_MODE.marathon.totalRounds} 回合超长局，逐回合悬赏，极限养成拉锯。` },
];

/** 随机模式分支偏好（localStorage）。 */
export function firepowerVariantPreference() {
  const v = loadPref('lobby.firepowerVariant', 'blitz');
  return v === 'endurance' || v === 'marathon' ? v : 'blitz';
}

/** A presentation choice; the protocol still uses solo/coop plus Room.random. */
export function lobbySimulationPreference() {
  const selected = loadPref('lobby.simulation', null);
  if (MODE_CARDS.some((c) => c.id === selected)) return selected;
  // Preserve the old random toggle, including random solo preferences, as the new dedicated mode.
  if (loadPref('lobby.random', false) === true) return 'firepower';
  return loadPref('lobby.mode', 'coop') === 'solo' ? 'solo' : 'coop';
}

function preferredDifficulty(simulation) {
  const key = simulation === 'firepower' ? 'lobby.firepowerDifficulty' : 'lobby.difficulty';
  const d = loadPref(key, 'FUNNY');
  // 2026-11-03：N1–N20 只属于肉鸽；切回标准/同盟/对抗/协同共竞时把 N 档收敛成 FUNNY。
  return difficultiesFor(simulation).includes(d) ? d : 'FUNNY';
}

/** Keep the explanation tied to the shared balance configuration. */
export function firepowerFeatures(variant = 'blitz') {
  const { multipliers, firepower, shop, lowTier, band, rounds, endurance, marathon, evolution, opening } = RANDOM_MODE;
  const v = variant === 'endurance' ? endurance : variant === 'marathon' ? marathon : { totalRounds: RANDOM_MODE.totalRounds, leaders: rounds.leaders };
  const leaderRounds = Object.keys(v.leaders).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const bossSpan = leaderRounds.length ? `第 ${leaderRounds[0]}–${leaderRounds.at(-1)} 回合` : '中后段回合';
  return [
    { title: '强势阵营', text: `开局逐轮发放无限火力模组：装备后生命与攻击 ×${opening.modBuff.hpMul}，防御提升 ${Math.round((opening.modBuff.defMul - 1) * 100)}%，每场可复活一次；盟约层数无上限成长。` },
    { title: '技能回转', text: `全员技力恢复加速 ${Math.round((firepower.spRecoveryMul - 1) * 100)}%，保留原生技能轴；再部署缩短 ${Math.round((1 - firepower.redeployMul) * 100)}%。` },
    { title: '开局成型', text: `${shop.startLevel} 级商店、${shop.startFunds} 资金开局；干员盲盒 ${shop.revealChoices} 选 1，部署上限 9 人，每人 ${band.picksPerPlayer} 个策略。` },
    { title: '阶段质变', text: `第 ${evolution.rounds.join('/')} 回合休整期三选一：层数共鸣 / 生机坚壁 / 军备充盈。` },
    { title: '轻松也有挑战', text: `${v.totalRounds} 回合密集怪潮，${bossSpan}悬赏首领轮换；每回合随机效果，${lowTier.lowTierMax} 阶及以下干员也有额外强化。` },
  ];
}

function FirepowerBrief({ variant, onVariant }) {
  const rounds = variant === 'endurance' ? RANDOM_MODE.endurance.totalRounds : variant === 'marathon' ? RANDOM_MODE.marathon.totalRounds : RANDOM_MODE.totalRounds;
  return html`<aside class="firepower-brief brackets" aria-label="无限火力模式特点">
    <div class="firepower-brief__head">
      <span class="firepower-brief__title">无限火力</span><span class="mode-beta">1.1</span>
      <span class="firepower-brief__hint">从标准难度开始，享受阵营成型与技能清场</span>
    </div>
    <div class="firepower-variants" role="radiogroup" aria-label="模式分支">
      ${VARIANT_CARDS.map((c) => html`<button key=${c.id} type="button" role="radio" aria-checked=${variant === c.id ? 'true' : 'false'}
          class=${`firepower-variant${variant === c.id ? ' is-selected' : ''}`} onClick=${() => onVariant(c.id)}>
        <span class="firepower-variant__name">${c.name}<span class="firepower-variant__en">${c.en}</span></span>
        <span class="firepower-variant__desc">${c.desc}</span>
      </button>`)}
    </div>
    <div class="firepower-features">${firepowerFeatures(variant).map((f) => html`<div key=${f.title} class="firepower-feature">
      <strong>${f.title}</strong><p>${f.text}</p>
    </div>`)}</div>
  </aside>`;
}

/**
 * Text for a difficulty card, preferring data/config.json.
 * @param {'solo'|'coop'} roomMode
 * @param {string} difficulty
 * @param {{ random?: boolean, variant?: string }} [opts] 随机模式: the room's random flag + variant — the variant's
 *   round count (RANDOM_MODE / variantRounds: blitz 9 / endurance 13) replaces the config's lastRound everywhere
 *   the count is shown.
 * @returns {{ code: string, desc: string, effects: string[], rounds: number, hidden: boolean, stageNote: string }}
 */
export function difficultyInfo(roomMode, difficulty, { random = false, variant = 'blitz' } = {}, modeVariant = null) {
  const fallback = MODE_TEXT[roomMode === 'single' || roomMode === 'solo' ? 'single' : 'multi'][difficulty] || { code: '', desc: '', effects: [] };
  // modeIdFor() lower-cases the difficulty: never call it with a value the server did not validate.
  // modeVariant: a rule-set variant of the room ('xie' = 协同共竞) — the cards then read mode_<variant>_<difficulty>
  const m = DIFFICULTIES.includes(difficulty) ? getMode(modeIdFor(roomMode, difficulty, modeVariant)) : null;
  const effects = Array.isArray(m?.effectDescList)
    ? m.effectDescList.map((e) => String(e).replace(/^[·•\s]+/, '')).filter(Boolean)
    : fallback.effects;
  // 随机模式: the whole run is the variant's rounds (server GameData.applyRandomRounds; variantRounds)
  const rounds = random
    ? (variant === 'endurance' ? RANDOM_MODE.endurance.totalRounds : variant === 'marathon' ? RANDOM_MODE.marathon.totalRounds : RANDOM_MODE.totalRounds)
    : Number.isFinite(m?.lastRound) ? m.lastRound : roomMode === 'solo' && difficulty === 'FUNNY' ? 9 : 14;
  return {
    code: typeof m?.code === 'string' ? m.code : fallback.code,
    desc: typeof m?.desc === 'string' ? m.desc : t(fallback.desc),
    effects,
    rounds,
    // 2026-11-02：难度换成 N1–N20 后不能再按 'FUNNY' 判 —— 看这条 mode 自己有没有隐藏核心回合
    hidden: !random && (m ? m.hiddenRound != null : difficulty !== 'FUNNY'),
    stageNote: stageNote(Array.isArray(m?.stages) && m.stages.length ? m.stages : STAGE_POOL[difficulty]),
  };
}

const CODE_RE = new RegExp(`^[A-Z0-9]{${ROOM_CODE_LEN}}$`);
/**
 * Normalise user input into a room code: accepts a pasted invite link (`…?room=ABCD`), keeps
 * upper-cased alphanumerics and clamps to the code length.
 * @param {string} v
 * @returns {string}
 */
export function normalizeCode(v) {
  let s = String(v ?? '');
  const m = s.match(/[?&]room=([A-Za-z0-9]+)/);
  if (m) s = m[1];
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, ROOM_CODE_LEN);
}

/**
 * A handler that Preact binds as `onClick=${fn}` receives the click EVENT as its first argument, and a default
 * parameter only applies to `undefined` — so `fn(c = code)` would normalise the event target into a nonsense code
 * (`String(el)` → `"[object HTMLElement]"` → "OBJE"). Only a string is ever a code; anything else falls back to the
 * input field. Returns null when neither yields a well-formed code.
 * @param {unknown} arg the argument a handler was called with
 * @param {string} field the current input-field value
 * @returns {string|null}
 */
export function codeArg(arg, field) {
  const k = normalizeCode(typeof arg === 'string' ? arg : field);
  return CODE_RE.test(k) ? k : null;
}

/**
 * Room code from a deep link query string (`?room=CODE`), or null when absent/malformed.
 * Accepts ROOM_CODE_LEN..ROOM_CODE_LEN+2 alphanumerics (the protocol's join limit).
 * @param {string} search e.g. location.search
 * @returns {string|null}
 */
export function parseRoomParam(search) {
  try {
    const raw = new URLSearchParams(search || '').get('room');
    if (!raw) return null;
    const code = raw.trim().toUpperCase();
    if (!/^[A-Z0-9]+$/.test(code)) return null;
    return code.length >= ROOM_CODE_LEN && code.length <= ROOM_CODE_LEN + 2 ? code : null;
  } catch {
    return null;
  }
}

/** Recently joined/created co-op room codes (most recent first). */
export function recentRooms() {
  const list = loadPref('recentRooms', []);
  return Array.isArray(list) ? list.filter((c) => typeof c === 'string' && CODE_RE.test(c)).slice(0, 4) : [];
}

/** @param {string} code */
export function rememberRoom(code, test = false) {
  if (!CODE_RE.test(code)) return;
  const recent = [code, ...recentRooms().filter((c) => c !== code)].slice(0, 4);
  const marks = loadPref('recentTestRooms', []);
  savePref('recentTestRooms', recent.filter(c => c === code ? test : Array.isArray(marks) && marks.includes(c)));
  savePref('recentRooms', recent);
}

export async function joinKnown(type, key, extra = {}) {
  try { return await net.request(type, { code: key, ...extra }); } catch (err) {
    if (err?.code !== ERR.TEST_CONFIRM) throw err;
    const text = type === 'room.spectate'
      ? t('这是测试房间，不计入任何记录。确认观战？')
      : t('这是测试房间，不计入任何记录。确认加入？');
    if (await confirmDialog({ title: t('测试'), text })) {
      return net.request(type, { code: key, testAck: true, ...extra });
    }
  }
}

const FALLBACK_TIPS = [
  N_('联合模拟在选择策略时可以进行一次跳过'),
  N_('调度中心即使冻结，依然可以主动刷新'),
  N_('两件同名装备可以合成一件更强力的装备'),
  N_('只有达成完美作战的队友可以进行联防'),
];
const TIP_ROTATE_MS = 5000; // matchingTipRotateInterval

/** Rotating tactical tips (config.json `tips`, weighted list of { tip, weight }). */
function TipsPanel() {
  const cfg = getConfig();
  const fallback = FALLBACK_TIPS.map((x) => t(x));
  const tips = Array.isArray(cfg?.tips)
    ? cfg.tips.map((x) => (typeof x === 'string' ? x : x?.tip)).filter((x) => typeof x === 'string' && x)
    : fallback;
  const list = tips.length ? tips : fallback;
  const [idx, setIdx] = useState(() => Math.floor(Math.random() * list.length));
  useEffect(() => {
    const id = setInterval(() => setIdx((i) => i + 1), TIP_ROTATE_MS);
    return () => clearInterval(id);
  }, []);
  const i = ((idx % list.length) + list.length) % list.length;
  return html`<div class="tips brackets">
    <div class="tips__head">
      <${Icon} name="info" />
      <span>${t('作战提示')}</span>
      <${MicroLabel}>TACTICAL TIPS<//>
      <span class="tips__idx num">${String(i + 1).padStart(2, '0')}<span class="t-dim">/${String(list.length).padStart(2, '0')}</span></span>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i - 1 + list.length)} aria-label=${t('上一条')}><${Icon} name="chevronLeft" /></button>
      <button type="button" class="tips__nav" onClick=${() => setIdx(i + 1)} aria-label=${t('下一条')}><${Icon} name="chevronRight" /></button>
    </div>
    <p key=${i} class="tips__text">${list[i]}</p>
  </div>`;
}

/**
 * 缺人同盟: public alliance rooms still waiting for doctors, fewest empty seats first (closest to starting), joinable in
 * one click. A fixed-height card — three rows, or an empty note with a shortcut to create one.
 */
export function recruitingRooms(rooms) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter((r) => r && typeof r.code === 'string' && !r.inMatch && r.humans > 0 && r.humans < (r.maxSeats || MAX_SEATS))
    .sort((a, b) => ((a.maxSeats || MAX_SEATS) - a.humans) - ((b.maxSeats || MAX_SEATS) - b.humans) || b.humans - a.humans);
}

function RecruitCard({ rooms, online, onJoin, onAll, onCreate }) {
  const open = recruitingRooms(rooms);
  return html`<section class="hub-recruit" aria-label=${t('缺人同盟')}>
    <header class="hub-recruit__head">
      <span class=${`hub-recruit__pulse${open.length ? ' is-live' : ''}`} aria-hidden="true"></span>
      <span class="hub-recruit__title">${t('缺人同盟')}</span>
      <span class="hub-recruit__en">RECRUITING</span>
      <span class="hub-recruit__n num">${open.length}</span>
    </header>
    <div class="hub-recruit__list">
      ${open.length ? open.slice(0, 3).map((r) => {
        const max = r.maxSeats || MAX_SEATS;
        const name = r.name || `同盟 #${r.code}`;
        return html`<div key=${`${r.node || ''}:${r.code}`} class="hub-recruit__row" style=${`--d-color:${DIFFICULTY_COLORS[r.difficulty] || 'var(--mint-500)'}`}>
          <span class="hub-recruit__info">
            <span class=${`hub-recruit__name${isOwnerName(r.hostName || r.name) ? ' sp-owner-name' : ''}`}>${name}</span>
            <span class="hub-recruit__meta">
              <${DifficultyIcon} difficulty=${r.difficulty} class="diff-glyph" />
              <span>${DIFFICULTY_NAMES[r.difficulty] ? t(DIFFICULTY_NAMES[r.difficulty]) : r.difficulty}</span>
              ${r.random ? html`<span class="hub-recruit__fp">无限火力</span>` : null}
              ${r.plugins ? html`<span class="hub-recruit__fp">${t('插件 ×{n}', { n: r.plugins })}</span>` : null}
              ${r.nodeName ? html`<span class="t-dim">${r.nodeName}</span>` : null}
            </span>
          </span>
          <span class="hub-recruit__seats">
            <span class="hub-recruit__pips" aria-hidden="true">${Array.from({ length: max }, (_, i) => html`<i key=${i} class=${i < r.humans ? 'is-on' : ''}></i>`)}</span>
            <span class="hub-recruit__need">${t('缺')}<b class="num">${max - r.humans}</b>${t('人')}</span>
          </span>
          <button type="button" class="hub-recruit__join" disabled=${!online} onClick=${() => onJoin(r.code, r.node)}>${t('加入')}</button>
        </div>`;
      }) : html`<div class="hub-recruit__empty">
        <span>${t('暂时没有缺人的同盟')}</span>
        <button type="button" class="hub-recruit__create" onClick=${onCreate}>${t('创建同盟')}<${Icon} name="chevronRight" /></button>
      </div>`}
    </div>
  </section>`;
}

/** 全屏 / 退出全屏 in the top bar, styled like its neighbours (hidden where the browser has no element fullscreen). */
function HubFullscreenButton() {
  const [on, setOn] = useState(() => fullscreen.active());
  const [ok] = useState(() => fullscreen.supported());
  useEffect(() => {
    const upd = () => setOn(fullscreen.active());
    document.addEventListener('fullscreenchange', upd);
    document.addEventListener('webkitfullscreenchange', upd);
    return () => { document.removeEventListener('fullscreenchange', upd); document.removeEventListener('webkitfullscreenchange', upd); };
  }, []);
  if (!ok) return null;
  const label = on ? t('退出全屏') : t('全屏');
  return html`<${Button} variant="secondary" size="sm" square=${true} icon=${on ? 'collapse' : 'expand'} class="hub-fs-btn"
    title=${label} aria-label=${label} aria-pressed=${on ? 'true' : 'false'} onClick=${() => fullscreen.toggle()} />`;
}

/** Crossed blades in a hexagon: the S.W.E.E.P. plate's glyph (original drawing). */
function SweepGlyph() {
  return html`<svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
    <path d="M16 2.5 27.7 9.2v13.6L16 29.5 4.3 22.8V9.2z" fill="none" stroke="currentColor" stroke-width="1.5" />
    <path d="M9 9l12.5 12.5M23 9 10.5 21.5" stroke="currentColor" stroke-width="2.2" />
    <path d="M19.2 23.8l4.6-4.6M8.2 19.2l4.6 4.6M21.6 21.6l2.2 2.2M10.4 21.6l-2.2 2.2" stroke="currentColor" stroke-width="1.8" />
  </svg>`;
}

/** S.W.E.E.P.报告: opens the report (screens/sweep.js — 盟约报告 / 策略报告 / 敌方资料). */
function SweepPlate({ onClick }) {
  return html`<button type="button" class="hub-plate hub-plate--sweep" onClick=${onClick} title=${t('S.W.E.E.P.报告：盟约、策略与敌方资料')}>
    <span class="hub-plate__glyph"><${SweepGlyph} /></span>
    <span class="hub-plate__label">S.W.E.E.P.${t('报告')}</span>
    <span class="hub-plate__tag">REPORT</span>
  </button>`;
}

/** One of the four big entries at the bottom right. */
function HubEntry({ group, name, en, icon, badge, tone = 'mint', count = null, onClick, disabled = false }) {
  return html`<div class="hub-entry-wrap">
    ${group ? html`<span class="hub-entry__group"><${Icon} name=${group.icon} />${group.label}</span>` : html`<span class="hub-entry__group hub-entry__group--blank"></span>`}
    <button type="button" class=${`hub-entry hub-entry--${tone}`} onClick=${onClick} disabled=${disabled}>
      <span class="hub-entry__icon"><${Icon} name=${icon} /></span>
      <span class="hub-entry__en">${en}</span>
      <span class="hub-entry__name">${name}${badge ? html`<span class="mode-beta">${badge}</span>` : null}</span>
      ${count != null ? html`<span class="hub-entry__count"><${MatchmakingCount} count=${count} /></span>` : null}
      <span class="hub-entry__corner" aria-hidden="true"></span>
    </button>
  </div>`;
}

/** A small tile of the side column. */
function HubTile({ icon, label, en, onClick, children }) {
  return html`<button type="button" class="hub-tile" onClick=${onClick}>
    <span class="hub-tile__icon"><${Icon} name=${icon} /></span>
    <span class="hub-tile__text"><span class="hub-tile__label">${label}</span><span class="hub-tile__en">${en}</span></span>
    ${children}
  </button>`;
}

/** Shared frame of the hub's two dialogs (the start sheet, 密钥加入). */
/**
 * 娱乐模式（业主 2026-10-31「其他模式聚合为大厅里的一个按钮」）：把协同共竞 / 赏金 / 对战(控怪) / 肉鸽
 * 收进一个入口；弹窗占视口 80%，2×2 网格，选哪格就走对应的建房弹窗。
 */
function FunSelect({ onClose, onPick, busy, lobbyStats = null, onJoinRoom = null, onSpectateRoom = null }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  const cells = [
    { id: 'xie', name: t('协同共竞'), en: 'JOINT OP', icon: 'joint', acc: 'var(--gold)',
      desc: t('两人共竞：团队储备、三项商店升级、借贷、救济与救援。') },
    { id: 'bounty', name: t('赏金'), en: 'BOUNTY', icon: 'bounty', acc: 'var(--ice)',
      desc: t('2V2 攻防：官方出怪为主，你替换其中一部分，靠自家怪被击杀拿赏金；建房时可选倍速。') },
    { id: 'confront', name: t('对战 · 控怪'), en: 'CONFRONT', icon: 'confront', acc: 'var(--orange)',
      desc: t('出怪、路线、时机全部由你决定；守方遇到的怪约为官方的 1.5 倍。') },
    { id: 'rogue', name: t('肉鸽模式'), en: 'ROGUELIKE', icon: 'rogue', acc: 'var(--violet)',
      desc: t('开局与每 2 回合各抽一次藏品三选一，外加随机词缀、随机事件与每回合换图。') },
  ];
  return html`<div class=${`modal${leaving ? ' is-leaving' : ''}`} role="presentation"
      onMouseDown=${(e) => { if (e.target === e.currentTarget) leave(); }}>
    <div class="modal__box fun-modal" role="dialog" aria-modal="true" aria-label=${t('娱乐模式')}>
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="modal__head">
        <h2 class="modal__title">${t('娱乐模式')}</h2>
        <span class="t-dim" data-testid="lobby-counts">
          ${t('在线 {online} · 房间 {rooms} · 对局 {matches}', {
            online: lobbyStats?.online ?? 0, rooms: lobbyStats?.roomsCount ?? 0, matches: lobbyStats?.matchesCount ?? 0,
          })}
        </span>
        <button type="button" class="modal__close" onClick=${leave} aria-label=${t('关闭')}>×</button>
      </header>
      <div class="fun-grid">
        ${cells.map((c) => html`<button key=${c.id} type="button" class="fun-card" data-testid=${`fun-${c.id}`}
            disabled=${!!busy} style=${`--acc:${c.acc}`} onClick=${() => onPick(c.id)}>
          <span class="fun-card__head" style="display:flex;align-items:center;gap:.55rem;min-width:0">
            <${Icon} name=${c.icon} size=${28} class="fun-card__icon" /><span class="fun-card__en">${c.en}</span></span>
          <span class="fun-card__name">${c.name}</span>
          <span class="fun-card__desc">${c.desc}</span>
          <span class="fun-card__corner" aria-hidden="true"></span>
        </button>`)}
      </div>
      ${lobbyStats && Array.isArray(lobbyStats.rooms) && lobbyStats.rooms.length ? html`<div class="t-dim fun-rooms"
          data-testid="lobby-rooms">
        <span>${t('公开房间：')}</span>
        ${lobbyStats.rooms.slice(0, 8).map((r) => html`<button key=${r.code} type="button" class="code-chip num"
            data-testid=${r.inMatch ? `lobby-room-${r.code}-infiltrate` : `lobby-room-${r.code}`}
            title=${r.inMatch
              ? t('{code} · 对局进行中 · 潜入：以观战身份进入并申请接管一个 AI 席位', { code: r.code })
              : t('{code} · {humans} 人 · {mode}', { code: r.code, humans: r.humans, mode: r.mode })}
            disabled=${r.inMatch ? !onSpectateRoom : !onJoinRoom}
            onClick=${() => (r.inMatch ? onSpectateRoom && onSpectateRoom(r.code) : onJoinRoom && onJoinRoom(r.code))}>${r.code}${r.inMatch ? ` · ${t('对局中')} · ${t('潜入')}` : ''}</button>`)}
      </div>` : null}
    </div>
  </div>`;
}

function HubDialog({ open, micro, title, onClose, wide = false, children }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    addEventListener('keydown', onKey);
    // the lobby chat (z 180, ui/communityChat.js) sits above modals: it steps aside while a hub dialog is open
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, [open]);
  if (!open) return null;
  return html`<div class="modal hub-dialog" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
    <div class=${`modal__box hub-dialog__box brackets${wide ? ' hub-dialog__box--wide' : ''}`} role="dialog" aria-modal="true">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="hub-dialog__head">
        <${MicroLabel} tone="mint">${micro}<//>
        <div class="hub-dialog__title-row">
          <h2 class="modal__title">${title}</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label="关闭"><${Icon} name="close" /></button>
        </div>
      </header>
      <div class="hub-dialog__body">${children}</div>
    </div>
  </div>`;
}

/** The hand-drawn ring of the 已选定 stamp (two loose strokes). */
function StampRing() {
  return html`<svg class="pcard__ring" viewBox="0 0 120 100" aria-hidden="true" focusable="false">
    <path pathLength="1" d="M18 62C6 34 34 8 70 10c34 2 48 30 38 54-10 24-46 32-72 22C20 80 10 66 16 50" />
    <path pathLength="1" d="M30 20c22-14 62-12 78 10 12 18 4 44-16 54" />
  </svg>`;
}

/** 正在加入同盟…: bottom left while the room is being opened, a light running along the bottom edge (css tr-join). */
function JoinLine({ text }) {
  return html`<div class="tr-join" role="status"><span class="tr-join__mark" aria-hidden="true"></span>${text}<span class="tr-join__dots" aria-hidden="true"></span></div>`;
}

/** One difficulty of 选择模拟协议: name, text, effects; the extras (code, rounds, 隐秘核心, battlefields, queue) below. */
export function ProtoCard({ roomMode, difficulty, selected, onSelect, matchmaking, random, variant, modeVariant = null }) {
  const info = difficultyInfo(roomMode, difficulty, { random, variant }, modeVariant);
  return html`<button type="button" class=${`pcard${selected ? ' is-on' : ''}`} style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`}
      onClick=${() => onSelect(difficulty)} aria-pressed=${selected ? 'true' : 'false'}>
    <span class="pcard__glow" aria-hidden="true"></span>
    <span class="pcard__head">
      <${DifficultyIcon} difficulty=${difficulty} class="pcard__glyph" />
      <span class="pcard__name">${t(DIFFICULTY_NAMES[difficulty])}</span>
      ${roomMode === 'coop' && !random ? html`<${MatchmakingCount} count=${matchmaking?.byDifficulty?.[difficulty]} />` : null}
    </span>
    <span class="pcard__desc">${info.desc}</span>
    <span class="pcard__effects">${info.effects.map((e) => html`<span key=${e}>${e}</span>`)}</span>
    <span class="pcard__meta">
      ${info.code ? html`<span class="num">${info.code}</span>` : null}
      <span><b class="num">${info.rounds}</b> ${tc('rounds', '回合')}${info.hidden ? t(' + 隐秘核心') : ''}</span>
      ${info.stageNote ? html`<span>${info.stageNote}</span>` : null}
    </span>
    <span class="pcard__stamp" aria-hidden="true"><${StampRing} /><span class="pcard__tick"><${Icon} name="check" /></span><span class="pcard__ok">${t('已选定')}</span></span>
  </button>`;
}

/**
 * 选择模拟协议 (2026-10-13, the owner's request: the event's second screen after 独立模拟): full screen, the picture of
 * the selected difficulty at the left (ui/protocolScene.js, original), the difficulties down the right with the
 * 已选定 stamp, 开始模拟 at the bottom right. Kept from the old start sheet: 无限火力's variants and notes, the private
 * room, 快速匹配, the queue counts, rounds / 隐秘核心 / battlefields and the hints. Esc or ‹ returns to the hub.
 * Comes up from black over the hub (`chained`: straight after 选择同盟方式, already black) and fades back out
 * (ui/transitions.js); the picture is redrawn for each difficulty.
 */
function ProtocolSelect({ card, roomMode, random, variant, difficulty, onDifficulty, onClose, matchmaking, brief, privateRoom, onPrivate,
  online, maint, busy, isSearching, onCreate, onQueue, purpose = 'create', onSearch, onCancel, mm, onBrowse, chained = false, modeVariant = null,
  testMode = false, asTest = false, onTest = null, versusTeam = 2, onVersusTeam = null,
  versusRule = 'bounty', onVersusRule = null, versusAlt = true, onVersusAlt = null,
  versusSpeed = 1, onVersusSpeed = null, mapPool = 'all', onMapPool = null }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  const fx = `${leaving ? ' is-leaving' : ''}${chained ? ' is-chained' : ''}`;
  const search = purpose === 'search';
  // 2026-11-03：肉鸽（card.id === 'rogue'）用 N1–N20；其它模式用旧 4 档。
  const effectiveMode = card?.id === 'rogue' ? 'rogue' : roomMode;
  const cardModeVariant = effectiveMode === 'rogue' ? 'rogue' : modeVariant;
  const info = difficultyInfo(effectiveMode, difficulty, { random, variant }, cardModeVariant);
  const label = maint?.active ? t('维护中 · 暂停开局') : search ? t('开始搜寻') : random ? t('创建无限火力') : roomMode === 'solo' ? t('开始模拟') : t('创建同盟');
  const hint = !online ? t('正在连接服务器…') : maint?.active ? t('服务器即将停机维护，暂时停止开启新的同盟')
    : search ? t('精确搜寻：只与选择相同难度的博士组成同盟，凑齐 4 人即开始')
    : isSearching ? t('正在匹配真人队友，AI 补位已暂停') : roomMode === 'solo' ? t('独自调配阵容，按自己的节奏开始模拟') : t('创建后可邀请好友，AI 队友已暂停');
  // 搜寻队友: while the queue runs, the right column is the 搜寻中 panel (the server's elapsed / matched counts)
  if (search && isSearching) {
    const d = mm?.difficulty && DIFFICULTIES.includes(mm.difficulty) ? mm.difficulty : difficulty;
    return html`<div class=${`proto proto--searching${fx}`} style=${`--d-color:${DIFFICULTY_COLORS[d]}`} data-difficulty=${d} role="dialog" aria-label=${t('搜寻队友')}>
      <div class="proto__bg" aria-hidden="true"></div>
      <header class="proto-top">
        <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅（继续搜寻）')} aria-label=${t('返回大厅')}>
          <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
        </button>
      </header>
      <div class="proto-body">
        <section class="proto-stage"><${ProtocolScene} key=${d} difficulty=${d} /></section>
        <section class="proto-side proto-side--search">
          <${SearchPanel} elapsed=${mm?.elapsed || 0} onStop=${onCancel} stopping=${busy === 'cancel'}
            note=${t('已找到 {matched}/{target} 名博士', { matched: mm?.matched || 1, target: mm?.target || 4 })}
            tags=${[{ key: 'mode', label: t('精确搜寻'), icon: html`<${Icon} name="search" />` },
              { key: 'diff', label: t(DIFFICULTY_NAMES[d]), color: DIFFICULTY_COLORS[d], icon: html`<${DifficultyIcon} difficulty=${d} />` }]} />
        </section>
      </div>
    </div>`;
  }
  return html`<div class=${`proto${fx}`} style=${`--d-color:${DIFFICULTY_COLORS[difficulty]}`} data-difficulty=${difficulty} role="dialog" aria-label=${t('选择模拟协议')}>
    <div class="proto__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅 (Esc)')} aria-label=${t('返回大厅')}>
        <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
      </button>
      <div class="proto-title">
        <h2>${t('选择模拟协议')}</h2>
        <span class="proto-title__mode">${search ? t('搜寻队友') : t(card.name)}<i>${search ? 'FIND ALLIES' : card.en}</i></span>
      </div>
    </header>
    <div class="proto-body">
      <div class="proto-stage">
        <${ProtocolScene} key=${difficulty} difficulty=${difficulty} />
      </div>
      <section class="proto-main">
        <div class="proto-brief">
          <b class="proto-brief__mode">${t(card.name)}<i>${card.en}</i></b>
          <p>${t(card.desc, card.params)}</p>
        </div>
        ${brief ? html`<div class="proto-fp">${brief}</div>` : null}
          ${roomMode === 'versus' ? html`<div class="proto-dock">
            <div class="proto-dock__row" role="radiogroup" aria-label=${t('对抗规则')}>
              ${[
                { key: 'bounty', code: 'B', acc: 'var(--gold-2)', name: t('赏金'), sub: t('替换部分官方出怪'),
                  title: t('赏金：官方出怪为主，你只能替换其中一部分，靠自家怪被击杀拿赏金') },
                { key: 'confront', code: 'C', acc: 'var(--orange)', name: t('控怪'), sub: t('出怪 · 路线 · 时机全可控'),
                  title: t('控怪：这一波出什么怪、走哪条路线、什么时候进场，全部由你决定') },
                { key: 'ai', code: 'AI', acc: 'var(--ice)', name: t('AI 对抗'), sub: t('你控怪 · AI 布防'), locked: false,
                  title: t('AI 对抗：你操作怪物、AI 布防（1–20 人；你与队友坐 team0、AI 坐对面）') },
              ].map((r) => html`<button key=${r.key} type="button" role="radio" aria-checked=${versusRule === r.key ? 'true' : 'false'}
                class=${`vsopt${versusRule === r.key ? ' is-on' : ''}`} style=${`--acc:${r.acc}`}
                disabled=${!!busy || !!r.locked} title=${r.title}
                onClick=${() => !r.locked && onVersusRule && onVersusRule(r.key)}>
                <span class="vsopt__code">${r.code}</span>
                <span class="vsopt__text"><b>${r.name}</b><small>${r.sub}</small></span>
                ${r.locked ? html`<span class="vsopt__lock">${t('待开放')}</span>` : null}
              </button>`)}
            </div>
            <div class="proto-dock__foot">
              ${versusRule === 'confront' ? html`<label class="proto-versus__alt">
                <input type="checkbox" checked=${versusAlt !== false} disabled=${!!busy}
                  onChange=${(e) => onVersusAlt && onVersusAlt(e.currentTarget.checked)} />
                <span>${t('每回合交换攻守')}</span></label>` : null}
              ${versusRule === 'ai' ? html`<span class="proto-dock__hint" style="opacity:.75">${t('固定攻守：你们恒为攻方、AI 恒为守方（不换边）')}</span>` : null}
              ${versusRule === 'bounty' ? html`<label class="proto-team" title=${t('出怪倍速：这一回合守方遇到的敌人数量的倍数（以当前赏金档为 1×）')}>
                <span>${t('倍速')}</span>
                <select value=${String(versusSpeed)} disabled=${!!busy}
                  onChange=${(e) => onVersusSpeed && onVersusSpeed(Number(e.currentTarget.value))}>
                  ${[1, 1.5, 2].map((m) => html`<option key=${m} value=${String(m)}>${t('{m}× 出怪', { m })}</option>`)}
                </select></label>` : null}
            </div>
          </div>` : null}
        ${effectiveMode === 'rogue' ? html`<div class="proto-dock">
            <div class="proto-dock__row" role="radiogroup" aria-label=${t('地图主题')}>
              ${ROGUE_MAP_POOLS.map((p) => html`<button key=${p.id} type="button" role="radio"
                aria-checked=${mapPool === p.id ? 'true' : 'false'}
                class=${`vsopt${mapPool === p.id ? ' is-on' : ''}`} style=${`--acc:${p.acc}`}
                disabled=${!!busy} title=${t(p.title)}
                onClick=${() => onMapPool && onMapPool(p.id)}>
                <span class="vsopt__code">${p.code}</span>
                <span class="vsopt__text"><b>${t(p.short)}</b><small>${t(p.name)}</small></span>
              </button>`)}
            </div>
            <div class="proto-dock__foot">
              <span class="proto-dock__note">${t('只从所选主题的官方地图里抽战场：该主题缺少这一层级的图时，改抽同主题的可战斗地图，不会跨主题。')}</span>
            </div>
          </div>` : null}
        ${modeVariant === 'xie' ? html`<div class="proto-versus proto-versus--info">
          <span class="proto-versus__note">${t('团队储备：全队共用一个池子。防守奖励与主动存入攒钱，用来买商店升级（商店等级 / 协同资金获取 / 装备造价）、借款垫付、告急救济与救援。回合末没花完的钱直接清零。')}</span>
        </div>` : null}
      </section>
      <section class="proto-side">
        <div class="proto-list" role="radiogroup" aria-label=${t('模拟难度')}>
          ${difficultiesFor(effectiveMode).map((d) => html`<${ProtoCard} key=${d} roomMode=${roomMode} difficulty=${d} selected=${difficulty === d} onSelect=${onDifficulty}
            matchmaking=${matchmaking} random=${random} variant=${variant} modeVariant=${cardModeVariant} />`)}
        </div>
        <div class="proto-foot">
          ${search ? html`<div class="proto-opts">
            <span class="proto-mode-chip"><${Icon} name="search" />${t('精确搜寻')}</span>
            <${Button} variant="secondary" size="md" icon="users" onClick=${onBrowse}>${t('浏览公开同盟')}<//>
          </div>` : roomMode !== 'solo' ? html`<div class="proto-opts">
            ${roomMode !== 'solo' && CAN_PRIVATE ? html`<label class="proto-private" title=${t('不在公开大厅显示，仅通过房间码或邀请加入')}>
              <input type="checkbox" checked=${privateRoom} onChange=${(e) => onPrivate(e.currentTarget.checked)} /><span>${t('私密房间')}</span></label>` : null}
            ${roomMode === 'coop' && CAN_QUEUE ? html`<${Button} variant="secondary" size="md" icon="refresh" loading=${busy === 'queue'} disabled=${!online || maint?.active || isSearching}
              onClick=${onQueue}>${t('快速匹配')}<//>` : null}
          </div>` : null}
          ${testMode && purpose === 'create' ? html`<label class="proto-private" data-testid="create-test"
            title=${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}>
            <input type="checkbox" checked=${asTest} onChange=${(e) => onTest?.(e.currentTarget.checked)} /><span>${t('测试房间')}</span></label>` : null}
          <p class="proto-hint">${hint}</p>
          <button type="button" class="proto-start" disabled=${!online || maint?.active || busy === 'create' || busy === 'queue'} onClick=${search ? onSearch : onCreate}>
            <span class="proto-start__mark" aria-hidden="true"><span class="proto-start__rook"><i>[</i><${Icon} name="rook" /><i>]</i></span><small>STRONGHOLD<br />PROTOCOL</small></span>
            <span class="proto-start__label">${busy === 'create' || busy === 'queue' ? html`<${Spinner} size="sm" />` : null}${label}</span>
            <span class="proto-start__deco" aria-hidden="true"></span>
          </button>
        </div>
      </section>
    </div>
    ${busy === 'create' ? html`<${JoinLine} text=${roomMode === 'solo' ? t('正在进入模拟') : t('正在建立同盟')} />` : null}
  </div>`;
}

/**
 * 选择同盟方式 (2026-10-13, the owner's request: the event's screen after 同盟模拟, video 5:22–6:29): the radar at the
 * left (ui/matchFlow.js), 创建同盟 (a room at the remembered difficulty — it is changed in the room) and 加入同盟 (the
 * key field, 观战, recent keys) at the right, 模拟邀约 (the public alliances) and 搜寻队友 between them, 入门协议 (玩法说明)
 * at the bottom left. Esc or ‹ returns to the hub.
 */
function AllianceSelect({ onClose, code, onCode, codeOk, recent, online, maint, busy, onCreate, onJoin, onSpectate, onBrowse, onSearch, difficulty,
  testMode = false, asTest = false, onTest = null }) {
  const [leaving, leave] = useLeave(onClose);
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.modal, .guide')) leave(); };
    addEventListener('keydown', onKey);
    document.body.classList.add('hub-dialog-open');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('hub-dialog-open'); };
  }, []);
  const joining = busy === 'create' ? t('正在建立同盟') : busy === 'join' ? t('正在加入同盟') : busy === 'spectate' ? t('正在进入观战') : null;
  return html`<div class=${`proto ally${leaving ? ' is-leaving' : ''}`} role="dialog" aria-label=${t('选择同盟方式')}>
    <div class="proto__bg ally__bg" aria-hidden="true"></div>
    <header class="proto-top">
      <button type="button" class="proto-back" onClick=${leave} title=${t('返回大厅 (Esc)')} aria-label=${t('返回大厅')}>
        <${Icon} name="chevronLeft" /><span class="proto-back__home"><${Icon} name="rook" /></span>
      </button>
      <div class="proto-title"><h2>${t('选择同盟方式')}</h2><span class="proto-title__mode ally__mode">${t('同盟模拟')}<i>ALLIANCE SIMULATION</i></span></div>
    </header>
    <div class="proto-body ally-body">
      <section class="ally-stage"><${RadarScene} />
        <button type="button" class="ally-guide" onClick=${() => openGuide(0)}><span class="ally-guide__icon"><${Icon} name="book" /></span>${t('入门协议')}</button>
      </section>
      <section class="ally-side">
        <button type="button" class="ally-card ally-card--create" disabled=${!online || maint?.active || busy === 'create'} onClick=${onCreate}>
          <span class="ally-card__art"><${CreateArt} /></span>
          <span class="ally-card__bar"><span class="ally-card__icon"><${Icon} name="plus" /></span>${maint?.active ? t('维护中 · 暂停开局') : t('创建同盟')}
            ${busy === 'create' ? html`<${Spinner} size="sm" />` : html`<small>${t('难度：{name}（可在同盟内更改）', { name: t(DIFFICULTY_NAMES[difficulty]) })}</small>`}</span>
        </button>
        ${testMode ? html`<label class="proto-private ally-test" data-testid="create-test"
          title=${t('不计入战绩。房间会标明「测试」，只有房主能使用测试指令。')}>
          <input type="checkbox" checked=${asTest} onChange=${(e) => onTest?.(e.currentTarget.checked)} /><span>${t('测试房间')}</span></label>` : null}
        <div class="ally-links">
          ${CAN_QUEUE ? html`<button type="button" class="ally-pill" onClick=${onSearch}><${Icon} name="search" />${t('搜寻队友')}</button>` : null}
        </div>
        <div class="ally-card ally-card--join">
          <span class="ally-card__art"><${JoinArt} /></span>
          <label class="ally-key"><${Icon} name="search" />
            <input type="text" value=${code} placeholder=${t('输入同盟密钥')} maxlength="64" autocomplete="off" spellcheck="false"
              onInput=${(e) => onCode(e.currentTarget.value)} onKeyDown=${(e) => { if (e.key === 'Enter') onJoin(); }} />
            ${codeOk ? html`<button type="button" class="ally-key__spec" disabled=${!online || busy === 'spectate'} onClick=${onSpectate}
              title=${t('以观战者身份进入：不占博士席位，只能观看（人数不限，模拟进行中也可进入）')}><${Icon} name="eye" />${t('观战')}</button>` : null}
          </label>
          ${recent.length ? html`<span class="ally-recent">${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')} onClick=${() => onCode(c)}>${c}</button>`)}</span>` : null}
          <button type="button" class="ally-card__bar ally-card__bar--join" disabled=${!codeOk || !online || busy === 'join'} onClick=${() => onJoin()}>
            <span class="ally-card__icon"><${Icon} name="users" /></span>${t('加入同盟')}${busy === 'join' ? html`<${Spinner} size="sm" />` : null}
          </button>
        </div>
      </section>
    </div>
    ${joining ? html`<${JoinLine} text=${joining} />` : null}
  </div>`;
}

function MatchmakingModal({ open, onClose, onJoin, onSpectate }) {
  const lobbyStats = useStore((s) => s.lobbyStats, shallowEqual);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(() => ({
    online: lobbyStats?.online ?? 1,
    roomsCount: lobbyStats?.roomsCount ?? 0,
    matchesCount: lobbyStats?.matchesCount ?? 0,
    rooms: lobbyStats?.rooms ?? [],
  }));

  useEffect(() => {
    if (federationEnabled) {net.request('room.list').then(r=>setData(r)).catch(()=>{});return;}
    if (lobbyStats && typeof lobbyStats.online === 'number') {
      setData({
        online: lobbyStats.online,
        roomsCount: lobbyStats.roomsCount,
        matchesCount: lobbyStats.matchesCount,
        rooms: lobbyStats.rooms,
      });
    }
  }, [lobbyStats]);

  const fetchRooms = async () => {
    setLoading(true);
    try {
      const res = CAN_LIST ? await net.request('room.list') : null;
      if (res && res.ok) {
        setData(res);
      }
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  // 缺人同盟/房间列表：每 30 秒刷新一次（服务端只回有人的公开房）。
  useEffect(() => { const id = setInterval(() => { fetchRooms().catch(() => {}); }, 30000); return () => clearInterval(id); }, []);

  useEffect(() => {
    if (!open) return undefined;
    fetchRooms();
    const timer = setInterval(() => { if (!document.hidden) fetchRooms(); }, 4000);
    return () => clearInterval(timer);
  }, [open]);

  if (!open) return null;

  return html`<div class="modal mm-modal" role="presentation"
      onMouseDown=${(e) => { if (e.target === e.currentTarget && onClose) onClose(); }}>
    <div class="modal__box mm-modal__box brackets" role="dialog" aria-modal="true">
      <div class="modal__stripe" aria-hidden="true"></div>
      <header class="modal__head mm-modal__head">
        <${MicroLabel} tone="mint">MULTIPLAYER MATCHMAKING<//>
        <div class="mm-modal__title-row">
          <h2 class="modal__title mm-modal__title">三服统一大厅</h2>
          <button type="button" class="mm-modal__close" onClick=${onClose} aria-label="关闭">
            <${Icon} name="close" />
          </button>
        </div>
      </header>

      <div class="mm-modal__body">
        <div class="mm-stats-bar">
          <div class="mm-stats-col">
            <span class="mm-stats-num mm-stats-num--mint num">${data.online ?? 1}</span>
            <span class="mm-stats-label">在线博士</span>
          </div>
          <div class="mm-stats-col">
            <span class="mm-stats-num num">${data.roomsCount ?? 0}</span>
            <span class="mm-stats-label">同盟房间</span>
          </div>
          <div class="mm-stats-col">
            <span class="mm-stats-num num">${data.matchesCount ?? 0}</span>
            <span class="mm-stats-label">进行中对局</span>
          </div>
          <button type="button" class="mm-refresh-btn" onClick=${fetchRooms} disabled=${loading}>
            <${Icon} name="refresh" class=${loading ? 'is-spinning' : ''} />
            <span>刷新</span>
          </button>
        </div>

        ${data.partial ? html`<p>部分节点暂未连通，当前列表可能不完整。</p>` : null}
        <div class="mm-room-list">
          ${data.rooms && data.rooms.length > 0
            ? data.rooms.map((r) => html`<div key=${`${r.node || ''}:${r.code}`} class="mm-room-card">
                <div class="mm-room-code num">${r.code}${r.nodeName ? html`<small style="display:block;font-size:11px">${r.nodeName}</small>` : null}</div>
                <div class="mm-room-info">
                  <div class="mm-room-name"><span class=${isOwnerName(r.hostName || r.name) ? "sp-owner-name" : ""}>${r.name || `同盟 #${r.code}`}</span>${["isomer", "凑鹈鹕", "香鹈鹕"].includes(String(r.hostName || r.name || "").trim().toLowerCase()) ? html`<span class="mm-owner-badge" title="服主" style="display:inline-flex;align-items:center;gap:4px;margin-left:8px;padding:2px 6px;border:1px solid #e4bd60;color:#e4bd60;font-size:11px;line-height:1.4;white-space:nowrap;vertical-align:middle"><${Icon} name="crown" />服主</span>` : null}</div>
                  <div class="mm-room-meta">
                    <span class="mm-room-diff" style=${`--d-color:${DIFFICULTY_COLORS[r.difficulty] || 'var(--mint)'}`}>
                      <${DifficultyIcon} difficulty=${r.difficulty} class="diff-glyph" />
                      <span>${DIFFICULTY_NAMES[r.difficulty] || r.difficulty}</span>
                    </span>
                    ${r.random ? html`<span class="mm-room-rm">无限火力 · 1.1 · ${r.variant === 'endurance' ? '持久鏖战' : r.variant === 'marathon' ? '最长时赛' : '快速突袭'}</span>` : null}
                    ${r.plugins ? html`<span class="mm-room-rm">${t('插件 ×{n}', { n: r.plugins })}</span>` : null}
                    <span class="mm-room-players">
                      <${Icon} name="users" />
                      <span class="num">${r.humans} / ${r.maxSeats || MAX_SEATS}</span>
                    </span>
                    <span class=${`mm-room-status ${r.inMatch ? 'is-in-match' : 'is-waiting'}`}>
                      ${r.inMatch ? '进行中' : '等待中'}
                    </span>
                  </div>
                </div>
                <div class="mm-room-actions">
                  <${Button}
                    variant="primary"
                    size="md"
                    icon="users"
                    class=${`mm-btn-join ${r.inMatch ? 'is-disabled-match' : ''}`}
                    disabled=${r.inMatch}
                    onClick=${() => { onClose(); onJoin(r.code,r.node); }}>
                    加入
                  <//>
                  <${Button}
                    variant="secondary"
                    size="md"
                    icon="eye"
                    class="mm-btn-spectate"
                    onClick=${() => { onClose(); onSpectate(r.code,r.node); }}>
                    观战
                  <//>
                </div>
              </div>`)
            : html`<div class="mm-room-empty">
                <${Icon} name="search" />
                <span>暂无公开同盟房间，可创建同盟或使用快速匹配</span>
              </div>`
          }
        </div>

        <footer class="mm-modal__foot">
          <div class="mm-foot-tag"><${MicroLabel}>AUTO-REFRESH 4S<//></div>
          <div class="mm-foot-text">列表每 4 秒自动刷新；观战不占博士席位，「进行中」的同盟只能观战。</div>
        </footer>
      </div>
    </div>
  </div>`;
}

// package: features follow the target server's message list (shared/protocol.js C2S)
const HAS = (type) => !!SERVER_C2S && Object.hasOwn(SERVER_C2S, type);
const CAN_QUEUE = HAS('match.queue'), CAN_FIREPOWER = HAS('room.setRandom'), CAN_PRIVATE = HAS('room.setPrivate'), CAN_LIST = HAS('room.list');

/** Lobby screen component. */
export function LobbyScreen() {
  const matchmakingCounts = useStore(s => s.presence?.matchmaking);
  const me = useStore((s) => s.me, shallowEqual);
  const conn = useStore((s) => s.connection, shallowEqual);
  // 'announcements' is optional (404 is normal when no board is configured): useData settles on 'missing' too.
  useData('config', 'announcements');
  // 大厅人数/房间数：`room.list` 回一条 `lobby.state`（public/js/main.js 已写进 store.lobbyStats），
  // 大厅一进来就开始轮询，10 秒一次、后台不轮询。
  useEffect(() => {
    let alive = true;
    const ask = () => { if (alive && !document.hidden) net.request('room.list').catch(() => {}); };
    ask();
    const id = setInterval(ask, 10000);
    return () => { alive = false; clearInterval(id); };
  }, []);
  const [simulation, setSimulation] = useState(lobbySimulationPreference);
  // 对抗模式固定 2V2（4 席）：人数选择已按业主裁决移出本页，改在别处调（当前无可调入口）
  // 对抗规则档（业主 2026-10-26）：赏金 = 线上那套（官方波次 + 替换份额），对抗 = 纯玩家出怪
  const [versusRule, setVersusRule] = useState('bounty');
  // 纯对抗里可以关掉「每回合交换攻守」（业主 2026-10-26）；赏金档恒交替。
  const [versusAlt, setVersusAlt] = useState(true);
  // 赏金档倍速（业主 2026-10-31）：1 / 1.5 / 2，控怪档不吃这一项
  const [versusSpeed, setVersusSpeed] = useState(1);
  // 肉鸽「地图主题池」 (2026-11-06)：'all' | 'ro1'…'ro6'，照 versusRule 的模式 —— 只在本页选择，建房时随
  // room.create 发给服务端；'all' 也发（服务端按 all 处理），缺省行为与加这个选择器之前一致。
  const [mapPool, setMapPool] = useState('all');
  const [difficulty, setDifficulty] = useState(() => preferredDifficulty(lobbySimulationPreference()));
  const [fpVariant, setFpVariant] = useState(firepowerVariantPreference);
  const roomMode = simulation === 'solo' ? 'solo' : simulation === 'versus' ? 'versus' : 'coop';
  const randomMode = simulation === 'firepower';
  const variant = randomMode ? fpVariant : 'blitz';
  const [code, setCode] = useState('');
  const [asTest, setAsTest] = useState(false);
  const testMode = useStore((s) => s.testMode === true);
  const [privateRoom, setPrivateRoom] = useState(false);
  // 肉鸽规则（业主 2026-10-30「肉鸽不作为新玩法了，还是加到协同里面」）：不再是独立模式卡，
  // 改成同盟模拟建房时的一个开关 —— 勾上就带藏品节奏 + 随机事件/词缀，并且拿到协同团队储备。
  const [rogueRules, setRogueRules] = useState(false);
  // 娱乐模式弹窗（协同 / 赏金 / 对战·控怪 / 肉鸽 四格）
  const [funOpen, setFunOpen] = useState(false);
  const [busy, setBusy] = useState(null);
  const [recent] = useState(recentRooms);
  const marks = loadPref('recentTestRooms', []);
  const alive = useRef(true);
  const inFlight = useRef(false); // synchronous guard against double clicks (state updates are async)
  useEffect(() => () => { alive.current = false; }, []);

  const resourcesReady = useStore((s) => !s.session.preloadRequired || s.session.preloadReady);
  const online = conn.status === 'online' && resourcesReady;
  const codeOk = CODE_RE.test(code);
  const mm = useStore((s) => s.matchmaking, shallowEqual);
  const maint = useStore((s) => s.maintenance, shallowEqual);
  const [modalOpen, setModalOpen] = useState(() => new URLSearchParams(location.search).has('modal'));
  const lobbyStats = useStore((s) => s.lobbyStats, shallowEqual);
  const [onlineCount, setOnlineCount] = useState(() => lobbyStats?.online ?? 1);
  const [rooms, setRooms] = useState(() => (federationEnabled ? [] : lobbyStats?.rooms ?? []));
  const bg = useHubBackdrop();
  const [bgOpen, setBgOpen] = useState(false);
  const [sweepOpen, setSweepOpen] = useState(false);
  // The Android shell can ask the local network who hosts a key, so a guest never types an address: the code is enough.
  const nativeShell = globalThis.AndroidNative?.isNativeApp?.() ? globalThis.AndroidNative : null;
  const [lanRoom, setLanRoom] = useState(null);
  const [lanNote, setLanNote] = useState('');
  useEffect(() => {
    if (!nativeShell || roomMode !== 'coop' || !codeOk) { setLanRoom(null); return undefined; }
    let cancelled = false;
    setLanRoom(null);
    setLanNote('正在局域网中查找该房间…');
    globalThis.__onRoomFound = (list) => {
      if (cancelled) return;
      const host = (list || []).find((h) => !h.self);
      if (host) { setLanRoom(host); setLanNote(`已找到房主 ${host.ip}（${host.humans || 0} 人在房）· 点「加入同盟」进入`); }
      else setLanNote('局域网里没有这个房间：确认房主已创建同盟模拟房间，且两台设备在同一网络');
    };
    nativeShell.findRoom(code);
    return () => { cancelled = true; delete globalThis.__onRoomFound; };
  }, [code, roomMode]);
  const isSearching = mm?.status === 'searching';

  useEffect(() => {
    if (!federationEnabled && lobbyStats && Number.isFinite(lobbyStats.online)) {
      setOnlineCount(lobbyStats.online);
    }
  }, [lobbyStats?.online]);
  useEffect(() => {
    if (!federationEnabled && Array.isArray(lobbyStats?.rooms)) setRooms(lobbyStats.rooms);
  }, [lobbyStats?.rooms]);

  useEffect(() => {
    if (!online) return undefined;
    let cancelled = false;
    // 服务端把列表作为**推送**发（`t:'room.list'`）—— 请求的回复只带 ok/rid，自定义字段会被平台丢掉。
    const apply = (msg) => {
      if (cancelled || !msg) return;
      if (Number.isFinite(msg.online)) setOnlineCount(msg.online);
      if (Array.isArray(msg.rooms)) setRooms(msg.rooms);
    };
    const offList = net.on?.('room.list', apply);
    const ask = () => { if (!CAN_LIST) return; net.request('room.list').catch(() => {}); };
    ask();
    // 事件驱动（业主 2026-10-18：省资源）：进大厅问一次、每次 welcome 再问一次。
    // 原来这里是每 10 秒一次 setInterval —— 免费实例上每个大厅玩家都在打这个接口。
    const offWelcome = net.on?.('welcome', () => ask());
    return () => { cancelled = true; offList?.(); offWelcome?.(); };
  }, [online]);

  const pickMode = (m) => {
    if (!MODE_CARDS.some((c) => c.id === m)) return;
    // Normal modes share their difficulty; firepower remembers its own explicitly chosen difficulty.
    if ((m === 'firepower') !== randomMode) setDifficulty(preferredDifficulty(m));
    setSimulation(m);
    savePref('lobby.simulation', m);
    savePref('lobby.mode', m === 'solo' ? 'solo' : 'coop');
    savePref('lobby.random', m === 'firepower');
  };
  const pickDifficulty = (d) => {
    setDifficulty(d);
    savePref(randomMode ? 'lobby.firepowerDifficulty' : 'lobby.difficulty', d);
  };

  const run = async (kind, fn) => {
    if (inFlight.current) return;
    if (!online) { toast(t('尚未连接到服务器，请稍候'), 'warn'); return; }
    inFlight.current = true;
    setBusy(kind);
    try { await fn(); } catch (err) { toastError(err); } finally {
      inFlight.current = false;
      if (alive.current) setBusy(null);
    }
  };
  const pickVariant = (v) => {
    setFpVariant(v);
    savePref('lobby.firepowerVariant', v);
  };

  const create = () => run('create', async () => {
    // 0.3.3 的 room.create 已删除 private / random：继续发会被 validateC2S 判 bad field（BAD_MSG）。
    // 随机地图改走房间级消息 room.setRandomStage（room-chat 插件的 code.lobby 处理）。
    // 肉鸽是独立模式（2026-11-01）：直接发 mode:'rogue'；variant 一并保留，旧服务端仍按 coop+variant 认它。
    const res = await net.request('room.create', {
      mode: simulation === 'coop' && rogueRules ? 'rogue' : roomMode, difficulty,
      ...(randomMode ? { variant } : {}), ...(simulation === 'xie' ? { variant: 'xie' } : {}),
      ...(simulation === 'coop' && rogueRules ? { variant: 'rogue' } : {}),
      // 肉鸽「地图主题池」 (2026-11-06)：左列选择器的结果。'all' 照样发，服务端按 all 处理。
      ...(simulation === 'coop' && rogueRules ? { mapPool } : {}),
      ...(simulation === 'versus' ? { teamSize: 2, variant: versusRule,
        versusAlt: versusRule === 'ai' ? false : (versusRule === 'confront' ? versusAlt !== false : true),
        versusSpeed: versusRule === 'bounty' ? versusSpeed : 1 } : {}),
      ...(testMode && asTest ? { test: true } : {}),
    });
    // 随机地图默认关（2026-10-30）：不再在建房时强开；要换图请在房间里用「随机地图」开关。
    return res;
  });
  const queueMatch = () => run('queue', () => net.request('match.queue', { mode: roomMode, difficulty, random: randomMode, ...(randomMode ? { variant } : {}), fillBots: false }));
  const cancelMatch = () => run('cancel', () => net.request('match.cancel'));
  const join = (c = code, federationNode) => {
    // `onClick=${join}` hands the click EVENT as the first argument, and a default parameter only applies to
    // `undefined` — codeArg keeps an event target out of the key and falls back to the input field
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    // A room found on another phone is a different origin: hand the WebView over to it instead of asking the
    // server we are on, which by definition does not have that room.
    if (nativeShell && lanRoom) {
      nativeShell.connectToHost(lanRoom.ip, k);
      setLanNote(`正在进入 ${lanRoom.ip} 的房间…`);
      return;
    }
    run('join', () => joinKnown('room.join', k, federationNode ? { federationNode } : {}));
  };
  // a spectator seat: no player seat taken, nothing to do but watch (also a match already running)
  const spectate = (c = code, federationNode) => {
    // same guard as join: `onClick=${spectate}` passes the click event, not a code
    const k = codeArg(c, code);
    if (!k) { toast(t('同盟密钥为 {ROOM_CODE_LEN} 位字母或数字', { ROOM_CODE_LEN }), 'warn'); return; }
    run('spectate', () => joinKnown('room.spectate', k, federationNode ? { federationNode } : {}).catch((err) => {
      // Clearer than the bare ERR_TEXT: the usual cause is a code that is not the host's (a remembered one from an
      // earlier room, or another machine's) — the server can only answer "no such room".
      if (err?.code === ERR.ROOM_NOT_FOUND) {
        toast(t('没有找到密钥 {k} 对应的同盟：请和房主核对密钥（同盟结束后密钥即失效）', { k }), 'warn');
        return;
      }
      if (err?.code === ERR.ALREADY) {
        toast(t('你已经是该同盟的博士：先离开同盟，才能以观战身份进入'), 'warn');
        return;
      }
      throw err;
    }));
  };
  const backToTitle = () => {
    identity.setEntered(false);
    store.set((s) => ({ session: { ...s.session, entered: false } }));
  };
  // hub dialogs: the start sheet of a picked mode, 密钥加入 (opened by an invite code in the URL too)
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetPurpose, setSheetPurpose] = useState('create'); // 'create' | 'search' (搜寻队友)
  const [allyOpen, setAllyOpen] = useState(false);            // 选择同盟方式
  const [sheetChained, setSheetChained] = useState(false);    // opened from 选择同盟方式: no darkening of the hub between
  const [joinOpen, setJoinOpen] = useState(false);
  const [achOpen, setAchOpen] = useState(false);              // 成就统计 (ui/achievements.js)
  // 公告板（服务端代理自网关，见 server/http/announcements.js）：进厅按内容 revision 弹一次，关掉即记下这次内容。
  // getRaw：公告是房主写的中文正文，不该走本地化叠加。
  const noticeStatus = data.status('announcements');
  const noticeValue = data.getRaw('announcements');
  const [noticeOpen, setNoticeOpen] = useState(false);
  const [noticeRev, setNoticeRev] = useState(null);
  useEffect(() => {
    setNoticeRev(null);
    if (noticeStatus !== 'ready') return undefined;
    let cancelled = false;
    announcementRevision(noticeValue).then((rev) => { if (!cancelled) setNoticeRev(rev); });
    return () => { cancelled = true; };
  }, [noticeStatus, noticeValue]);
  useEffect(() => {
    // Never fight a dialog the player opened themselves, and never reopen what they already closed.
    if (!online || !noticeRev || announcementDismissed(noticeRev) || noticeOpen) return;
    if (sheetOpen || allyOpen || joinOpen || bgOpen || modalOpen || sweepOpen || achOpen) return;
    setNoticeOpen(true);
  }, [online, noticeRev, sheetOpen, allyOpen, joinOpen, bgOpen, modalOpen, sweepOpen, achOpen]);
  const closeNotices = () => { dismissAnnouncement(noticeRev); setNoticeOpen(false); };
  // 同盟模拟 → 选择同盟方式; 独立模拟 / 无限火力 / 协同共竞 → 选择模拟协议
  const openMode = (m) => {
    pickMode(m);
    // 协同共竞 goes straight to the difficulty sheet like every other mode (owner's call, 2026-10-17): it used to
    // open a room-creation screen of its own, which read as a second UI in front of the one players already expected.
    // The variant rides room.create instead (see create() below).
    if (m === 'coop') setAllyOpen(true);
    else { setSheetPurpose('create'); setSheetChained(false); setSheetOpen(true); }
  };
  const openSearch = () => { pickMode('coop'); setSheetChained(allyOpen); setAllyOpen(false); setSheetPurpose('search'); setSheetOpen(true); };
  // 娱乐模式的四格 → 各自打开对应的建房流程
  const pickFun = (id) => {
    setFunOpen(false);
    if (id !== 'rogue') setRogueRules(false);
    if (id === 'xie') { pickMode('xie'); setSheetPurpose('create'); setSheetChained(false); setSheetOpen(true); return; }
    // 肉鸽（2026-11-02 业主）：点了直接到难度选择，不再先过一遍「选择同盟方式」面板
    if (id === 'rogue') { pickMode('coop'); setRogueRules(true); pickDifficulty('N8'); setSheetPurpose('create'); setSheetChained(false); setSheetOpen(true); return; }
    pickMode('versus');
    setVersusRule(id === 'confront' ? 'confront' : 'bounty');
    setSheetPurpose('create'); setSheetChained(false); setSheetOpen(true);
  };
  const modeCard = MODE_CARDS.find((c) => c.id === simulation) || MODE_CARDS[0];

  return html`<div class="screen lobby-screen lobby-hub" data-hub-theme=${backdropTheme(bg)}>
    <${HubBackdrop} bg=${bg} />
    <header class="topbar hub-topbar">
      <div class="topbar__left">
        <${Button} variant="ghost" size="sm" icon="chevronLeft" onClick=${backToTitle} title=${t('返回标题')}>${t('返回')}<//>
        <${PingPill} ms=${conn.ping} online=${online} />
        <span class="topbar__sep" aria-hidden="true"></span>
        <div class="topbar__tools">
          <${NoticesButton} />
          <${SettingsButton} class="lobby-settings" variant="secondary" square=${true} />
          <${GuideButton} class="lobby-guide" variant="secondary" square=${true} />
          <${Button} variant="secondary" size="sm" square=${true} icon="info" class="lobby-notice"
            onClick=${() => setNoticeOpen(true)} title=${t('公告')} aria-label=${t('公告')} />
          <${Button} variant="secondary" size="sm" square=${true} class="hub-bg-btn" onClick=${() => setBgOpen(true)}
            title=${t('大厅背景')} aria-label=${t('大厅背景')}><${BackdropGlyph} /><//>
          <${HubFullscreenButton} />
          <${LobbyMusicButton} />
          <${PwaInstallButton} class="lobby-pwa" square=${true} />
        </div>
      </div>
      <div class="topbar__right">
        <${VersionSwitch} />
        <span class="hub-online"><span class="online-pill__dot"></span><span class="num">${onlineCount}</span><span>${t('名博士在线')}</span></span>
        <${ResumeMatchButton} />
        <${AccountMeChip} player=${me} onStats=${openStats} />
      </div>
    </header>

    <main class="hub-stage">
      <div class="hub-center">
        <div class="hub-center__mark"><${HubRadar} bg=${bg} /><${Emblem} /></div>
        <div class="hub-center__en">STRONGHOLD PROTOCOL <b>ALLIANCE</b></div>
        <h1 class="hub-center__title">${t('卫戍协议：盟约')}</h1>
      </div>

      <aside class="hub-side">
        <${AchievementEntry} key=${achOpen ? 'open' : 'shut'} onOpen=${() => setAchOpen(true)} />
        <${HubTile} icon="key" label=${t('密钥加入')} en="JOIN WITH KEY" onClick=${() => setJoinOpen(true)} />
        <${FriendsTile} />
        <${TipsPanel} />
      </aside>

      <aside class="hub-right">
        <${RecruitCard} rooms=${rooms} online=${online} onJoin=${join} onAll=${() => setModalOpen(true)} onCreate=${() => openMode('coop')} />
        <div class="hub-right__plates">
          <${SweepPlate} onClick=${() => setSweepOpen(true)} />
          <${LoadoutButton} from="lobby" size="lg" class="hub-plate hub-plate--loadout" label=${t('干员调配')} />
        </div>
      </aside>

      <section class="hub-entries" aria-label=${t('模拟方式')}>
        ${isSearching ? html`<div class="matchmaking-hud brackets hub-searching">
            <div class="matchmaking-hud__info">
              <${Spinner} size="sm" />
              <span class="matchmaking-hud__text">正在匹配同盟 (${mm?.matched || 1}/${mm?.target || 4})...</span>
              <span class="matchmaking-hud__time num">${String(Math.floor((mm?.elapsed || 0) / 60)).padStart(2, '0')}:${String((mm?.elapsed || 0) % 60).padStart(2, '0')}</span>
            </div>
            <${Button} variant="danger" size="md" loading=${busy === 'cancel'} onClick=${cancelMatch}>取消匹配<//>
          </div>` : null}
        ${maint?.active ? html`<div class="hub-maint">${t('服务器即将维护，暂停开启新的模拟')}</div>` : null}
        ${CAN_LIST ? html`<button type="button" class="hub-invite" onClick=${() => setModalOpen(true)}>${t('模拟邀约')}<${Icon} name="chevronRight" /></button>` : null}
        <div class="hub-entries__row">
          <${HubEntry} group=${{ icon: 'user', label: t('独立模拟') }} name=${t('独立模拟')} en="SOLO" icon="user" onClick=${() => openMode('solo')} />
          <${HubEntry} group=${{ icon: 'users', label: t('同盟模拟') }} name=${t('同盟模拟')} en="ALLIANCE" icon="users" count=${matchmakingCounts?.total} onClick=${() => openMode('coop')} />
          <${HubEntry} name=${t('娱乐模式')} en="ARCADE" icon="dice" badge="NEW" tone="gold" onClick=${() => setFunOpen(true)} />
          ${CAN_QUEUE ? html`<${HubEntry} name=${t('搜寻队友')} en="FIND ALLIES" icon="search" tone="bright" onClick=${openSearch} />` : null}
        </div>
      </section>
    </main>

    ${sheetOpen ? html`<${ProtocolSelect} card=${rogueRules ? ROGUE_CARD : modeCard} roomMode=${roomMode} random=${randomMode} variant=${variant} difficulty=${difficulty} modeVariant=${simulation === 'xie' ? 'xie' : null}
      onDifficulty=${pickDifficulty} onClose=${() => setSheetOpen(false)} matchmaking=${matchmakingCounts}
      brief=${randomMode ? html`<${FirepowerBrief} variant=${fpVariant} onVariant=${pickVariant} />` : null}
      privateRoom=${privateRoom} onPrivate=${setPrivateRoom} online=${online} maint=${maint} busy=${busy} isSearching=${isSearching}
      testMode=${testMode} asTest=${asTest} onTest=${setAsTest}
      versusRule=${versusRule} onVersusRule=${setVersusRule} versusAlt=${versusAlt} onVersusAlt=${setVersusAlt}
      versusSpeed=${versusSpeed} onVersusSpeed=${setVersusSpeed}
      mapPool=${mapPool} onMapPool=${setMapPool}
      onCreate=${create} onQueue=${async () => { await queueMatch(); setSheetOpen(false); }}
      purpose=${sheetPurpose} onSearch=${queueMatch} onCancel=${cancelMatch} mm=${mm} onBrowse=${() => setModalOpen(true)} chained=${sheetChained} />` : null}

    ${allyOpen ? html`<${AllianceSelect} onClose=${() => setAllyOpen(false)} code=${code} onCode=${(v) => setCode(normalizeCode(v))} codeOk=${codeOk}
      recent=${recent} online=${online} maint=${maint} busy=${busy} difficulty=${difficulty}
      testMode=${testMode} asTest=${asTest} onTest=${setAsTest}
      onCreate=${create} onJoin=${() => join()} onSpectate=${() => spectate()} onBrowse=${() => setModalOpen(true)} onSearch=${openSearch} />` : null}

    ${funOpen ? html`<${FunSelect} onClose=${() => setFunOpen(false)} busy=${busy} onPick=${pickFun}
      lobbyStats=${lobbyStats} onJoinRoom=${(c) => { setFunOpen(false); join(c); }}
      onSpectateRoom=${(c) => { setFunOpen(false); spectate(c); }} />` : null}

    <${HubDialog} open=${joinOpen} micro="JOIN WITH ALLIANCE KEY" title=${t('密钥加入')} onClose=${() => setJoinOpen(false)}>
      <div class="join-row">
        <${TextField} size="code" icon="key" value=${code} placeholder=${t('输入同盟密钥 / 粘贴邀请链接')}
          transform=${normalizeCode} onInput=${(v) => setCode(normalizeCode(v))} onEnter=${() => join()} />
      </div>
      <div class="join-row hub-join__buttons">
        <${Button} variant="amber" size="lg" icon="users" loading=${busy === 'join'} disabled=${!codeOk || !online} onClick=${() => join()}>${t('加入同盟')}<//>
        <${Tooltip} text=${t('以观战者身份进入：不占博士席位，只能观看（人数不限，模拟进行中也可进入）')}>
          <${Button} variant="secondary" size="lg" icon="eye" class="join-spectate" loading=${busy === 'spectate'} disabled=${!codeOk || !online} onClick=${spectate}>${t('观战')}<//>
        <//>
      </div>
      ${lanNote && nativeShell ? html`<p class="t-dim">${lanNote}</p>` : null}
      <div class="join-foot">
        ${recent.length ? html`<span class="t-lo">${t('最近的同盟')}</span>
          ${recent.map((c) => html`<button key=${c} type="button" class="code-chip num" title=${t('填入密钥（不会直接加入）')}
            onClick=${() => setCode(c)}>${c}${Array.isArray(marks) && marks.includes(c) ? html` <${TestMark} />` : null}</button>`)}`
          : html`<span class="t-dim">${t('向同伴索取 {ROOM_CODE_LEN} 位同盟密钥，或直接打开邀请链接', { ROOM_CODE_LEN })}</span>`}
      </div>
    <//>

    <${HubDialog} open=${bgOpen} micro="LOBBY BACKDROP" title=${t('大厅背景')} onClose=${() => setBgOpen(false)}>
      <${BackdropSettings} bg=${bg} />
    <//>

    <${MatchmakingModal} open=${modalOpen} onClose=${() => setModalOpen(false)} onJoin=${join} onSpectate=${spectate} />
    ${achOpen ? html`<${AchievementPanel} me=${me} onClose=${() => setAchOpen(false)} />` : null}
    ${sweepOpen ? html`<${SweepReport} onClose=${() => setSweepOpen(false)} />` : null}
    ${noticeOpen ? html`<${AnnouncementBoard} status=${noticeStatus} value=${noticeValue}
      onRetry=${() => data.invalidate('announcements')} onClose=${closeNotices} />` : null}
  </div>`;
}

export { DEFAULT_DIFFICULTY, parsePlaytestParam };

// ===== 协同共竞: Forge 席位/模组层导出（room.js 的 RoomModsPanel / SeatCapSetter 用）=====
export const LAYER_TEXT = { A: N_('数据'), B: N_('逻辑'), C: N_('客户端') };

// ===== 协同共竞: Forge 座位上限层（room.js 的 SeatCapSetter 用；0.3.0 无 seatCap）=====
let serverSeatMax = MAX_SEATS;

/** @returns {number} the ceiling the lobby's seat slider may reach (never below 1) */
export function serverSeatMaxOf() { return serverSeatMax; }

net.on('welcome', (msg) => {
  const n = msg ? msg.maxSeats : undefined;
  serverSeatMax = Number.isInteger(n) && n >= 1 ? n : MAX_SEATS;
});

/** The slider's range for a ceiling: `max` is the server's, `min` the floor (narrowed if the server is below it). */
export function seatCapRange(serverMax) {
  const max = Number.isInteger(serverMax) && serverMax >= 1 ? serverMax : MAX_SEATS;
  return { min: Math.min(MIN_SEATS, max), max };
}

/**
 * What `room.create` should carry for a pick — `{}` whenever the room is built the way it always was.
 *
 * Two deliberate silences: a SOLO room never carries the field (its one-seat shape is `mode: 'solo'`'s, and the server
 * ignores it there anyway), and a pick that equals the server's ceiling sends NOTHING — that is 「本房不另设上限」,
 * i.e. the pre-B5 payload and the pre-B5 room, byte for byte. Only a pick BELOW the ceiling is a real choice.
 *
 * `clampSeats` is the same shared rule the server applies, so the client cannot send a value the server would refuse
 * (`shared/protocol.js`: outside `[MIN_SEATS, SEAT_CAP]` ⇒ `BAD_MSG`).
 */
export function seatCapPayload(mode, pick, serverMax) {
  if (mode !== 'coop') return {};
  const { max } = seatCapRange(serverMax);
  const cap = clampSeats(pick, max);
  return cap === max ? {} : { seatCap: cap };
}
