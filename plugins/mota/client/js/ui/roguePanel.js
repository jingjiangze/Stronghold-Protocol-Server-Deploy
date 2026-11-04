// plugins/mota/client/js/ui/roguePanel.js — 肉鸽「集成战略」全屏叠加面板（2026-11-04 重做）。
//
// 形态（业主 2026-11-04「节点和地图改成官方风格叠加面板，近似 1:1，不做局内悬浮窗」）：
//   · 一层面板 + 半透明遮罩，**不是**局内常驻浮窗；只在非战斗阶段由左上角的「肉鸽」按钮打开，
//     战斗 / 结算由 screens/game.js 关闭并禁用入口（这里再按 `blocked` 兜一层，防相位切换的那一帧）。
//   · 三页 tab，官方配色（深蓝黑底 + 金色标题 + 青色描边）：
//       节点 —— 三列：左「14 层时间轴 + 图例（已通过 / 当前 / 未到）」、中「下一层 三选一」大卡
//               （深蓝黑底 + 金色描边 + 顶部类型色条，官方 img_*_active.png 图标）、右「节点详情」
//               （当前层 / 类型 / 地图、下一层预览的 tier + 地图前缀、本局 AP·藏品·词缀、本层奖励 / 难度）；
//       地图 —— buildMinimapModel(stage) 的当前战场缩略图（按 rogueFrame 裁剪），主题官方底图垫底，
//               图例横排在地图正下方（3 列 × 2 行），右侧是「关卡信息」信息卡：关卡 / 回合 / 尺寸 / 主题
//               + 地图统计（地面 / 高台 / 禁入 / 其他格数，近战 / 远程部署点数）+ 2–3 行规则说明（填满右栏）；
//       藏品 —— 本局藏品列表 / 词缀 / 紧急作战预告。
//
// 数据（全部只读，服务端已组装好）：
//   · `pub.rogue.nodes`（server/match/match/views.js → rogue-core 的 rogueNodeState）：14 层 × 3 候选；
//   · `pub.rogue` 的 affix / emergency / nextEventRound / nextEmergencyRound；
//   · `priv.relicCards`（player/views.js）—— 名称/品阶/正负/是否实装；`pub.rogue.relics` 作后备（只有 id 时）；
//   · `stages` 数据文件（`data.lookup('stages', stageId)`，与 rogueMapDock 同一读法）。
// 动作：节点卡的点击**不在这里发** —— 组件把意图交给 game.js 注入的 `onPickNode(intent, payload)`，
//       对局页用 `net.request('g.rogueNode', { nodeId })`（与 g.roguePick / g.hex 同一条通道）。拿不到回调时
//       卡片禁用并明说「只读」，不编造网络接口。
//
// ⚠ 界面**不得**出现 `rogue_ro...` 原始资源 ID（2026-11-04 第四轮视觉验收）：`data/stages.json` 里肉鸽图的
//   `name` 就是 id 本身，直接渲染 `stage.name` 等于把资源路径摆给玩家。凡是要写关卡名的地方一律走 `mapLabel()`
//   （`rogue_ro5_1-2_dlc1` → `RO5 · 1-2 · DLC1`），下一层预览只有 tier（具体落哪张图由服务端 seed 决定）走
//   `mapTierLabel()`（`RO5 · T1`）。两条都返回 '' 时显示「—」，不退回原始串。
//
// ⚠ htm 模板里不能写 JS 式 `//` 注释（`/` 会进解析器的自闭合分支，整屏 SYSTEM FAULT）：注释一律写在模板外。
// 尺寸：1rem = 100 设计 px（1280×720 下 1rem≈66.7px），所以全部用 rem，字号用 calc(N * var(--t))。

import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { buildMinimapModel, TERRAIN } from './rogueMapModel.js';

/** 官方素材根目录（public/assets/local/roguelike，由 assets 导出脚本落盘）。 */
export const ROGUE_ASSET = '/assets/local/roguelike';
/** 节点卡底（官方 165×94）。选中态只用 CSS（描边 + 光晕），官方 img_focus.png 留作以后换皮。 */
export const NODE_CARD_BG = `${ROGUE_ASSET}/node/img_node_bkg.png`;

/** 官方类型色（用户给的对照表：battle / elite / boss / shop / rest / event，unknown 白）。 */
export const TYPE_COLOR = Object.freeze({
  battle: '#FFB80D',
  elite: '#F37E00',
  boss: '#FF5201',
  shop: '#0DB28D',
  rest: '#00B4FF',
  event: '#00E2E4',
  incident: '#00E2E4',
  unknown: '#FFFFFF',
});

/** 类型 → 官方图标（`img_*_active.png`；事件在官方素材里叫 incident）。 */
const TYPE_ICON = {
  battle: 'img_battle_active.png',
  elite: 'img_elite_active.png',
  boss: 'img_boss_active.png',
  shop: 'img_shop_active.png',
  rest: 'img_rest_active.png',
  event: 'img_incident_active.png',
  incident: 'img_incident_active.png',
};

