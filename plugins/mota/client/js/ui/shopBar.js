// Bottom shop bar (research 06 §11.2 / D3): level-up card (升级 price hex, 等级), 3–5 operator cards
// (tier chip, price hex with discount/markup colours, portrait, bonds — a bond the mode never activates struck through,
// 本局禁用 — class, frozen overlay, sold state,
// merge progress), the item card, the funds card with ✕ 收起; above it 剩余可放置角色, 冻结/解冻 and 刷新.
// Buying and upgrading take two taps (research 09 §5 / §6.5, official `EventOnFirstClick` → `EventOnConfirm` /
// `EventOnUpgrade`): the first tap selects a card — it lifts and enlarges, its detail opens and it shows 确认购买
// (无法购买 + the reason when it cannot be bought) — and a second tap on the same card buys it; the upgrade card's first
// tap arms 确认升级 and the second upgrades (已满级 at level 6). A tap anywhere else, a shop change or the end of the
// editable phase disarms. A tap anywhere on a card is the card's tap — its 确认购买 strip included (it takes no
// pointer): there is no ⓘ corner (the official cards have none; user playtest #6 item 10 — on phones its invisible
// 44 px touch area covered the card's bottom-right quarter, half the strip, and a second tap there only re-opened the
// detail); a card that cannot be bought right now (the bar is not editable: ready, round start) opens its detail. The
// D / R / F keys stay one-press shortcuts — a 刷新 whose request is still on the wire dims the button and swallows
// further taps and the R key until the reply lands (GitHub #501; the single-flight lives in ui/gameActions.js
// onRefreshBusy, ui/shopBar.js only draws it). There is no drag-to-sell zone: selling is the 出售 +N button of a tapped
// unit's underframe (ui/underframe.js). After a promotion the shop's cards — operators and the equipment slot alike
// (GitHub #617) — are replaced by the 晋升奖励 cards (3 free operators, pick 1 — also two taps) until picked or put off
// (稍后 → the normal shop again + rewardOverlay.js pill);
// a special refresh (凯瑟琳 定向投放's 3 items, 娜仁图亚, 寻呼模块, 信标, 松果) takes the same place under its own name, an
// item slot drawn as an item card (player report #6 after 0.1.0).
// 对抗·攻方（2026-11-04）另有怪物卡池（`monsterShop`，只有攻方拿得到 open:true 的帧）：点一下投 1 只、长按进多选态、
// 拖到上门 / 下门一次性投放（业主 2026-11-04 裁决，旧的「选门 + 选数量」浮层已删除）；撤销在攻方状态条的「撤回上一只」
// 按钮里（screens/game.js → `g.monsterDrop`；投放方不再显示已投名单 —— 名单只给对面 / 守方看）。
// `monsterOn === false` 时每一处分支都走改造前的老路。
// Every operator card shows the skill it will fight with — the player's 干员调配 loadout (m.private.loadout, DESIGN
// §16): the skill icon above the name, mint-framed with 已调配 in its title when it is not the default skill (and the
// module type of an elite card, with its official type icon when the local-client art has it). A chess the player does
// not own (0.2.0 补位, m.private.standIns) shows its stand-in — portrait, name, class and its backup skill, the one that
// fights — with the chess's bonds, tier and price and a small ice 「替补」 mark (the owner's recall of the official mode,
// 2026-10-06; the replaced operator's name is in the mark's title and on the detail card the first tap opens). A 自选
// piece (0.2.0, m.private.diy — a DIY slot the player filled, only ever in its own shop) shows the operator — name,
// portrait, class, the bonds of its factions, the pick's skill and module — with a mint 「自选」 badge.

import { useEffect, useRef, useState } from '../../vendor/hooks.module.js';
import { html, Icon, HexBadge, TierChip, Tooltip, MicroLabel } from './components.js';
import { Img, BondGlyph, CoinGlyph, GIcon, RichText } from './gameComponents.js';
import { priceTone, mergeProgress, mergeTarget, shopBlockReason, chessLoadout, offerHeader, briefingBondTip, ownStandIn, standInLoadout, standInLabel, standInTip, standInForText, ownDiyRecord, diyGetter } from './gameLogic.js';
import { itemIconUrl, profIconUrl, uiUrl, skillIconUrl, skillRecordIconUrl, moduleTypeIconUrl, enemyIconUrl } from './assetUrls.js';
import { portraitUrlOf, currentAppearanceLookup } from './portraitChain.js';
import { data, useData } from '../data.js';
import { hotkeyLabelOf } from './settings.js';
// 组件级改写（DESIGN §28.19）：`game.shopCard` 是引擎的具名组件之一（每一张干员卡：商店、晋升奖励、定向投放），
// 包声明的 wraps 就长在它上面。
import { modComponent } from './modComponents.js';
import { t } from '../../../shared/i18n.js';
import { longPress, heldClick } from './longPress.js';
// 半区高亮的几何（门格四角，跟着镜头走）与战场的行列（GEO.FIELD）—— 与 ui/underframe.js 同一套 import
import { tileScreen, useTileScreen } from './facingWheel.js';
import { GEO } from '../../../shared/constants.js';
// 协同经济的三个动作 (后勤项目/表决/救济) 一直写成裸 `actions.xxx`：这个模块从来没 import 过 actions，
// 点下去只会抛 ReferenceError 并被上层吞掉 —— 表现就是「按钮点了没反应」(user report 2026-10-17)。
// gameActions 只依赖 net/toasts/audio，反向不依赖本文件，不成环。
import { actions, act } from './gameActions.js';

/**
 * 怪物盟约字形（2026-11-05）：8 个没有官方 campLogo 的阵营 + 3 条通用，共 11 条 24×24 单色原创剪影。
 *
 * **为什么放在这里**：`ui/gameComponents.js` 不在插件 `plugin.json` 的 `code.client` 清单里，写在那边的
 * 字形永远发不到客户端（2026-11-05 真机实测：`.mbond` 内既没有 `<img>` 也没有 `<svg>`；服务端吐出的
 * `/js/ui/gameComponents.js` 里 `mb-` 命中数为 0）。所以这 11 条路径改为随本模块下发、在 shopBar 里就地
 * 内联成 `<svg>`，不再依赖 GLYPHS 查表。
 * 名字来自服务端 server/match/monsterBonds.js 的 MONSTER_BOND_GLYPH；有官方 campLogo 的 14 个阵营走
 * `.mbond__img`，不在这里。
 */
const MONSTER_BOND_GLYPHS = Object.freeze({
  // 整合运动：破碎盾形（盾面被一道锯齿裂缝劈开）
  'mb-reunion': 'M12 2.2 20.6 5.4V11.1L18.7 15.3 15.9 18.8 12 21.9 8.3 18.8 5.5 15.2 3.4 11.1V5.4ZM11.3 4.1 13.5 9.2 11.1 12.5 13.7 16 12 20.2 10.6 16.1 12.7 12.6 10.2 9.3Z',
  // 深池：水滴（环）+ 下方三道波纹
  'mb-deeppool': 'M12 1.6C12 1.6 6.6 7.4 6.6 11.2A5.4 5.4 0 0 0 17.4 11.2C17.4 7.4 12 1.6 12 1.6ZM12 5.6C12 5.6 9.3 8.7 9.3 10.7A2.7 2.7 0 0 0 14.7 10.7C14.7 8.7 12 5.6 12 5.6ZM4.2 18.8h4v2h-4zM10.2 18.8h4v2h-4zM16.2 18.8h4v2h-4z',
  // 萨卡兹：一对角 + 中间带棱的竖刃
  'mb-sarkaz': 'M4 2.4C6.9 3.9 8.8 6.6 9.2 10.1L6.9 10.6C6.5 7.6 5.5 5.4 3.2 4.1ZM20 2.4C17.1 3.9 15.2 6.6 14.8 10.1L17.1 10.6C17.5 7.6 18.5 5.4 20.8 4.1ZM11 8.6h2v11.6h-2zM8.5 10.2h1.3v8.6H8.5zM14.2 10.2h1.3v8.6h-1.3zM6.8 19.6h10.4v1.8H6.8z',
  // 海嗣：中央触手核 + 四根伸出的触须
  'mb-seaborn': 'M12 9.2A3.4 3.4 0 0 0 12 16A3.4 3.4 0 0 0 12 9.2ZM11 16.1C10.3 17.9 9 19.4 7.5 20.6 6.5 21.4 5.9 22.3 5.8 23.5L7.7 23.8C7.8 23 8.2 22.4 8.9 21.8 10.6 20.4 12.1 18.7 12.9 16.4ZM13 16.1C13.7 17.9 15 19.4 16.5 20.6 17.5 21.4 18.1 22.3 18.2 23.5L16.3 23.8C16.2 23 15.8 22.4 15.1 21.8 13.4 20.4 11.9 18.7 11.1 16.4ZM9 10.4C7.6 10.6 6.4 10.1 5.4 9.1 4.7 8.4 3.9 8.1 2.9 8.1L2.7 9.9C3.6 9.9 4.2 10.1 4.8 10.7 6.1 12 7.8 12.7 9.7 12.4ZM15 10.4C16.4 10.6 17.6 10.1 18.6 9.1 19.3 8.4 20.1 8.1 21.1 8.1L21.3 9.9C20.4 9.9 19.8 10.1 19.2 10.7 17.9 12 16.2 12.7 14.3 12.4Z',
  // 汐斯塔安保：盾 + 镂空五角星
  'mb-siesta': 'M12 2 21 5.2V11.3C21 16.5 17.4 20.4 12 22 6.6 20.4 3 16.5 3 11.3V5.2ZM12 7.2 13.06 9.94 15.99 10.1 13.71 11.96 14.47 14.8 12 13.2 9.53 14.8 10.29 11.96 8.01 10.1 10.94 9.94Z',
  // 杜林：小圆盾（外环 + 中心盾钉）
  'mb-durin': 'M12 3.6A8.4 8.4 0 0 0 12 20.4A8.4 8.4 0 0 0 12 3.6ZM12 5.4A6.6 6.6 0 0 1 12 18.6A6.6 6.6 0 0 1 12 5.4ZM12 9.4A2.6 2.6 0 0 0 12 14.6A2.6 2.6 0 0 0 12 9.4Z',
  // 源石协议：中央晶体（带一条刻面）+ 两侧碎块
  'mb-originium': 'M12 2.4 17 9.2 12 21.6 7 9.2ZM12 5.8 14.2 9.4 12 16.4 9.8 9.4ZM4.2 7.8 6.4 11.6 4.8 17.6 2.6 12.2ZM19.8 7.2 21.6 11.6 19.4 17.4 17.6 10.6Z',
  // 假想敌协议：虚线框 + 问号（缺口式轮廓，没有实物）
  'mb-imaginary': 'M3 3h4.4v1.8H3zM9.8 3h4.4v1.8H9.8zM16.6 3H21v1.8h-4.4zM3 6.6h1.8v4.4H3zM3 13.4h1.8v4H3zM19.2 6.6H21v4.4h-1.8zM19.2 13.4H21v4h-1.8zM3 19.2h4.4v1.8H3zM9.8 19.2h4.4v1.8H9.8zM16.6 19.2H21v1.8h-4.4zM9.4 9.4c0-2 1.3-3.3 3-3.3 1.9 0 3 1.1 3 2.8 0 1.5-.8 2.3-2.1 3-.9.5-1.2.9-1.2 1.9h-2c0-1.7.6-2.5 2-3.3.8-.4 1.1-.8 1.1-1.4 0-.6-.5-1-1.1-1-.7 0-1.1.5-1.1 1.3zM11.2 16.3h2v2h-2z',
  // 增援：向上箭头 + 右下加号
  'mb-reinforce': 'M12 2.6 19 10.4H14.6V15.4H9.4V10.4H5ZM16.8 16.4h2.2v2.2h2.2v2.2h-2.2v2.2h-2.2v-2.2h-2.2v-2.2h2.2z',
  // 会战：交叉双剑（中间一块菱形护手压住交点）
  'mb-concert': 'M19.8 2.8 21.2 4.2 5.2 20.2 3.8 18.8ZM4.2 2.8 2.8 4.2 18.8 20.2 20.2 18.8ZM12 9.8 14.2 12 12 14.2 9.8 12Z',
  // 回收：缺口圆环 + 箭头（循环）
  'mb-recover': 'M7.6 19.62A8.8 8.8 0 1 1 16.4 19.62L15.1 17.37A6.2 6.2 0 1 0 8.9 17.37ZM15.1 17.37 16.4 19.62 12.2 20.6Z',
});

const cx = (...p) => p.flat().filter(Boolean).join(' ');

