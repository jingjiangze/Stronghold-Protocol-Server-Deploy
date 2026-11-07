// public/js/ui/cardArt.js — 名片立绘微调（房间座位卡上的「立绘调整」；本机 pref room.cardArt）。
//
// 座位卡上的立绘按本机 pref `room.cardArt` 的「每个干员一条」设置来画：
//   · 版本 art：'e1' = 精一立绘、'e2' = 精二立绘、'skin' = 所穿外观自己的立绘、'auto' = 没手动选过（穿了带立绘的外观就画
//     外观，否则精二）。
//     **数据源是我们自己的清单**：本仓的 data/assets.json 里 `chars[].illust` / `illustE1` 基本是空的（illustE1=0、
//     illust=4），立绘实际存在 `portrait` / `portraitE2` 里（房间页本来就在用它，见 room.css 的 `.rseat__art img`）。
//     所以 illustSources 的取法按这个优先级：`portraitE2` → `portrait` → `skins[skinId].illustration`（我方顶层
//     `skins` 是该字段名，外观不自带 portrait 时才拿 illustration 兜底）。不为此新增任何素材。
//   · 取景：立绘按**内容框**（先用 64px 缩略图量掉透明留白）用 px 摆在画面里，拖拽/缩放改的是「露出哪一块」。
//     调整面板的画布是**正方形**：正中按**真卡**比例框出 .cardart__win —— 那是整张卡（顶条 + 立绘框 + 名字条），
//     比例在开面板时从自己那张座位卡现量（room.js measureCardArtMetrics）。立绘只按**立绘框**取景，绝不按整卡。
//     档位 fit：'fill'（默认，内容框铺满立绘框）/ 'full'（整幅缩进立绘框），按干员分别记住。
//     **样式坑**：theme.css 的全局 `img { max-width: 100% }` 会把 px 摆好的立绘横向压扁（宽度被夹到容器宽、高度照旧），
//     画面位置全变 —— card-art.css 的 `.cardart__img { max-width: none; max-height: none }` 是这条链的一部分，别删。
//   · 持久化：本机 pref room.cardArt = { [charId]: { art, skin, fit, zoom, ox, oy } }。**刻意不并进 CARD_PREF** ——
//     那份是「玩家选了哪个干员」（room.card { charId }，服务端已收），改形状会动到同步链；而位置/缩放**服务端字段
//     待定**，所以先只存本机。
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { loadPref, savePref } from '../store.js';
import { t } from '../../../shared/i18n.js';

let cssLoaded = false;
/** 本模块的样式（懒加载写法，与项目其它 ui/*.js 一致；不进 index.html）。 */
export function ensureCardArtCss() {
  if (cssLoaded || typeof document === 'undefined') return;
  cssLoaded = true;
  if (document.querySelector('link[data-cardart]')) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/css/screens/card-art.css';
  link.dataset.cardart = '1';
  document.head.appendChild(link);
}

/** 立绘微调的本机 pref（按 charId 分条，互不影响）。 */
export const CARD_ART_PREF = 'room.cardArt';
/** 中立值：跟着外观走（没穿外观 = 精二）/ 填满 / 1.0× / 居中。 */
export const CARD_ART_DEFAULT = Object.freeze({ art: 'auto', skin: null, fit: 'fill', zoom: 1, ox: 0, oy: 0 });
export const ZOOM_MIN = 0.8;
export const ZOOM_MAX = 2;
/**
 * 座位卡整张卡的宽高比（232 : 560）—— 调整面板的正方形画布用它框出「这张卡」。
 * **注意**：卡里的立绘只占「顶条以下、名字条以上」那一块，整卡比立绘框长得多，取景一律按 cardParts() 算出来的
 * **立绘框**。
 */
export const CARD_ASPECT = 232 / 560;
/**
 * 整卡里三段的默认比例（都按**卡宽**算）。room.js 每次开面板都从真卡的 getBoundingClientRect 现量一份传进来；
 * 量不到才用这份兜底。
 */
export const CARD_PARTS = Object.freeze({ strip: 16.9 / 221.7, plate: 49.5 / 221.7, gap: 0 });
/** 版本（立绘来源）：auto = 穿外观就外观、否则精二。 */
export const ARTS = Object.freeze(['e1', 'e2', 'skin']);
/** 取景：full = 整幅缩进框里（不裁）、fill = 铺满框（边缘裁掉）。 */
export const FITS = Object.freeze(['full', 'fill']);

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const str = (v) => (typeof v === 'string' && v ? v : null);
const get = (o, k) => (isObj(o) && Object.hasOwn(o, k) ? o[k] : undefined);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : lo));
const round2 = (v) => Math.round(v * 100) / 100;

