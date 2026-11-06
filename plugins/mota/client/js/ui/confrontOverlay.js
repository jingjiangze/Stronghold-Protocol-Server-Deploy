// 对抗期 overlay (2V2, PHASE.CONFRONT) — 2026-11-04 起只剩两块：
//   'target'（选目标）：限时 10 秒的必选题，保持模态（.spov__veil）。对手以 '?' + P 编号 + 队伍色列出，队内先到先得
//     （服务端把剩下的那个发给队友）。**只在赏金档（pub.confront.versusRule === 'bounty'）出现** —— 业主 2026-11-04：
//     对抗档没有目标选择（服务端 enterConfront 直接自动分配目标 → 进 PREP），遮罩不弹。
//   'roster'（投放公示）：5 秒的只读名单 —— 右下角一张卡片（.rospov--conf，pointer-events: none），不拦截战场点击。
//     两档都有（对抗档的服务端 finishConfront 同样会挂这 5 秒公示）。
// 投放窗口（pub.confront.active === true && stage === null）整块不渲染：投放走商店条（ui/shopBar.js 的 MonsterCard
// → g.monsterPlace：点一下投 1 只 / 长按多选 / 拖到上门·下门），游戏页的攻方状态条只留一个「查看投放 / 继续投放」入口
// （本文件的 ConfrontDoneCard，每一行可撤回 → g.monsterDrop）。服务端 submitConfront 仍在（bot 与旧客户端会用），
// 客户端不再调用。
// 所以这里也**不再**有型号组 / 卡池 / 已放置 / 出怪位置 / boss 格 / 商店这一整套投放 UI。
// 2026-11-06：攻方游戏页的「当前投放」搬到本文件末尾的 MonsterDropFloat（盟约条那一行右端的小悬浮窗，非模态）；
// 原中央「本回合你是进攻方」绿块（.gm__attackwait）连同它的撤回按钮一起删掉。
// Texts go through t() (docs/I18N.md).
import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, MicroLabel, Countdown } from '../ui/components.js';
import { Img, GIcon, PlayerAvatar, useGameData } from '../ui/gameComponents.js';
import { enemyIconUrl } from '../ui/assetUrls.js';
import { useStore } from '../store.js';
import { RosterPanel } from './rosterPanel.js';
import { FOE_NAMES, foeEffect, eliteEffect, eventFoeCard } from './eventFoe.js';
// 撤回一次投放（`g.monsterDrop`）：与投放同一条通道（act 统一处理错误提示）。
import { act } from './gameActions.js';
import { t } from '../../../shared/i18n.js';
import { rosterHiddenFor } from '../../../shared/constants.js';

const cx = (...p) => p.flat().filter(Boolean).join(' ');
/** Bounty rows show every placed monster up to this many; the rest collapse into a +N chip. */
const MAX_BOUNTY_ICONS = 25;
/**
 * A 特训敌人 type's short label: the data name is 特训敌人·隐匿, the shown label drops the translated prefix (the same
 * expression the enemy drawer's faction chips use).
 */
const typeLabel = (name) => String(name || '').replace(t('特训敌人·'), '');
/**
 * The localized name / description of a 特训敌人 type group. The server sends the raw game data text (`g.name` /
 * `g.desc`, always Chinese), so the client maps the group's `id` through the localized game data (data/i18n — the same
 * source the enemy drawer and the 机变 overlay read) and keeps the sent text as the fallback (the Chinese source locale,
 * or before the overlays have loaded).
 */
const groupName = (gd, g) => (g && gd.factions?.types?.[g.id]?.name) || (g && g.name) || '';

/** P1 / P2 … of a player row (the seat number) — how the panel tells hidden opponents apart. */
const pNo = (p) => (p && Number.isInteger(p.seat) ? `P${p.seat + 1}` : '');

