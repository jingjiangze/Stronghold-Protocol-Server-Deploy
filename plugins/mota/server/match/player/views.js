// server/match/player/views.js — PlayerState methods: the views — pieceView, effectsView (the effects column: 策略 / 机变 /
// 悬赏 …) and m.private (privateView).
// Installed on PlayerState.prototype by server/match/PlayerState.js (a method container: never instantiated; `this` is
// the player state).

import { PHASE } from '../../../shared/constants.js';
import { boardOrder, pieceDir } from '../board.js';
import { bondList, offBondCounts } from '../bondsMeta.js';
import { bountyText, bountyCard } from '../choices.js';
import { relicEffectApplied } from '../match/meltdown.js';

export class PlayerViews {
  pieceView(p, rc = null) {
    const rec = p.kind === 'item' ? this.gd.item(p.id) : p.kind === 'token' ? this.gd.token(p.id) : this.gd.chess(p.id);
    // 皮肤 (docs/SKINS.md): skinFor resolves the effective body, including stand-ins and 自选 picks, on every surface.
    const skinId = p.kind === 'chess' ? this.skinFor(rec) : null;
    const v = {
      uid: p.uid,
      kind: p.kind,
      id: p.id,
      golden: !!(rec && rec.isGolden),
      tier: rec && Number.isInteger(rec.tier) ? rec.tier : null,
      items: p.kind === 'chess' ? (p.items || []).map((it) => ({ uid: it.uid, id: it.id })) : [],
      count: p.kind === 'token' ? (p.count || 1) : 1,
      ownerUid: p.kind === 'token' ? p.ownerUid ?? null : null,
      // 皮肤: the prep board / hand / temp views carry it too, so a piece shows its appearance before it is deployed and
      // the deploy wheel's preview matches the model that will actually fight
      ...(skinId ? { skin: skinId } : {}),
    };
    if (rc) { v.row = rc[0]; v.col = rc[1]; v.dir = pieceDir(p); }
    return v;
  }

  effectsView() {
    const out = [];
    const band = this.bandId ? this.gd.band(this.bandId) : null;
    if (band) out.push({ id: band.effectId || band.bandId, name: band.effectName || band.name, desc: band.desc || '', iconKind: 'band', iconId: band.iconId || band.bandId });
    for (const e of this.effects) {
      if (e.hidden) continue;
      const v = { id: e.id, name: e.name || e.id, desc: e.desc || '', iconKind: e.iconKind || 'choice', iconId: e.iconId || e.id };
      if (e.counter != null) v.counter = e.counter;
      out.push(v);
    }
    for (const b of this.bounties) {
      // the battles the bounty's enemies still come for (an official multi-round card: every battle, no counter) and
      // the card's official rich text (blue "下场作战" / "两场作战", red "每场"; a multi-round card reads as long as it
      // lasts — choices.js bountyText, MULTI_ROUND_BOUNTY_BATTLES) — user playtest #6 item 4
      const left = b.roundsLeft >= 90 ? null : b.roundsLeft;
      const eff = b.card.effectId ? this.gd.effect(b.card.effectId) : null;
      out.push({
        id: b.id, name: b.card.name || '悬赏', desc: bountyText((eff && eff.descRaw) || b.card.desc || '', b.card), iconKind: 'choice', iconId: b.card.effectId || 'bounty', // i18n-ignore: a data-less card's fallback name
        counter: left, counterText: left == null ? '之后的每场作战' : `还剩 ${left} 场作战`, // i18n-ignore: older clients (ui/effectsList.js builds it from counter)
      });
    }
    return out;
  }

