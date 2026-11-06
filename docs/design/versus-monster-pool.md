# DESIGN §40 — 对抗模式：怪物卡池、阵营盟约、商店与投放

Part of [DESIGN.md](../DESIGN.md) (the index; section numbers are global).

> 状态：**代码已实现、未上线**（2026-11-05 口径）。本文替换 2026-11-04 的 v2 版：v2 写的「卡池 = 本回合官方出怪」「每阶份数 = 官方只数 × 1.5」「五档阶位 [25,50,100,200]」「盟约按 7 个特训类型」全部过期，按当前代码重写。
> 范围：对抗模式（2V2 / 4V4）的怪物方玩法 —— 两档规则、怪物模式、怪物库与资产、阵营、六个等级、卡池与库存、商店、投放交互、资金、盟约、对称血量、攻方视图、怪物方 AI 契约、已知缺口。守方（干员侧）的既有机制不在本文范围，见 `docs/design/match.md` 与 `docs/design/economy.md`。
> 标记约定：`[DATA]` = 仓库数据或代码实测（`data/*.json`、常量、可复现的 `node -e` 统计）；`[ASSUMED]` = 无法从材料确认、需另行裁决；`file:line` 一律按 2026-11-05 的检出（`plugins/...`）。

---

## 40. 对抗模式：怪物卡池、阵营盟约、商店与投放

### 40.1 两档规则与两种怪物模式

对抗局（`m.isVersus`）的**每个普通回合**都是攻守回合：`confrontActiveAt(r)` = `r >= 1 && r < gd.bossRound`（`plugins/mota/server/match/match/confront.js:221-222`），所以 R1–R13 都有一方投放、一方防守；R14/R15（最终攻势 / 隐秘核心）没有。

#### 40.1.1 两个档：`bounty` 与 `confront`

两档来自房间字段 `room.variant`，只在房间层归一化一次：`RULES = new Set(['bounty','confront'])`，未知值（含已删除的 `'ai'`）一律回落 `bounty`（`plugins/versus-room/server/versusLobby.js:30-31`）。服务端再兜一道：只认 `'bounty'` / `'confront'`，`mode_confront_*` 前缀映射到 `confront`，其余回落 `bounty`（`plugins/mota/server/match/Match.js:311-315`）。选项经 `wireOptions` 白名单进子进程：`versusRule` / `versusAlt` / `versusSpeed` / `monsterMode` / `monsterShop`（`plugins/mota/server/match/host/proxy.js:46`）。

| 维度 | `bounty`（赏金，缺省） | `confront`（对抗） |
|---|---|---|
| 攻守轮换 | 每回合轮换（`versusAlt: rule === 'bounty'`，`plugins/versus-room/server/versusLobby.js:39`） | 固定阵营（`versusAlt:false`）⇒ `roleTeamsFor` 恒 `attack = 0`（`plugins/mota/server/match/match/infra.js:138-143`） |
| 倍速 | 透传 `1 / 1.5 / 2`，只放大守方这一回合的官方只数（`plugins/versus-room/server/versusLobby.js:41`、`plugins/mota/server/match/Match.js:319`、`plugins/mota/server/match/match/confront.js:1914-1918`） | 恒 `1` |
| 目标选择 | `PHASE.CONFRONT` + `confrontStage 'target'`，10 s（`plugins/mota/server/match/match/confront.js:1241`，`plugins/mota/shared/constants.js:422`） | 跳过：`enterConfront` 直接自动分配目标并 `finishConfrontTargets`（`plugins/mota/server/match/match/confront.js:1233-1240`） |
| 守方波次 | 官方波次 + 按份额随机替换（`plugins/mota/server/match/match/confront.js:1925-1954`） | 纯玩家出怪：只要本回合有攻方真的投放，官方怪全部不进守方波次（`confrontPurePlacement`，`plugins/mota/server/match/match/confront.js:539-542`、`plugins/mota/server/match/match/confront.js:1925-1932`）；没人投放时保留官方波次，避免空波次白送一回合（`plugins/mota/server/match/match/confront.js:1929-1932`） |
| 默认怪物 AI | `legacy` | `cardpool` |

第三档 `'ai'` 已删除：它等于「对抗档 + 由 `beforeStart` 补满 AI 席」，不需要独立取值（`plugins/versus-room/server/versusLobby.js:27-29`、`plugins/versus-room/server/versusLobby.js:47-61`）。

#### 40.1.2 怪物模式：`shared`（共同出怪）/ `solo`（个人出怪）

`m.monsterMode` 由房间字段 `opts.monsterMode` 透传，取不到即 `shared`（`plugins/versus-room/server/versusLobby.js:42-44`、`plugins/mota/server/match/match/confront.js:576`）。两种模式的差别落在**四个归属键**上，全部同一口径：

| 维度 | `shared`（默认） | `solo` |
|---|---|---|
| 卡池 | 按**队**：`monsterPoolFor` 用 `teamIdOf(ps)` 作键（`plugins/mota/server/match/monsterShop.js:126-134`） | 按**人**：`playerId` 作键（同处） |
| 资金 | 队级账户 `m.teamMonsterFunds`，同队成员读同一份余额（`plugins/mota/server/match/monsterShop.js:147-156`、`plugins/mota/server/match/monsterShop.js:187-234`） | 各人 `ps.monsterFunds`（`fundsShared` 为假） |
| 商店等级 | 按队共享（`monsterShopLevelKey`，`plugins/mota/server/match/monsterShop.js:250-254`） | 按人 |
| 投放权 | 全体存活攻方都能开店 / 买 / 投（`placeActorOk`，`plugins/mota/server/match/monsterShop.js:412-416`） | 只有该队**第一位存活攻方**（`monsterPlaceActor`，`plugins/mota/server/match/match/confront.js:585-592`）；其余攻方一律 `WRONG_PHASE`，且收尾帧推一张「关着」的商店（`plugins/mota/server/match/match/confront.js:1399-1404`） |
| 目标 | 同队攻方共用同一个 target：`teamTarget()` 取本队第一个已分配目标（`plugins/mota/server/match/match/confront.js:1306-1312`、`plugins/mota/server/match/match/confront.js:1326-1335`） | 各自按既有规则分配 |
| 盟约层归属 | 按队合成一份（`monsterBondKey`，`plugins/mota/server/match/monsterBonds.js:313-317`） | 按人 |

`shared` 还有一条**留份**规则：bot 的购买 / 投放上限 = 池里剩余 − 同队人类攻方人数，下限 0，人类自己不受限（`monsterReserve` / `monsterStockLeft`，`plugins/mota/server/match/monsterShop.js:371-405`）——防止 AI 队友开窗瞬间把池买空。

#### 40.1.3 一个攻守回合的时间线

1. `startRound` 建波并写只读快照 `m._roundOfficialSpawns = [{enemyKey, count}]`（`plugins/mota/server/match/match/phases.js:514`），回合边界清成 `null`（`plugins/mota/server/match/match/phases.js:484`）。
2. `enterConfront`：`bounty` 进 10 s 目标选择；`confront` 直接 `finishConfrontTargets`（`plugins/mota/server/match/match/confront.js:1218-1249`）。
3. `finishConfrontTargets`：发军费 → seed 商店等级 → 建池 → 每个有投放权的攻方开店并推首帧 → `enterPrep`（`plugins/mota/server/match/match/confront.js:1355-1414`）。
4. **投放窗口 = 本回合的 PREP**，与守方同一个 deadline（`prepPlayers()` 返回全体存活、`enterPrep` 只有一个 `setDeadline`：`plugins/mota/server/match/match/prep.js:19-24`、`plugins/mota/server/match/match/prep.js:46-49`；窗口判据 `inMonsterStage`：`plugins/mota/server/match/monsterShop.js:112-115`）。没有独立的 `PHASE.CONFRONT + 'monster'` 窗口。
5. PREP 结束 → `finishConfront`：草稿转正式提交 → 关店 → 推收尾帧 → 5 s 公示（`rosterMs = 5000`，`plugins/mota/shared/constants.js:408`）→ COMBAT（`plugins/mota/server/match/match/confront.js:1748-1799`，调用点 `plugins/mota/server/match/match/prep.js:232-233`）。
6. COMBAT：**只有守方有战场**，攻方本回合只投放、观战（`plugins/mota/server/match/match/combat.js:173`、`plugins/mota/server/match/match/combat.js:187`）。