/** The roster row of ONE 2V2 placement: attacker → target, the monsters sent, their count and the announced bounty. */
function clashRowBody(gd, players, r) {
  const pNoOf = (p) => (p && Number.isInteger(p.seat) ? `P${p.seat + 1}` : '?');
  const side = (p) => (p && p.team === 1 ? 'red' : 'blue');
  const foe = players.find((p) => p.playerId === r.sub.target) || null;
  const picks = Array.isArray(r.sub.picks) ? r.sub.picks : [];
  const shown = picks.slice(0, MAX_BOUNTY_ICONS);
  const rest = picks.length - shown.length;
  return html`<div class="confclash__row" data-testid="confront-clash-row">
    <span class=${cx('confclash__side', `confclash__side--${side(r.atk)}`)}>
      <${PlayerAvatar} player=${r.atk} size="sm" />
      <span class="confclash__p confseat num">${pNoOf(r.atk)}</span>
    </span>
    <span class="confclash__mid">
      ${shown.map((pk, i) => html`<${Img} key=${`${pk.enemyKey}:${i}`} src=${enemyIconUrl(gd.m, pk.enemyKey)} fallback=${html`<${GIcon} name="target" />`} />`)}
      ${rest > 0 ? html`<span class="confclash__more num">+${rest}</span>` : null}
      <span class="confclash__vs">→</span>
    </span>
    <span class=${cx('confclash__side', `confclash__side--${side(foe)}`)}>
      <span class="confclash__q">?</span>
      <span class="confclash__p confseat num">${pNoOf(foe)}</span>
    </span>
    <span class="confclash__count num">${t('共 {count} 只', { count: picks.length })}</span>
  </div>`;
}

/**
 * The 2V2 名单 rows (both teams, own team first) from the applied submissions. `myTeam` only decides the order / the
 * 我方 / 对面 headings — the roster itself is public (server messaging.js keeps both teams while the roster runs).
 * @returns {Array<{ key: string, heading?: any, body?: any }>}
 */
function clashRows(gd, pub, conf, myTeam) {
  const players = pub.players || [];
  const subs = (conf && conf.subs) || {};
  const list = players
    .filter((p) => p.team != null && subs[p.playerId] && (subs[p.playerId].picks || []).length)
    .map((p) => ({ atk: p, sub: subs[p.playerId], mine: myTeam != null && p.team === myTeam }));
  const mine = list.filter((r) => r.mine);
  const foes = list.filter((r) => !r.mine);
  const out = [];
  if (mine.length) out.push({ key: 'mine', heading: t('我方') });
  for (const r of mine) out.push({ key: r.atk.playerId, body: clashRowBody(gd, players, r) });
  if (foes.length) out.push({ key: 'foe', heading: t('对面') });
  for (const r of foes) out.push({ key: r.atk.playerId, body: clashRowBody(gd, players, r) });
  return out;
}

/** The round's monster entry (name + effect, then 强力属性), if THIS round's event published one. */
function rosterFoe(pub, round) {
  const foe = pub && pub.event && pub.event.foe ? pub.event.foe : null;
  if (!foe || Number(foe.round) !== Number(round)) return null;
  const card = eventFoeCard(foe);
  if (!card) return null;
  const elite = foe.elite || null;
  const attr = elite && elite.attr ? (FOE_NAMES[elite.attr] ? t(FOE_NAMES[elite.attr]) : String(elite.attr)) : '';
  return html`<section class="rospov__foe" data-testid="roster-foe">
    <h3 class="rospov__h">${t('本回合的怪物词条')}</h3>
    <p class="rospov__foeline"><b>${t(FOE_NAMES[card.key] || card.key)}</b><span>${foeEffect(card)}</span></p>
    ${attr ? html`<p class="rospov__foeline is-elite"><b>${t('强力属性')}</b>
      <span>${t('本回合 {share}% 的敌人带「{attr}」', { share: Math.round((Number(elite.share) || 0) * 100), attr })}</span>
      <span>${t('共 {count} 只', { count: Number(elite.count) || 0 })}</span>
      <span>${eliteEffect(elite.attr)}</span>
    </p>` : null}
  </section>`;
}

