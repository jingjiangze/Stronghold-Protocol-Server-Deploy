import { FACTION_THEMES } from './bossFactions.js';
// shared/bgmTheme.js —— **自适应开战 BGM**:这一场打的是谁,就放谁的曲子。
//
// owner:「假如战斗对方是大炎的怪物就会使用大炎相关的背景音乐 比如矛头 书卷这些」
// 选的是 **C 方案:关卡声明优先,敌人家族兜底**。
//
// ## 三层优先级(高 → 低)
//
//   ① **关卡声明** —— `data/waves.json` 里那一关的 `bgm` 字段(上游本来就有:
//      `"bat_kazimierz2_2"` / `"bat_boss_ancestor"` / …)。它最权威:是**人写的**,不是推的。
//      值就是主题名(见下面 `THEMES` 的键),也可以直接是个旧式的曲子名(解析不到就退回)。
//   ② **敌人家族兜底** —— 这一场的 `spawns[].key`(`enemy_1209_sfden_2`)里那个家族段
//      (`sfden`)命中哪个主题,就放那个。按**出场条目数**投票,最多的赢(见 `electTheme`)。
//   ③ **没有主题** → 返回 `null`,播放器走原来的逻辑(按回合数在 `combatAlts` 里挑)。
//      这是"关掉自适应"的那条路,也是素材没补齐时的安全回落。
//
// ## ⚠ 族名是怎么来的(别当成官方标签)
//
//   敌人数据里**没有"地区/阵营"字段**(`enemies.json` 的 `tags` 只有 10 种玩法标签:
//   sarkaz / drone / machine …)。这些族名是我从**敌人 id 的命名规律**里读出来的:
//   同一族的敌人 id 共享第 3 段,而且名字是同类东西 ——
//       msfshu  小说卷轴、诗画卷轴
//       msfji   铜矛头、铁矛头
//       msfjin  青铜镜、黄铜镜
//       msfzhi  木制镇纸、红木镇纸
//       msfhu   青瓷茶器、彩瓷茶器
//   `sf` / `msf` 前缀那一批就是画中人活动的**文房四宝/雅器**系列,也就是大炎系。
//   这是**读出来的规律,不是官方字段**;要加新主题,照着这个格式往 `THEMES` 里加就行。
//
// ## 为什么单独一个文件
//
//   服务端(选主题)和客户端(播放器)都要用同一张表 —— 放 `shared/` 两边都能 import,
//   而且这份映射只有一处,**不会两边漂**。曲子文件放哪、叫什么都由**清单**说了算
//   (`data/assets.json` 的 `bgm.themes.<主题名>`),换曲子不用动这个文件。

/**
 * 敌人家族前缀 → 主题。一个主题可以有多个族前缀。
 *
 * 键是**主题名**(要和 `data/assets.json` 的 `bgm.themes.<名字>` 对上);
 * `families` 是敌人 id 第 3 段的集合;`from` / `note` 只是给人看的来源说明。
 *
 * @type {ReadonlyArray<{ theme: string, name: string, families: readonly string[], from: string, note?: string }>}
 */