/** 类型 → 中文名（渲染时取，不在模块加载时锁死语言）。 */
function typeName(type) {
  switch (type) {
    case 'battle': return t('战斗');
    case 'elite': return t('精英');
    case 'boss': return t('首领');
    case 'shop': return t('商店');
    case 'rest': return t('休整');
    case 'event':
    case 'incident': return t('事件');
    default: return t('未知');
  }
}

const REWARD_ORDER = ['funds', 'lp', 'ap', 'deployCap'];
const REWARD_LABEL = () => ({ funds: t('资金'), lp: t('生命'), ap: t('AP'), deployCap: t('部署') });

/**
 * 地图页的格子配色：地面深绿、高台/墙浅蓝白（青色描边）、禁入**灰红**（不再用饱和暗红：第一眼像可玩区被围死）、
 * 其余近黑。禁入格另加斜纹（minimap 的 HATCH 图案），只靠颜色区分不出「禁入」时也能读出来。
 */
export const MAP_COLORS = Object.freeze({
  ground: '#1f4a2f',
  high: '#b9cce0',
  forbidden: '#4a2b31',
  blocked: '#0c1118',
  melee: '#ffc75a',
  ranged: '#5ad1a0',
  grid: 'rgba(0, 226, 228, .10)',
  hatch: 'rgba(206, 138, 140, .22)',
});

/** 禁入格斜纹图案的 SVG id（一个面板里只有一张缩略图，固定 id 够用）。 */
const HATCH_ID = 'rpn-forbidden-hatch';

/** 主题底图张数区间（`roN/rogue_N_map_<from..to>.webp`；ro5 的 `sky_2` 不是地图，跳过）。 */
const BACKDROP_RANGE = Object.freeze({
  ro1: [1, 6],
  ro2: [1, 7],
  ro3: [1, 8],
  ro4: [1, 10],
  ro5: [0, 9],
  ro6: [0, 6],
});

/** 藏品上限（与 ui/rogueHud.js 的 3 一致：开局 + 每 2 回合的三选一）。 */
export const RELIC_CAP = 3;

/** `g.rogueNode` 的意图消息（纯函数：面板与 node 单测共用，不在组件里拼协议字符串）。 */
export function nodeIntent(nodeId) {
  return { intent: 'g.rogueNode', payload: { nodeId: String(nodeId || '') } };
}

/** `pub.rogue.nodes`（没有 / 不是对象时 null）。 */
export function rogueNodes(pub) {
  const n = pub && pub.rogue ? pub.rogue.nodes : null;
  return n && typeof n === 'object' ? n : null;
}

/** tier 文案：数字 → T<n>；字母是肉鸽层级（t 精英 / d 补给 / ev 事件 / b 首领），一律中文（界面不留英文小标）。 */
export function tierLabel(tier) {
  const v = typeof tier === 'string' ? tier : String(tier || '');
  if (!v) return '';
  if (/^\d+$/.test(v)) return `T${v}`;
  if (v === 'b') return t('首领');
  if (v === 't') return t('精英');
  if (v === 'ev') return t('事件');
  if (v === 'd') return t('补给');
  return v.toUpperCase();
}

/** 奖励摘要：`资金+2 · AP+1`（未知键忽略；空则「无奖励」）。 */
export function rewardText(reward) {
  if (!reward || typeof reward !== 'object') return t('无奖励');
  const label = REWARD_LABEL();
  const parts = [];
  for (const k of REWARD_ORDER) {
    const v = Number(reward[k]);
    if (!Number.isFinite(v) || v === 0) continue;
    parts.push(`${label[k]}${v > 0 ? '+' : ''}${v}`);
  }
  return parts.length ? parts.join(' · ') : t('无奖励');
}

/** 类型图标地址（未知类型 → 官方 img_unknown.png）。 */
export function typeIcon(type) {
  const f = TYPE_ICON[type];
  return f ? `${ROGUE_ASSET}/node/${f}` : `${ROGUE_ASSET}/node/img_unknown.png`;
}

/** 类型色（未知类型 → 白）。 */
export function typeColor(type) {
  return TYPE_COLOR[type] || TYPE_COLOR.unknown;
}

/**
 * 层名去掉数据里自带的层级前缀：`第一层 · 荒废站台` → `荒废站台`。
 * 界面已经用顶部 chip / 详情「当前层」/ 时间轴数字表示第几层，再拼一遍就是「第 1 层 · 第一层 · 荒废站台」
 * （2026-11-04 第五轮视觉验收）。没有前缀时原样返回，不猜数据格式。
 * @param {string} name
 * @returns {string}
 */
export function layerTitle(name) {
  const s = String(name || '').trim();
  if (!s) return '';
  const m = /^第\s*[0-9一二三四五六七八九十百千零两]+\s*层\s*[·・:：]\s*(.+)$/.exec(s);
  return m ? m[1].trim() : s;
}

/**
 * 14 层时间轴：`sequence` 是拍平的全部节点（每层 3 个），每层只留一个圆点。
 * @returns {Array<{ key: string, index: number, name: string, type: string }>}
 */
