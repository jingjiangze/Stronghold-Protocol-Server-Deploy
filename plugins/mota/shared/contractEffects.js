// shared/contractEffects.js — 把选中的危机合约**解算成一份修正表**.
//
// 分工:`contracts.js` 只有数据与门槛判定,这里把它翻译成"游戏能直接读的数"。服务端各子系统只需要问
// `fx.enemyMul('ELITE', 'hp')` / `fx.bossRounds` / `fx.deployCapAdd` 这类问题,不必知道合约是什么。
//
// 三条设计原则:
//   1. **纯函数,零依赖**。输入是 id 数组,输出是普通对象 —— 服务端与前端可以各算一份,结果必然一致。
//   2. **声明了就要生效**。这里没有"部分生效"这种中间态:一条合约的每个 effect 键都必须真的被解算出来。
//      写一条"声明了却什么都不做"的合约比没有它更糟 —— 玩家加了难度却拿不到对应的挑战。
//   3. 倍率**相乘**、加法**相加**、等级/上限取**最严**。多条合约叠加时顺序无关,结果确定。
//
// ⚠ 这里原来有一张 `UNIMPLEMENTED` 表,把"尚未实现的 effect 键"回传给界面标红
// (owner:「危机合约模式删除这个说明 不要了 不需要这个了」)。它唯一的条目是「新战线」的
// `bountyRounds`,而那条声明本身已经拿掉了 —— 表永远为空,于是整张表连界面那套标注一起删了。
// 以后真要再加"暂不生效"的机制,别恢复这套:直接把那个机制实现掉,或者干脆别写进 `effect`。

import { CONTRACTS, contractById } from './contracts.js';

/** 取倍率,缺失回 1 —— 乘法的单位元。 */
const mul = (v) => (Number.isFinite(v) && v > 0 ? v : 1);
/** 取加法,缺失回 0 —— 加法的单位元。 */
const add = (v) => (Number.isFinite(v) ? v : 0);
/** 取最严的上限(越小越严);缺失回 null 表示"没有上限"。 */
const tighter = (a, b) => (b == null ? a : a == null ? b : Math.min(a, b));

/**
 * 解算一组合约的效果。
 *
 * @param {readonly string[]} ids 已选合约 id(顺序无关)
 * @returns {{
 *   ids: string[],
 *   pact: null | { maxRounds: number, bossRounds: { round: number, hpMul: number, statAdd: number }[],
 *                  forceHidden: boolean, hiddenHpMul: number, hiddenStatAdd: number },
 *   enemyMul: (rank: string, key: 'hp'|'def'|'atk'|'speed') => number,
 *   eliteBlockAdd: number, eliteBlockMax: number|null,
 *   bossMul: (key: 'hp'|'def'|'atk') => number,
 *   opStatMul: { atk: number, def: number, hp: number },
 *   healMul: number,
 *   deployCapAdd: number,
 *   banProfessions: string[],
 *   noRangedTiles: boolean,
 *   noLpSharing: boolean,
 *   uniteDisabled: boolean, uniteMaxHelpers: number|null,
 *   incomeAdd: number, priceAdd: number, maxShopLevel: number|null, startLpAdd: number,
 *   bondLayerCap: number|null, bondLayerCapAbove: number|null, maxActiveBonds: number|null,
 * }}
 */
