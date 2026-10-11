# 卫戍协议：盟约 · 游戏服部署指南（ModelScope 创空间 · 从零开始）

> 非官方同人作品，仅供学习交流。素材版权归 Hypergryph / Yostar 所有。

这份文档带你在 **ModelScope 创空间（Docker 容器）** 上，从「还没有任何仓库」部署一个可联机的
卫戍协议游戏服。仓库里已经**内置了默认配置**（见 `deploy/stardust/ms-edge/` 与根 `Dockerfile`），
复制即用，不用自己猜参数。

执行顺序：**第 1 步创建仓库 → 第 2 步放默认配置 → 第 3 步配创空间 → 第 4 步推送部署 → 第 5 步验证。**

---

## 0. 你需要准备什么（信息清单）

下表是部署前必须确认的东西。带 ⚠️ 的是平台硬约束，改不了。

| 项 | 必需 | 说明 |
|---|---|---|
| ModelScope 账号 | ✅ | 当前使用 `jingjiangze`。没有就先注册。 |
| ModelScope Access Token | ✅ | 形如 `ms-xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`。创空间用它做 git 远程鉴权与重新部署。**不要用主密码**。 |
| 游戏服务端代码 | ✅ | 上游 `sganggs/Stronghold-Protocol` 的 fork，或本仓库（本仓库 `Dockerfile` 假定 `server/ public/ data/ tools/` 在同目录，详见第 2 步）。 |
| 素材 CDN 源 | ⚠️ 默认已给 | 容器不存素材字节，只做 302。默认两个源：`modelscope`（数据集镜像，公开）与 `r2`（`weishucdn.jiangjiangze.icu`）。默认 `sources.json` 已写好，见第 8 步。 |
| 创空间基础镜像 | ⚠️ | `node:22-alpine`。本项目是 Node 应用，**不需要** torch 镜像（`ubuntu22.04-py312-torch2.10.0-…` 也能跑但浪费）。 |
| 硬件规格 | ⚠️ | `platform/2v-cpu-8g-mem`（免费 CPU，2 vCPU / 8 GB）。 |
| 对外端口 | ⚠️ | **7860，硬锁**（`deploy_schema.json` 的 `port.const = 7860`；8080 已被平台进程占用，不能改）。 |
| 对外域名 | ⚠️ | 平台分配 `https://jingjiangze-stronghold-protocol.ms.show/`，不能自定义。要自有域名需走 Cloudflare Worker 代理（见第 10 步）。 |
| 实例数 | 建议 | 1（免费档默认）。 |

> 端口、镜像、硬件都改不了——它们是 ModelScope 创空间的平台约束，不是本项目的选择。

---

## 1. 架构总览（先看这个，下面每一步都对应它）

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

本仓库已经把边缘层的 5 个默认文件放在 `deploy/stardust/ms-edge/`，**逐字可用**：

| 文件 | 作用 |
|---|---|
| `sources.json` | 源表与例外表（**唯一的真源**，运行时读取） |
| `edge-sidecar.mjs` | 决策：路径校验、选源、302、CORS、方法限制 |
| `nginx.conf` | 分流 + 后端故障兜底（**不含任何 Lua**） |
| `render-nginx.mjs` | 构建期从 `sources.json` 渲染 `sources-nginx.conf`（定兜底基址） |
| `entrypoint.sh` | 三个进程的启动顺序与监督 |

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
git add deploy/stardust/ms-edge Dockerfile
git -c commit.gpgsign=false commit -m "deploy: 内置边缘层默认配置（ms-edge）"

# 3) 推到创空间的 git 远程（分支名看创空间默认分支，通常是 master）
git push ms HEAD:master
```

> ⚠️ **推送 ≠ 部署。** ModelScope 创空间不会因为你 push 了就自动重build。推送后还要在控制台点
> 「**重新部署**」（Settings → 重新部署），或调用创空间 API 触发。API 在 Running 状态下会拒绝
> start，必须走「重新部署」。

---

## 6. 第五步：验证

```sh
# 1) 健康检查（探的是对外口 7860，由 nginx 代理到游戏）
curl -fsS https://jingjiangze-stronghold-protocol.ms.show/healthz

