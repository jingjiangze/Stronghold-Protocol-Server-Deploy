# superbig-gateway

`superbig.jiangjiangze.icu` 的 CF Pages 入口。页面导航走本仓库的外壳（`public/index.html`），
其余路径（`/js /css /vendor /data /assets /fonts /media /icons /packs /shared`、`/ws`、`/healthz`、`/api/*`）
一律反代到 ModelScope 创空间。

为什么要这样：之前这层对所有路径都返回 HTML 外壳，`/js/main.js`、`/data/local-assets.json` 拿到的都是 HTML，
所以脚本"加载失败"、棋盘美术退回程序化。

<!-- build 1792492946965 -->
