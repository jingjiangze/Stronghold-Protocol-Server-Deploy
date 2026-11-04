// plugins/loan-pledge/server/match/LoanMatch.js
// 借贷抵押（F1：只冻结）：在 mota 的 Match 之上做一层包装，不改 mota 源码。
//
// 两条规则：
//   1. 只扣利息（L2）：每回合开始时，对每笔仍有未付利息的债务，从借款人资金里扣掉「当期利息」，
//      本金不动。每笔最多扣 `maxInterestRounds` 个回合。扣到的钱转给债权人。
//   2. 干员抵押（F1）：借款成功时，把借款人手牌里的第一个干员标记为抵押（piece.pledgedTo）；
//      抵押中的干员不能部署、不能出售；欠款结清后解锁。
//
// 债务结构：mota 写入 `{ to, amount, round, lag }`，amount 是「本金 + 利息」的合并值且偿还时原地削减，
// 本金事后不可反推。这里在 super 返回后补记 `principal / interest / interestPaid / rounds`，
// 之后的扣息与展示都读这四个字段。
//
// 开关：`plugin.json.settings` 目前只用于管理面板展示——引擎的 match host 不把插件 settings 传进
// Match（entry.js 只透传 hashInput.rules）。运行时按下面的 LOAN 常量执行，改行为需要改这个文件。

import { Match as MotaMatch } from '../../../mota/server/match/Match.js';
import { PlayerState } from '../../../mota/server/match/PlayerState.js';
import { fail } from '../../../mota/server/match/match/common.js';
import { ERR } from '../../../mota/shared/constants.js';
import { msg } from '../../../mota/shared/i18n.js';

/** 运行时规则（与 plugin.json 的 settings 默认值保持一致）。 */
const LOAN = Object.freeze({
  maxInterestRounds: 3,
  pledge: true,
});

// PlayerState 是模块级单例类，方法是 PlayerState.js 用 Reflect.ownKeys 装到原型上的。
// 这里只包一层入口守卫，并且保证幂等（同一进程里可能创建多个 Match）。
let playerPatched = false;

/** 幂等地把冻结守卫装到 PlayerState.prototype 上（导出以便单测）。 */
export function patchPlayerState() {
  if (playerPatched) return;
  playerPatched = true;
  const proto = PlayerState.prototype;

  const move = proto.move;
  proto.move = function loanMove(uid, to, dir) {
    const loc = this.find(uid);
    // 只拦「上场」：抵押中的干员仍可在手牌 / 临时区之间移动。
    if (loc?.piece?.pledgedTo && to && to.area === 'board') return fail(ERR.BAD_TARGET, 'pledged');
    return move.call(this, uid, to, dir);
  };

  const sell = proto.sell;
  proto.sell = function loanSell(uid) {
    const loc = this.find(uid);
    if (loc?.piece?.pledgedTo) return fail(ERR.BAD_TARGET, 'pledged');
    return sell.call(this, uid);
  };
}

export class Match extends MotaMatch {
  constructor(opts) {
    super(opts);
    patchPlayerState();
  }

  /**
   * 借款成功时补记本金 / 利息字段，并押一个干员。
   * super 在 econDebts.get(req.from) 末尾 push 一条 { to, amount, round, lag }。
   */
  econRespond(ps, id, approve) {
    const req = typeof id === 'string' ? this.econRequests?.get?.(id) : null;
    const before = req ? (this.econDebts.get(req.from)?.length || 0) : 0;
    const r = super.econRespond(ps, id, approve);
    if (!approve || r?.error || !req) return r;
    const list = this.econDebts.get(req.from);
    if (!list || list.length <= before) return r;
    this._loanMarkDebt(req.from, req.amount);
    this._loanPledge(req.from);
    return r;
  }