export function contractEffects(ids) {
  const list = (Array.isArray(ids) ? ids : []).map((id) => contractById(id)).filter(Boolean);

  /** @type {Record<string, number>} */
  const normal = {hp:1,def:1,atk:1,speed:1};
  const elite = { hp: 1, def: 1, atk: 1, speed: 1 };
  /** @type {Record<string, number>} */
  const boss = { hp: 1, def: 1, atk: 1 };
  /** @type {Record<string, number>} */
  const op = { atk: 1, def: 1, hp: 1 };

  const out = {
    ids: list.map((c) => c.id),
    pact: null,
    eliteBlockAdd: 0,
    eliteBlockMax: null,
    opStatMul: op,
    healMul: 1,
    deployCapAdd: 0,
    banProfessions: [],
    noRangedTiles: false,
    noFenceTiles:false,
    mobSpeedMul:1,mobAspdAdd:0,mobResAdd:0,mobRegenRatio:0,
    incomeTerms:[],priceTerms:[],supportProtocols:[],mobDamageTakenMul:1,opRedeployMul:1,bossAspdAdd:0,bossDamageTakenMul:1,prepTimeMul:1,combatClockMul:1,randomEliteCount:0,lateReinforcementRatio:0,bountyEveryRound:false,bountyLateFrom:null,bountyLeakPenalty:0,
    noLpSharing: false,
    uniteDisabled: false,
    uniteMaxHelpers: null,
    incomeAdd: 0,
    priceAdd: 0,
    /*
     * 回合门槛 (owner:「资金中断改成第五回合后金币减少1」「价格上涨改成第三回合后」)。
     *
     * 语义:**从第 `incomeFromRound` 回合起**才生效(含该回合)。`null` = 没有门槛(从第 1 回合起)。
     * 多条合约各带不同门槛时取**最早**的那个(先到的门槛先生效,更严)。
     * 消费点:`server/match/gamedata.js` 的 `income()` / `priceOf()`(它们知道当回合)。
     *
     * ⚠ 初值必须是 `null` 而不是 0 —— `earliest()` 判的是 `== null`;给 0 的话第一条合约的门槛会被当成
     * "已经有值"而永远写不进去。
     */
    incomeFromRound: null,
    priceFromRound: null,
    maxShopLevel: null,
    /**
     * 每个**休整期**限定的商店刷新次数(null = 不限)。「限售策略」合约用。
     *
     * ⚠ 是**每回合**一次,不是整局一次(owner:「限售策略是每个休息期最多刷新一次」)。
     * 消费点读 `round.refreshes`(player/round.js `startRound` 每回合清零)。
     */
    maxRefreshesPerRound: null,
    startLpAdd: 0,
    bondLayerCap: null,
    bondLayerCapAbove: null,
    maxActiveBonds: null,
  };

  for (const c of list) {
    const e = c.effect || {};
    out.prepTimeMul*=mul(e.prepTimeMul);out.combatClockMul*=mul(e.combatClockMul);
    out.randomEliteCount=Math.max(out.randomEliteCount,add(e.randomEliteCount));out.lateReinforcementRatio=Math.max(out.lateReinforcementRatio,add(e.lateReinforcementRatio));
    out.bountyLeakPenalty=Math.max(out.bountyLeakPenalty,add(e.bountyLeakPenalty));
    if(e.bountyEveryRound)out.bountyEveryRound=true;if(e.bountyLateFrom)out.bountyLateFrom=tighter(out.bountyLateFrom,e.bountyLateFrom);
    out.bossAspdAdd+=add(e.bossAspdAdd);out.bossDamageTakenMul*=mul(e.bossDamageTakenMul);
    out.mobDamageTakenMul*=mul(e.mobDamageTakenMul);out.opRedeployMul*=mul(e.opRedeployMul);
    if(e.supportProtocol)out.supportProtocols.push({...e.supportProtocol});
    if (e.noLpSharing) out.noLpSharing = true;
    if(e.noFenceTiles)out.noFenceTiles=true;
    out.mobSpeedMul*=mul(e.mobSpeedMul);out.mobAspdAdd+=add(e.mobAspdAdd);out.mobResAdd+=add(e.mobResAdd);out.mobRegenRatio+=add(e.mobRegenRatio);
    if(e.incomeAdd)out.incomeTerms.push({value:e.incomeAdd,from:e.incomeFromRound||1});
    if(e.priceAdd)out.priceTerms.push({value:e.priceAdd,from:e.priceFromRound||1});
    if (e.noRangedTiles) out.noRangedTiles = true;
    if (e.uniteDisabled) out.uniteDisabled = true;
    if (e.uniteMaxHelpers != null) out.uniteMaxHelpers = tighter(out.uniteMaxHelpers, e.uniteMaxHelpers);
    if (e.banProfession) out.banProfessions.push(e.banProfession);

    out.incomeAdd += add(e.incomeAdd);
    out.priceAdd += add(e.priceAdd);
    out.startLpAdd += add(e.startLpAdd);
    out.deployCapAdd += add(e.deployCapAdd);
    /*
     * 回合门槛:取**最早**的非零门槛 —— 两条合约各带门槛时,先到的那条先生效。
     * `earliest()` 只在"当前还没有门槛"或"新的更早"时替换,0 表示"从第 1 回合起"因而不构成限制。
     */
    const earliest = (cur, v) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 1) return cur;
      return cur == null ? n : Math.min(cur, n);
    };
    out.incomeFromRound = earliest(out.incomeFromRound, e.incomeFromRound);
    out.priceFromRound = earliest(out.priceFromRound, e.priceFromRound);
    if (e.maxRefreshesPerRound != null) out.maxRefreshesPerRound = tighter(out.maxRefreshesPerRound, e.maxRefreshesPerRound);
    if (e.maxShopLevel != null) out.maxShopLevel = tighter(out.maxShopLevel, e.maxShopLevel);
    if (e.maxActiveBonds != null) out.maxActiveBonds = tighter(out.maxActiveBonds, e.maxActiveBonds);

    /*
     * 盟约叠层限制:数据里是「可叠到 capAbove 以上的盟约,最高只能到 cap」。
     * 多条同时选时取**最严**(cap 最小),capAbove 同样取最小 —— 「失友(100)」+「失信(50)」里 50 更严。
     */
    if (e.bondLayerCap != null) {
      out.bondLayerCap = tighter(out.bondLayerCap, e.bondLayerCap);
      out.bondLayerCapAbove = tighter(out.bondLayerCapAbove, e.bondLayerCapAbove ?? e.bondLayerCap);
    }

    for (const [k, v] of Object.entries(e.opStatMul || {})) if (k in op) op[k] *= mul(v);
    for(const [k,v]of Object.entries(e.normalMul||{}))if(k in normal)normal[k]*=mul(v);
    for (const [k, v] of Object.entries(e.eliteMul || {})) if (k in elite) elite[k] *= mul(v);
    for (const [k, v] of Object.entries(e.bossMul || {})) if (k in boss) boss[k] *= mul(v);
    if (e.healMul != null) out.healMul *= mul(e.healMul);
    if (e.eliteBlockAdd) out.eliteBlockAdd += add(e.eliteBlockAdd);
    if (e.eliteBlockMax != null) out.eliteBlockMax = tighter(out.eliteBlockMax, e.eliteBlockMax);

    // 「合同」集:整局只有一条能生效(它们互相 excludes),所以直接采用,不做叠加
    if (e.mode === 'pact') {
      out.pact = {
        maxRounds: Number.isFinite(e.maxRounds) ? e.maxRounds : 14,
        bossRounds: (Array.isArray(e.bossRounds) ? e.bossRounds : []).map((b) => ({
          round: b.round,
          hpMul: mul(b.hpMul),
          /*
           * 属性削弱/强化 = **分数**(现有数据 −1/6、−0.2、+0.2;注释里也写「降低 1/6」)。
           *
           * ⚠ `defAdd` / `atkAdd` 是分开的 (owner:「延长线的boss数值改成 血量降低2/4 其余属性 降低2/2」)
           * —— 之前只有一个 `statAdd`,def 与 atk 只能同值。没写细分时回退到 `statAdd`,老数据不受影响。
           */
          statAdd: add(b.statAdd),
          defAdd: b.defAdd != null ? add(b.defAdd) : add(b.statAdd),
          atkAdd: b.atkAdd != null ? add(b.atkAdd) : add(b.statAdd),
          /*
           * 本回合的「按人数加成」上限 (owner:「第八回合的boos根据人数的血量加成最多x5 其他还是x8」)。
           *
           * `null` = 用全局 `config.bossHpScale.aliveFull`。
           * 消费点:`finalAssault.bossPoolHp`(它知道本场是哪个回合,会优先用这个值)。
           */
          aliveFull: Number.isFinite(+b.aliveFull) && +b.aliveFull > 0 ? Math.floor(+b.aliveFull) : null,
        })),
        forceHidden: !!e.forceHidden,
        hiddenHpMul: mul(e.hiddenHpMul),
        hiddenStatAdd: add(e.hiddenStatAdd),
        /*
         * ★ **延长局后期"基础敌人每回合变强"** (owner 2026-10-17:「延长线第十回合之后所有基础敌人
         *   血量+10% … 且之后每个新回合基础敌人属性都会再次提高 具体提升你来定」)。
         *
         *   `lateHpFrom`   = 从第几回合起(含)开始生效
         *   `lateHpStep`   = 之后**每回合**血量再 +这个比例(按乘法叠加:1.1 × 1.1 × …)
         *   `lateStatStep` = 之后**每回合**防御/攻击再 +这个比例
         *
         *   只在**普通敌人**上生效 —— 精锐与首领由 `bossRounds` 那套单独管,
         *   在这里再乘一次会和"削弱的早期首领 / 强化的末期首领"打架。
         *
         *   消费点:`gamedata.lateEnemyMods(round, isBasic)` → `waves.js` 生成波次时。
         */
        lateHpFrom: Number.isFinite(+e.lateHpFrom) && +e.lateHpFrom > 0 ? Math.floor(+e.lateHpFrom) : null,
        lateHpStep: add(e.lateHpStep),
        lateStatStep: add(e.lateStatStep),
      };
    }
  }

  /** 精锐 / 首领之外是普通敌人 —— 湮灭集只碰精锐,魁魅集只碰首领。 */
  out.enemyMul = (rank, key) => {
    const r = String(rank || 'NORMAL').toUpperCase();
    if (r === 'ELITE') return (elite[key]??1)*(key==='speed'?out.mobSpeedMul:1);
    // Owner: leader contracts apply only to the scheduled Boss/Core, not other BOSS-rank bodies.
    if (r === 'BOSS') return key === 'speed' ? 1 : (boss[key] ?? 1);
    if (r === 'OTHER_BOSS') return 1;
    return (normal[key]??1)*(key==='speed'?out.mobSpeedMul:1);
  };
  out.normalMul=normal;
  out.incomeAtRound=round=>out.incomeTerms.reduce((sum,t)=>sum+(Number.isFinite(round)&&round>=t.from?t.value:0),0);
  out.priceAtRound=round=>out.priceTerms.reduce((sum,t)=>sum+(Number.isFinite(round)&&round>=t.from?t.value:0),0);
  out.bossMul = (key) => boss[key] ?? 1;
  /** 精锐的加成也顺带暴露出来,方便测试直接断言,不必绕 enemyMul。 */
  out.eliteMul = elite;
  out.boss = boss;

  return out;
}

