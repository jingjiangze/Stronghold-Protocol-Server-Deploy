// server/accounts/store.js — 极简账号库 (业主 2026-11-01)：QQ 号当登录名、头像走 QQ 头像 API（不存图）、
// 密码自己设、游客可绑定；服务端只存「口令哈希 + 名片/昵称样式」。
//
// 存储（业主 2026-11-01 追加：用 SQLite）：Node 内置 `node:sqlite`（22.11 需 `--experimental-sqlite`，生产在
// systemd 的 NODE_OPTIONS 里给；Node 24 起默认可用）。**拿不到该模块时退回 append-only JSONL**，接口完全一致
// （CI 的 Node 22 无 flag 就走这条）；`SP_ACCOUNTS_BACKEND=jsonl` 可强制走回退（测试用）。
//
// **一切懒初始化**：没人用账号功能时 boot 不写任何文件——Windows 上并行测试进程抢同一个 data/ 路径会 EBUSY/EPERM，
// 这条曾把两个测试分片一起打红（2026-11-01）。
//
// 容量（业主 2026-11-02 更正）：20G 是**全服务器**的布阵数据容量，且真源在 mota 的布阵库
// （`plugins/mota/server/lineupLibrary.js`，按库文件字节判定）。账号表不再持有「每账号布阵占用」，
// 管理端现读布阵库；账号表里那个永不为真的 `lineup_bytes` 列只保留给回滚兼容，不再读写。
//
// 迁移（业主 2026-11-02「直接转 SQLite」）：以 SQLite 打开且表为空时，把旧 `accounts.jsonl`
// 合并（**后行覆盖前行**）后导入；旧文件保留不删，重复启动不会重导。
//
// 会话令牌是**无状态** HMAC（`<qq>.<exp>.<sig>`，密钥 `data/.account-secret` 0600）⇒ 服务端不为登录态存任何
// 东西，重启不掉线；客户端「默认保留登录」只是把令牌存进 localStorage（客户端侧决定）。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';

/** 全服布阵数据容量：业主口径 20G（不是每账号）。 */
export const DEFAULT_LINEUP_QUOTA_BYTES = 20 * 1024 ** 3;

const SCRYPT = Object.freeze({ N: 16384, r: 8, p: 1, keylen: 32 });
const QQ_RE = /^[1-9][0-9]{4,11}$/;
const PROFILE_MAX = 1024; // 名片 / 昵称样式这类展示记录的总字节上限
const TOKEN_TTL_MS = 30 * 24 * 3600 * 1000;

const b64u = (buf) => Buffer.from(buf).toString('base64url');

function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = crypto.scryptSync(String(password), salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p });
  return `$scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('hex')}$${key.toString('hex')}`;
}

function checkPassword(password, stored) {
  try {
    const parts = String(stored || '').split('$');
    if (parts.length !== 7 || parts[1] !== 'scrypt') return false;
    const [, , N, r, p, saltHex, keyHex] = parts;
    const key = crypto.scryptSync(String(password), Buffer.from(saltHex, 'hex'), keyHex.length / 2, { N: Number(N), r: Number(r), p: Number(p) });
    const want = Buffer.from(keyHex, 'hex');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  } catch { return false; }
}

export function normalizeQq(qq) {
  const s = String(qq ?? '').trim();
  return QQ_RE.test(s) ? s : null;
}

export function normalizePassword(pw) {
  const s = typeof pw === 'string' ? pw : '';
  return s.length >= 6 && s.length <= 64 && s.trim() === s ? s : null;
}

/** node:sqlite when the runtime has it (22.5+ with --experimental-sqlite, 24+ by default), else null. */
function loadSqlite() {
  try {
    const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite');
    return DatabaseSync || null;
  } catch { return null; }
}

/**
 * @param {{ dataDir: string, log?: object, quotaBytes?: number, now?: () => number }} o
 */