/** The roster panel of the 同盟狩猎 投放公示: one public plan per alive player (`plans`), plus this round's entry. */
function coopRosterPanel(gd, pub, conf, players) {
  const roster = conf.roster || {};
  const rows = (Array.isArray(roster.plans) ? roster.plans : []).map((p) => {
    const ps = players.find((x) => x.playerId === p.playerId) || { seat: p.seat, name: '?' };
    const cat = p.category ? typeLabel(groupName(gd, { id: p.category, name: p.categoryName })) : '';
    return {
      key: p.playerId,
      body: html`<span class="rospov__plan">
        <b class="rospov__who num">${pNo(ps)}</b>
        <span class="rospov__name">${ps.name || '?'}</span>
        <span class="rospov__sep">·</span><span class="rospov__cat">${cat || '—'}</span>
        <span class="rospov__sep">·</span><span>${t('总价值 {v}', { v: p.value })}</span>
        <span class="rospov__sep">·</span><span>${t('共 {count} 只', { count: p.count })}</span>
      </span>`,
    };
  });
  const until = Number(roster.until) || Number(pub.deadline) || 0;
  return html`<${RosterPanel} title=${t('本回合投放公示')} micro=${'DELIVERY // ' + t('本回合投放公示')} tone="gold"
    className="rospov--conf" testid="coop-roster" rows=${rows} until=${until} note=${t('猎物漏过不扣目标生命')}>
    ${rosterFoe(pub, conf.round != null ? conf.round : pub.round)}
  <//>`;
}

/**
 * The confront panel of a 2V2 round: 'target' (the 10 s mandatory pick — modal) and 'roster' (the 5 s 投放公示 — a
 * read-only card in the bottom-right corner that lets clicks through).
 * The 投放窗口 (`active === true && stage === null`) renders NOTHING here: placement lives in the shop bar, and the game
 * screen's attacker status bar owns the single 「查看投放」 entry (`ConfrontDoneCard`).
 * @param {{ pub:any, busy?:boolean, onTarget:(targetPlayerId:string)=>void }} props
 */