  /**
   * 只扣利息（L2）：每回合最多扣掉一笔债务尚未支付的利息，本金保留。
   * 没有可扣的利息（已扣完 / 达到回合上限 / 手头没钱）时退回 mota 原本的「只提醒」。
   */
  econSettleDebts(alive) {
    if (!this.teamEcon || !this.econDebts.size) return;
    const reminded = [];
    for (const ps of alive) {
      const list = this.econDebts.get(ps.playerId);
      if (!list || !list.length) continue;
      let charged = 0;
      for (const d of list) {
        const interest = Number(d.interest) || 0;
        const paid = Number(d.interestPaid) || 0;
        const rounds = Number(d.rounds) || 0;
        if (interest <= 0 || paid >= interest || rounds >= LOAN.maxInterestRounds) continue;
        const due = Math.min(interest - paid, Math.max(0, Math.floor(ps.funds)));
        if (due <= 0) continue;
        const creditor = this.players.get(d.to);
        ps.funds -= due;
        d.interestPaid = paid + due;
        d.amount = Math.max(0, (Number(d.amount) || 0) - due);
        d.rounds = rounds + 1;
        charged += due;
        if (creditor && creditor.alive && !creditor.left) {
          creditor.addFunds(due, { reason: 'interest' });
          creditor.dirty();
          this.toast(creditor, 'info', msg('{name} 的借款逾期，收到利息 {pay} 资金', { name: ps.name, pay: due }));
          this.markPrivate(creditor);
        }
      }
      if (charged > 0) {
        ps.dirty();
        this.toast(ps, 'warn', msg('借款逾期：本回合扣利息 {n} 资金，本金仍欠 {p}', { n: charged, p: this._loanPrincipal(ps) }));
        this.markPrivate(ps);
      } else {
        reminded.push(ps);
      }
    }
    if (reminded.length) super.econSettleDebts(reminded);
  }

  /** 还钱后如果欠款清零，解锁抵押。 */
  econRepay(ps, opts = {}) {
    const r = super.econRepay(ps, opts);
    if (!r || r.error) return r;
    this._loanRelease(ps);
    return r;
  }

  /** 给刚写入的那条债务补上本金 / 利息 / 已付利息 / 逾期回合数（mota 只写合并后的 amount）。 */
  _loanMarkDebt(borrowerId, principal) {
    const list = this.econDebts.get(borrowerId);
    if (!list || !list.length) return null;
    const d = list[list.length - 1];
    const p = Number(principal) || 0;
    d.principal = p;
    d.interest = Math.max(0, (Number(d.amount) || 0) - p);
    d.interestPaid = 0;
    d.rounds = 0;
    return d;
  }

  _loanPrincipal(ps) {
    const list = this.econDebts.get(ps.playerId) || [];
    return list.reduce((n, d) => n + Math.max(0, Number(d.principal ?? d.amount) || 0), 0);
  }

  _loanPledged(ps) {
    for (const p of ps.hand) if (p?.pledgedTo) return p;
    for (const p of ps.temp) if (p?.pledgedTo) return p;
    for (const p of ps.board.values()) if (p?.pledgedTo) return p;
    return null;
  }

  /** 押第一个未被押的手牌干员；手牌里没有干员就只是不押（债务照记）。 */
  _loanPledge(borrowerId) {
    if (!LOAN.pledge) return;
    const ps = this.players.get(borrowerId);
    if (!ps || !ps.alive || ps.left) return;
    if (this._loanPledged(ps)) return;
    const slot = ps.hand.findIndex((p) => p && p.kind === 'chess' && !p.pledgedTo);
    if (slot < 0) return;
    const piece = ps.hand[slot];
    piece.pledgedTo = 'loan';
    ps.dirty();
    this.markPrivate(ps);
    this.toast(ps, 'warn', msg('干员「{id}」已抵押为借款担保：还清欠款前不能上场或出售', { id: String(piece.id) }));
  }

  /** 欠款全部结清才解锁；部分还款不解锁。 */
  _loanRelease(ps) {
    const list = this.econDebts.get(ps.playerId);
    if (list && list.length) return;
    let released = 0;
    for (const p of ps.hand) if (p?.pledgedTo) { delete p.pledgedTo; released += 1; }
    for (const p of ps.temp) if (p?.pledgedTo) { delete p.pledgedTo; released += 1; }
    for (const p of ps.board.values()) if (p?.pledgedTo) { delete p.pledgedTo; released += 1; }
    if (!released) return;
    ps.dirty();
    this.markPrivate(ps);
    this.toast(ps, 'ok', msg('欠款已结清，抵押的干员已解锁'));
  }
}

export default Match;
