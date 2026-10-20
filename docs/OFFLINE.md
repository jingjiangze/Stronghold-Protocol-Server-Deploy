# 纯浏览器独立模拟（不连服务器也能玩）

目标：**同一份前端**，背后有服务器就是联机；没有服务器（静态托管 / 断网 / 服务暂时挂了）就是单人离线局，界面与玩法零改动。离线局跑到结算后，布阵照旧入库；页面重新连上服务器时把离线期间攒下的布阵补传上去。

## 0. 它由两半组成

| 一半 | 在哪 | 什么时候生效 |
|---|---|---|
| 页面探测 + 离线对局 | `public/js/offline/`（`index.js` 入口） | 每次启动，`HEAD /healthz` 探一次 |
| 布阵补传 | `public/js/offline/lineupSync.js` + `POST /api/offline-lineup` | 页面重新 `online` 时 |

`offline-solo` 插件（`plugins/offline-solo/`）是同一批客户端文件的**可管理副本**：它让 mod 管理器能看见 / 固定 / 分发包，但离线能力**不依赖它被启用**——默认配置里没有任何插件时，独立模拟照样成立（否则「没有服务器」的场景根本进不去 mod 管理器）。

## 1. 怎么判断「背后有没有服务器」

`decideOffline(search, probe)`（`public/js/offline/index.js`）：

| 输入 | 结论 |
|---|---|
| `?host=0` | 强制离线 |
| `?server=1` | 强制联机（探测都不做） |
| `?host=<别的>` | 离线（页面明确指了一个不存在的主机名） |
| 无参数 | `HEAD /healthz` 成功 → 联机；404 / 网络错误 → 离线 |

有服务器时这一步与 build guard 的探测同价（一次 HEAD），其余行为与今天完全一致。

## 2. 离线局跑的是**真引擎**，不是另写一份

- `public/js/net.js` **一行未改**：它本来就有 `const WS = this.WS || globalThis.WebSocket` 这个注入点（`net.js:222`），离线时换成页内 loopback WebSocket（`localSocket.js`）。
- `public/js/offline/localLobby.js` 是一个薄大厅：应答 `hello` / `ping` / `room.create` / `room.ready` / `room.start` / `room.loadout`…，其余 `g.*` / `b.*` 原样转给 **`server/match/Match.js`**。对局逻辑、经济、AI、结算与联机局是同一份代码。
- 引擎模块由服务器在 `/match/` 挂出（`server/http/static.js`），只发 `.js`，`/match/host/`（`child_process` / `worker_threads`）永远 404。
- 引擎从 `../data.js` 导入的 `getData` / `getConfig` / `getMode` 由 `/data.js` 垫片提供（`DATA_SHIM_JS`），数据由页面 `data.loadAll(ENGINE_FILES)` 注入 `sim/simdata.js`。

`Match` 的 import 闭包 141 个文件，只有 `server/sim/nodeData.js`（已由 `IS_NODE` + 动态 import 挡住）和 `server/data.js`（被垫片替代）碰 Node 内置模块——这是「页面能直接跑引擎」的前提。

## 3. 静态托管（CDN 直下发）

```bash
node tools/pages-build.mjs --base /<repo> --out _site
```

- 复制 `public/`（去掉 `assets` / `local-assets.json`）、`shared/`、`data/`（去掉 `local-*`）、`server/sim/*.js`（跳过 `nodeData.js`）、`server/match/*.js`（跳过 `host/`），并写入权威的 `/data.js` 垫片；
- 把根绝对引用（`"/css/…"`、`from '/shared/…'`、CSS `url(/fonts/…)`、importmap）改写到 base 路径，并把过深的相对 import 减一层 `..`；
- **构建期自检**：任何仍会逃出站点的 import 直接 fail，而不是留到第一次打开页面。

`public/assets`（官方美术，不随仓库分发）缺失时按服务器无本地素材的老规则回落；`public/vendor` 来自 `npm ci`，需要单独拷进产物。

## 4. 布阵数据：离线只攒，联网才传

两条链要分清（服务端本来就有两条，不是本次新增）：

| 链 | 端点 / 落点 | 是否落盘 |
|---|---|---|
| 评分上报 | `POST /api/lineup-score` | 不落盘（聚合侧即时裁决） |
| 学习库 | `flushMatchLineups` → `<SP_LINEUP_LIBRARY>/lineups_<mode>__<DIFF>.jsonl` | 落盘 |

离线局走第二条链的**页面版**：

1. `localLobby.js` 在 `PREP → COMBAT|UNITE` 边沿暂存本回合布阵（`cells.length >= 2`，与服务端同判据）；
2. 只有 `m.result.reason ∈ {victory, defeat}` 才入队（`USABLE_REASONS`，与 `lineupLibrary.js:62` 同源）；
3. 队列在 `localStorage`（`sp.offline.lineups.v1`，最多 200 条，按 `sig+modeId+difficulty+round` 去重）；
4. 页面重新 `online` 时 `lineupSync.js` 分批（20 条）POST `/api/offline-lineup`；
5. 服务端 `acceptOfflineLineups()` **再用同一套门控**（`validCells` / `isFarm` / 模式白名单）复核后才 `appendLine` 落盘，记录带 `source: 'offline'`。

`POST /api/offline-lineup` **永远 200**（fail-open，与评分端点同一信任模型）：每 IP 每分钟 10 次、请求体 256 KB、单批 40 条；收不下就丢掉并在响应里说明原因，绝不让补传失败影响页面。未配置 `SP_LINEUP_LIBRARY` 时 `accepted: 0`。

## 5. v1 边界（明确不做）

- 没有断线续玩 / 快照恢复（参考实现用 IndexedDB 存整局快照，这里不做）；
- 没有观战、房间列表、房间设置（`room.join/spectate/list/addBot/kick/setPlugins/setMode/setMaxSeats/setSeatCap` 全部显式拒绝并回错误码）；
- 没有多人 / WebRTC / 联机穿透，只有 1 座位；
- 离线时不启动 build guard（没有部署可对账），也不再轮询 `/healthz`；
- 本地固定玩家 `playerId: 'local'`，不参与任何跨设备的身份协商。

## 6. 参考

架构上参考了 `himobrine/Stronghold-Protocol-pure-web`（分支 `m1-transport`，GitHub Pages 部署）。它把**整个 Lobby 搬进浏览器**（netCore / dataGetters / dataNode / rand 四路拆分 + esbuild 打包）；这里走的是更薄的一条：不动 `lobby.js`、不打包，只在页面里放一个薄大厅 + loopback 传输，直接驱动**未改动的** `server/match/Match.js`。没有引入该仓库的任何代码或素材。
