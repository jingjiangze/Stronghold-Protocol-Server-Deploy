# 卫戍协议：盟约 · 服务器与部署

非官方同人联机复刻（明日方舟「卫戍协议：盟约」）。本仓库只做一件事：**把同一份 0.3.1 游戏服务端，用两条分支分别交付到普通服务器和 ModelScope 创空间。**

> 游戏代码 GPL-3.0-or-later；美术/音频版权归 Hypergryph / Yostar，仓库不含素材字节，玩家侧从 CDN 取。

## 两个分支（只保留这两个）

| 分支 | 用途 | 入口 | 关键差异 |
|---|---|---|---|
| `server` | 普通服务器 / VPS / 本机 | `node server/index.js`（默认 3000） | 上游 Dockerfile；无边缘层 |
| `ms` | ModelScope 创空间 | `docker-entrypoint.sh`（对外 7860） | nginx(7860) → 游戏(3120) + 素材侧车(3130)；`deploy/stardust/ms-edge/` |

两个分支的游戏代码、`plugins/`、`data/` 完全一致，**只有部署外壳不同**。任何功能改动请同时落到两个分支（或先在 `server` 上验证再同步到 `ms`）。

## 快速开始（普通服务器）

```bash
npm ci
# 可选：准备素材（否则走 CDN 302 / 占位图）
node tools/setup.mjs
SP_PLUGIN_SCRIPTS=trusted-force SP_PLUGIN_AUTOCONSENT=1 node server/index.js
```

健康检查：`GET /healthz`。

Docker：

```bash
docker build -t stronghold-protocol .
docker run -d -p 3000:3000 --restart unless-stopped stronghold-protocol
```

## ModelScope 创空间（`ms` 分支）

把 `ms` 分支推到空间仓库即可自动构建：

```bash
git push <space-remote> ms:master
```

镜像内的进程布局：

```
nginx :7860 ──/assets|fonts──▶ sidecar :3130 ──302──▶ 素材源
             └──其余─────────▶ 游戏    :3120
```

镜像内置的环境（见 `Dockerfile`）：

| 变量 | 值 | 作用 |
|---|---|---|
| `SP_PLUGIN_SCRIPTS` | `trusted-force` | 加载仓库自带的四个受信任插件 |
| `SP_PLUGIN_AUTOCONSENT` | `1` | 房间不再弹「受信任插件」确认条 |
| `SP_MODS` | `off` | **不带** `/mod` 管理页与拖目录即装 |
| `SP_STUDIO` | `off` | **不带** `/studio` 插件工作台 |
| `SP_HTTP_COMPRESS` | `off` | 平台网关会吞 `Content-Encoding`，压缩会变乱码 |

素材源顺序：`deploy/stardust/ms-edge/sources.json` 里 `modelscope → r2`（r2 垫底）。数据集未公开时健康探测会把 modelscope 判 down 并自动顺延到 r2。

## 插件（手动安装）

四个插件随仓库发布，位于 `plugins/`：

- `mota` — 本体（对局引擎 + 界面），`required`，房间关不掉
- `ai-scoring` — AI 布阵评分
- `operator-skins` — 干员皮肤
- `alliance-20` — 20 人分队界面

**本仓库不提供在线安装**：要加/换插件，把目录放进 `plugins/<id>/`、重新生成 `plugin.lock.json` 并把 sha256 写回 `plugins/config.json` 的 `trusted.<id>`，然后重新构建镜像。房间内仍可用 `room.setPlugins` 逐个开关。

## 目录

```
server/        游戏服务端（入口 index.js）
shared/        双端共享协议/常量
public/        浏览器客户端
data/          config.json 等数据表（0.3.1）
plugins/       四个插件（随镜像发布）
deploy/stardust/ms-edge/   仅 ms 分支：nginx / 侧车 / 源表 / entrypoint
Dockerfile     仅 ms 分支：7860 + nginx + 侧车
```