export const THEMES = Object.freeze([
  ...Object.entries({reunion:'整合运动',victoria:'维多利亚',sarkaz:'萨卡兹',leithanien:'莱塔尼亚',sea_born:'海嗣',kazimierz:'卡西米尔',kjerag:'谢拉格',siracusa:'叙拉古',laterano:'拉特兰',iberia:'伊比利亚',siesta:'汐斯塔',sargon:'萨尔贡',bolivar:'玻利瓦尔',durin:'杜林',higashi:'东国',sami:'萨米',columbia:'哥伦比亚',scarlet:'猩红剧团'}).map(([theme,name])=>Object.freeze({theme,name,families:Object.freeze([]),from:'generated enemy affiliations'})),
  Object.freeze({
    theme: 'yan',
    name: '大炎',
    /*
     * 画中人活动的文房雅器系列。`msf*` 是"名师"变体(更高级的那一档),
     * `sf*` 是普通档;两批都要,否则只认走一半。
     */
    families: Object.freeze([
      'sfyin', 'msfyin',   // 磨砻/明鉴、木制瑞印/红木瑞印
      'sfshu', 'msfshu',   // 俗心/雅气、小说卷轴/诗画卷轴
      'sfjin', 'msfjin',   // 身观、青铜镜/黄铜镜
      'sfzhi', 'msfzhi',   // (镇纸)
      'sfhu', 'msfhu',     // 烹泉/沏虹、青瓷茶器/彩瓷茶器
      'sfji', 'msfji',     // 沉沙/新硎、铜矛头/铁矛头
      'sfden', 'msfden', 'sfpin', 'msfpin', // 灯盘与花瓶
      'msnip',             // 重弩突袭者
    ]),
    from: '画中人(act35side) 文房雅器系列',
    note: 'owner 点名的「矛头」「书卷」都在这里:msfji / msfshu',
  }),
  Object.freeze({
    theme: 'abyss',
    name: '深海',
    /*
     * 覆潮之下 / 深海猎人那一批。`du*` 是"深海"系列的族段
     * (深池侦察兵 dusbr、深池暗影术师 dumage …),`dssbr` 是富营养化那档。
     *
     * ⚠ **这一族在任何真实波次里都不出现**(`reachability()` 验过)——
     *   所以这个主题目前**永远不会触发**,留着是为了将来波次补上时能直接用。
     *   测试里有一条"已接曲子的主题必须可达"专门盯这种死配置。
     */
    families: Object.freeze([
      'dssbr', 'dusbr', 'duhond', 'dumage', 'duphlx', 'dushld', 'dugago', 'duholy', 'divman',
    ]),
    from: '覆潮之下 / 深池系列',
    note: '局部素材有(m_bat_abyssalhunters),但**波次里没有这一族**,所以现在不会响',
  }),
  Object.freeze({
    theme: 'ursus',
    name: '乌萨斯',
    /*
     * ⚠⚠ **这一批是 owner 于 2026-10-13 定的,不是我照大炎那套"读 id 命名规律"推的。**
     *
     *   我本想自己认乌萨斯,查下来发现**认不出来**:这些敌人名字和描述里都不带"乌萨斯"字样,
     *   而且 `假想敌：*` 那一批是**虚构的假想敌单位**,没有可查的官方归属。
     *   猜错会让整关放错歌,所以由 owner 圈定族段。
     *
     *   下面每个族都验过 `reachability`(**真的会在波次里出场**)—— 否则加了也不会响:
     *     vtsk     “帝国的甲胄”          h08_01
     *     sotisd   游击队盾卫             h07_07
     *     acstmk   假想敌：胄            h07_01 / h08_01
     *     acstma   “斩胄之剑”            h08_01
     *     acstmb   “破胄之锤”            h08_01
     *     achunt   假想敌：铳            h07_02 / h08_02
     *     actrpa/b/c “碎铳之簧”          h08_02
     *     acelem   假想敌：淤困          h08_02
     *     acduml   假想敌：管            h07_03 / h08_03
     *     acdumm   假想敌：弦            h08_03
     *     acpupp   假想敌：再生          h08_03
     *
     * ## 故意**不收**的两个(记下来免得日后有人"顺手补上")
     *
     *   · `aclionk`(阿利斯泰尔，帝国余晖)—— desc 明说「反驳**维多利亚**无上的荣光与权力」,
     *     那是**维多利亚**的,不是乌萨斯。我差点收进来。
     *   · `acstmc` —— **敌人表里根本没有这个 key**(我一度写进候选,是我想错了)。
     *
     * 加族段之前先确认它在 `node tools/list-wave-families.mjs` 的输出里(即真的会出场)。
     */
    families: Object.freeze([
      'vtsk', 'sotisd',
      'acstmk', 'acstma', 'acstmb',
      'achunt', 'actrpa', 'actrpb', 'actrpc',
      'acelem',
      'acduml', 'acdumm', 'acpupp',
      /*
       * ★ **集团军中坚盾卫 / 帝国炮火先兆者** (owner 2026-10-18:「集团军中坚盾卫呢」)。
       *
       *   `uashld` = 集团军中坚盾卫(`enemy_10124_uashld_2`)、
       *   `emppnt` = 帝国炮火先兆者(`enemy_1112_emppnt` / `_2` 帝国炮火中枢先兆者)。
       *
       *   ⚠⚠ **我上一次把它们判成"永不触发"是错的**,原因是探针的方法有缺陷:
       *     我只扫了"模板里写死的敌人 key",而**家族抽签(`roundPick`)会把模板里的占位符
       *     替换成抽签池里的随机家族** —— 这两个族在 `factions.entries` 里
       *     (`involveRandom: true`),所以**真的会出场**,只是模板原文里看不到。
       *
       *   教训:**"这个族会不会出场"不能用"模板原文里有没有它"来判** ——
       *   占位符替换是另一条路。`reachability()` 那种工具也要按这个口径才准。
       */
      'uashld', 'emppnt',
    ]),
    from: 'owner 圈定(2026-10-13)',
    note: '帝国的甲胄 / 游击队盾卫 / 假想敌系列 —— 曲目「乌萨斯的影月」',
  }),
]);