# 2) 素材请求应拿到 302 到某个源（字节不经过容器）
curl -fsS -o /dev/null -w '%{http_code} -> %{redirect_url}\n' \
  https://jingjiangze-stronghold-protocol.ms.show/assets/char/avatar/char_1016_agoat2.png

# 3) WebSocket（客户端联机用）
wss://jingjiangze-stronghold-protocol.ms.show/ws
```

预期：healthz 返回 200；素材请求返回 `302` 且 `Location` 指向 `sources.json` 里的某个 `base`；
WebSocket 能握手。

---

## 7. 客户端怎么连

- 页面与 WebSocket 都走 `https://jingjiangze-stronghold-protocol.ms.show/`（WSS 同域）。
- 外部嵌入：用 `iframe` + `referrerpolicy="no-referrer"`，或直接走 Cloudflare Worker 代理（见第 10 步）。
- 不能直接绑自有域名：平台 WAF 对未知 `Host` 返回 410，对带非 ModelScope `Referer` 的请求 302。

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
      "base": "https://weishucdn.jiangjiangze.icu",
      "note": "现有主源（R2 私有桶 + 自有域）。兜底 + exceptions 目标。"
    }
  ],
  "exceptions": {
    "/assets/skins/char_340_shwaz_snow_1/illustration.png": "r2"
  }
}
```

- `order` 是**静态顺序**，不是实时测速：容器在 ModelScope 机房，量不出玩家那边的链路。真正按玩家网络
  选最快是**客户端** `pick.js` 的事，两者分工。
- 客户端可用 `?sp_source=<id>` 覆盖顺序（`id` 取自 `sources[].id`）；未知 id 被拒。
- `exceptions`：数据集不是逐字节完整（平台内容审核会拒收个别文件，实测拒了上面的
  `char_340_shwaz_snow_1/illustration.png`），这些路径必须点名改道到 `r2`，否则玩家 404。
  **新增镜像后要核对覆盖率。**

### 8.2 Dockerfile 环境变量

```dockerfile
ENV NODE_ENV=production \
    SP_PUBLIC_PORT=7860 \
    SP_GAME_PORT=3120 \
    SP_EDGE_PORT=3130 \
    PORT=3120 \
    HOST=127.0.0.1
```

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
| 构建失败，日志报 `nginx -t` 错 | `sources.json` 渲染不出 `sources-nginx.conf`，或 `nginx.conf` 有语法错。本地先 `node deploy/stardust/ms-edge/render-nginx.mjs /tmp/t.conf && nginx -t -c deploy/stardust/ms-edge/nginx.conf` 复现。 |
| 容器起不来、restart 循环 | 旧镜像继续服务是预期保护；看构建日志，别急着强推。 |
| 素材 404 | 命中了 `exceptions` 没覆盖的被审核拒收的路径，或 `order` 里的源挂了。查 `sources.json` 覆盖率。 |
| 玩家连不上自有域名 | 平台 WAF 拦了：用 Cloudflare Worker 代理，或直接用 `*.ms.show` 域名 + `iframe no-referrer`。 |
| push 成功但没生效 | 忘了点「重新部署」。push ≠ 部署。 |
| 本地 `git commit` 报 `Couldn't get agent socket?` | 本机 SSH 签字 agent 没起。用 `git -c commit.gpgsign=false commit …`（CI 里脚本已这么设）。 |

---

## 10. 安全与发布边界

- **素材字节不经过容器**：`/assets/**`、`/fonts/**` 只返回 302，容器零带宽成本。
- **域名为平台分配**：不能自定义；自有域名必须走 Cloudflare Worker 代理（本工作区 `arknights-gateway`
  类的做法），不能直连 IP（WAF 对未知 Host 回 410）。
- **零冲突叠加层**：默认配置直接放进你的服务端代码，不改上游文件；上游同步时叠加层不冲突。
- **别把 Access Token 当密码用**：只在 git remote URL 与「重新部署」API 里用 `ms-...` token。
- **发布需授权**：重新部署、改线上、推远程都是向外操作，按本工作区规则需你确认后才做。

---

## 11. 相关文档

- 素材 CDN 文档站（部署文档、镜像、客户端接入）：<https://downcdn.jiangjiangze.icu/>
- 上游仓库：<https://github.com/sganggs/Stronghold-Protocol>
- CDN 仓库：<https://github.com/jingjiangze/Stronghold-Protocol-CDN>
