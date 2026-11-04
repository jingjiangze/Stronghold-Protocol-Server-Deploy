// plugins/mota/client/js/ui/namecards.js — 座位 / 大厅的名片卡面层（业主 2026-11-02）。
//
// 原文件是「本仓没有 public/js/ui/namecards.js 时装上」的兼容桩（直接 return null）。
// 卡面的**样式**在 UI 包里本来就有（alliance-20 的 lobby.css：`.has-nc` + `.nc-layer`，
// `.nc-layer` 用 `background: var(--nc-shade), var(--nc) center/cover` 画底图）。所以这里只负责把
// 卡面 URL 写进 CSS 变量 `--nc`，阴影/裁切/圆角全部交给既有样式，不再自带一套 background-image。
//
// 素材路径由 cdn-local 兜底：本机没有 `/assets/local/sp-namecards-*` 就 302 到 CDN。

import { html } from '../ui/components.js';

/** 卡面素材目录（与账号插件 plugins/accounts 的 namecards.js 同一套 id） */
export const NAMECARD_DIR = '/assets/local/sp-namecards-20261014';

/** @param {string} id @returns {string} */
export const namecardUrl = (id) => (typeof id === 'string' && /^[A-Za-z0-9._-]{1,32}$/.test(id) ? NAMECARD_DIR + '/' + id + '.webp' : '');

/**
 * 名片底图：父容器需带 `.has-nc`（UI 包既有类）。`card` 可以是 `{ skin }` 或裸 id。
 * @param {{ card?: { skin?: string } | string | null }} props
 */
export function NameCardLayer({ card }) {
  const id = typeof card === 'string' ? card : card && typeof card === 'object' ? card.skin : '';
  const url = namecardUrl(id);
  if (!url) return null;
  return html`<span class="nc-layer" aria-hidden="true" style=${`--nc:url(${url})`}></span>`;
}