/**
 * 主题名 → 定义(查表用)。 */
const BY_THEME = new Map(THEMES.map((t) => [t.theme, t]));

/**
 * ★ **触发参数**(和主题定义分开放,因为这两类主题的触发机制完全不同)。
 *
 *   · `origin: 'family'`(默认)—— 靠**敌人 id 的族段**命中(大炎 / 乌萨斯 / 深海)
 *   · `origin: 'crisis'` —— 靠**危机合约的回合区间 + 50% 随机**(和敌人是谁无关)
 *
 * ## 为什么放在**这里**而不是 `data/assets.json`
 *
 *   服务端要掷那个 50% 的骰,但服务端**拿不到清单** —— `Match` 里只有
 *   `this.data`(模拟数据)/ `this.gd`(GameData),清单 `data/assets.json` 是
 *   HTTP 层加载的。把这个参数放在共享模块里,服务端和客户端读的是**同一份**,
 *   不会出现"客户端按 rate=0.5 判、服务端按没 rate 判"这种漂移。
 *
 *   (清单里**也**写着 `rate`,那个是给渲染/排查看的;真正生效的是这里。
 *    两处不一致时**以这里为准**,因为服务端只读得到这里。)
 *
 * ## 回合区间(owner 2026-10-13 确认)
 *
 *   「challenger 就是值 8-13 前几回合就是指 1-7
 *     然后合约延长回合除 boss 战以外按照 8-13 的曲子来」
 *
 *   `fromRound: 8` 对应 `combatTrackFor` 的返回值 0(R8+);
 *   「延长回合」天然落在 R8+ 那一侧,不用单独处理;
 *   「除 boss 战以外」也不用判 —— 首领轮是独立的 PHASE(`FINAL_ASSAULT` / `HIDDEN_CORE`),
 *   根本走不到开战分支。
 */
export const THEME_TRIGGERS = Object.freeze({
  /*
   * ★ **前段开战曲 (Inference)** (owner 2026-10-17:
   *   「这首作为危机合约前7还是9回合战斗期的二号曲 与危机合约的原曲50%随机」)。
   *
   *   ⚠ owner 自己也在 7 与 9 之间没定,我取 **9**,理由是:
   *     下一条 `crisis-challenger` 的下限本来就是 9 —— 取 9 正好让两段**首尾相接、不重叠**。
   *     想改成 7 的话只改这一个数(`toRound`)并把下一段的 `fromRound` 一起改。
   */
  'crisis-inference': Object.freeze({
    origin: 'crisis', label: '危机合约 · 前段开战曲', rate: 0.5, toRound: 9,
    note: 'owner 指定的「Inference」;R1–9 与原曲 50% 随机',
  }),
  'crisis-challenger': Object.freeze({
    origin: 'crisis', label: '危机合约 · 后段开战曲', rate: 0.5, fromRound: 9,
    note: 'owner 指定的「Challenger」;R9 起与原曲 50% 随机(原来写的是 R8)',
  }),
  'crisis-leviation': Object.freeze({
    origin: 'crisis', label: '危机合约 · 联防曲', rate: 0.5, phase: 'UNITE',
    note: 'owner 指定的「LEVIATION」;联防阶段与原曲 50% 随机',
  }),
});