export function ConfrontOverlay({ pub, busy = false, onTarget }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  const conf = pub && pub.confront;
  // 阶段按**原值**读：投放窗口是 stage === null（旧写法 `conf.stage || 'target'` 会把它误判成选目标）
  const stage = conf && conf.stage != null ? conf.stage : null;
  // 业主 2026-11-04：目标选择遮罩**只在赏金档出**。对抗档（versusRule === 'confront'）服务端已经跳过目标选择
  // （confront.js 的 enterConfront 直接自动分配目标 → 进 PREP），这里再按规则档兜一道，任何残留的 'target' 帧都不弹模态。
  const picking = !!conf && conf.versusRule === 'bounty' && conf.active === true && stage === 'target';
  const roster = !!conf && stage === 'roster';
  // 选目标列表横滑：对手多（10V10 有 10 个）时要能横向滑；滚动条已隐藏，靠滚轮/拖动/触控。
  // hooks 无条件调用 —— 投放窗口整块不渲染，阶段切换时渲染次数会变。
  const foesRef = useRef(null);
  useEffect(() => {
    if (!picking) return undefined;
    const el = foesRef.current;
    if (!el) return undefined;
    const onWheel = (e) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      if (!d) return;
      el.scrollLeft += d;
      e.preventDefault();
    };
    let drag = null;
    const onDown = (e) => {
      if (el.scrollWidth <= el.clientWidth + 1) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      drag = { x: e.clientX, left: el.scrollLeft, moved: false };
      el.setPointerCapture?.(e.pointerId);
      el.classList.add('is-drag');
    };
    const onMove = (e) => {
      if (!drag) return;
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3) drag.moved = true;
      el.scrollLeft = drag.left - dx;
      if (drag.moved) e.preventDefault();
    };
    const onUp = (e) => {
      if (!drag) return;
      el.classList.remove('is-drag');
      el.releasePointerCapture?.(e.pointerId);
      if (drag.moved) {
        const kill = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
        el.addEventListener('click', kill, { capture: true, once: true });
        setTimeout(() => el.removeEventListener('click', kill, { capture: true }), 60);
      }
      drag = null;
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('pointerdown', onDown);
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
    el.addEventListener('pointercancel', onUp);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('pointerdown', onDown);
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      el.removeEventListener('pointercancel', onUp);
    };
  }, [picking]);

  // 投放窗口（stage === null）与任何未知阶段：整块不渲染（投放由商店条 + 游戏页的入口按钮负责）
  if (!conf || (!picking && !roster)) return null;

  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId) || null;
  const myTeam = me ? me.team : null;
  const mates = players.filter((p) => p.team != null && p.team === myTeam);
  const foes = players.filter((p) => p.team != null && myTeam != null && p.team !== myTeam);
  const targets = conf.targets || {};
  const myTarget = targets[myId] || null;
  // the share of the opponent's wave this round's intervention replaces (5→15 %, 50 % on the 最终狩猎 round)
  const pct = Math.round((Number(conf.ratio) || 0) * 100);
  const foesPicked = mates.every((p) => targets[p.playerId]);

  // 悬赏名单 / 投放公示 (the server's roster hold): the submissions are final, the battles have not started. Only the
  // announced list is shown, as a corner card (ui/rosterPanel.js) that does not intercept the battlefield's clicks.
  if (roster) {
    if (conf.roster && conf.roster.coop) return coopRosterPanel(gd, pub, conf, players);
    // 2026-11-06 业主：「投放方不显示投放名单，仅对面显示」。攻方这一回合的名单他们自己在 MonsterDropFloat 里看得见
    // （已投 N 只 + 逐条撤回），不需要这块公示；守方才看。身份读 `pub.attackingTeam`（views.js 平铺下发，非攻守回合
    // 是 null ⇒ 照常渲染，行为与改造前一致）。
    if (rosterHiddenFor(pub, myTeam)) return null;
    const until = Number(conf.roster && conf.roster.until) || Number(pub && pub.deadline) || 0;
    return html`<${RosterPanel} title=${t('投放名单')} micro=${'SORTIE LIST // ' + t('投放名单')} tone="gold"
      className="rospov--conf" testid="confront-roster" rows=${clashRows(gd, pub, conf, myTeam)} until=${until}
      note=${t('对面投放的怪物，清掉它们')} />`;
  }

  return html`<div class="spov confov" role="dialog" aria-label=${t('狩猎期')}>
    <div class="spov__veil" aria-hidden="true"></div>
    <div class="spov__inner">
      <header class="spov__head">
        <div class="spov__titles">
          <h2 class="spov__title"><span class="spov__name"><${MicroLabel} tone="mint">HUNTING PHASE // ${t('狩猎期')}</${MicroLabel}>${t('选择你要针对的对手')}</span>
            <span class="spov__bar">|</span><span class="spov__desc">${t('第 {r} 回合 · 对手以 ? 显示，只看编号', { r: conf.round })}</span></h2>
          <p class="spov__sub">${myTarget ? t('已锁定目标，等待队友与对手') : t('点击一个 ? 头像框锁定你的目标')}</p>
        </div>
        <div class="spov__turn">
          ${conf.hunt ? html`<span class="spov__turntxt is-final">${t('最终狩猎')}</span>` : null}
          <span class="spov__turntxt t-dim">${t('本轮替换 {pct}%', { pct })}</span>
          ${Number(pub?.deadline) > 0 ? html`<${Countdown} deadline=${pub.deadline} size="sm" />` : null}
        </div>
      </header>

      <div class="confov__targets">
        <div class="confov__foes" ref=${foesRef}>
          ${foes.map((f) => html`<button key=${f.playerId} type="button" class=${cx('conffoe', `conffoe--${f.team === 0 ? 'blue' : 'red'}`, myTarget === f.playerId && 'is-sel')}
            disabled=${!!myTarget || busy} onClick=${() => onTarget(f.playerId)}>
            <span class="conffoe__q">?</span>
            <span class="conffoe__p confseat num">${pNo(f)}</span>
          </button>`)}
        </div>
        <div class="confov__pairs">
          ${mates.map((p) => html`<span key=${p.playerId} data-testid="confront-seat" class=${cx('confpair', 'confseat', p.playerId === myId && 'is-self')}>
            <b class="num">${pNo(p)}</b>
            <span class="confpair__state">${targets[p.playerId] ? t('已选择') : t('未选择')}</span>
          </span>`)}
        </div>
        <p class="confov__hint t-dim">${foesPicked ? t('双方都选好了，进入投放窗口') : t('对手被随机分配：先选的先得，队友自动拿剩下的那一个')}</p>
      </div>
    </div>
  </div>`;
}