/** 去掉 `_1` / `_2` 的花名后缀（与 assets.js 的 baseCharId 同一条规则）。 */
const baseCharId = (id) => { const s = str(id); return s ? s.replace(/_(1|2)$/, '') : null; };

/** 我方外观记录里的立绘字段名（顶层 skins；chars[].skins 用 illustration 以外还可能有 portrait）。 */
const SKIN_ART = 'illustration';

/**
 * 这个干员能画的几套立绘（精一 / 精二 / 每一套带立绘的外观）。**纯函数**，取法按本仓清单：
 * `portraitE2` → `portrait` → `skins[skinId].illustration`。
 * @param {any} m 资产清单（data/assets.json）
 * @param {string} id charId（也接受 `_1` / `_2` 结尾的资产 id）
 * @param {{ skin?: string|null }} [opts] `skin` = 穿的那套外观 id
 * @returns {{ e1: string|null, e2: string|null, skin: string|null,
 *   skins: { id: string, name?: string, src: string }[] }}
 */
export function illustSources(m, id, opts) {
  const empty = { e1: null, e2: null, skin: null, skins: [] };
  const s = str(id);
  if (!s) return empty;
  const chars = get(m, 'chars');
  const key = get(chars, s) ? s : baseCharId(s);
  const rec = key ? get(chars, key) : null;
  if (!isObj(rec)) return empty;
  // 顶层 skins 是一个 { [skinId]: { charId, name, portrait, illustration } } 的平表（我方 271 套全有 illustration）
  const all = get(m, 'skins');
  const list = [];
  if (isObj(all)) {
    for (const [skinId, raw] of Object.entries(all)) {
      const sk = isObj(raw) ? raw : null;
      if (!sk || sk.charId !== key) continue;
      const src = str(sk.portrait) || str(sk[SKIN_ART]);
      if (src) list.push({ id: skinId, name: str(sk.name) || skinId, src });
    }
  }
  // 精二优先，没有再退回精一那张；两代都没有（极少数只有外观的干员）才退到外观自己的立绘。
  // 2026-11-07：`illust` / `illustE2`（高分辨率插图）优先于 portrait —— 有就用好的，没有退回 portrait。
  // 字段约定：illust = E1、illustE2 = E2（与 assets.json 现有 4 条一致）。
  const base = str(rec.illustE2) || str(rec.portraitE2) || str(rec.illust) || str(rec.portrait) || (list[0] ? list[0].src : null);
  const e2 = base;
  const e1 = str(rec.illust) || str(rec.portrait) || base;
  const wanted = opts && str(opts.skin) ? String(opts.skin) : null;
  const wornRec = wanted ? get(all, wanted) : null;
  const worn = isObj(wornRec) && (wornRec.charId == null || wornRec.charId === key)
    ? (str(wornRec.portrait) || str(wornRec[SKIN_ART]) || base)
    : null;
  return { e1, e2, skin: worn, skins: list };
}

/** 一条存下来的立绘设置（坏值一律回中立值）。ox/oy 是**框宽的百分比整数**（-100..100），可反复往返。 */
export function normalizeCardArt(v) {
  const o = isObj(v) ? v : {};
  // 缺字段 / 坏字段一律回中立值（clamp(undefined) 会落到下界，那是 0.8× / -100% 的坑）
  const num = (x, def) => (Number.isFinite(Number(x)) && x !== null && x !== '' ? Number(x) : def);
  return {
    art: ARTS.includes(o.art) ? o.art : 'auto',
    // art === 'skin' 时画**哪一套**皮肤（skinId）；空 = 跟着穿的那套 / 没有就退精二
    skin: typeof o.skin === 'string' && o.skin ? o.skin : null,
    fit: FITS.includes(o.fit) ? o.fit : 'fill',
    zoom: round2(clamp(num(o.zoom, CARD_ART_DEFAULT.zoom), ZOOM_MIN, ZOOM_MAX)),
    ox: Math.round(clamp(num(o.ox, 0), -100, 100)),
    oy: Math.round(clamp(num(o.oy, 0), -100, 100)),
  };
}

function readAll() {
  try {
    const raw = loadPref(CARD_ART_PREF, null);
    return isObj(raw) ? raw : {};
  } catch { return {}; }
}

/** 某个干员的立绘设置（没存过 = 中立值）。 */
export const cardArtOf = (charId) => normalizeCardArt(readAll()[charId]);