/** 一个主题的触发参数(没有就返回 null)。 */
export const triggerOf = (theme) => (theme && THEME_TRIGGERS[theme]) || null;
/** 这个主题是不是"掷骰触发"的(和敌人族无关)。 */
export const isRollTheme = (theme) => triggerOf(theme)?.origin === 'crisis';

/**
 * **关卡声明的曲子名 → 主题名**。
 *
 * `data/waves.json` 的 `bgm` 字段是上游写的,值是**曲子名**(`"abyssalhunters"` /
 * `"bat_boss_ancestor"`),不是主题名。要让它参与 C 方案的"关卡声明优先"这一层,
 * 就得把这两套名字对起来 —— 这张表就是那次翻译。
 *
 * ⚠ **这张表是"关卡声明"那一层的全部内容**:没列在这里的曲子名(比如
 *   `bat_kazimierz2_2` / `bat_boss_ancestor`)就**不是主题**,
 *   于是那一关由**敌人家族**决定(还是没结果就走原来的回合逻辑)。
 *   这是故意的:我不去猜"kazimierz 对应哪个主题"—— 猜错会让整关放错歌。
 *
 * 要加一条:确认那一关该放的主题,然后把曲子名映过去(或干脆把 `waves.json` 的
 * `bgm` 直接改成主题名 —— `resolveTheme` 两种写法都认)。
 */
const DECLARED_ALIAS = Object.freeze({
  abyssalhunters: 'abyss',
  bat_act35side_01: 'yan',
});

/** 族前缀 → 主题名。同一个族**不许**出现在两个主题里(见下面 `validate()`)。 */
const BY_FAMILY = new Map();
for (const t of THEMES) for (const f of t.families) BY_FAMILY.set(f, t.theme);

/**
 * 从敌人 id 里取"家族段"。
 *
 * `enemy_1209_sfden_2` → `sfden`(带变体编号的也要认)
 * `enemy_1007_slime`   → `slime`
 *
 * ⚠ 编号段必须允许**前导零**之外的一切数字,而且第 3 段之后的可选编号要吃掉 ——
 *   我第一版写的表达式在 `_2` 这种变体上会多切出一段,`sfden_2` 就匹配不上族名了。
 *
 * @param {unknown} key
 * @returns {string|null}
 */
export function familyOf(key) {
  /* ⚠ 先过 `keyOf`:spawn 对象(服务端产出的是 `enemyKey`)也要能直接传进来 */
  const s = keyOf(key);
  if (typeof s !== 'string') return null;
  const m = /^enemy_\d+_([a-z]+?)(?:_\d+)?$/.exec(s);
  return m ? m[1] : null;
}

export function keyOf(s) {
  if (typeof s === 'string') return s || null;
  if (!s || typeof s !== 'object') return null;
  if (typeof s.key === 'string' && s.key) return s.key;
  if (typeof s.enemyKey === 'string' && s.enemyKey) return s.enemyKey;
  return null;
}

/**
 * 一个敌人 id 属于哪个主题,没有就 `null`。
 *
 * ## ⚠⚠ **必须同时接受 `key` 与 `enemyKey`** (owner 2026-10-17:「一局有乌萨斯盾卫没触发」)
 *
 *   这里原来只读 `s.key` —— 但服务端产出的 spawn 字段叫 **`enemyKey`**
 *   (`server/match/waves.js` 的 `templateSpawns`:`const spec = { time, enemyKey: key, … }`)。
 *   于是 `themeOfEnemy(undefined)` **永远是 null** ⇒ **家族投票永远为空**
 *   ⇒ 「靠敌人是谁来选曲」这条机制**从来没有生效过**
 *   (大炎、乌萨斯两首曲子装了也听不到;只有"关卡声明"那一层是通的)。
 *
 *   修在**读的这一侧**而不是改产出的字段名:
 *     · 产出的 `enemyKey` 被模拟器、客户端、审计等多处依赖,改名会牵一大片;
 *     · 而"读的人要容忍两种写法"是一处收口,以后再有第三个名字也只是加一行。
 *
 * ⚠ `electTheme` 只管把 `spawns` 交给这个函数 —— 所以修这里,
 *   **所有波次类型(普通 / 首领 / 隐秘核心 / 奖励怪)一起修好**。
 *
 * @param {unknown} key 敌人 id,或一个带 `key` / `enemyKey` 的 spawn 对象
 */
