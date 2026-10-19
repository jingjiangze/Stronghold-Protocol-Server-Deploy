// 玩法说明 (How to play): viewer for the 19 official tutorial pages of the mode: guide/autochess_{home 1–9, shop 1–6,
// handbook 1–4} from the local-client art (DESIGN §13: data/local-assets.json) when it is there, else the copies setup
// downloads from the public mirror (data/assets.json → ui['guide/<key>']; GitHub issue #42) — data.js artUrls; a page
// whose picture fails to load tries its next URL. The pages are stored squashed to 1024² (both copies) and are
// displayed stretched back to 16:9. Three chapters (基础规则 / 调度手册 / 进阶图鉴), ‹ › buttons, ←/→ (A/D) keys, page
// dots, thumbnails; Esc or the backdrop closes. Only the next page is preloaded (a page is 0.9–1.5 MB; the one before
// has usually just been seen, so preloading it too doubled the download — host bandwidth, layer 0).
// With no page listed the viewer shows the official loading-screen tips (config.tips) instead, and so does a page none
// of whose copies loads (`guideStage`: data/assets.json lists the downloaded pages but the files are not on disk — a
// `git pull` and restart without setup, an older asset folder, a failed download the shrink guard kept); the chapter
// tabs, the page dots and the keys still reach the other pages.
//
// Global & imperative so every screen can open it: `openGuide(page?)`; <GuideHost/> is mounted once by main.js
// (and by the dev mock harness); <GuideButton/> is the standard trigger (title, lobby, room, in-match menu).

import { useEffect, useMemo, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, MicroLabel, Button, Spinner } from './components.js';
import { createStore, useStore, store } from '../store.js';
import { data, useData, artUrls, nextArtUrl } from '../data.js';
import { t, N_ } from '../../../shared/i18n.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');

/**
 * 协同共竞的局内玩法说明（业主 2026-10-17：仅协同共竞替换为当前玩法说明）。
 *
 * 官方那 19 页图讲的是标准模式；协同共竞多出来的是一整套**团队经济**（借钱、协同资金、应急仓储/后勤调度、
 * 告急救济、救援、赏金加时），以及「一个人升级 = 全队升级」这类与单人对局不同的规则，看官方图会得出相反结论，
 * 所以这一节用文本页替换首章，进房后打开玩法说明先看到它。
 */
export const COOP_GUIDE_BLOCKS = [
  { h: '协同共竞是什么', items: [
    '与同伴**共用一套经济**的联合模拟：资金、后勤等级、救济次数都是全队共享，一个人花钱全队受益。',
    '对局长达 14 回合（机变阶段在第 3 / 6 / 9 回合），经济、盟约、敌人与常规模拟完全一致 —— 多出来的只有团队经济。',
    '商店最高 6 级；货架随等级从 3 个干员扩展到 5 个，装备格恒定 1 个。',
  ] },
  { h: '借钱', items: [
    '休整期向队友请求资金：**每次最多 1**，每人每回合最多 4 次请求，全队每回合合计上限 8。',
    '请求 30 秒内有效；对方同意即到账，可以拒绝，被拒之后能换个人再借。',
    '**借了要还**：本金从你下一回合的收入里扣，玩家之间 0 利息。',
    '如果你在被扣款前被淘汰，这笔债作废，队友按骰子分掉本该还的钱。',
    '帮队友拦下漏过来的敌人（联防击杀）会让放贷者拿到「兜底利息」：费率 = 击杀数 / 全场敌人总数，最高 100%。',
  ] },
  { h: '协同资金（团队金库）', items: [
    '来源一：每个人休整结束时**没花完**的钱，最多 2 / 人转入，其余清零（应急仓储能提高保留额）。',
    '来源二：**联防没漏**（有人漏进来、联防把敌人全挡住）+1；**全员都防住**（自家阵地和联防都没有穿透）+2。每回合最多 2，两档不叠加。',
    '用途有三个：后勤项目、告急救济、赏金加时。它不能直接花在自己身上。',
  ] },
  { h: '后勤项目（应急仓储 / 后勤调度）', items: [
    '**点一下就升级**：资金够时按钮会亮起，谁都可以点，一个人点完全队同时升级，不需要其他人确认。',
    '每级固定 **4 协同资金**，共 4 级。',
    '应急仓储：休整结束时能保留到下一回合的资金上限随等级提高。',
    '后勤调度：全队每回合可调拨的资金上限依次 +4 / +8 / +12 / +16。',
    '升级结果会广播给全队，并写明这一级的效果。',
  ] },
  { h: '告急救济', items: [
    '当你是全队生命值最低、且生命值 ≤ 10 时，可以从协同资金领 1 资金。',
    '每人每回合最多 2 次，全队每回合合计最多 4 次。',
  ] },
  { h: '赏金加时（花钱买时间）', items: [
    '休整期倒计时还在走时，可以从协同资金买一段准备时间：每次 **+20 秒**。',
    '价格按本回合的购买次数递增：**4 / 6 / 8**，一回合最多买 3 次（共 +60 秒）。',
    '买到的时间**续在当前倒计时上**，不会重置成满格；谁都可以买，全队同时受益。',
    '没有准备倒计时的回合（单人对局，或数据里没给准备时限）不卖。',
  ] },
  { h: '救援', items: [
    '结算窗口内可以发起救援：其余存活队友同意后，按人头从协同资金扣款（5 / 人，逐级递增）把你拉回场上。',
  ] },
  { h: '外观（皮肤）', items: [
    '皮肤只改头像、立绘与战斗模型，**不改属性、技能或伤害**。',
    '选择按干员保存并同步给全队 —— 队友与旁观看到的都是**你**选的那套，不是他们自己的偏好。',
    '素材缺失或加载失败时自动退回默认外观，不会变成空白模型。',
  ] },
  { h: '甄选干员', items: [
    '甄选名额仍是每阶两个：选完之后，这两名干员会出现在干员调配列表末尾的「甄选」分组里，可继续调整。',
  ] },
  { h: '战场轮换', items: [
    '**协同共竞每回合都会换一张战场**（从本难度的战场池里抽；seed 固定，所以重放一致）。',
    '其他玩法不每回合换图：开局定一张，之后只在 **boss 关**才换。',
  ] },
  { h: '准备与结算', items: [
    '没花完的钱点「准备就绪」会提示：其中多少会转入协同资金、多少会清零。',
    '本局的外观选择在简报阶段结束后锁定，之后的修改留到下一局。',
  ] },
];