/**
 * 存某个干员的一处设置：{ art?, skin?, fit?, zoom?, ox?, oy? } 与现值合并后写回。
 * @param {string} charId @param {Partial<{art:'auto'|'e1'|'e2'|'skin', skin:string|null, fit:'full'|'fill', zoom:number, ox:number, oy:number}>} patch
 */
export function setCardArt(charId, patch) {
  if (!charId) return;
  const all = readAll();
  const next = { ...all, [charId]: normalizeCardArt({ ...cardArtOf(charId), ...patch }) };
  try { savePref(CARD_ART_PREF, next); } catch { /* 隐私模式：本次会话里仍然生效 */ }
  return next[charId];
}

/** 重置回中立值（跟外观走 / 1.0× / 居中）。 */
export const resetCardArt = (charId) => setCardArt(charId, CARD_ART_DEFAULT);

/**
 * 这个干员能画的几套立绘：精一 / 精二 / 每一套带立绘的皮肤。由调用方从清单解出来（illustSources），
 * 本模块只认这个形状，纯函数才好测。
 * @typedef {{ e1?: string|null, e2?: string|null, skin?: string|null,
 *   skins?: { id: string, name?: string, src: string }[] }} ArtSources
 * @param {ArtSources|null} sources
 * @param {'auto'|'e1'|'e2'|'skin'} art
 * @param {string|null} [skinId] art === 'skin' 时画哪一套（空 = 穿的那套，再没有就退精二）
 * @returns {{ art: 'e1'|'e2'|'skin', skinId: string|null, src: string|null, chain: string[] }}
 *   art 是**实际画出来的**那套（回落之后），skinId 是实际画出来的那套皮肤，chain 是依次尝试的地址。
 */
export function artPlan(sources, art, skinId = null) {
  const s = isObj(sources) ? sources : {};
  const e1 = str(s.e1);
  const e2 = str(s.e2);
  const worn = str(s.skin);
  const list = Array.isArray(s.skins) ? s.skins : [];
  const wantSkin = str(skinId) ? list.find((x) => x && x.id === skinId) : null;
  const skin = (wantSkin && str(wantSkin.src)) || worn;
  const want = ARTS.includes(art) ? art : 'auto';
  // auto：穿了带立绘的外观就画外观，否则精二
  const first = want === 'auto' ? (worn ? 'skin' : 'e2') : want;
  const order = first === 'e1' ? [e1, e2, skin] : first === 'skin' ? [skin, e2, e1] : [e2, e1, skin];
  const chain = order.filter((u) => typeof u === 'string' && u).filter((u, i, a) => a.indexOf(u) === i);
  const src = chain[0] || null;
  const shownSkin = src !== null && src === skin ? (wantSkin && wantSkin.src === src ? wantSkin.id : skinIdOf(list, src)) : null;
  return {
    art: src !== null && src === skin ? 'skin' : src !== null && src === e1 ? 'e1' : 'e2',
    skinId: src !== null && src === skin ? shownSkin : null,
    src,
    chain,
  };
}

/** 清单里哪个皮肤 id 的立绘是这个地址（都没有 = null）。 */
function skinIdOf(list, src) {
  for (const x of list) if (x && x.src === src && typeof x.id === 'string') return x.id;
  return null;
}

// ---- 取景：把内容框等比放进画面框 ---------------------------------------------------------------------------
// 透明留白先量掉（精一的 1024×1024 画布常带大片空白边），再把量出来的内容框等比缩到框内 —— 「完整显示」。
// 量法：64px 缩略图扫 alpha 包围盒，结果按 src 缓存在内存里（一页最多十几张，够快；不落盘，换图即失效）。

/** src -> {x,y,w,h}（0..1 的相对内容框）| null。 */
const BOX_CACHE = new Map();
/** 测试用：清掉量过的内容框。 */
export function clearArtBoxCache() { BOX_CACHE.clear(); }

