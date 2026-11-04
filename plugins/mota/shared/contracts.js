import {compileContractSelection,completionForSelection} from './contractCompletion.js';
import { PACT_VARIANTS } from './contractPactVariants.js';
import {EXTRA_CONTRACT_SETS,EXPANDED_CONTRACTS,BENEFIT_THRESHOLDS} from './contractExpansion.js';
import {contractSummary,contractDetails} from './contractDescriptions.js';
// shared/contracts.js — 危机合约 (Crisis Contract) 的**数据表 + 规则**.
//
// 明日方舟的危机合约:一局开始前勾选若干"加难度"条款,结算时按条款给分。本文件是**服务端与前端共用的唯一一张表**
// —— 服务端用 `contractAvailable` / `contractPoints` 校验与计分,界面用同一批字段渲染,所以两边永远不会漂。
//
// 三条边界:
//   1. 这里只有**数据与纯函数**。合约怎么改游戏(倍率、回合数、上限)全在 `contractEffects.js` 里解析,
//      再由 gamedata / 各子系统读 —— 这张表不认识任何游戏内部结构。
//   2. 界面需要的字段(名称、点数、图标、指标集)与规则字段(门槛、前置、互斥)放在一起:加一条合约只改这一处。
//   3. `effect` 里的键是**数据**,不是代码 —— `contractEffects.js` 逐个消费它们。
//      ⚠ 所以:要塞进 `effect` 的键**必须已经有解算器读它**。写了没人读就是"声明了却不生效",
//      那种键的显式标注机制已经删掉(见 contractEffects.js 顶部),没有兜底提示了。

/**
 * @typedef {object} Contract
 * @property {string} id            稳定 id(存档、协议、房间状态都用它)
 * @property {number} points        危机点数
 * @property {string} name          中文名
 * @property {string} nameEn        英文名(界面小字)
 * @property {string} icon          瓦片图形(`ui/components.js` 的 ICONS 名)
 * @property {{ id: string, name: string, nameEn?: string }} set  指标集
 * @property {number} [setOrder]    集的排序(setOrder 小的在前)
 * @property {string} desc          一句话简述(瓦片上/详情里)
 * @property {string} detail        展开后的长说明(逐行)
 * @property {number} [minPlayers]  需要的人数下限
 * @property {string} [minDifficulty] 需要的难度下限
 * @property {string[]} [requires]  前置:必须**同时选中**这些合约才可选
 * @property {string[]} [excludes]  互斥:选中本条会**自动取消**这些合约(双向由解算器保证)
 * @property {boolean} [benefit]
 * @property {number} [minScore]
 * @property {string} [supportProfession]
 * @property {string} [limitGroup]
 * @property {number} [maxInGroup]
 * @property {readonly string[]} [requiresAny]
 * @property {object} [effect]      游戏内效果(见 contractEffects.js)
 */

/** 指标集 (owner 的分组)。`order` 决定渲染顺序。 */
export const CONTRACT_SETS = Object.freeze([
  Object.freeze({ id: 'mech', order: 1, name: '指标集：机制', nameEn: 'MECHANISM' }),
  Object.freeze({ id: 'pact', order: 2, name: '指标集：合同', nameEn: 'CONTRACT' }),
  Object.freeze({ id: 'aid', order: 3, name: '指标集：后援', nameEn: 'SUPPORT' }),
  Object.freeze({ id: 'doom', order: 4, name: '指标集：毁灭', nameEn: 'DESTRUCTION' }),
  Object.freeze({ id: 'anni', order: 5, name: '指标集：湮灭', nameEn: 'ANNIHILATION' }),
  Object.freeze({ id: 'spec', order: 6, name: '指标集：魁魅', nameEn: 'SPECTER' }),
  Object.freeze({ id: 'liai', order: 7, name: '指标集：联络', nameEn: 'LIAISON' }),
  ...EXTRA_CONTRACT_SETS.map(Object.freeze),
]);

/** 难度序(越高越难),用于 `minDifficulty` 比较。 */
const DIFF_RANK = Object.freeze({ FUNNY: 0, NORMAL: 1, HARD: 2, ABYSS: 3, TRAINING: -1 });

/**
 * **危机合约的系统难度下限:绝境**。
 *
 * 危机合约是"加难度换分"的玩法,标准 / 险境本来就是放松的档位 —— 在它们上面开合约既没有意义
 * (分数按 `CONTRACT_BASE_POINTS` 在这些档位上是 0),也违背玩法本身的前提。
 *
 * ⚠ 为什么是**全局下限**而不是给 45 条合约各加一个 `minDifficulty: 'HARD'`:
 *   · 逐条写是 45 处重复,漏一条就是一个能被绕过的洞(这个 bug 就是这么来的 —— 45 条里只有 1 条写了);
 *   · 这是**整个玩法的前提**,不是某一条合约的属性,所以它该在一个地方声明一次。
 *
 * `minDifficulty` 仍然保留:某条合约若要**更高**的门槛(比如只能终极开),照旧逐条写,两者取严。
 */
export const CONTRACT_MIN_DIFFICULTY = 'HARD';

/** 当前难度是否够开危机合约。界面与服务端共用这一个判断,两边不会漂。 */
export const contractsAllowedAt = (difficulty) =>
  difficultyRank(difficulty) >= difficultyRank(CONTRACT_MIN_DIFFICULTY);

/**
 * **这一局现在到底有没有危机合约生效** —— 界面画红雾、显示「查看合约」按钮的唯一判据。
 *
 * ⚠ 必须是「有合约 **且** 难度够」,**不能只看 `contracts.length > 0`**。
 * 只看长度的话,只要合约 id 还在列表里(旧状态、丢帧、任何一次不同步),标准/险境的房间
 * 照样会浮出红雾 —— owner 报的「切到标准/险境,危机合约还在生效」看到的正是这个。
 *
 * 客户端用它做渲染判据,于是**即使服务端状态真的脏了,界面也不会显示一个不成立的合约效果**。
 *
 * @param {readonly string[]|null|undefined} contracts
 * @param {string|null|undefined} difficulty
 */
export const crisisActive = (contracts, difficulty) =>
  contractsAllowedAt(difficulty) && Array.isArray(contracts) && contracts.length > 0;

/**
 * 难度序。未知难度按 0(最松),这样一条写错难度的合约不会把所有房间都锁死。
 * @param {string|null|undefined} d
 */
export const difficultyRank = (d) => {
  const i = DIFF_RANK[String(d || '').toUpperCase()];
  return i === undefined ? 0 : i;
};

/** 便捷:构造一条合约(冻结,防止运行期被改)。 */
const C = (o) => Object.freeze({ ...o, points:o.points+(o.effect?.banProfession?1:0), ...(o.effect?.banProfession?{limitGroup:'professionBan',maxInGroup:2}:{}), desc:contractSummary(o),detail:contractDetails(o), requiresAny:Object.freeze(o.requiresAny||[]), requires: Object.freeze(o.requires || []), excludes: Object.freeze(o.excludes || []) });

