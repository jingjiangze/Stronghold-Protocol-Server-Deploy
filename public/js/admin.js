// (i18n-ignore-file: operator console text, not player UI — docs/I18N.md)
// public/js/admin.js — 管理后台（P3）：纯前端、无构建、只打 /api/admin/*。
// CSP 是 `script-src 'self'`（无 unsafe-inline），所以本文件必须独立加载，页面上不放内联 JS。

const K = 'sp.adminKey';

const el = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => `${(Number(n) / 1024 ** 3).toFixed(2)} GiB`;

async function api(path, { method = 'GET', body = null } = {}) {
  const r = await fetch(path, {
    method,
    headers: { 'x-admin-key': sessionStorage.getItem(K) || '', ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({ ok: false, error: `HTTP ${r.status}` }));
  if (r.status === 403) throw new Error('口令不对或已失效');
  return data;
}

function show(id, on) { el(id).hidden = !on; }

async function load() {
  const data = await api('/api/admin/accounts');
  if (!data.ok) throw new Error(data.error || '读取失败');
  const row = el('summary');
  // 布阵占用的真源是全服布阵库（mota），账号表里没有每账号的数字。
  const quota = data.libraryQuotaBytes ?? data.quotaBytes;
  row.textContent = `共 ${data.accounts.length} 个账号 · 布阵库用量 ${fmt(data.libraryBytes || 0)} / ${fmt(quota || 0)}`;

  const body = el('rows');
  body.innerHTML = data.accounts.map((a) => `<tr>
      <td><img src="${esc(a.avatar)}" alt="" width="28" height="28" loading="lazy"> ${esc(a.qq)}</td>
      <td>${esc(a.name) || '<span class="dim">—</span>'}</td>
      <td class="dim">${a.created ? new Date(a.created).toLocaleString() : '—'}</td>
      <td class="ops">
        <button data-act="pw" data-qq="${esc(a.qq)}">改密码</button>
      </td>
    </tr>`).join('') || '<tr><td colspan="4" class="dim">还没有账号</td></tr>';

  const ann = await api('/api/admin/announcements');
  el('ann').value = JSON.stringify(ann.items || [], null, 2);
}

async function run(fn) {
  try { await fn(); } catch (e) { alert(e.message || String(e)); }
}

function bind() {
  el('keyForm').addEventListener('submit', (e) => {
    e.preventDefault();
    sessionStorage.setItem(K, el('key').value.trim());
    run(async () => { show('gate', false); show('panel', true); await load(); });
  });

  el('logout').addEventListener('click', () => { sessionStorage.removeItem(K); location.reload(); });
  el('refresh').addEventListener('click', () => run(load));

  el('rows').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    const qq = b.dataset.qq;
    if (b.dataset.act === 'pw') {
      const password = prompt(`给 ${qq} 设新密码（6–64 位）`);
      if (password) run(async () => { const r = await api('/api/admin/account', { method: 'POST', body: { qq, password } }); if (!r.ok) throw new Error(r.error); await load(); });
    }
  });

  el('annSave').addEventListener('click', () => run(async () => {
    let items;
    try { items = JSON.parse(el('ann').value || '[]'); } catch { throw new Error('公告不是合法 JSON'); }
    if (!Array.isArray(items)) throw new Error('公告必须是数组');
    const r = await api('/api/admin/announcements', { method: 'POST', body: { items } });
    if (!r.ok) throw new Error(r.error);
    el('annMsg').textContent = `已保存 ${items.length} 条`;
    setTimeout(() => { el('annMsg').textContent = ''; }, 3000);
  }));
}

if (sessionStorage.getItem(K)) { show('gate', false); show('panel', true); run(load); }
bind();