function PriceHex({ slot, free, poor = false }) {
  const tone = priceTone(slot);
  const price = Number(slot?.price) || 0;
  if (free || price === 0) return html`<span class="scard__free">FREE</span>`;
  // like the original (img_bg_price_not_enough) the price turns grey while the funds don't cover it
  return html`<${HexBadge} value=${price} tone=${poor ? 'dark' : tone} size="md" class=${cx('scard__price', poor && 'is-poor')}
    title=${poor ? t('资金不足') : tone === 'discount' ? t('折扣价（原价 {basePrice}）', { basePrice: slot.basePrice }) : tone === 'premium' ? t('加价（原价 {basePrice}）', { basePrice: slot.basePrice }) : t('价格')} />`;
}

/** Data lookups (merge progress / target, the loadout; shopBlockReason ignores them — a full hand refuses every purchase). */
const LOOKUPS = { getChess: (id) => data.lookup('chess', id), getItem: (id) => data.lookup('items', id) };

/**
 * Where a merge-completing buy sends the elite (DESIGN §20.11), null when the card completes no merge: the 可晋升 tag's
 * title, and a line of the detail card the first tap opens — a touch screen never shows a title (QA 6b).
 */
export function mergeHint(priv, chessId) {
  const prog = mergeProgress(priv, chessId, LOOKUPS.getChess);
  if (!(prog.copies > 0 && prog.copies + 1 >= prog.need)) return null;
  return mergeTarget(priv, chessId, LOOKUPS.getChess) ? t('精锐干员将出现在作战区原位置') : t('精锐干员将进入整备区');
}

/**
 * Whether a shop card shows its frost: its own slot's `frozen` (m.private shop.slots[i].frozen) — the 冻结 toggle copies onto
 * every unsold slot, and 梓兰's 猎头顾问 freezes ONE copied card with every active refresh while the toggle stays off
 * (GitHub #354: the bar drew only the toggle, so the frozen card showed no frost) — or the toggle itself (a frame without
 * per-slot flags). The 冻结 button and the bar's frame keep following the toggle alone.
 */
export const slotFrozen = (slot, toggle = false) => !!slot?.frozen || !!toggle;

/** The armed (first-tapped) card's confirm strip: 确认购买 / 确认选择, or 无法购买 + why. */
function ArmedTag({ reason, free }) {
  if (reason) return html`<span class="scard__confirm is-no" role="status"><b>${t('无法购买')}</b><small>${reason}</small></span>`;
  return html`<span class="scard__confirm" role="status"><b>${free ? t('确认选择') : t('确认购买')}</b><small>${t('再次点击')}</small></span>`;
}

/**
 * Operator card (shop and merge reward). `armed`: first tap done (second tap = `onBuy(idx)`).
 * @param {{ slot:any, idx:number, priv:any, frozen?:boolean, reason?:string|null, free?:boolean, armed?:boolean,
 *   onTap?:(idx:number)=>void, onBuy:Function, onDetail:Function }} props
 */
export const ChessCard = modComponent('game.shopCard', function ChessCard({ slot, idx, priv, frozen = false, reason = null, free = false, armed = false, onTap = null, onBuy, onDetail, offBonds = null }) {
  // The art manifest is fetched at runtime (and is ~2.3 MB now that the skin tables ride in it): a card built before it
  // settles would keep a null portrait URL and read as a black card forever. Re-render when it arrives.
  useData('assets');
  const c0 = data.lookup('chess', slot.id);
  // 0.2.0 自选编队: a DIY slot the player filled is its operator (shared/diy.js, the pick of m.private.diy)
  const diyData = { chess: data.get('chess'), backups: data.get('backups') };
  const dr = c0 ? ownDiyRecord(c0, priv, diyData) : null;
  // 0.2.0 补位: the player's not-owned chess shows its stand-in (art, name, class, its backup skill); the composed record
  // keeps the chess's identity — tier, bonds, price (a DIY slot is never droppable: one or the other)
  const si = c0 && !dr ? ownStandIn(c0, priv, data.get('backups')) : null;
  const c = dr || si || c0;
  const m = data.get('assets');
  const tier = c?.tier ?? 1;
  const prog = mergeProgress(priv, slot.id, (id) => data.lookup('chess', id));
  const hint = mergeHint(priv, slot.id);
  const willMerge = !!hint;
  const bonds = Array.isArray(c?.bonds) ? c.bonds : [];
  const disabled = !!reason;
  const lo = si ? standInLoadout(si, LOOKUPS.getChess, data.get('backups')) : c ? chessLoadout(c, priv?.loadout, dr ? diyGetter(LOOKUPS.getChess, priv, diyData) : LOOKUPS.getChess, { ops: priv?.ops ?? null, effects: data.get('effects') }) : null;
  const tap = () => { if (onTap) onTap(idx); else if (!disabled) onBuy(idx); else onDetail(slot.id, 'chess', hint); };
  const name = `${c?.name || t('干员')}${si ? t('（{note}）', { note: standInForText(c0.name) }) : ''}`;
  // 卡面引用自诊断 (user report 2026-10-17「部分局内卡面加载不出来」): the black-card case was a card whose record resolved
  // to no portrait at all. Say WHICH record in the console rather than leaving a silent black rectangle behind.
  const artUrl = portraitUrlOf(m, c, { lookup: currentAppearanceLookup() });
  if (!artUrl && c) console.warn('[card] no portrait', slot.id, c.charId || c.assets?.spine, c.assets?.portrait ?? null);
  const card = html`<button type="button" class=${cx('scard', `scard--t${tier}`, frozen && 'is-frozen', disabled && 'is-disabled', willMerge && 'is-merge', armed && 'is-armed', si && 'is-standin')}
      data-shop-slot=${free ? undefined : idx} aria-keyshortcuts=${free ? undefined : hotkeyLabelOf('buy')}
      title=${free || reason ? undefined : t('购买鼠标指向的商品 · {key}', { key: hotkeyLabelOf('buy') })}
      onClick=${tap} onContextMenu=${(e) => { e.preventDefault(); onDetail(slot.id, 'chess', hint); }}
      aria-label=${`${t('{name}，价格 {price}', { name, price: slot.price })}${armed ? (disabled ? t('，无法购买') : t('，再次点击确认')) : ''}`} aria-pressed=${onTap ? String(!!armed) : undefined}>
    <span class="mod-host" data-mod-slot="screen.game.shopCard" data-mod-slot-key=${slot.id}></span>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__water" aria-hidden="true">${bonds[0] ? html`<${BondGlyph} bondId=${bonds[0]} />` : null}</span>
    <${Img} src=${artUrl} class="scard__art" eager=${true} fallback=${html`<span class="scard__artfallback"><${GIcon} name="rook" /></span>`} />
    <span class="scard__top">
      <${TierChip} tier=${tier} size="md" />
      <${PriceHex} slot=${slot} free=${free} poor=${reason === t('资金不足')} />
      ${prog.copies > 0 ? html`<span class="scard__pips" title=${t('已拥有 {copies}/{need}', { copies: prog.copies, need: prog.need })}>
        ${Array.from({ length: prog.need }, (_, i) => html`<i key=${i} class=${i < prog.copies ? 'on' : ''}></i>`)}
      </span>` : null}
    </span>
    ${si ? html`<span class="scard__standin" data-standin=${si.charId} data-for=${c0.chessId} title=${standInTip(si, c0.name)}>${standInLabel(si)}</span>` : null}
    ${dr ? html`<span class="scard__diy" data-diy=${dr.charId} title=${t('自选编队：{name}（只在你的商店出现）', { name: dr.name })}>${t('自选')}</span>` : null}
    <span class="scard__body">
      ${lo?.skill ? html`<${SkillBadge} chess=${c} lo=${lo} standIn=${!!si} />` : null}
      <span class="scard__name">${c?.name || slot.id}</span>
      <span class="scard__bonds">
        ${bonds.slice(0, 3).map((b) => {
          const name = data.lookup('bonds', b)?.name || b;
          const off = !!(offBonds && offBonds.has(b)); // a bond this mode never activates (gameLogic modeOffBonds)
          return html`<span key=${b} class=${cx('scard__bond', off && 'is-off')} title=${off ? briefingBondTip(name, 'off') : undefined}><${BondGlyph} bondId=${b} /><span>${name}</span></span>`;
        })}
      </span>
      <span class="scard__class">
        <${Img} src=${profIconUrl(m, c?.profession)} class="scard__prof" />
        <span>${c?.subProfessionName || ''}</span>
      </span>
    </span>
    ${willMerge ? html`<span class="scard__mergetag" title=${hint}>${t('可晋升')}</span>` : null}
    ${frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${armed ? html`<${ArmedTag} reason=${reason} free=${free} />` : null}
  </button>`;
  return reason && reason !== t('已售出') && !armed ? html`<${Tooltip} text=${reason} block=${true} class="scard-wrap">${card}<//>` : card;
});

/** The loadout's skill (icon; name + 已调配 in the tooltip) and an elite's module type, on an operator card. */
function SkillBadge({ chess, lo, standIn = false }) {
  const m = data.get('assets');
  const custom = !lo.defaultSkill && !standIn;
  // a chosen skill without an icon in the manifest: its slot letter (S1–S3) instead of the blank skill sprite
  const src = custom ? skillRecordIconUrl(m, lo.skill, { empty: false }) : skillIconUrl(m, chess);
  const slot = Number.isInteger(lo.skill.index) ? `S${lo.skill.index + 1}` : null;
  const mod = lo.module && !lo.module.none ? lo.module : null;
  const tip = `${slot ? t('技能 {slot}：{name}', { slot, name: lo.skill.name || '' }) : t('技能：{name}', { name: lo.skill.name || '' })}${custom ? t('（已调配）') : ''}${mod ? t(' · 模组：{name}', { name: mod.name }) : lo.module?.none ? t(' · 未装备模组') : ''}`;
  return html`<span class=${cx('scard__skill', custom && 'is-custom')} title=${tip} aria-label=${tip} data-skill=${lo.skill.skillId || ''}>
    <${Img} src=${src} fallback=${slot ? html`<span class="scard__sglyph num">${slot}</span>` : html`<${GIcon} name="bolt" />`} />
    ${mod && mod.typeName ? html`<span class="scard__mod" data-type=${mod.typeName}><${Img} src=${moduleTypeIconUrl(data.get('local'), mod.typeName)} class="scard__modicon" />${mod.typeName}</span>` : null}
  </span>`;
}

/**
 * 投放数量的上限（怪物卡池，2026-11-04）：`min(20, 库存 left, floor(本回合剩余预算 / 单价))` —— 与服务端的夹紧**同源**
 * （server/match/monsterShop.js `placeMonster`：`Math.min(20, pool.left(key), Math.max(0, affordable), want)`，
 * `affordable = price > 0 ? Math.floor(left / price) : 0`）。所以这里算出来的就是服务端会接受的最大只数；
 * 返回 0 ⇒ 一只都投不了（卡面按 is-disabled 画）。
 * @param {{ price?:number, left?:number }} slot 私有帧 `m.monsterShop.slots[i]`
 * @param {number} budget 本回合剩余预算（`m.monsterShop.left`）
 * @returns {number}
 */
export function monsterPlaceCap(slot, budget) {
  const price = Math.max(0, Number(slot?.price) || 0);
  const stock = Math.max(0, Number(slot?.left) || 0);
  const rest = Math.max(0, Number(budget) || 0);
  const affordable = price > 0 ? Math.floor(rest / price) : 0;
  return Math.max(0, Math.min(20, stock, affordable));
}

/**
 * 门的行判据（**客户端拖拽口径**，2026-11-06 修正）：落点只能取战场门 —— `GEO.FIELD` = rows 9–12 / cols 2–10
 * （shared/constants.js:139），路线的起点是 (12,10)=上、(9,10)=下。**投放门区上下各半**：rows 9–10 = lower，
 * rows 11–12 = upper ⇒ 分界 = row 10.5 ⇔ `GATE_SPLIT = GEO.FIELD.r0 + 2`（= 11）。
 * 为什么不是 `GEO.FIELD.r1`（= 12，2026-11-06 之前就是它）：四行的战场里只有最上面一行算上门 ⇒ 上门只占画面
 * 高度的 1/4，拖到「上半区」四分之三都会变成下门（业主报障「上门/下门体感没生效」，判门区 1:3）。
 * **这只决定「玩家把卡投给哪个门」**：服务端 `waves.js` 的 `gateOf` 仍是「起点行 ≥ 12 = upper」，合成路线也仍从
 * 上门的门格 (12,10) / 下门的门格 (9,10) 出发 —— 玩家拖到上半区（rows 11–12）表示「投上门」，敌人照样从 (12,10)
 * 出来。两套判据口径不同、互不冲突：**不要**把这里改回 12。
 * row 落在 9–12 以外不是门 ⇒ 返回 null（取消投放）。
 */