/** Page catalogue in reading order (titles transcribed from the pages). */
export const GUIDE_CHAPTERS = [
  { id: 'home', name: N_('基础规则'), micro: 'BASICS', pages: [
    ['autochess_home_1', N_('卫戍协议已运行')], ['autochess_home_2', N_('攻防战')], ['autochess_home_3', N_('休整期 · 区域')],
    ['autochess_home_4', N_('休整期 · 资金与调度')], ['autochess_home_5', N_('机变阶段')], ['autochess_home_6', N_('限时战斗')],
    ['autochess_home_7', N_('作战期')], ['autochess_home_8', N_('协同战斗')], ['autochess_home_9', N_('盟约')],
  ] },
  { id: 'shop', name: N_('调度手册'), micro: 'HANDBOOK', pages: [
    ['autochess_shop_1', N_('调度手册')], ['autochess_shop_2', N_('干员晋级')], ['autochess_shop_3', N_('加成情况')],
    ['autochess_shop_4', N_('卫戍能力')], ['autochess_shop_5', N_('盟约')], ['autochess_shop_6', N_('助战及自选编队')],
  ] },
  { id: 'handbook', name: N_('进阶图鉴'), micro: 'ADVANCED', pages: [
    ['autochess_handbook_1', N_('敌人类型')], ['autochess_handbook_2', N_('盟约激活与叠加')], ['autochess_handbook_3', N_('追加盟约')],
    ['autochess_handbook_4', N_('策略与轮选')],
  ] },
];

/**
 * Flat page list with URLs (only pages the local-art manifest or the asset manifest lists): `urls` best first (the
 * local file, then the mirror copy), `url` the first of them.
 * @returns {Array<{ key: string, title: string, chapter: number, url: string, urls: string[] }>}
 */
export function guidePages() {
  const out = [];
  // 协同共竞：**只**给这份当前玩法说明（user 2026-10-17：去掉原有的官方玩法说明）。官方那 19 页图讲的是
  // 标准模式，与团队经济/即时升级等规则冲突，留在列表里会被当成现行规则。
  if (coopGuideActive()) {
    out.push({ key: 'coop-rules', title: '协同共竞 · 当前玩法', chapter: 0, url: '', urls: [], text: true, chapterName: '协同共竞' });
    return out;
  }
  GUIDE_CHAPTERS.forEach((ch, ci) => {
    for (const [key, title] of ch.pages) {
      const urls = artUrls('guide', key);
      if (urls.length) out.push({ key, title, chapter: ci, url: urls[0], urls });
    }
  });
  return out;
}