/**
 * 一份"什么都没选"的效果 —— 所有倍率 1、所有加法 0。
 * 让调用方不必到处写 `fx ? fx.x : 1`。
 */
export const NO_EFFECTS = contractEffects([]);

/**
 * 某回合是不是**首领战回合**。
 *
 * 两种情况都算:默认模式的 `bossRound`(非合同集),以及「合同」集自己排的那几轮。
 * 这是渲染与流程唯一该问的问题 —— 不要在外面各自重算。
 *
 * ## ★★ 有合约时**也必须算上隐秘核心** (owner 2026-10-17:
 *    「合约导致的回合延长会让其没有怪物敌人」)
 *
 *   原来有合约时是 `fx.pact.bossRounds.some(...)` —— **只看合同排的那几轮首领战,
 *   完全不含隐秘核心回合**。而核心那一轮在模式表里是**单独一行、`template` 是 `null`**
 *   (核心按 bossId 从 `bossTemplates` 选模板)。
 *
 *   后果:核心轮被判成**普通回合** ⇒ 走 `buildNormalWave` ⇒ 模板是 null ⇒ **空波次**。
 *   实测(防火地带 / 新战线)R15 就是 `spawns = 0`:
 *   那正是模式原本的核心行,而这两条合约把核心推到了 R19 / R20 之后,
 *   R15 就变成一个"既不是合同首领轮、也没被认成核心轮"的孤儿回合。
 *
 *   ⚠ `phases.js` 早就在本地自己补了 `|| isHidden` 才没在**流程**上出错,
 *     但别处(波次构造)问的还是这个函数 —— **两处定义不一致**正是这个 bug 的形态。
 *     现在核心轮在这里也算首领回合,`phases.js` 那处补丁可以留(幂等),但语义统一了。
 *
 * @param {ReturnType<typeof contractEffects>} fx
 * @param {number} round
 * @param {number} baseBossRound 模式原本的首领回合(gd.bossRound)
 * @param {number|null} [hiddenRound] 隐秘核心回合(gd.hiddenRound);省略则不考虑
 */
