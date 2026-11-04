// shared/closur.js — 可露希尔「信用额度」的借款规则（服务端与客户端共用一张表）。
//
// owner 2026-10-19 的规则：
//   · 可借用授信额度内的资金，每笔按 params.interest 收费；
//   · **每回合需偿还欠款的 30%**（向上取整，至少 1）；
//   · **连续两回合没能按时还上**（逾期）⇒ **下一回合起所有获得的资金全部用于偿还**，
//     直到欠款清零才恢复正常入账。
//
// 为什么放 shared/：服务端算账（server/match/player/economy.js）和客户端展示
// （public/js/ui/closurCredit.js）必须用同一套数字，否则界面说的和实际扣的不一致。

/** 欠款本金（`PlayerState.counters` 的键）。 */
export const CLOSUR_DEBT = 'band:closur:debt';
/** 连续逾期回合数（放在同一个 counters 表里）。 */
export const CLOSUR_OVERDUE = 'band:closur:overdue';

/** 每回合应还比例，默认 30%。 */
export const CLOSUR_REPAY_RATE = 0.3;
/** 允许连续逾期的回合数，达到它就进入强制扣款。 */
export const CLOSUR_GRACE_ROUNDS = 2;

/** `params` 可以被数据覆盖的两个数，做了边界保护（rate ∈ (0,1]，grace ≥ 1）。 */
export function closurRules(params = {}) {
  const rate = Number(params?.repay_rate);
  const grace = Number(params?.grace);
  return {
    rate: Number.isFinite(rate) && rate > 0 ? Math.min(1, rate) : CLOSUR_REPAY_RATE,
    grace: Number.isInteger(grace) && grace >= 1 ? grace : CLOSUR_GRACE_ROUNDS,
  };
}

/** 这一回合应当偿还多少：欠款 × rate，向上取整，至少 1；没有欠款时是 0。 */
export function closurDue(owed, rate = CLOSUR_REPAY_RATE) {
  const o = Math.max(0, Math.trunc(Number(owed) || 0));
  if (o <= 0) return 0;
  return Math.min(o, Math.max(1, Math.ceil(o * rate)));
}

/**
 * 借款视图（服务端 `creditLine()` 与客户端面板共用）。
 *
 * `interest` 来自策略参数；有欠款时战斗输入激活五项战斗属性 ×0.9。
 *
 * @param {object} params `data/bands.json` 的 `band_closur.params`
 * @param {number} debt 当前欠款
 * @param {number} [overdue] 连续逾期回合数
 */
export function closurCredit(params = {}, debt = 0, overdue = 0) {
  const loan = Math.max(1, Math.trunc(Number(params.loan) || 4));
  const interest = Math.max(0, Math.trunc(Number(params.interest) || 0));
  const credit = Math.max(0, Math.trunc(Number(params.credit) || 15));
  const owed = Math.max(0, Math.trunc(Number(debt) || 0));
  const od = Math.max(0, Math.trunc(Number(overdue) || 0));
  const { rate, grace } = closurRules(params);
  return {
    loan,
    interest,
    credit,
    owed,
    room: Math.max(0, credit - owed),
    rate,
    grace,
    overdue: od,
    /** 本回合应还金额。 */
    due: closurDue(owed, rate),
    /** 是否已进入「所有获得资金抵扣欠款」的强制状态。 */
    forced: owed > 0 && od >= grace,
  };
}