/** The localized name of a pick's monster (`m.public.confront.subs[].picks[].enemyKey`), the key as the fallback. */
const pickName = (gd, key) => {
  try {
    const rec = gd.enemy ? gd.enemy(key) : null;
    return (rec && rec.name) || String(key || '');
  } catch { return String(key || ''); }
};

/**
 * 攻方「查看投放 / 继续投放」的已投清单（2026-11-04）：投放窗口（pub.confront.active === true && stage === null）里由游戏页
 * 攻方状态条的入口按钮打开。列出本回合已投放的怪与剩余价值预算，每一行都能**撤回**（业主 2026-11-04 裁决：
 * 场上 / 清单里已投的怪要能撤销）；投放本身走商店条（点一下 / 长按多选 / 拖到门），这里不重复投放 UI，
 * 也没有全屏遮罩（卡片以外不拦截战场点击）。
 * 数据源（服务端实测口径，见报告）：`g.monsterPlace` 只写 ps.monsterDraft，随 `m.monsterShop` 帧下发
 * （monsterShop.js placeMonster / monsterShopFrame），**不进** pub.confront.subs；pub.confront.subs 只有
 * submitConfront / botConfront 才会写。所以商店帧开着时以 `shop.draft.picks` + `shop.left/budget` 为准，否则回落到
 * `pub.confront.subs[myId].picks` 与按 confront.groups 单价现算的剩余。
 * `shop` = store.match.monsterShop（攻方私有帧）。
 * @param {{ pub:any, shop?:any }} props
 */
