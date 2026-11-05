# superbig-gateway（归档分支）

`superbig.jiangjiangze.icu` 的 Cloudflare Pages 外壳与反代。

| 文件 | 作用 |
|---|---|
| `index.html` | 页面外壳，导航走这里 |
| `_worker.js` | 除外壳外所有路径反代到 ModelScope 创空间 |
| `public/index.html`、`public/_worker.js` | 同上，Pages 输出目录里的副本 |
| `wrangler.toml` | Pages 项目配置 |

## 反代覆盖的路径

`/js` `/css` `/vendor` `/data` `/assets` `/fonts` `/media` `/icons` `/packs` `/shared`、`/ws`、`/healthz`、`/api/*`

## 为什么必须反代

早先这层对所有路径都返回 HTML 外壳，于是 `/js/main.js`、`/data/local-assets.json` 拿到的都是 HTML，脚本「加载失败」、棋盘美术退回程序化绘制。

## 来源

本分支由仓库 `jingjiangze/superbig-gateway`（已删除）迁移而来，2026-11-05。
文件放在**分支根目录**，因此该分支本身即为可部署单元：Cloudflare Pages 项目指向本分支、构建根目录留空即可。