---

### 40.2 怪物库：`data/enemies.json` 与资产

#### 40.2.1 491 条的来源

| 分层 | 条数 | 证据 |
|---|---|---|
| 原表（无 `source` 字段） | 249 | `data/enemies.json` 实测；含全部 8 条 `tokenOnly` |
| 肉鸽 ro4 补全（带 `source`） | 242 | `tools/build-enemies-merged.mjs:4-7`（ro4 关卡里有 242 个 key 原表没有记录） |
| ├ `source: 'db'` | 214 | enemy_database level 0 直接取数（`tools/build-enemies-merged.mjs:10-12`） |
| └ `source: 'override'` | 28 | db 缺记录，取关卡的 `enemyDbRefs[].overwrittenData`（`tools/build-enemies-merged.mjs:13-15`） |
| 合计 | 491 | 实测 |

- `tokenOnly: true` 共 **8 条**，全部在原表里，是召唤物 / 部件，不单独建卡池条目（`plugins/mota/server/match/monsterPool.js:334-342` 的过滤）。
- 补全条目与 `build-data` 写出的记录同形（`tools/build-enemies-merged.mjs:5-7`），所以价格 / 阶位 / 波次价值三个口径都能直接吃它。

#### 40.2.2 资产登记与占位

| 数字 | 含义 | 证据 |
|---|---|---|
| 382 | `data/assets.json` 的 `enemies` 段键数 | 实测 |
| 375 | 491 条里在清单中有登记的条数 | 实测（249 条原表全部命中） |
| 116 | 491 条里**完全没有资产**的条数 | 实测 |
| 126 | 242 条补全里在清单中有登记的条数（其中 122 条 icon + spine、4 条只有 icon） | 实测 |

- 清单里另有 7 个 key 不在当前 `data/enemies.json`（历史键），所以「382」与「375」不是同一个分母。
- 登记工具**只写磁盘上真实存在的文件**：任何资产树里都找不到的 key 一律留空并列进报告，绝不写入虚构路径（`tools/link-enemy-assets.mjs:3-6`）。
- 无资产的怪照常进池、照常可买（数据层齐全），卡面走客户端占位：`enemyIconUrl` 拿不到 URL 时 `<Img>` 画 fallback 骷髅 / 菱形（`plugins/mota/client/js/ui/shopBar.js:289-293`）。

---

### 40.3 阵营：22 个与分类规则链

阵营归属是**数据**，不是从 `acType` / `rank` 现推：`data/monster-factions.json` 的 `map`（敌人 key → 阵营 id 数组）是唯一真源（`plugins/mota/server/match/monsterBonds.js:16-21`、`plugins/mota/server/match/monsterBonds.js:94-98`）。当前 `map` 覆盖 491/491，没有空阵营的怪；其中 5 个 key 同时属于两个阵营（`enemy_1010_demon`、`enemy_1012_dcross`、`enemy_1022_dmage`、`enemy_1501_demonk`、`enemy_1506_patrt`，全部是 `REUNION + SARKAZ`），所以按阵营计数之和是 496 而不是 491。

#### 40.3.1 22 个阵营与只数

20 个来自 0.4.3 上游内容包（`version: 3`，`source` 字段写明），**源石协议 ORIGINIUM**（第 21 个，业主 2026-11-04）与**假想敌协议 IMAGINARY**（第 22 个，业主 2026-11-05）追加在末尾，既有 20 条的相对顺序不变（`plugins/mota/server/match/monsterBonds.js:107-137`）。

| 阵营 id | 名称 | `map` 只数（491） | 池内只数（483） | 三阶阈值（若分母 = 池内只数） |
|---|---|---|---|---|
| REUNION | 整合运动 | 104 | 102 | 16 / 31 / 46 |
| URSUS | 乌萨斯 | 13 | 13 | 2 / 4 / 6 |
| DEEP_POOL | 深池 | 22 | 22 | 4 / 7 / 10 |
| VICTORIA | 维多利亚 | 10 | 7 | 2 / 3 / 4 |
| SARKAZ | 萨卡兹 | 119 | 118 | 18 / 36 / 54 |
| LEITHANIEN | 莱塔尼亚 | 18 | 17 | 3 / 6 / 8 |
| YAN | 大炎 | 36 | 36 | 6 / 11 / 17 |
| SEA_BORN | 海嗣 | 15 | 15 | 3 / 5 / 7 |
| KAZIMIERZ | 卡西米尔 | 9 | 9 | 2 / 3 / 5 |
| KJERAG | 谢拉格 | 9 | 9 | 2 / 3 / 5 |
| SIRACUSA | 叙拉古 | 17 | 17 | 3 / 6 / 8 |
| LATERANO | 拉特兰 | 13 | 13 | 2 / 4 / 6 |
| IBERIA | 伊比利亚 | 8 | 8 | 2 / 3 / 4 |
| SIESTA | 汐斯塔安保 | 5 | 5 | 1 / 2 / 3 |
| SARGON | 萨尔贡 | 6 | 6 | 1 / 2 / 3 |
| BOLIVAR | 玻利瓦尔 | 13 | 13 | 2 / 4 / 6 |
| DURIN | 杜林 | 4 | 4 | 1 / 2 / 3 |
| HIGASHI | 东国 | 2 | 2 | 1 / 2 / 3 |
| SAMI | 萨米 | 5 | 5 | 1 / 2 / 3 |
| COLUMBIA | 哥伦比亚 | 30 | 30 | 5 / 9 / 14 |
| ORIGINIUM | 源石协议 | 17 | 17 | 3 / 6 / 8 |
| IMAGINARY | 假想敌协议 | 21 | 20 | 3 / 6 / 9 |

- 「池内只数」= 排除 8 条 `tokenOnly` 后的 483 只（§40.5.1）；`map` 只数按 491 计，差额全部来自那 8 条。
- 最后一列只是**量级参考**：实战阈值的分母是**本回合可投放池**（§40.9.2），通常只有几只到二十几只，所以同一阵营的实际阈值远低于此列。

#### 40.3.2 分类规则链（`data/monster-factions.json` 的 `rules` 段）

补全时的规则是**有序**的，前一步命中就定案（`rules` 段 `step` 1–6，顺序即优先级）：

| step | 规则 | `rules.hits` | 判据 |
|---|---|---|---|
| 1 | `ORIGINIUM`（源石协议） | 32 | `name` 含「源石虫」/「源石」；或 `tags` 含 `origen` / `originiumartscraft`；或 key 词干前缀 `mhslim` / `slime` / `ftsj` / `ftzl`；或词干含 `slime` / `slim`（源石虫族词根，例如 `lslime` = 庞贝） |
| 2 | prefab 前缀 | 69 | 在已映射的 297 条上实测「纯度 100% 且样本 n ≥ 2」的 prefab / spine 前缀，**最长优先**；采用的前缀见 `prefixTable` 段 |
| 3 | name / desc 关键词 | 21 | 国家 / 组织词：先国家名、后组织 / 职务词；「炎」只认「大炎 / 炎国」（避开火属性误命中） |
| 4 | sibling（同 base） | 3 | 逐级剥掉 `_2` / `_3` / `_a` / `_b` / `_2b` / `_2c` / `_04` 等后缀，base key 已有阵营则沿用 |
| 5 | tags | 7 | `sarkaz → SARKAZ`、`seamonster → SEA_BORN`；`machine` 实测不纯（9 个阵营混用）故跳过 |
| 6 | 兜底 `REUNION` | 62 | 以上全不中归「整合运动」（敌对通用） |

`prefixTable` 段是 step 2 的成品表（18 条）：每条 `{ faction, sample, hits }`，`sample` = 该前缀在已映射集合里的样本数、`hits` = 归入该阵营的命中数；匹配时最长前缀优先。原 99 条候选留在 `proposed` 段（`status: adopted`）。