/**
 * What the viewer's stage shows for a page: `{ kind: 'image', src }` — the first of its URLs that has not failed to
 * load (the local file, then the downloaded copy) — or `{ kind: 'tips' }`, the official tips text, when none is left
 * (no page, or every copy failed to load).
 * @param {{ urls?: string[] }|null|undefined} page an entry of guidePages()
 * @param {Set<string>} [failed] URLs whose image fired an error
 * @returns {{ kind: 'image', src: string } | { kind: 'tips' }}
 */
export function guideStage(page, failed) {
  if (page && page.text) return { kind: 'text', blocks: COOP_GUIDE_BLOCKS };
  const src = page ? nextArtUrl(page.urls, failed) : null;
  return src ? { kind: 'image', src } : { kind: 'tips' };
}

/** 当前是否在协同共竞房间里（决定玩法说明首章换成文本页）。 */
export function coopGuideActive() {
  try {
    const s = store.get();
    return s?.room?.variant === 'xie';
  } catch { return false; }
}

/**
 * The one page the viewer preloads while page `i` is shown: the next one (wrapping around), its first URL that has not
 * failed — null without pages. The previous page is not preloaded (see the header).
 * @param {Array<{ urls?: string[] }>} pages guidePages()
 * @param {number} i
 * @param {Set<string>} [failed]
 */
export function guidePreloadUrl(pages, i, failed) {
  const n = Array.isArray(pages) ? pages.length : 0;
  if (!n || n < 2) return null;
  return nextArtUrl(pages[(((i + 1) % n) + n) % n]?.urls, failed);
}

/** Open/closed + current page. */
export const guideStore = createStore({ open: false, page: 0 });

/** Open the viewer (optionally at a page index). */
export function openGuide(page = 0) {
  data.load('local');
  data.load('assets');
  data.load('config');
  guideStore.set({ open: true, page: Math.max(0, page | 0) });
}
export const closeGuide = () => guideStore.set({ open: false });

/** Standard 玩法说明 trigger button. */
export function GuideButton({ class: cls, size = 'sm', variant = 'ghost', label = t('玩法说明'), square = false }) {
  return html`<${Button} variant=${variant} size=${size} icon="book" square=${square} class=${cx('guide-btn', cls)}
    onClick=${() => openGuide(0)} title=${t('玩法说明')} aria-label=${t('玩法说明')}>${square ? null : label}<//>`;
}

function preload(url) {
  if (!url || typeof Image === 'undefined') return;
  const img = new Image();
  img.decoding = 'async';
  img.crossOrigin = 'anonymous';
  img.src = url;
}

/** Fallback body when no tutorial page can be shown: the official tips as a numbered list. */
function TipsFallback() {
  const tips = (Array.isArray(data.get('config')?.tips) ? data.get('config').tips : []).map((t) => t?.tip).filter(Boolean);
  return html`<div class="guide__tips">
    <${MicroLabel} tone="mint">${t('TIPS // 模拟要点')}</${MicroLabel}>
    <ol>${tips.map((t, i) => html`<li key=${i}>${t}</li>`)}</ol>
    ${!tips.length ? html`<p class="t-lo">${t('暂无说明内容')}</p>` : null}
  </div>`;
}