export function themeOfEnemy(key, enemies = null) {
  const e = enemies?.[keyOf(key)];
  // Shared-pool troops retain the faction that actually supplied this round's spawn.
  const chosen = key && typeof key === 'object' && key.mods?.trainingFaction;
  if (FACTION_THEMES[chosen] && e?.contractTrainingTags?.includes(chosen)) return FACTION_THEMES[chosen];
  // Generated affiliations take precedence over the old ID-prefix fallback.
  const type = (e?.contractTrainingTags || []).find(t => FACTION_THEMES[t]);
  if (type) return FACTION_THEMES[type];
  if (e?.affiliationNames?.includes('猩红剧团')) return 'scarlet';
  const f = familyOf(keyOf(key));
  return f ? (BY_FAMILY.get(f) || null) : null;
}

/** 主题的中文名(给界面/日志用)。 */
export function themeName(theme) {
  return theme && BY_THEME.has(theme) ? BY_THEME.get(theme).name : null;
}

/**
 * 从**这一场会出场的敌人**里投票选主题。
 *
 * 按 `spawns` 的**条目数**计票(一条 = 一次出场批次),最多的赢;平票时**先出现的赢**
 * (spawns 是按时间排的,先来的更有代表性,结果也稳定可复现)。
 *
 * ⚠ 为什么用"多数"而不是"只要有一个就算":`act1autochess_h07_03`(首领 3)里
 *   5 个族只有 1 个是大炎(`sfden` 堂皇),剩下是寒霜/灵幛/假想敌 —— 那关**不该**整场放大炎曲。
 *   反过来,真正的大炎关(将来补上素材时)会是清一色 `sf*`/`msf*`,多数自然成立。
 *
 * @param {ReadonlyArray<{ key?: unknown }>|null|undefined} spawns
 * @returns {string|null} 主题名
 */
