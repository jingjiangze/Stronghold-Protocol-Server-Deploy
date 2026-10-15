# 卫戍协议：盟约 · 游戏服部署指南（ModelScope 创空间 · 从零开始）

> 非官方同人作品，仅供学习交流。素材版权归 Hypergryph / Yostar 所有。

这份文档带你在 **ModelScope 创空间（Docker 容器）** 上，从「还没有任何仓库」部署一个可联机的
卫戍协议游戏服。仓库里已经**内置了默认配置**（见 `deploy/stardust/ms-edge/` 与根 `Dockerfile`），
复制即用，不用自己猜参数。

执行顺序：**第 1 步创建仓库 → 第 2 步放默认配置 → 第 3 步配创空间 → 第 4 步推送部署 → 第 5 步验证。**

> **还有一条更简单的路（第 5½ 步「零域名 · 零叠加层方案」）：** 素材默认 CDN 是
> `https://speedcdn.jiangjiangze.icu/`（同桶别名 `weishucdn.jiangjiangze.icu` 仍在服务，字节逐字一致），
> 素材字节不过容器——你可以**不装边缘层、也不绑自有域名**，容器里只跑游戏、直接监听 7860，
> 用平台 `*.ms.show` 域名。
> ⚠️ 但**前提是清单里的相对路径有人替你 302 出去**。线上 `*.ms.show` 那份 `/data/assets.json` 实测
> **全是相对路径**（2026-10-15：1.3 MB 清单，0 条绝对 CDN 地址），它能跑是因为**跳转层在跑**（素材请求回
> `302`，响应头带 `X-SP-Edge: order`）。这个头**分不清**是边缘 sidecar 还是游戏进程内 `asset-jump.js` 打的
> ——两者 `import` 同一份 `decide()`（`server/http/asset-jump.js:15`），规则不会分叉。两条走法分开讲：
> fork 有进程内 jump ⇒ 镜像里只带一张 `sources.json` 就够；上游官方包没有 ⇒ 得换成 CDN 那份绝对清单，
> 或退回边缘层。见第 5½ 步。
> 默认的边缘层（nginx + sidecar 302）是**可选**的；要做边缘注入 / 多源实时兜底时才需要。下面两路都会写。

---

## 0. 你需要准备什么（信息清单）

下表是部署前必须确认的东西。带 ⚠️ 的是平台硬约束，改不了。

| 项 | 必需 | 说明 |
|---|---|---|
| ModelScope 账号 | ✅ | 当前使用 `jingjiangze`。没有就先注册。 |
| ModelScope Access Token | ✅ | 形如 `ms-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。创空间用它做 git 远程鉴权与重新部署。**不要用主密码**。 |
| 游戏服务端代码 | ✅ | 上游 `sganggs/Stronghold-Protocol` 的 fork，或本仓库（本仓库 `Dockerfile` 假定 `server/ public/ data/ tools/` 在同目录，详见第 2 步）。 |
| 素材 CDN 源 | ⚠️ 默认已给 | 默认 CDN 基址 `https://speedcdn.jiangjiangze.icu/`（同桶别名 `weishucdn.jiangjiangze.icu`，实测逐字节一致）。零叠加层有两条走法：**A** 镜像里只带一张 `sources.json`，缺失素材由游戏进程自己 302（需 fork 的 `server/http/asset-jump.js`）；**B** 换成 CDN 那份**绝对地址清单** `https://speedcdn.jiangjiangze.icu/data/assets.json`（实测 1.9 MB / 11,637 条绝对 URL / `200 application/json`）。⚠️ 上游 `tools/fetch-assets.mjs` 生成的 `data/assets.json` 是**相对路径**，单独用会 404。边缘层另给 `modelscope` 数据集镜像作 302 首跳源（见第 5½、8 步）。 |
| 创空间基础镜像 | ⚠️ | `node:22-alpine`。本项目是 Node 应用，**不需要** torch 镜像（`ubuntu22.04-py312-torch2.10.0-…` 也能跑但浪费）。 |
| 硬件规格 | ⚠️ | `platform/2v-cpu-8g-mem`（免费 CPU，2 vCPU / 8 GB）。 |
| 对外端口 | ⚠️ | **7860，硬锁**（`deploy_schema.json` 的 `port.const = 7860`；8080 已被平台进程占用，不能改）。 |
| 对外域名 | ⚠️ | 平台分配 `https://jingjiangze-stronghold-protocol.ms.show/`，不能自定义。**最简方案直接用这个域名**即可（不绑自有域名），要塞进自有站点用 `iframe referrerpolicy="no-referrer"`（见第 5½ 步）。 |
| 实例数 | 建议 | 1（免费档默认）。 |

