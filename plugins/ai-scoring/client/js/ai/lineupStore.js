// public/js/ai/lineupStore.js — 客户端布阵库：候选 → 评分 → 回写。
//
// 契约（见 docs/AI-SCORING-CONTRACT.md）：
//   ingest({ modeId, difficulty, cells })   记录一条候选布阵（cells = [{ id, golden, row, col, dir }]）
//   nextTask()                              取一条尚未评分的候选；没有则 null（运行器据此休眠）
//   report(task, results)                   写回评分并标记已评分
//   snapshot()                              诊断用：条数与已评分数
//
// 存储用 localStorage（同步、够小）：一条布阵通常 < 1 KB，上限 400 条，超出按最早淘汰。
// 这里**不猜强度**：分数由 Worker 算出来再写回。

const KEY = 'sp.ai.lineups.v1';
const MAX = 400;

const read = () => {
  try {
    const raw = globalThis.localStorage?.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
};
const write = (rows) => {
  try { globalThis.localStorage?.setItem(KEY, JSON.stringify(rows.slice(0, MAX))); } catch { /* 隐私模式：不落盘 */ }
};
const sigOf = (cells) => {
  const norm = (cells || []).map((c) => `${c.id}@${c.row},${c.col}:${c.dir || ''}`).sort().join('|');
  let h = 5381;
  for (let i = 0; i < norm.length; i++) h = ((h * 33) ^ norm.charCodeAt(i)) >>> 0;
  return h.toString(16);
};

export const lineupStore = {
  /** @param {{ modeId: string, difficulty?: string, cells: Array<object> }} entry */
  ingest({ modeId, difficulty = null, cells } = {}) {
    if (!modeId || !Array.isArray(cells) || cells.length < 2) return null;
    const sig = sigOf(cells);
    const rows = read();
    if (rows.some((r) => r.sig === sig)) return sig;
    rows.unshift({ sig, modeId, difficulty, cells, at: new Date().toISOString(), score: null, tries: 0 });
    write(rows);
    return sig;
  },

  /** @returns {{ id: string, sig: string, modeId: string, difficulty: string|null, cells: Array<object> } | null} */
  nextTask() {
    const row = read().find((r) => r.score == null && r.tries < 3);
    if (!row) return null;
    row.tries += 1;
    write(read().map((r) => (r.sig === row.sig ? { ...r, tries: row.tries } : r)));
    return { id: row.sig, sig: row.sig, modeId: row.modeId, difficulty: row.difficulty, cells: row.cells };
  },

  /** @param {{ sig?: string, id?: string }} task @param {Array<{ index: number, built: number, leaks: number, kills: number, score: number }>} results */
  report(task, results) {
    this.reportLocal(task, results);
    this.reportRemote(task, results);
  },

  /** 只回写本地（原行为）。 */
  reportLocal(task, results) {
    const sig = task?.sig || task?.id;
    if (!sig || !Array.isArray(results) || !results.length) return;
    const best = results.reduce((a, b) => (b.score > a.score ? b : a), results[0]);
    write(read().map((r) => (r.sig === sig ? { ...r, score: best.score, scored: best } : r)));
  },

  /**
   * 上报一份评分给 /api/lineup-score（信任模型见 docs/AI-SCORING-CONTRACT.md）。
   * 永远 fail-open：没联网、服务器不收、线上关了都只记一条 warn，不影响对局与本地库。
   * @param {{ sig?: string, id?: string, modeId?: string, difficulty?: string|null }} task
   * @param {Array<object>} results
   */
  reportRemote(task, results) {
    const sig = task?.sig || task?.id;
    if (!sig || !Array.isArray(results) || !results.length) return;
    const fetchImpl = globalThis.fetch;
    if (typeof fetchImpl !== 'function') return;
    try {
      void fetchImpl('/api/lineup-score', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({ sig, modeId: task?.modeId || null, difficulty: task?.difficulty || null, results }),
      }).catch(() => { /* 上报失败不影响本地 */ });
    } catch { /* 同步 throw 的 fetch 实现也不外溢 */ }
  },

  snapshot() {
    const rows = read();
    return { total: rows.length, scored: rows.filter((r) => r.score != null).length, pending: rows.filter((r) => r.score == null).length };
  },
};
