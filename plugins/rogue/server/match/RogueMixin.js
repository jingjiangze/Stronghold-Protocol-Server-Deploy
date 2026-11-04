// plugins/rogue/server/match/RogueMixin.js — 肉鸽玩法的对局类叠加层（2026-11-01，业主「肉鸽做成插件」）。
//
// 挂载方式：plugin.json 的 `code.matchMixin` → `server/plugins/contentSet.js` 收进内容集的
// `code.matchMixins` → 对局宿主 `server/match/host/entry.js` 调 `applyMatchMixins()`，
// 把这些方法按插件加载顺序拷到「种子 Match（mota 的 Match）」那个类的原型上。
//
// 约束（管理器侧强制）：
//   · 只加方法，不碰构造函数 —— 叠加层拿不到 super()，需要初始化就写成惰性（第一次调用时建）。
//   · 方法名不许与种子 Match 重名，重名直接抛错（`a name defined twice is an error`）。
//   · 因此与 mota 的接口走「约定名 + typeof 守卫」：mota 的 `phases.js` / `views.js` / `meltdown.js`
//     在调 `rogueEventOffer` / `rogueEventRound` / `rogueRoundAffix` / `rogueEmergencyRound` 前都先判 typeof，
//     本插件被停用时它们自动跳过而不是崩。
//
// 本插件提供的东西（全部原在 mota 的 meltdown.js，2026-11-01 迁出）：
//   ① 不期而遇（随机事件，2 选 1，R3/R6/R9）
//   ② 每回合随机词缀（敌人 +hp / +atk / +移速 之一，按 seed+回合确定，可复现）
//   ③ 紧急作战回合（R5 / R9）
// 藏品（relic）的规则引擎仍留在 mota —— 它与协同共竞（xie）共用，不属于肉鸽。

import { createRng, deriveSeed } from '../../../../server/sim/rng.js';
import { ERR } from '../../../../shared/constants.js';

// 与 mota 的 `match/common.js` 同形（插件不能 import 另一个插件的内部模块，故本地各留一份）
const OK = Object.freeze({ ok: true });
const fail = (error, detail) => (detail ? { error, detail } : { error });

export class Mixin {
  /** 探针：宿主日志与真机自检都用它确认叠加层到位（不参与玩法）。 */
  roguePluginInfo() {
    return { id: 'rogue', mixin: true, round: this.round ?? null, mode: this.mode ?? null };
  }

  /** 不期而遇事件表（内联，避免再拉一个数据插件；要做成可配再挪 data/）。 */
  rogueEvents() {
    return [
      { id: 'ev_peddler', name: '拾荒者', desc: '一个拾荒者愿意用废料换你的储备。', choices: [
        { id: 'a', label: '给他 2 资金，换 1 件装备', funds: -2, item: 'random' },
        { id: 'b', label: '抢下他的货，敌人更凶（+8% 全属性）', affix: { hp: 0.08, atk: 0.08 } },
      ] },
      { id: 'ev_shrine', name: '残破的神龛', desc: '供奉着什么，靠近时有低语。', choices: [
        { id: 'a', label: '供奉 3 资金，得 2 生命上限', funds: -3, lp: 2 },
        { id: 'b', label: '无视它，白拿 2 资金', funds: 2 },
      ] },
      { id: 'ev_wounded', name: '濒死的干员', desc: '他还有一口气，身上带着部署凭证。', choices: [
        { id: 'a', label: '救他：-3 生命，+1 部署上限', lp: -3, deployCap: 1 },
        { id: 'b', label: '搜他的包：+3 资金', funds: 3 },
      ] },
      { id: 'ev_gamble', name: '赌局', desc: '一个戴兜帽的人摊开牌。', choices: [
        { id: 'a', label: '押上 4 资金，赢了翻倍（五成）', gamble: { stake: 4, win: 8 } },
        { id: 'b', label: '不赌，拿 1 资金走人', funds: 1 },
      ] },
      { id: 'ev_altar', name: '怪异的祭坛', desc: '石面上刻着看不懂的字。', choices: [
        { id: 'a', label: '献上 2 生命，本局敌人 -6% 攻击', lp: -2, affix: { atk: -0.06 } },
        { id: 'b', label: '砸了它：+2 资金，敌人 +6% 生命', funds: 2, affix: { hp: 0.06 } },
      ] },
    ];
  }

  rogueEventRound(r) { return r === 3 || r === 6 || r === 9; }