export function openAccounts({ dataDir, log = console, quotaBytes = Number(process.env.SP_ACCOUNT_LINEUP_QUOTA_BYTES) || DEFAULT_LINEUP_QUOTA_BYTES, now = Date.now }) {
  const sqliteFile = path.join(dataDir, 'accounts.db');
  const jsonlFile = path.join(dataDir, 'accounts.jsonl');
  const secretFile = path.join(dataDir, '.account-secret');

  /** @type {{ mode: 'sqlite'|'jsonl', db: any, rows: Map<string, any>, secret: Buffer } | null} */
  let st = null;

  const forceJsonl = String(process.env.SP_ACCOUNTS_BACKEND || '').toLowerCase() === 'jsonl';
  const DatabaseSync = forceJsonl ? null : loadSqlite();

  /**
   * 旧 JSONL 库的读取语义：append-only，同一个 QQ 可能被追加多次 —— **后行覆盖前行**。
   * 两种后端共用这一份解析，避免迁移语义与回退语义漂移。
   */
  function readJsonlRows(file) {
    const rows = new Map();
    try {
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try { const row = JSON.parse(line); rows.set(row.qq, { ...(rows.get(row.qq) || {}), ...row }); } catch { /* skip a broken line */ }
      }
    } catch (e) { log.warn?.('[accounts] cannot read the jsonl store', e?.message); }
    return rows;
  }

  /**
   * 一次性迁移：库为空且存在旧 JSONL 时，把「合并后」的账号导进 SQLite。
   * 门槛是 COUNT(*)=0（不是「文件存在」），所以之后每次启动都不会用旧 jsonl 盖掉线上改动；
   * 原 jsonl 保留不删（回滚到旧代码还能用）。导入失败只记日志，绝不让账号接口 500。
   */
  function importJsonlOnce(db) {
    try {
      if (!fs.existsSync(jsonlFile)) return;
      const count = Number(db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n) || 0;
      if (count > 0) return;
      const rows = readJsonlRows(jsonlFile);
      if (!rows.size) return;
      const ins = db.prepare(`INSERT INTO accounts (qq, hash, created, updated, player_id, profile, lineup_bytes) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(qq) DO UPDATE SET hash=excluded.hash, updated=excluded.updated, player_id=excluded.player_id,
          profile=excluded.profile, lineup_bytes=excluded.lineup_bytes`);
      let imported = 0;
      db.exec('BEGIN IMMEDIATE');
      try {
        for (const row of rows.values()) {
          if (!row || typeof row.qq !== 'string' || typeof row.hash !== 'string' || !row.hash) continue;
          ins.run(row.qq, row.hash, Number(row.created) || now(), Number(row.updated) || Number(row.created) || now(),
            row.playerId ?? null, JSON.stringify(row.profile || {}), Number(row.lineupBytes) || 0);
          imported += 1;
        }
        db.exec('COMMIT');
      } catch (e) {
        try { db.exec('ROLLBACK'); } catch { /* nothing to roll back */ }
        throw e;
      }
      if (imported) log.info?.(`[accounts] imported ${imported} account(s) from accounts.jsonl into accounts.db`);
    } catch (e) { log.warn?.('[accounts] jsonl → sqlite import skipped', e?.message); }
  }

  /** 懒初始化：第一处真正用到账号数据时才建目录/密钥/表。 */
  function ensure() {
    if (st) return st;
    fs.mkdirSync(dataDir, { recursive: true });
    let secret = null;
    try {
      const raw = fs.readFileSync(secretFile);
      if (raw.length >= 32) secret = raw.subarray(0, 32);
    } catch { /* first use */ }
    if (!secret) {
      secret = crypto.randomBytes(32);
      try { fs.writeFileSync(secretFile, secret, { mode: 0o600 }); } catch (e) { log.warn?.('[accounts] cannot persist the token secret', e?.message); }
    }
    if (DatabaseSync) {
      const db = new DatabaseSync(sqliteFile);
      // 蓝绿两个进程共用同一个 dataDir：给写锁一点等待时间，别直接 SQLITE_BUSY。
      try { db.exec('PRAGMA busy_timeout = 3000'); } catch { /* older runtimes */ }
      db.exec(`CREATE TABLE IF NOT EXISTS accounts (
        qq TEXT PRIMARY KEY,
        hash TEXT NOT NULL,
        created INTEGER NOT NULL,
        updated INTEGER NOT NULL,
        player_id TEXT,
        profile TEXT NOT NULL DEFAULT '{}',
        lineup_bytes INTEGER NOT NULL DEFAULT 0
      )`);
      st = { mode: 'sqlite', db, rows: null, secret };
      importJsonlOnce(db);
      return st;
    }
    st = { mode: 'jsonl', db: null, rows: readJsonlRows(jsonlFile), secret };
    return st;
  }

  const rowOf = (qq) => {
    const s = ensure();
    if (s.mode === 'sqlite') {
      const r = s.db.prepare('SELECT qq, hash, created, updated, player_id, profile, lineup_bytes FROM accounts WHERE qq = ?').get(qq);
      return r ? { qq: r.qq, hash: r.hash, created: r.created, updated: r.updated, playerId: r.player_id, profile: JSON.parse(r.profile || '{}'), lineupBytes: r.lineup_bytes } : null;
    }
    return s.rows.get(qq) || null;
  };

  const upsert = (row) => {
    const s = ensure();
    const a = rowOf(row.qq) || { profile: {}, lineupBytes: 0 };
    const next = {
      qq: row.qq,
      hash: row.hash ?? a.hash,
      created: a.created ?? row.created ?? now(),
      updated: now(),
      playerId: row.playerId ?? a.playerId ?? null,
      profile: row.profile ?? a.profile ?? {},
      lineupBytes: row.lineupBytes ?? a.lineupBytes ?? 0,
    };
    if (s.mode === 'sqlite') {
      s.db.prepare(`INSERT INTO accounts (qq, hash, created, updated, player_id, profile, lineup_bytes) VALUES (?,?,?,?,?,?,?)
        ON CONFLICT(qq) DO UPDATE SET hash=excluded.hash, updated=excluded.updated, player_id=excluded.player_id,
          profile=excluded.profile, lineup_bytes=excluded.lineup_bytes`)
        .run(next.qq, next.hash, next.created, next.updated, next.playerId, JSON.stringify(next.profile), next.lineupBytes);
    } else {
      s.rows.set(next.qq, next);
      fs.appendFileSync(jsonlFile, `${JSON.stringify(next)}\n`, 'utf8');
    }
    return next;
  };

  const publicView = (a) => a && ({
    qq: a.qq,
    // 头像不存：客户端直接用 QQ 头像 API；换号/换图都不用动存储。
    avatar: `https://q1.qlogo.cn/g?b=qq&nk=${encodeURIComponent(a.qq)}&s=100`,
    name: a.profile?.name || '',
    nameStyle: a.profile?.nameStyle || null,
    card: a.profile?.card || null,
    created: a.created || null,
  });

  function sign(qq) {
    const s = ensure();
    const exp = now() + TOKEN_TTL_MS;
    const payload = `${qq}.${exp}`;
    return `${payload}.${b64u(crypto.createHmac('sha256', s.secret).update(payload).digest())}`;
  }

  function verifyToken(token) {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const [qq, exp, sig] = parts;
    if (!Number.isFinite(Number(exp)) || Number(exp) < now() || !rowOf(qq)) return null;
    const s = ensure();
    const want = b64u(crypto.createHmac('sha256', s.secret).update(`${qq}.${exp}`).digest());
    return want.length === sig.length && crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig)) ? qq : null;
  }

  return {
    get backend() { return ensure().mode; },
    get file() { return ensure().mode === 'sqlite' ? sqliteFile : jsonlFile; },
    quotaBytes,
    size() { const s = ensure(); return s.mode === 'sqlite' ? Number(s.db.prepare('SELECT COUNT(*) AS n FROM accounts').get().n) || 0 : s.rows.size; },
    get: rowOf,
    view: (qq) => publicView(rowOf(String(qq))),
    list() {
      const s = ensure();
      return s.mode === 'sqlite'
        ? s.db.prepare('SELECT qq FROM accounts ORDER BY updated DESC').all().map((r) => publicView(rowOf(r.qq)))
        : [...s.rows.keys()].map((qq) => publicView(s.rows.get(qq)));
    },
    verifyToken,

    register(qq, password) {
      const id = normalizeQq(qq), pw = normalizePassword(password);
      if (!id) return { error: 'BAD_QQ' };
      if (!pw) return { error: 'BAD_PASSWORD' };
      if (rowOf(id)) return { error: 'EXISTS' };
      const row = upsert({ qq: id, hash: hashPassword(pw), profile: {}, lineupBytes: 0 });
      return { ok: true, token: sign(id), account: publicView(row) };
    },

    login(qq, password) {
      const id = normalizeQq(qq);
      const a = id ? rowOf(id) : null;
      if (!a || !checkPassword(password, a.hash)) return { error: 'BAD_CREDENTIALS' };
      return { ok: true, token: sign(id), account: publicView(a) };
    },

    /** 游客绑定：既有账号要校验密码；没有就建号。 */
    bind(qq, password, playerId) {
      const id = normalizeQq(qq), pw = normalizePassword(password);
      if (!id) return { error: 'BAD_QQ' };
      if (!pw) return { error: 'BAD_PASSWORD' };
      const a = rowOf(id);
      if (a && !checkPassword(pw, a.hash)) return { error: 'BAD_CREDENTIALS' };
      const row = a
        ? upsert({ qq: id, playerId: String(playerId || '') })
        : upsert({ qq: id, hash: hashPassword(pw), playerId: String(playerId || '') });
      return { ok: true, token: sign(id), account: publicView(row) };
    },

    setProfile(qq, patch) {
      const a = rowOf(String(qq));
      if (!a) return { error: 'NOT_FOUND' };
      const next = { ...(a.profile || {}) };
      for (const k of ['name', 'nameStyle', 'card']) {
        if (!(k in (patch || {}))) continue;
        const v = patch[k];
        if (v == null) { delete next[k]; continue; }
        if (typeof v === 'string' && v.length > 120) return { error: 'TOO_LARGE' };
        next[k] = typeof v === 'object' ? v : String(v);
      }
      if (Buffer.byteLength(JSON.stringify(next)) > PROFILE_MAX) return { error: 'TOO_LARGE' };
      return { ok: true, account: publicView(upsert({ qq: a.qq, profile: next })) };
    },

    adminPatch(qq, { password = null } = {}) {
      const a = rowOf(String(qq));
      if (!a) return { error: 'NOT_FOUND' };
      const patch = { qq: a.qq };
      if (password != null) {
        const pw = normalizePassword(password);
        if (!pw) return { error: 'BAD_PASSWORD' };
        patch.hash = hashPassword(pw);
      }
      return { ok: true, account: publicView(upsert(patch)) };
    },

    close() { try { st?.db?.close(); } catch { /* already closed */ } },
  };
}
