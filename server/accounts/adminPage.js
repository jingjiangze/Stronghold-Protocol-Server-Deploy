// (i18n-ignore-file: operator console text, not player UI — docs/I18N.md)
// server/accounts/adminPage.js — 管理后台的 HTML 外壳（P3）。
// 只出静态 HTML：脚本走同源 /js/admin.js（CSP `script-src 'self'` 不允许内联）；样式内联（style-src 允许 inline）。

export const ADMIN_HTML = `<!doctype html>
<html lang="zh-CN"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>账号后台 · 卫戍协议</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;font:14px/1.6 system-ui,"Segoe UI","Microsoft YaHei",sans-serif;background:#12151b;color:#e6e9ef}
  header{display:flex;align-items:center;gap:12px;padding:14px 20px;border-bottom:1px solid #232833;background:#171b22}
  h1{font-size:16px;margin:0;font-weight:600}
  main{padding:20px;max-width:1100px;margin:0 auto}
  .card{background:#171b22;border:1px solid #232833;border-radius:10px;padding:16px;margin-bottom:18px}
  .dim{color:#8b93a1}
  .num{font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse}
  th,td{padding:8px 6px;border-bottom:1px solid #232833;text-align:left;vertical-align:middle}
  th{font-weight:600;color:#aab2c0;font-size:12px;text-transform:uppercase;letter-spacing:.04em}
  td img{border-radius:50%;vertical-align:-8px}
  .ops{white-space:nowrap}
  button{font:inherit;padding:4px 10px;border-radius:6px;border:1px solid #2f3745;background:#212836;color:#e6e9ef;cursor:pointer}
  button:hover{background:#2a3243}
  input,textarea{width:100%;box-sizing:border-box;font:inherit;padding:8px;border-radius:6px;border:1px solid #2f3745;background:#0e1116;color:#e6e9ef}
  textarea{min-height:220px;font-family:ui-monospace,Consolas,monospace;font-size:12px}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .grow{flex:1}
  [hidden]{display:none!important}
</style>
</head><body>
<header>
  <h1>账号后台</h1>
  <span class="dim grow" id="summary"></span>
  <button id="refresh" type="button">刷新</button>
  <button id="logout" type="button">退出</button>
</header>
<main>
  <section class="card" id="gate">
    <p class="dim">输入服务器环境变量 <code>SP_ADMIN_KEY</code> 的口令。口令只存在本标签页的 sessionStorage。</p>
    <form id="keyForm" class="row">
      <input id="key" type="password" autocomplete="current-password" placeholder="管理口令" required>
      <button type="submit">进入</button>
    </form>
  </section>

  <section id="panel" hidden>
    <div class="card">
      <table>
        <thead><tr><th>账号</th><th>昵称</th><th>创建时间</th><th></th></tr></thead>
        <tbody id="rows"></tbody>
      </table>
    </div>

    <div class="card">
      <div class="row" style="margin-bottom:10px">
        <strong class="grow">公告（JSON 数组：{id,title,body,date,level}）</strong>
        <span class="dim" id="annMsg"></span>
        <button id="annSave" type="button">保存公告</button>
      </div>
      <textarea id="ann" spellcheck="false"></textarea>
    </div>
  </section>
</main>
<script type="module" src="/js/admin.js"></script>
</body></html>`;
