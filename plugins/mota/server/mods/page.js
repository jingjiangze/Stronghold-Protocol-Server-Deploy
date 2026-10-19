// server/mods/page.js — the /mod page. One self-contained HTML document (no build step, no external assets, a strict
// CSP-friendly inline script): upload a zip, or let the server fetch one from an https address, then show what the
// import wrote. Reads need no key; both writes send the owner's key (plugins/.studio-key) in X-SP-Mod.

/**
 * @param {{ inbox: string, keyHint: string }} opts
 * @returns {string}
 */
export function modPage({ inbox, keyHint }) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>模组管理 · Mods</title>
<style>
  :root{color-scheme:dark}
  body{margin:0;padding:32px 20px 64px;background:#12151b;color:#dfe4ec;font:14px/1.55 system-ui,"Segoe UI",sans-serif}
  main{max-width:960px;margin:0 auto}
  h1{font-size:20px;margin:0 0 4px}
  p.sub{margin:0 0 24px;color:#8d97a8}
  section{background:#1a1f27;border:1px solid #2a3240;border-radius:10px;padding:16px 18px;margin:0 0 18px}
  h2{font-size:14px;margin:0 0 12px;color:#aab6c8;letter-spacing:.04em;text-transform:uppercase}
  label{display:block;margin:0 0 10px;color:#9aa6b8;font-size:12px}
  input,button{font:inherit}
  input[type=text],input[type=password]{width:100%;box-sizing:border-box;padding:8px 10px;border-radius:7px;border:1px solid #333d4d;background:#0f1318;color:#dfe4ec}
  input[type=file]{width:100%;padding:6px 0;color:#b9c3d3}
  button{padding:8px 16px;border-radius:7px;border:1px solid #2f6f5e;background:#173a31;color:#8ef0c8;cursor:pointer}
  button:disabled{opacity:.45;cursor:not-allowed}
  button.alt{border-color:#3b4a63;background:#1b2433;color:#a9c4ee}
  .row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  pre{white-space:pre-wrap;word-break:break-word;background:#0f1318;border:1px solid #2a3240;border-radius:8px;padding:12px;max-height:420px;overflow:auto;font-size:12px}
  table{width:100%;border-collapse:collapse;font-size:12px}
  th,td{text-align:left;padding:6px 8px;border-bottom:1px solid #242c38}
  th{color:#8d97a8;font-weight:500}
  code{background:#0f1318;padding:1px 5px;border-radius:4px}
  .ok{color:#7fe0b0}.bad{color:#ff9a8a}.dim{color:#7d8798}
</style>
</head>
<body>
<main>
  <h1>模组管理 · Mods</h1>
  <p class="sub">只在运行服务器的这台机器或局域网可用。导入只**安装**，不会自动在任何房间启用 —— 房间仍需自己选中。
  · Local / LAN only. An import installs; a room still has to switch it on.</p>

  <section>
    <h2>钥匙 · Key</h2>
    <label>写入需要业主钥匙（文件 <code>${esc(keyHint)}</code>），只存在本浏览器。读列表不需要。
      · Writes need the owner key; reads do not.</label>
    <div class="row">
      <input id="key" type="password" placeholder="X-SP-Mod key" autocomplete="off" spellcheck="false">
      <button class="alt" id="saveKey">记住 · Save</button>
    </div>
  </section>

  <section>
    <h2>手动上传 · Upload</h2>
    <label>Forge 包（含 <code>pack.json</code>）或插件包（含 <code>plugin.json</code>）的 zip。已存在同名插件时需要勾选覆盖。
      · A Forge pack (<code>pack.json</code>) or a plugin (<code>plugin.json</code>).</label>
    <div class="row">
      <input id="file" type="file" accept=".zip,application/zip">
      <label style="margin:0;display:flex;gap:6px;align-items:center"><input id="force" type="checkbox"> 覆盖 · overwrite</label>
      <button id="upload">上传并导入 · Upload</button>
    </div>
  </section>

  <section>
    <h2>从 mod 站抓取 · Fetch</h2>
    <label>仅接受公开 https 地址。给出 sha256 时会校验；不给则由服务端按包内清单判定类型。
      · Public https only. sha256 optional.</label>
    <label>URL<input id="url" type="text" placeholder="https://example.com/packs/mypack.zip" spellcheck="false"></label>
    <label>sha256（可选 · optional）<input id="sha" type="text" placeholder="64 hex digits" spellcheck="false"></label>
    <div class="row">
      <button id="fetch">抓取并导入 · Fetch</button>
    </div>
  </section>

  <section>
    <h2>已安装 · Installed</h2>
    <div class="row" style="margin-bottom:10px">
      <button class="alt" id="reload">刷新 · Reload</button>
      <span class="dim">收件目录 · inbox: <code>${esc(inbox)}</code>（把 zip 丢进去即安装 · drop a zip in to install）</span>
    </div>
    <div class="row" style="margin-bottom:10px"><span id="platform" class="dim"></span></div>
    <table><thead><tr><th>id</th><th>名称</th><th>版本</th><th>类别</th><th>状态</th></tr></thead><tbody id="rows"></tbody></table>
  </section>

  <section>
    <h2>结果 · Result</h2>
    <pre id="out" class="dim">（还没有操作 · nothing yet）</pre>
  </section>
</main>
<script>
(() => {
  const $ = (id) => document.getElementById(id);
  const out = $('out');
  const show = (v) => { out.textContent = typeof v === 'string' ? v : JSON.stringify(v, null, 2); out.className = ''; };
  const key = () => $('key').value.trim();
  $('key').value = localStorage.getItem('sp-mod-key') || '';
  $('saveKey').onclick = () => { localStorage.setItem('sp-mod-key', key()); show('已记住钥匙 · key saved'); };
  const busy = (b) => { for (const id of ['upload', 'fetch', 'reload']) $(id).disabled = b; };

  async function status() {
    const r = await fetch('/mod/status.json', { cache: 'no-store' });
    const j = await r.json();
    const pf = j.platform || { enabled: false };
    $('platform').textContent = pf.enabled
      ? '握手平台 · platform: ' + pf.mode + ' · ' + (pf.rooms || 0) + ' 个邀请链接' + (pf.lastError ? ' · 最近错误 ' + pf.lastError : '')
      : '握手平台 · platform: 未启用';
    const rows = (j.plugins || []).map((p) => {
      const state = p.status === 'loaded' ? '<span class="ok">loaded</span>'
        : p.status === 'disabled' ? '<span class="bad">disabled</span>'
        : '<span class="dim">' + (p.status || 'skipped') + '</span>';
      return '<tr><td><code>' + p.id + '</code></td><td>' + p.name + '</td><td>' + p.version + '</td><td>' + (p.class || '') + '</td><td>' + state + '</td></tr>';
    });
    $('rows').innerHTML = rows.join('') || '<tr><td colspan="5" class="dim">（没有插件 · none）</td></tr>';
    return j;
  }

  $('reload').onclick = async () => { try { const j = await status(); show({ installed: (j.plugins || []).length, inbox: j.inbox }); } catch (e) { show(String(e)); } };

  $('upload').onclick = async () => {
    const f = $('file').files[0];
    if (!f) return show('先选一个 zip · pick a zip first');
    if (!key()) return show('先填钥匙 · enter the key first');
    busy(true);
    try {
      const r = await fetch('/mod/upload' + ($('force').checked ? '?force=1' : ''), {
        method: 'POST', headers: { 'X-SP-Mod': key(), 'Content-Type': 'application/zip' }, body: f,
      });
      show(await r.json());
      await status();
    } catch (e) { show(String(e)); } finally { busy(false); }
  };

  $('fetch').onclick = async () => {
    const url = $('url').value.trim();
    if (!url) return show('先填 URL · enter a URL');
    if (!key()) return show('先填钥匙 · enter the key first');
    busy(true);
    try {
      const body = { url };
      const sha = $('sha').value.trim();
      if (sha) body.sha256 = sha;
      if ($('force').checked) body.force = true;
      const r = await fetch('/mod/fetch', { method: 'POST', headers: { 'X-SP-Mod': key(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      show(await r.json());
      await status();
    } catch (e) { show(String(e)); } finally { busy(false); }
  };

  status().catch((e) => { $('rows').innerHTML = '<tr><td colspan="5" class="bad">' + String(e) + '</td></tr>'; });
})();
</script>
</body>
</html>`;
}