> `[ASSUMED]` `rules` 段的 `hits` 与最终 `map` 计数不等（例：ORIGINIUM step 1 命中 32，`map` 里只有 17）—— 差额应来自后续步骤的覆盖，以及 2026-11-05「假想敌系列独立成营 + `vt*` / `mh*` / `cs*` / `redace*` 按业主裁决归位」这两次改判；`rules` 是补全过程的记录，`map` 才是最终真源。

#### 40.3.3 盟约 id 与卡面徽标

阵营条的盟约 id **等于**阵营 id（`plugins/mota/server/match/monsterBonds.js:111-137`），`monsterFactionIds` 命中 `map` 即算；一只怪可同时吃多条阵营盟约（`monsterBondIdsOf`，`plugins/mota/server/match/monsterBonds.js:333-339`）。卡面只显示**第一条**命中的阵营（顺序 = `MONSTER_BOND_DEFS`，`monsterBondIdForEnemy`：`plugins/mota/server/match/monsterBonds.js:348-351`），帧字段 `slots[].bond = { id, name }`（`plugins/mota/server/match/monsterShop.js:500-511`）；命不中就不带该键，老帧形状不变。三条通用（增援 / 会战 / 回收）不是怪物属性，不参与徽标。

---

### 40.4 六个等级（星级）

#### 40.4.1 切点与标定口径

| 项目 | 值 | 出处 |
|---|---|---|
| 切点（基础价量纲） | `[39, 57, 87, 134, 176]` | `plugins/mota/server/match/monsterPool.js:45` |
| 档数 | 6（`切点数 + 1`） | `plugins/mota/server/match/monsterPool.js:88` |
| 定阶函数 | `cost > band` 逐级 +1，非有限 / 非正 → 1 | `plugins/mota/server/match/monsterPool.js:95-103` |
| 量纲 | `attrPower` = `atk×5 + maxHp + def×3 + res×3`；`confrontValue = round(stat / 120)` | `plugins/mota/server/match/monsterPool.js:24-26`、`plugins/mota/server/match/match/confront.js:97-110` |

标定口径（`plugins/mota/server/match/monsterPool.js:20-32`）：

- 切点是 2026-11-04 在**基线池子集**上按 `attrPower` 六等分位定的：`confrontPool(data/factions.json) ∩ data/enemies.json` = **120 只**（实测：`confrontPool` 120 条、全部在 `enemies.json` 里）。用子集而非全表，是因为全表 BOSS 的 `attrPower` 离群（当前最大值 2,506,480，中位数 15,000），会把分位整体拉坏。
- 切点按 `attrPower` 算完后 ÷120 存成**基础价量纲**，所以 `monsterTierOf(confrontValue(rec))` 与按 `attrPower` 分档等价。
- 在该 120 只上每档实测 **20 / 20 / 21 / 20 / 19 / 20** 只（本次复核一致）。
- 切点**冻结不重算**：2026-11-05 池放宽到 483 只后，业主口径是「按现有的 6 档切点分档」。旧切点 `[25,50,100,200]`（2026-11-03）在同一子集上实测 5 / 26 / 34 / 40 / 15，已废弃（`plugins/mota/server/match/monsterPool.js:29`）。
- `[ASSUMED]` 代码注释记录的六分位原值（4730 / 6840 / 10390 / 16100 / 21150，`plugins/mota/server/match/monsterPool.js:42`）与本次在 120 只上重算的六分位（5010 / 7080 / 10400 / 16460 / 21530 ≈ 42 / 59 / 87 / 137 / 179）有约 5–7% 偏差；切点是冻结值，不随数据重算，本文以代码常量为准。
- 定阶只看**基础价**，不看本回合价：本回合价随 `gd.enemyScale` 的 hp/atk 倍率整体上浮，同一只怪在后期会跳档；阶位是固有稀有度（`plugins/mota/server/match/monsterPool.js:30-31`）。

#### 40.4.2 池放宽后的分布与 T6 偏多

483 只（排除 `tokenOnly`）实测档位分布（本次按代码常量复算，与 `plugins/mota/server/match/monsterPool.js:27-28` 记录一致）：

| 档 | T1 | T2 | T3 | T4 | T5 | T6 |
|---|---|---|---|---|---|---|
| 只数 | 58 | 60 | 69 | 74 | 49 | **173** |

T6 偏多的原因（实测）：

- T6 的 173 只里有 **95 只来自肉鸽补全**、78 只来自原表；补全的 242 条本来就偏高强度（肉鸽精英 / 领袖 / 假想敌部件）。
- `attrPower` 值域极偏：最小 2、中位数 15,000、P99 606,325、最大 2,506,480（「碎铳之簧」三条同值），一个 BOSS 就能顶掉上千只普通怪的量级。
- 阶位只用于两件事：卡面展示，以及**发牌阶位上限 = 商店等级**（§40.6.3）。偏斜不影响价格、库存与可玩性（价格另取本回合 `confrontValueOf`）。

---

### 40.5 卡池与库存

#### 40.5.1 池的来源：全表 483 只 + 官方波次成员保证

`monsterPoolKeys(m)` 是建池的遍历源（`plugins/mota/server/match/monsterPool.js:334-360`）：

1. **主来源 = `data/enemies.json` 全表**，排除 `tokenOnly` ⇒ 483 只；不筛阵营、不筛官方波次。
2. **成员保证**：本回合官方出怪的 key **一定**进池（`officialSpawnKeys`，`plugins/mota/server/match/monsterPool.js:225-232`），包括被 `tokenOnly` 过滤或数据里缺条目的边角 —— 官方怪不能买不到。
3. **回落**：`data` 不可用（直测 / 精简 stub）时走「面板并集 → `confrontPool(data/factions.json)`」，绝不返回空池。

每回合**重建**一次池（`finishConfrontTargets`，`plugins/mota/server/match/match/confront.js:1372-1392`），库存每回合回到满值；重建的代价是上一回合被买走的份数被清空，这是预期语义（`plugins/mota/server/match/match/confront.js:1366-1369`）。

⚠ 池来源与**提交合法性**是两件事：`legalKeys` 仍是按回合的规则闸门（§40.13 第 2 条），商店只把合法集合里的 key 摆上货架（`illegalExcludes`，`plugins/mota/server/match/monsterShop.js:547-552`）。

#### 40.5.2 份数：官方干员商店 `poolCopies` 的等比换算

业主 2026-11-05 裁决「参考官方卫戍，等比换算」，公式唯一：

```
cap(tier) = max(1, round(MONSTER_OFFICIAL_COPIES_BY_TIER[tier] × MONSTER_COPY_SCALE))
MONSTER_COPY_SCALE = round(491 / 266 × 1000) / 1000 = 1.846
```

| 项目 | 值 | 出处 |
|---|---|---|
| 官方份数（基准） | `{1:12, 2:14, 3:18, 4:16, 5:8, 6:5}` | `plugins/mota/server/match/monsterPool.js:52`；原值在 `data/config.json` → `economy.poolCopies`（实测一致） |
| 干员池 key 数（分母） | 266 | `plugins/mota/server/match/monsterPool.js:55`；`data/chess.json` 实测 266 条 |
| 怪物池 key 数（分子） | 491 | `plugins/mota/server/match/monsterPool.js:57` |
| 缩放系数 | 1.846 | `plugins/mota/server/match/monsterPool.js:62` |
| 换算结果 | `{1:22, 2:26, 3:33, 4:30, 5:15, 6:9}` | `plugins/mota/server/match/monsterPool.js:73-80`（实测一致） |

- 每只怪的 `cap` 只由**它的阶位**决定（`buildMonsterPool`：`plugins/mota/server/match/monsterPool.js:392-410`，`cap` 取 `MONSTER_COPIES_BY_TIER[tier]`，缺表项兜底 1），与官方只数、攻方人数、商店等级都无关。
- 全池初始库存合计 = 22×58 + 26×60 + 33×69 + 30×74 + 15×49 + 9×173 = **9,625 份**（`[DATA]` 由上式与档位分布算出）。
- `shared` 模式按**队**算份数，不乘攻方人数：队友看到同一份库存，买走就少（`plugins/mota/server/match/monsterPool.js:396-404`）。