const GATE_SPLIT = GEO.FIELD.r0 + 2;
/** 拖拽的位移阈值（px）：超过它就从「按下」变成「拖」。与 longPress 的默认 cancelPx 同值 —— 拖拽和长按互斥。 */
const MON_DRAG_PX = 8;

/**
 * The gate a BOARD row belongs to, or null when it belongs to no gate at all (a drop there cancels).
 * @param {number} row board row (render/app.js tileAtClientPoint → pickBoardTile → prepXf.toBoard)
 * @returns {'upper'|'lower'|null}
 */
export function monsterGateOf(row) {
  if (!Number.isInteger(row) || row < GEO.FIELD.r0 || row > GEO.FIELD.r1) return null;
  return row >= GATE_SPLIT ? 'upper' : 'lower';
}

/** The engine view behind the guarded one (ui/fieldHost.js guardView keeps it as `raw`; facingWheel's rawOf does the same). */
const rawViewOf = (view) => (view && view.raw) || view || null;

/**
 * The board tile under a client point, through the render API `tileAtClientPoint` (render/app.js). The guarded view only
 * forwards the methods ui/fieldHost.js lists in METHODS / OPTIONAL, and `tileAtClientPoint` is not on that list yet — so
 * this goes through `raw`, the same route facingWheel.js takes for tile geometry. A view without the method (the DOM
 * fallback field) answers null: 拖拽投放 needs the engine, 点一下 / 多选 do not.
 * @returns {{ row:number, col:number } | null}
 */
function tileUnderPoint(view, clientX, clientY) {
  const raw = rawViewOf(view);
  const fn = raw && raw.tileAtClientPoint;
  if (typeof fn !== 'function') return null;
  try {
    const tile = fn.call(raw, clientX, clientY);
    return tile && Number.isInteger(tile.row) && Number.isInteger(tile.col) ? tile : null;
  } catch { return null; }
}

/**
 * 落点**兜底**判门（纯函数，客户端 px）：`render/app.js` 的 `tileAtClientPoint` 先要求
 * `document.elementFromPoint(clientX, clientY) === canvas`（plugins/mota/client/js/render/app.js:2272-2275）——
 * 拖拽时只要有覆盖层压住画布（HUD / 状态条 / 别的面板），它就拿不到 tile ⇒ endPress 判「不是门」⇒ **静默取消投放**。
 * 这里改用投影几何兜底：平面投影把直线映成直线 ⇒ 门区 rows 9–12 × cols 2–10 的投影是一个凸四边形，
 * rows 10 与 11 之间（row GATE_SPLIT − ½）那条分界线也是一条直线段。判据 = 点在四边形内 + 落在分界线的哪一侧。
 * 出界（不在门区）⇒ null，与「点不到门格」同一个结果（仍是取消）。
 * @param {Array<Array<number>>} quad 四角，按 board 坐标顺时针：(小 row, 小 col) → (小 row, 大 col) → (大 row, 大 col) → (大 row, 小 col)
 * @param {Array<Array<number>>} split 分界线两端 [小 col 端, 大 col 端]（row = GATE_SPLIT − ½）
 * @param {number} x @param {number} y
 * @returns {'upper'|'lower'|null}
 */
export function gateFromQuad(quad, split, x, y) {
  if (!Array.isArray(quad) || quad.length !== 4 || !Array.isArray(split) || split.length !== 2) return null;
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
  // 四边形的绕向（最终攻势的镜像半场会把 x 翻过来）。sgn 与下面那一次 cross 同时变号 ⇒ 乘积不变，判据仍成立。
  const sgn = cross(quad[0], quad[1], quad[2]) > 0 ? 1 : -1;
  for (let i = 0; i < 4; i++) {
    if (sgn * cross(quad[i], quad[(i + 1) % 4], [x, y]) < 0) return null;   // 某条边外侧 ⇒ 不在门区
  }
  // 同一行在不同列上的屏幕 y 不一定相同（斜投影 / 相机有滚转时）⇒ 不能只比 y：判点落在分界线的哪一侧。
  // 分切线 A→B 与四边形的绕向由同一个 board→screen 投影决定（世界：x = col、y = row，row 0 最近相机）⇒
  // 两者同时随「镜像 / 翻转」变号、乘积不变；符号按实际投影取（行号越大 → 屏幕 y 越小 ⇒ rows 11–12 在
  // sgn·cross > 0 的一侧，这就是行号大的一侧）。
  return sgn * cross(split[0], split[1], [x, y]) > 0 ? 'upper' : 'lower';
}

/**
 * 拖拽落点兜底用的屏幕几何（**不改渲染层**）：只用 `facingWheel` 的 `tileScreen`（与半区高亮同一套 cam.project），
 * 不调用任何命中测试 ⇒ 覆盖层压住画布时照样拿得到。一次 rAF 里取 6 个角点：门区四角（rows 9–12 × cols 2–10）+
 * 分界线两端（row GATE_SPLIT − ½ = 10.5）。跟镜头走的方式与 useTileScreen 相同（每帧重投影，值变了才 setState；
 * 不为此另开 6 个 useTileScreen）。
 * 任何一格投影不出来（例如最终攻势把该格投到画面外 ⇒ tileScreen 返回 null）⇒ 整个兜底关掉（null），行为回到改造前。
 * @param {any} view @param {boolean} enabled
 * @returns {{ quad: Array<Array<number>>, split: Array<Array<number>> } | null}
 */