export function layerTrail(nodes) {
  const seq = nodes && Array.isArray(nodes.sequence) ? nodes.sequence : [];
  const out = [];
  const seen = new Set();
  for (const n of seq) {
    if (!n || !n.layer || seen.has(n.layer)) continue;
    seen.add(n.layer);
    out.push({
      key: String(n.layer),
      index: out.length,
      name: String(n.layerName || n.layer),
      type: String(n.type || 'unknown'),
    });
  }
  return out;
}

/**
 * 可点击的那组候选：优先**下一层**（改得到下一回合的地图），没有下一层（最终层）时退回本层，只作展示。
 * @returns {{ list: object[], round: number, picked: string|null, isFinal: boolean, label: string }}
 */
export function choiceList(nodes) {
  const next = nodes && Array.isArray(nodes.nextChoices) ? nodes.nextChoices : [];
  const current = nodes && Array.isArray(nodes.choices) ? nodes.choices : [];
  const isFinal = next.length === 0;
  return {
    list: isFinal ? current : next,
    round: Number(isFinal ? (nodes && nodes.round) : (nodes && nodes.nextRound)) || 0,
    picked: (isFinal ? (nodes && nodes.picked) : (nodes && nodes.nextPicked)) || null,
    isFinal,
    label: isFinal ? t('本层候选') : t('下一层'),
  };
}

/** stageId → 主题号（`rogue_ro4_1-2` → `ro4`；不是肉鸽图返回 null）。 */
export function rogueThemeOf(stageId) {
  const m = /^rogue_(ro\d+)_/.exec(String(stageId || ''));
  return m ? m[1] : null;
}

/**
 * stageId → 界面短名：`rogue_ro5_1-2_dlc1` → `RO5 · 1-2 · DLC1`。
 * 界面任何位置都不再出现 `rogue_ro...` 原始串（见文件头）；不是肉鸽图返回 ''，调用方显示「—」。
 * DLC 后缀统一保留（省略会让 ro5 的 `4-1_dlc1` / `4-1_dlc2` 两张图读成同一关）。
 * @param {string} stageId
 * @returns {string}
 */
export function mapLabel(stageId) {
  const m = /^rogue_(ro\d+)_([0-9a-z]+(?:-[0-9a-z]+)*?)(?:_dlc(\d+))?$/i.exec(String(stageId || ''));
  if (!m) return '';
  const dlc = m[3] ? ` · DLC${m[3]}` : '';
  return `${m[1].toUpperCase()} · ${m[2]}${dlc}`;
}

/**
 * 主题官方底图（按 stageId 稳定选一张：同一关每次打开都是同一张，不闪）。
 * 素材缺失 / 非肉鸽图 → null（地图页只画不自造路径）。
 */
export function backdropPath(stageId) {
  const theme = rogueThemeOf(stageId);
  if (!theme) return null;
  const range = BACKDROP_RANGE[theme];
  if (!range) return null;
  const num = Number(theme.slice(2));
  const span = range[1] - range[0] + 1;
  const source = String(stageId);
  let h = 0;
  for (let i = 0; i < source.length; i++) h = (h * 31 + source.charCodeAt(i)) >>> 0;
  const idx = range[0] + (h % span);
  return `${ROGUE_ASSET}/${theme}/rogue_${num}_map_${idx}.webp`;
}

/**
 * 藏品列表：`priv.relicCards`（有名称/品阶/实装标记）优先，`pub.rogue.relics` 作后备（可能只有 id）。
 * @returns {Array<{ id, name, tier, kind, icon, desc, applied }>}
 */
export function relicList(pub, relicCards) {
  const cards = Array.isArray(relicCards) ? relicCards : [];
  const raw = pub && pub.rogue && Array.isArray(pub.rogue.relics) ? pub.rogue.relics : [];
  if (cards.length) {
    return cards.map((c) => ({
      id: String(c.id || ''),
      name: String(c.name || c.id || ''),
      tier: String(c.tier || ''),
      kind: String(c.kind || ''),
      icon: String(c.icon || ''),
      desc: String(c.desc || ''),
      applied: c.applied !== false,
    }));
  }
  return raw.map((r) => (typeof r === 'string'
    ? { id: r, name: r, tier: '', kind: '', icon: '', desc: '', applied: true }
    : {
      id: String(r && r.id || ''),
      name: String((r && r.name) || (r && r.id) || ''),
      tier: String(r && r.tier || ''),
      kind: String(r && r.kind || ''),
      icon: String(r && r.icon || ''),
      desc: String(r && r.desc || ''),
      applied: !r || r.applied !== false,
    }));
}

/** 类名拼接（不引第三方）。 */
const cls = (...parts) => parts.filter(Boolean).join(' ');

/** 候选 id → 名称（找不到返回空串；详情页与时间轴都用它，不猜 id 的写法）。 */
export function pickText(id, list) {
  const want = String(id || '');
  if (!want) return '';
  const hit = (Array.isArray(list) ? list : []).find((n) => n && String(n.id) === want);
  return hit ? String(hit.name || hit.id || '') : '';
}