#### 40.5.3 旧口径为何废弃

旧口径「份数 = 官方该回合只数 × 1.5」只对官方波次成立；池放宽到全表后「官方该回合只数」不再是库存的约束，已废弃（`plugins/mota/server/match/monsterPool.js:79-85`）。保留导出 `MONSTER_POOL_COPIES_SHARE = 1.5` 只为不破坏外部引用，不参与任何公式。

「1.5 倍出怪量」现在由**军费**保证：每名攻方每回合拿到 `round(官方波次价值 × 1.5 ÷ 攻方人数)`（§40.8.2），库存不再是 1.5× 的约束（`plugins/mota/server/match/monsterPool.js:64-72`、`plugins/mota/server/match/match/confront.js:701-713`）。

---

### 40.6 怪物商店

形态照官方干员商店，数值不照抄（`plugins/mota/server/match/monsterShop.js:53-65`）。`m.monsterShopOn = isVersus && opts.monsterShop !== false`（`plugins/mota/server/match/match/confront.js:560-567`）；关掉时所有方法直接 `WRONG_PHASE`，卡池分支一行都不跑，行为与改造前一致。

#### 40.6.1 等级、槽位、升级价

| 项目 | 值 | 出处 |
|---|---|---|
| 等级范围 | 1–6 | `plugins/mota/server/match/monsterShop.js:70` |
| 槽位（一次摆几张） | 3 / 4 / 4 / 5 / 5 / 5（下标 = 等级 − 1） | `plugins/mota/server/match/monsterShop.js:68`（与官方 `mode_single_normal.shopSlots` 的 `chess` 列一致，`data/config.json` 实测） |
| 升级价 | `round(G × MONSTER_UPGRADE_SHARES[level − 1])`，比例 `[0.30, 0.45, 0.60, 0.65, 0.70]`（合计 2.70G） | `plugins/mota/server/match/monsterShop.js:75`、`plugins/mota/server/match/monsterShop.js:317-323` |
| `G`（全队军费总额） | `round(confrontWaveValue() × 1.5)` | `plugins/mota/server/match/match/confront.js:661-669`、`plugins/mota/server/match/monsterShop.js:304-309` |
| 升级效果 | 等级 +1 并**空开新槽**（只加长 `slots`、新格 `null`，不补卡）；满级 `ERR.MAX_LEVEL` 且不扣款 | `plugins/mota/server/match/monsterShop.js:335-363` |
| 扣款 | 走怪物资金账户，全有或全无 | `plugins/mota/server/match/monsterShop.js:347` |

`G` 与军费同源（`grantMonsterFunds`），不按「一整回合军费」定价 —— 否则升级那回合的出怪量会塌到 0（`plugins/mota/server/match/monsterShop.js:56-58`）。

#### 40.6.2 刷新与冻结

- 刷新价恒 `MONSTER_REFRESH_PRICE = 2`，**不随等级**；每回合 1 次免费、最多 2 次自费（`plugins/mota/server/match/monsterShop.js:87-92`）。免费次数先抵，再走自费；自费超限 → `WRONG_PHASE` 且不扣钱、不重抽（`plugins/mota/server/match/monsterShop.js:700-726`）。
- 冻结**按格**：`g.monsterFreeze` 切换 `slot.frozen`（`plugins/mota/server/match/monsterShop.js:838-851`）。冻结只对「本回合、未售出、仍在合法集合里」的那张卡生效，其余重抽（`dealSlots` 的 `keep`，`plugins/mota/server/match/monsterShop.js:586-589`）；补位的新卡不继承冻结（`plugins/mota/server/match/monsterShop.js:597-621`）。商店每回合重建，所以冻结**不跨回合**。

#### 40.6.3 发牌：阶位上限 = 商店等级，且不排重

- 阶位上限：`monsterTiersForLevel` 返回 `[1..level]`，每格 `pool.roll(rng, { tiers, exclude: illegal })`（`plugins/mota/server/match/monsterShop.js:554-565`、`plugins/mota/server/match/monsterShop.js:583`、`plugins/mota/server/match/monsterShop.js:591`）。等级 1 只出 T1、等级 3 只出 T1–T3、等级 6 六档全出 —— 与官方干员商店的 `maxTier = shop.level` 同构。
- 权重 = 该 key 的**剩余份数**（`MonsterPool.roll` 按 `left` 加权，`plugins/mota/server/match/monsterPool.js:193-213`），没有另造各阶概率表。
- **不排重**：每格独立抽，同一次发牌允许出现重复 key（2026-11-05 按官方机制去掉旧的两轮排重，`plugins/mota/server/match/monsterShop.js:567-575`、`plugins/mota/server/match/monsterShop.js:588-593`）。发牌**不扣库存**（扣库存在买 / 投时）。
- 只摆「本回合合法集合 ∩ 池里有货」的怪；抽不到就置 `null`，客户端画虚线空框（`plugins/mota/server/match/monsterShop.js:591-593`、`plugins/mota/server/match/monsterShop.js:617-618`；`plugins/mota/client/js/ui/shopBar.js:335-337`）。

#### 40.6.4 等级跨回合持久

等级不能挂 `ps.monsterShop`（那东西每回合被 `openMonsterShop` 整块重建、回合末被 `closeMonsterShop` 删掉，挂上去等于每回合掉回 1 级）。等级挂 **Match 级 Map** `m.monsterShopLevels`，键与池同口径（`solo` 按人、`shared` 按队），懒建、首次 seed 1（`plugins/mota/server/match/monsterShop.js:237-284`）；`finishConfrontTargets` 开店前 seed 一次（`plugins/mota/server/match/match/confront.js:1377-1380`），`closeMonsterShop` 只删货架与草稿、不动等级（`plugins/mota/server/match/monsterShop.js:903-909`）。

#### 40.6.5 私有帧与意图

- 意图：`g.monsterBuy` / `g.monsterRefresh` / `g.monsterFreeze` / `g.monsterDrop` / `g.monsterPlace` / `g.monsterLevelUp`（`plugins/mota/server/match/match/intents.js:22-32`）。
- 成功时推一帧私有 `m.monsterShop` 给本席，并给同队其他人补帧（共享池的库存 / 草稿必须同步）；公共帧刻意不带商店（`plugins/mota/server/match/match/intents.js:127-139`、`plugins/mota/server/match/monsterShop.js:636-648`）。
- 帧字段：`open` / `round` / `refreshPrice` / `freeRefreshes` / `refreshes` / `level` / `maxLevel` / `upgradePrice` / `slotsPerLevel` / `budget` / `spent` / `left` / `funds` / `grant` / `earned` / `slots[]`（`index,key,name,tier,price,frozen,sold,left,cap,bond?`）/ `draft.picks[]`（`id,enemyKey,gate`）/ `bonds[]`（`plugins/mota/server/match/monsterShop.js:455-522`）。客户端只读这一帧，不本地维护 slots / 草稿（`plugins/mota/client/js/main.js:301-302`）。

---

### 40.7 投放交互

客户端入口都在攻方商店条里；投放方**没有**「已投名单」，名单只给守方（`plugins/mota/client/js/screens/game.js:331-334`、`plugins/mota/client/js/screens/game.js:1933`）。

#### 40.7.1 三种手势