function useGateQuad(view, enabled) {
  const [geo, setGeo] = useState(null);
  const last = useRef('');
  useEffect(() => {
    let raf = 0;
    let alive = true;
    if (!view || !enabled) { last.current = ''; setGeo(null); return undefined; }
    // 格子的四角：poly = [(row+½,col−½), (row+½,col+½), (row−½,col+½), (row−½,col−½)]
    const corner = (row, col, i) => {
      const p = tileScreen(view, row, col)?.poly?.[i];
      return Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : null;
    };
    const tick = () => {
      if (!alive) return;
      const quad = [
        corner(GEO.FIELD.r0, GEO.FIELD.c0, 3),   // (row 8.5, col 1.5)   —— board 小 row / 小 col
        corner(GEO.FIELD.r0, GEO.FIELD.c1, 2),   // (row 8.5, col 10.5)  —— board 小 row / 大 col
        corner(GEO.FIELD.r1, GEO.FIELD.c1, 1),   // (row 12.5, col 10.5) —— board 大 row / 大 col
        corner(GEO.FIELD.r1, GEO.FIELD.c0, 0),   // (row 12.5, col 1.5)  —— board 大 row / 小 col
      ];
      const split = [
        corner(GATE_SPLIT, GEO.FIELD.c0, 3),     // (row 10.5, col 1.5)
        corner(GATE_SPLIT, GEO.FIELD.c1, 2),     // (row 10.5, col 10.5)
      ];
      const next = quad.every(Boolean) && split.every(Boolean) ? { quad, split } : null;
      const key = next ? next.quad.flat().concat(next.split.flat()).map((n) => n.toFixed(1)).join(',') : '';
      if (key !== last.current) { last.current = key; setGeo(next); }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => { alive = false; cancelAnimationFrame(raf); };
  }, [view, enabled]);
  return geo;
}

/**
 * 半区高亮的四角（客户端 px）：从门格 `useTileScreen` 的四角外推整个半区。tileScreen 的 poly 是
 * `[(row+½,col−½), (row+½,col+½), (row−½,col+½), (row−½,col−½)]` ⇒ 「向 −row 一格」= p2−p1、「向 −col 一格」= p0−p1。
 * 上门 = rows 11–12（2 行；门格 (12,10) 是它的右下角），下门 = rows 9–10（门格 (9,10) 是它的右上角）；列一律 2–10。
 * 分界与判门同一个常量 GATE_SPLIT（= 11，即 rows 10 与 11 之间）⇒ 高亮哪一半与拖上去判成哪个门永远一致。
 * （服务端从哪个门格出敌人是另一回事：见上面 GATE_SPLIT 的注释。高亮随分界自动变成上门 2 行 / 下门 2 行。）
 * @param {Array<[number,number]>|null} poly the gate tile's poly
 * @param {'upper'|'lower'} gate
 * @returns {Array<[number,number]>|null} 4 points, or null without geometry
 */
function halfRegionPoly(poly, gate) {
  if (!Array.isArray(poly) || poly.length < 4) return null;
  const [p0, p1, p2] = poly;
  const dRow = [p2[0] - p1[0], p2[1] - p1[1]];   // one row towards −row
  const dCol = [p0[0] - p1[0], p0[1] - p1[1]];   // one column towards −col
  const at = (fr, fc) => [p1[0] + dRow[0] * fr + dCol[0] * fc, p1[1] + dRow[1] * fr + dCol[1] * fc];
  const gateRow = gate === 'upper' ? GEO.FIELD.r1 : GEO.FIELD.r0;
  const hiRow = gate === 'upper' ? GEO.FIELD.r1 : GATE_SPLIT - 1;
  const loRow = gate === 'upper' ? GATE_SPLIT : GEO.FIELD.r0;
  const fr0 = gateRow - hiRow;                       // upper 0 / lower −1（门格相对半区上沿）
  const fr1 = gateRow - loRow + 1;                   // upper 2 / lower 1
  const fc1 = GEO.FIELD.c1 - GEO.FIELD.c0 + 1;       // 9 columns
  const pts = [at(fr0, 0), at(fr1, 0), at(fr1, fc1), at(fr0, fc1)];
  return pts.every((p) => Number.isFinite(p[0]) && Number.isFinite(p[1])) ? pts : null;
}

/**
 * 怪物卡（对抗·攻方商店，2026-11-04；交互按业主 2026-11-04 的裁决重做）：外壳照 `ChessCard` —— 同一套 `.scard` +
 * `scard--t<tier>`（测试按 `.shopbar__cards .scard` 选卡，CSS 的边框 / 悬停 / 冻结 / 已售一套全部复用），卡面换成怪物：
 * 图标 `enemyIconUrl`、名称、阶、单价、库存 `left/cap`，以及**怪物盟约徽标**（`slot.bond = { id, name }`，业主
 * 2026-11-04：卡片要显示名称与羁绊；帧里没有该键就不渲染，老卡面不变）。
 * 三条路径，都不经过任何「先选门 → 再确认」的浮层：
 *   点一下       → `onTap`（ShopBar：投 1 只到上一次成功投放的门）
 *   长按 ≥550ms  → `onHold`（进多选态；这一下不算点击 —— longPress 的 heldClick 吞掉随后的 click）
 *   按住并移动   → 拖拽（`onPointerDown/Move/Up` 由 ShopBar 接管：折叠商店条、换镜头、跟随的 ghost、落点判门）
 * 右键仍是冻结。
 * @param {{ slot:any, idx:number, multi?:boolean, picked?:boolean, dragging?:boolean, frozen?:boolean, poor?:boolean,
 *   onTap:(slot:any)=>void, onFreeze:(slot:any)=>void, onHold?:(slot:any)=>void,
 *   onPointerDown?:(e:any, slot:any)=>void, onPointerMove?:(e:any)=>void,
 *   onPointerUp?:(e:any, cancel?:boolean)=>void, onPointerCancel?:(e:any, cancel?:boolean)=>void }} props
 *   multi / picked: 多选态开着 / 这一格被选中（CSS 的 is-multi / is-picked）
 */
export function MonsterCard({ slot, idx, multi = false, picked = false, dragging = false, frozen = false, poor = false,
  onTap, onFreeze, onHold = null, onPointerDown = null, onPointerMove = null, onPointerUp = null, onPointerCancel = null }) {
  // 与 ChessCard 同一个理由：图标表随 assets 清单在运行时到货，早画的卡会永远停在空图标上
  useData('assets');
  const m = data.get('assets');
  const tier = Number(slot?.tier) || 1;
  const price = Math.max(0, Number(slot?.price) || 0);
  const left = Math.max(0, Number(slot?.left) || 0);
  const cap = Math.max(0, Number(slot?.cap) || 0);
  const name = slot?.name || slot?.key || '';
  // 怪物盟约徽标（业主 2026-11-04）：服务端帧 `m.monsterShop.slots[].bond = { id, name }`（monsterShop.js
  // monsterShopFrame）；没有该键（老帧 / 这怪不属于任何类型条）⇒ null，卡面与改造前逐字节相同
  const bond = slot && slot.bond && typeof slot.bond.name === 'string' && slot.bond.name ? slot.bond : null;
  const stock = `${left}/${cap}`;
  // 卡面图标：图标表随 assets 清单在运行时到货（上面的 useData），key 在清单里没有图标 / 文件 404 时都要有东西可看。
  // `enemyIconUrl` 拿不到 URL（清单未到货、该 key 没有 icon）时返回 null ⇒ <Img> 直接画 fallback；404 由 <Img> 的
  // onError 换同一个 fallback。占位骷髅的尺寸写在 css 里是**显式 rem**（不是百分比）—— 2026-11-04 视觉验收第 1 条
  // 的空白卡面，占位节点当年只靠 1em 的淡色 glyph，等同于没画。
  const iconUrl = enemyIconUrl(m, slot?.key);
  // 长按：计时（HOLD_MS 550）与「位移 >8px 取消」都在 longPress.js；这里只注入「进多选态」这一个动作（不再弹注释）。
  const hold = longPress(null, { onHold: () => { if (onHold) onHold(slot); } });
  const pointerDown = (e) => { if (onPointerDown) onPointerDown(e, slot); hold.onPointerDown(e); };
  const pointerMove = (e) => { if (onPointerMove) onPointerMove(e); hold.onPointerMove(e); };
  const pointerUp = (e) => { if (onPointerUp) onPointerUp(e, false); hold.onPointerUp(e); };
  const pointerCancel = (e) => { if (onPointerCancel) onPointerCancel(e, true); hold.onPointerCancel(e); };
  return html`<button type="button" class=${cx('scard', `scard--t${tier}`, 'scard--monster', frozen && 'is-frozen',
      multi && 'is-multi', picked && 'is-picked', dragging && 'is-dragging', poor && 'is-disabled')}
      data-shop-slot=${idx} data-monster-key=${slot?.key}
      title=${multi
        ? t('{name}：点一下选中 / 取消，拖到上门或下门投放', { name })
        : t('{name}：点一下投 1 只，长按多选，右键冻结这一格', { name })}
      onPointerDown=${pointerDown} onPointerMove=${pointerMove} onPointerUp=${pointerUp} onPointerCancel=${pointerCancel}
      onPointerLeave=${hold.onPointerLeave}
      onClick=${(e) => { if (heldClick(e)) return; onTap(slot); }}
      onContextMenu=${(e) => { e.preventDefault(); onFreeze(slot); }}
      aria-label=${t('{name}，价格 {price}，库存 {left}/{cap}', { name, price, left, cap })} aria-pressed=${String(!!picked)}>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__top">
      <${TierChip} tier=${tier} size="md" />
      <${HexBadge} value=${price} tone=${poor ? 'dark' : 'gold'} size="md" class=${cx('scard__price', poor && 'is-poor')} title=${t('价格')} />
    </span>
    <span class="scard__art" aria-hidden="true"><${Img} src=${iconUrl} class="scard__monicon" eager=${true} fallback=${html`<span class="scard__artfallback"><${GIcon} name="skull" /></span>`} /></span>
    <span class="scard__body">
      <span class="scard__name">${name}</span>
      <span class="scard__class"><span>T${tier}</span>
        ${bond ? html`<span class="scard__bond scard__mbond" data-bond=${bond.id} title=${t('怪物盟约：{name}', { name: bond.name })}>${bond.name}</span>` : null}
      </span>
    </span>
    <span class="scard__stock">${stock}</span>
    ${frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${picked ? html`<span class="scard__pickednum num" aria-hidden="true">${t('已选')}</span>` : null}
  </button>`;
}

/**
 * 怪物模式里没发到牌的格子（2026-11-04 视觉验收第 2 条）：`dealSlots` 池里没货时把这一格置 null，旧实现沿用
 * 干员栏的 EmptyCard —— 它带着 `scard--sold`，斜纹 + 居中排布与「已售罄」几乎一样，看起来像「买完了」。
 * 这里不套 `scard--sold`：独立的 `scard--monster-empty` 画成虚线空框 + 淡色破折号（css/screens/game-shop.css），
 * 与 SoldCard 的斜纹 / SOLD OUT 明确分开；不带 data-shop-slot，不参与双点购买。
 */
function MonsterEmptyCard() {
  return html`<div class="scard scard--monster-empty" role="img" aria-label=${t('空栏位：本回合没有这种怪可投放')}
    title=${t('空栏位：本回合没有这种怪可投放')}><span class="scard--monster-empty__dash" aria-hidden="true">—</span></div>`;
}

/**
 * Item card (the bar's item slot): the same two taps as an operator card.
 * @param {{ slot:any, idx:number, frozen?:boolean, reason?:string|null, armed?:boolean, onTap?:(idx:number)=>void,
 *   onBuy:Function, onDetail:Function }} props
 */
export function ItemCard({ slot, idx, frozen = false, reason = null, free = false, armed = false, onTap = null, onBuy, onDetail }) {
  const it = data.lookup('items', slot.id);
  const m = data.get('assets');
  const disabled = !!reason;
  const tap = () => { if (onTap) onTap(idx); else if (!disabled) onBuy(idx); else onDetail(slot.id, 'item'); };
  const card = html`<button type="button" class=${cx('scard', 'scard--item', frozen && 'is-frozen', disabled && 'is-disabled', armed && 'is-armed')}
      data-shop-slot=${free ? undefined : idx} aria-keyshortcuts=${free ? undefined : hotkeyLabelOf('buy')}
      title=${free || reason ? undefined : t('购买鼠标指向的商品 · {key}', { key: hotkeyLabelOf('buy') })}
      onClick=${tap} onContextMenu=${(e) => { e.preventDefault(); onDetail(slot.id, 'item'); }}
      aria-label=${`${t('{name}，价格 {price}', { name: it?.name || t('装备'), price: slot.price })}${armed ? (disabled ? t('，无法购买') : t('，再次点击确认')) : ''}`}
      aria-pressed=${onTap ? String(!!armed) : undefined}>
    <span class="scard__bg" aria-hidden="true"></span>
    <span class="scard__top">
      <${TierChip} tier=${it?.tier ?? 1} size="md" />
      <${PriceHex} slot=${slot} free=${free} poor=${reason === t('资金不足')} />
    </span>
    <span class="scard__itemart"><${Img} src=${itemIconUrl(m, it)} fallback=${html`<${GIcon} name="bolt" />`} /></span>
    <span class="scard__body">
      <span class="scard__name">${it?.name || slot.id}</span>
      <span class="scard__idesc"><${RichText} text=${it?.descRaw || it?.desc || ''} /></span>
    </span>
    ${frozen ? html`<span class="scard__ice" aria-hidden="true"><${Icon} name="snow" /></span>` : null}
    ${armed ? html`<${ArmedTag} reason=${reason} free=${free} />` : null}
  </button>`;
  return reason && reason !== t('已售出') && !armed ? html`<${Tooltip} text=${reason} block=${true} class="scard-wrap">${card}<//>` : card;
}

function SoldCard({ item = false }) {
  return html`<div class=${cx('scard', 'scard--sold', item && 'scard--item')} aria-label=${t('已售出')}>
    <span class="scard__soldtxt"><${MicroLabel}>SOLD OUT</${MicroLabel}><span>${item ? t('已购买') : t('已招募')}</span></span>
  </div>`;
}

/**
 * A slot with no card in it: the one a 调度中心 upgrade has just opened (a `null` slot — server/match/player/economy.js
 * _openLevelSlots; GitHub #332 / PR #333: the official shop shows the new slot, empty, until the next refresh or round
 * start fills it). Never 已招募 / SOLD OUT: nothing was bought there.
 */
function EmptyCard({ item = false }) {
  // `scard--sold` too: the same inert frame (no hover lift, not a buyable card for every `:not(.scard--sold)` rule); `scard--empty` only restyles it
  return html`<div class=${cx('scard', 'scard--sold', 'scard--empty', item && 'scard--item')} role="img" aria-label=${t('空栏位：刷新或下回合开始时补满')}
    title=${t('空栏位：刷新或下回合开始时补满')}></div>`;
}

function LevelCard({ shop, reason, armed = false, onTap, monster = false }) {
  const lv = shop?.level ?? 1;
  const max = lv >= (shop?.maxLevel ?? 6);
  const price = shop?.upgradePrice ?? 0;
  // 满级**不是**「不可用」，价签不该被压暗（2026-11-06）：这里原先只认干员那条满级文案，怪物卡池满级时 reason 是
  // `怪物卡池已达最高等级` ⇒ 比对不上、价签被画成 dark。两条满级文案都算满级（满级时价签本来就不画，
  // 这条只对「level 与 maxLevel 在某一帧不一致」的瞬间有意义）。
  const maxed = !!reason && (reason === t('调度中心已达最高等级') || reason === t('怪物卡池已达最高等级'));
  // 怪物卡池（2026-11-04「参考卫戍协议干员商店」）：同一张 .lvcard、同一个两击确认，只有文案与修饰类不同
  const idleTitle = monster
    ? t('升级怪物卡池（{price} 资金） · {key}', { price, key: hotkeyLabelOf('levelUp') })
    : t('升级调度中心（{price} 资金） · {key}', { price, key: hotkeyLabelOf('levelUp') });
  return html`<button type="button" class=${cx('lvcard', monster && 'lvcard--monster', max && 'is-max', reason && 'is-disabled', armed && 'is-armed')} onClick=${() => !reason && onTap()}
      title=${reason || (armed ? t('再次点击确认升级（{price} 资金）', { price }) : idleTitle)} aria-disabled=${reason ? 'true' : 'false'}
      aria-pressed=${String(!!armed)}>
    ${!max ? html`<${HexBadge} value=${price} tone=${reason && !maxed ? 'dark' : 'gold'} size="md" class="lvcard__price" />` : null}
    <span class="lvcard__frame">
      <span class="lvcard__micro">${t('等级')}</span>
      <b class="lvcard__num num">${lv}</b>
    </span>
    <span class="lvcard__label">${max ? t('已满级') : armed ? t('确认升级') : t('升级')}</span>
    <kbd class="lvcard__key">${hotkeyLabelOf('levelUp')}</kbd>
  </button>`;
}

/** Key of an armed shop card: kind + slot index + the id it showed (a reroll / sale changes it ⇒ disarm). */
export const armKey = (kind, idx, slot) => `${kind}:${idx}:${slot?.id ?? ''}`;

/**
 * The slot an armed key names (`c` / `i` shop slots, `r` reward slots), or null (a level card, nothing armed, a stale key).
 * @param {string|null} key
 * @param {any[]} slots the shop's slots
 * @param {any[]|null} rewardSlots the shown reward offer's slots
 */
export function armedSlotOf(key, slots, rewardSlots = null) {
  const m = typeof key === 'string' ? /^([cir]):(\d+):(.*)$/.exec(key) : null;
  if (!m) return null;
  const list = m[1] === 'r' ? rewardSlots : slots;
  const s = Array.isArray(list) ? list[Number(m[2])] : null;
  return s && !s.sold && s.id === m[3] ? s : null;
}

/**
 * Two-tap state of the bar (first tap arms, second confirms). Disarms on a tap outside the shop / detail panel, on
 * Escape, when the armed card changes or disappears, and when the bar stops being editable.
 * @param {{ editable: boolean, keys: Set<string> }} o the keys that are currently valid
 */
export function useTwoTap({ editable, keys }) {
  const [armed, setArmed] = useState(null);
  const valid = armed == null || (editable && keys.has(armed));
  useEffect(() => { if (!valid) setArmed(null); }, [valid]);
  useEffect(() => {
    if (armed == null) return undefined;
    const onDown = (e) => {
      const t = e.target;
      if (t && t.closest && t.closest('.scard, .lvcard, .dpanel, .modal')) return;
      setArmed(null);
    };
    const onKey = (e) => { if (e.key === 'Escape') setArmed(null); };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('pointerdown', onDown, true); window.removeEventListener('keydown', onKey); };
  }, [armed]);
  return [valid ? armed : null, setArmed];
}

/**
 * A free pick-one offer in place of the bar's operator cards (pick 1 — g.reward idx — or put it off: 稍后选择 → the
 * normal shop + a reminder pill): the promotion reward (research 00 §3: 3 free operators of tier min(level+1, 6)) and
 * the special refreshes of strategies, items and 特质 — e.g. 凯瑟琳 【定向投放】 "在调度中心刷新随机3件装备，可以选择并获得
 * 其中1件". Each slot is drawn by its kind: an item slot is an item card (icon, name, tier, description, FREE) — player
 * report #6 after 0.1.0, the items used to be drawn as nameless operator cards — and the header names the offer
 * (gameLogic.offerHeader: 晋升奖励 / the strategy's effect name …; "之后还有 N 项" while more offers wait behind it).
 */