/**
 * 下一层预览的「地图标签」：tier 决定下一回合打哪张官方图（plugins/roguelike-core 的 `rogueStageFor`：
 * `rogue_ro<主题号>_<tier>-*`，同 tier 多张时按 seed 稳定取一张），所以预览只能给 **主题前缀 + tier**，不是具体关卡：
 * `RO5 · T1`（拿不到主题时只给 tier 文案）。不拼 `rogue_ro...` 原始串。
 * @param {string|number} tier @param {string} mapId 本局的 `nodes.mapId`（取主题号）
 * @returns {string}
 */
export function mapTierLabel(tier, mapId) {
  const label = tierLabel(tier);
  if (!label) return '';
  const theme = rogueThemeOf(mapId);
  return theme ? `${theme.toUpperCase()} · ${label}` : label;
}

/**
 * 地图统计（地图页右栏信息卡）：按 `buildMinimapModel` 的 `kinds` / `marks` 数格子与部署点，只读不新造数据。
 * @param {{ kinds?: string[][], marks?: Array<{ kind: string }> }|null} model
 * @returns {{ ground:number, high:number, forbidden:number, blocked:number, melee:number, ranged:number, cells:number }|null}
 */
export function minimapStats(model) {
  if (!model || !Array.isArray(model.kinds)) return null;
  const out = { ground: 0, high: 0, forbidden: 0, blocked: 0, melee: 0, ranged: 0, cells: 0 };
  for (const row of model.kinds) {
    for (const kind of (Array.isArray(row) ? row : [])) {
      out.cells += 1;
      if (kind === TERRAIN.GROUND) out.ground += 1;
      else if (kind === TERRAIN.HIGH) out.high += 1;
      else if (kind === TERRAIN.FORBIDDEN) out.forbidden += 1;
      else out.blocked += 1;
    }
  }
  for (const m of (Array.isArray(model.marks) ? model.marks : [])) {
    if (!m) continue;
    if (m.kind === 'melee') out.melee += 1;
    else if (m.kind === 'ranged') out.ranged += 1;
  }
  return out;
}

/**
 * 当前层的节点（详情列用）：优先 `nodes.picked`（本层真正落地的那个），其次 `nodes.current`，再从本层候选里按
 * `tier` 兜一层；都没有返回 null（还没开局）。
 * @returns {object|null}
 */
export function currentChoice(nodes) {
  const list = Array.isArray(nodes && nodes.choices) ? nodes.choices : [];
  const id = String((nodes && (nodes.picked || nodes.current)) || '');
  if (id) {
    const hit = list.find((n) => n && String(n.id) === id);
    if (hit) return hit;
  }
  const tier = nodes && nodes.tier != null ? String(nodes.tier) : '';
  if (!tier) return null;
  return list.find((n) => n && String(n.tier) === tier) || null;
}

/** 下一层预览：`nextChoices`（最终层为空），每组候选的 tier 决定下一回合的地图前缀。 */
export function previewChoices(nodes) {
  const next = nodes && Array.isArray(nodes.nextChoices) ? nodes.nextChoices : [];
  return next;
}

/** 难度条比例：数字 tier 是肉鸽层级 1–7，字母层级（t 精英 / b 首领 / ev 事件 / d 补给）给一个固定档。 */
export function difficultyFrac(tier) {
  const v = tier == null ? '' : String(tier);
  if (/^\d+$/.test(v)) return Math.max(0, Math.min(1, Number(v) / 7));
  if (v === 'd') return .2;
  if (v === 'ev') return .35;
  if (v === 't') return .7;
  if (v === 'b') return 1;
  return .3;
}

/** tab 表（渲染时取标签）。 */
const tabList = () => [
  { id: 'nodes', label: t('节点') },
  { id: 'map', label: t('地图') },
  { id: 'relics', label: t('藏品') },
];

/**
 * 集成战略叠加面板。
 * @param {{
 *   pub: object|null,
 *   relicCards?: Array|null,
 *   open?: boolean,
 *   blocked?: boolean,
 *   onClose?: () => void,
 *   onPickNode?: (intent: string, payload: object) => Promise<unknown>|unknown,
 * }} props
 */