| 手势 | 行为 | 出处 |
|---|---|---|
| 点一下 | 投 **1 只**到「上一次成功投放的门」（默认下门） | `plugins/mota/client/js/ui/shopBar.js:683`、`plugins/mota/client/js/ui/shopBar.js:850-855`、`plugins/mota/client/js/ui/shopBar.js:713-725` |
| 长按 ≥ **550 ms** | 进多选态（这一格自动选中；再长按同一格退出）；多选态里点卡 = 选中 / 取消 | `plugins/mota/client/js/ui/shopBar.js:294-295`、`plugins/mota/client/js/ui/shopBar.js:731-744`；`plugins/mota/client/js/ui/longPress.js:16` |
| 按住并移动 > **8 px** | 变拖拽：折叠商店条、换取景、跟随 ghost；松手命中门就投放（多选态每格各 1 只） | `plugins/mota/client/js/ui/shopBar.js:203`、`plugins/mota/client/js/ui/shopBar.js:747-770`、`plugins/mota/client/js/ui/shopBar.js:796-845` |

- 长按与拖拽互斥：`longPress` 的移动阈值与 `MON_DRAG_PX` 同为 8 px，移动超限直接取消长按（`plugins/mota/client/js/ui/longPress.js:19-20`、`plugins/mota/client/js/ui/longPress.js:109-117`）。
- 拖完松手浏览器补的那一下 `click` 会被丢弃（400 ms 内，`plugins/mota/client/js/ui/shopBar.js:825`、`plugins/mota/client/js/ui/shopBar.js:852`）。
- 客户端先把只数夹到 `min(20, 库存, floor(剩余预算 / 单价))`，与服务端同源；夹到 0 直接提示「剩余预算不足」（`plugins/mota/client/js/ui/shopBar.js:188-194`、`plugins/mota/client/js/ui/shopBar.js:717-718`）。
- 同一格在网络往返中只发一次（单飞锁），因为投放成功后该格**立刻补位**，连点会投出新补的那张（`plugins/mota/client/js/ui/shopBar.js:688`、`plugins/mota/client/js/ui/shopBar.js:716`、`plugins/mota/client/js/ui/shopBar.js:721-724`）。

#### 40.7.2 门的判据与拖拽取景

- 战场门只有两个：上门 `(12,10)`、下门 `(9,10)`（`GEO.FIELD = rows 9–12 / cols 2–10`，`plugins/mota/shared/constants.js:110`；`plugins/mota/client/js/ui/shopBar.js:698-699`）。
- 判门**只看行**：`GATE_SPLIT = GEO.FIELD.r1 - 1 = 11`，`row >= 11 → upper`，`row 9–10 → lower`，`row` 落在 9–12 之外 → `null`（取消投放）（`plugins/mota/client/js/ui/shopBar.js:201`、`plugins/mota/client/js/ui/shopBar.js:210-213`）。
- 拖拽开始：商店条折叠（复用 `onCollapse`），镜头切到 `DROP_CAM` —— `{ kind:'normal', rect:{r0:9,r1:12,c0:2,c1:10}, side:'L', fit:true }`，把两扇门与整块战场都框进视野（`plugins/mota/client/js/screens/game.js:203-207`、`plugins/mota/client/js/screens/game.js:490-504`；`plugins/mota/client/js/ui/shopBar.js:751-762`）。松手把**拖之前**的取景原样还回去（`plugins/mota/client/js/ui/shopBar.js:764-770`、`plugins/mota/client/js/screens/game.js:500-504`）。
- 拖拽期的高亮：命中半区画 SVG 边框（`halfRegionPoly`，`plugins/mota/client/js/ui/shopBar.js:243-257`、`plugins/mota/client/js/ui/shopBar.js:923-929`）；浮动卡显示图标 + `×N`（`plugins/mota/client/js/ui/shopBar.js:918-922`）。
- 拖拽期间折叠后的商店小条 `pointer-events: none`，否则下门会被它压住、落点判成「不是门」（`plugins/mota/client/js/ui/shopBar.js:931-938`）。

#### 40.7.3 服务端夹紧与草稿

- `g.monsterPlace { index, gate, count? }` → `placeMonster`：只数 = `min(20, 可用库存, floor(余额 / 单价), 想要)`；夹到 0 → `CONFRONT_BUDGET` 且不动库存（`plugins/mota/server/match/monsterShop.js:789-831`，夹紧在 `plugins/mota/server/match/monsterShop.js:811-816`）。
- 按**实际投下的只数**扣款（`spendMonsterFundsFrom(price × placed)`），扣不动就把刚取的库存还回去（全有或全无，`plugins/mota/server/match/monsterShop.js:818-821`）。
- 每投一只写一条草稿 `ps.monsterDraft.picks`，带**稳定 id**（`seq` 单调递增，`nextMonsterPickId`：`plugins/mota/server/match/monsterShop.js:657-662`、`plugins/mota/server/match/monsterShop.js:822-827`）；用掉后该格立即补位（`refillSlot`，`plugins/mota/server/match/monsterShop.js:829`）。
- 闸门顺序：商店开着 → 未点准备 → 投放窗口 → 攻方 → 有投放权 → 格子 / 门合法 → 未售出 → 本回合合法集合 → 库存 → 留份 → 价格（`plugins/mota/server/match/monsterShop.js:790-816`）。人类点准备后不能再投；bot 不受此限（`readyLocked`，`plugins/mota/server/match/monsterShop.js:100-105`）。
- PREP 结束时 `finishConfront` 把草稿按 `submitConfront` 的同一套判据（`_confrontMember`）转成正式提交；被拒会记一条服务端日志再走兜底，不静默丢弃（`plugins/mota/server/match/match/confront.js:1748-1773`）。人类空草稿 = 本回合什么都不投，不替人做主（`plugins/mota/server/match/match/confront.js:1760-1772`）。

#### 40.7.4 撤回与名单可见性

- 「撤回上一只」：攻方状态条上的一个按钮，发 `g.monsterDrop { index, id? }`，撤的是草稿**最后一条**，带它的稳定 id（多端并发不会撤错行）。服务端优先按 `id` 定位，没给 `id` 才按下标（`plugins/mota/client/js/screens/game.js:340-352`；`plugins/mota/server/match/monsterShop.js:867-894`）。
- 撤回会退还库存与资金（按当前单价的 `monsterPriceOf`），并退回盟约层数；已售出的商店格不回滚（卡已经从货架消失）（`plugins/mota/server/match/monsterShop.js:882-893`）。
- **投放方不看名单**：攻方只看到「已投 N 只」与撤回按钮（`plugins/mota/client/js/screens/game.js:1934-1939`）；守方在 PREP 里看到 `priv.incoming` 列表（怪种 / 上下路 / 时刻 / 来源席位），由 `incomingFor` 只对守方生成（`plugins/mota/server/match/match/views.js:365-385`；渲染 `plugins/mota/client/js/screens/game.js:1942-1949`）。

---

### 40.8 怪物资金

#### 40.8.1 账户与归属

攻方有**独立的怪物资金账户**，与守方的 `funds` 完全分开：不进统计、`econSplitLeftover` 不会清零它（`plugins/mota/server/match/monsterShop.js:9-17`）。归属随 §40.1.2：

- `shared`：队级 Map `m.teamMonsterFunds`（`plugins/mota/server/match/monsterShop.js:147-151`），同队成员写回同一个值作镜像（`syncTeamMonsterFunds`，`plugins/mota/server/match/monsterShop.js:169-180`）。`Match` 构造期把每个席位的 `ps.addMonsterFunds` / `ps.spendMonsterFunds` 改道到 Match 侧访问器，所以守方模块（settle 的发奖）不必各改一行（`plugins/mota/server/match/Match.js:516-547`）。
- `solo`：各人 `ps.monsterFunds`。
- 唯一入口：`monsterFundsOf` / `addMonsterFundsTo` / `spendMonsterFundsFrom`（`plugins/mota/server/match/monsterShop.js:187-234`）；扣款**全有或全无**。
- **跨回合结转**：回合边界不清账户，只重置帧上的 `monsterGrant`（本回合军费）与 `monsterEarned`（本回合奖励）（`plugins/mota/server/match/match/confront.js:718-726`）。

#### 40.8.2 收入