> 端口、镜像、硬件都改不了——它们是 ModelScope 创空间的平台约束，不是本项目的选择。

---

## 1. 架构总览（先看这个，下面每一步都对应它）

> 下面是**边缘层（默认）**的拓扑。若走**零叠加层方案**（第 5½ 步），则没有 nginx 也没有 sidecar，
> 游戏进程直接监听 7860 对外口，容器里只剩一个进程：素材要么由**进程内 jump** 302 出去（走法 A，
> 只需带一张 `sources.json`），要么由**绝对地址清单**让浏览器直连 CDN（走法 B）。

三个进程共用一个对外端口 `7860`，按路径分流：

```
                    ┌─ /assets/** /fonts/** ─► edge-sidecar :3130 ──302──► 素材源（字节不过容器）
玩家 ──:7860──► nginx┤                                              ↑ 只有 Location，没有字节
                    └─ 其余（页面/data/js/vendor/media/ws/healthz）─► 游戏 :3120
```

- **nginx** 占对外口 `7860`，把素材路径代理给 sidecar，其余代理给游戏。
- **edge-sidecar**（`127.0.0.1:3130`，纯 Node）只回答「这个请求 302 去哪个源」，不代理一个字节。
- **游戏**（`127.0.0.1:3120`）就是 `server/index.js`，页面、WebSocket、数据都在它这。
- **素材字节从不经过这个容器**：`/assets/**`、`/fonts/**` 只拿到一个 302，浏览器自己去 CDN 取。

为什么这么分：创空间只给一个公网口（7860），所以 nginx 占住它，另外两个退到内部端口。这是与
Stardust 的 compose 同构的设计（游戏 3120 / 素材解析器 3130 / 一个 nginx 在前面）。

> **零叠加层拓扑（第 5½ 步）：** 只有一个游戏进程监听 `7860`。走法 B 下清单里的素材地址已是绝对
> `https://speedcdn.jiangjiangze.icu/…`（CDN 上那份 `/data/assets.json`，不是上游 `tools/fetch-assets.mjs`
> 生成的相对清单），玩家浏览器直接取字节；走法 A 下清单保持相对路径，缺的文件由游戏进程回 `302`。
> 两种都没有 nginx 分流，也没有独立的 sidecar 进程，部署面更小、出问题的点更少。

---

## 2. 第一步：创建 ModelScope 创空间仓库

