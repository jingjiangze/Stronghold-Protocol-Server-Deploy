import { useState } from '../../vendor/hooks.module.js';
import { html, Icon } from './components.js';
import { data, useData } from '../data.js';
import { t } from '../../../shared/i18n.js';
import { buildMinimapModel } from './rogueMapModel.js';

/**
 * 肉鸽「地图」浮层（业主 2026-11-02：「地图做成类似局内对话的逻辑，可收缩」）。
 *
 * 交互照 `roomChat` / `rogueHud` 的范式：**整条头部就是一个 button**，点一下收起/展开（`▾ / ▸`），
 * 收起后只留一行「地图 · 当前关卡名 · R3/14」，不挡战场。
 *
 * 数据：`m.public` 的 `stageId / nextStageId / round / lastRound`（服务端 views 已经下发），
 * 地形来自 `stages` 数据文件（`rows` = 19 行字符串、index 0 在最下行；`tiles[码].groundPassable` 判可走；
 * `deployTiles.normal` 给出可部署格）。**不启动第二个棋盘渲染器**——这里只是静态缩略图。
 */
export function RogueMapDock({ pub, disabled = false }) {
  const [open, setOpen] = useState(true);
  const ready = useData('stages');
  if (disabled || !pub || !pub.rogue) return null;   // 只在肉鸽里出现（服务端只给肉鸽房下发 pub.rogue）
  // lookup 而不是 get：内容集/版本会通过 view 换掉整份 stages（data.js 的 setView）
  const get = (id) => (ready && id ? data.lookup('stages', id) : null);
  const stageId = pub.stageId || null;
  const nextId = pub.nextStageId && pub.nextStageId !== stageId ? pub.nextStageId : null;
  const stage = get(stageId);
  const next = get(nextId);
  const round = Number(pub.round) || 0;
  const last = Number(pub.lastRound) || 0;
  const title = stage && stage.name ? stage.name : (stageId || t('未知战场'));

  const mini = open ? minimap(stage) : null;
  // 位置在右下角、抬到 bottom 2.4rem（设计单位 1rem = 100 设计 px，1280×720 下 1rem≈66.7px）：
  // 2.4rem ≈ 160px 清得开收起态的商店标签（≈56px），展开的商店栏按 CSS 估算约 243px 高 —— 若真机量到仍压住
  // 商店卡片，把 bottom 提到 3.7rem（≈247px），不要凭空往上加。⚠ 祖先若带 transform，fixed 的 bottom 会按其
  // 边框盒算 —— 实测 bottom 9.6rem 会算出视口外坐标。
  // ⚠ htm 的模板里不能写 JS 式 `//` 注释：`/` 会进解析器的自闭合分支（htm.module.js `(h=h[0]).push`），整屏 SYSTEM FAULT。
  return html`<div class="rmap" data-testid="rogue-map-dock"
      style="position:fixed;right:.12rem;bottom:2.4rem;z-index:40;width:min(1.8rem,26vw);font-size:calc(.13 * var(--t));
             background:rgba(12,14,20,.86);border:1px solid rgba(255,255,255,.14);border-radius:8px;color:#e8eaf0;overflow:hidden">
    <button type="button" data-testid="rogue-map-toggle" onClick=${() => setOpen((v) => !v)}
      aria-expanded=${open}
      style="all:unset;cursor:pointer;display:flex;gap:.09rem;align-items:center;width:100%;padding:.08rem .1rem;box-sizing:border-box">
      <${Icon} name="rook" />
      <b style="flex:0 0 auto;white-space:nowrap">${t('地图')}</b>
      <span style="min-width:0;opacity:.85;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${title}</span>
      ${last ? html`<span class="num" style="margin-left:auto;flex:0 0 auto;opacity:.7">R${round}/${last}</span>` : null}
      <span style="opacity:.6">${open ? '▾' : '▸'}</span>
    </button>
    ${open ? html`<div style="padding:0 .1rem .08rem">
      ${mini || html`<div style="opacity:.6;padding:.04rem 0">${t('战场缩略图待载入…')}</div>`}
      ${next ? html`<div style="margin-top:.07rem;opacity:.75">${t('下一场：')}${next.name || nextId}</div>` : null}
    </div>` : null}
  </div>`;
}

function minimap(stage) {
  const model = buildMinimapModel(stage);
  if (!model) return null;
  const { width, height, floor, marks } = model;
  const px = 6;
  const W = width * px;
  const H = height * px;
  const cells = [];
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) cells.push({ x: c, y: height - 1 - r, ok: floor[r][c] });
  }
  const dots = marks.map((m) => ({ x: m.c, y: height - 1 - m.r, kind: m.kind }));
  return html`<svg viewBox=${`0 0 ${W} ${H}`} width="100%"
      style=${`display:block;max-width:100%;height:auto;border-radius:4px;background:rgba(255,255,255,.04)`}
      role="img" aria-label=${t('战场缩略图')}>
    ${cells.map((cell) => html`<rect key=${`${cell.y},${cell.x}`} x=${cell.x * px} y=${cell.y * px} width=${px} height=${px}
      fill=${cell.ok ? 'rgba(120,200,255,.30)' : 'rgba(255,255,255,.05)'} />`)}
    ${dots.map((d) => html`<circle key=${`d${d.y},${d.x}`} cx=${d.x * px + px / 2} cy=${d.y * px + px / 2} r=${px * 0.28}
      fill=${d.kind === 'melee' ? 'rgba(255,196,84,.9)' : 'rgba(140,240,180,.85)'} />`)}
  </svg>`;
}