export function RoguePanel({ pub, relicCards = null, open = false, blocked = false, onClose, onPickNode }) {
  const stagesReady = useData('stages');
  const [tab, setTab] = useState('nodes');
  const [busy, setBusy] = useState(null);
  // 关掉面板时清忙态：下一次打开不该继承上一张卡片的 spinner
  useEffect(() => { if (!open) setBusy(null); }, [open]);

  const rogue = pub && pub.rogue ? pub.rogue : null;
  if (!open || !rogue) return null;

  const nodes = rogueNodes(pub);
  const trail = layerTrail(nodes);
  const picks = choiceList(nodes);
  const relics = relicList(pub, relicCards);
  const currentIndex = nodes && Number.isFinite(Number(nodes.index)) ? Number(nodes.index) : -1;
  const ap = Number(nodes && nodes.ap) || 0;
  const maxAp = Math.max(Number(nodes && nodes.maxAp) || 0, ap, 1);
  const layerName = nodes && nodes.layerName ? String(nodes.layerName) : '';
  const round = Number(pub && pub.round) || 0;
  const lastRound = Number(pub && pub.lastRound) || 0;
  const affix = rogue.affix && rogue.affix.label ? String(rogue.affix.label) : '';
  const canSend = typeof onPickNode === 'function' && !blocked;
  // 详情列 / 时间轴要用的派生值（全部只读 `pub.rogue.nodes`，不新造字段）
  const cur = currentChoice(nodes);
  const curType = cur && cur.type ? String(cur.type) : (trail[currentIndex] ? String(trail[currentIndex].type) : '');
  const curTier = cur && cur.tier != null ? cur.tier : (nodes && nodes.tier != null ? nodes.tier : '');
  const curCost = cur && Number.isFinite(Number(cur.cost)) ? Number(cur.cost) : 0;
  const curMapId = nodes && nodes.mapId ? String(nodes.mapId) : '';
  // 当前这一局的关卡：`pub.stageId`（缩略图读的那张）优先，其次 `nodes.mapId`；两者都只作 `mapLabel` 的输入
  const stageIdNow = (pub && pub.stageId ? String(pub.stageId) : '') || curMapId;
  const mapName = mapLabel(stageIdNow);
  const themeNo = rogueThemeOf(stageIdNow);
  const curPickedName = pickText(nodes && nodes.picked, nodes && nodes.choices);
  const nextPickedName = pickText(nodes && nodes.nextPicked, nodes && nodes.nextChoices);
  const preview = previewChoices(nodes);
  const diffPct = Math.round(difficultyFrac(curTier) * 100);

  const pick = async (nodeId) => {
    if (!canSend || busy) return;
    const { intent, payload } = nodeIntent(nodeId);
    setBusy(String(nodeId));
    try {
      await onPickNode(intent, payload);
    } catch (e) {
      // 拒绝 / 断线由对局页的统一错误提示处理，这里只解除忙态
    } finally {
      setBusy(null);
    }
  };

  const stage = stagesReady && pub && pub.stageId ? data.lookup('stages', pub.stageId) : null;
  const model = tab === 'map' ? buildMinimapModel(stage) : null;
  const backdrop = tab === 'map' ? backdropPath(pub && pub.stageId) : null;
  const mapStats = tab === 'map' ? minimapStats(model) : null;

  const head = html`<header class="rpn__head">
    <div class="rpn__headline">
      <span class="rpn__micro">ROGUELIKE // <b>INTEGRATED STRATEGIES</b></span>
      <h2 class="rpn__title" data-text=${t('集成战略')}>${t('集成战略')}</h2>
    </div>
    <div class="rpn__chips">
      <span class="rpn__chip rpn__chip--layer">${layerTitle(layerName)
        || (currentIndex >= 0 ? t('第 {n} 层', { n: currentIndex + 1 }) : t('第 1 层'))}</span>
      <span class="rpn__chip">${lastRound ? t('回合 {r}/{last}', { r: round, last: lastRound }) : t('回合 {r}', { r: round })}</span>
      ${mapName ? html`<span class="rpn__chip rpn__chip--map">${t('地图')} <b>${mapName}</b></span>` : null}
      <span class="rpn__chip rpn__chip--ap"><b>AP</b> ${ap}/${maxAp}</span>
      <span class="rpn__chip rpn__chip--relic">${t('藏品 {n}/{max}', { n: relics.length, max: RELIC_CAP })}</span>
    </div>
    <button type="button" class="rpn__close" aria-label=${t('关闭集成战略')} title=${t('关闭')}
      data-testid="rogue-panel-close" onClick=${() => onClose && onClose()}><${Icon} name="close" /></button>
  </header>`;

  const tabs = html`<nav class="rpn__tabs" role="tablist" aria-label=${t('集成战略页面')}>
    ${tabList().map((tb) => html`<button key=${tb.id} type="button" role="tab" id=${`rpn-tab-${tb.id}`}
      aria-selected=${tab === tb.id} aria-controls=${`rpn-page-${tb.id}`} data-tab=${tb.id}
      class=${cls('rpn__tab', tab === tb.id && 'is-on')} onClick=${() => setTab(tb.id)}>${tb.label}</button>`)}
  </nav>`;

  const pageProps = { role: 'tabpanel', id: `rpn-page-${tab}`, 'aria-labelledby': `rpn-tab-${tab}` };

  const nodesPage = html`<div class="rpn-nodes" ...${pageProps}>
    <aside class="rpn-rail" aria-label=${t('节点层')}>
      ${trail.length ? html`<ol class="rpn-trail">
        ${trail.map((row) => {
          const done = row.index < currentIndex;
          const now = row.index === currentIndex;
          const chosen = now ? curPickedName : (row.index === currentIndex + 1 ? nextPickedName : '');
          return html`<li key=${row.key}
            class=${cls('rpn-trail__row', done && 'is-done', now && 'is-current', !done && !now && 'is-next', chosen && 'is-picked')}
            aria-current=${now ? 'step' : null}>
            <span class="rpn-trail__dot" aria-hidden="true"></span>
            <span class="rpn-trail__idx">${row.index + 1}</span>
            <span class="rpn-trail__name">
              <span class="rpn-trail__label">${row.name}</span>
              ${chosen ? html`<i class="rpn-trail__chosen">${t('已选')} · ${chosen}</i>` : null}
            </span>
            <span class="rpn-trail__type" style=${`--c:${typeColor(row.type)}`}>${typeName(row.type)}</span>
          </li>`;
        })}
      </ol>` : html`<p class="rpn-empty">${t('本局没有节点数据：服务端未安装 roguelike-core。')}</p>`}
      <ul class="rpn-rail__legend" aria-label=${t('节点图例')}>
        <li><i class="is-past" aria-hidden="true"></i>${t('已通过')}</li>
        <li><i class="is-now" aria-hidden="true"></i>${t('当前')}</li>
        <li><i class="is-todo" aria-hidden="true"></i>${t('未到')}</li>
      </ul>
    </aside>

    <section class="rpn-pick">
      <div class="rpn-pick__head">
        <b>${picks.label}${picks.round ? ` · ${t('第 {n} 层', { n: picks.round })}` : ''}</b>
        <span class="rpn-pick__note">${picks.isFinal ? t('已结算') : t('三选一')}</span>
        ${blocked ? html`<span class="rpn-pick__warn">${t('战斗中不可选')}</span>` : null}
        ${!canSend && !blocked ? html`<span class="rpn-pick__warn">${t('只读：拿不到对局网络')}</span>` : null}
      </div>
      ${picks.list.length ? html`<div class="rpn-cards">
        ${picks.list.map((n) => {
          const picked = picks.picked === n.id;
          const poor = n.available === false;
          const disabled = !canSend || poor || picks.isFinal || busy !== null;
          return html`<button key=${n.id} type="button"
            class=${cls('rpn-card', picked && 'is-picked', disabled && 'is-off')}
            style=${`--c:${typeColor(n.type)}`}
            data-node-id=${n.id} data-type=${n.type} data-picked=${picked ? 'yes' : 'no'}
            disabled=${disabled}
            aria-label=${`${n.name || typeName(n.type)} · ${typeName(n.type)}${n.tier ? ` · ${tierLabel(n.tier)}` : ''} · ${rewardText(n.reward)}`}
            onClick=${() => pick(n.id)}>
            <img class="rpn-card__bg" src=${NODE_CARD_BG} alt="" aria-hidden="true" />
            <span class="rpn-card__bar" aria-hidden="true"></span>
            <span class="rpn-card__top">
              <img class="rpn-card__icon" src=${typeIcon(n.type)} alt="" aria-hidden="true" />
              <span class="rpn-card__type">${typeName(n.type)}</span>
              <span class="rpn-card__badges">
                ${picked ? html`<span class="rpn-card__mark">${t('已选')}</span>` : null}
                ${n.tier && tierLabel(n.tier) !== typeName(n.type) ? html`<span class="rpn-card__tier">${tierLabel(n.tier)}</span>` : null}
              </span>
            </span>
            <span class="rpn-card__name">${n.name || typeName(n.type)}</span>
            <span class="rpn-card__effect">${rewardText(n.reward)}</span>
            <span class="rpn-card__foot">
              <span class="rpn-card__cost">${n.cost ? `-${n.cost} AP` : t('免费')}</span>
            </span>
            ${busy === n.id ? html`<span class="rpn-card__busy" aria-hidden="true"></span>` : null}
          </button>`;
        })}
      </div>` : html`<p class="rpn-empty">${t('这一层没有候选节点。')}</p>`}
      ${picks.isFinal ? html`<p class="rpn-pick__hint">${t('最终层：本层已开局，选择只作记录，不再改图。')}</p>` : null}
    </section>

    <section class="rpn-detail" aria-label=${t('节点详情')}>
      <div class="rpn-detail__sec">
        <h3 class="rpn-detail__h">${t('节点详情')}</h3>
        <dl class="rpn-detail__rows">
          <div><dt>${t('当前层')}</dt><dd>${currentIndex >= 0
            ? (layerTitle(layerName) || t('第 {n} 层', { n: currentIndex + 1 }))
            : t('尚未开局')}</dd></div>
          <div><dt>${t('类型')}</dt><dd class="is-type" style=${`--c:${typeColor(curType)}`}>${curType ? typeName(curType) : '—'}</dd></div>
          <div><dt>${t('地图')}</dt><dd>${mapName || '—'}</dd></div>
          <div><dt>${t('进度')}</dt><dd>${trail.length ? `${Math.max(1, currentIndex + 1)} / ${trail.length}` : '—'}</dd></div>
        </dl>
      </div>
      <div class="rpn-detail__sec">
        <h3 class="rpn-detail__h">${t('下一层预览')}</h3>
        ${preview.length ? html`<ul class="rpn-preview">
          ${preview.map((n) => html`<li key=${n.id}
            class=${cls('rpn-preview__row', picks.picked === n.id && 'is-picked')}
            style=${`--c:${typeColor(n.type)}`}>
            <span class="rpn-preview__dot" aria-hidden="true"></span>
            <span class="rpn-preview__name">${n.name || typeName(n.type)}</span>
            <span class="rpn-preview__map">${mapTierLabel(n.tier, curMapId || stageIdNow) || '—'}</span>
          </li>`)}
        </ul>` : html`<p class="rpn-detail__note">${t('已是最终层：没有下一层候选。')}</p>`}
      </div>
      <div class="rpn-detail__sec">
        <h3 class="rpn-detail__h">${t('本局摘要')}</h3>
        <div class="rpn-detail__stats">
          <span><b>AP</b>${ap}/${maxAp}</span>
          <span><b>${t('藏品')}</b>${relics.length}/${RELIC_CAP}</span>
          <span><b>${t('词缀')}</b>${affix || t('无')}</span>
        </div>
      </div>
      <div class="rpn-detail__sec rpn-detail__sec--last">
        <h3 class="rpn-detail__h">${t('本层奖励 / 难度')}</h3>
        <div class="rpn-detail__reward">
          <span class="rpn-detail__diff">${curTier !== '' ? tierLabel(curTier) : t('难度未知')}</span>
          <span class="rpn-detail__rew">${rewardText(cur && cur.reward)}</span>
          ${curCost ? html`<span class="rpn-detail__cost">${t('消耗')} -${curCost} AP</span>` : null}
        </div>
        <div class="rpn-detail__meter" aria-hidden="true"><i style=${`width:${diffPct}%`}></i></div>
      </div>
    </section>
  </div>`;

  const mapPage = html`<div class="rpn-map" ...${pageProps}>
    <div class="rpn-map__stage">
      ${backdrop ? html`<img class="rpn-map__bg" src=${backdrop} alt="" aria-hidden="true" />` : null}
      ${model ? minimap(model) : html`<p class="rpn-empty">${t('战场缩略图待载入…')}</p>`}
      <span class="rpn-map__label">${mapName || t('未知战场')}</span>
    </div>
    <ul class="rpn-legend" aria-label=${t('地图图例')}>
      <li><i style=${`background:${MAP_COLORS.ground}`}></i>${t('地面')}</li>
      <li><i class="is-high" style=${`background:${MAP_COLORS.high}`}></i>${t('高台 / 墙')}</li>
      <li><i class="is-forbidden" style=${`background:${MAP_COLORS.forbidden}`}></i>${t('禁入')}</li>
      <li><i style=${`background:${MAP_COLORS.blocked}`}></i>${t('其他')}</li>
      <li><i class="is-dot" style=${`background:${MAP_COLORS.melee}`}></i>${t('可部署（近战）')}</li>
      <li><i class="is-dot" style=${`background:${MAP_COLORS.ranged}`}></i>${t('可部署（远程）')}</li>
    </ul>
    <aside class="rpn-map__side" aria-label=${t('关卡信息')}>
      <div class="rpn-map__card">
        <h3 class="rpn-map__h">${t('关卡信息')}</h3>
        <dl class="rpn-map__rows">
          <div><dt>${t('关卡')}</dt><dd>${mapName || '—'}</dd></div>
          <div><dt>${t('回合')}</dt><dd>${lastRound ? `${round}/${lastRound}` : String(round)}</dd></div>
          <div><dt>${t('尺寸')}</dt><dd>${model
            ? t('{w}×{h} 格', { w: model.width, h: model.height })
            : '—'}</dd></div>
          <div><dt>${t('主题')}</dt><dd>${themeNo ? themeNo.slice(2) : '—'}</dd></div>
        </dl>
        ${mapStats ? html`<div class="rpn-map__tiles">
          <span class="rpn-map__tile is-ground"><b class="num">${mapStats.ground}</b>${t('地面')}</span>
          <span class="rpn-map__tile is-high"><b class="num">${mapStats.high}</b>${t('高台 / 墙')}</span>
          <span class="rpn-map__tile is-forbidden"><b class="num">${mapStats.forbidden}</b>${t('禁入')}</span>
          <span class="rpn-map__tile is-blocked"><b class="num">${mapStats.blocked}</b>${t('其他')}</span>
          <span class="rpn-map__tile is-melee"><b class="num">${mapStats.melee}</b>${t('近战部署点')}</span>
          <span class="rpn-map__tile is-ranged"><b class="num">${mapStats.ranged}</b>${t('远程部署点')}</span>
        </div>` : null}
        <p class="rpn-map__note">${t('地面格可通行；高台 / 墙要近战干员踩上去才可部署。禁入格（红纹）不可进入、也不可部署。黄点是近战部署点，绿点是远程部署点。')}</p>
      </div>
    </aside>
  </div>`;


  const badges = [];
  if (rogue.emergency === true) badges.push({ icon: 'warn', text: t('紧急作战') });
  if (Number.isInteger(rogue.nextEventRound)) badges.push({ icon: 'dice', text: t('下次不期而遇 R{r}', { r: rogue.nextEventRound }) });
  if (Number.isInteger(rogue.nextEmergencyRound)) badges.push({ icon: 'hourglass', text: t('下次紧急作战 R{r}', { r: rogue.nextEmergencyRound }) });

  const relicsPage = html`<div class="rpn-relics" ...${pageProps}>
    <div class="rpn-relics__head">
      <b>${t('本局藏品 {n}/{max}', { n: relics.length, max: RELIC_CAP })}</b>
      ${affix ? html`<span class="rpn-relics__affix">${t('词缀：')}${affix}</span>` : null}
      ${badges.map((b) => html`<span key=${b.text} class="rpn-relics__badge"><${Icon} name=${b.icon} />${b.text}</span>`)}
    </div>
    ${relics.length ? html`<ul class="rpn-relics__list">
      ${relics.map((c) => html`<li key=${c.id} class=${cls('rpn-relic', c.kind === 'negative' && 'is-negative')} data-relic-id=${c.id}>
        <span class="rpn-relic__icon">
          ${c.icon ? html`<img src=${c.icon} alt="" loading="lazy" />` : html`<${Icon} name="box" />`}
        </span>
        <span class="rpn-relic__body">
          <b>${c.name}</b>
          ${c.desc ? html`<span class="rpn-relic__desc">${c.desc}</span>` : null}
        </span>
        ${c.tier ? html`<span class="rpn-relic__tier">${c.tier}</span>` : null}
        ${c.applied === false ? html`<span class="rpn-relic__na" title=${t('这条藏品的效果还没接进引擎：本局只记录、不生效')}>${t('未实装')}</span>` : null}
      </li>`)}
    </ul>` : html`<p class="rpn-empty">${t('还没有藏品：开局与每 2 回合各有一次三选一。')}</p>`}
  </div>`;

  return html`<div class="rpn" id="rogue-panel" role="dialog" aria-modal="true" aria-label=${t('集成战略')} data-testid="rogue-panel">
    <div class="rpn__veil" aria-hidden="true" onClick=${() => onClose && onClose()}></div>
    <div class="rpn__panel" data-tab=${tab}>
      ${head}
      ${tabs}
      <div class="rpn__body">
        ${tab === 'map' ? mapPage : tab === 'relics' ? relicsPage : nodesPage}
      </div>
    </div>
  </div>`;
}