| 来源 | 金额 | 出处 |
|---|---|---|
| 军费（每回合） | `round(官方波次价值 × 1.5 ÷ 攻方人数)`，对每个攻方各发一份 | `plugins/mota/server/match/match/confront.js:715-728`（公式 `plugins/mota/server/match/match/confront.js:717`） |
| 击杀奖励 | 自己投放的怪每被击杀一只 **+2** | `plugins/mota/server/match/match/settle.js:15-16`、`plugins/mota/server/match/match/settle.js:109-121` |
| 漏过奖励 | 自己投放的怪每漏过一只 **+4**（漏过 = 达成本回合目的） | 同上 |
| 盟约返款 | 增援 / 回收（回合收尾发放） | §40.9.4 |

- 军费发放点 = `finishConfrontTargets`（攻方名单 / 人数 / 本回合波次都已确定，必须在开店与推首帧之前，否则第一帧余额是 0）（`plugins/mota/server/match/match/confront.js:1372-1376`）。
- 波次价值用 `confrontValueOf(key, s.mods || scale) × count` 累加（`plugins/mota/server/match/match/confront.js:646-654`），与卡价同一个函数，所以「买得起 = 交得上」。
- `shared` 模式：两个攻方各发一份，全部进**同一个队级账户** ⇒ 全队总军费仍 = 1.5 × 波次价值（`plugins/mota/server/match/match/confront.js:722-726`）。
- 奖励的归属：`confrontKills` / `confrontLeaks` 的键是**投放席位** `String(seat)`，settle 用 `this.order` 查回 `playerId`，只发给投放者本人（已淘汰不发）（`plugins/mota/server/match/match/settle.js:75-107`）。

#### 40.8.3 支出

| 动作 | 扣款 | 出处 |
|---|---|---|
| 买卡 | 单价（`monsterPriceOf`） | `plugins/mota/server/match/monsterShop.js:757-762` |
| 投放 | 单价 × 实际只数 | `plugins/mota/server/match/monsterShop.js:818-821` |
| 刷新 | `MONSTER_REFRESH_PRICE`（免费次数内为 0） | `plugins/mota/server/match/monsterShop.js:714-719` |
| 升级 | `round(G × share)` | `plugins/mota/server/match/monsterShop.js:345-348` |
| 撤回 | **退款**：`+monsterPriceOf(key)` 并把库存还回本队池 | `plugins/mota/server/match/monsterShop.js:885-892` |

提交侧（`g.confront`）只对**尚未付款**的部分收钱：草稿里同 key 的条数与本回合已付过的条数先抵扣，避免同一笔钱收两遍（`_confrontChargeFor` / `_confrontPayPicks`，`plugins/mota/server/match/match/confront.js:782-839`；额度 = 账户余额，`plugins/mota/server/match/match/confront.js:763-770`）。所以客户端新路径（点卡即投放）不需要再发 `g.confront`，旧路径仍可用。

---

### 40.9 怪物盟约

怪物盟约是**攻方专属、与干员盟约平行的另一套**：数据、状态、installer 一律不共用；状态在 `m.monsterBonds = Map<归属键, Record<盟约 id, 层数>>`，**每回合重置**（`plugins/mota/server/match/monsterBonds.js:1-34`）。

#### 40.9.1 22 条阵营 + 3 条通用

`MONSTER_BOND_DEFS` 共 25 条：22 条阵营（id 与 `data/monster-factions.json` 的阵营 id 相同）+ 3 条通用（`plugins/mota/server/match/monsterBonds.js:107-145`）。

| 通用条 | id | 层数含义 | 阈值 | 效果 |
|---|---|---|---|---|
| 增援 | `reinforce` | 本回合投放总只数 | `[2,4,6]` | 超出「官方只数 × 1.5」的部分按均价 ×20% 返还，× 档倍率 |
| 会战 | `concert` | 本队投过 ≥1 只的攻方人数 | `[2,3,4]` | 达一阶 → 全队 `speedMul +0.05`（固定值） |
| 回收 | `recover` | 本回合投放怪漏过只数 | `[2,4,6]` | 在 settle 既有奖励之上再 +50%，× 档倍率 |

#### 40.9.2 层数与阈值（按阵营本回合可投放池只数取比例）

层数来源只有投放：`addMonsterBonds` 给该怪命中的每条阵营盟约 `+n`，同时 `reinforce += n`、`placed += n`、`cost += price × n`、`byPlayer[playerId] += n`；撤回按同一口径退回（`plugins/mota/server/match/monsterBonds.js:392-405`、`plugins/mota/server/match/monsterBonds.js:413-430`）。官方波次不进这里 —— 只算攻方投放的怪。

阈值是**动态**的（`factionThresholdsOf`，`plugins/mota/server/match/monsterBonds.js:232-239`）：

```
t1 = max(1, ceil(n × 0.15))
t2 = max(t1 + 1, ceil(n × 0.30))
t3 = max(t2 + 1, ceil(n × 0.45))
```

`n` = 该阵营在**本回合可投放池**里的**只数**（分母与怪物池同口径：`monsterCardKeys(m)`；有官方快照时按该 key 的官方合计只数累加，赏金档 / 无快照时每 key 计 1 只）（`plugins/mota/server/match/monsterBonds.js:248-266`、`plugins/mota/server/match/monsterPool.js:239-247`）。`n = 0` → `[1,2,3]`（形态占位，该阵营本回合无牌）。`max(t + 1, …)` 保证三阶不塌成同一层。

实测阈值表（`n` → 三阶）：

| n | 1 | 2 | 3 | 4 | 5 | 6 | 8 | 10 | 12 | 15 | 20 | 30 | 36 | 60 | 102 | 118 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 阈值 | 1/2/3 | 1/2/3 | 1/2/3 | 1/2/3 | 1/2/3 | 1/2/3 | 2/3/4 | 2/3/5 | 2/4/6 | 3/5/7 | 3/6/9 | 5/9/14 | 6/11/17 | 9/18/27 | 16/31/46 | 18/36/54 |

- 分母按回合走，所以**小池阵营阈值低**（3 只就能吃一阶），大阵营阈值高；这正是 2026-11-04 重定阈值的目的（`plugins/mota/server/match/monsterBonds.js:23-27`）。
- 实测：对抗档的分母 = 本回合官方出怪（通常几只到二十几只），所以实际阈值普遍落在 1–9 层，远低于 §40.3.1 表里的「池内只数」列。
- 阶 = 达到几个阈值就是几阶（0 = 未激活，`monsterBondTier`：`plugins/mota/server/match/monsterBonds.js:289-294`）。

#### 40.9.3 效果：spawn 的六个乘区

每条阵营盟约只给**一个**乘区，`per` 0.03–0.05、单条上限 `cap = 0.3`；乘数语义 = `1 + Δ`，多层按 `min(cap, per × layers)` 累加，同一个乘区可被多条阵营叠加（`plugins/mota/server/match/monsterBonds.js:147-164`、`plugins/mota/server/match/monsterBonds.js:548-567`）。

| 阵营 | 乘区 | 每层 | 上限 | | 阵营 | 乘区 | 每层 | 上限 |
|---|---|---|---|---|---|---|---|---|
| SARKAZ | `hpMul` | 0.03 | 0.3 | | IBERIA | `speedMul` | 0.05 | 0.3 |
| COLUMBIA | `atkMul` | 0.03 | 0.3 | | LATERANO | `aspdMul` | 0.05 | 0.3 |
| DEEP_POOL | `defMul` | 0.03 | 0.3 | | SIESTA | `hpMul` | 0.05 | 0.3 |
| REUNION | `resMul` | 0.03 | 0.3 | | VICTORIA | `atkMul` | 0.05 | 0.3 |
| SEA_BORN | `speedMul` | 0.04 | 0.3 | | LEITHANIEN | `defMul` | 0.05 | 0.3 |
| YAN | `aspdMul` | 0.04 | 0.3 | | KAZIMIERZ | `resMul` | 0.05 | 0.3 |
| BOLIVAR | `hpMul` | 0.04 | 0.3 | | SARGON | `speedMul` | 0.05 | 0.3 |
| KJERAG | `atkMul` | 0.05 | 0.3 | | DURIN | `aspdMul` | 0.05 | 0.3 |
| URSUS | `defMul` | 0.05 | 0.3 | | HIGASHI | `hpMul` | 0.05 | 0.3 |
| SIRACUSA | `resMul` | 0.05 | 0.3 | | SAMI | `atkMul` | 0.05 | 0.3 |
| — | — | — | — | | ORIGINIUM | `defMul` | 0.05 | 0.3 |
| — | — | — | — | | IMAGINARY | `resMul` | 0.05 | 0.3 |

