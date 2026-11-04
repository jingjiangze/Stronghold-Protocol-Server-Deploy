// server/sim/content/bands/mod-shu.js — 黍【四时不辍】(band_shu): the prep-side keys of the 策略 MOD.
//
// The band RECORD lives in data/bands.json and is written by tools/local-extract/build-shu-mod.mjs; the toggle slice
// mod/toggles.d/shu.json names that one file and `band_shu` as the presence marker. Exactly like the 罗德岛 kits
// (server/sim/content/kits/ops/mod-rhodes-*.js), this code is always loaded and INERT until the record exists:
// bandMetaHandler() only instantiates the hooks of the buff keys its own data names, so a checkout without the mod
// never runs a line of it.
//
//   prep_finish_grant_bond_char_on_count {need,count,amount,bond}
//       回合结束时，场上 ≥need 名不同<bond>干员 → 获得 amount 名<bond>干员（各自随机）。
//       一局内至多 count 名，跨回合累计（ps.counters `band:shu:granted`）；用完这条永久失效，第二条照常。
//       名额不足一轮的 amount 时只发剩下的（count=4 / amount=2 → 两个回合各发 2 名后收手）。
//       抽取走 ctx.rollChess —— 它同时覆盖共享池与这名玩家的**自选编队**库存（player/diy.js diyStockEntries），
//       而 bond 过滤读的是玩家数据视图（gd 已把 `chess_char_5/6_diyN_a` 解析成实际干员），所以：
//         · 自选编队里选了【炎】干员（如 黍 char_2025_shu / 望 char_2027_wang）→ 它进池，可以被这条发出来；
//         · 一个【炎】都没选 → 自选位解析成原型/别的干员，池里就只有卫戍协议自带的【炎】。
//       maxTier 取 6：自选抽到的 5★/6★ 不因调度中心等级被挡在池外（自选干员的随机范围「相应扩大」，rand grants 本身
//       不受调度中心门槛约束，player/diy.js）。
//
//   prep_finish_bond_layer_by_profession {groups,per,max,bond}
//       回合结束时（<bond> 已激活才会真的入账），每回合的层数 = 场上<bond>干员的「职业覆盖」：
//         · 每个职业贡献 min(该职业的<bond>干员数, per) 层 —— 第 1 名算 1 层，第 2、第 3 名各再 +1；per = 3 意味着
//           「任一职业有 3 名」已经把这份额外 +1 吃满（凑满职业的那 3 名 = 3 层）；
//         · 最多只有 groups（4）个职业参与结算（取人数最多的几个），所以铺开的散职业仍受「不同职业数（至多 4）」约束；
//         · 单回合总加成封顶 max（7）：9 个部署位最多凑三组「三同职业」，9 层被压回 7 —— 一回合最理想就是 +7。
//       **成员与职业都按「实际算进的盟约」判定**：metaBonds 走 pieceBonds，所以 变形同构体 + 炎国短刀 授予的【炎】
//       也计入（给塞雷娅转职后，她的 TANK 与 星熊/余 同组）；普通与精锐是同一名干员（gd.baseIdOf 去重）。
//       判定要求 <bond> 已激活（3 名起），对齐「激活炎盟约之后就开始加层」；层数经 0.23+0.009L 进干员攻击力，
//       炎佑的 30% 开战快照因此自动继承 —— 战斗侧零改动。
//
// Both run at SERVER_PREP_FIN → onPrepEnd, the same step 华法琳's 重点监护 uses, so the layers a round earns are the
// layers the next battle starts with (PlayerBattleInput.bonds).

import { bbCap } from '../../../../shared/plugins/officialBounds.js';
import { metaBonds } from '../support/meta.js';

const int = (v, d = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : d;
};

/**
 * The `bond` operators on the board: `{ members, byProfession }` — `members` = distinct operators, `byProfession` =
 * Map(profession → distinct operators of it).
 * Membership is the bond as the match counts it (own + 变形同构体 grants), a normal and its 精锐 are one operator.
 */
function yanBoard(ctx, bond) {
  const seen = new Set();
  const byProfession = new Map();
  for (const p of ctx.board()) {
    if (!p || p.kind !== 'chess') continue;
    if (!metaBonds(ctx, p).includes(bond)) continue;
    const base = ctx.gd.baseIdOf(p.id) || p.id;
    if (seen.has(base)) continue;
    seen.add(base);
    const prof = ctx.gd.chess(p.id)?.profession;
    if (!prof) continue;
    byProfession.set(prof, (byProfession.get(prof) || 0) + 1);
  }
  return { members: seen.size, byProfession };
}

export const SHU_BAND_KEYS = {
  prep_finish_grant_bond_char_on_count: (ps) => ({
    onPrepEnd(ctx) {
      const p = ps[0];
      const bond = p.bond;
      if (!bond) return;
      const cap = Math.max(0, int(p.count, 4));
      const amount = Math.min(bbCap('count'), Math.max(1, int(p.amount, 1)));
      if (ctx.counter('band:shu:granted') >= cap) return;
      if (yanBoard(ctx, bond).members < int(p.need, 5)) return;
      for (let i = 0; i < amount; i++) {
        if (ctx.counter('band:shu:granted') >= cap) break; // 一局内的总额度，最后一轮只发剩下的
        // any tier: the player's 自选编队 stock (5★/6★ slots) rides the same roll (player/diy.js diyStockEntries), and a
        // random grant is not gated by the 调度中心 level.
        const id = ctx.rollChess({ bond, maxTier: 6 });
        if (!id) return;
        if (!ctx.grantChess(id, { source: 'band' })) return; // 手牌已满 / 池空：这一轮到这里为止
        ctx.incCounter('band:shu:granted', 1);
      }
    },
  }),

  prep_finish_bond_layer_by_profession: (ps) => ({
    onPrepEnd(ctx) {
      const p = ps[0];
      const bond = p.bond;
      if (!bond) return;
      const per = Math.max(0, int(p.per, 3));
      const groups = Math.max(0, int(p.groups, 4));
      const max = Math.max(0, int(p.max, 7));
      if (!per || !groups || !max) return;
      // Only the fattest groups are counted once a board spreads over more than `groups` professions — deterministic
      // (member count desc, then profession name) and it keeps 「至多 4 个职业」 true for a 9-profession board.
      const counts = [...yanBoard(ctx, bond).byProfession]
        .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .slice(0, groups)
        .map(([, n]) => Math.min(n, per));
      const n = Math.min(max, counts.reduce((s, c) => s + c, 0));
      // requireActive: 炎 未激活（< 3 名）时一分不加 —— 「激活之后才开始加层」是 ctx 侧的同一道闸。
      if (n > 0) ctx.addLayers(bond, n, { requireActive: true, reason: 'band' });
    },
  }),
};