1. 打开 [ModelScope 创空间控制台](https://modelscope.cn/my/studios)，点「创建创空间」。
2. 仓库名填 `Stronghold-Protocol`，命名空间保持你的账号（`jingjiangze`）。
3. **基础镜像**选 `node:22-alpine`（Custom / 社区镜像里搜 `node:22-alpine`）。
4. **硬件**选 `platform/2v-cpu-8g-mem`（免费 CPU）。
5. 先别点「部署/启动」——代码还没推上去。
6. 进入创空间「设置」，找到 **Git 仓库地址**（形如
   `https://oauth2:<你的Token>@www.modelscope.cn/studios/jingjiangze/Stronghold-Protocol.git`），
   里面已经把 Access Token 嵌进去了。把它记下来，第 4 步当 git remote 用。

> 控制台上的「基础镜像 / 硬件 / 端口」就是第 0 步那几个 ⚠️ 硬约束。端口在 `deploy_schema.json`
> 里锁成 7860，控制台看不到输入框，但构建失败的日志会提示，记住它就行。

---

## 3. 第二步：把默认配置放进你的服务端代码

> **边缘层是可选的。** 下面这套（nginx + sidecar 302）适合要边缘注入 / 多源实时兜底、或私有服既没有
> 进程内 jump 也拿不到绝对地址清单的场景。若走**零叠加层方案**（第 5½ 步）：走法 **B** 一个文件都不用复制，
> 走法 **A** 只复制 `sources.json` **这一个**文件（游戏进程自己按它 302），都不需要 nginx 与 sidecar。

本仓库已经把边缘层的 5 个默认文件放在 `deploy/stardust/ms-edge/`，**逐字可用**：

| 文件 | 作用 |
|---|---|
| `sources.json` | 源表 + 例外表 + **前缀规避表**（**唯一的真源**，运行时读取） |
| `edge-sidecar.mjs` | 决策：路径校验、扩展名闸门、前缀规避、选源、302、CORS、方法限制 |
| `nginx.conf` | 分流 + 后端故障兜底（**不含任何 Lua**） |
| `render-nginx.mjs` | 构建期从 `sources.json` 渲染 `sources-nginx.conf`（定兜底基址） |
| `entrypoint.sh` | 三个进程的启动顺序与监督 |

> `edge-sidecar.mjs` 与 `sources.json` 2026-10-15 已对齐到游戏服务端 fork 里那份**同一套实现**
> （`stronghold-server/deploy/stardust/ms-edge/`，含 `prefixRules` 与 `/assets/local/**`、`/fonts/fonts.css`
> 的扩展名例外）。两边必须一起复制——只换 `sources.json` 的话，旧 sidecar 会**静默忽略** `prefixRules`，
> 玩家第一次请求仍会被 302 到供不了该目录的源上拿到 404。

把这 5 个文件整目录复制到你的游戏服务端代码里，保持路径 `deploy/stardust/ms-edge/` 不变——
根 `Dockerfile` 里的 `COPY` 就是按这个路径取的：

```sh
# 假设你的服务端代码在 ~/stronghold-server
cp -r deploy/stardust/ms-edge ~/stronghold-server/deploy/stardust/ms-edge
cp Dockerfile ~/stronghold-server/Dockerfile   # 或把下面第 8 步的 ENV 块并到你自己的 Dockerfile
```

Dockerfile 的关键环境变量（写死 7860 / 3120 / 3130，照 Stardust compose）：

```dockerfile
ENV NODE_ENV=production \
    SP_PUBLIC_PORT=7860 \
    SP_GAME_PORT=3120 \
    SP_EDGE_PORT=3130 \
    PORT=3120 \
    HOST=127.0.0.1
```

构建期有两道闸门：`render-nginx.mjs` 先渲染 `sources-nginx.conf`，再 `nginx -t`；坏了就让构建失败，
旧镜像继续服务，而不是产出一个起不来的容器。

---

## 4. 第三步：配置创空间（镜像 / 硬件 / 端口）

已经在第 2 步的创建流程里定好了，这里再核对一遍：

- 基础镜像 = `node:22-alpine`
- 硬件 = `platform/2v-cpu-8g-mem`
- 端口 = `7860`（不需填，平台锁死）
- 实例数 = `1`
- 启动命令留空（容器 `CMD` 已经是 `entrypoint.sh`）

---

## 5. 第四步：推送并部署

请把 `MS_TOKEN` 换成第 2 步拿到的 Access Token。

```sh
cd ~/stronghold-server

# 1) 加 ModelScope git 远程（oauth2 把 token 嵌进 URL，无需 ssh key）
git remote add ms "https://oauth2:${MS_TOKEN}@www.modelscope.cn/studios/jingjiangze/Stronghold-Protocol.git"

# 2) 提交默认配置（本机若开了 SSH 签字，构建/提交用一次性覆盖，避免 agent 缺失导致失败）
#    边缘层：加 ms-edge + Dockerfile；零叠加层（见第 5½ 步）：只加 Dockerfile
git add deploy/stardust/ms-edge Dockerfile
git -c commit.gpgsign=false commit -m "deploy: 内置边缘层默认配置（ms-edge）"
# git add Dockerfile && git -c commit.gpgsign=false commit -m "deploy: 零叠加层游戏服"

# 3) 推到创空间的 git 远程（分支名看创空间默认分支，通常是 master）
git push ms HEAD:master
```

> ⚠️ **推送 ≠ 部署。** ModelScope 创空间不会因为你 push 了就自动重build。推送后还要在控制台点
> 「**重新部署**」（Settings → 重新部署），或调用创空间 API 触发。API 在 Running 状态下会拒绝
> start，必须走「重新部署」。

---

## 6. 第五步：验证

```sh
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'

# 1) 健康检查（探的是对外口 7860，由 nginx 代理到游戏）
curl -fsS -A "$UA" https://jingjiangze-stronghold-protocol.ms.show/healthz

# 2) 素材请求应拿到 302 到某个源（字节不经过容器）
curl -fsS -A "$UA" -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  https://jingjiangze-stronghold-protocol.ms.show/assets/char/avatar/char_1016_agoat2.png

# 3) WebSocket（客户端联机用）
wss://jingjiangze-stronghold-protocol.ms.show/ws
```

预期：healthz 返回 200；素材请求返回 `302` 且 `Location` 指向 `sources.json` 里的某个 `base`
（响应头带 `X-SP-Edge: order`——边缘 sidecar 或游戏进程内 jump 都可能打这个头，它们用的是同一份
`decide()`）；WebSocket 能握手。

上面第 2 条探的是 `/assets/char/…`，**按本仓库默认源表它会直奔 `speedcdn` 而不是魔搭**——那是
`prefixRules` 的功劳（魔搭对 `assets/char/` 实测只覆盖 21%，第一次请求就不该去试错，见 8.1）。
2026-10-15 线上那台还跑着没有 `prefixRules` 的旧表，所以同一条命令线上量到的是魔搭。

> ⚠️ **必须带浏览器 UA**：平台 WAF 对裸 `curl`（无 `-A`）在 `*.ms.show` 上一律回 **403**，
> `/healthz` 也一样——实测 2026-10-15。看到 403 不是你的容器挂了，是没带 UA。

> **零叠加层方案的验收不同**：没有 nginx，直连游戏 7860。走法 **A**（fork 有进程内 jump）与上面第 2 条
> 一样看 `302`；走法 **B**（绝对清单）不靠 `302`，改成核对清单里的绝对地址：
> `curl -fsS https://speedcdn.jiangjiangze.icu/data/assets.json | grep -c "https://"`（应 > 0），
> 再用 `curl -o /dev/null -w '%{content_type}'` 直接打一条素材 URL 应回 `image/png`。
> 你自己镜像里那份 `data/assets.json` 若是相对路径（上游 `tools/fetch-assets.mjs` 生成的就是相对的），
> 就必须走 A 或退回边缘层，见第 5½ 步。

---

## 5½. 零域名 · 零叠加层方案（最简）

这条是给「只想让游戏服跑起来、不折腾代理」的人。它**不申请自有域名、不套 Cloudflare Worker、也不装
nginx + sidecar**，直接用平台分配的 `*.ms.show` 域名，容器里只跑游戏进程。**注意：不是「不绑 CDN」，
而是不绑自有域名**——素材依旧从 CDN 取，只是前面不再叠一层代理。

这里有两条走法，按你的服务端代码选：

| 你的服务端代码 | 走法 | 依据 |
|---|---|---|
| **本项目 fork**（`server/http/asset-jump.js` 在） | **A · 只带一张源表**：镜像里放 `deploy/stardust/ms-edge/sources.json` 这一个文件，缺失的 `/assets/**`、`/fonts/**` 由**游戏进程自己** 302 到源，清单保持相对路径即可 | `server/index.js:116` 无条件 `createAssetJump({ log })`；源表默认路径 `deploy/stardust/ms-edge/sources.json`，可用 `SP_EDGE_SOURCES` 指到别处，`SP_ASSET_JUMP=0` 才关 |
| **上游官方包**（`server/http/` 里没有 `asset-jump.js` / `asset-cdn.js`） | **B · 绝对清单**：用 CDN 上那份已经带绝对地址的 `data/assets.json` 覆盖你镜像里的同名文件，浏览器直连 CDN，容器完全不碰素材 | 实测 2026-10-15：`https://speedcdn.jiangjiangze.icu/data/assets.json` 回 `200 application/json`、1.9 MB、11,637 条绝对 URL |

> ⚠️ **别照抄线上那台的清单**：2026-10-15 实测 `*.ms.show` 的 `/data/assets.json`（1.3 MB，hash
> `2424fdc0a6b5`）里 **0 条绝对 CDN 地址**，全是 `/assets/…` 相对路径；它素材能出，是因为**跳转层在跑**
> （请求回 `302`，响应头带 `X-SP-Edge: order`）。也就是说线上 = 相对清单 + 跳转层，而不是「清单已经写死
> 绝对地址」。相对清单 + 没有任何跳转层 = 素材请求打到容器自己，镜像里没素材就 404。

**为什么可行**

- **素材不过容器**：走法 A 由进程回一个 `302`（只有 `Location`，没有字节）；走法 B 连 `302` 都不需要，
  浏览器读到的就是完整 CDN URL。两种都不用在容器里存 581 MB 素材树。
- **`*.ms.show` 域名能直接进游戏**：平台 WAF 对浏览器 UA 放行 7860；但要塞进自有站点必须用
  `<iframe referrerpolicy="no-referrer">`（直链会 302 到门户）。自定义 SNI / 自有域名在 WAF 层是默认证书，
  接不通——所以本方案干脆不绑。

**部署步骤**

1. **准备一个只跑游戏的容器**：服务端代码（`server/ public/ data/ tools/`）+ 下面这个极简 `Dockerfile`。
   走法 A **只**复制 `sources.json` 一个文件；走法 B 一个都不用复制。
2. **极简 Dockerfile**（游戏直接监听 7860，不再经 nginx 分流）：

   ```dockerfile
   FROM node:22-alpine
   WORKDIR /app
   COPY package*.json ./
   RUN npm ci --omit=dev
   COPY server public data tools ./
   # 走法 A 加这一行（只有 sources.json 这一个文件需要进镜像）：
   # COPY deploy/stardust/ms-edge/sources.json deploy/stardust/ms-edge/sources.json
   ENV NODE_ENV=production \
       PORT=7860 HOST=0.0.0.0
   EXPOSE 7860
   CMD ["node", "server/index.js"]
   ```

3. **上线前核对素材地址**（这一步决定 A/B 哪条成立）：

   ```sh
   # 绝对地址清单的条数：>0 = 走法 B 已成立；= 0 = 相对清单，必须走 A 或边缘层
   curl -fsS https://speedcdn.jiangjiangze.icu/data/assets.json | grep -c "https://"
   # 你镜像里那份的形态（本地看，不用等部署）
   grep -c "https://" data/assets.json
   # 跳转层在不在（走法 A）
   ls server/http/asset-jump.js
   ```

   要走法 B 又想统一到 speedcdn 门牌：CDN 那份绝对清单目前写的是同桶别名 `weishucdn`（逐字节同桶），
   `sed -i 's|https://weishucdn\.jiangjiangze\.icu|https://speedcdn.jiangjiangze.icu|g' data/assets.json`
   之后 **必须** `node -e "JSON.parse(require('fs').readFileSync('data/assets.json','utf8'))"` 复验一次，
   清单被改坏是整站白屏级别的事故。

4. **推送并点「重新部署」**：同第 5 步的 push 命令（走法 A 是 `git add Dockerfile deploy`，走法 B 只
   `git add Dockerfile data`），push 后在控制台点「重新部署」。

5. **把游戏塞进你的站点（不绑域名的关键）**：在自己的页面里用如下 iframe 内嵌，**必须带
   `referrerpolicy="no-referrer"`**，否则 WAF 把直链 302 到 ModelScope 门户：

   ```html
   <iframe
     src="https://jingjiangze-stronghold-protocol.ms.show/"
     referrerpolicy="no-referrer"
     allow="autoplay; fullscreen"
     style="width:100%;height:80vh;border:0"></iframe>
   ```

**验收**（走法 A 与边缘层一样看 302；走法 B 看清单里的绝对地址能不能直接取到字节）：

```sh
curl -fsS -A "$UA" -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  https://jingjiangze-stronghold-protocol.ms.show/assets/char/avatar/char_1016_agoat2.png   # A：302
curl -fsS -o /dev/null -w '%{http_code} %{content_type} %{size_download}\n' \
  https://speedcdn.jiangjiangze.icu/assets/char/avatar/char_1016_agoat2.png                  # B：200 image/png
```

**取舍**：零叠加层省掉了 nginx + sidecar 两个进程，部署面更小、出问题的点更少；代价是你拿不到边缘注入，
而且**多源兜底只剩一张表**——走法 A 的进程内 jump 与边缘 sidecar 读同一份 `sources.json`、同一组纯函数，
所以 `prefixRules` / `exceptions` 那套规则照样生效；走法 B 则是把选择权交给了清单，换源要重发清单。

---

## 7. 客户端怎么连

- **最简（零叠加层）**：直接用平台域名 `https://jingjiangze-stronghold-protocol.ms.show/`（页面 / WebSocket 都走它，WSS 同域）。要塞进自有站点，用 `iframe referrerpolicy="no-referrer"`（见第 5½ 步）。
- **边缘层 / 自有域名**：走 Cloudflare Worker 代理（本工作区 `arknights-gateway` 类做法，见第 10 步）。
- 不能直接绑自有域名裸连：平台 WAF 对未知 `Host` 返回 410，对带非 ModelScope `Referer` 的请求 302——所以零叠加层干脆用 `*.ms.show` 域名 + iframe no-referrer。

---

## 8. 默认配置说明（随仓库附上，复制即用）

### 8.1 `sources.json`（默认）

```json
{
  "schemaVersion": 1,
  "order": ["modelscope", "r2"],
  "sources": [
    {
      "id": "modelscope",
      "base": "https://modelscope.cn/datasets/jingjiangze/Stronghold-Protocol-Assets/resolve/master/releases/v1-trial",
      "note": "自建数据集镜像（公开）。15,979 assets + 7 fonts，逐字节校验过。"
    },
    {
      "id": "r2",
      "base": "https://speedcdn.jiangjiangze.icu",
      "note": "R2 私有桶的规范门牌（2026-10-15 起默认用 speedcdn；同桶别名 weishucdn.jiangjiangze.icu 逐字节一致）。兜底 + exceptions 目标。"
    }
  ],
  "exceptions": {
    "/assets/skins/char_340_shwaz_snow_1/illustration.png": "r2"
  },
  "prefixRules": [
    { "prefix": "/assets/voice/", "skip": ["modelscope"], "reason": "实测 0/15，整目录无" },
    { "prefix": "/assets/char/", "skip": ["modelscope"], "reason": "实测覆盖 21%" },
    { "prefix": "/assets/ui/", "skip": ["modelscope"], "reason": "实测覆盖 20%" },
    { "prefix": "/assets/spine/", "skip": ["modelscope"], "reason": "实测覆盖 45%" },
    { "prefix": "/assets/local/", "skip": ["modelscope"], "reason": "实测覆盖 36%" },
    { "prefix": "/assets/band/", "skip": ["modelscope"], "reason": "实测 0/1" },
    { "prefix": "/assets/prof/", "skip": ["modelscope"], "reason": "实测 0/1" },
    { "prefix": "/assets/art-index.json", "skip": ["modelscope"], "reason": "实测 404" }
  ]
}
```

- `order` 是**静态顺序**，不是实时测速：容器在 ModelScope 机房，量不出玩家那边的链路。真正按玩家网络
  选最快是**客户端** `pick.js` 的事，两者分工。
- 客户端可用 `?sp_source=<id>` 覆盖顺序（`id` 取自 `sources[].id`）；未知 id 被拒。
- `exceptions`：数据集不是逐字节完整（平台内容审核会拒收个别文件，实测拒了上面的
  `char_340_shwaz_snow_1/illustration.png`），这些路径必须点名改道到 `r2`，否则玩家 404。
  **新增镜像后要核对覆盖率。**
- `prefixRules`：同一类问题的**目录级**版本（2026-10-14 实测 150 条样本：魔搭 `voice` 0/15、`char` 21%、
  `ui` 20%、`spine` 45%、`local` 36%、`band`/`prof` 0/1，而 `skins` 100%、`audio` 97%）。语义是
  「这个前缀**不许**用这些源」，与 `exceptions` 的「这条路径**必须**用某个源」相反；它让第一次请求就
  直奔正确的源，不用拿玩家的请求去试错。⚠️ **会过期**——魔搭补齐某目录后这条规则就把流量白白推给 R2
  （R2 按 Class B 次数计费），改表前重跑覆盖率复核。
- **省钱靠的是 `order` 不是域名**：`modelscope` 当首跳把 Class B 操作数转嫁给魔搭，R2 退回 10M 免费额度内
  （2026-10-14 实测：超限 $7.59/月 → $0）。`r2` 的门牌换成同桶的 speedcdn / weishucdn 都不影响账单。

### 8.2 Dockerfile 环境变量

```dockerfile
ENV NODE_ENV=production \
    SP_PUBLIC_PORT=7860 \
    SP_GAME_PORT=3120 \
    SP_EDGE_PORT=3130 \
    PORT=3120 \
    HOST=127.0.0.1
```

#### `SP_ANNOUNCEMENTS_URL`——发公告不用重新部署

大厅公告默认是 `data/announcements.json`，它被 `Dockerfile` 烘焙进镜像，改一条公告要走
「改文件 → 提交 → push → 控制台点重新部署」。设了这个变量之后，公告改由**外部 URL** 提供。

现成的源就是后台站点（**推荐直接用**）：

```dockerfile
ENV SP_ANNOUNCEMENTS_URL=https://arknights.jiangjiangze.icu/api/announcements/game
```

在 <https://arknights.jiangjiangze.icu/admin> 登录后可编辑、发布；发布后本服最多 60 秒自动生效。

- **生效方式**：服务器每 60 秒拉一次源，玩家端最多 60 秒后自动弹出新公告（客户端另有 60 秒轮询与
  内容哈希去重，关过的不会重复打扰）。**发布即可见，不用动服务器、不用重新部署。**
- **内容是 JSON 数组**，与 `data/announcements.json` 同构：`[{ title, date, paragraphs: [...] }]`，
  必须能被 `JSON.parse`，且 `content-type` 得是 JSON（静态源返回 `text/plain` 也可）。
- **源挂了不会出事**：拉不到就回退到镜像里那份 `data/announcements.json`，源恢复后自动切回。
  公告是可选装饰，不参与健康检查。
- **不设这个变量时，行为和以前完全一样**（不拉、不记日志、不新增任何东西）。
- 源需要能被**容器**访问。浏览器不直连源，所以源不需要 CORS 头。

改完变量本身仍需一次重新部署（这是唯一一次），之后发公告就永久免部署了。

### 8.3 创空间规格（不可改）

| 项 | 值 |
|---|---|
| 基础镜像 | `node:22-alpine` |
| 硬件 | `platform/2v-cpu-8g-mem`（2 vCPU / 8 GB，免费 CPU） |
| 对外端口 | `7860`（硬锁） |
| 内部端口 | 游戏 `3120` / sidecar `3130`（都绑 `127.0.0.1`） |
| 实例数 | `1` |
| 对外域名 | `https://jingjiangze-stronghold-protocol.ms.show/` |

---

## 9. 故障排查

| 现象 | 原因 / 处理 |
|---|---|
| 构建失败，日志报 `nginx -t` 错 | **只在边缘层出现**：`sources.json` 渲染不出 `sources-nginx.conf`，或 `nginx.conf` 有语法错。本地先 `node deploy/stardust/ms-edge/render-nginx.mjs /tmp/t.conf && nginx -t -c deploy/stardust/ms-edge/nginx.conf` 复现。零叠加层没有 nginx。 |
| 容器起不来、restart 循环 | 旧镜像继续服务是预期保护；看构建日志，别急着强推。 |
| 素材 404 | 零叠加层：清单是相对路径、而你的服务端没有 `asset-jump.js`（走法 A 不成立，见第 5½ 步），或 CDN 挂了；边缘层：命中了 `prefixRules` / `exceptions` 没覆盖的被审核拒收路径，或 `order` 里的源挂了。查 `sources.json` 覆盖率——`prefixRules` 那 8 条是按 2026-10-14 的魔搭目录覆盖率实测定的，源补全后就该删对应条目。 |
| 直链打开跳到 ModelScope 门户 | WAF 把裸 `*.ms.show` 直链 302 到门户。塞进自有站点必须 `iframe referrerpolicy="no-referrer"`；自定义域名在 WAF 层是默认证书，接不通。 |
| push 成功但没生效 | 忘了点「重新部署」。push ≠ 部署。 |
| 本地 `git commit` 报 `Couldn't get agent socket?` | 本机 SSH 签字 agent 没起。用 `git -c commit.gpgsign=false commit …`（CI 里脚本已这么设）。 |

---

## 10. 安全与发布边界

- **素材字节不经过容器**：`/assets/**`、`/fonts/**` 只返回 302，容器零带宽成本。
- **域名为平台分配**：不能自定义裸连；最简单是用平台 `*.ms.show` 域名 + `iframe referrerpolicy="no-referrer"`
  （见第 5½ 步），自有域名则必须走 Cloudflare Worker 代理（本工作区 `arknights-gateway` 类做法），
  不能直连 IP（WAF 对未知 Host 回 410）。
- **零冲突叠加层**：默认配置直接放进你的服务端代码，不改上游文件；上游同步时叠加层不冲突。
- **别把 Access Token 当密码用**：只在 git remote URL 与「重新部署」API 里用 `ms-...` token。
- **发布需授权**：重新部署、改线上、推远程都是向外操作，按本工作区规则需你确认后才做。

---

## 11. 相关文档

**先把三个门牌分清（2026-10-15 实测）**

| 域名 | 是什么 | 能不能当素材基址 |
|---|---|---|
| `https://speedcdn.jiangjiangze.icu` | R2 私有桶的**默认素材门牌**（本仓库 `sources.json` 的 `r2`） | ✅ `image/png` 200 / Range 206 / `ACAO *` |
| `https://weishucdn.jiangjiangze.icu` | **同一个桶的别名**（历史门牌，CDN 那份绝对清单与 APK 侧仍写它） | ✅ 逐字节一致；额外带 `Access-Control-Expose-Headers` |
| `https://downcdn.jiangjiangze.icu` | **门户 / 文档站**（Pages） | ❌ 任何子路径都回 `200 text/html`，写进清单会把玩家的贴图变成 HTML |

- 素材 CDN 文档站（部署文档、镜像、客户端接入）：<https://downcdn.jiangjiangze.icu/>
- 上游仓库：<https://github.com/sganggs/Stronghold-Protocol>
- CDN 仓库：<https://github.com/jingjiangze/Stronghold-Protocol-CDN>