  privateView() {
    // `support: true` marks a slot rolled from an operator THIS player brought as 助战 (shared/support.js) — additive,
    // so a client that does not know the field still reads the slot exactly as before.
    const slots = this.shop.slots.map((s) => (s ? {
      kind: s.kind, id: s.id, price: this.priceOf(s), basePrice: s.basePrice, sold: !!s.sold, frozen: !!s.frozen,
      ...(s.support ? { support: true } : {}),
    } : null));
    const offer = this.offers[0] || null;
    const free = this.shop.freeRefreshes > 0;
    const board = [];
    for (const { r, c, piece } of boardOrder(this.board)) board.push(this.pieceView(piece, [r, c]));
    // a boss round's prep: the partner's board on its half of the boss field (Match.bossMateView, item 51)
    const bossMate = typeof this.m.bossMateView === 'function' ? this.m.bossMateView(this) : null;
    // 协同共竞 (DESIGN §28/§29): the client's econ model (public/js/ui/econBar.js) reads priv.econ — the borrow
    // plate's request budget, the debts owed to/from this seat and the pending request live there. Attached with the
    // same probe as the public side (views.js econPublicView): only while the rule set is on, so a plain match's
    // private frame is byte-identical to upstream's.
    const econ = this.m && this.m.teamEcon && typeof this.m.econPrivateFor === 'function' ? this.m.econPrivateFor(this) : null;
    return {
      t: 'm.private',
      playerId: this.playerId,
      ...(econ ? { econ } : {}),
      seat: this.seat,
      alive: this.alive,
      lp: this.lp,
      funds: this.funds,
      bandId: this.bandId,
      ready: this.ready,
      canReady: this.alive && this.tempEmpty && !this.personalChoice && this.m.phase === PHASE.PREP,
      personalChoice: this.personalChoice ? {
        id: this.personalChoice.id,
        round: this.personalChoice.round,
        sourceItemId: this.personalChoice.sourceItemId,
        cards: this.personalChoice.cards.map((c) => bountyCard(this.gd, c)),
      } : null,
      shop: {
        level: this.shop.level,
        maxLevel: this.gd.maxShopLevel,
        upgradePrice: this.shop.level >= this.gd.maxShopLevel ? 0 : this.shop.upgradePrice,
        refreshPrice: free ? 0 : this.gd.refreshPrice,
        freeRefreshes: this.shop.freeRefreshes,
        frozen: this.shop.frozen,
        slots,
        // `source` 'merge' = the promotion reward (晋升奖励); any other offer (a strategy, an item, a 特质) carries the
        // `label` the bar shows instead; `queued` = offers waiting behind it (player report #6 after 0.1.0)
        rewardOffer: offer ? { tier: offer.tier, source: offer.source === 'merge' ? 'merge' : 'special', label: offer.label || null, queued: this.offers.length - 1, slots: offer.slots.map((s) => ({ kind: s.kind === 'item' ? 'item' : 'chess', id: s.id, price: s.price, sold: !!s.sold })) } : null,
      },
      hand: this.hand.map((p) => (p ? this.pieceView(p) : null)),
      temp: this.temp.map((p) => (p ? this.pieceView(p) : null)),
      board,
      // The stage's 外勤医疗 reserve medic is present during prep, but is not a draggable board piece.
      prepMapChars: this.m.prepMapChars(this),
      deployCap: this.deployCap,
      deployCount: this.deployCount,
      // + the mode-off bonds it has members of (`off: true`, the strip's grey 本局禁用 discs — bondsMeta.offBondCounts)
      bonds: bondList(this.gd, this.bondsView(), { full: true, off: offBondCounts(this.gd, this) }),
      effects: this.effectsView(),
      nextEnemies: this.m.nextEnemiesFor(this),
      // 对抗模式守方：本回合朝我投来的怪物（私有；攻方/普通模式省略）
      ...(this.m.isVersus && typeof this.m.incomingFor === 'function' ? { incoming: this.m.incomingFor(this) } : {}),
      // 助战 (shared/support.js): what this player brought AND what was actually granted at round 1. They differ when
      // the server's pool changed between the lobby's check and the grant (prepareSupports re-checks), and when a granted
      // piece is sold or merged away — so the client can say which supports it is actually fighting with.
      support: { selected: Array.isArray(this.support) ? [...this.support] : [], granted: Array.isArray(this.supportGranted) ? [...this.supportGranted] : [] },
      // DESIGN §16: the effective operator loadout ({ [baseChessId]: { skill, module } }; chess not listed use defaults)
      loadout: this.loadout,
      // 干员皮肤 (docs/SKINS.md): the effective { [chessId]: skinId }; a teammate's client reads it here
      skins: this.skins,
      // 0.2.2: the effective per-operator 潜能 / 练度 ({ [charId]: { potential, cultivate } }; operators not listed: 潜能 6,
      // 精英2 Lv.60) — the client's cards compose the numbers from it (shared/potential.js)
      ops: this.ops,
      // 0.2.0 补位: the base chess ids this player fields as their stand-ins in this match (the not-owned list the seat had
      // at the match start; [] = every operator owned) — the client shows these as their stand-ins (cards, pieces, the
      // detail card, with a small 「替补」 mark)
      standIns: this.standIns,
      // 0.2.0 自选编队: this player's 自选 picks in this match ({ [slotBaseId]: { charId, skillIndex, uniEquipId } } — the seat's
      // when the match started; {} = none) — the client composes the operator's record for its own cards and pieces
      // (shared/diy.js diyRecord); `diyBanned`: the slotted slots out of the shop this match (every bond of the operator
      // switched off)
      diy: this.diy,
      diyBanned: this.diyBanned,
      // 最终攻势 / 隐秘核心 prep (community report of 2026-10-06, item 51): `{ playerId, side, units }` — the pair partner's
      // board pieces as UnitInfo on its half of the boss field (mirrored on the right half, as the battle places them);
      // the own prep view draws them beside the own half, read-only. Absent otherwise.
      ...(bossMate ? { bossMate } : {}),
      stats: {
        dmgDealt: Math.round(this.stats.dmgDealt), kills: this.stats.kills, leaks: this.stats.leaks, gold: this.stats.gold,
        refreshes: this.stats.refreshes, merges: this.stats.merges,
      },
          // ---- 海克斯（TFT 式 augment）+ 熔毁商店（从 hexmod 移植）----
      hex: this.hex,
      hexes: Array.isArray(this.hexes) ? this.hexes.slice() : [],
      hexOfferDraft: this.hexOfferDraft || 0,
      hexOffer: Array.isArray(this.hexOffer) ? this.hexOffer.slice() : null,
      hexOfferPicked: this.hexOfferPicked || null,
      // 藏品三选一（业主 2026-10-27）：只下发自己那份 offer 的 id 列表
      relicOffer: Array.isArray(this.relicOfferCards) ? this.relicOfferCards.slice() : null,
      relicOfferRound: this.relicOfferRound || 0,
      // 肉鸽随机事件（2026-10-27）：{ round, eventId, name, desc, choices:[{id,label}] }
      rogueOffer: this.rogueOffer || null,
      relics: Array.isArray(this.relics) ? this.relics.slice() : [],
      // 已拥有藏品的卡面（名称/品阶/正负），给局内常驻列表用 —— id 列表仍是上面那份 `relics`
      relicCards: (() => {
        const list = Array.isArray(this.relics) ? this.relics : [];
        const raw = (this.m && this.m.gd && this.m.gd.raw && this.m.gd.raw.relics) || null;
        const defs = raw && Array.isArray(raw.relics) ? raw.relics : [];
        const idx = new Map(defs.map((d) => [d.id, d]));
        return list.map((id) => { const d = idx.get(id) || {}; return { id, name: String(d.name || id),
          tier: String(d.tier || ''), kind: String(d.kind || ''), applied: relicEffectApplied(d.effect),
          icon: String(d.icon || ''), desc: String(d.desc || '') }; });
      })(),
      hexStats: typeof this.m.hexStatsView === 'function' ? this.m.hexStatsView(this) : null,
      hexGrade: this.hexGrade || null,
      hexRerolls: Array.isArray(this.hexRerolls) ? this.hexRerolls.slice() : null,
      hexDeadline: Number.isFinite(this.hexDeadline) && this.hexDeadline > 0 ? this.hexDeadline : 0,
      meltdown: typeof this.m.meltdownView === 'function' ? this.m.meltdownView(this) : null,
};
  }
}