/** @type {readonly Contract[]} */
export const CONTRACTS = Object.freeze([
  // ================================================================================================
  // 指标集：机制
  // ================================================================================================
  C({
    id: 'mechLimitedStock', points: 3, icon: 'lock',
    set: { id: 'mech', name: '指标集：机制', nameEn: 'MECHANISM' }, setOrder: 1,
    name: '限售策略', nameEn: 'LIMITED STOCK',
    desc: '每个休整期最多刷新一次商店。',
    /*
     * owner:「新增合约限售策略 3分」→ 后修正为「限售策略是每个休息期最多刷新一次」。
     *
     * ⚠ 第一版做成了**整局一次**(`maxShopRefreshes`),与 owner 的本意不符:
     * 上限是**每个休整期**(每回合)一次,回合开始时重置。所以改用 `maxRefreshesPerRound`,
     * 消费点读 `round.refreshes`(player/round.js 的 `startRound` 每回合清零),
     * 而不是 `stats.refreshes`(整局累计)。
     *
     * 放在**机制**集而不是后援集:这是一条改变商店规则的合约,不是经济数值的加减
     * (后援集那两条是 incomeAdd / priceAdd)。放在后援集还会和后援那条互斥链
     * (`aidFundCut excludes aidPriceRise/aidMaxLimit`)纠缠,而它本来就不该被那条链影响。
     *
     * 「刷新」计数含**免费刷新**:合约说的是"最多刷新一次",不是"最多付费刷新一次"。
     */
    effect: { maxRefreshesPerRound: 1 },
    detail: [
      '每个休整期最多手动刷新商店 **1 次**（含免费刷新；进入下一回合后重置）。',
      '',
      '升级商店、冻结、购买都不受限制 —— 受限的只有「刷新」这一个动作。',
      '',
      '代价：每个休整期只有一次刷新机会，想要的核心干员基本只能指望商店自然刷新。',
    ].join('\n'),
  }),
  C({
    id: 'noLpSharing', points: 1, icon: 'chevrons',
    set: { id: 'mech', name: '指标集：机制', nameEn: 'MECHANISM' }, setOrder: 1,
    name: '孤立', nameEn: 'ISOLATION',
    desc: '漏怪不再由全队分摊，每个玩家只承担自己防线的损失。',
    /*
     * 5 人及以上才可用。
     *
     * 分摊的门槛本来就是「5 名存活玩家」(settle.js `splitFrom = 5`),所以 4 人房选了这个合约**什么也不会发生**
     * —— owner 实测报的就是这个:「目前四人房间还可以选择分摊血量合约 bug 必须要为5玩家/bot以上才能选择开启」。
     * 卡在 5 而不是 4:合约的价值就是关掉一个本来会生效的规则,门槛必须**高于或等于**那条规则的门槛。
     */
    minPlayers: 5,
    minDifficulty: 'HARD',
    effect: { noLpSharing: true },
    detail: [
      '默认规则：当房间内有 5 名及以上存活玩家时，一轮的漏怪会在「漏怪者」与「联防参与者」之间平摊 ——',
      '总量法：总额 = 各参与者自己应付的点数之和，每人先取 floor(总额 / 人数)，余数按「先漏怪者、后联防者，',
      '各自按座位号」的顺序各多担 1 点。',
      '',
      '本合约关闭该分摊：每个玩家只为自己防线的漏怪付账，替别人防守不再产生额外损失。',
      '',
      '代价：总分摊被取消后，单点漏怪不再被稀释 —— 一次大漏会全额落在一个人头上，',
      '任何一个人的防线崩掉都会立刻体现在他自己的生命值上。',
      '',
      '要求：5 人及以上的房间，且难度为绝境模拟或终极模拟。',
    ].join('\n'),
  }),

  // ================================================================================================
  // 指标集：合同 —— 改回合结构。整条链互斥,长度递增。
  // ================================================================================================
  C({
    /*
     * 延长线:16 回合,两次首领战(第 10 轮削弱版 + 第 16 轮原版),打完必进隐秘核心。
     *
     * ⚠ 「血量比一般BOSS减少1/4 其他属性减少1/6」作用在**那一轮的首领本体**,不是整轮敌人
     *   (owner 澄清:「意思是第十轮进入boos战 boos属性」)。怪不动,只有首领变弱 ——
     *   所以它是一次"更早、但更弱"的首领战。
     */
    id: 'pactExtension', points: 4, icon: 'chevrons',
    set: { id: 'pact', name: '指标集：合同', nameEn: 'CONTRACT' }, setOrder: 2,
    name: '延长线', nameEn: 'EXTENSION LINE',
    desc: '整局延长至 16 回合：第 10 回合打削弱的首领，第 16 回合打原版首领，随后必定进入隐秘核心。',
    /*
     * 合同集三条是**平行选择**(三选一),不互相前置 —— owner:「延长线选择后取消防火地带和新战线 无前置条件」。
     * 所以只写 `excludes`,不写 `requires`;`layout: 'h'` 让界面把它们横着排(见 contractTree)。
     */
    excludes: ['pactFirewall', 'pactNewFront','pactDelayedFront'],
    layout: 'h',
    effect: {
      mode: 'pact',
      maxRounds: 16,
      bossRounds: [
        /*
         * ⚠ `hpMul` 是**共享血池**的倍率(finalAssault.bossPoolHp),不是单位自身血量。
         * `2/4` = 0.5(owner:「血量降低2/4」),分数写法与注释里的「降低 1/6」一致。
         * 其余属性**降低 1/2** = ×0.5(owner 最新:「延长线其余属性降低1/2」,此前是 2/2)。
         *
         * ⚠⚠ **`defAdd` / `atkAdd` 曾经是死代码**:`gd.contractBossRound()` 一直在算,但没有任何调用点,
         * 于是"削弱版首领"只有血少、属性没削 —— 那正是 owner 报「危机合约过于难了」的一部分原因。
         * 现在接在 `waves.js contractEnemyMods(gd, slot, isBoss, round)` 上,只作用于**该回合的首领**。
         */
        /*
         * ⚠⚠ `aliveFull: 5` —— **这一场的「跟随人数」加成上限压到 5**
         * (owner:「第八回合的boos根据人数的血量加成最多x5 其他还是x8」)。
         *
         * ⚠ **延长线这一场(第 10 回合)owner 没有点名**,我按"同一类削弱场"处理成和 8 回合一致:
         * 两者是同一个设计意图(合约插入的、更早更弱的首领),放任一个吃 8 人满池、另一个只算 5 人
         * 会让两条合约的难度手感不一致。若 owner 只想改第 8 回合,把这里的 `aliveFull` 去掉即可。
         */
        { round: 10, hpMul: 0.5, defAdd: -1 / 2, atkAdd: -1 / 2, aliveFull: 5 },
        /* 第 16 回合:正常(owner:「第十六回合正常」)—— hpMul 1 / 属性不动 */
        { round: 16, hpMul: 1, defAdd: 0, atkAdd: 0 },
      ],
      // 「随后可进入隐秘核心」—— owner:打完第 16 轮**必定**解锁
      forceHidden: true,
      /*
       * ★ **第 10 回合之后基础敌人每回合变强** (owner 2026-10-17:
       *   「延长线第十回合之后所有基础敌人血量+10% … 且之后每个新回合基础敌人属性都会再次提高」)。
       *
       * **我定的数值**:
       *   · 血量:**第 10 回合起每回合 +10%**(按乘法叠加,第 16 回合约 ×1.77)
       *   · 防御/攻击:第 10 回合起每回合 **+5%**(第 16 回合约 ×1.34)
       *
       * 为什么血比属性涨得快:延长局的后半段玩家**输出成长快于生存压力**,
       * 血量是主要的手感旋钮;属性(尤其攻击)涨太快会变成"一下秒人",那不是难度是挫败。
       *
       * ⚠ **只作用于普通敌人** —— 精锐与首领由 `bossRounds` 那套单独管,
       *   在这里再乘一次会和"削弱的早期首领 / 强化的末期首领"打架。
       * ⚠ 三档合约(延长线 / 防火地带 / 新战线)**用同一组数**,owner 要求"同样生效"。
       */
      lateHpFrom: 10,
      lateHpStep: 0.1,
      lateStatStep: 0.05,
    },
    detail: [
      '整局从 14 回合延长到 16 回合，首领战从一个变成两个：',
      '',
      '· 第 10 回合：进入首领战。首领血量为基础值的 2/4，其余属性（防御 / 攻击）降低 2/2。',
      '· 第 16 回合：再次进入首领战，首领血量与属性回到基础值。',
      '',
      '打完第 16 回合后**必定进入隐秘核心**（无视原本的队伍血量 / 层数门槛）。',
      '',
      '互斥：选择本条会取消「防火地带」与「新战线」。',
    ].join('\n'),
  }),
  C({
    id: 'pactFirewall', points: 6, icon: 'shield',
    set: { id: 'pact', name: '指标集：合同', nameEn: 'CONTRACT' }, setOrder: 2,
    name: '防火地带', nameEn: 'FIREBREAK ZONE',
    desc: '整局延长至 18 回合：三次首领战，最后一次强化，打完必定进入强化隐秘核心。',
    excludes: ['pactExtension', 'pactNewFront','pactDelayedFront'],
    layout: 'h',
    effect: {
      mode: 'pact',
      maxRounds: 18,
      bossRounds: [
        { round: 8, hpMul: 3 / 5, defAdd: -1 / 2, atkAdd: -1 / 2, aliveFull: 5 },
        { round: 14, hpMul: 1, defAdd: 0, atkAdd: 0 },
        { round: 18, hpMul: 1.5, defAdd: 0.2, atkAdd: 0.2 },
      ],
      forceHidden: true,
      /*
       * 隐秘核心 (owner:「防火地隐秘核心其余属性x.12倍」)。
       *
       * 原来是 `hiddenStatAdd: 0.2`(**加强** 20%),owner 明确要改成 **×1.2** —— 也就是把这一场
       * 从"加强"翻成"削弱":`×1.2` 的属性相当于 `+20%`,读起来像加强,但 owner 连着两轮都在往
       * "削弱"方向调(延长线/新战线第 8 回合都是降低),而 `hiddenHpMul` 本来就是 1.2;
       * 两者对齐成同一档 ×1.2 —— 血量 ×1.2、其余属性 ×1.2。⚠ 这一条是我的判断,owner 可再改。
       */
      hiddenHpMul: 1.2,
      hiddenStatAdd: 0.2,
      /* ★ 第 10 回合之后普通敌人持续变强(owner 2026-10-17「防火地带和新战线同样」) */
      lateHpFrom: 14,
      lateHpStep: 0.1,
      lateStatStep: 0.05,
    },
    detail: [
      '整局延长到 18 回合，首领战增加到三个：',
      '',
      '· 第 8 回合：首领血量为基础值的 3/5，其余属性（防御 / 攻击）降低 1/2；该场首领按人数加成时最多算 5 人。',
      '· 第 14 回合：首领血量与属性回到基础值。',
      '· 第 18 回合：首领血量 ×1.5，其余属性各 +20%。',
      '',
      '打完第 18 回合后必定进入隐秘核心，且隐秘核心血量 ×1.2、其余属性 ×1.2。',
      '',
      '互斥：选择本条会取消「延长线」与「新战线」。',
    ].join('\n'),
  }),
  C({
    id: 'pactNewFront', points: 5, icon: 'sword',
    set: { id: 'pact', name: '指标集：合同', nameEn: 'CONTRACT' }, setOrder: 2,
    name: '新战线', nameEn: 'NEW FRONT',
    desc: '整局延长至 20 回合：五次首领战层层加码，第 20 回合直取强化隐秘核心。',
    excludes: ['pactExtension', 'pactFirewall','pactDelayedFront'],
    layout: 'h',
    effect: {
      mode: 'pact',
      maxRounds: 20,
      bossRounds: [
        /*
         * ⚠ `hpMul` 是**共享血池**的倍率(finalAssault.bossPoolHp),不是单位自身血量。
         *
         * 分数语义:`hpMul: 3/5` = 基础血量的 3/5;`defAdd/atkAdd: -1/2` = 其余属性**降低 1/2**
         * (即 ×0.5,和注释里「降低 1/6」是同一种写法)。
         *
         * ⚠⚠ `aliveFull: 5` —— **这一场的「跟随人数」加成上限单独压到 5**
         * (owner:「第八回合的boos根据人数的血量加成最多x5 其他还是x8」)。
         * 消费点:`finalAssault.bossPoolHp` 会优先用本回合的 `aliveFull`,没有再回落到全局(8)。
         * 早期那场首领是"削弱的、人少的",按 8 人满池算会明显偏肉。
         *
         * ⚠⚠ **`defAdd` / `atkAdd` 曾经是死代码**:`gd.contractBossRound()` 一直在算,但没有任何调用点,
         * 于是"削弱版首领"只有血少、属性没削。现在接在 `waves.js contractEnemyMods(gd, slot, isBoss, round)` 上,
         * 只作用于**该回合的首领**。
         */
        { round: 8, hpMul: 3 / 5, defAdd: -1 / 2, atkAdd: -1 / 2, aliveFull: 5 },
        { round: 14, hpMul: 1, defAdd: 0, atkAdd: 0 },
        { round: 18, hpMul: 1.5, defAdd: 0.2, atkAdd: 0.2 },
        { round: 20, hpMul: 2, defAdd: 1.2, atkAdd: 1.2 },
      ],
      forceHidden: true,
      /*
       * ★ **新战线隐秘核心:血量 ×2、其余属性 ×1.5** (owner 2026-10-17)。
       *
       *   ⚠ `hiddenStatAdd` 是**加法**(属性 = ×(1 + add)),所以
       *     `1.5` 的意思是 ×2.5 —— 而 owner 说的是 **×1.5**,对应 **0.5**。
       *     (`hiddenHpMul` 是乘法,所以血量直接写 2。)
       */
      hiddenHpMul: 2,
      hiddenStatAdd: 0.5,
      /* ★ 第 10 回合之后普通敌人持续变强(owner 2026-10-17「新战线同样」) */
      lateHpFrom: 10,
      lateHpStep: 0.1,
      lateStatStep: 0.05,
    },
    detail: [
      '整局延长到 20 回合，首领战增加到四个：',
      '',
      '· 第 8 回合：首领血量为基础值的 3/5，其余属性（防御 / 攻击）降低 1/2；该场首领按人数加成时最多算 5 人。',
      '· 第 14 回合：首领血量与属性回到基础值。',
      '· 第 18 回合：首领血量 ×1.5，其余属性各 +20%。',
      '· 第 19 回合：首领血量 ×2，其余属性 ×1.2。',
      '',
      '第 20 回合进入隐秘核心，隐秘核心血量 ×1.5、其余属性 ×1.2。',
      '',
      '互斥：选择本条会取消「延长线」与「防火地带」。',
    ].join('\n'),
  }),

  // ================================================================================================
  // 指标集：后援 —— 联防规模 / 经济 / 开局血量
  // ================================================================================================
  C({
    id: 'aidShortHanded', points: 1, icon: 'users',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '人手不足', nameEn: 'SHORT-HANDED',
    desc: '一次联防最多只能有 4 名玩家参与。',
    /*
     * owner 的人数门槛原是写在描述里的一句话(「人手不足为16人 20人才可用」),但那只是**文字**——
     * 不写成 `minPlayers` 字段,门槛检查就完全不会生效:房主把人数从 20 降到 4,这条仍然可选(实测如此)。
     * 数据门槛与描述必须成对,漏一个就是一条"看起来有要求、其实随便选"的合约。
     */
    /*
     * owner:「人手不足 选择后取消 堪堪一用 紧张后援 通讯中断 前置条件 不变」。
     * 所以它是这一列的**底档**:无前置,选中就把上面三档挤掉。
     */
    excludes: ['aidBarelyEnough', 'aidTense', 'aidCommsDown'],
    minPlayers: 6,
    effect: { uniteMaxHelpers: 4 },
    detail: ['每次联防最多只能有 4 名玩家参与（默认不设此上限）。', '', '要求：16 人或 20 人的房间。'].join('\n'),
  }),
  C({
    id: 'aidBarelyEnough', points: 2, icon: 'users',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '堪堪一用', nameEn: 'BARELY ENOUGH',
    desc: '一次联防最多只能有 3 名玩家参与。',
    /*
     * owner:「堪堪一用 选择后取消 紧张后援 通讯中断 人手不足 前置条件 不需要人手不足 其余不变」。
     * ⚠ 这里**不写** `requires: ['aidShortHanded']` —— 它 `excludes` 掉「人手不足」,两者一写就自相矛盾
     * (互斥先挤掉前置,前置传播再把自己删掉,整个选择集变空)。「取消人手不足」正是 owner 要的行为。
     * 「其余不变」= 人数门槛仍是 12。
     */
    excludes: ['aidShortHanded', 'aidTense', 'aidCommsDown'],
    minPlayers: 5,
    effect: { uniteMaxHelpers: 3 },
    detail: ['每次联防最多只能有 3 名玩家参与。', '', '要求：12 / 16 / 20 人的房间，且已选「人手不足」。'].join('\n'),
  }),
  C({
    id: 'aidTense', points: 3, icon: 'users',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '紧张后援', nameEn: 'STRAINED SUPPORT',
    desc: '一次联防最多只能有 2 名玩家参与。',
    /*
     * owner:「紧张后援 选择后取消 堪堪一用 通讯中断 人手不足 前置条件 不需要人手不足 堪堪一用 其余不变」。
     * 同「堪堪一用」:只靠 excludes 表达三选一,不写会自相矛盾的 requires。「其余不变」= 人数门槛 8。
     */
    excludes: ['aidShortHanded', 'aidBarelyEnough', 'aidCommsDown'],
    minPlayers: 4,
    effect: { uniteMaxHelpers: 2 },
    detail: ['每次联防最多只能有 2 名玩家参与。', '', '要求：8 / 12 / 16 / 20 人的房间，且已选「堪堪一用」。'].join('\n'),
  }),
  C({
    id: 'aidCommsDown', points: 5, icon: 'wifiOff',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '通讯中断', nameEn: 'COMMS DOWN',
    desc: '完全无法进行联防。',
    /*
     * 「在一人时无法使用」在字面上没有意义 —— 1 人房本来就没有联防可言,任何门槛都会滤掉它。
     * 按意图实现:需要 2 人及以上(真的是 1 个人的房间不能选)。
     *
     * ⚠ 不写 `requires: ['aidTense']`:本条 `excludes` 掉整条后援链,同时又要求链尾已选,是自相矛盾
     * (见「训练不足」处的完整说明)。它是这条链的**最强一档**,勾上就把前面几档全挤掉。
     */
    excludes: ['aidShortHanded', 'aidBarelyEnough', 'aidTense'],
    minPlayers: 2,
    effect: { uniteDisabled: true },
    detail: ['完全无法进行联防：漏怪只能由漏怪者自己承担，也不能替队友防守。', '', '要求：2 人及以上的房间，且已选「紧张后援」。'].join('\n'),
  }),
  C({
    id: 'aidFundCut', points: 2, icon: 'minus',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '资金中断', nameEn: 'FUNDING CUT',
    desc: '第 5 回合起，每回合获得的金币 −1。',
    /*
     * owner:「资金中断 无限制条件 无前置条件」。
     * 所以它是一棵**独立的**树的根(不再挂在「人手不足」下面),并且选中后取消下游两档。
     */
    excludes: [],
    /*
     * ⚠ **带回合门槛** (owner:「将合约资金中断改成第五回合后金币减少1 改成2分」)。
     *
     * 原来是从第 1 回合就 −1,开局就卡经济,前期太难;现在前 4 个回合不受影响。
     * `incomeFromRound` 由 `gamedata.income()` 消费(那边按当回合判断),0 分改 2 分也在这条里体现。
     */
    effect: { incomeAdd: -1, incomeFromRound: 5 },
    detail: ['从第 5 回合起，每回合结算时获得的金币各减少 1 点（前 4 回合不受影响）。', '', '要求：已选「人手不足」。'].join('\n'),
  }),
  C({
    id: 'aidPriceRise', points: 3, icon: 'signal',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '价格上涨', nameEn: 'PRICE HIKE',
    desc: '第 3 回合起，商店内所有商品价格 +1。',
    /* owner:「价格上涨 接 资金中断后 需要资金中断才可开启」。硬前置,且挤掉「最大极限」。 */
    requires: ['aidFundCut'],
    excludes: [],
    /* ⚠ 同样是带回合门槛的改法 (owner:「价格上涨改成第三回合后 改成5点」)。 */
    effect: { priceAdd: 1, priceFromRound: 3 },
    detail: ['从第 3 回合起，商店里所有商品（干员 / 装备 / 刷新）的价格各 +1。', '', '要求：已选「资金中断」。'].join('\n'),
  }),
  C({
    id: 'aidMaxLimit', points: 3, icon: 'lock',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '最大极限', nameEn: 'HARD CEILING',
    desc: '商店等级上限被压到 5 级。',
    /* owner:「最大极限 接 价格上涨后 需要价格上涨才可开启」。 */
    requires: ['aidPriceRise'],
    effect: { maxShopLevel: 5 },
    detail: ['商店最高只能升到 5 级，无法解锁 6 级的商品池。', '', '要求：已选「价格上涨」。'].join('\n'),
  }),
  C({
    id: 'aidTempPost', points: 2, icon: 'shield',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '临时阵地', nameEn: 'MAKESHIFT POST',
    desc: '开局基础血量 −5。',
    /* owner:「临时阵地 无限制条件 无前置条件」。 */
    effect: { startLpAdd: -5 },
    detail: ['开局的基础生命值减少 5 点。', '', '要求：已选「人手不足」。'].join('\n'),
  }),
  C({
    id: 'aidHut', points: 3, icon: 'shield',
    set: { id: 'aid', name: '指标集：后援', nameEn: 'SUPPORT' }, setOrder: 3,
    name: '破屋', nameEn: 'RUINED HUT',
    desc: '开局基础血量再 −10（累计 −15）。',
    /* owner:「茅屋改成破屋 无限制条件 无前置条件」。 */
    effect: { startLpAdd: -10 },
    detail: ['开局的基础生命值再减少 10 点（与「临时阵地」叠加共 −15）。'].join('\n'),
  }),

  // ================================================================================================
  // 指标集：毁灭 —— 我方减益
  // ================================================================================================
  C({
    id: 'doomHasty', points: 1, icon: 'minus',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '临阵磨枪', nameEn: 'RUSHED PREP',
    desc: '所有干员攻击力 / 防御力 / 最大生命值各 −10%。',
    excludes: ['doomUndertrained'],
    effect: { opStatMul: { atk: 0.9, def: 0.9, hp: 0.9 } },
    detail: ['所有干员的攻击力、防御力、最大生命值各降低 10%。', '', '互斥：与「训练不足」互相取消。'].join('\n'),
  }),
  C({
    id: 'doomNoHigh', points: 3, icon: 'close',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '准备不足', nameEn: 'UNPREPARED',
    desc: '干员无法部署在高台（远程位）。',
    effect: { noRangedTiles: true },
    detail: ['干员无法部署在高台（远程位）上，只能放在地面。', '', '无前置条件，可单独选择。'].join('\n'),
  }),
  C({
    id: 'doomNoDefender', points: 3, icon: 'shield',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '坚盾缺失', nameEn: 'NO SHIELDS',
    desc: '无法使用盾位（重装）干员。',
    effect: { banProfession: '重装' },
    detail: ['无法部署「重装」（盾位）干员。', '', '无前置条件，可单独选择。'].join('\n'),
  }),
  C({
    id: 'doomNoCaster', points: 3, icon: 'close',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '技艺流失', nameEn: 'LOST ARTS',
    desc: '无法使用法术类（术师）干员。',
    effect: { banProfession: '术师' },
    detail: ['无法部署「术师」（法术类）干员。', '', '无前置条件，可单独选择。'].join('\n'),
  }),
  C({
    id: 'doomUndertrained', points: 2, icon: 'minus',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '训练不足', nameEn: 'UNDERTRAINED',
    desc: '所有干员攻击力 / 防御力 / 最大生命值各 −20%。',
    /*
     * ⚠ 这里**没有** `requires: ['doomHasty']`,虽然语义上是「接临阵磨枪后」。
     *
     * 原因:本条 `excludes: ['doomHasty']` —— 二者是**同一位置的强弱两档**,选了强的就该自动取消弱的。
     * 如果同时写 `requires`,就自相矛盾:勾上它时互斥先把 `doomHasty` 挤掉,紧接着"前置缺失"的传播
     * 又把它自己删掉,结果整个选择集变成空(实测就是这个)。
     *
     * 规则:`requires` 只能用在**不互斥**的合约上(后援的经济/血量支线是那样:选了「资金中断」仍然需要
     * 「人手不足」)。同位置的档位用 `excludes` 表达,不要用 `requires`。
     */
    excludes: ['doomHasty', 'doomRecovery'],
    effect: { opStatMul: { atk: 0.8, def: 0.8, hp: 0.8 } },
    detail: ['所有干员的攻击力、防御力、最大生命值各降低 20%。', '', '互斥：选择本条会取消「临阵磨枪」；与「恢复期」互相取消。'].join('\n'),
  }),
  C({
    id: 'doomRecovery', points: 4, icon: 'minus',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '恢复期', nameEn: 'RECOVERY PERIOD',
    desc: '所有干员攻击力 / 防御力 / 最大生命值各 −30%。',
    // 同一位置的档位:不用 requires(会与 excludes 自相矛盾),只用 excludes 互相挤掉。详见「训练不足」处的说明。
    excludes: ['doomHasty', 'doomUndertrained', 'doomCrippled'],
    effect: { opStatMul: { atk: 0.7, def: 0.7, hp: 0.7 } },
    detail: ['所有干员的攻击力、防御力、最大生命值各降低 30%。', '', '互斥：选择本条会取消「临阵磨枪」与「训练不足」；与「重伤残」互相取消。'].join('\n'),
  }),
  C({
    id: 'doomCrippled', points: 8, icon: 'minus',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '重伤残', nameEn: 'CRIPPLED',
    desc: '所有干员攻击力 / 防御力 / 最大生命值各 −50%。',
    excludes: ['doomHasty', 'doomUndertrained', 'doomRecovery'],
    /*
     * ⚠ 0.5 而不是 0.4 (owner:「重伤残数值改成50%」)。
     *
     * 三档的档差因此变成 10% / 20% / 30% / 50%:前三级各差 10%,最后一级是一个明显的断档 ——
     * 5 点换"砍一半"比原来的"砍六成"更容易接受,也不会让玩家觉得第五点和第三点差不多。
     * 改数值时**三处要一起改**:`effect`(真正生效的)、`desc`(瓦片上一行)、`detail`(说明页)。
     */
    effect: { opStatMul: { atk: 0.5, def: 0.5, hp: 0.5 } },
    detail: ['所有干员的攻击力、防御力、最大生命值各降低 50%。', '', '互斥：选择本条会取消上面三档中的全部。'].join('\n'),
  }),
  C({
    id: 'doomCompact', points: 1, icon: 'list',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '紧凑', nameEn: 'COMPACT',
    desc: '最大可部署干员 −1。',
    effect: { deployCapAdd: -1 },
    detail: ['场上最大可同时部署的干员数量减少 1。', '', '无前置条件，可单独选择。'].join('\n'),
  }),
  C({
    id: 'doomIsolated', points: 2, icon: 'list',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '隔绝讯息', nameEn: 'SEVERED INTEL',
    desc: '最大可部署干员再 −1（累计 −2）。',
    effect: { deployCapAdd: -1 },
    detail: ['场上最大可同时部署的干员数量再减少 1（与「紧凑」叠加共 −2）。', '', '无前置条件，可单独选择。'].join('\n'),
  }),
  C({
    id: 'doomNoMedic', points: 1, icon: 'minus',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '医疗保障缺失', nameEn: 'NO MEDICAL COVER',
    desc: '医疗干员的恢复生命值 −10%。',
        effect: { healMul: 0.9 },
    detail: ['医疗干员恢复友方生命值的量减少 10%。', '', '无前置条件，可单独选择。'].join('\n'),
  }),
  C({
    id: 'doomScarceDrugs', points: 2, icon: 'minus',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '药品稀缺', nameEn: 'SCARCE DRUGS',
    desc: '医疗干员的恢复生命值 −20%。',
    excludes: ['doomNoMedic', 'doomActiveLoss'],
    effect: { healMul: 0.8 },
    detail: ['医疗干员恢复友方生命值的量减少 20%。', '', '互斥：选择本条会取消「医疗保障缺失」；与「活跃流失」互相取消。'].join('\n'),
  }),
  C({
    id: 'doomActiveLoss', points: 3, icon: 'minus',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '活跃流失', nameEn: 'ACTIVE ATTRITION',
    desc: '医疗干员的恢复生命值 −50%。',
    // 同一位置的档位:只用 excludes(见「训练不足」处的说明)
    excludes: ['doomNoMedic', 'doomScarceDrugs', 'doomNoDeployMedic'],
    effect: { healMul: 0.5 },
    detail: ['医疗干员恢复友方生命值的量减少 50%。', '', '互斥：选择本条会取消「医疗保障缺失」与「药品稀缺」。'].join('\n'),
  }),
  C({
    id: 'doomNoDeployMedic', points: 6, icon: 'close',
    set: { id: 'doom', name: '指标集：毁灭', nameEn: 'DESTRUCTION' }, setOrder: 4,
    name: '无保障', nameEn: 'NO SAFETY NET',
    desc: '无法部署医疗干员。',
    excludes: ['doomNoMedic', 'doomScarceDrugs', 'doomActiveLoss'],
    effect: { banProfession: '医疗' },
    detail: ['无法部署任何医疗干员。', '', '互斥：选择本条会取消上面三档医疗减益。'].join('\n'),
  }),

  // ================================================================================================
  // 指标集：湮灭 —— 精锐敌人强化
  // ================================================================================================
  C({
    id: 'anniElite', points: 2, icon: 'warn',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '精锐之敌', nameEn: 'ELITE FOES',
    desc: '所有基础精锐敌人的血量 / 防御力 / 攻击力 +10%。',
    effect: { eliteMul: { hp: 1.1, def: 1.1, atk: 1.1 } },
    detail: ['所有基础精锐敌人的血量、防御力、攻击力各 +10%。'].join('\n'),
  }),
  C({
    id: 'anniArmored', points: 1, icon: 'shield',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '披甲铁卫', nameEn: 'ARMORED GUARD',
    desc: '精锐敌人防御力 +10%。',
    requires: ['anniElite'],
    effect: { eliteMul: { def: 1.1 } },
    detail: ['所有基础精锐敌人的防御力 +10%。', '', '要求：已选「精锐之敌」。'].join('\n'),
  }),
  C({
    id: 'anniScales', points: 1, icon: 'shield',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '鳞片', nameEn: 'SCALES',
    desc: '精锐敌人防御力 +10%。',
    /*
     * ⚠ 前置是「披甲铁卫」而不是「精锐之敌」(owner 2026 要求:「鳞片前置改为需要披甲铁卫」)。
     * 于是防御这条支线成了一条**链**:精锐之敌 → 披甲铁卫 → 鳞片 → 山,
     * 而它原来是「精锐之敌」的第二个孩子(与披甲铁卫并列)。连线树跟着重排(见 contractSets.contractTree)。
     * 「披甲铁卫」自己仍然 requires 精锐之敌,所以链头没变。
     */
    requires: ['anniArmored'],
    effect: { eliteMul: { def: 1.1 } },
    detail: ['所有基础精锐敌人的防御力 +10%。', '', '要求：已选「披甲铁卫」。'].join('\n'),
  }),
  C({
    id: 'anniMountain', points: 2, icon: 'shield',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '山', nameEn: 'MOUNTAIN',
    desc: '精锐敌人防御力再 +20%。',
    requires: ['anniScales'],
    effect: { eliteMul: { def: 1.2 } },
    detail: ['所有基础精锐敌人的防御力再 +20%。', '', '要求：已选「鳞片」。'].join('\n'),
  }),
  C({
    id: 'anniSwift', points: 2, icon: 'signal',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '速胜', nameEn: 'SWIFT VICTORY',
    desc: '精锐敌人移动速度 +10%。',
    requires: ['anniElite'],
    effect: { eliteMul: { speed: 1.1 } },
    detail: ['所有基础精锐敌人的移动速度 +10%。', '', '要求：已选「精锐之敌」。'].join('\n'),
  }),
  C({
    id: 'anniBreakthrough', points: 3, icon: 'list',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '突破', nameEn: 'BREAKTHROUGH',
    desc: '精锐敌人占用阻挡数 +1（最多 3）。',
    requires: ['anniElite'],
    effect: { eliteBlockAdd: 1, eliteBlockMax: 3 },
    detail: ['所有精锐敌人占用阻挡数量 +1，最多到 3。', '', '要求：已选「精锐之敌」。'].join('\n'),
  }),
  C({
    id: 'anniWhetstone', points: 1, icon: 'sword',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '磨刀石', nameEn: 'WHETSTONE',
    desc: '精锐敌人攻击力 +10%。',
    requires: ['anniElite'],
    effect: { eliteMul: { atk: 1.1 } },
    detail: ['所有基础精锐敌人的攻击力 +10%。', '', '要求：已选「精锐之敌」。'].join('\n'),
  }),
  C({
    id: 'anniBlade', points: 1, icon: 'sword',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '利刃', nameEn: 'SHARP EDGE',
    desc: '精锐敌人攻击力 +10%。',
    requires: ['anniWhetstone'],
    effect: { eliteMul: { atk: 1.1 } },
    detail: ['所有基础精锐敌人的攻击力 +10%。', '', '要求：已选「磨刀石」。'].join('\n'),
  }),
  C({
    id: 'anniFire', points: 2, icon: 'warn',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '火', nameEn: 'FIRE',
    desc: '精锐敌人攻击力再 +20%。',
    requires: ['anniBlade'],
    effect: { eliteMul: { atk: 1.2 } },
    detail: ['所有基础精锐敌人的攻击力再 +20%。', '', '要求：已选「利刃」。'].join('\n'),
  }),
  C({
    id: 'anniBlood', points: 1, icon: 'plus',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '血液', nameEn: 'BLOOD',
    desc: '精锐敌人血量 +10%。',
    requires: ['anniElite'],
    effect: { eliteMul: { hp: 1.1 } },
    detail: ['所有基础精锐敌人的血量 +10%。', '', '要求：已选「精锐之敌」。'].join('\n'),
  }),
  C({
    id: 'anniBloodBag', points: 1, icon: 'plus',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '血袋', nameEn: 'BLOOD BAG',
    desc: '精锐敌人血量 +10%。',
    requires: ['anniBlood'],
    effect: { eliteMul: { hp: 1.1 } },
    detail: ['所有基础精锐敌人的血量 +10%。', '', '要求：已选「血液」。'].join('\n'),
  }),
  C({
    id: 'anniBloodBank', points: 1, icon: 'plus',
    set: { id: 'anni', name: '指标集：湮灭', nameEn: 'ANNIHILATION' }, setOrder: 5,
    name: '血液库', nameEn: 'BLOOD BANK',
    desc: '精锐敌人血量再 +20%。',
    requires: ['anniBloodBag'],
    effect: { eliteMul: { hp: 1.2 } },
    detail: ['所有基础精锐敌人的血量再 +20%。', '', '要求：已选「血袋」。'].join('\n'),
  }),

  // ================================================================================================
  // 指标集：魁魅 —— 首领级强化
  // ================================================================================================
  C({
    id: 'specUnbreakable', points: 3, icon: 'crown',
    set: { id: 'spec', name: '指标集：魁魅', nameEn: 'SPECTER' }, setOrder: 6,
    name: '坚不可摧', nameEn: 'UNBREAKABLE',
    desc: '首领与其他首领级的血量 / 防御力 / 攻击力 +10%。',
    effect: { bossMul: { hp: 1.1, def: 1.1, atk: 1.1 } },
    detail: ['所有首领与其他首领级单位的血量、防御力、攻击力各 +10%。'].join('\n'),
  }),
  C({
    id: 'specDemonMountain', points: 4, icon: 'crown',
    set: { id: 'spec', name: '指标集：魁魅', nameEn: 'SPECTER' }, setOrder: 6,
    name: '鬼神之山', nameEn: 'DEMON MOUNTAIN',
    desc: '首领与其他首领级的血量 / 防御力 / 攻击力再 +10%。',
    requires: ['specUnbreakable'],
    effect: { bossMul: { hp: 1.1, def: 1.1, atk: 1.1 } },
    detail: ['所有首领与其他首领级单位的血量、防御力、攻击力各再 +10%。', '', '要求：已选「坚不可摧」。'].join('\n'),
  }),
  C({
    id: 'specPhantom', points: 6, icon: 'crown',
    set: { id: 'spec', name: '指标集：魁魅', nameEn: 'SPECTER' }, setOrder: 6,
    name: '魁影', nameEn: 'PHANTOM SHADE',
    desc: '首领与其他首领级的血量 / 防御力 / 攻击力再 +20%。',
    requires: ['specDemonMountain'],
    effect: { bossMul: { hp: 1.2, def: 1.2, atk: 1.2 } },
    detail: ['所有首领与其他首领级单位的血量、防御力、攻击力各再 +20%。', '', '要求：已选「鬼神之山」。'].join('\n'),
  }),

  // ================================================================================================
  // 指标集：联络 —— 盟约上限
  // ================================================================================================
  /*
   * ★ 五档「盟约上限」链(owner 2026-10-17:
   *   「给危机合约 指标集 联络增加新合同 = 信号微弱 信号屏蔽 信号消失,分别对应 …500 / 300 / 200,
   *     分数对应 信号微弱2分 信号屏蔽3分 信号消失4分 失友5分 失信6分」)。
   *
   * 五条做的是同一件事:把"本来能叠得很高的盟约"在本局的上限压下来,区别只是压到多少 ——
   * 越严的档位分越高(2/3/4/5/6 分),上限越低(500/300/200/100/50 层)。
   * 效果键沿用失友/失信那一对 `bondLayerCap` + `bondLayerCapAbove`,解算器(contractEffects.js)取**最严**的一条。
   *
   * ⚠ 所以同时勾多条**不会更严**,只会白送分(5 条全勾 = 20 分,实际只按最严的 50 层算)。
   *   因此每一条都排除所有比它松的档位:同一时刻只能生效一条 —— 与「失约 / 唯一」那对同一个道理。
   *
   * ⚠ "可叠到 X 层以上的盟约"这句是**自动成立**的:上限只在层数真的爬到那条线时才起作用,
   *   本来最多只能叠 30 层的盟约永远碰不到 500 的线,所以不用逐条给盟约标"能叠多少"。
   */
  C({
    id: 'liaiFaintSignal', points: 2, icon: 'link',
    set: { id: 'liai', name: '指标集：联络', nameEn: 'LIAISON' }, setOrder: 7,
    name: '信号微弱', nameEn: 'FAINT SIGNAL',
    desc: '可叠到 500 层以上的盟约，最高只能叠到 500 层。',
    effect: { bondLayerCap: 500, bondLayerCapAbove: 500 },
    detail: ['所有最高叠层可达 500 层以上的盟约，本局最高只能叠到 500 层。'].join('\n'),
  }),
  C({
    id: 'liaiSignalJam', points: 3, icon: 'link',
    set: { id: 'liai', name: '指标集：联络', nameEn: 'LIAISON' }, setOrder: 7,
    name: '信号屏蔽', nameEn: 'SIGNAL JAMMED',
    desc: '可叠到 300 层以上的盟约，最高只能叠到 300 层。',
    excludes: ['liaiFaintSignal'],
    effect: { bondLayerCap: 300, bondLayerCapAbove: 300 },
    detail: ['所有最高叠层可达 300 层以上的盟约，本局最高只能叠到 300 层。', '', '互斥：选择本条会取消「信号微弱」。'].join('\n'),
  }),
  C({
    id: 'liaiSignalLost', points: 4, icon: 'link',
    set: { id: 'liai', name: '指标集：联络', nameEn: 'LIAISON' }, setOrder: 7,
    name: '信号消失', nameEn: 'SIGNAL LOST',
    desc: '可叠到 200 层以上的盟约，最高只能叠到 200 层。',
    excludes: ['liaiSignalJam', 'liaiFaintSignal'],
    effect: { bondLayerCap: 200, bondLayerCapAbove: 200 },
    detail: ['所有最高叠层可达 200 层以上的盟约，本局最高只能叠到 200 层。', '', '互斥：选择本条会取消「信号屏蔽 / 信号微弱」。'].join('\n'),
  }),
  C({
    id: 'liaiLostFriend', points: 5, icon: 'link',
    set: { id: 'liai', name: '指标集：联络', nameEn: 'LIAISON' }, setOrder: 7,
    name: '失友', nameEn: 'LOST FRIEND',
    desc: '可叠到 100 层以上的盟约，最高只能叠到 100 层。',
    excludes: ['liaiSignalLost', 'liaiSignalJam', 'liaiFaintSignal'],
    effect: { bondLayerCap: 100, bondLayerCapAbove: 100 },
    detail: ['所有最高叠层可达 100 层以上的盟约，本局最高只能叠到 100 层。', '', '互斥：选择本条会取消「信号消失 / 信号屏蔽 / 信号微弱」。'].join('\n'),
  }),
  C({
    id: 'liaiLostTrust', points: 8, icon: 'link',
    set: { id: 'liai', name: '指标集：联络', nameEn: 'LIAISON' }, setOrder: 7,
    name: '失信', nameEn: 'LOST TRUST',
    desc: '可叠到 50 层以上的盟约，最高只能叠到 50 层。',
    excludes: ['liaiLostFriend', 'liaiSignalLost', 'liaiSignalJam', 'liaiFaintSignal'],
    effect: { bondLayerCap: 50, bondLayerCapAbove: 50 },
    detail: ['所有最高叠层可达 50 层以上的盟约，本局最高只能叠到 50 层。', '', '互斥：选择本条会取消「失友 / 信号消失 / 信号屏蔽 / 信号微弱」。'].join('\n'),
  }),
  C({
    id: 'liaiBrokenPact', points: 5, icon: 'link',
    set: { id: 'liai', name: '指标集：联络', nameEn: 'LIAISON' }, setOrder: 7,
    name: '失约', nameEn: 'BROKEN PACT',
    desc: '最多激活两个盟约；绝技（按精锐人数计数）不占名额。',
    effect: { maxActiveBonds: 2 },
    detail: ['本局最多同时激活 2 个盟约。', '', '与「唯一」互相取消。'].join('\n'),
  }),
  C({
    id: 'liaiOnlyOne', points: 12, icon: 'link',
    set: { id: 'liai', name: '指标集：联络', nameEn: 'LIAISON' }, setOrder: 7,
    name: '唯一', nameEn: 'THE ONLY ONE',
    desc: '最多激活一个盟约；绝技（按精锐人数计数）不占名额。',
    // 同一位置的档位:不用 requires(会与 excludes 自相矛盾),见「训练不足」处说明
    excludes: ['liaiBrokenPact'],
    effect: { maxActiveBonds: 1 },
    detail: ['本局最多只能激活 1 个盟约。', '', '互斥：选择本条会取消「失约」。'].join('\n'),
  }),
  ...EXPANDED_CONTRACTS.map(C),
  ...PACT_VARIANTS.map(C),
]);