export function isBossRound(fx, round, baseBossRound, hiddenRound = null) {
  /* 核心轮永远是"首领战"语义的那一轮,不论有没有合约 */
  if (Number.isInteger(hiddenRound) && round === hiddenRound) return true;
  if (fx.pact) return fx.pact.bossRounds.some((b) => b.round === round);
  return round === baseBossRound;
}

/**
 * 取某回合首领战的数值修正。非首领回合 → 无修正。
 *
 * ⚠ 必须把 `defAdd` / `atkAdd` **一起带出去**:`contractEnemyMods`(waves.js)读的是它们。
 * 第一版只返回 `{ hpMul, statAdd }`,于是那两个字段在这一步被丢掉,首领属性修正又变成静默无效
 * (和它之前"完全没有调用点"是同一个 bug 的第二种形态)。
 *
 * @param {ReturnType<typeof contractEffects>} fx @param {number} round
 */
export function bossRoundMods(fx, round) {
  const none = { hpMul: 1, statAdd: 0, defAdd: 0, atkAdd: 0 };
  if (!fx.pact) return none;
  const b = fx.pact.bossRounds.find((x) => x.round === round);
  if (!b) return none;
  const statAdd = Number.isFinite(b.statAdd) ? b.statAdd : 0;
  return {
    hpMul: b.hpMul,
    statAdd,
    defAdd: Number.isFinite(b.defAdd) ? b.defAdd : statAdd,
    atkAdd: Number.isFinite(b.atkAdd) ? b.atkAdd : statAdd,
    /* 本回合的人数加成上限(null = 用全局值)。见 `bossPoolHp` 的消费点。 */
    aliveFull: Number.isFinite(+b.aliveFull) && +b.aliveFull > 0 ? Math.floor(+b.aliveFull) : null,
  };
}

/** 整局总回合数(「合同」集覆盖了模式默认值)。 */
export const totalRounds = (fx, baseLastRound) => (fx.pact ? fx.pact.maxRounds : baseLastRound);

/** 全部合约用到的 effect 键 —— 测试用它确认没有键是"写了但没人读"的。 */
export function effectKeysInUse() {
  const keys = new Set();
  for (const c of CONTRACTS) for (const k of Object.keys(c.effect || {})) keys.add(k);
  return [...keys].sort();
}
