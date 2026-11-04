// test/accounts.test.js — 账号底座（业主 2026-11-01）：QQ 号登录、游客绑定、名片记录、公告、管理口令、布阵额度。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../server/boot-main.js';
import { openAccounts, normalizeQq, normalizePassword } from '../server/accounts/store.js';

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sp-accounts-'));

test('store: 建号 / 登录 / 令牌可校验，重开文件后仍在', () => {
  const dir = tmpDir();
  const a = openAccounts({ dataDir: dir, log: { warn() {}, info() {}, error() {} } });
  const reg = a.register('12345678', 'hunter2!');
  assert.equal(reg.ok, true);
  assert.match(reg.account.avatar, /q1\.qlogo\.cn.*nk=12345678/);
  assert.equal(a.verifyToken(reg.token), '12345678');
  assert.equal(a.login('12345678', 'hunter2!').ok, true);
  assert.equal(a.login('12345678', 'wrong-pass').error, 'BAD_CREDENTIALS');
  assert.equal(a.register('12345678', 'another1').error, 'EXISTS');
  assert.equal(a.register('123', 'hunter2!').error, 'BAD_QQ');
  assert.equal(a.register('12345678', 'short').error, 'BAD_PASSWORD');
  // 重开：同一目录第二次加载能读到
  const b = openAccounts({ dataDir: dir, log: { warn() {}, info() {}, error() {} } });
  assert.equal(b.size(), 1);
  assert.equal(b.login('12345678', 'hunter2!').ok, true);
  // 密码不落明文（SQLite 或 JSONL 后端都一样：整目录扫一遍）
  const blob = fs.readdirSync(dir).map((f) => { try { return fs.readFileSync(path.join(dir, f)).toString('latin1'); } catch { return ''; } }).join('');
  assert.equal(blob.includes('hunter2!'), false);
  assert.match(blob, /\$scrypt\$/);
  assert.ok(['sqlite', 'jsonl'].includes(a.backend));
});