export function ConfrontDoneCard({ pub, shop = null }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  // 正在撤回的行（服务端 picks 的下标）：同一行不发第二次；成功后服务端推帧 ⇒ picks 变短，下面的 effect 清空它。
  // 只有商店草稿的 picks 能撤回（那是 ps.monsterDraft，g.monsterDrop 摘的就是它）；旧对局的 confront.subs 是提交后的
  // 只读名单，没有撤回按钮。
  const [undoing, setUndoing] = useState([]);
  const conf = pub && pub.confront;
  const mine = conf && conf.subs ? conf.subs[myId] : null;
  const shopOn = !!shop && shop.open === true;
  // 投放期真正的「已投」列表在商店帧的草稿里（点卡即投放）；没有商店帧的旧对局 / 提交路径回落到 confront.subs
  const picks = shopOn
    ? (Array.isArray(shop.draft && shop.draft.picks) ? shop.draft.picks : [])
    : (Array.isArray(mine && mine.picks) ? mine.picks : []);
  useEffect(() => { setUndoing([]); }, [picks.length]);
  // 价值表：本回合的 confront.groups（服务端已按本回合口径发好单价）
  const valueOf = new Map();
  for (const g of (Array.isArray(conf && conf.groups) ? conf.groups : [])) {
    for (const r of g.rows || []) if (!valueOf.has(r.key)) valueOf.set(r.key, Math.max(0, Number(r.value) || 0));
  }
  const budget = Math.max(0, Number(shopOn ? shop.budget : conf && conf.budget) || 0);
  const spent = shopOn ? Math.max(0, Number(shop.spent) || 0)
    : picks.reduce((s, p) => s + (valueOf.get(p && p.enemyKey) || 0), 0);
  const left = Math.max(0, budget - spent);
  const upper = picks.filter((p) => p && p.gate === 'upper').length;
  /**
   * 撤回第 i 条草稿：`g.monsterDrop { index, id? }` → 服务端摘掉那一条、把它的库存与资金退回（monsterShop.js
   * dropMonster）。定位优先用**稳定 id**（`shop.draft.picks[i].id`，服务端的 seq）：多端同时撤回时下标会整体前移，
   * 用 id 才撤得对那一条；老帧 / 老存档没有 id 就回落到下标（服务端两种都认）。成功后服务端推帧 ⇒ picks 变短，
   * 这张卡跟着重画（不本地删行）。同一行在飞行中不发第二次。
   */
  const undoPick = (i, id) => {
    if (undoing.includes(i)) return;
    setUndoing((cur) => (cur.includes(i) ? cur : [...cur, i]));
    const payload = Number.isInteger(id) ? { index: i, id } : { index: i };
    void act('g.monsterDrop', payload, { sfx: 'back' }).then((ok) => {
      if (!ok) setUndoing((cur) => cur.filter((x) => x !== i));   // 被拒：放开按钮（toast 已经说了原因）
    });
  };
  return html`<div class="confdone" id="confront-done-card" role="status" data-testid="confront-done">
    <div class="confdone__head">
      <b class="confdone__title">${t('本回合已投放')}</b>
      <span class="confdone__stat num">${t('共 {n} 只', { n: picks.length })}</span>
      <span class="confdone__stat num" data-testid="confront-done-left">${t('剩余价值 {v}', { v: left })}</span>
    </div>
    ${picks.length
      ? html`<ul class="confdone__list">
          ${picks.map((p, i) => html`<li key=${`${p && p.enemyKey}:${i}`} class="confdone__row">
            <span class="confdone__icon"><${Img} src=${enemyIconUrl(gd.m, p && p.enemyKey)} fallback=${html`<${GIcon} name="target" />`} /></span>
            <span class="confdone__name">${pickName(gd, p && p.enemyKey)}</span>
            <span class=${cx('confdone__gate', p && p.gate === 'upper' && 'is-upper')}>${t(p && p.gate === 'upper' ? '上路' : '下路')}</span>
            ${/* 撤回：只有商店草稿能撤（confront.subs 是提交后的只读名单） */ null}
            ${shopOn
              ? html`<button type="button" class="confdone__undo" data-testid="confront-undo" disabled=${undoing.includes(i)}
                  title=${t('撤回这一只：库存与投放资金退回')} aria-label=${t('撤回这一只')}
                  onClick=${() => undoPick(i, p && p.id)}>${t('撤回')}</button>`
              : null}
          </li>`)}
        </ul>`
      : html`<p class="confdone__empty t-dim">${t('还没有投放怪物：在下方商店条点卡投放')}</p>`}
    ${picks.length ? html`<p class="confdone__sum t-dim">${t('上路 {u} 只 · 下路 {l} 只', { u: upper, l: picks.length - upper })}</p>` : null}
  </div>`;
}

/**
 * 攻方「当前投放」小悬浮窗（2026-11-06 业主：中央那块「✓ 本回合你是进攻方 / 怪物已投放，等待守方布阵与作战…」
 * 太挡棋盘，去掉；改在盟约条那一行的右端挂一个小窗看当前投放）。由游戏页的 HUD 渲染（screens/game.js 的
 * `.gm__hud`，与 `.gm__bonds` 并列），**不是**整屏名单：`pointer-events` 只在自己这块小窗里，战场照常可点。
 *
 * 数据源两态（与 ConfrontDoneCard 同一口径）：
 *   · 投放窗口 —— 游戏页传实时草稿 `m.monsterShop.draft.picks`（点卡即投放），`live` 为真 ⇒ 每一行可「撤回」；
 *   · 公示 / COMBAT / SETTLE —— 回落 `pub.confront.subs[myId].picks` 的冻结值，`live` 为假 ⇒ 不画撤回按钮
 *     （那是提交后的只读名单，服务端没有可撤的草稿）。
 * 撤回只转发 `onUndo(index, id)`（游戏页 → `g.monsterDrop { index, id? }`，服务端 monsterShop.js dropMonster 退款 /
 * 退库存）；成功后服务端推帧 ⇒ picks 变短，这里跟着重画，不本地删行。
 * 渲染闸门（角色 / 阶段 / 有没有对抗档）在调用方 screens/game.js 里，本组件只管画。
 * @param {{ picks?: any[], live?: boolean, busy?: boolean, onUndo?: (index:number, id:any)=>void }} props
 *   picks: `{ id, enemyKey, gate }[]`（草稿或提交后名单）；live: 这一份是不是可撤回的草稿；busy: 撤回飞行中；
 */