- `per` 分档按**基线 120 只池**的只数给：n ≥ 10 → 0.03、5–9 → 0.04、0–4 → 0.05（池小补偿）；六个乘区按 n 降序**轮转分配**（hp → atk → def → res → speed → aspd），并列按 `MONSTER_BOND_DEFS` 顺序（`plugins/mota/server/match/monsterBonds.js:152-163`）。
- 两个新阵营取「与相邻阵营同级」= 0.05 / 0.3，**不重排**既有 20 条（重排会改既有阵营的实机乘区）：ORIGINIUM 续 rank20 → `defMul`，IMAGINARY 续 rank21 → `resMul`（`plugins/mota/server/match/monsterBonds.js:206-217`）。
- 乘区乘进 spawn 的 `mods`：`mergeMonsterBondMods(roundMods, monsterBondMods(...))` 只乘不覆盖，投放怪与事件期 boss 都吃（`plugins/mota/server/match/match/confront.js:2029-2031`、`plugins/mota/server/match/match/confront.js:2086-2088`；`plugins/mota/server/match/monsterBonds.js:574-582`）。`aspdMul` 在两棵 sim 树的 `spawns.js` 都认（`plugins/mota/server/match/monsterBonds.js:29-31`）。
- 会战是唯一不按层的效果：达一阶（2V2 = 两人都投过；4V4 按 `[2,3,4]`）→ `speedMul +0.05` 固定值（`plugins/mota/server/match/monsterBonds.js:559-561`）。

#### 40.9.4 通用三条与回合收尾

收尾在回合边界：`closeMonsterBondRound` 把资金类盟约按本回合最终口径发给投放者，然后清空 `m.monsterBonds` 与快照（`plugins/mota/server/match/monsterBonds.js:610-652`；调用点 `plugins/mota/server/match/match/phases.js:475`，兜底清空 `plugins/mota/server/match/match/phases.js:493`）。

- **增援**：`surplus = max(0, placed − 官方只数 × 1.5)`，金额 = `surplus × 均价 × 0.2 × MONSTER_BOND_TIER_MUL[tier]`（档倍率 `[0,1,1.5,2]`）（`plugins/mota/server/match/monsterBonds.js:631-639`）。
- **回收**：settle 已按 `MONSTER_LEAK_REWARD = 4` 发过全额，这里只发 **额外 +50%**：`leaked × 4 × 0.5 × 档倍率`（`plugins/mota/server/match/monsterBonds.js:640-646`）。
- **分摊**：同队共享池按各人投放只数比例分摊；`shared` 进队级账户、`solo` 进个人账户（`plugins/mota/server/match/monsterBonds.js:617-630`）。
- 漏怪数读的是 settle 在清 `this.fields` **之前**钉下的快照 `m._bondRoundStats`（`captureMonsterBondLeaks`：`plugins/mota/server/match/monsterBonds.js:447-477`，触发点 `plugins/mota/server/match/monsterShop.js:202-216` 与 `plugins/mota/server/match/match/confront.js:560-567`）—— settle 结尾会清 fields（`plugins/mota/server/match/match/settle.js:238`），直接读会恒为 0。
- 视图：`m.monsterShop.bonds = [{ id, name, layers, tier, active }]`，空则整个键不出现（`plugins/mota/server/match/monsterBonds.js:588-599`）；客户端 `.mbonds` 条与卡面徽标读它（`plugins/mota/client/js/ui/shopBar.js:584-599`、`plugins/mota/client/js/screens/game.js:1845-1846`）。

---

### 40.10 对称血量

2026-11-03 业主改判：**攻方投放失败也要扣攻方自己的血**，不再是「免费泄漏、只为击杀赏金」。两笔扣血都是每只 1 点、各自吃本回合上限 `lpCapPerRound`（`data/config.json` 实测 10，读取点 `plugins/mota/server/match/gamedata.js:599`），扣的都是**队伍共享池**（`m.teamLps`）。

#### 40.10.1 守方：投放怪泄漏

- 汇总：逐场读 `fr.confrontLeaks`（键 = 投放席位），把该场所有泄漏加到该场玩家的 `placedLeaksByPlayer`（`plugins/mota/server/match/match/settle.js:70-86`）。
- 结算：`loss = min(cap, counted + placedLeaks)`，`counted` = 官方漏怪里 `counted !== false` 的只数 —— 官方漏怪与投放怪泄漏**合并后**再吃一个上限（`plugins/mota/server/match/match/settle.js:122-141`，公式 `plugins/mota/server/match/match/settle.js:129`）。
- 扣血：`this._versusTeamLpLoss(teamIdOf(ps), loss)`，再 `_syncVersusTeamLp` 把池按存活人数拆分回各人的 `ps.lp`（`plugins/mota/server/match/match/settle.js:137-140`、`plugins/mota/server/match/match/infra.js:162-187`）。

#### 40.10.2 攻方：投放怪被击杀

- 汇总：`fr.confrontKills`（键 = 投放席位）→ 按席位查回 `playerId` → 累加到该玩家所在队的 `placedKillsByTeam`（`plugins/mota/server/match/match/settle.js:92-99`）。
- 结算：每队 `loss = min(cap, n)`，在本回合淘汰判定**之前**扣（`plugins/mota/server/match/match/settle.js:200-207`）。
- 语义：自己投得越多、被打掉越多，自己队掉血越多 —— 攻方不能靠「堆怪」白嫖。

#### 40.10.3 归属链路（从投放到扣血）

1. `_confrontMember` 把 `seat: ps.seat` 写进 sub（`plugins/mota/server/match/match/confront.js:1531`）。
2. `applyConfront` / `_confrontBossSpawns` 给每个投放 spawn 写 `confrontSeat = sub.seat`、`confrontPlaced: true`、`countInTotal: false`（`plugins/mota/server/match/match/confront.js:2033`、`plugins/mota/server/match/match/confront.js:2052-2066`、`plugins/mota/server/match/match/confront.js:2089-2098`）。
3. `spawns.js` 把 `confrontSeat` 带进战斗单位（`plugins/mota/server/sim/battle/spawns.js:32`、`plugins/mota/server/sim/battle/spawns.js:135-137`）。
4. sim 两张按席位计数表：`confrontKills` / `confrontLeaks`（`plugins/mota/server/sim/Battle.js:159-160`），击杀自增在 `plugins/mota/server/sim/battle/deploy.js:159-162`、泄漏自增在 `plugins/mota/server/sim/battle/deploy.js:279-282`。
5. 结果透传：`plugins/mota/server/sim/battle/lifecycle.js:249-250` → `spec.js` 的 `compactResult` 白名单（`plugins/mota/server/sim/spec.js:465-466`）→ `settle` 读 `f.result`（`plugins/mota/server/match/match/settle.js:24-28`）。
6. `monsterBonds` 的「回收」也读同一份计数（`plugins/mota/server/match/monsterBonds.js:483-501`）。

---

### 40.11 攻方视图

攻方**没有自己的棋盘**：`startCombat` 只为守方建场（`plugins/mota/server/match/match/combat.js:173`、`plugins/mota/server/match/match/combat.js:187`），攻方本回合只投放、观战。客户端因此把「投放期」与「战斗期」做成**同一套取景**：

- PREP（投放期）：攻方走与守方一样的 prep 相机请求（`prepCameraFor` → `{ kind:'prep', rect: GEO.NORMAL_RECT, side:'L' }`，`plugins/mota/client/js/screens/game.js:642-645`、`plugins/mota/client/js/screens/game.js:834-836`）。代码注释明确「攻方没有自己的棋盘，投放窗口与观战该 field 取同一套景」。
- COMBAT（战斗期）：攻方不是 fighter，走普通观战路径（客户端发 `g.watch` 拉守方战场，`plugins/mota/client/js/screens/game.js:816-821`）；服务端只为守方建场（`plugins/mota/server/match/match/combat.js:173`）。
- 拖拽投放时临时换成整场 `DROP_CAM`（rows 9–12 / cols 2–10，`fit: true`），松手复原（§40.7.2）。