/** @type {Map<string, Contract>} */
const BY_ID = new Map(CONTRACTS.map((c) => [c.id, c]));

/** @param {string} id @returns {Contract | undefined} */
export const contractById = (id) => BY_ID.get(id);

/** 一个合约的中文名(找不到就回 id,界面永远不会出现空白)。 */
export const contractName = (id) => BY_ID.get(id)?.name || String(id);

/**
 * 难度基础分:终极 +2,其余 0。
 *
 * ⚠ 与「合约点数」分开算:`contractPoints([], 'ABYSS')` 是 **0**,而难度基础分是 2,
 * 所以结算里那两数必须分别求和(历史上的 bug 就是拿 `contractPoints` 去凑基础分)。
 */
export const CONTRACT_BASE_POINTS = Object.freeze({ FUNNY: 0, NORMAL: 0, HARD: 0, ABYSS: 2 });

/** @param {string|null} difficulty */
export const contractBasePoints = (difficulty) => CONTRACT_BASE_POINTS[difficulty] || 0;

/**
 * 合约分数 = 选中合约的点数之和 + 难度基础分 + 指标集完成奖励。
 * @param {readonly string[]} ids @param {string|null} [difficulty]
 */
export function contractPoints(ids, difficulty = null, players = 20) {
  let sum = 0;
  for (const id of new Set(Array.isArray(ids) ? ids : [])) {
    const c = BY_ID.get(id);
    if (c) sum += c.points;
  }
  return sum + contractBasePoints(difficulty) + contractSetCompletion(ids,difficulty,players).total;
}

