# 藏品合集（relics-87）—— 包契约与接入说明

> 状态：**已在上游部署线落地**（`ms/master`），本文件是管理器侧需要知道的那一层。
> 数据源：`湮灭藏品合集 v3.0.0`（87 条数据 + 87 张图标），此前从未发布过。

## 1. 这个包是什么

一个**只带数据与图标**的内容插件，不含任何可执行代码：

```
plugins/relics-87/
  plugin.json                 manifest 2
  data/relics.json            87 条
  client/assets/relics/*.png  87 张（经 code.client 以 /assets/relics/<id>.png 暴露）
```

`plugin.json` 的关键字段：

```json
{
  "manifest": 2,
  "id": "relics-87",
  "name": "湮灭藏品合集",
  "version": "3.0.0",
  "app": ">=0.3.0 <0.4.0",
  "api": 2,
  "class": "content",
  "scope": ["room"],
  "permissions": ["data.add"],
  "code": {
    "data": ["data/relics.json"],
    "client": ["assets/relics/n01.png", "... 共 87 个"]
  }
}
```

## 2. 接入的两个硬要求（踩过的坑）

1. **必须进房间内容集**：`code.data` 只有在插件被选入房间内容集时才会挂载。
   实测：只建插件、不进 `plugins/config.json` 的 `default` ⇒ 插件 `status: loaded`，但 `gd.raw.relics` 为空、商店「藏品」板块整个消失。
   ⇒ 安装后要把 `relics-87` 加进 `plugins/config.json` 的 `default`（或房间显式启用的插件列表）。
2. **信任钉**：`plugins/config.json` 的 `trusted` 由服务端自己算（`server/plugins/*`），包本身不含锁；
   分发时不需要带 `plugin.lock.json`（它由宿主 `tools/plugin.mjs pack <id>` 生成后钉住）。

## 3. 数据契约

`data/relics.json`：

```json
{
  "version": "3.0.0",
  "count": 87,
  "relics": [
    {
      "id": "n01",
      "kind": "negative",          // negative | positive
      "tier": "red",               // red(73) | blue(14)
      "no": "179",
      "set": "刻俄柏的灰蕈迷境",     // 出处
      "name": "鬼血",
      "desc": "所有敌方单位的 攻击力、防御力、生命值+20%",
      "icon": "/assets/relics/n01.png",
      "effect": { "enemy": { "atk": 0.2, "def": 0.2, "hp": 0.2 } }
    }
  ]
}
```

`effect` 是**声明式**的；使用方（游戏的 Match 层）自行决定消费哪些通道。当前上游实现消费的字段见 §5。

## 4. 运行时接口（使用方需实现）

藏品**不是商店商品**，是「海克斯式随机三选一」：

| 通道 | 契约 |
|---|---|
| 触发 | 仅协同共竞（`modeId` 以 `mode_xie_` 开头），回合 ∈ {4, 8, 12} |
| 发牌 | 每名存活玩家独立抽 3 件（排除已拥有；每人本局最多 3 件） |
| 私有视图 | `m.private.relicOffer = [{ id, name, desc, icon, tier, set, kind }]`、`m.private.relicOfferRound`、`m.private.relics` |
| 选择 | C2S `g.relicPick { relicId }`（只接受自己 offer 里的 id，否则 `BAD_TARGET`） |
| 超时 | 20 秒未选 ⇒ 自动取第一张 |
| 生效 | 入手即结算一次性效果；常驻效果由使用方在敌人生成等咽喉处聚合 |

## 5. 效果覆盖（当前上游实现）

87 条里 **31 条有实际效果**，按引擎已有通道：

- `enemy.{hp,atk}`、`enemyRank.{BOSS,ELITE}.{hp,atk}` → 敌人 `hpMul/atkMul`（带幂等标记，联防/接力不会重复乘）
- `deployCap` → `ps.deployCapBonus`
- `lpCap` / `immediate.{funds,lp,items}` → 获得时立即结算

**未生效 56 条**，按顶层键：`rule` 57（规则 DSL）、`price` 9、`ally` 7、`allyPerBench` 3、`income` 2、
`enemyMove` 2、`hand` 1、`refreshLimit` 1、`postBountyMul` 1、`enemyAspd` 1、`allyElite` 1。

要补齐需要一个规则解释器（原包自带的 `relics-server.js` 546 行 + `relics-battle.js` 358 行是另一套引擎的实现），
这一步仍未做；管理器侧只要保证「包能被装载、数据能被读到」即可。

## 6. 验证（已实测）

- `catalog.relics.length = 87`，tier 分布 `{2:14, 4:73}`（对应蓝 14 / 红 73）
- 藏品板块 87 张卡 / 87 个 `<img>`（图标真实加载，`/assets/relics/n01.png` 200）
- 三选一逻辑 15/15 通过（发牌 3 张不重复、非协同不发、回合表 {4,8,12}、选中入账、越权 `BAD_TARGET`、
  超时取第一张、每人 3 件上限）