/** 在 64px 缩略图上扫 alpha 包围盒（量不出来 = null，按整幅算）。 */
export function measureContentBox(img) {
  const nw = Number(img?.naturalWidth) || 0;
  const nh = Number(img?.naturalHeight) || 0;
  if (!(nw > 0) || !(nh > 0) || typeof document === 'undefined') return null;
  try {
    const W = 64;
    const H = Math.max(8, Math.min(256, Math.round((64 * nh) / nw)));
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const g = canvas.getContext('2d', { willReadFrequently: true });
    if (!g) return null;
    g.clearRect(0, 0, W, H);
    g.drawImage(img, 0, 0, W, H);
    const d = g.getImageData(0, 0, W, H).data;
    let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
    for (let y = 0; y < H; y += 1) {
      for (let x = 0; x < W; x += 1) {
        if (d[(y * W + x) * 4 + 3] > 16) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
    }
    if (x1 < x0 || y1 < y0) return null;
    return { x: x0 / W, y: y0 / H, w: (x1 - x0 + 1) / W, h: (y1 - y0 + 1) / H };
  } catch { return null; }
}

/** 内容框换成自然像素（量不出来 = 整幅）。 */
export function contentBox(nat, box) {
  const w = Number(nat?.w) || 0;
  const h = Number(nat?.h) || 0;
  if (!(w > 0) || !(h > 0)) return null;
  const b = box && ['x', 'y', 'w', 'h'].every((k) => Number.isFinite(box[k]))
    ? box
    : { x: 0, y: 0, w: 1, h: 1 };
  const bw = Math.min(1, Math.max(0.01, b.w));
  const bh = Math.min(1, Math.max(0.01, b.h));
  const bx = Math.min(Math.max(0, b.x), 1 - bw);
  const by = Math.min(Math.max(0, b.y), 1 - bh);
  return { x: bx * w, y: by * h, w: bw * w, h: bh * h };
}

/**
 * 一张图在画面框里的几何：内容框等比缩进框内（缩放/平移照旧），返回 img 的 px 尺寸与位置。
 * 框或图还没量出来 = null（调用方退回 object-fit: contain）。
 * @param {{ nat?: {w:number,h:number}|null, box?: any, frame?: {w:number,h:number}|null,
 *   fit?: 'full'|'fill', zoom?: number, ox?: number, oy?: number }} p
 *   fit：'full' = 整幅缩进框里（min，1× 时四边留白）、'fill' = 铺满框（max，1× 时裁掉超出部分）
 * @returns {{ w:number, h:number, left:number, top:number, scale:number }|null}
 */
export function artFit({ nat = null, box = null, frame = null, fit = 'full', zoom = CARD_ART_DEFAULT.zoom, ox = 0, oy = 0 } = {}) {
  const c = contentBox(nat, box);
  const fw = Number(frame?.w) || 0;
  const fh = Number(frame?.h) || 0;
  if (!c || !(fw > 0) || !(fh > 0)) return null;
  const z = clamp(Number(zoom), ZOOM_MIN, ZOOM_MAX);
  const scales = [fw / c.w, fh / c.h];
  const scale = (fit === 'fill' ? Math.max(...scales) : Math.min(...scales)) * z;
  return {
    w: nat.w * scale,
    h: nat.h * scale,
    left: (fw - c.w * scale) / 2 - c.x * scale + (clamp(Number(ox), -100, 100) / 100) * fw,
    top: (fh - c.h * scale) / 2 - c.y * scale + (clamp(Number(oy), -100, 100) / 100) * fh,
    scale,
  };
}

/** artFit 的结果 -> 内联 style（图按 px 摆，object-fit 不再参与裁剪）。 */
export function artBoxStyle(fit) {
  if (!fit) return 'width: 100%; height: 100%; left: 0; top: 0; object-fit: contain;';
  const r = (n) => Math.round(n * 100) / 100;
  return [`width: ${r(fit.w)}px; height: ${r(fit.h)}px; left: ${r(fit.left)}px; top: ${r(fit.top)}px; object-fit: fill;`].join('');
}

// ---- 画面框的量尺 -------------------------------------------------------------------------------------------

/**
 * 一张真卡的尺寸比例（room.js 从 `.rseat.is-me` 现量）：`aspect` = 卡宽/卡高，`strip` / `plate` / `gap` = 顶条 /
 * 名字条 / 两者缝隙的高度，都以**卡宽**为 1。量不到时（测试 / 面板单独画）回 CARD_PARTS + CARD_ASPECT。
 * @param {{ aspect?: number, strip?: number, plate?: number, gap?: number }|null} m
 */
export function normalizeMetrics(m) {
  const o = isObj(m) ? m : {};
  const num = (v, d) => (Number.isFinite(Number(v)) && v !== null && v !== '' ? Number(v) : d);
  return {
    aspect: clamp(num(o.aspect, CARD_ASPECT), 0.2, 1.5),
    strip: clamp(num(o.strip, CARD_PARTS.strip), 0, 0.4),
    plate: clamp(num(o.plate, CARD_PARTS.plate), 0, 0.6),
    gap: clamp(num(o.gap, CARD_PARTS.gap), 0, 0.2),
  };
}

/**
 * 调整面板里的「这张卡」：画布是**正方形**，正中按真卡的宽高比框出一条整卡矩形 —— 顶条、立绘、名字条都在里面。
 * @param {{ w:number, h:number }|null} size 正方形的画布尺寸
 * @param {{ aspect?: number, strip?: number, plate?: number, gap?: number }|null} [metrics] 真卡比例
 * @returns {{ w:number, h:number, left:number, top:number }} 整卡矩形（正方形画布坐标）
 */
export function windowBox(size, metrics = null) {
  const m = normalizeMetrics(metrics);
  const w = Number(size && size.w) || 0;
  const h = Number(size && size.h) || 0;
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0, left: 0, top: 0 };
  const side = Math.min(w, h);
  const cardW = side * m.aspect;
  return { w: cardW, h: side, left: (w - cardW) / 2, top: (h - side) / 2 };
}