/** The viewer (mounted once near the root). */
export function GuideHost() {
  const { open, page } = useStore((s) => s, Object.is, guideStore);
  const ready = useData('local', 'assets', 'config');
  // 进出协同共竞房间会切换首章（官方图 ↔ 团队经济文本页），所以 memo 也要跟着房间形态重算
  const roomVariant = useStore((v) => v.room?.variant || null);
  const pages = useMemo(() => (ready ? guidePages() : []), [ready, roomVariant]);
  const [loaded, setLoaded] = useState(() => new Set());
  const [failed, setFailed] = useState(() => new Set());
  const boxRef = useRef(null);
  const n = pages.length;
  const i = n ? Math.min(Math.max(0, page), n - 1) : 0;
  const cur = pages[i] || null;
  const go = (k) => { if (n) guideStore.set({ open: true, page: ((k % n) + n) % n }); };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key;
      let handled = true;
      if (k === 'Escape') closeGuide();
      else if (k === 'ArrowRight' || k === 'd' || k === 'D' || k === 'PageDown') go(guideStore.get().page + 1);
      else if (k === 'ArrowLeft' || k === 'a' || k === 'A' || k === 'PageUp') go(guideStore.get().page - 1);
      else if (k === 'Home') go(0);
      else if (k === 'End') go(n - 1);
      else handled = (!!k && k.length === 1) || k === ' '; // swallow game shortcuts (R/F/D/Space) while open
      if (handled) { e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation(); }
    };
    window.addEventListener('keydown', onKey, true);
    const t = setTimeout(() => boxRef.current?.focus?.(), 30);
    return () => { window.removeEventListener('keydown', onKey, true); clearTimeout(t); };
  }, [open, n]);

  useEffect(() => {
    if (!open || !n) return;
    preload(guidePreloadUrl(pages, i, failed));
  }, [open, i, n, failed]);

  if (!open) return null;
  const chapter = cur ? GUIDE_CHAPTERS[cur.chapter] : null;
  const firstOf = (ci) => pages.findIndex((p) => p.chapter === ci);
  const stage = guideStage(cur, failed); // the next copy when one fails to load; the tips when none is left
  const src = stage.kind === 'image' ? stage.src : null;
  const isLoaded = !!src && loaded.has(src);
  return html`<div class="guide" role="presentation" onMouseDown=${(e) => { if (e.target === e.currentTarget) closeGuide(); }}>
    <div class="guide__box brackets" role="dialog" aria-modal="true" aria-label=${t('玩法说明')} tabindex="-1" ref=${boxRef}>
      <header class="guide__head">
        <div class="guide__titles">
          <${MicroLabel} tone="mint">HOW TO PLAY // STRONGHOLD PROTOCOL</${MicroLabel}>
          <h2 class="guide__title">${t('玩法说明')}</h2>
        </div>
        ${n ? html`<nav class="guide__chapters" aria-label=${t('章节')}>
          ${GUIDE_CHAPTERS.map((ch, ci) => {
            const at = firstOf(ci);
            if (at < 0) return null;
            return html`<button key=${ch.id} type="button" class=${cx('guide__chapter', cur?.chapter === ci && 'is-on')} onClick=${() => go(at)}>
              <span class="guide__chname">${t(ch.name)}</span><span class="guide__chmicro">${ch.micro}</span>
            </button>`;
          })}
        </nav>` : null}
        <button type="button" class="guide__close" aria-label=${t('关闭')} title=${t('关闭 (Esc)')} onClick=${closeGuide}><${Icon} name="close" /></button>
      </header>

      ${stage.kind === 'text' ? html`<div class="guide__stage guide__stage--coop">
        <div class="guide__cooptext">
          ${stage.blocks.map((b) => html`<section key=${b.h} class="guide__coopsec">
            <h3>${t(b.h)}</h3>
            <ul>${b.items.map((it, k) => html`<li key=${k}>${t(it)}</li>`)}</ul>
          </section>`)}
        </div>
      </div>` : src ? html`<div class="guide__stage">
        <button type="button" class="guide__nav guide__prev" aria-label=${t('上一页')} onClick=${() => go(i - 1)}><${Icon} name="chevronLeft" /></button>
        <div class=${cx('guide__page', isLoaded && 'is-loaded')}>
          <img key=${src} src=${src} alt=${t(cur.title)} draggable=${false}
            onLoad=${() => setLoaded((s) => new Set(s).add(src))}
            onError=${() => setFailed((s) => new Set(s).add(src))} />
          ${!isLoaded ? html`<span class="guide__loading"><${Spinner} size="md" /></span>` : null}
        </div>
        <button type="button" class="guide__nav guide__next" aria-label=${t('下一页')} onClick=${() => go(i + 1)}><${Icon} name="chevronRight" /></button>
      </div>` : html`<div class="guide__stage guide__stage--text"><${TipsFallback} /></div>`}

      ${n ? html`<footer class="guide__foot">
        <div class="guide__label">
          <span class="guide__chtag">${t(cur?.chapterName || chapter?.name || '')}</span>
          <b class="guide__ptitle">${t(cur?.title || '')}</b>
        </div>
        <div class="guide__dots" role="tablist" aria-label=${t('页码')}>
          ${pages.map((p, k) => html`<button key=${p.key} type="button" role="tab" aria-selected=${k === i ? 'true' : 'false'} title=${t(p.title)}
            class=${cx('guide__dot', k === i && 'is-on', k > 0 && pages[k - 1].chapter !== p.chapter && 'is-first')} onClick=${() => go(k)}></button>`)}
        </div>
        <span class="guide__count num">${i + 1} / ${n}</span>
      </footer>` : null}
    </div>
  </div>`;
}