/**
 * 战场缩略图（静态 SVG，不启第二个棋盘渲染器）：按 `kinds` 上色，部署格打点。
 * 坐标翻转与 ui/rogueMapDock.js 一致：`kinds[0]` 是引擎最下行 → 画到最下面。
 * 禁入格填 `<pattern>` 斜纹（灰红底 + 淡红斜线）：只靠颜色时第一眼像「可玩区被围死」，斜纹让它读成禁区。
 */
function minimap(model) {
  const { width, height, kinds, marks } = model;
  const cell = 10;
  const W = width * cell;
  const H = height * cell;
  const cells = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      const kind = (kinds && kinds[r] && kinds[r][c]) || TERRAIN.BLOCKED;
      cells.push({ key: `${r},${c}`, x: c * cell, y: (height - 1 - r) * cell, kind });
    }
  }
  const dots = marks.map((m) => ({
    key: `d${m.r},${m.c}`,
    cx: m.c * cell + cell / 2,
    cy: (height - 1 - m.r) * cell + cell / 2,
    fill: m.kind === 'melee' ? MAP_COLORS.melee : MAP_COLORS.ranged,
  }));
  return html`<svg class="rpn-map__svg" viewBox=${`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet"
      role="img" aria-label=${t('战场缩略图')} data-testid="rogue-map-svg">
    <defs>
      <pattern id=${HATCH_ID} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="5" height="5" fill=${MAP_COLORS.forbidden} />
        <line x1="0" y1="0" x2="0" y2="5" stroke=${MAP_COLORS.hatch} stroke-width="1.6" />
      </pattern>
    </defs>
    ${cells.map((p) => html`<rect key=${p.key} x=${p.x} y=${p.y} width=${cell} height=${cell}
      fill=${p.kind === TERRAIN.FORBIDDEN ? `url(#${HATCH_ID})` : MAP_COLORS[p.kind] || MAP_COLORS.blocked}
      stroke=${p.kind === TERRAIN.HIGH ? 'rgba(0, 226, 228, .55)' : MAP_COLORS.grid}
      stroke-width=${p.kind === TERRAIN.HIGH ? 0.7 : 0.3} />`)}
    ${dots.map((d) => html`<circle key=${d.key} cx=${d.cx} cy=${d.cy} r=${cell * 0.26}
      fill=${d.fill} stroke="rgba(6, 12, 20, .85)" stroke-width="0.6" />`)}
  </svg>`;
}
