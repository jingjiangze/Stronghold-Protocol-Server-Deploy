// plugins/roguelike-ui/client/js/ui/rogueNodes.js — 肉鸽节点图浮层（class ui 的同源模块）。
//
// 由插件宿主以 /js/ui/rogueNodes.js 下发；mota 的 rogueNodesHost.js 动态 import 后渲染。
// 只读 pub.rogue.nodes（server views.js 的扩展），不启动第二个棋盘渲染器。
//
// 三选一（2026-11-04）：服务端数据表 layers[] 每层给 3 个候选，节点的 tier 决定这一回合打哪张官方图。
// 面板显示「第 N 层」+ 3 个候选按钮（类型 / 名称 / tier / 奖励摘要），点一下发 `g.rogueNode { nodeId }`
// （与 game.js 里 g.roguePick 同一条 net 通道：`net.request`）。
//   · 可操作的是**下一层**那组（`nodes.nextChoices`）：本层的图与奖励在回合开始就已结算，选择要在
//     下一回合开始前落下才改得到地图；没有下一层（最终层）时退回本层候选，仅作展示/记录。
//   · 拿不到 net（插件被单独部署到只读页等）时退化为只读展示：按钮禁用 + 一行说明，不编造接口。
//
// 注意：htm 模板里不能写 JS 式 `//` 注释（会进解析器的自闭合分支 → h.push 崩），注释一律写在模板外。

import { html } from './components.js';
import { useEffect, useState } from '../../vendor/hooks.module.js';

const TYPE_COLOR = {
  battle: '#e85a1a',
  event: '#f6c329',
  shop: '#4aa8ff',
  rest: '#5ad1a0',
  elite: '#c431ff',
  boss: '#ff2d2d',
};

const TYPE_NAME = {
  battle: '战斗',
  event: '事件',
  shop: '商店',
  rest: '休整',
  elite: '精英',
  boss: '首领',
};

const REWARD_NAME = { funds: '资金', lp: '生命', ap: 'AP', deployCap: '部署' };
const REWARD_ORDER = ['funds', 'lp', 'ap', 'deployCap'];

/** tier 徽章文案：数字 → T<n>；字母是肉鸽层级（t 精英 / d 补给 / ev 事件 / b 首领）。 */
function tierLabel(tier) {
  const t = typeof tier === 'string' ? tier : String(tier || '');
  if (!t) return '';
  if (/^\d+$/.test(t)) return `T${t}`;
  if (t === 'b') return 'BOSS';
  if (t === 't') return '精英';
  if (t === 'ev') return '事件';
  if (t === 'd') return '补给';
  return t.toUpperCase();
}

/** 奖励摘要：`资金+2 · 生命+1`（未知键忽略；空则「无奖励」）。 */
function rewardText(reward) {
  if (!reward || typeof reward !== 'object') return '无奖励';
  const parts = [];
  for (const k of REWARD_ORDER) {
    const v = Number(reward[k]);
    if (!Number.isFinite(v) || v === 0) continue;
    parts.push(`${REWARD_NAME[k]}${v > 0 ? '+' : ''}${v}`);
  }
  return parts.length ? parts.join(' · ') : '无奖励';
}

/**
 * 懒加载 net：插件模块的 static import 一旦路径不对会让整块浮动层 404（rogueNodesHost 的注释同理），
 * 所以这里按需 import 并缓存结果；拿不到就返回 null，面板转只读。
 */
let netPromise = null;
function loadNet() {
  if (!netPromise) {
    netPromise = import('../net.js')
      .then((m) => (m && m.net && typeof m.net.request === 'function' ? m.net : null))
      .catch(() => null);
  }
  return netPromise;
}

function nodeStyle(n, active, visited) {
  const color = TYPE_COLOR[n.type] || '#8a93a6';
  return [
    'display:inline-flex', 'align-items:center', 'justify-content:center',
    'width:.26rem', 'height:.26rem', 'border-radius:50%',
    `border:1px solid ${active ? color : 'rgba(255,255,255,.22)'}`,
    `background:${active ? color : visited ? 'rgba(255,255,255,.10)' : 'rgba(12,14,20,.72)'}`,
    `color:${active ? '#0b0d12' : visited ? 'rgba(232,234,240,.55)' : '#e8eaf0'}`,
    'font:600 calc(.12 * var(--t))/1 ui-monospace,monospace',
    active ? 'box-shadow:0 0 0 2px rgba(255,255,255,.18)' : '',
  ].filter(Boolean).join(';');
}