export function RewardCards({ offer, priv, editable, onPick, onDetail, onLater, armed, onTap, offBonds = null }) {
  const head = offerHeader(offer);
  return html`<div class=${cx('shopbar__reward', head.items && 'is-items')} role="group" aria-label=${head.title}>
    <div class="rwtag">
      <${Icon} name=${head.icon} class="rwtag__icon" />
      <b class="rwtag__title">${head.title}</b>
      <span class="rwtag__micro">${head.micro}</span>
      <span class="rwtag__sub">${head.sub}</span>
      ${head.more ? html`<span class="rwtag__sub rwtag__more">${head.more}</span>` : null}
      <button type="button" class="rwtag__later" onClick=${onLater} title=${t('稍后选择（回合结束后消失）')}><${Icon} name="minus" />${t('稍后')}</button>
    </div>
    <div class="shopbar__rwcards">
      ${offer.slots.map((s, i) => {
        if (!s || s.sold) return html`<div key=${`rw${i}`} class=${cx('scard', 'scard--sold', s && s.kind === 'item' && 'scard--item')}><span class="scard__soldtxt"><span>${t('已选择')}</span></span></div>`;
        const kind = s.kind === 'item' ? 'item' : 'chess';
        const reason = shopBlockReason('reward', { priv, editable, slot: s, ...LOOKUPS });
        const props = { slot: { ...s, price: 0 }, idx: i, free: true, reason, armed: armed === armKey('r', i, s), onBuy: onPick, onDetail,
          onTap: (idx) => onTap('r', idx, s, kind, reason, onPick) };
        return kind === 'item' ? html`<${ItemCard} key=${`rw${i}:${s.id}`} ...${props} />` : html`<${ChessCard} key=${`rw${i}:${s.id}`} priv=${priv} offBonds=${offBonds} ...${props} />`;
      })}
    </div>
  </div>`;
}

/**
 * 协同经济 (DESIGN §27): the rest of the team economy in the shop bar — the reserve and the logistics projects (tap to
 * buy), which only appear when a server turns the full rule set on. The 借钱 plate that the co-op mode uses is NOT
 * here: it is the mode's one control and has its own HUD spot (public/js/ui/borrowPlate.js, mounted by screens/game.js
 * as `.gm__borrow`). A plain component (no hooks) so test/ui runs it directly.
 * @param {{ econ:any, editable:boolean, onRefuse?:(why:string)=>void }} props
 */
export function EconStrip({ econ, editable, onRefuse = null, onOpenShop = null }) {
  const projects = !econ.borrowOnly && econ.projects.length ? econ.projects : null;
  if (econ.borrowOnly || (!projects && econ.reserve == null)) return null;
  // 点不动也要有句人话 (user report 2026-10-17: 「应急存储后勤调度这些按钮依旧点不了（无反应）」): a disabled button
  // swallows the tap and says nothing. These stay pressable, every refusal names its reason, and a held press shows what
  // the level actually does (longPress.js).
  const refuse = (why) => { if (onRefuse) onRefuse(why); };
  // 商店设施三项（业主 2026-10-30「升级项搬到商店」）：now/next 现在是**级数**，文案按 id 出
  const projectWhat = (p, n) => (p.id === 'shopLevel'
    ? t('商店等级 +{n}', { n })
    : p.id === 'teamIncome'
      ? t('每回合协同资金上限 +{n}', { n })
      : p.id === 'equipCost'
        ? t('装备价格 −{n}', { n })
        : t('+{n}', { n }));
  const projectNote = (p) => {
    const head = t('{name} Lv{level}：{what}', { name: t(p.name), level: p.level, what: projectWhat(p, p.now) });
    if (p.maxed || p.next == null) return `${head}\n${t('已满级')}`;
    return `${head}\n${t('升级到 Lv{lv}：{what} · 花费 {cost} 协同资金（点击立即升级，全队共享）', {
      lv: p.level + 1, what: projectWhat(p, p.next), cost: p.cost,
    })}`;
  };
  const reliefNote = () => (econ.relief ? t('告急救济：全队生命值最低且 ≤ {threshold} 时可领 {amount} 资金（本回合全队还可领 {left} 次）', {
    threshold: econ.relief.threshold, amount: econ.relief.amount, left: econ.relief.teamLeft,
  }) : '');
  const reliefHold = longPress(reliefNote);
  return html`<div class="econbar" role="group" aria-label=${t('协同经济')}>
    <span class="econbar__res econbar__mine" data-testid="reserves"
      title=${t('团队储备：防守奖励与主动存入攒起来的全队共用资金，用来买商店升级、借款垫付、告急救济与救援')}>
      <b class="num" data-testid="team-reserve">${econ.reserve || 0}</b>
      <span class="econbar__micro">${t('团队储备')}</span>
    </span>
    ${onOpenShop
      ? html`<button type="button" class="econbar__res econbar__shop" data-testid="open-melt-shop"
          title=${t('熔毁商店：卖装备，四栏各限购一件，可用团队储备或本回合资金付款，或换成敌人属性代价')}
          onClick=${() => { onOpenShop(); }}>
          <${CoinGlyph} class="econbar__coin" /><span class="econbar__micro">${t('商店')}</span>
        </button>`
      : null}
    ${projects ? html`<span class="econbar__projects">
      ${projects.map((p) => {
        const hold = longPress(() => projectNote(p));
        return html`<button key=${p.id} type="button" class=${cx('econbar__proj', p.maxed && 'is-max', !p.maxed && !p.affordable && 'is-poor')}
          title=${p.maxed ? t('{name} 已满级', { name: t(p.name) }) : !p.affordable ? t('{name} Lv{level} → Lv{2} · 还差 {n} 协同资金', { name: t(p.name), level: p.level, 2: p.level + 1, n: Math.max(1, p.cost - econ.reserve) }) : t('{name} Lv{level} → Lv{2} · {cost} 协同资金（点击立即升级，全队共享）', { name: t(p.name), level: p.level, 2: p.level + 1, cost: p.cost })}
          onPointerDown=${hold.onPointerDown} onPointerUp=${hold.onPointerUp}
          onPointerLeave=${hold.onPointerLeave} onPointerCancel=${hold.onPointerCancel}
          onClick=${(e) => {
            if (heldClick(e)) return;
            if (p.maxed) return refuse(t('{name} 已满级', { name: t(p.name) }));
            if (!editable) return refuse(t('休整期才能升级'));
            if (!p.affordable) return refuse(t('协同资金不足：还差 {n}', { n: Math.max(1, p.cost - econ.reserve) }));
            actions.econProject(p.id);
          }}>${t(p.name)}<b class="num">${p.maxed ? 'MAX' : `Lv${p.level}`}</b>${p.maxed ? null : html`<span class="num">${p.cost}</span>`}</button>`;
      })}
    </span>` : null}
    ${econ.vote ? html`<span class="econbar__vote" role="group" aria-label=${t('升级提案')}>
      <span class="econbar__vote-label" title=${t('{name} 提议把 {proj} 升到 Lv{level}，花费 {cost} 协同资金', { name: econ.vote.byName, proj: t(econ.vote.name), level: econ.vote.level + 1, cost: econ.vote.cost })}>${t('{name} 提议升 {proj}', { name: econ.vote.byName, proj: t(econ.vote.name) })}<b class="num">${econ.vote.cost}</b></span>
      <button type="button" class="econbar__vote-btn is-ok" disabled=${!editable}
        onClick=${() => actions.econVote(econ.vote.id, true)}>${t('同意')}</button>
      <button type="button" class="econbar__vote-btn" disabled=${!editable}
        onClick=${() => actions.econVote(econ.vote.id, false)}>${t('拒绝')}</button>
    </span>` : null}
    ${econ.relief ? html`<button type="button" class=${cx('econbar__relief', !econ.relief.eligible && 'is-off')}
      title=${t('告急救济：全队生命值最低且 ≤ {threshold} 时可领 {amount} 资金（本回合还可领 {left} 次）', { threshold: econ.relief.threshold, amount: econ.relief.amount, left: econ.relief.left })}
      onPointerDown=${reliefHold.onPointerDown} onPointerUp=${reliefHold.onPointerUp}
      onPointerLeave=${reliefHold.onPointerLeave} onPointerCancel=${reliefHold.onPointerCancel}
      onClick=${(e) => {
        if (heldClick(e)) return;
        if (!editable) return refuse(t('休整期才能领取救济'));
        if (!econ.relief.eligible) return refuse(t('告急救济只在生命值最低且 ≤ {threshold} 时可领', { threshold: econ.relief.threshold }));
        if (econ.relief.teamLeft <= 0) return refuse(t('本回合全队的救济次数已用完'));
        actions.econRelief();
      }}>${t('领取救济')}<b class="num">${econ.relief.amount}</b></button>` : null}
    ${econ.deposit ? html`<button type="button" class=${cx('econbar__relief', !econ.deposit.can && 'is-off')}
      title=${econ.deposit.done ? t('本回合已经存入过协同资金（每人每回合最多 1 次）') : t('把本回合 1 点资金存入协同资金（每人每回合最多 1 次）')}
      onClick=${() => {
        if (!editable) return refuse(t('休整期才能存入协同资金'));
        if (econ.deposit.done) return refuse(t('本回合已经存入过协同资金'));
        if (!econ.deposit.can) return refuse(t('当前无法存入（资金不足，或已经准备就绪）'));
        actions.econDeposit();
      }}>${t('存入协同资金')}<b class="num">1</b></button>` : null}
  </div>`;
}

/**
 * 怪物盟约条（2026-11-04 业主口径：**攻方只有怪物方的独立盟约**，没有干员盟约）。
 *
 * 数据 = 私有帧 `m.monsterShop.bonds`（server/match/monsterBonds.js monsterBondView）：`[{ id, name, layers, tier,
 * active, icon?|glyph? }]`，空时服务端整个键都不发。观感复用干员盟约条的 `.bstrip` / `.bslot`（screens/game.css），
 * 这里只补 `.mbond*` 的怪物侧配色与层数角标 —— 所以老的网格 / 折叠 / 指针规则一行都不用改。
 *
 * 图标（2026-11-05，此前每条都画同一个骷髅）：`b.icon`（14 个有官方 campLogo 的阵营，绝对 URL）→ 画
 * `<img class="mbond__img">`，加载失败由 Img 的 fallback 回落到内联字形；否则 `b.glyph` 命中本模块顶部的
 * `MONSTER_BOND_GLYPHS`（8 个无素材的阵营 + 3 条通用，共 11 条）→ 就地画 `<svg class="mbond__glyph">`（不查
 * GLYPHS，见该常量的注释）。两个键都缺（老帧 / 新阵营没配图）才回落到原来的 `skull`。
 *
 * `bonds` 为空（还没投放 / 商店没开 / 旧对局）时画一行空态「本回合尚未投放」，**不**退回干员盟约。
 * @param {{ bonds?: any[]|null }} props
 */
export function MonsterBondStrip({ bonds = null }) {
  const rows = (Array.isArray(bonds) ? bonds : []).filter((b) => b && (Number(b.layers) || 0) > 0);
  if (!rows.length) {
    return html`<div class="bstrip bstrip--empty mbonds" data-monster-bonds="1">
      <${MicroLabel}>MONSTER BONDS</${MicroLabel}><span>${t('本回合尚未投放')}</span></div>`;
  }
  // icon → <img>（失败回落到下面这枚字形）；glyph 命中本模块的 MONSTER_BOND_GLYPHS → 就地内联 <svg>（不查
  // GLYPHS：那份表在核心 ui/gameComponents.js 里，插件写的 `mb-*` 发不到客户端）；两个键都缺才回落 skull。
  const discOf = (b) => {
    const d = b.glyph ? MONSTER_BOND_GLYPHS[b.glyph] : undefined;
    const glyph = d
      ? html`<svg class="icon mbond__glyph" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false"><path d=${d} fill-rule="evenodd" /></svg>`
      : html`<${GIcon} name=${b.glyph || 'skull'} />`;
    return b.icon ? html`<${Img} src=${b.icon} class="mbond__img" alt="" fallback=${glyph} />` : glyph;
  };
  return html`<div class="bstrip mbonds" role="list" aria-label=${t('怪物盟约')} data-monster-bonds="1">
    ${rows.map((b) => html`<div key=${b.id} role="listitem" data-bond=${b.id} data-tier=${b.tier || 0}
        class=${cx('bslot', 'mbond', b.active && 'is-active')}
        title=${t('{name}：{layers} 层 · {tier} 阶', { name: b.name, layers: b.layers, tier: Number(b.tier) || 0 })}>
      <span class="mbond__disc" aria-hidden="true">${discOf(b)}</span>
      <span class="mbond__body">
        <span class="mbond__name">${b.name}</span>
        <span class="mbond__layers num">${b.layers}<small>${Number(b.tier) > 0 ? ` · ${b.tier}阶` : ''}</small></span>
      </span>
    </div>`)}
  </div>`;
}