export function electTheme(spawns, { strict = false, enemies = null, dominant = false } = {}) {
  if (!Array.isArray(spawns) || !spawns.length) return null;
  /** @type {Map<string, number>} */
  const votes = new Map();
  let total = 0;
  for (const s of spawns) {
    if (s?.count === 0) continue;
    const weight = dominant ? Math.max(1, Number(s?.count) || 1) : 1;
    total += weight;
    /*
     * ⚠ **把整个 spawn 交给 `themeOfEnemy`,不要自己取字段** (owner 2026-10-17)。
     *
     *   原来这里写的是 `themeOfEnemy(s && s.key)` —— 而服务端产出的 spawn
     *   字段名是 **`enemyKey`**(`server/match/waves.js` 的 `templateSpawns`),
     *   于是这里永远传 `undefined` ⇒ **家族投票恒为空** ⇒ 整条"靠敌人选曲"从不生效。
     *
     *   现在由 `themeOfEnemy` → `keyOf` 统一认两种名字。取字段的责任收在**一处**,
     *   以后再有第三种写法也只改 `keyOf`。
     */
    const t = themeOfEnemy(s, enemies);
    if (!t) continue;
    /* 同一场里同族只算一次?不 —— 按条目数计票,出场批次多的族就是这一场的主角 */
    votes.set(t, (votes.get(t) || 0) + weight);
  }
  if (dominant) {
    const ranked = [...votes].sort((a,b) => b[1] - a[1]);
    const [theme, n] = ranked[0] || [null, 0], second = ranked[1]?.[1] || 0;
    // Owner's latest rule: the most numerous identified faction wins; a tie uses the default.
    return n > second ? theme : null;
  }

  /*
   * ★★ **族群冲突 ⇒ 不切歌,回固定曲** (owner 2026-10-18:
   *   「如果族群冲突 乌萨斯和大炎敌人都在一起则不播放 播放固定曲目」)。
   *
   *   原来这里是"票数最多者胜" —— 场上有大炎也有乌萨斯时,它会**挑票多的那个族**放,
   *   于是同一关里"打大炎却放乌萨斯的曲子"。owner 要的是**冲突就都不放**。
   *
   *   ⚠ 判据是"**有主题的族超过一个**",不是"票数相等":
   *     5 个大炎 + 1 个乌萨斯**也算冲突** —— 两种敌人都在场,放谁的都不对。
   *   ⚠ 无主题的族(寒霜 / 灵幛 / 妖怪…)不参与投票,所以
   *     "3 个无主题 + 2 个大炎"**不算冲突**,仍然放大炎曲。
   */
  if (votes.size > 1) return null;
  /*
   * ★ `strict`:要求**过半数**(而不是"最多的那个")。
   *
   *   为什么整备期要用严格档:owner 要的是「**确实**是大炎敌人时才换休息期曲」。
   *   而首领 3 那关(`act1autochess_h07_03`)是**混编** —— 5 个出场条目里
   *   只有 1 个是大炎(`sfden` 堂皇),其余是寒霜 / 灵幛 / 假想敌。
   *   按"最多者胜"它也算大炎(因为别的族没主题、不投票),
   *   但那一关显然不该整场播大炎曲。过半数就挡住了。
   *
   *   开战期的口径**保持宽松**(主人第一次就是这么要的:战斗里出场了大炎怪就播),
   *   所以默认还是 `strict: false`。
   */
  if (strict && total > 0) {
    for (const [t, n] of votes) if (n * 2 > total) return t;
    return null;
  }
  let best = null;
  let bestN = 0;
  for (const [t, n] of votes) if (n > bestN) { best = t; bestN = n; }
  return best;
}

/**
 * 决定这一场放哪个主题 —— **C 方案的三层优先级**就实现在这里。
 *
 * @param {{ declared?: unknown, spawns?: ReadonlyArray<{ key?: unknown }>|null }} o
 *   `declared`: 关卡自己声明的(`waves.json` 的 `bgm`)。它优先。
 *   `spawns`:   这一场的出场敌人(家族兜底用)。
 * @returns {{ theme: string|null, source: 'declared'|'family'|null }}
 *   `source` 说明是**哪一层**给出的答案 —— 排查"为什么放的是这首"时就看它。
 */
export function resolveTheme({ declared = null, spawns = null, strict = false, enemies = null, dominant = false } = {}) {
  /*
   * ① 关卡声明。三种写法都认:
   *    · 主题名本身(`"yan"`)
   *    · 曲子名,经 `DECLARED_ALIAS` 翻成主题(`"bat_act35side_01"` → `yan`)
   *    · 其它曲子名(`"bat_kazimierz2_2"`)—— **不是主题**,落到下一层
   */
  if (typeof declared === 'string' && declared) {
    const byName = BY_THEME.has(declared) ? declared : (DECLARED_ALIAS[declared] || null);
    if (byName) return { theme: byName, source: 'declared' };
  }
  /* ② 敌人家族兜底 */
  const t = electTheme(spawns, { strict, enemies, dominant });
  if (t) return { theme: t, source: 'family' };
  /* ③ 没有主题 —— 播放器走原来的回合逻辑 */
  return { theme: null, source: null };
}

/** 关卡声明用过的曲子名别名(给测试/文档用)。 */
export const declaredAliases = () => ({ ...DECLARED_ALIAS });

/**
 * 一个主题的族**有没有真的出现在某组波次里**。
 *
 * 为什么需要它:光看主题表看不出"这个主题永远不会触发" —— 我第一版给深海配了曲子、
 * 以为"现在就能听到区别",而**深海族一个都不在任何波次里**,那个配置是死代码。
 * 用真实数据跑一遍才能发现,所以这个函数是给测试和体检工具用的。
 *
 * @param {string} theme
 * @param {ReadonlyArray<{ spawns?: ReadonlyArray<{ key?: unknown }> }>} waves
 * @returns {{ families: string[], inWaves: string[], waveIds: string[] }}
 */