/**
 * 整卡矩形里三段的位置：顶条、**立绘框**、名字条（缝隙算在立绘与名字条之间）。
 * 立绘的取景/拖拽全部按 `art` 这一块算 —— 它不是整卡，卡上的立绘也不占整卡。
 * @param {{ w:number, h:number, left?:number, top?:number }} card windowBox 的结果
 * @param {{ aspect?: number, strip?: number, plate?: number, gap?: number }|null} [metrics]
 */
export function cardParts(card, metrics = null) {
  const m = normalizeMetrics(metrics);
  const w = Number(card && card.w) || 0;
  const h = Number(card && card.h) || 0;
  const left = Number(card && card.left) || 0;
  const top = Number(card && card.top) || 0;
  if (!(w > 0) || !(h > 0)) {
    return { strip: { h: 0 }, gap: { h: 0 }, art: { w: 0, h: 0, left: 0, top: 0 }, plate: { h: 0, left: 0, top: 0 } };
  }
  const strip = m.strip * w;
  const plate = m.plate * w;
  const gap = m.gap * w;
  const artH = Math.max(1, h - strip - plate - gap);
  return {
    strip: { h: strip },
    gap: { h: gap },
    art: { w, h: artH, left, top: top + strip },
    plate: { h: plate, left, top: top + h - plate },
  };
}

/** 画面框的像素尺寸（ResizeObserver；不支持就退到 window resize）。 */
function useFrameSize(frameRef) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = frameRef && frameRef.current;
    if (!el || typeof el.getBoundingClientRect !== 'function') return undefined;
    const read = () => {
      const r = el.getBoundingClientRect();
      setSize((p) => (Math.abs(p.w - r.width) < 0.5 && Math.abs(p.h - r.height) < 0.5 ? p : { w: r.width, h: r.height }));
    };
    read();
    if (typeof ResizeObserver === 'function') {
      const ro = new ResizeObserver(read);
      ro.observe(el);
      return () => ro.disconnect();
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    return undefined;
  }, [frameRef]);
  return size;
}

/**
 * 画面框里的两层图：底下是同一张图的**虚化铺满**（框比图长很多时，空出来的地方不至于是一块纯色），
 * 上面是按 artFit 摆好、完整显示的那张。onLoad 时量内容框。
 */