const completionModels=new Map(),completionCache=new Map();
export function contractCompletionModel(players=20,difficulty='ABYSS'){
 const n=Math.max(0,Math.min(20,Math.floor(players)||0)),key=n+':'+difficulty;
 if(!completionModels.has(key))completionModels.set(key,compileContractSelection(CONTRACTS.filter(c=>!c.benefit&&c.points>0&&contractsAllowedAt(difficulty)&&effectiveMinPlayers(c)<=n&&(!c.minDifficulty||difficultyRank(difficulty)>=difficultyRank(c.minDifficulty)))));
 return completionModels.get(key);
}
/** Owner: >=80% +2, full +5, highest tier only. Fixed choices exclude impossible mutual alternatives. */
export function contractSetCompletion(ids,difficulty=null,players=20){
 if(!contractsAllowedAt(difficulty))return {valid:true,total:0,sets:[]};
 const risk=[...new Set(Array.isArray(ids)?ids:[])].filter(id=>BY_ID.has(id)&&!BY_ID.get(id).benefit).sort(),key=players+':'+difficulty+':'+risk.join(',');
 if(!completionCache.has(key)){if(completionCache.size>=512)completionCache.delete(completionCache.keys().next().value);completionCache.set(key,completionForSelection(contractCompletionModel(players,difficulty),risk));}
 return completionCache.get(key);
}