test('store: 令牌被篡改或过期后失效', () => {
  const dir = tmpDir();
  let now = 1_000_000;
  const a = openAccounts({ dataDir: dir, now: () => now, log: { warn() {}, info() {}, error() {} } });
  const { token } = a.register('12345678', 'hunter2!');
  assert.equal(a.verifyToken(token), '12345678');
  assert.equal(a.verifyToken(token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'))), null);
  now += 31 * 24 * 3600 * 1000;
  assert.equal(a.verifyToken(token), null);
});

test('store: 游客绑定（存在账号要校验密码；不存在就建号）', () => {
  const dir = tmpDir();
  const a = openAccounts({ dataDir: dir, log: { warn() {}, info() {}, error() {} } });
  const first = a.bind('22334455', 'passw0rd', 'p_guest1');
  assert.equal(first.ok, true);
  assert.equal(a.get('22334455').playerId, 'p_guest1');
  assert.equal(a.bind('22334455', 'nope-nope', 'p_guest2').error, 'BAD_CREDENTIALS');
  const again = a.bind('22334455', 'passw0rd', 'p_guest2');
  assert.equal(again.ok, true);
  assert.equal(a.get('22334455').playerId, 'p_guest2');
});

test('store: 名片记录有字节上限；管理员可改密码', () => {
  const dir = tmpDir();
  const a = openAccounts({ dataDir: dir, quotaBytes: 1000, log: { warn() {}, info() {}, error() {} } });
  a.register('12345678', 'hunter2!');
  assert.equal(a.setProfile('12345678', { name: '博士', nameStyle: { color: '#fff' }, card: { op: 'char_1' } }).ok, true);
  assert.equal(a.setProfile('12345678', { name: 'x'.repeat(2000) }).error, 'TOO_LARGE');
  assert.equal(a.login('12345678', 'hunter2!').ok, true);
  assert.equal(a.adminPatch('12345678', { password: 'newpass1' }).ok, true);
  assert.equal(a.login('12345678', 'hunter2!').error, 'BAD_CREDENTIALS');
  assert.equal(a.login('12345678', 'newpass1').ok, true);
});

test('store: 首次以 SQLite 打开时导入旧 accounts.jsonl（后行覆盖前行），重开不重复导入', (t) => {
  const dir = tmpDir();
  // append-only 的旧库：同一个 QQ 两行，最后一行才是名片真值（线上就是这个形状）
  fs.writeFileSync(path.join(dir, 'accounts.jsonl'), [
    JSON.stringify({ qq: '1689170897', hash: 'h1', created: 1, updated: 2, playerId: null, profile: {}, lineupBytes: 0 }),
    JSON.stringify({ qq: '1689170897', hash: 'h1', created: 1, updated: 3, playerId: 'p_1', profile: { name: '腐竹大人', card: { skin: '35d01a1ce371' } }, lineupBytes: 0 }),
  ].join('\n') + '\n', 'utf8');
  const quiet = { warn() {}, info() {}, error() {} };
  const a = openAccounts({ dataDir: dir, log: quiet });
  if (a.backend !== 'sqlite') { a.close(); t.skip('node:sqlite 不可用（需要 --experimental-sqlite / Node 24）'); return; }
  const v = a.view('1689170897');
  assert.equal(v.name, '腐竹大人', 'JSONL 的最后一行必须赢');
  assert.deepEqual(v.card, { skin: '35d01a1ce371' });
  assert.equal(a.size(), 1, '同一 QQ 只应有一个账号');
  a.close();
  const b = openAccounts({ dataDir: dir, log: quiet });
  assert.equal(b.size(), 1, '重开不能再导一遍');
  assert.equal(b.view('1689170897').name, '腐竹大人');
  assert.equal(b.login('1689170897', 'whatever').error, 'BAD_CREDENTIALS', '导入的 hash 仍然可用');
  b.close();
});

test('http: /api 注册登录、公告读写、管理端点无钥匙时不存在', async (t) => {
  const dir = tmpDir();
  const prevKey = process.env.SP_ADMIN_KEY;
  process.env.SP_ADMIN_KEY = 'test-admin-key';
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, dataDir: dir, accounts: true });
  t.after(async () => {
    await srv.close();
    if (prevKey === undefined) delete process.env.SP_ADMIN_KEY; else process.env.SP_ADMIN_KEY = prevKey;
  });
  const base = srv.url;
  const post = (p, body, headers = {}) => fetch(`${base}${p}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });

  let r = await post('/api/auth/register', { qq: '12345678', password: 'hunter2!' });
  assert.equal(r.status, 200);
  const reg = await r.json();
  assert.equal(reg.ok, true);
  assert.ok(reg.token);

  r = await fetch(`${base}/api/account/me`, { headers: { authorization: `Bearer ${reg.token}` } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).account.qq, '12345678');

  r = await fetch(`${base}/api/account/me`);
  assert.equal(r.status, 401);

  // 管理端点：钥匙对 → 200；错 → 403
  r = await fetch(`${base}/api/admin/accounts`, { headers: { 'x-admin-key': 'test-admin-key' } });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).accounts.length, 1);
  r = await fetch(`${base}/api/admin/accounts`, { headers: { 'x-admin-key': 'wrong' } });
  assert.equal(r.status, 403);

  // 管理后台页面（P3）：配了钥匙就能拿到 HTML，且引用同源 /js/admin.js
  r = await fetch(`${base}/admin`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type') || '', /text\/html/);
  assert.match(await r.text(), /\/js\/admin\.js/);

  // 公告：管理写、公开读
  r = await post('/api/admin/announcements', { items: [{ id: 'a1', title: '维护公告', body: '今晚 23:00 停服', date: '2026-11-01', level: 'info' }] }, { 'x-admin-key': 'test-admin-key' });
  assert.equal(r.status, 200);
  r = await fetch(`${base}/api/announcements`);
  assert.equal(r.status, 200);
  const ann = await r.json();
  assert.equal(ann.items.length, 1);
  assert.equal(ann.items[0].title, '维护公告');
});

test('http: 没配 SP_ADMIN_KEY 时管理端点整段 404', async (t) => {
  const dir = tmpDir();
  const prevKey = process.env.SP_ADMIN_KEY;
  delete process.env.SP_ADMIN_KEY;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, dataDir: dir, accounts: true });
  t.after(async () => {
    await srv.close();
    if (prevKey !== undefined) process.env.SP_ADMIN_KEY = prevKey;
  });
  const r = await fetch(`${srv.url}/api/admin/accounts`);
  assert.equal(r.status, 404);
});

test('布阵库全服额度：按库目录 *.jsonl 总量判定（outbox 不计），超一字节即拒', async () => {
  const dir = tmpDir();
  const libDir = fs.mkdirSync(path.join(dir, 'lib'), { recursive: true });
  fs.writeFileSync(path.join(libDir, 'lineups_mode_multi_normal.jsonl'), 'x'.repeat(100), 'utf8');
  fs.writeFileSync(path.join(libDir, 'outbox.jsonl'), 'y'.repeat(500), 'utf8'); // 传输队列，不计入
  const prev = process.env.SP_LINEUP_LIBRARY;
  process.env.SP_LINEUP_LIBRARY = libDir;
  try {
    const mod = await import(`../plugins/mota/server/lineupLibrary.js?quota=${Date.now()}`);
    assert.equal(mod.globalLibraryBytes(), 100, 'only the lineups file counts');
    const quota = mod.lineupQuotaBytes();
    assert.equal(quota > 0, true);
    assert.equal(mod.lineupQuotaOk(quota - 100), true, 'filling it exactly is allowed');
    assert.equal(mod.lineupQuotaOk(quota - 99), false, 'one byte over is refused');
  } finally {
    if (prev === undefined) delete process.env.SP_LINEUP_LIBRARY; else process.env.SP_LINEUP_LIBRARY = prev;
  }
});

test('bind 没有 WS 会话也能建号（玩家还停在标题页）', async (t) => {
  const dir = tmpDir();
  const prev = process.env.SP_ADMIN_KEY;
  delete process.env.SP_ADMIN_KEY;
  const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, dataDir: dir, accounts: true });
  t.after(async () => { await srv.close(); if (prev !== undefined) process.env.SP_ADMIN_KEY = prev; });
  const r = await fetch(srv.url + '/api/auth/bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qq: '987654321', password: 'hunter2!' }) });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.equal(j.account.qq, '987654321');
  // 第二次同样不带会话，凭密码即可登录（同一个号）
  const again = await fetch(srv.url + '/api/auth/bind', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ qq: '987654321', password: 'hunter2!' }) });
  assert.equal(again.status, 200);
});