  /** 发一份不期而遇（每人独立抽一个事件；非阻塞，20s 超时取第一个选项）。 */
  rogueEventOffer() {
    if (this.isRogue !== true) return;
    const table = this.rogueEvents();
    if (!table.length) return;
    const round = Number(this.round) || 1;
    const rng = createRng(deriveSeed(this.seed, `rogue-event:${round}`));
    for (const ps of this.alivePlayers()) {
      if (!ps || (Array.isArray(ps.rogueOffer) && ps.rogueOffer)) continue;
      const ev = table[Math.floor(rng() * table.length)];
      if (!ev) continue;
      ps.rogueOffer = { round, eventId: ev.id, name: ev.name, desc: ev.desc,
        choices: ev.choices.map((c) => ({ id: c.id, label: c.label })) };
      ps.rogueOfferTable = ev;
      try { this.markPrivate(ps); } catch (e) { this.reportError('rogue offer', e); }
    }
    try { this.markPublic(); } catch { /* best effort */ }
    // `later(20, …)` 是 20 毫秒不是 20 秒 —— 事件弹窗会瞬间自动选第一个（2026-10-31 修）
    try { this._rogueTimer = this.later(20 * 1000, () => this.rogueEventTimeout()); } catch { /* no scheduler */ }
  }

  rogueEventTimeout() {
    for (const ps of this.alivePlayers()) {
      const o = ps && ps.rogueOffer;
      if (o && o.choices && o.choices.length) { try { this.roguePick(ps, o.choices[0].id, { auto: true }); } catch { /* best effort */ } }
    }
  }

  /** 选中一个选项并立即结算（资金 / 生命 / 部署上限 / 装备 / 赌局 / 敌人词缀）。 */
  roguePick(ps, choiceId, { auto = false } = {}) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const offer = ps && ps.rogueOffer;
    if (!offer || !offer.choices) return fail(ERR.BAD_TARGET, 'no rogue event'); // i18n-ignore
    const ev = ps.rogueOfferTable || null;
    const pick = ev && Array.isArray(ev.choices) ? ev.choices.find((c) => c.id === choiceId) : null;
    if (!pick) return fail(ERR.BAD_TARGET, 'bad choice'); // i18n-ignore
    ps.rogueOffer = null;
    ps.rogueOfferTable = null;
    if (Number.isFinite(pick.funds) && pick.funds) {
      if (pick.funds > 0) ps.addFunds(pick.funds, { reason: 'rogue' });
      else { const pay = Math.min(Math.max(0, Number(ps.funds) || 0), -pick.funds); if (pay > 0) ps.spend(pay); }
    }
    if (Number.isFinite(pick.lp) && pick.lp) ps.lp = Math.max(1, (Number(ps.lp) || 0) + pick.lp);
    if (Number.isFinite(pick.deployCap) && pick.deployCap) ps.deployCapBonus = (Number(ps.deployCapBonus) || 0) + pick.deployCap;
    if (pick.item === 'random') {
      const pool = (this.gd && this.gd.shopItemsByTier && this.gd.shopItemsByTier[2]) || [];
      const id = pool.length ? pool[Math.floor((Number(this.seed) || 1) % pool.length)] : null;
      if (id) { try { ps.acquireItem(id, { source: 'rogue' }); } catch { /* pool guard */ } }
    }
    if (pick.gamble) {
      const roll = createRng(deriveSeed(this.seed, `gamble:${this.round}:${ps.playerId}`))();
      const stake = Math.max(0, Number(pick.gamble.stake) || 0);
      const pay = Math.min(Math.max(0, Number(ps.funds) || 0), stake);
      if (pay > 0) ps.spend(pay);
      if (roll < 0.5) ps.addFunds(pick.gamble.win || 0, { reason: 'rogue-gamble' });
    }
    if (pick.affix && typeof pick.affix === 'object') {
      ps.rogueAffixBonus = ps.rogueAffixBonus || { hp: 0, atk: 0 };
      if (Number.isFinite(pick.affix.hp)) ps.rogueAffixBonus.hp += pick.affix.hp;
      if (Number.isFinite(pick.affix.atk)) ps.rogueAffixBonus.atk += pick.affix.atk;
    }
    try { ps.dirty && ps.dirty(); } catch { /* noop */ }
    try { this.recompute && this.recompute(ps); } catch { /* noop */ }
    try { this.markPrivate(ps); } catch (e) { this.reportError('rogue pick markPrivate', e); }
    try { this.markPublic(); } catch (e) { this.reportError('rogue pick markPublic', e); }
    void auto;
    return OK;
  }

  /** 紧急作战回合（肉鸽）：R5 / R9 —— 敌人更强，但回合开始给全队 +4 资金补偿。 */
  rogueEmergencyRound(r) { return this.isRogue === true && (r === 5 || r === 9); }

  /** 本回合的随机词缀（按 seed+回合确定，可复现）：敌人 +hp / +atk / +移速 之一。 */
  rogueRoundAffix(r = this.round) {
    if (this.isRogue !== true) return null;
    const p = createRng(deriveSeed(this.seed, `affix:${r}`))();
    if (p < 0.34) return { kind: 'hp', mul: 0.12, label: '敌人生命 +12%' };
    if (p < 0.67) return { kind: 'atk', mul: 0.12, label: '敌人攻击 +12%' };
    return { kind: 'speed', mul: 0.1, label: '敌人移速 +10%' };
  }
}
