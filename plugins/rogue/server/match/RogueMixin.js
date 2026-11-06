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

  /**
   * 不期而遇事件表（内联，避免再拉一个数据插件；要做成可配再挪 data/）。
   *
   * 藏品字段（2026-11-06 按官方口径补齐：不期而遇是藏品的主要产出，单事件 0–3 件，**几乎都带代价**）：
   *   · `relic: { pick: 1 }`     —— 免费发 1 件（走 mota 的 `relicOfferOne`，与三选一共用同一套发牌/结算）；
   *   · `relicBuy: { price: 6 }` —— 先**足额**付 `price` 资金，再发 1 件（扣款成功才发牌）；
   *   · `relicSwap: { rarity: 'own' }` —— **失与得**（官方「1 件换 1 件」）：拿走自己的一件、换入一件新的。
   *     稀有度跟投入挂钩（`rarity: 'own'` = 按自己换出的那件的档位，投高得高）；结算走 mota 的
   *     `relicSwapOffer` / `relicSwap`（`relicRevoke` 逆运算 + `relicGrant` 重新下发），不另外写一套。
   *
   * 代价一律**足额**（2026-11-06 修）：`funds` 负数 / `lp` 负数 / `gamble.stake` / `relicBuy.price` 付不起时
   * **整个选项被拒绝**（`ERR.NO_FUNDS`），不再「有多少扣多少」。生命下限仍是 1（与 `ps.lp` 的既有下限一致），
   * 所以 `lp: -2` 在 1 点生命时同样选不了。
   */
  rogueEvents() {
    return [
      { id: 'ev_peddler', name: '拾荒者', desc: '一个拾荒者愿意用废料换你的储备。', choices: [
        { id: 'a', label: '给他 2 资金，换 1 件装备', funds: -2, item: 'random' },
        { id: 'b', label: '抢下他的货，敌人更凶（+8% 全属性）', affix: { hp: 0.08, atk: 0.08 } },
        // 官方「商店外也能买到藏品」的通道：先足额付 6 资金，再发 1 件（付不起整个选项拒绝）
        { id: 'c', label: '付 6 资金，买他箱底的 1 件藏品', relicBuy: { price: 6 } },
      ] },
      { id: 'ev_shrine', name: '残破的神龛', desc: '供奉着什么，靠近时有低语。', choices: [
        { id: 'a', label: '供奉 3 资金，得 2 生命上限', funds: -3, lp: 2 },
        { id: 'b', label: '无视它，白拿 2 资金', funds: 2 },
        // 生命换藏品：献祭 2 生命（不足 2 点可用生命时选不了），免费发 1 件
        { id: 'c', label: '献祭 2 生命，换 1 件藏品', lp: -2, relic: { pick: 1 } },
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
      // 官方「失与得」节点（2026-11-06）：用自己**不需要的 1 件藏品**换 1 件新的，稀有度跟投入挂钩。
      // 只有手上至少 1 件、且还有没拥有过的候选时才可选（`rogueSwapChannelOk`）；没有任何代价。
      { id: 'ev_exchange', name: '失与得', desc: '有人摊开自己的藏品，愿意和你换一件。', choices: [
        { id: 'a', label: '拿 1 件藏品换他的 1 件（投高得高）', relicSwap: { rarity: 'own' } },
        { id: 'b', label: '不换，谢过他离开', funds: 1 },
      ] },
    ];
  }

  /**
   * 不期而遇的回合表：R3 / R6 / R9。
   *
   * 2026-11-06 起**不再是触发门** —— `phases.js` 改成按节点类型（`rogueNodeTypeFor(r) === 'event'`）触发，
   * 官方形态是「走到事件节点才遇事件」。本函数保留给老调用方/单测（`test/match/rogue-mode.test.js` 断言它），
   * 新代码不要再用它当门。
   */
  rogueEventRound(r) { return r === 3 || r === 6 || r === 9; }

  /** 这个选项的代价能否**足额**支付（资金 / 生命 / 赌注 / 买藏品的价）。官方口径：付不起就不能选。 */
  rogueChoiceAffordable(ps, pick) {
    if (!ps || !pick) return false;
    const funds = Math.max(0, Number(ps.funds) || 0);
    if (Number.isFinite(pick.funds) && pick.funds < 0 && funds < -pick.funds) return false;
    const lp = Math.max(0, Number(ps.lp) || 0);
    // 生命的下限是 1（结算同口径 `Math.max(1, …)`）：扣完不足 1 就是付不起
    if (Number.isFinite(pick.lp) && pick.lp < 0 && lp + pick.lp < 1) return false;
    if (pick.gamble) {
      const stake = Math.max(0, Number(pick.gamble.stake) || 0);
      if (stake > 0 && funds < stake) return false;
    }
    if (pick.relicBuy) {
      const price = Math.max(0, Math.trunc(Number(pick.relicBuy.price) || 0));
      if (price > 0 && funds < price) return false;
    }
    return true;
  }

  /** 藏品发行通道是否可用（mota 的 `relicOfferOne` + 非空抽卡池）。缺一个就不让选「给藏品」的选项。 */
  rogueRelicChannelOk() {
    if (typeof this.relicOfferOne !== 'function') return false;
    const pool = typeof this.relicDraftPool === 'function' ? this.relicDraftPool() : [];
    return Array.isArray(pool) && pool.length > 0;
  }

  /**
   * 失与得的通道是否可用：手上至少 1 件可换出、抽卡池里还有**没拥有过**的候选、且没有别人没选完的 offer 占着槽位
   * （`relicOffer` 只有一个槽位，覆盖会吞掉玩家已经付过代价的那份）。
   * mota 缺 `relicSwapOffer`（老版本插件）时直接判不可用 —— 点了也没反应，不如不给选。
   */
  rogueSwapChannelOk(ps) {
    if (typeof this.relicSwapOffer !== 'function') return false;
    if (!ps || !Array.isArray(ps.relics) || !ps.relics.length) return false;
    if (Array.isArray(ps.relicOffer) && ps.relicOffer.length) return false;
    const pool = typeof this.relicDraftPool === 'function' ? this.relicDraftPool() : [];
    if (!Array.isArray(pool) || !pool.length) return false;
    const owned = new Set(ps.relics);
    return pool.some((r) => r && !owned.has(r.id));
  }

  /** 这个选项现在能不能选：代价足额 + 藏品选项的发行通道可用（超时兜底与玩家点选共用同一判据）。 */
  rogueChoiceSelectable(ps, pick) {
    if (!pick) return false;
    if (!this.rogueChoiceAffordable(ps, pick)) return false;
    if ((pick.relic || pick.relicBuy) && !this.rogueRelicChannelOk()) return false;
    if (pick.relicSwap && !this.rogueSwapChannelOk(ps)) return false;
    return true;
  }

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
      if (!o || !Array.isArray(o.choices) || !o.choices.length) continue;
      const table = ps.rogueOfferTable || null;
      const full = table && Array.isArray(table.choices) ? table.choices : [];
      // 官方口径「代价足额」：超时也不能替玩家挑一个付不起的选项 ⇒ 取**第一个付得起且发得出的**；
      // 全都选不了就清空 offer，一分钱不扣、也不发东西（不让兜底变成「白拿」或「倒欠」）。
      const affordable = o.choices.find((c) => {
        const def = full.find((x) => x.id === c.id);
        return def ? this.rogueChoiceSelectable(ps, def) : false;
      });
      if (affordable) { try { this.roguePick(ps, affordable.id, { auto: true }); } catch { /* best effort */ } continue; }
      ps.rogueOffer = null;
      ps.rogueOfferTable = null;
      try { this.markPrivate(ps); } catch { /* best effort */ }
      try { this.markPublic(); } catch { /* best effort */ }
    }
  }

  /**
   * 选中一个选项并立即结算（资金 / 生命 / 部署上限 / 装备 / 赌局 / 敌人词缀 / 藏品 / 失与得）。
   *
   * 代价**足额**（2026-11-06）：资金 / 生命 / 赌注 / 买藏品的价付不起时整个选项被拒绝（`ERR.NO_FUNDS`），
   * offer **不清空**，玩家可以改选别的。判定全部发生在清空 offer 与扣款之前。
   */
  roguePick(ps, choiceId, { auto = false } = {}) {
    if (!ps || !ps.alive) return fail(ERR.ELIMINATED);
    const offer = ps && ps.rogueOffer;
    if (!offer || !offer.choices) return fail(ERR.BAD_TARGET, 'no rogue event'); // i18n-ignore
    const ev = ps.rogueOfferTable || null;
    const pick = ev && Array.isArray(ev.choices) ? ev.choices.find((c) => c.id === choiceId) : null;
    if (!pick) return fail(ERR.BAD_TARGET, 'bad choice'); // i18n-ignore
    // ---- 付得起吗 / 发得出吗（都在清空 offer 与扣款之前判）----
    if (!this.rogueChoiceAffordable(ps, pick)) return fail(ERR.NO_FUNDS, 'cannot afford'); // i18n-ignore
    const relicOption = !!(pick.relic || pick.relicBuy);
    if (relicOption && !this.rogueRelicChannelOk()) return fail(ERR.BAD_MSG, 'no relic to offer'); // i18n-ignore
    // 失与得：没有可换出的藏品 / 没有没拥有过的候选 / 槽位被占 ⇒ 整个选项拒绝（事件 offer 保留，可以改选别的）
    if (pick.relicSwap && !this.rogueSwapChannelOk(ps)) return fail(ERR.BAD_TARGET, 'no relic to swap'); // i18n-ignore
    // 藏品先发（通道已确认可用）：发不出去就整体拒绝，玩家不会「钱扣了没牌」。
    // 走的是 mota 的 `relicOfferOne`（三选一；已有未选完的 offer 时直接入手一件），不另写一套发牌。
    if (relicOption) {
      let issued = false;
      try { issued = this.relicOfferOne(ps, 'event') === true; } catch (e) { this.reportError('rogue relic offer', e); }
      if (!issued) return fail(ERR.BAD_MSG, 'relic offer failed'); // i18n-ignore
    }
    // 失与得：发一份 swap offer（3 件候选）。这时还不知道玩家要换出哪件 ⇒ 先发全档候选；
    // 玩家在藏品页点选换出的那一件后（`g.relicPick` 的第一阶段）服务端按档位重发，见 mota 的 `relicSwapOffer`。
    if (pick.relicSwap) {
      let issued = false;
      try { issued = this.relicSwapOffer(ps, null) === true; } catch (e) { this.reportError('rogue swap offer', e); }
      if (!issued) return fail(ERR.BAD_MSG, 'swap offer failed'); // i18n-ignore
    }
    ps.rogueOffer = null;
    ps.rogueOfferTable = null;
    if (Number.isFinite(pick.funds) && pick.funds) {
      if (pick.funds > 0) ps.addFunds(pick.funds, { reason: 'rogue' });
      // 负数代价：上面已判过足额，这里直接扣（`spend` 仍会自己兜底返回 false）
      else if (-pick.funds > 0) ps.spend(-pick.funds);
    }
    if (Number.isFinite(pick.lp) && pick.lp) ps.lp = Math.max(1, (Number(ps.lp) || 0) + pick.lp);
    if (Number.isFinite(pick.deployCap) && pick.deployCap) ps.deployCapBonus = (Number(ps.deployCapBonus) || 0) + pick.deployCap;
    if (pick.item === 'random') {
      const pool = (this.gd && this.gd.shopItemsByTier && this.gd.shopItemsByTier[2]) || [];
      // 以前是 `pool[(Number(this.seed) || 1) % pool.length]` —— 同一局恒定，等于假随机。
      // 2026-11-06 改成独立派生的随机流：同局可复现（重放安全），每次触发不同。
      const rng = createRng(deriveSeed(this.seed, `rogue-item:${this.round}:${ps.playerId}`));
      const id = pool.length ? pool[rng.int(pool.length)] : null;
      if (id) { try { ps.acquireItem(id, { source: 'rogue' }); } catch { /* pool guard */ } }
    }
    if (pick.gamble) {
      const roll = createRng(deriveSeed(this.seed, `gamble:${this.round}:${ps.playerId}`))();
      const stake = Math.max(0, Number(pick.gamble.stake) || 0);
      // 足额：上面已判过（押注不足以整条拒绝），这里不再 Math.min 夹取
      if (stake > 0) ps.spend(stake);
      if (roll < 0.5) ps.addFunds(pick.gamble.win || 0, { reason: 'rogue-gamble' });
    }
    // 买藏品的价：足额判定在上方；扣款在发牌之后（发牌失败已 return，不会只扣不发）
    if (pick.relicBuy) {
      const price = Math.max(0, Math.trunc(Number(pick.relicBuy.price) || 0));
      if (price > 0) ps.spend(price);
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