function ArtPicture({ src, value, frameRef, className = '', dataArt = null, onError = null, editor = false,
  metrics = null, playerName = null, seatNo = 1 }) {
  const v = normalizeCardArt(value);
  const size = useFrameSize(frameRef);
  const imgRef = useRef(null);
  const [nat, setNat] = useState(null);
  const [box, setBox] = useState(null);
  // 调整面板：正方形画布 + 正中按真卡比例框出的**整卡**（顶条 / 立绘 / 名字条）；座位卡：整个画面框就是立绘框
  const win = editor ? windowBox(size, metrics) : { w: size.w, h: size.h, left: 0, top: 0 };
  const parts = editor ? cardParts(win, metrics) : null;
  // 取景只按立绘那一块（不是整卡）：卡上的立绘本来就不占名字条
  const frame = parts ? { w: parts.art.w, h: parts.art.h } : { w: win.w, h: win.h };
  const placed = artFit({ nat, box, frame, fit: v.fit, zoom: v.zoom, ox: v.ox, oy: v.oy });
  /** 记下自然尺寸 + 内容框（同一张图只量一次）。 */
  const adopt = (img) => {
    const w = Number(img.naturalWidth) || 0;
    const h = Number(img.naturalHeight) || 0;
    if (!(w > 0) || !(h > 0)) return;
    setNat({ w, h });
    if (BOX_CACHE.has(src)) { setBox(BOX_CACHE.get(src)); return; }
    const measured = measureContentBox(img);
    BOX_CACHE.set(src, measured);
    setBox(measured);
  };
  useEffect(() => { setNat(null); setBox(null); }, [src]);
  // **缓存里的图**：onLoad 可能在 preact 挂上监听之前就烧掉了（第二次开面板必然如此），
  // 那样 nat 一直是 null、画面停在 object-fit: contain 的退路里，拖动看起来「没反应」—— 挂载后补量一次。
  useEffect(() => {
    const img = imgRef.current;
    if (!img || !img.complete || !img.naturalWidth) return;
    if (nat && nat.w === img.naturalWidth && nat.h === img.naturalHeight) return;
    adopt(img);
  });
  const onLoad = (e) => adopt(e && e.currentTarget);
  const origin = parts ? parts.art : win;
  const style = placed
    ? artBoxStyle({ ...placed, left: placed.left + origin.left, top: placed.top + origin.top })
    : 'width: 100%; height: 100%; left: 0; top: 0; object-fit: contain;';
  const initial = [...String(playerName || '博')][0] || '博';
  return html`<img class="cardart__bg" src=${src} alt="" aria-hidden="true" draggable=${false} />
    <img ref=${imgRef} class=${`cardart__img ${className}`} src=${src} alt="" draggable=${false} data-art=${dataArt}
      style=${style} onLoad=${onLoad} onError=${onError} />
    ${editor && win.w > 0 ? html`<span class="cardart__win" aria-hidden="true"
        style=${`left: ${win.left}px; top: ${win.top}px; width: ${win.w}px; height: ${win.h}px;`}>
        <span class="cardart__stripbar" style=${`height: ${parts.strip.h}px;`} />
        <span class="cardart__plate" style=${`top: calc(100% - ${parts.plate.h}px); height: ${parts.plate.h}px;`}>
          <span class="cardart__pav">${initial}</span>
          <span class="cardart__prow"><b class="cardart__pname">${playerName || ''}</b>
            <small class="cardart__pno num">P${seatNo}</small></span>
        </span>
      </span>` : null}`;
}

/**
 * 立绘调整的**纯视图**（测试直接当函数画；拖拽/滚轮/双指的监听由 CardArt 挂）。
 * 版本三选一：精一 / 精二 / 皮肤（穿了带立绘的外观才有「皮肤」这一项）。
 * @param {{ charId: string, sources?: ArtSources|null, operator?: string|null, value?: any,
 *   onVersion?: (key: 'e1'|'e2'|string) => void, onPickOperator?: (() => void)|null, onFit?: (m: 'full'|'fill') => void,
 *   onZoom?: (z: number) => void, onReset?: () => void, onBroken?: () => void, frameRef?: any,
 *   metrics?: { aspect?: number, strip?: number, plate?: number, gap?: number }|null,
 *   playerName?: string|null, seatNo?: number }} props
 */