/**
 * The bar.
 * @param {{ priv:any, editable:boolean, collapsed:boolean, refreshBusy?:boolean, onCollapse:(c:boolean)=>void,
 *   onBuy:(i:number)=>void, onLevel:Function, onRefresh:Function, onFreeze:Function, onDetail:(id:string, kind?:string, hint?:string|null)=>void,
 *   onDetailClose?: () => void, onRefuse?: (reason: string) => void, barRef:any,
 *   reward?: any, onReward?: (idx:number)=>void, onRewardLater?: Function, offBonds?: Set<string>|null,
 *   monsterShop?: any, monsterEditable?: boolean, view?: any, onDropCam?: (on:boolean)=>void }} props — offBonds:
 *   the bonds this mode never activates (gameLogic modeOffBonds), struck through on the operator cards.
 *   monsterShop: 对抗·攻方商店的私有帧 `m.monsterShop`（game.js 传入；只有攻方会收到 open:true 的帧 —— 服务端
 *   `monsterShopFrame` 只发给 confrontActors）。缺省 null / `open !== true` ⇒ 每一处分支都走改造前的老路。
 *   它为真时（攻方）不画干员的元素：商店升级卡换成**怪物卡池等级卡**（`.lvcard--monster`，读帧里的
 *   level/maxLevel/upgradePrice，点了发 g.monsterLevelUp）、不占装备卡那一格、`剩余可放置角色` 换成 `剩余投放预算`
 *   （读 monsterShop.left）；冻结 / 刷新 / 卡片改用 g.monster* 那一套。
 *   monsterEditable: 投放窗口（game.js 的 `confDropWindow` = confront.active + 投放公示未开始 + 本回合攻方）。
 *   **攻方的 `editable` 恒 false**（它带 `myRole !== 'attack'`，管的是棋盘 / 干员卡 / 干员商店），怪物卡池的等级卡
 *   只能靠这个 prop 拿到「可操作」（本组件再与 `!priv.ready` 合成 monsterEditable）。
 *   view / onDropCam: 拖拽投放用的镜头钩子（game.js 传入）。`view` 只用来做落点判门（render/app.js 的
 *   tileAtClientPoint，拿不到时用 tileScreen 的投影兜底）与半区高亮的几何（useTileScreen）；`onDropCam(true/false)`
 *   把镜头换成 / 还回能同时框住上下门的取景。两者缺省 null ⇒ 拖拽只折叠商店条、不发投放（点一下与多选照常）。
 */