export function MonsterDropFloat({ picks = [], live = false, busy = false, onUndo = null }) {
  const gd = useGameData();
  const rows = Array.isArray(picks) ? picks : [];
  const upper = rows.filter((p) => p && p.gate === 'upper').length;
  return html`<div class="mdropfloat" data-testid="monster-drop-float">
    <div class="mdropfloat__head">
      <b class="mdropfloat__t">${t('本回合已投放')}</b>
      <span class="mdropfloat__n num" data-testid="monster-drop-count">${t('已投 {n} 只', { n: rows.length })}</span>
    </div>
    ${rows.length
      ? html`<ul class="mdropfloat__list">
          ${rows.map((p, i) => {
            // 最后一条就是「撤回上一只」那一只（原中央状态条的按钮，2026-11-06 搬进来）；其余行按稳定 id 撤自己那一条
            const last = i === rows.length - 1;
            return html`<li key=${`${p && p.enemyKey}:${i}`} class="mdropfloat__row" data-testid="monster-drop-row">
              <span class="mdropfloat__icon"><${Img} src=${enemyIconUrl(gd.m, p && p.enemyKey)} fallback=${html`<${GIcon} name="skull" />`} /></span>
              <span class="mdropfloat__name">${pickName(gd, p && p.enemyKey)}</span>
              <span class=${cx('mdropfloat__gate', p && p.gate === 'upper' && 'is-upper')}>${t(p && p.gate === 'upper' ? '上路' : '下路')}</span>
              ${live
                ? html`<button type="button" class="mdropfloat__undo" data-testid=${last ? 'monster-undo-last' : 'monster-undo'}
                    disabled=${busy} onClick=${() => onUndo && onUndo(i, p && p.id)}
                    title=${t(last ? '撤回最后投放的那一只：库存与投放资金退回' : '撤回这一只：库存与投放资金退回')}
                    aria-label=${t('撤回这一只')}>${t('撤回')}</button>`
                : null}
            </li>`;
          })}
        </ul>`
      : html`<p class="mdropfloat__empty t-dim">${t('还没有投放怪物：在下方商店条点卡投放')}</p>`}
    <p class="mdropfloat__sum t-dim">${t('上路 {u} 只 · 下路 {l} 只', { u: upper, l: rows.length - upper })}</p>
  </div>`;
}

/** 「本局」的身份：房间码 + 模式 + 战场 + 参战名单 —— 换房间 / 换模式 / 换图 / 换人 ⇒ 换局（public 上没有 matchId）。 */
const clashMatchKey = (pub, roomCode) => {
  const ids = (Array.isArray(pub?.players) ? pub.players : []).map((p) => (p && p.playerId) || '').join(',');
  return `${roomCode == null ? '' : roomCode}|${pub?.modeId || ''}|${pub?.stageId || ''}|${ids}`;
};

/**
 * 「本局已弹过一次」的记位（模块级：ConfrontClash 每个回合的 COMBAT 都重新挂载，组件里的 ref / state 活不过一次挂载
 * —— `applied` 只在 COMBAT / SETTLE 为真，PREP 里整块不渲染 ⇒ 改造前每个回合都重新弹一次，一局弹 13 次）。
 * 同款范式：ui/stats.js 的 liveMatch（模块常量 + 每次观察改写）。
 * @type {{ key: string, round: number } | null}
 */
let clashSeen = null;

/**
 * 投放名单整屏卡的「本局只弹一次」判据（业主 2026-11-05 第 3 条）。纯函数，便于自检：
 *   · 同局（key 相同）且回合没有回落 ⇒ 不再弹（第一次之后的每一次 COMBAT 都走这里）；
 *   · 换局（key 变了：房间 / 模式 / 战场 / 参战名单），或回合数回落（同一房间同一批人重开一局，round 从 1 重新数）
 *     ⇒ 重置并弹出。
 * @param {{ key: string, round: number }|null} seen 上一次弹过的那一局（调用方持有）
 * @param {{ key: string, round: number }|null} cur 本帧的对局身份与回合，null = 不在对局里
 * @returns {{ show: boolean, seen: { key: string, round: number }|null }} show = 这一帧要不要弹；seen = 写回的新记位
 */