/** 一个候选按钮：左侧类型点 + 名称 + tier 徽章 + 消耗 + 奖励摘要。 */
function choiceStyle(n, picked, disabled) {
  const color = TYPE_COLOR[n.type] || '#8a93a6';
  return [
    'all:unset', 'box-sizing:border-box', 'display:flex', 'align-items:center', 'gap:.07rem',
    'width:100%', 'padding:.06rem .08rem', 'border-radius:.06rem', 'cursor:pointer',
    `border:1px solid ${picked ? color : 'rgba(255,255,255,.14)'}`,
    `background:${picked ? 'rgba(255,255,255,.10)' : 'rgba(12,14,20,.55)'}`,
    'color:#e8eaf0',
    disabled ? 'opacity:.45' : '',
    disabled ? 'cursor:not-allowed' : '',
  ].filter(Boolean).join(';');
}

/**
 * 节点图浮层。pub 是 mota 的对局公共状态；pub.rogue.nodes 由 rogue-core 的 mixin 提供。
 * 没有 pub.rogue.nodes（非肉鸽局 / 插件被停用）时返回 null，不影响对局。
 */
export function RogueNodes({ pub }) {
  const nodes = pub && pub.rogue && pub.rogue.nodes ? pub.rogue.nodes : null;
  const [netState, setNetState] = useState('probing');
  const [busy, setBusy] = useState(null);
  useEffect(() => {
    let dead = false;
    loadNet().then((n) => { if (!dead) setNetState(n ? 'ready' : 'none'); });
    return () => { dead = true; };
  }, []);
  if (!nodes) return null;

  const seq = Array.isArray(nodes.sequence) ? nodes.sequence : [];
  const index = Number.isFinite(Number(nodes.index)) ? Number(nodes.index) : -1;
  const ap = Number(nodes.ap) || 0;
  const maxAp = Number(nodes.maxAp) || Math.max(1, ap);
  const pips = [];
  for (let i = 0; i < maxAp; i++) pips.push(i < ap);

  // 层进度：sequence 是拍平的全部节点（每层 3 个），这里每层只留一个圆点，避免 42 个点糊成一片。
  const layersSeen = [];
  const seenLayers = new Set();
  for (const n of seq) {
    if (!n || !n.layer || seenLayers.has(n.layer)) continue;
    seenLayers.add(n.layer);
    layersSeen.push({ layer: n.layer, name: n.layerName || n.layer, type: n.type });
  }

  const current = Array.isArray(nodes.choices) ? nodes.choices : [];
  const next = Array.isArray(nodes.nextChoices) ? nodes.nextChoices : [];
  // 可点击的是下一层（改得到地图）；最终层没有下一层时退回本层，只记录不改图。
  const list = next.length ? next : current;
  const listRound = next.length ? Number(nodes.nextRound) || 0 : Number(nodes.round) || 0;
  const pickedId = next.length ? (nodes.nextPicked || null) : (nodes.picked || null);
  const isBossLayer = list.some((n) => n && (n.type === 'boss' || String(n.tier) === 'b'));
  const canSend = netState === 'ready';
  const isFinal = list === current && !next.length;

  const pick = async (nodeId) => {
    if (!canSend || busy) return;
    setBusy(nodeId);
    try {
      const target = await loadNet();
      if (target) await target.request('g.rogueNode', { nodeId });
    } catch { /* 拒绝/断线由对局页的统一错误提示处理，这里只解除忙态 */ } finally { setBusy(null); }
  };

  return html`<div data-testid="rogue-nodes" style="position:fixed;left:.12rem;top:1.05rem;z-index:41;width:min(2.5rem,34vw);max-height:min(3.4rem,52vh);overflow:auto;font-size:calc(.13 * var(--t));background:rgba(12,14,20,.86);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#e8eaf0">
    <div style="display:flex;align-items:center;gap:.09rem;padding:.08rem .1rem;border-bottom:1px solid rgba(255,255,255,.10)">
      <b style="flex:0 0 auto;white-space:nowrap">节点图</b>
      <span style="min-width:0;opacity:.8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${index >= 0 ? `第 ${index + 1} 层 · ` : ''}${nodes.layerName || '肉鸽'}</span>
      <span class="num" style="margin-left:auto;flex:0 0 auto;opacity:.85">AP ${ap}/${maxAp}</span>
    </div>
    <div style="display:flex;gap:3px;padding:.07rem .1rem 0">
      ${pips.map((on, i) => html`<span key=${`ap${i}`} style=${`width:100%;height:4px;border-radius:2px;background:${on ? '#5ad1a0' : 'rgba(255,255,255,.15)'}`}></span>`)}
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:.06rem;padding:.07rem .1rem .05rem">
      ${layersSeen.map((d, i) => html`<span key=${d.layer} title=${`第 ${i + 1} 层 · ${d.name}`}
        style=${nodeStyle(d, i === index, i < index)}>${i + 1}</span>`)}
    </div>
    <div style="display:flex;align-items:center;gap:.06rem;padding:.05rem .1rem .03rem;opacity:.85">
      <span style="font-weight:600;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${isFinal ? '本层候选' : `下一层 · 第 ${listRound} 层`}</span>
      ${isBossLayer ? html`<span style="flex:0 0 auto;color:#ff2d2d;font-weight:700;letter-spacing:.04em">BOSS</span>` : null}
      <span style="margin-left:auto;flex:0 0 auto;opacity:.7;font-size:calc(.11 * var(--t))">${isFinal ? '已结算' : '三选一'}</span>
    </div>
    <div style="display:flex;flex-direction:column;gap:.05rem;padding:.03rem .1rem .08rem">
      ${list.map((n) => {
        const picked = pickedId === n.id;
        const poor = n.available === false;
        const disabled = !canSend || poor || busy !== null || isFinal;
        const label = `${n.name || n.id} · ${TYPE_NAME[n.type] || n.type}${n.tier ? ` · ${tierLabel(n.tier)}` : ''}${poor ? ' · AP 不足' : ''}`;
        return html`<button key=${n.id} type="button" disabled=${disabled} title=${label}
          onClick=${() => pick(n.id)} style=${choiceStyle(n, picked, disabled)}>
          <span style=${`flex:0 0 auto;width:.1rem;height:.1rem;border-radius:50%;background:${TYPE_COLOR[n.type] || '#8a93a6'}`}></span>
          <span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${n.name || n.id}</span>
          ${n.tier ? html`<span style="flex:0 0 auto;padding:0 .04rem;border-radius:.03rem;background:rgba(255,255,255,.12);font:600 calc(.1 * var(--t))/1.4 ui-monospace,monospace">${tierLabel(n.tier)}</span>` : null}
          <span style="margin-left:auto;flex:0 0 auto;opacity:.85;font-size:calc(.11 * var(--t))">${n.cost ? `-${n.cost}` : '免费'}</span>
          <span style="flex:0 0 auto;opacity:.7;font-size:calc(.11 * var(--t))">${rewardText(n.reward)}</span>
        </button>`;
      })}
    </div>
    ${netState === 'none' ? html`<div style="padding:0 .1rem .08rem;font-size:calc(.11 * var(--t));color:#ffcf6a">只读：当前页面拿不到对局网络，无法提交选择</div>` : null}
    <div style="display:flex;gap:.08rem;padding:.02rem .1rem .06rem;opacity:.75;font-size:calc(.11 * var(--t))">
      <span style="color:#e85a1a">● 战斗</span>
      <span style="color:#f6c329">● 事件</span>
      <span style="color:#4aa8ff">● 商店</span>
      <span style="color:#5ad1a0">● 休整</span>
    </div>
    ${nodes.ended ? html`<div style="padding:.07rem .1rem;border-top:1px solid rgba(255,255,255,.10);color:#ffcf6a">结局钩子：本局节点序列已走完</div>` : null}
  </div>`;
}