export function ShopBar({ priv, editable, collapsed, refreshBusy = false, onCollapse, onBuy, onLevel, onRefresh, onFreeze, onDetail, onDetailClose, onRefuse, barRef,
  reward = null, onReward, onRewardLater, onArm = null, offBonds = null, econ = null, onOpenShop = null, monsterShop = null,
  monsterEditable: monsterDropWindow = false, onMonsterLevel = null, view = null, onDropCam = null }) {
  const shop = priv?.shop || {};
  const slots = Array.isArray(shop.slots) ? shop.slots : [];
  const chessSlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => !s || s.kind !== 'item');
  const itemSlots = slots.map((s, i) => ({ s, i })).filter(({ s }) => s && s.kind === 'item');
  const frozen = !!shop.frozen;
  const funds = Number(priv?.funds) || 0;
  const remaining = Math.max(0, (priv?.deployCap ?? 8) - (priv?.deployCount ?? 0));
  const lvReason = shopBlockReason('levelUp', { priv, editable });
  const refReason = shopBlockReason('refresh', { priv, editable });
  const frzReason = editable ? null : shopBlockReason('freeze', { priv, editable });
  const free = Number(shop.freeRefreshes) || 0;
  const showReward = !!(reward && Array.isArray(reward.slots) && reward.slots.length);
  // 怪物卡池（2026-11-04）：攻方这一回合的商店。`open !== true`（守方 / 商店没开 / 没有这一帧的旧对局）⇒ monsterOn
  // 为假 ⇒ 下面的干员卡、刷新、冻结全部照旧，一条新分支都不进。
  const monsterOn = !!monsterShop && monsterShop.open === true;
  // 怪物卡池的**可操作**判据（2026-11-06）。与服务端 `inMonsterStage`（server/match/monsterShop.js:136，PREP +
  // 投放公示未开始 + 攻守回合）同口径：商店开着（`open:true` 只在投放窗口发给攻方）+ 投放窗口（game.js 的
  // confDropWindow）+ 还没点准备（服务端 readyLocked 会拒）。
  // **不复用 `editable`**：game.js:384 的 editable 带 `myRole !== 'attack'` ⇒ 攻方恒 false；它管棋盘 / 干员卡 /
  // 干员商店共 11 处，为了一张等级卡放开它会连带放开干员的逻辑。monsterOn 为假（守方 / 商店没开 / 旧对局）⇒
  // 这里恒 false，下面所有怪物分支都不进 —— 守方行为与改造前逐字节相同。
  // 只读帧（`master` 单人掌握模式里非队长的攻方）：open:true + readOnly:true + slots:[]，资金/等级照发。
  // 他们能看见队友的进度，但一下都不能点 —— 点了服务端也回 WRONG_PHASE，不如在这里就灰掉并说明原因。
  const monsterReadOnly = monsterOn && monsterShop.readOnly === true;
  const monsterEditable = monsterOn && monsterDropWindow === true && !priv?.ready && !monsterReadOnly;
  const monsterSlots = monsterOn && Array.isArray(monsterShop.slots) ? monsterShop.slots : [];
  const monsterLeft = monsterOn ? Math.max(0, Number(monsterShop.left) || 0) : 0;
  const mRefPrice = monsterOn ? Math.max(0, Number(monsterShop.refreshPrice) || 0) : 0;
  const mFreeRef = monsterOn ? Math.max(0, Number(monsterShop.freeRefreshes) || 0) : 0;
  // 免费次数用完且剩余预算不够刷新的价钱 ⇒ 刷新灰掉（与卡面「投不起就灰」同一个口径）
  const mRefBlocked = monsterOn ? (mFreeRef <= 0 && mRefPrice > monsterLeft) : false;
  // 攻方的钱是**独立的怪物资金账户**（服务端 ps.monsterFunds，跨回合结转；买 / 刷新 / 投放都从它扣）：
  // monsterOn 时资金条读 `monsterShop.funds`（帧里的新字段），不读守方的 priv.funds —— 后者对攻方没有意义
  // （回合末会被 econSplitLeftover 清零）。monsterOn 为假 ⇒ 仍是 priv.funds，与改造前逐字节相同。
  const monsterFunds = monsterOn ? Math.max(0, Number(monsterShop.funds) || 0) : 0;
  const fundsShown = monsterOn ? monsterFunds : funds;
  // 怪物卡池等级（2026-11-04「参考卫戍协议干员商店」）：等级 / 满级 / 升级价都读服务端帧的新键
  // （server/match/monsterShop.js monsterShopFrame）。老帧没有这几个键 ⇒ 回落 1 级 / 6 级 / 0 价，不崩。
  const mLevel = monsterOn ? Math.max(1, Math.trunc(Number(monsterShop.level) || 1)) : 1;
  const mMaxLevel = monsterOn ? Math.max(mLevel, Math.trunc(Number(monsterShop.maxLevel) || 6)) : 6;
  const mUpgradePrice = monsterOn ? Math.max(0, Math.trunc(Number(monsterShop.upgradePrice) || 0)) : 0;
  // 两击确认（与干员 LevelCard 同一个观感）：第一下武装、第二下才发 g.monsterLevelUp（扣的是怪物资金，队级账户）。
  // 可操作判据用 monsterEditable（**不是** editable —— 攻方的 editable 恒 false，原先这一条让等级卡永远 armed 不起来，
  // 连卡片的 onClick（`!reason && onTap()`）都早退、根本没发包）。
  const mLevelKey = `mlv:${mLevel}`;
  const mLevelReason = monsterOn
    ? (mLevel >= mMaxLevel ? t('怪物卡池已达最高等级')
      : (monsterReadOnly ? t('队长操作中')
        : (!monsterEditable ? (priv?.ready ? t('已准备就绪，取消准备后才能操作') : t('当前阶段无法进行该操作'))
          : (mUpgradePrice > monsterFunds ? t('怪物资金不足，升级需要 {price}', { price: mUpgradePrice }) : null))))
    : null;

  // A completed upgrade changes the level, so its confirmation cannot carry into the next upgrade.
  const levelKey = `lv:${shop.level ?? 1}`;
  // two-tap: the keys that may stay armed right now
  const keys = new Set();
  if (!collapsed) {
    if (monsterOn) { if (!mLevelReason) keys.add(mLevelKey); }
    else if (!lvReason) keys.add(levelKey);
    // a reward offer hides the shop's cards (operators and the equipment slot, #617): only its own cards arm
    if (showReward) reward.slots.forEach((s, i) => { if (s && !s.sold) keys.add(armKey('r', i, s)); });
    else slots.forEach((s, i) => { if (s && !s.sold) keys.add(armKey(s.kind === 'item' ? 'i' : 'c', i, s)); });
  }
  // 两击武装的「可操作」闸门：干员卡与怪物等级卡**共用一个 armed state**，而攻方的 editable 恒 false ⇒ 攻方第一下
  // 武装的 mLevelKey 会在下一帧被 useTwoTap 的 valid 清掉，两击永远凑不齐（2026-11-06）。所以这里放行
  // `monsterOn && monsterEditable`；**不会**误放开干员卡：上面的 keys 在 monsterOn 时只加 mLevelKey，
  // 干员 / 装备 / 奖励卡的 arm key 根本不在集合里，且守方（monsterOn 为假）走的仍是 editable 这一支，行为不变。
  const [armed, setArmed] = useTwoTap({ editable: editable || (monsterOn && monsterEditable), keys });
  // the armed card's slot (game.js lights the tile a merge's elite will take — gameLogic.mergeTarget); kept before the
  // collapsed tab's early return (hook order)
  const armedSlot = armedSlotOf(armed, slots, showReward ? reward.slots : null);
  const armedSig = armedSlot ? `${armedSlot.kind}:${armedSlot.id}` : '';
  useEffect(() => { onArm?.(armedSlot ? { kind: armedSlot.kind === 'item' ? 'item' : 'chess', id: armedSlot.id } : null); }, [armedSig]);
  useEffect(() => () => onArm?.(null), []);
  // ---- 怪物卡池：点一下 = 投 1 只 / 长按 = 多选 / 拖到上门·下门 = 选门投放（业主裁决 2026-11-04）-------------------
  // hook 必须排在 collapsed 的提前 return 之前。`mGate` = **点一下投放的门**：由工具行的「上门 / 下门」二选一写入
  // （2026-11-05 业主第 2 条，之前只有「上一次成功投放的门」、初值恒 lower ⇒ 不拖拽就永远投下门），默认下门；
  // placeMonster 成功后仍把它对齐成实际投出的门。
  // `mPick`（旧的「选门 + 选数量」浮层状态）与 openMonsterPick / setMCount 已随浮层一起删除。
  const [mGate, setMGate] = useState('lower');
  const [mMulti, setMMulti] = useState(null);         // 多选态：null / { index }（长按的那一格）
  const [mPicked, setMPicked] = useState([]);         // 多选态里选中的格子（服务端 slot.index）
  const [mDrag, setMDrag] = useState(null);           // 拖拽中：{ x, y, index, name, icon, count, gate }
  const mSelRef = useRef({ key: null, picked: [] });  // 多选态的唯一真源（手势回调读它；上面两个 state 是渲染镜像）
  const mBusy = useRef(new Set());                    // 单飞锁：同一格在飞行中不发第二次（照 gameActions.refreshPending）
  const mPress = useRef(null);                        // 当前这次按下：{ slot, index, x, y, id, dragging, move, up }
  const mDragOn = useRef(false);                      // 正在拖：商店条已折叠、镜头已换过 ⇒ 结束必须还回去
  const mTapGuard = useRef(0);                        // 拖完那一下的 click 不算「点一下」（时间戳）
  const mHooks = useRef({});                          // 对外钩子（镜头 / 折叠）—— 每次 render 刷新，卸载时也拿得到
  const mLive = useRef({});                           // 手势读的实时值，防止按下时的闭包陈旧
  mHooks.current.cam = onDropCam;
  mHooks.current.collapse = onCollapse;
  // 半区高亮的几何（跟着镜头走，useTileScreen 与 underframe.js / facingWheel.js 同一范式）：两个门格的四角。
  // 服务端只把 open:true 的商店帧发给攻方 ⇒ monsterOn 为假时传 null：这几个 hook 什么都不做（不登记 rAF 循环）。
  const mGateUp = useTileScreen(monsterOn ? view : null, GEO.FIELD.r1, GEO.FIELD.c1);   // (12,10) = 上门
  const mGateDown = useTileScreen(monsterOn ? view : null, GEO.FIELD.r0, GEO.FIELD.c1); // (9,10)  = 下门
  // 落点兜底的投影几何（覆盖层压住画布时 tileAtClientPoint 拿不到 tile —— 见 useGateQuad 的注释）
  const mGateQuad = useGateQuad(monsterOn ? view : null, monsterOn);

  /** 多选态的唯一写入口：key = 长按的那一格（null = 退出），picked = 选中的格子。 */
  const setSel = (key, picked) => {
    mSelRef.current = { key: key == null ? null : key, picked: Array.isArray(picked) ? picked : [] };
    setMMulti(mSelRef.current.key == null ? null : { index: mSelRef.current.key });
    setMPicked(mSelRef.current.picked);
  };

  /**
   * 投放一次（点一下 / 拖到门）。夹到 [1, cap] 再发（cap 与服务端同源，见 monsterPlaceCap）；一只都投不起就说清原因。
   * 单飞：同一格在网络往返中不再发第二次 —— 投放成功后该格**立刻补位**，连点同一格会投出「新补的那张」。
   * @returns {Promise<boolean>}
   */
  const placeMonster = (slot, gate, count) => {
    if (!slot) return Promise.resolve(false);
    const index = Number(slot.index);
    if (!Number.isInteger(index) || mBusy.current.has(index)) return Promise.resolve(false);
    const max = monsterPlaceCap(slot, monsterLeft);
    if (max < 1) { onRefuse?.(t('剩余预算不足，投不下一只')); return Promise.resolve(false); }
    const n = Math.max(1, Math.min(max, Math.trunc(Number(count) || 1)));
    const g = gate === 'upper' ? 'upper' : 'lower';
    mBusy.current.add(index);
    return act('g.monsterPlace', { index, gate: g, count: n }, { sfx: 'drop' })
      .then((ok) => { if (ok) setMGate(g); return ok; })
      .finally(() => { mBusy.current.delete(index); });
  };
  const freezeMonsterSlot = (slot) => { if (slot) void act('g.monsterFreeze', { index: Number(slot.index) }, { sfx: 'freeze' }); };
  const refreshMonsterShop = () => { if (!mRefBlocked) void act('g.monsterRefresh', {}, { sfx: 'refresh' }); };
  mLive.current = { view, geo: mGateQuad, slots: monsterSlots, place: placeMonster };

  /**
   * 落点的门（拖拽的移动预览与松手共用，保证「高亮哪一半」= 「真投到哪个门」）：
   * 先走渲染层的 tile 命中（**权威**口径 —— 命中成功时它的「不是门」也是权威的）；**只有**命中测试什么都没给
   * （覆盖层压住画布 / 视图没这个方法）时，才用投影几何的兜底（gateFromQuad）。
   * @returns {'upper'|'lower'|null}
   */
  const gateAtPoint = (x, y) => {
    const tile = tileUnderPoint(mLive.current.view, x, y);
    if (tile) return monsterGateOf(tile.row);
    const g = mLive.current.geo;
    return g ? gateFromQuad(g.quad, g.split, x, y) : null;
  };

  /** 长按一格：进多选态（这一格自动选中；再长按同一格 = 退出并清空）。 */
  const holdMonster = (slot) => {
    const index = Number(slot?.index);
    if (!Number.isInteger(index)) return;
    const cur = mSelRef.current;
    if (cur.key === index) setSel(null, []);
    else setSel(index, [index]);
  };
  /** 多选态里点一下 = 选中 / 取消。 */
  const toggleMonsterPick = (slot) => {
    const index = Number(slot?.index);
    if (!Number.isInteger(index)) return;
    const cur = mSelRef.current.picked;
    setSel(mSelRef.current.key, cur.includes(index) ? cur.filter((i) => i !== index) : [...cur, index]);
  };

  /** 拖拽开始：折叠商店条（复用 onCollapse → game.js setCollapsed）并把镜头换成能同时框住上下门的取景。 */
  const beginDrop = (slot) => {
    const index = Number(slot?.index);
    if (!Number.isInteger(index)) return;
    const picked = mSelRef.current.picked;
    if (!mDragOn.current) {
      mDragOn.current = true;
      mHooks.current.collapse?.(true);
      mHooks.current.cam?.(true);
    }
    setMDrag({
      x: 0, y: 0, index, gate: null,
      name: slot?.name || slot?.key || '',
      icon: enemyIconUrl(data.get('assets'), slot?.key),
      count: picked.length || 1,
    });
  };
  /** 拖拽结束：ghost 收掉，镜头与商店条的展开状态原样还回去。 */
  const endDrop = () => {
    setMDrag(null);
    if (!mDragOn.current) return;
    mDragOn.current = false;
    mHooks.current.cam?.(false);
    mHooks.current.collapse?.(false);
  };
  const detachPress = () => {
    const r = mPress.current;
    if (!r) return;
    window.removeEventListener('pointermove', r.move);
    window.removeEventListener('pointerup', r.up);
    window.removeEventListener('pointercancel', r.up);
    mPress.current = null;
  };
  /**
   * 卡片按下：记下起点，把手势挂到 window 上 —— 拖拽一开始商店条会折叠成小条，卡片节点会消失，手势不能挂在节点上。
   */
  const pressMonster = (e, slot) => {
    if (!slot || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const index = Number(slot.index);
    if (!Number.isInteger(index)) return;
    detachPress();
    const move = (ev) => movePress(ev);
    // pointercancel（系统手势抢走指针、标签页切走）算取消：不发投放，只把商店条与镜头还回去
    const up = (ev) => endPress(ev, ev.type === 'pointercancel');
    mPress.current = { slot, index, x: Number(e.clientX) || 0, y: Number(e.clientY) || 0, id: e.pointerId, dragging: false, move, up };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };
  /** 移动：超过 8px 从「按下」变成「拖」；每次移动都重算落点属于哪个门（≤ 8px 时交给长按的定时器）。 */
  const movePress = (e) => {
    const r = mPress.current;
    if (!r || (r.id != null && e.pointerId != null && e.pointerId !== r.id)) return;
    // 卡片自己的 onPointerMove 与 window 上的同一个处理器都会收到这一下（冒泡）：同一个点只处理一次
    if (r.lx === e.clientX && r.ly === e.clientY) return;
    r.lx = e.clientX;
    r.ly = e.clientY;
    const dx = e.clientX - r.x;
    const dy = e.clientY - r.y;
    if (!r.dragging) {
      if (!Number.isFinite(dx) || !Number.isFinite(dy) || Math.hypot(dx, dy) <= MON_DRAG_PX) return;
      r.dragging = true;
      beginDrop(r.slot);
    }
    const gate = gateAtPoint(e.clientX, e.clientY);
    setMDrag((cur) => (cur ? { ...cur, x: e.clientX, y: e.clientY, gate } : cur));
  };
  /**
   * 松手：命中门就把选中的每格各投 1 只（多选态）或手指下那一张投 1 只；没命中 / 取消 = 什么都不发。
   * 投放之后**退出多选态**：那一格的 index 已经补位成另一只怪，选中的东西不再指同一张卡。
   */
  const endPress = (e, cancelled) => {
    const r = mPress.current;
    if (!r) return;
    // 另一根手指抬起不算这次手势（多指同时按住两张卡时只认记下的那一个 pointerId）
    if (r.id != null && e && e.pointerId != null && e.pointerId !== r.id) return;
    const dragging = r.dragging;
    detachPress();
    if (!dragging) return;                          // 一次普通点击：交给卡片的 onClick
    mTapGuard.current = Date.now();                  // 拖完那一下的 click 不当作「点一下」
    if (!cancelled) {
      const gate = gateAtPoint(e.clientX, e.clientY);
      if (gate) {
        const picked = mSelRef.current.picked;
        const list = picked.length ? picked : [r.index];
        // 依次发（一张一张等回执）：同一门、每格 1 只。单飞锁挡住同一格的重复；某一只被拒（toast 已说原因）
        // 也不影响其余几格的投放 —— 每格是独立的库存与资金结算。
        const step = (k) => {
          const i = list[k];
          if (i == null) return;
          const slot = mLive.current.slots.find((s) => s && Number(s.index) === i) || null;
          if (!slot) { step(k + 1); return; }
          void mLive.current.place(slot, gate, 1).finally(() => step(k + 1));
        };
        step(0);
        if (picked.length) setSel(null, []);
      }
    }
    endDrop();
  };
  /**
   * 单击怪物卡：多选态里 = 选中 / 取消；否则 = 投 1 只到**工具行选中的门**（`mGate`，2026-11-05 业主第 2 条：
   * 改造前这里读的是「上一次成功投放的门」，不拖拽就永远投下门）。拖拽松手后浏览器补的那一下 click 不算（400ms 内丢弃）。
   */
  const tapMonster = (slot) => {
    if (!slot) return;
    if (Date.now() - mTapGuard.current < 400) return;
    if (mSelRef.current.key != null) { toggleMonsterPick(slot); return; }
    void placeMonster(slot, mGate, 1);
  };

  // 离开多选态 / 收起拖拽的三条路：商店关掉、换回合或刷新（那时选中的 index 已经补位成别的怪）、卸载。
  // 都要先比一次值再写：monsterOn 为假时 Set / Set 状态的写入会被 Preact 丢掉，但 `setSel` 会造一个新数组 ⇒
  // 挂在 mount / 每次 render 上的 effect 会多出一次无意义的渲染（改造前这里就是两条只在值变化时才动手的 effect）。
  const mShopKey = `${monsterShop?.round ?? ''}:${monsterShop?.refreshes ?? ''}`;
  const mShopKeyRef = useRef(mShopKey);
  useEffect(() => {
    if (monsterOn) return;
    if (mSelRef.current.key != null || mSelRef.current.picked.length) setSel(null, []);
    if (mDragOn.current) endDrop();
  }, [monsterOn]);
  useEffect(() => {
    if (mShopKeyRef.current === mShopKey) return;
    mShopKeyRef.current = mShopKey;
    setSel(null, []);
    endDrop();
  }, [mShopKey]);
  useEffect(() => () => {
    const r = mPress.current;
    if (r) {
      window.removeEventListener('pointermove', r.move);
      window.removeEventListener('pointerup', r.up);
      window.removeEventListener('pointercancel', r.up);
      mPress.current = null;
    }
    if (mDragOn.current) { mDragOn.current = false; mHooks.current.cam?.(false); mHooks.current.collapse?.(false); }
  }, []);
  // 点别处退出多选态（卡片自己的 pointerdown 由卡片处理：那一下是选中 / 取消）
  useEffect(() => {
    if (!mMulti) return undefined;
    const onDown = (e) => {
      const el = e.target;
      if (el && el.closest && el.closest('.scard--monster')) return;
      setSel(null, []);
    };
    window.addEventListener('pointerdown', onDown, true);
    return () => window.removeEventListener('pointerdown', onDown, true);
  }, [mMulti]);
  /** First tap arms + opens the detail; the second buys (or says why it can't). */
  const tapCard = (kind, idx, slot, detailKind, reason, buy) => {
    const key = armKey(kind, idx, slot);
    if (armed !== key) { setArmed(key); onDetail(slot.id, detailKind, detailKind === 'chess' ? mergeHint(priv, slot.id) : null); return; }
    if (reason) { onRefuse?.(reason); return; }
    setArmed(null);
    onDetailClose?.();
    buy(idx);
  };
  const tapLevel = () => {
    if (armed !== levelKey) { setArmed(levelKey); return; }
    setArmed(null);
    onLevel();
  };
  /** 怪物卡池的升级卡：同一个两击确认，第二下发 g.monsterLevelUp（涨价 / 满级 / 资金不足都先说清原因）。 */
  const tapMonsterLevel = () => {
    if (armed !== mLevelKey) { setArmed(mLevelKey); return; }
    setArmed(null);
    if (mLevelReason) { onRefuse?.(mLevelReason); return; }
    onMonsterLevel?.();
  };

  // 拖动时跟随指针的浮动卡（卡面 + 张数）与命中半区的高亮。两个都不吃指针（pointer-events: none）。
  // 拖拽一开始商店条就折叠成小条 ⇒ 这两块要同时画在「折叠」与「展开」两支里（提前 return 之前算好）。
  const mDragGhost = mDrag ? html`<div class="mshop-ghost" style=${`left:${Math.round(mDrag.x)}px; top:${Math.round(mDrag.y)}px`} aria-hidden="true">
    <span class="mshop-ghost__art"><${Img} src=${mDrag.icon} fallback=${html`<${GIcon} name="skull" />`} /></span>
    <span class="mshop-ghost__body"><b class="mshop-ghost__name">${mDrag.name}</b>
      <span class="mshop-ghost__count num">${`×${mDrag.count}`}</span></span>
  </div>` : null;
  const mDragRing = (() => {
    if (!mDrag || !mDrag.gate) return null;
    const pts = halfRegionPoly((mDrag.gate === 'upper' ? mGateUp : mGateDown)?.poly, mDrag.gate);
    if (!pts) return null;
    const d = `${pts.map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)} ${p[1].toFixed(1)}`).join(' ')} Z`;
    return html`<svg class=${cx('mshop-gate-ring', mDrag.gate === 'upper' ? 'is-upper' : 'is-lower')} aria-hidden="true"><path d=${d} /></svg>`;
  })();

  if (collapsed) {
    // 拖拽中这条小条不拦指针（`elementFromPoint` 会跳过 pointer-events: none 的元素）：下门就在右下角，
    // 被它压住的话落点判门会判成「不是门」⇒ 取消投放。
    return html`<div class=${cx('shopbar-tab', mDrag && 'is-dragging')} ref=${barRef}>
      <div class="shopbar-tab__funds"><${CoinGlyph} /><b class="num">${fundsShown}</b></div>
      <button type="button" class="shopbar-tab__btn" onClick=${() => onCollapse(false)}><${Icon} name="chevronLeft" />${t('展开商店')}</button>
      ${mDragRing}${mDragGhost}
    </div>`;
  }

  const hk = { refresh: hotkeyLabelOf('refresh'), freeze: hotkeyLabelOf('freeze') }; // the player's keys (设置 → 快捷键)
  return html`<section class=${cx('shopbar', frozen && 'is-frozen', !editable && !monsterOn && 'is-locked', showReward && 'has-reward', armed && 'has-armed')} ref=${barRef} aria-label=${t('调度中心')}>
    ${/* 协同经济 sits ABOVE the tools row, not inside it: as a grid item spanning both columns it sized the columns
         and blew 冻结/刷新 up to fill them (user report 2026-10-09). Its own row keeps the buttons packed right. */ null}
    ${econ ? html`<div class="shopbar__econ"><${EconStrip} econ=${econ} editable=${editable} onRefuse=${onRefuse} onOpenShop=${onOpenShop} /></div>` : null}
    <div class="shopbar__tools">
      ${/* 怪物卡池开着时（攻方）：这一行是「剩余投放预算」（monsterShop.left），不是干员的部署位；
           关着时走右支，与改造前逐字节相同（同一个字符串、同一个 class、同一个 remaining） */ null}
      ${monsterOn
        ? html`<span class="shopbar__remain">${t('剩余投放预算：')}<b class=${cx('num', monsterLeft === 0 && 't-orange')}>${monsterLeft}</b></span>`
        : html`<span class="shopbar__remain">${t('剩余可放置角色：')}<b class=${cx('num', remaining === 0 && 't-orange')}>${remaining}</b></span>`}
      ${/* 多选态（长按进入）的提示行：说的是「现在怎么投」—— 已选 N 只 + 拖到上门或下门 */ null}
      ${monsterOn && mMulti
        ? html`<span class="shopbar__remain mshop-multi" data-testid="monster-multi">${t('已选 {n} 只 · 拖到上门或下门投放', { n: mPicked.length })}</span>`
        : null}
      ${/* 投放门二选一（2026-11-05 业主第 2 条）：点卡 = 投到**选中的**门。改造前 tapMonster 读的 mGate 只在成功拖拽后
           才被改写（初值恒 'lower'）⇒ 不拖拽就永远投下门。这里与同一个 mGate 绑定，点了立刻切换并高亮；拖拽仍按落点
           判门（endPress → monsterGateOf），两条路的 gate 都进 placeMonster。 */ null}
      ${monsterOn ? html`<span class="mshop-gate" role="group" aria-label=${t('投放门')}>
        <span class="mshop-gate__label">${t('投放门')}</span>
        <button type="button" class=${cx('mshop-gate__btn', mGate === 'upper' && 'is-on')} aria-pressed=${String(mGate === 'upper')}
          data-testid="monster-gate-upper" title=${t('点卡投放时投到上门（起点 (12,10)）')} onClick=${() => setMGate('upper')}>${t('上门')}</button>
        <button type="button" class=${cx('mshop-gate__btn', mGate === 'lower' && 'is-on')} aria-pressed=${String(mGate === 'lower')}
          data-testid="monster-gate-lower" title=${t('点卡投放时投到下门（起点 (9,10)）')} onClick=${() => setMGate('lower')}>${t('下门')}</button>
      </span>` : null}
      ${/* 怪物卡池开着时：商店级「冻结」不适用（冻结是按格子的，见卡面右键）⇒ 不画；刷新改发 g.monsterRefresh */ null}
      ${monsterOn ? null : html`<button type="button" class=${cx('toolbtn', 'toolbtn--ice', frozen && 'is-on')} disabled=${!!frzReason} onClick=${onFreeze}
        title=${frzReason || (frozen ? t('解冻商店 · {key}', { key: hk.freeze }) : t('冻结商店（下回合保留） · {key}', { key: hk.freeze }))}>
        <${Img} src=${uiUrl(data.get('assets'), frozen ? 'shopPanel/frozen_icon2' : 'shopPanel/frozen_icon')} class="toolbtn__img" fallback=${html`<${Icon} name="snow" />`} />
        <span>${frozen ? t('解冻') : t('冻结')}</span><kbd>${hk.freeze}</kbd>
      </button>`}
      ${monsterOn ? html`<button type="button" class="toolbtn toolbtn--amber" disabled=${mRefBlocked} onClick=${refreshMonsterShop}
          title=${mRefBlocked ? t('免费刷新次数已用完，剩余预算也不够刷新') : t('刷新怪物卡池（剩余预算 {left}）', { left: monsterLeft })}>
        <${Img} src=${uiUrl(data.get('assets'), 'shopPanel/refresh_icon')} class="toolbtn__img" fallback=${html`<${Icon} name="refresh" />`} />
        <span>${t('刷新')}</span>
        ${mFreeRef > 0 ? html`<span class="toolbtn__free">${t('免费 ×{free}', { free: mFreeRef })}</span>` : html`<${HexBadge} value=${mRefPrice} tone=${mRefBlocked ? 'dark' : 'gold'} size="sm" />`}
      </button>`
        : html`<button type="button" class="toolbtn toolbtn--amber" disabled=${!!refReason || refreshBusy} onClick=${onRefresh} title=${refReason || (refreshBusy ? t('正在刷新…') : t('刷新商店 · {key}', { key: hk.refresh }))}>
        <${Img} src=${uiUrl(data.get('assets'), 'shopPanel/refresh_icon')} class="toolbtn__img" fallback=${html`<${Icon} name="refresh" />`} />
        <span>${t('刷新')}</span>
        ${free > 0 ? html`<span class="toolbtn__free">${t('免费 ×{free}', { free })}</span>` : html`<${HexBadge} value=${shop.refreshPrice ?? 1} tone=${refReason || refreshBusy ? 'dark' : 'gold'} size="sm" />`}
        <kbd>${hk.refresh}</kbd>
      </button>`}
    </div>
    <div class="shopbar__row">
      ${/* 攻方（怪物卡池开着）画**怪物卡池**等级卡（同一张 .lvcard + .lvcard--monster 修饰类，点了发
           g.monsterLevelUp）；守方画干员的调度中心升级卡。monsterOn 为假时输出与改造前完全一致 */ null}
      ${monsterOn
        ? html`<${LevelCard} monster=${true} shop=${{ level: mLevel, maxLevel: mMaxLevel, upgradePrice: mUpgradePrice }}
            reason=${mLevelReason} armed=${armed === mLevelKey} onTap=${tapMonsterLevel} />`
        : html`<${LevelCard} shop=${shop} reason=${lvReason} armed=${armed === levelKey} onTap=${tapLevel} />`}
      ${showReward ? html`<${RewardCards} offer=${reward} priv=${priv} editable=${editable} onPick=${onReward} onDetail=${onDetail} onLater=${onRewardLater}
          armed=${armed} onTap=${tapCard} offBonds=${offBonds} />`
        : html`<div class="shopbar__cards">
        ${monsterOn
          ? monsterSlots.map((s, i) => {
            // 空格：独立的虚线空框（MonsterEmptyCard，与「已售罄」区分）；已售：SOLD OUT 外壳照旧
            if (!s) return html`<${MonsterEmptyCard} key=${`me${i}`} />`;
            if (s.sold) return html`<${SoldCard} key=${`ms${i}`} />`;
            const cap = monsterPlaceCap(s, monsterLeft);
            const index = Number(s.index);
            // 没有 .mshop-anchor 了：浮层（MonsterPickPanel）已删除，卡片直接排在 .shopbar__cards 里
            return html`<${MonsterCard} key=${`m${i}:${s.key}`} slot=${s} idx=${i} poor=${cap < 1}
              frozen=${slotFrozen(s, false)}
              multi=${!!mMulti} picked=${mPicked.includes(index)} dragging=${!!mDrag && mDrag.index === index}
              onTap=${tapMonster} onFreeze=${freezeMonsterSlot} onHold=${holdMonster}
              onPointerDown=${pressMonster} onPointerMove=${movePress}
              onPointerUp=${endPress} onPointerCancel=${endPress} />`;
          })
          : chessSlots.map(({ s, i }) => {
          if (!s) return html`<${EmptyCard} key=${`e${i}`} />`;
          if (s.sold) return html`<${SoldCard} key=${`s${i}`} />`;
          const reason = shopBlockReason('buy', { priv, editable, slot: s, ...LOOKUPS });
          return html`<${ChessCard} key=${`c${i}:${s.id}`} slot=${s} idx=${i} priv=${priv} frozen=${slotFrozen(s, frozen)} onBuy=${onBuy} onDetail=${onDetail} offBonds=${offBonds}
              reason=${reason} armed=${armed === armKey('c', i, s)} onTap=${editable ? (idx) => tapCard('c', idx, s, 'chess', reason, onBuy) : null} />`;
        })}
      </div>`}
      ${/* 装备卡那一格同样是干员商店的：攻方（怪物卡池开着）不占这一格。与 showReward 同一条短路判据，
           两者都为假时输出与改造前完全一致 */ null}
      ${showReward || monsterOn ? null : html`<div class="shopbar__item">
        ${itemSlots.length
          ? itemSlots.map(({ s, i }) => {
            if (s.sold) return html`<${SoldCard} key=${`is${i}`} item=${true} />`;
            const reason = shopBlockReason('buy', { priv, editable, slot: s, ...LOOKUPS });
            return html`<${ItemCard} key=${`i${i}:${s.id}`} slot=${s} idx=${i} frozen=${slotFrozen(s, frozen)} onBuy=${onBuy} onDetail=${onDetail} reason=${reason}
              armed=${armed === armKey('i', i, s)} onTap=${editable ? (idx) => tapCard('i', idx, s, 'item', reason, onBuy) : null} />`;
          })
          : html`<${SoldCard} item=${true} />`}
      </div>`}
      <div class="funds">
        <div class="funds__hex">
          <${CoinGlyph} class="funds__coin" />
          <b class="funds__num num">${fundsShown}</b>
        </div>
        <span class="funds__label">${monsterOn ? t('怪物资金') : t('目前资金')}</span>
        ${/* 怪物卡池开着时：资金条旁边显示卡池等级（业主 2026-11-04「参考卫戍协议干员商店」） */ null}
        ${monsterOn ? html`<span class="funds__lv" title=${t('怪物卡池 {level}/{max} 级', { level: mLevel, max: mMaxLevel })}>Lv.<b class="num">${mLevel}</b></span>` : null}
        <button type="button" class="funds__collapse" onClick=${() => onCollapse(true)}><${Icon} name="close" />${t('收起')}</button>
      </div>
    </div>
    ${/* 拖拽覆盖层（只有攻方会拖；monsterOn 为假时两者恒为 null ⇒ 输出与改造前一致） */ null}
    ${mDragRing}${mDragGhost}
  </section>`;
}