export function CardArtView({ charId, sources = null, operator = null, value = CARD_ART_DEFAULT,
  onVersion = () => {}, onPickOperator = null, onFit = () => {}, onZoom = () => {}, onReset = () => {}, onBroken = () => {},
  frameRef = null, metrics = null, playerName = null, seatNo = 1 }) {
  ensureCardArtCss();
  const v = normalizeCardArt(value);
  const plan = artPlan(sources, v.art, v.skin);
  const skins = Array.isArray(sources?.skins) ? sources.skins : [];
  // 每颗按钮的 key：'e1' / 'e2' / 'skin:<skinId>'（多套皮肤各占一颗，用名字分开）
  const options = [['e1', t('精一')], ['e2', t('精二')],
    ...skins.map((x) => [`skin:${x.id}`, x.name || t('皮肤')])];
  const activeKey = plan.art === 'skin' && plan.skinId ? `skin:${plan.skinId}` : plan.art;
  return html`<section class="cardart" data-testid="card-art" data-art=${plan.art} data-char=${charId || null}>
    <header class="cardart__head">
      <span class="cardart__title">${t('立绘调整')}</span>
      <button type="button" class="cardart__reset" data-testid="card-art-reset" onClick=${onReset}>${t('重置')}</button>
    </header>
    <div class="cardart__row">
      <span class="cardart__k">${t('干员')}</span>
      <b class="cardart__opname">${operator || charId || ''}</b>
      ${onPickOperator ? html`<button type="button" class="cardart__pick" data-testid="card-art-pick" onClick=${onPickOperator}>${t('更换立绘')}</button>` : null}
    </div>
    <div class="cardart__row">
      <span class="cardart__k">${t('立绘')}</span>
      <div class="cardart__ver" role="group" aria-label=${t('立绘')}>
        ${options.map(([key, label]) => html`<button type="button" key=${key}
            class=${'cardart__vbtn' + (activeKey === key ? ' is-on' : '')} data-art=${key.startsWith('skin:') ? 'skin' : key}
            data-skin=${key.startsWith('skin:') ? key.slice(5) : null}
            aria-pressed=${activeKey === key ? 'true' : 'false'} onClick=${() => onVersion(key)}>${label}</button>`)}
      </div>
    </div>
    <div class="cardart__row">
      <div class="cardart__fit">
        ${[['full', t('完整')], ['fill', t('填满')]].map(([id, label]) => html`<button type="button" key=${id}
            class=${'cardart__vbtn' + (v.fit === id ? ' is-on' : '')} data-fit=${id}
            aria-pressed=${v.fit === id ? 'true' : 'false'} onClick=${() => onFit(id)}>${label}</button>`)}
      </div>
    </div>
    <div class="cardart__frame" ref=${frameRef} data-testid="card-art-frame" tabindex="0"
        role="application" aria-label=${t('拖拽调整位置')} style="touch-action: none">
      ${plan.src
        ? html`<${ArtPicture} src=${plan.src} value=${v} frameRef=${frameRef} dataArt=${plan.art} editor=${true}
            metrics=${metrics} playerName=${playerName} seatNo=${seatNo} onError=${onBroken} />`
        : html`<span class="cardart__glyph">${[...(charId || '?')][0]}</span>`}
      <span class="cardart__hint">${t('拖拽调整位置')}</span>
    </div>
    <div class="cardart__zoom">
      <span class="cardart__zlabel">${t('缩放')}</span>
      <input type="range" class="cardart__range" data-testid="card-art-zoom" min=${ZOOM_MIN} max=${ZOOM_MAX} step="0.1"
        value=${v.zoom} aria-label=${t('缩放')}
        onInput=${(e) => onZoom(Number(e.currentTarget.value))} />
      <b class="cardart__znum num">${v.zoom.toFixed(1)}×</b>
    </div>
    <p class="cardart__pos">${t('位置')} <b class="num">${v.ox}</b> / <b class="num">${v.oy}</b></p>
  </section>`;
}

/**
 * 带交互的立绘调整：框内拖拽平移、触屏双指缩放、桌面滚轮缩放、键盘 ←/→ 调缩放。
 * 两处输入的数学都在这里（纯数值），normalizeCardArt 负责夹紧 —— 测试直接调 panTo / pinchTo。
 */
export function panTo(from, dx, dy, box) {
  const w = Math.max(1, Number(box?.w) || 1);
  const h = Math.max(1, Number(box?.h) || 1);
  const base = normalizeCardArt(from);
  return normalizeCardArt({ ...base, ox: base.ox + (dx / w) * 100, oy: base.oy + (dy / h) * 100 });
}

/** 双指缩放：d0 → d1 的比例乘在起始缩放上（夹在 0.8–2.0）。 */
export function pinchTo(from, d0, d1) {
  const base = normalizeCardArt(from);
  const ratio = d0 > 0 ? d1 / d0 : 1;
  return normalizeCardArt({ ...base, zoom: base.zoom * ratio });
}

/**
 * @param {{ charId: string, sources?: ArtSources|null, operator?: string|null, onPickOperator?: (() => void)|null,
 *   metrics?: { aspect?: number, strip?: number, plate?: number, gap?: number }|null,
 *   playerName?: string|null, seatNo?: number }} props
 */