export function clashFirstOfMatch(seen, cur) {
  if (!cur) return { show: false, seen: null };
  const round = Number(cur.round) || 0;
  const prev = seen && seen.key === cur.key ? seen : null;
  const prevRound = prev ? (Number(prev.round) || 0) : 0;
  // 同一局：身份相同，且回合没有回落（回落 = 重开一局）
  if (prev && round >= prevRound) return { show: false, seen: { key: cur.key, round: Math.max(round, prevRound) } };
  return { show: true, seen: { key: cur.key, round } };
}

/**
 * 投放名单「不给投放方看」的判据在 shared/constants.js（`rosterHiddenFor`）—— 服务端与客户端共用一份，
 * 也是唯一能被 node 单测直接 import 的地方（本文件依赖 preact 的 vendor 模块，测试里 import 不了）。
 */

/**
 * The 悬赏名单 AFTER the phase: once the battles start, the applied submissions stay on the public view for a moment —
 * both teams' boards are revealed (who sent what at whom, and what killing it pays). Display only: it fades out by
 * itself. The roster hold itself is rendered by this file's ConfrontOverlay (stage 'roster').
 * 本局只弹一次（业主 2026-11-05 第 3 条）：判据见 clashFirstOfMatch，记位是模块级的 clashSeen。
 * @param {{ pub:any }} props
 */
export function ConfrontClash({ pub }) {
  const gd = useGameData();
  const myId = useStore((s) => s.me.playerId);
  // 房间码只参与「本局」身份（上面的 clashMatchKey）；拿不到（旧帧 / 不在房间）就是 null
  const roomCode = useStore((s) => (s.room && typeof s.room.code === 'string' ? s.room.code : null));
  const conf = pub && pub.confront;
  const [shown, setShown] = useState(true);
  // 本次挂载的裁决：null = 还没判，true = 本局第一次（画），false = 本局已弹过（不画）
  const firstOfMatch = useRef(null);
  const round = conf && conf.round;
  useEffect(() => {
    setShown(true);
    const h = setTimeout(() => setShown(false), 5200);
    return () => clearTimeout(h);
  }, [round]);
  if (!conf || conf.active || !conf.subs || !shown) return null;
  const players = pub.players || [];
  const me = players.find((p) => p.playerId === myId) || null;
  const myTeam = me ? me.team : null;
  // 投放方不看投放名单（2026-11-06 业主）—— 与 ConfrontOverlay 的 roster 分支同一个判据（rosterHiddenFor）。
  // 注意放在「本局已弹」记位**之前**：攻方本来就不该看，不该吃掉守方那一局的一次。
  if (rosterHiddenFor(pub, myTeam)) return null;
  const rows = clashRows(gd, pub, conf, myTeam);
  if (!rows.length) return null;
  // 「本局已弹」只在**真的画出来**时占用：上面任何一条短路（不在 COMBAT / 名单为空 / 已经淡出）都没显示过名单，
  // 不该吃掉这一局的这一次。
  if (firstOfMatch.current == null) {
    const d = clashFirstOfMatch(clashSeen, { key: clashMatchKey(pub, roomCode), round: Number(round) || 0 });
    firstOfMatch.current = d.show;
    // 记位每次都跟着回合前进（不只是弹的那一次）：换局判据要读「本局记录到的最大回合数」，不然一局打到第 9 回合，
    // 下一局从 1 重新数时比的是第一次弹的回合数（例如 1），回落判据就失效了。
    if (d.seen) clashSeen = d.seen;
  }
  if (!firstOfMatch.current) return null;
  return html`<${RosterPanel} title=${t('投放名单')} micro=${'SORTIE LIST // ' + t('投放名单')} tone="gold"
    className="rospov--clash" testid="confront-clash" rows=${rows} note=${t('对面投放的怪物，清掉它们')} />`;
}
