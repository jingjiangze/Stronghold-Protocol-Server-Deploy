// server/mods/pageScript.js — the /mod page's browser script, served as `/mod/page.js`.
// It lives in its own file because the site CSP (`server/http/csp.js`) hashes *only* import maps and never
// arbitrary inline script, so an inline <script> on /mod is silently blocked and the table stays empty.
// Served with `script-src 'self'`, this file needs no hash.
//
// (i18n-ignore-file: the page is bilingual by design, 中文 · English — the same rule server/mods/page.js
// carries, docs/I18N.md.)

export const MOD_PAGE_SCRIPT = String.raw`(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
      const on = p.enabled === true;
      const toggle = '<td><span class="' + (on ? 'ok' : 'dim') + '">' + (on ? '启用' : '未启用') + '</span> '
        + '<button class="alt" data-toggle="' + esc(p.id) + '" data-on="' + (on ? '0' : '1') + '">'
        + (on ? '停用 · off' : '启用 · on') + '</button></td>';
      return '<tr><td><code>' + esc(p.id) + '</code></td><td>' + esc(p.name) + '</td><td>' + esc(p.version) + '</td><td>'
        + esc(p.class || '') + '</td><td>' + state + '</td>' + toggle + '</tr>';
    });
    $('rows').innerHTML = rows.join('') || '<tr><td colspan="6" class="dim">（没有插件 · none）</td></tr>';
    for (const b of $('rows').querySelectorAll('button[data-toggle]')) {
      b.onclick = async () => {
        if (!key()) return show('先填钥匙 · enter the key first');
        b.disabled = true;
        try {
          const r = await fetch('/mod/enable', {
            method: 'POST', headers: { 'X-SP-Mod': key(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: b.dataset.toggle, on: b.dataset.on === '1' }),
          });
          show(await r.json());
          await status();
        } catch (e) { show(String(e)); } finally { b.disabled = false; }
      };
    }
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
})();`;