export function CardArt({ charId, sources = null, operator = null, onPickOperator = null, metrics = null,
  playerName = null, seatNo = 1 }) {
  const [value, setValue] = useState(() => cardArtOf(charId));
  const frameRef = useRef(null);
  const latest = useRef(value);
  latest.current = value;
  const metricsRef = useRef(metrics);
  metricsRef.current = metrics;
  const gesture = useRef(null);
  const apply = (patch) => setValue((prev) => { const next = normalizeCardArt({ ...prev, ...patch }); setCardArt(charId, next); return next; });

  useEffect(() => {
    const el = frameRef.current;
    if (!el || typeof el.addEventListener !== 'function') return undefined;
    const pts = new Map();
    // 拖拽的百分比以**立绘框**（整卡里顶条与名字条之间那一块）为准，和 artFit 同一把尺子 —— 手移多少像素，画面就移多少
    const boxOf = () => {
      const r = el.getBoundingClientRect?.();
      const card = windowBox({ w: Math.max(1, r?.width || 300), h: Math.max(1, r?.height || 300) }, metricsRef.current);
      const art = cardParts(card, metricsRef.current).art;
      return { w: Math.max(1, art.w), h: Math.max(1, art.h) };
    };
    const spread = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y) || 1; };
    const onDown = (e) => {
      pts.set(e.pointerId ?? 0, { x: e.clientX ?? 0, y: e.clientY ?? 0 });
      if (pts.size === 1) {
        gesture.current = { mode: 'pan', x: e.clientX ?? 0, y: e.clientY ?? 0, box: boxOf(), from: latest.current };
      } else if (pts.size === 2) {
        gesture.current = { mode: 'pinch', d0: spread(), from: latest.current };
      }
      try { el.setPointerCapture?.(e.pointerId); } catch { /* 合成事件 / 指针已抬起：捕获不到也不影响拖动 */ }
    };
    const onMove = (e) => {
      const id = e.pointerId ?? 0;
      if (!pts.has(id) || !gesture.current) return;
      pts.set(id, { x: e.clientX ?? 0, y: e.clientY ?? 0 });
      if (gesture.current.mode === 'pan' && pts.size === 1) {
        const g = gesture.current;
        const next = panTo(g.from, (e.clientX ?? 0) - g.x, (e.clientY ?? 0) - g.y, g.box);
        setValue(next);
        setCardArt(charId, next);
      } else if (gesture.current.mode === 'pinch' && pts.size === 2) {
        const next = pinchTo(gesture.current.from, gesture.current.d0, spread());
        setValue(next);
        setCardArt(charId, next);
      }
      if (typeof e.preventDefault === 'function') e.preventDefault();
    };
    const onUp = (e) => {
      const id = e.pointerId ?? 0;
      pts.delete(id);
      if (pts.size === 0) gesture.current = null;
      else if (pts.size === 1) {
        const [only] = [...pts.entries()];
        gesture.current = { mode: 'pan', x: only[1].x, y: only[1].y, box: boxOf(), from: latest.current };
      }
    };
    const onWheel = (e) => {
      // 只在框内拦滚轮（passive:false 才拦得住页面滚动），滚轮一格 ±0.1×
      if (typeof e.preventDefault === 'function') e.preventDefault();
      apply({ zoom: latest.current.zoom - Math.sign(e.deltaY) * 0.1 });
    };
    const onKey = (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      if (typeof e.preventDefault === 'function') e.preventDefault();
      apply({ zoom: latest.current.zoom + (e.key === 'ArrowRight' ? 0.1 : -0.1) });
    };
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('keydown', onKey);
    };
  }, [charId]);

  // 面板给的 key：'e1' / 'e2' / 'skin:<skinId>'
  const pickArt = (key) => {
    if (key === 'e1' || key === 'e2') { apply({ art: key, skin: null }); return; }
    if (typeof key === 'string' && key.startsWith('skin:')) apply({ art: 'skin', skin: key.slice(5) });
  };
  return html`<${CardArtView} charId=${charId} sources=${sources} operator=${operator}
    onPickOperator=${onPickOperator} value=${value} frameRef=${frameRef}
    metrics=${metrics} playerName=${playerName} seatNo=${seatNo}
    onVersion=${pickArt}
    onFit=${(m) => apply({ fit: m })}
    onZoom=${(z) => apply({ zoom: z })}
    onBroken=${() => { if (latest.current.art === 'e1') apply({ art: 'e2' }); }}
    onReset=${() => { setValue(resetCardArt(charId) || CARD_ART_DEFAULT); }} />`;
}

/**
 * 名片上的立绘（房间座位卡用人像区）：按存下来的设置画，完整显示 + 虚化铺满。
 * 依次尝试 artPlan 给出的地址（精一缺 → 精二 → 皮肤），全部打不开才回调 onError，交给调用方退回头像框。
 * @param {{ charId: string, sources?: ArtSources|null, class?: string, onError?: (() => void)|null }} props
 */
export function CardArtImage({ charId, sources = null, class: cls = '', onError = null }) {
  ensureCardArtCss();
  const [failed, setFailed] = useState([]);
  const v = cardArtOf(charId);
  const plan = artPlan(sources, v.art, v.skin);
  const src = plan.chain.find((u) => !failed.includes(u)) || null;
  const wrapRef = useRef(null);
  if (!src) return null;
  const broken = () => {
    const rest = plan.chain.filter((u) => u !== src && !failed.includes(u));
    setFailed((f) => (f.includes(src) ? f : [...f, src]));
    if (!rest.length && typeof onError === 'function') onError();
  };
  return html`<span class="cardart__stillwrap" ref=${wrapRef}>
    <${ArtPicture} src=${src} value=${v} frameRef=${wrapRef} className=${cls} dataArt=${plan.art} onError=${broken} />
  </span>`;
}