---

### 40.12 怪物方 AI 契约

攻方的 AI 决策抽成 **3 个 hook**，引擎只负责校验与落地（`plugins/mota/server/match/monsterContract.js:8-18`）：

| hook | 签名 | 返回 `null` 的含义 |
|---|---|---|
| `pickTargets` | `(m, ps) → playerId \| null` | 交回引擎的 `assignConfrontTarget` |
| `shopPlan` | `(m, ps) → 本回合买了哪些格` | 引擎不读返回值，副作用是 `ps.monsterDraft.picks` |
| `deployPlan` | `(m, ps) → picks[] \| null` | 交回引擎的贪心填充（`fillConfrontPicks`） |

- 校验：id `/^[a-z][a-z0-9-]*$/`、只允许 7 个键（`id/name/desc/base` + 3 hook）、构造期强校验并冻结、`base` 可继承（缺省 = `MONSTER_LEGACY_SENTINEL`，三个 hook 全 `() => null`）（`plugins/mota/server/match/monsterContract.js:21-75`）。
- 内置两套（`plugins/mota/server/match/monsterStrategies.js:113-134`）：`legacy`（全交回引擎）、`cardpool`（开商店 → 按「威胁值 / 价格」买 → 把草稿交回引擎定路线与时刻）。
- 选择优先级：`SP_MONSTER_STRATEGY` > 缺省「对抗档 `cardpool` / 其它档 `legacy`」（`plugins/mota/server/match/monsterStrategies.js:155-161`）；只在 `m.monsterShopOn` 为真时才问策略（`plugins/mota/server/match/match/confront.js:1545-1547`）。
- 调用点：`botConfront` 依次 `pickTargets` → `shopPlan` → `deployPlan`，返回值仍要过 `_botConfrontPlan`（路线 / 时刻）与 `_sanitizeBotPicks`（预算 / 只数 / 合法性）；策略抛异常只记日志并回退引擎（`plugins/mota/server/match/match/confront.js:1547-1588`、`plugins/mota/server/match/match/confront.js:68-72`）。
- `solo` 模式下无投放权的 bot 直接不补投放，避免绕过「商店不开」把队友的投放写进 `confrontSubs`（`plugins/mota/server/match/match/confront.js:1543`）。

---

### 40.13 已知缺口

1. **116 条无资产**：进池会渲染成占位（骷髅 / 菱形），不是缺数据、是缺美术文件；登记工具只写磁盘上真实存在的文件（§40.2.2）。
2. **`legalKeys` 仍按回合**：池里有 ≠ 交得上。提交合法性（以及货架 / 购买 / 投放）仍只看 `legalKeys` —— 对抗档 = 本回合官方出怪、赏金档 = 面板并集（`plugins/mota/server/match/monsterPool.js:283-306`、`plugins/mota/server/match/match/confront.js:1464-1469`、`plugins/mota/server/match/monsterShop.js:547-552`）。所以放宽到 483 只的池，当回合真正能上架的仍只有「官方出怪里出现过的怪」；全表的价值主要在阶位 / 份数 / 价格口径与官方成员保证。
3. **低等级 + 窄合法集可能空货架**：等级 1 只发 T1，而合法集（官方出怪）里可能一只 T1 都没有 → 每格 `pool.roll` 返回 `null` → 虚线空框（`plugins/mota/server/match/monsterShop.js:591-593`、`plugins/mota/server/match/monsterShop.js:617-618`；`plugins/mota/client/js/ui/shopBar.js:335-337`）。同理 `refillSlot` 抽不到就置空。
4. **结算页对攻方不显示盟约**：`results.js` 对对抗局攻方直接给 `bonds: []`（干员盟约与怪物盟约都不显示），因为怪物盟约每回合重置、settle 时没有最终快照（`plugins/mota/server/match/results.js:111-115`、`plugins/mota/server/match/results.js:132`）。
5. **引擎改动无自动化测试**：`test/` 下没有任何文件引用 `monsterPool` / `monsterShop` / `monsterBonds` / `monsterPlace` / `monsterDrop`（实测 `grep -rln` 命中 0 个文件）；`invariants.js` / `audit.js` 也没有怪物侧的自检项。现有证据来自 `_tmp` 下的手工 probe 与真机复验。
6. **`MONSTER_POOL_COPIES_SHARE = 1.5` 是死常量**：保留导出只为不破坏外部引用，不参与任何公式（`plugins/mota/server/match/monsterPool.js:79-85`）；「1.5 倍」只在军费里出现。

---

### 40.14 验收方式

本地起一局 versusRoom（`bounty` 与 `confront` 各一局，`monsterMode` 分别 `shared` / `solo`），逐项确认：

1. **两档**：`variant=confront` → 攻守固定、无 10 s 目标选择遮罩、倍速恒 1；`variant=bounty` → 每回合攻守互换、倍速可选 1/1.5/2。故意传未知串 → 回落 `bounty`（`plugins/versus-room/server/versusLobby.js:30-31`、`plugins/mota/server/match/Match.js:313-315`）。
2. **投放窗口**：PREP 里攻方商店条可用，守方同一 deadline；攻方点准备后投放被拒（`plugins/mota/server/match/monsterShop.js:112-115`、`plugins/mota/server/match/monsterShop.js:100-105`）。
3. **商店数值**：1 级 3 格、升级后 4/4/5/5/5；升级价 = `round(G × 0.30/0.45/0.60/0.65/0.70)`；刷新第一次免费、之后 2、最多 2 次自费；冻结只影响该格（`plugins/mota/server/match/monsterShop.js:68-92`、`plugins/mota/server/match/monsterShop.js:317-363`、`plugins/mota/server/match/monsterShop.js:700-726`、`plugins/mota/server/match/monsterShop.js:838-851`）。
4. **发牌上限**：1 级只出现 T1 卡；升到 3 级后最多 T3；同一次发牌可能出现重复 key（`plugins/mota/server/match/monsterShop.js:554-565`、`plugins/mota/server/match/monsterShop.js:588-593`）。
5. **库存**：`slots[].cap` 与阶位对应（22/26/33/30/15/9），买 / 投后 `left` 立刻减，投放后该格立即补位（`buildMonsterPool` 的 `cap`：`plugins/mota/server/match/monsterPool.js:406`；补位 `plugins/mota/server/match/monsterShop.js:829`）。
6. **交互**：点一下 = 1 只到上次的门；长按 550 ms 进多选、拖到 `(12,10)` / `(9,10)` 投放；拖拽期商店折叠且镜头切到 `DROP_CAM`，松手复原；「撤回上一只」退款退库存（§40.7）。
7. **资金**：军费 = `round(波次价值 × 1.5 ÷ 攻方人数)`；击杀 +2 / 漏过 +4；余额跨回合不清零；`shared` 两人读同一余额（§40.8）。
8. **盟约**：投 3 只 SIESTA（池内 5 只）→ 一阶（阈值 1/2/3）；`m.monsterShop.bonds` 出现 `{id,layers,tier,active}`；卡面徽标显示阵营名；回合边界后清空（§40.9）。
9. **对称血量**：投放怪漏过 → 守方队伍池 −1/只（与官方漏怪合计封顶 10）；投放怪被击杀 → 攻方队伍池 −1/只（封顶 10）；顶栏两队血条同步（`plugins/mota/server/match/match/settle.js:122-141`、`plugins/mota/server/match/match/settle.js:200-207`；`plugins/mota/server/match/match/views.js:122`）。
10. **视图**：攻方在 PREP 与 COMBAT 看到的是守方战场同一套取景；攻方看不到名单，守方 PREP 看到「来袭怪物」列表（§40.7.4、§40.11）。