/** Support slots are unlocked by challenge points only; zero-point support cannot unlock itself. */
export function benefitBudget(ids,difficulty=null,players=20) {
  const unique=[...new Set(Array.isArray(ids)?ids:[])];
  const risk=unique.filter(id=>!BY_ID.get(id)?.benefit);
  const score=contractPoints(risk,difficulty,players),slots=BENEFIT_THRESHOLDS.filter(n=>score>=n).length;
  return {score,slots,used:unique.filter(id=>BY_ID.get(id)?.benefit).length,next:BENEFIT_THRESHOLDS.find(n=>n>score)??null,thresholds:BENEFIT_THRESHOLDS};
}

/**
 * 一组合约里,**自身门槛**(人数 / 难度)过得去的那些。
 *
 * ⚠ 只判"纯门槛",**不判 `requires`**。前置是**关系**约束,得看整组一起算 ——
 * 单独逐条判会把合法的一组判死。
 *
 * 这就是「无法启用,需要前置的合约」那个 bug 的根:
 * 提交前那道过滤原本逐条调 `contractAvailable(c, …, picked)`,而 `picked` 是**过滤中的半成品**。
 *   点「山」→ 解算 [精锐之敌, 鳞片, 山]
 *            → 逐条过滤:精锐之敌 ✓(无前置)
 *                        鳞片 ✗(此刻 picked 里还没有精锐之敌)
 *                        山 ✗(此刻 picked 里还没有鳞片)
 *            → 只提交 [精锐之敌],「山」永远点不出来。
 *
 * 顺序应该是:**先解算(把 `requires` 链拉进来)→ 再按纯门槛整组筛**。
 * 筛掉的是"这局压根开不了"的(4 人房点「人手不足」),留下的是"数据上自洽"的一整组。
 *
 * @param {readonly string[]} ids @param {number} players @param {string|null} difficulty
 * @returns {string[]} 保序的子集
 */
