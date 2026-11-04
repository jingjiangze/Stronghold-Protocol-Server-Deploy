// plugins/ai-scoring/host/score.js — 评分上报的服务端落点（trusted 桥接）。
//
// 背景：评分本身在浏览器里算（client/js/ai/scoringRunner.js + public/js/battle/rehearsalWorker.js），
// 算完由 client/js/ai/lineupStore.js 以 POST 上报。历史实现把它挂在核心 server/http/routes.js 的
// `/api/lineup-score`，但 v0.3.3 上游没有这个端点（非 GET/HEAD 一律 405）。
//
// 现在改走插件自己的 trusted 路由 `/x/ai-scoring/lineup-score`：核心 HTTP 不需要认识它，
// 桥接会把非 GET 方法放行到插件子进程（server/http/routes.js 在 405 守卫之前转发 /x/<id>/）。
// 语义与历史一致：**fail-open**，只做每会话窗口限速，body 不落盘也不解析（桥接本身也不转发 body）。
const WINDOW_MS = 1000;
const MAX_PER_WINDOW = 5;
let windowAt = 0;
let count = 0;

/** 每进程滑动窗口限速（一个窗口内最多 MAX_PER_WINDOW 次）。 */
function allow(now) {
  if (now - windowAt >= WINDOW_MS) { windowAt = now; count = 0; }
  count += 1;
  return count <= MAX_PER_WINDOW;
}

export async function activate(api) {
  api.http.route('/x/ai-scoring/lineup-score', (req) => {
    const method = String(req?.method || 'GET').toUpperCase();
    if (method === 'OPTIONS') return { ok: true, preflight: true };
    if (method !== 'POST') return { ok: false, error: 'POST only' };
    if (!allow(Date.now())) return { ok: false, error: 'rate' };
    return { ok: true };
  });
}