export function reachability(theme, waves) {
  const fams = familiesOf(theme);
  const inWaves = new Set();
  const waveIds = new Set();
  for (const w of Array.isArray(waves) ? waves : []) {
    for (const s of (w && Array.isArray(w.spawns) ? w.spawns : [])) {
      const f = familyOf(s && s.key);
      if (f && fams.includes(f)) { inWaves.add(f); if (w.id) waveIds.add(w.id); }
    }
  }
  return { families: [...fams], inWaves: [...inWaves], waveIds: [...waveIds] };
}

/** 主题是否在表里(给测试/校验用)。 */
export const isTheme = (t) => BY_THEME.has(t);

/**
 * ★ **确定性 50% 掷骰**(owner:「与原曲 50% 随机」)。
 *
 * ## 为什么必须是"确定性"的,不能用 `Math.random()`
 *
 *   播放器的硬要求是**同一房间的所有人听同一首**(见 `public/js/audio.js` 里
 *   "so every client of a room hears the same one")。各客户端各自 `Math.random()`
 *   会掷出不同结果 —— 同一场战斗有人听新曲、有人听原曲。
 *
 *   所以改成**对种子做哈希**:种子相同 ⇒ 结果必然相同。服务端在开战时用
 *   `battleId`(形如 `<seed36>.<round>.<seq>`,全房间一致且每回合不同)掷一次,
 *   把结果跟 `b.start` 一起下发;客户端只读不算。
 *
 * ## 分布
 *
 *   用 FNV-1a 哈希 + 取一个高位比特。对 `rate = 0.5` 来说就是掷硬币。
 *   做了**雪崩**(最后的 `>>> 0` 再乘一次)让相近的种子不会给出相近的结果 ——
 *   否则相邻回合的 battleId 只差一个字符,可能连续几十回合都掷出同一面。
 *
 * @param {unknown} seed 稳定种子(服务端传 battleId)
 * @param {number} rate 命中概率,0..1
 * @returns {boolean} true = 用主题曲
 */
export function themedRoll(seed, rate = 0.5) {
  const r = Number(rate);
  if (!Number.isFinite(r) || r <= 0) return false;
  if (r >= 1) return true;
  const s = typeof seed === 'string' ? seed : String(seed ?? '');
  if (!s) return false;
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    /* FNV-1a 的质数乘法,用 Math.imul 保证 32 位整数语义 */
    h = Math.imul(h, 16777619);
  }
  /* 雪崩:把差异扩散到高位,再用高位比特决定(低位对相近输入更敏感于模式) */
  h ^= h >>> 15;
  h = Math.imul(h, 2246822507);
  h ^= h >>> 13;
  h = Math.imul(h, 3266489909);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967296) < r;
}

/** 一个主题的命中概率(清单里的 `rate`,缺省 1 = 每次都放)。 */
export function themeRate(manifest, theme) {
  /*
   * ⚠ **先读 `THEME_TRIGGERS`** —— 那是服务端唯一读得到的来源(它拿不到清单)。
   *   两处不一致时以共享模块为准,否则会出现"服务端按 0.5 掷、客户端按 1 判"的漂移。
   */
  const fromCode = triggerOf(theme)?.rate;
  if (fromCode != null) {
    const n = Number(fromCode);
    if (Number.isFinite(n)) return Math.min(1, Math.max(0, n));
  }
  const v = manifest?.audio?.bgm?.themes?.[theme]?.rate;
  if (v == null) return 1;
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}

/** 一个主题的族前缀列表(给测试/文档用)。 */
export const familiesOf = (t) => (BY_THEME.has(t) ? BY_THEME.get(t).families : []);

/** 全部主题名。 */
export const THEME_IDS = Object.freeze(THEMES.map((t) => t.theme));