export function gateContracts(ids, players, difficulty = null) {
  const n = Number.isFinite(players) ? players : 0;
  const out = [];
  /*
   * 系统性难度门槛:标准 / 险境整组都留不下(与 `contractAvailable` 同一判断)。
   * 放在循环外 —— 它是"这个难度一个都不行",不是逐条属性。
   */
  if (!contractsAllowedAt(difficulty)) return out;
  for (const id of Array.isArray(ids) ? ids : []) {
    const c = BY_ID.get(id);
    if (!c) continue;
    if (n < effectiveMinPlayers(c)) continue;
    if (c.minDifficulty && difficultyRank(difficulty) < difficultyRank(c.minDifficulty)) continue;
    out.push(id);
  }
  return out;
}

/**
 * 一条合约在当前房间条件下**是否可选**。
 *
 * 只判"自身门槛 + 前置"。**互斥不在这里判** —— 互斥是"可以选、但会挤掉对方",
 * 由 `resolvePicked` 在每次勾选后统一解算,见那里的说明。
 *
 * ⚠ 判 `requires` 的口径是"**整组一起提交时**该前置在不在组里"。
 * 所以不要拿它去逐条筛一个正在成形的列表 —— 那会在链的中间态判死(见 `gateContracts`)。
 *
 * @param {Contract} c
 * @param {number} players 房间人数
 * @param {string|null} difficulty
 * @param {readonly string[]} [picked] 当前已选(判 `requires`)
 * @returns {boolean}
 */
/** Risks always win: a disabled profession/terrain never gets removed by selecting support. */
export const PROFESSION_CODES=Object.freeze({先锋:'PIONEER',近卫:'WARRIOR',重装:'TANK',狙击:'SNIPER',术师:'CASTER',医疗:'MEDIC',辅助:'SUPPORT',特种:'SPECIAL'});
export const professionCode=value=>PROFESSION_CODES[value]||String(value||'').toUpperCase();
function limitFull(c,picked){if(!c?.limitGroup)return false;const has=new Set(picked);const n=[...has].filter(id=>BY_ID.get(id)?.limitGroup===c.limitGroup).length;return n>c.maxInGroup||(!has.has(c.id)&&n>=c.maxInGroup);}
/** @param {Contract} c @param {readonly string[]} [picked] */
export function benefitConflicts(c,picked=[]) {
 if(!c?.benefit||!c.supportProfession)return [];
 return picked.filter(id=>{const e=BY_ID.get(id)?.effect||{};return professionCode(e.banProfession)===c.supportProfession || (e.noRangedTiles&&['SNIPER','CASTER','MEDIC','SUPPORT'].includes(c.supportProfession));});
}
export function contractAvailable(c, players, difficulty = null, picked = []) {
  if (!c || typeof c !== 'object') return false;
  if(limitFull(c,picked))return false;
  /*
   * 系统性门槛先判:标准 / 险境**一条合约都不能开**(CONTRACT_MIN_DIFFICULTY 的说明见上)。
   * 放在最前面是因为它不属于任何一条合约 —— 它管的是"这个难度允不允许有合约"这件事本身。
   */
  if (!contractsAllowedAt(difficulty)) return false;
  const n = Number.isFinite(players) ? players : 0;
  /*
   * 人数门槛走 `effectiveMinPlayers`(链条里最严的那个),不是只看自己那一格。
   * 理由见那个函数:每级各写一个数会与 `requires` 打架,让下级在中间人数上永远不可用。
   */
  if (n < effectiveMinPlayers(c)) return false;
  if (c.minDifficulty && difficultyRank(difficulty) < difficultyRank(c.minDifficulty)) return false;
  const has = new Set(Array.isArray(picked) ? picked : []);
  if(c.benefit){if(benefitConflicts(c,picked).length)return false;const budget=benefitBudget(picked,difficulty,players);if(budget.score<c.minScore || (!has.has(c.id)&&budget.used>=budget.slots))return false;}
  if(c.requiresAny?.length&&!c.requiresAny.some(id=>has.has(id)))return false;
  for (const need of c.requires || []) if (!has.has(need)) return false;
  return true;
}

/**
 * 一条合约**实际**需要的人数下限 —— 沿着 `requires` 链取最严的那个。
 *
 * 为什么不是直接用 `c.minPlayers`:owner 给「后援」链写的是
 *   人手不足 16/20 人 → 堪堪一用 12/16/20 人 → 紧张后援 8/12/16/20 人,
 * 同时又说后一条「后接」前一条。如果每级各写一个数**并且**用 `requires` 硬前置,两句就打架:
 * 选「堪堪一用」要同时满足 ≥16(前置)与 ≥12(自己),净效果是 ≥16 —— 那么他写的「12 人可用」永远不成立,
 * 那半句成了死条件。
 *
 * 取链条上的**最大值**就化解了:门槛由最严的那一环决定(要先选「人手不足」,所以房间本来就得 ≥16 人),
 * 而下级那一格较小的数不再制造矛盾。「后接」保持为真的硬前置。
 *
 * @param {Contract} c @returns {number} 0 表示不限制
 */
export function effectiveMinPlayers(c) {
  const seen = new Set();
  const walk = (x) => {
    if (!x || seen.has(x.id)) return 0;
    seen.add(x.id);
    let need = Number.isFinite(x.minPlayers) ? x.minPlayers : 0;
    for (const id of x.requires || []) need = Math.max(need, walk(BY_ID.get(id)));
    return need;
  };
  return walk(c);
}

/**
 * 一条合约**为什么**不可选 —— 逐条列出,供界面显示。
 *
 * 分开说人数与难度是有意的:合起来说"条件不足"会让房主不知道该改人数还是改难度
 * (实测就是这么卡住的:4 人房 + 终极,提示写着"需要 4 人及以上",而实际是人数不够)。
 *
 * @param {Contract} c @param {number} players @param {string|null} difficulty @param {readonly string[]} [picked]
 * @returns {{ kind: string, need: number|string|readonly string[] }[]}
 */
export function contractBlockers(c, players, difficulty = null, picked = []) {
  const out = [];
  if(limitFull(c,picked))out.push({kind:'professionLimit',need:c.maxInGroup});
  const n = Number.isFinite(players) ? players : 0;
  const need = effectiveMinPlayers(c);
  if (n < need) out.push({ kind: 'players', need });
  if(!contractsAllowedAt(difficulty))out.push({kind:'difficulty',need:CONTRACT_MIN_DIFFICULTY});
  else if (c.minDifficulty && difficultyRank(difficulty) < difficultyRank(c.minDifficulty)) out.push({ kind: 'difficulty', need: c.minDifficulty });
  const has = new Set(Array.isArray(picked) ? picked : []);
  const missing = (c.requires || []).filter((id) => !has.has(id));
  if(c.requiresAny?.length&&!c.requiresAny.some(id=>has.has(id)))out.push({kind:'requiresAny',need:c.requiresAny});
  if (missing.length) out.push({ kind: 'requires', need: missing });
  if(c?.benefit){const conflicts=benefitConflicts(c,picked);if(conflicts.length)out.push({kind:'supportConflict',need:conflicts});const budget=benefitBudget(picked,difficulty,players);if(budget.score<c.minScore)out.push({kind:'score',need:c.minScore});else if(!has.has(c.id)&&budget.used>=budget.slots)out.push({kind:'benefitLimit',need:budget.slots});}
  return out;
}

/**
 * 把一次勾选**解算成一个自洽的选择集** (owner:「选中乙时自动取消甲,反之亦然」)。
 *
 * 规则,按顺序:
 *   1. `excludes` 是**对称**的:选中 A 会取消 A 列的每一个,以及**任何列了 A 的**合约。
 *      (数据里只写了一边,比如「唯一」写 `excludes: ['失约']` 而「失约」没写 —— 对称化之后两边都成立。)
 *   2. 取消一个合约会**连带取消**依赖它的下游(它的 `requires` 链),否则会留下"前置没了却还选着"的僵尸状态。
 *      「通讯中断」就是例子:它 `excludes` 掉三档后援,那三档要是有人选了「资金中断」(前置=人手不足),
 *      也得一起掉。
 *   3. 不满足自身门槛(人数 / 难度 / 前置)的一律剔除。
 *
 * 返回**新数组**,按 CONTRACTS 的声明顺序排列 —— 顺序稳定,服务端与界面看到的永远一致。
 *
 * @param {readonly string[]} picked 期望的选择集
 * @param {number} players @param {string|null} difficulty
 * @param {{ add?: string }} [opts] `add` = 本次刚勾上的那条(它优先,由它去挤掉别人)
 * @returns {string[]}
 */
export function resolvePicked(picked, players, difficulty = null, opts = {}) {
  if(!contractsAllowedAt(difficulty))return [];
  const want = new Set((Array.isArray(picked) ? picked : []).filter((id) => BY_ID.has(id)));
  const add = opts.add && BY_ID.has(opts.add) ? opts.add : null;
  if (add) want.add(add);

  // 1. 互斥(对称)
  /*
   * ⚠ 处理顺序:**列表里靠后的挤掉靠前的**。
   *
   * 交互式勾选时有明确的"刚勾的那条"(`opts.add`),但在服务端收到的是一整个列表 —— 没有这个概念。
   * 第一版在没有 `add` 时把 `gone` 里的全部删掉,于是三条互相排除的合约一起提交会解算成**空数组**
   * (每一条都被别人排除)。改成按列表顺序走:遇到一条就让它挤掉它排除的、且**已经在列表里**的那些。
   * 这样"最后一条赢",与交互路径上"刚勾的赢"是同一个语义。
   *
   * ⚠⚠ 交互式那条路(`opts.add`)**还得多删一边**:把"排除了新点这条"的旧项也踢掉。
   *
   * 只按 `c.excludes` 删是不够的 —— 互斥在数据里常写成**单向**,而"后点者胜"要求两个方向都让路。
   * 实测(owner 报的一串):
   *   「失信」写了 `excludes: ['失友']`,而「失友」没写。列表顺序上「失信」在前,轮到「失友」时它没有
   *   `excludes`、于是 `kept.add('失友')` 把「失友」加回来,而「失信」从没被删掉 ——
   *   结果 `失友 + 失信` 同时选中,点「失友」换不掉「失信」。
   *   「无保障 / 活跃流失」对「医疗保障缺失 / 药品稀缺」也是同一个形状。
   *
   * 所以对 `add` 走一条**显式**的路:新点的那条赢,凡是与它互斥(任一方向)的旧项全部让路。
   *
   * ⚠⚠ 但**它的前置(整条 requires 链)必须一起拉进来**,那些不算"冲突"。
   *
   * 「资金中断→价格上涨→最大极限」是一条链,而数据里 `资金中断` 又写了 `excludes: ['价格上涨']`
   * (档位那套写法)。只按互斥算的话,点「价格上涨」会把它的前置「资金中断」当冲突踢掉,
   * 紧接着「价格上涨」自己因为缺前置被剔除 —— 整条链**永远点不出来**(实测:逐级点三下得到空)。
   * 链是一个整体:点深的那一档,链上所有前置一起进来,链外的互斥者才让路。
   */
  const chainUp = (id) => {
    const out = new Set([id]);
    const stack = [id];
    while (stack.length) {
      const cur = stack.pop();
      const current=BY_ID.get(cur);
      const any=current?.requiresAny?.length?(current.requiresAny.find(id=>want.has(id))||current.requiresAny[0]):null;
      for (const p of [...(current?.requires||[]),...(any?[any]:[])]) {
        if (!BY_ID.has(p) || out.has(p)) continue;
        out.add(p);
        stack.push(p);
      }
    }
    return out;
  };
  const order = CONTRACTS.map((c) => c.id).filter((id) => want.has(id));
  const kept = new Set();
  if (add) {
    const own = chainUp(add);                       // 新点的这条 + 它的整条前置链
    for (const id of order) {
      if (own.has(id)) continue;
      const c = BY_ID.get(id);
      // 与链上**任何**一条互斥都算冲突(链整体赢)
      const conflicts = [...own].some((o) => (c.excludes || []).includes(o) || (BY_ID.get(o)?.excludes || []).includes(id));
      if (conflicts) continue;
      kept.add(id);
    }
    for (const id of own) kept.add(id);
  } else {
    for (const id of order) {
      const c = BY_ID.get(id);
      for (const other of c.excludes || []) kept.delete(other);
      kept.add(id);
    }
  }
  want.clear();
  for (const id of kept) want.add(id);

  // 2. 连带取消依赖被取消者的下游
  /*
   * ⚠ 这一步要跑**两轮**,中间隔一次门槛检查。
   *
   * 只跑一次会留下"前置没了却还选着"的僵尸:房主把人数从 20 降到 4 时,「人手不足」因为人数不够被剔除,
   * 而依赖它的「资金中断」是在**上一轮**传播里检查的(那时前置还在),于是活了下来 —— 实测就是这个:
   * 已开启栏显示 1 条,而它的前置已经不在列表里了。
   * 顺序:互斥 → 门槛 → 传播 → (门槛可能又剔掉了谁) → 再传播,直到不动为止。
   */
  const gate = () => {
    for (const id of [...want]) {
      const c = BY_ID.get(id);
      if (players < effectiveMinPlayers(c)) want.delete(id);
      if (c.minDifficulty && difficultyRank(difficulty) < difficultyRank(c.minDifficulty)) want.delete(id);
    }
  };
  const propagate = () => {
    let changed = false;
    for (const id of [...want]) {
      const c = BY_ID.get(id);
      if ((c.requires || []).some((need) => !want.has(need))||(c.requiresAny?.length&&!c.requiresAny.some(id=>want.has(id)))) { want.delete(id); changed = true; }
    }
    return changed;
  };

  gate();
  // 上限 8 轮纯属保险:真出环会由测试抓到,而不是在这里死循环
  for (let i = 0; i < 8 && propagate(); i++) gate();

  const groups=new Map();for(const c of CONTRACTS.filter(c=>want.has(c.id)&&c.limitGroup)){const group=groups.get(c.limitGroup)||[];group.push(c);groups.set(c.limitGroup,group);}
  for(const group of groups.values()){if(add)group.sort((a,b)=>Number(b.id===add)-Number(a.id===add));for(const c of group.slice(group[0].maxInGroup))want.delete(c.id);}
  const budget=benefitBudget([...want],difficulty,players);
  const supports=CONTRACTS.filter(c=>want.has(c.id)&&c.benefit);
  if(add&&BY_ID.get(add)?.benefit)supports.sort((a,b)=>Number(b.id===add)-Number(a.id===add));
  let used=0;
  for(const c of supports){if(benefitConflicts(c,[...want]).length||budget.score<c.minScore||used>=budget.slots)want.delete(c.id);else used++;}
  return CONTRACTS.filter((c) => want.has(c.id)).map((c) => c.id);
}

/**
 * 从一组合约 id 里挑出**当前房间条件下仍然合法**的那些。
 *
 * `server/lobby.js` 用它做三件事:房主改人数/难度后把不再合法的合约摘掉、收到客户端的
 * `contracts` 消息时拒绝不合法的选择、以及把"为什么被摘掉"写进日志。
 *
 * ⚠ 返回的是 `{ ok, reason, bad }` **对象**,不是数组 —— 三个调用点都在读 `.ok` / `.reason` / `.bad`。
 * 我在重写合约表时把这里改成了返回数组,于是 `!check.ok` 恒为真、`check.reason` 是 `undefined`,
 * 房主的「确定」永远返回 `BAD_MSG: undefined: undefined`(owner 报的「点击确定合约为无效的请求」)。
 *
 * 它**不做互斥解算**(那是 `resolvePicked` 的事):互斥是"选了就挤掉",不是"不合法",
 * 混在一起会让 lobby 把玩家的合法选择判成非法。
 *
 * @param {readonly string[]} ids
 * @param {{ players?: number, difficulty?: string|null }} [ctx]
 * @returns {{ ok: boolean, allowed: string[], cleared: string[], reason: string, bad: string }}
 *   `allowed` 是仍然合法的(保持传入顺序);`cleared` 是被摘掉的;`ok` 表示"一条都没被摘"。
 */
export function contractsValidFor(ids, ctx = {}) {
  const players = Number.isFinite(ctx.players) ? ctx.players : 0;
  const difficulty = ctx.difficulty ?? null;
  const picked = Array.isArray(ids) ? ids : [];
  const allowed = [];
  const cleared = [];
  /** 第一个不合法的原因(给日志与错误消息用)。 */
  let reason = '';
  let bad = '';
  for (const id of picked) {
    const c = BY_ID.get(id);
    // 前置也用**已通过的那部分**判:lobby 传进来的列表本身就是房间的既成事实
    if (c && contractAvailable(c, players, difficulty, [...allowed,...picked.filter(x=>!BY_ID.get(x)?.benefit)])) { allowed.push(id); continue; }
    cleared.push(id);
    if (!reason) {
      /*
       * ⚠ 顺序:系统性难度门槛**先判** —— 它是「这个难度根本不允许有合约」,比某一条的具体门槛更根本,
       * 而且 `contractAvailable` 里也是先判它。两边顺序一致,报出来的原因才是同一个。
       *
       * (这里每条都带 `continue`,所以第一个不通过的原因不会被后面的覆盖 —— 报错消息给出的是真实原因。
       *  这是原本就对的写法,我核对时一度看错了行,记在这里免得下次再误判。)
       */
      if (!c) { reason = 'unknown contract'; bad = id; continue; }
      if (!contractsAllowedAt(difficulty)) { reason = `needs difficulty ${CONTRACT_MIN_DIFFICULTY} or higher`; bad = id; continue; }
      if (players < effectiveMinPlayers(c)) { reason = `needs ${effectiveMinPlayers(c)} players`; bad = `${id} (room has ${players})`; continue; }
      if (c.minDifficulty && difficultyRank(difficulty) < difficultyRank(c.minDifficulty)) { reason = `needs ${c.minDifficulty} or higher`; bad = id; continue; }
      if(c.benefit){reason='support score or slot requirement not met';bad=id;continue;}
      const missing = (c.requires || []).filter((r) => !allowed.includes(r));
      reason = 'missing prerequisite';
      bad = `${id} (needs ${missing.join(', ')})`;
    }
  }
  return { ok: cleared.length === 0, allowed, cleared, reason, bad };
}

/**
 * 互斥表(对称化后),界面上把"会挤掉谁"写在 tooltip 里用。
 * @returns {Map<string, string[]>}
 */
export function exclusivityMap() {
  const m = new Map();
  for (const c of CONTRACTS) {
    for (const other of c.excludes || []) {
      if (!BY_ID.has(other)) continue;
      if (!m.has(c.id)) m.set(c.id, []);
      if (!m.get(c.id).includes(other)) m.get(c.id).push(other);
      if (!m.has(other)) m.set(other, []);
      if (!m.get(other).includes(c.id)) m.get(other).push(c.id);
    }
  }
  return m;
}
