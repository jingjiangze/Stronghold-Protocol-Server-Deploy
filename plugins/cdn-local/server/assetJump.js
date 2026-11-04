// server/http/asset-jump.js — 缺失素材的 302 跳转，做在**游戏进程内**。
//
// 为什么进程内也要有这一层：素材跳转（把 /assets|fonts 缺的文件 302 到当前素材源）本来只有容器
// 边缘层（deploy/stardust/ms-edge 的 nginx + sidecar）。2026-10-11 实测创空间容器里 nginx 不在
// 链路上——镜像按提交重建成功、游戏在跑，但 /assets 请求直接落到游戏进程的 404。跳转不该押在
// 「平台是否执行我们的 CMD」上，所以游戏进程用**同一份 sources.json、同一组纯函数**兜底：
// 白名单、路径校验、例外表、?sp_source 覆盖都只有 edge-sidecar.mjs 一处实现，禁止在本文件里
// 拷贝或另立一套规则。
//
// 语义（本地优先）：static.js 只在**文件本机不存在**时才问这里；有文件仍走文件。
// 非 /assets|fonts 路径、不允许的扩展名、配置读不到 → 返回 null，交回原来的 404。
import fs from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, noopLog } from '../../../server/http/config.js';
import { decide, parseSources, stripSourceParam } from './edge-sidecar.js';
import { createMirrorProbe } from '../../../server/mirrorProbe.js';

/**
 * 排名端点。**多个 URL 是同一个对象的不同门牌**，按序回退：
 *   1. 魔搭数据集门牌 —— 同一份 rank.json 镜像进 `jingjiangze/Stronghold-Protocol-Assets` 数据集，
 *      容器侧实测 0.16 s（本机 curl）/ 67 ms（容器视角）可达，是「容器自己就能稳定读到」的那一个；
 *   2. speedcdn —— CF 边缘 302 到上面同一棵数据集（2026-10-22 实测 /cdn/v1/rank.json 200 / 3,201 B）。
 *      旧兑底 weishucdn 已随 R2 订阅停用变 403（2026-10-22），从候选里摘除；R2 恢复后可加回。
 *
 * 2026-10-14 实测容器里 weishucdn/speedcdn 两个门牌拿 rank.json 都要 4.7~20 s，旧代码的 4 s 超时
 * 让这三条**全部**读失败 —— 排名于是永远取不到，`ranked ?? config.order` 一路退化成静态 order。
 * 所以镜像进数据集（快门牌）+ 抬高超时（容忍慢门牌）两件事都要做。
 */
export const DEFAULT_RANK_URLS = [
  'https://modelscope.cn/api/v1/datasets/jingjiangze/Stronghold-Protocol-Assets/repo?Revision=master&FilePath=cdn%2Fv1%2Frank.json',
  'https://speedcdn.jiangjiangze.icu/cdn/v1/rank.json',
];
/** 旧名保留：SP_RANK_URL 仍可作为「首选 URL」。 */
export const DEFAULT_RANK_URL = DEFAULT_RANK_URLS[0];
export const RANK_TTL_MS = 300_000;
/**
 * rank.json 的抓取超时。门牌里最慢的一条实测要 4.7 s（容器到 CF 系），4 s 会让它必然超时，
 * 于是三条门牌全都失败、排名永远取不到。取 15 s：仍远小于 5 分钟的 TTL，失败也只浪费一次空等，
 * 换来慢门牌真的有机会成功。
 */
export const RANK_TIMEOUT_MS = 15_000;
/**
 * 排名里的 id → 边缘源表的 id。两边的命名不同名（CDN 侧叫 ms-dataset/ms-edge/r2-alt，边缘侧叫
 * modelscope/r2），而且 **ms-edge 就是本容器自己**——映射成 null 表示"跳过"：否则边缘会 302 到自己，
 * 客户端跟着无限跳。未列出的 id 按同名处理（两边同名时零配置即可用）。
 */
// 2026-10-14 用户指令：停止 speedcdn 分发玩家素材、R2 退为最后备选源、order 逆序为 modelscope → r2。
// 因此 **ms-dataset 必须映射成 modelscope**：若像 10-13 那样把它映射成 null（跳过），rank 前两名
// （ms-dataset / ms-edge，实测均 measured:true usable:true）会被全部丢弃，applyRank 只剩 r2，
// 逆序白做——排名又退化成「R2 优先」，$7.59/月 一分不省。这是本次改动最容易踩空的一处。
// ms-edge 仍是**本容器自己**，必须继续映射成 null（否则边缘 302 到自己，客户端无限跳）。
// 2026-10-22：**speedcdn 已不再指向 R2**（R2 订阅停用，它改为 CF Redirect Rule 全路径 302 到数据集）。
// 它现在与 ms-dataset 同字节（same resolve），所以映射成 modelscope；继续映射到 r2 会让「数据集的速度」
// 顶替 weishucdn 进 rank 头部 —— 而 weishucdn 现在 403，玩家会被顺延到一个打不开的源。
export const RANK_ID_MAP = {
  'r2': 'r2',
  'r2-alt': 'r2',
  'speedcdn': 'modelscope',
  'ms-dataset': 'modelscope',
  'ms-edge': null,
};

/**
 * **合格集**：只有「真的测过」的条目才有资格进生效顺序的**头部**。
 *
 * **为什么仍要卡这一条**：rank 是**外部可写**的数据（CDN 仓生成后上传）。这一层不假设它可信——
 * `partial` 覆盖、`down`、`excluded` 的条目一律不得进头部，否则「最快」会变成一个缺件源，
 * 玩家拿到 404，而跳转层还把它当速度结论放大出去。同一套判据也是防止「谁先登记谁排第一」
 * 的兜底：一旦上游生成器退化成按登记顺序出榜，未实测条目会被这里挡下，退化成静态 order。
 *
 * 2026-10-14 复核线上 rank.json：8 条里前 6 条 measured:true/coverage:full 均合格，
 * `ghfast-raw`(usable:false,coverage:partial) 与 `ghfast-assets`(usable:false) 被判不合格 ——
 * 与本机实测一致（jsDelivr 系 34% 成功/TTFB 13.3 s）。**旧注释写的「前两名 measured:false」已不成立**。
 *
 * 未实测/未进榜的**已配置源不丢**，只是按静态 order 接到尾部（见 applyRank）。
 */
export function rankQualified(r) {
  if (!r || typeof r !== 'object') return false;
  if (r.excluded === true || r.down === true || r.usable === false) return false;
  if (r.coverage === 'partial') return false;
  return r.measured === true;
}

export const DEFAULT_SOURCES_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'config', 'sources.json');

/**
 * 抽样池 = 随服务发布的素材清单里的相对路径（`data/assets.json`）。读不到就退回一个内置路径，
 * 保证探测器至少还能量出「小文件延迟」这一项；**绝不**从网络或调用方取路径。
 */
export function loadProbePaths(fsImpl = fs, pathImpl = path, root = ROOT, log = noopLog) {
  const fallback = ['/assets/char/avatar/char_003_kalts.png'];
  try {
    const manifest = JSON.parse(fsImpl.readFileSync(pathImpl.join(root, 'data', 'assets.json'), 'utf8'));
    const urls = [];
    (function walk(o) {
      if (typeof o === 'string') urls.push(o);
      else if (Array.isArray(o)) o.forEach(walk);
      else if (o && typeof o === 'object') Object.values(o).forEach(walk);
    })(manifest);
    const rel = [...new Set(urls.filter((u) => u.startsWith('/assets/') && !u.includes('?')))];
    return rel.length ? rel : fallback;
  } catch (e) {
    log.warn?.(`[http] asset jump: cannot read data/assets.json (${e?.message || e}) — probe uses the built-in sample`);
    return fallback;
  }
}

/**
 * Build the jump decision function. Off when the sources file is unreadable or SP_ASSET_JUMP=0 —
 * a jump layer must never take the game down with it.
 * @param {{ sourcesPath?: string, disabled?: boolean, log?: { info?: Function, warn?: Function } }} [opts]
 * @returns {(pathname: string, query: string, method: string) => { status: number, headers: Record<string, string> } | null}
 */
export function createAssetJump({ sourcesPath = process.env.SP_EDGE_SOURCES || DEFAULT_SOURCES_PATH, disabled = process.env.SP_ASSET_JUMP === '0', log = noopLog, rankUrl = process.env.SP_RANK_URL || '', rankUrls = null, fetchImpl = globalThis.fetch, healthIntervalMs = process.env.SP_ASSET_HEALTH === '0' ? 0 : Number(process.env.SP_ASSET_HEALTH_INTERVAL_MS || 60_000), probeIntervalMs = process.env.SP_PROBE === '0' ? 0 : Number(process.env.SP_PROBE_INTERVAL_MS || 300_000), probeLeads = process.env.SP_PROBE_LEADS === '1' } = {}) {
  if (disabled) {
    log.info?.('[http] asset jump: disabled (SP_ASSET_JUMP=0)');
    return () => null;
  }
  let config;
  try {
    config = parseSources(fs.readFileSync(sourcesPath, 'utf8'));
  } catch (e) {
    log.warn?.(`[http] asset jump: off — cannot read ${sourcesPath}: ${e?.message || e}`);
    return () => null;
  }
  log.info?.(`[http] asset jump: on — order=${config.order.join(' > ')}, exceptions=${config.exceptions.size} (${sourcesPath})`);
  // 候选门的顺序：显式参数 > SP_RANK_URLS > SP_RANK_URL（旧名，作首选）> 内置两条（同桶的两个门牌）。
  const urls = (rankUrls
    || (process.env.SP_RANK_URLS ? process.env.SP_RANK_URLS.split(',').map((s) => s.trim()).filter(Boolean) : null)
    || (rankUrl ? [rankUrl, ...DEFAULT_RANK_URLS.filter((u) => u !== rankUrl)] : DEFAULT_RANK_URLS)).slice();
  // 动态次序：rank.json 把**实测最快**的源排在前面。只在**已配置的源**里取（不引入未知 id），
  // 取不到/没有合格条目就沿用静态 order——排名是优化，不是依赖。
  // rankCheckedAt = 上一次**尝试**的时间（成功、无合格条目、失败都算），TTL 一视同仁：否则「没有合格条目」
  // 会让 ranked 保持 null，而 effective() 的 `!ranked` 判断就会变成「每个请求都去 fetch 一次」。
  let ranked = null, rankCheckedAt = 0, inflight = null, rankState = { at: null, ok: null };
  /**
   * 私有数据集的鉴权。魔搭的 Web API **不认** `Authorization: Bearer <ms-token>`（实测 404/403），
   * 要先拿 token 换会话 cookie（`POST /api/v1/login`）。容器里的 token 由平台环境变量
   * `MODELSCOPE_API_TOKEN` 提供；换到就缓存，失败就退回匿名（匿名仍能读公开门牌，不会更糟）。
   *
   * 只对 modelscope.cn 的 URL 生效，且只影响**服务端自己发起的**请求（rank.json）。
   * 边缘给客户端发的 302 不带凭据，所以私有数据集永远不进默认 302 目标——那是 sources.json 的事。
   */
  const MS_TOKEN = process.env.MODELSCOPE_API_TOKEN || '';
  const MS_LOGIN_URL = 'https://www.modelscope.cn/api/v1/login';
  const MS_COOKIE_TTL_MS = 20 * 60 * 1000;
  let msCookie = null, msCookieAt = 0, msCookieInflight = null;

  function isModelscopeUrl(u) {
    try { return new URL(u).hostname.endsWith('modelscope.cn'); } catch { return false; }
  }

  async function modelscopeCookie() {
    if (!MS_TOKEN) return null;
    if (msCookie && Date.now() - msCookieAt < MS_COOKIE_TTL_MS) return msCookie;
    if (msCookieInflight) return msCookieInflight;
    msCookieInflight = (async () => {
      try {
        const res = await fetchImpl(MS_LOGIN_URL, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ AccessToken: MS_TOKEN }),
          signal: AbortSignal.timeout(RANK_TIMEOUT_MS),
        });
        if (!res.ok) return null;
        const setCookie = res.headers?.getSetCookie?.() || [];
        if (!setCookie.length) return null;
        msCookie = setCookie.map((c) => String(c).split(';')[0]).join('; ');
        msCookieAt = Date.now();
        return msCookie;
      } catch { return null; }
      finally { msCookieInflight = null; }
    })();
    return msCookieInflight;
  }

  /** 按序试每个门牌，返回第一个**解析成功**的（HTTP 非 2xx 与网络错都算这一路失败）。 */
  async function fetchRank() {
    let last = null;
    for (const u of urls) {
      if (!u) continue;
      try {
        const cookie = isModelscopeUrl(u) ? await modelscopeCookie() : null;
        const res = await fetchImpl(u, {
          signal: AbortSignal.timeout(RANK_TIMEOUT_MS),
          ...(cookie ? { headers: { cookie } } : {}),
        });
        if (!res.ok) { last = `HTTP ${res.status} @ ${u}`; continue; }
        const doc = await res.json();
        return { url: u, doc };
      } catch (e) { last = `${e?.message || e} @ ${u}`; }
    }
    throw new Error(last || 'no rank url configured');
  }
  /**
   * rank 文档 → 生效顺序。**头部只放合格集**（见 rankQualified），已配置但未实测的源按静态 order 接在尾部。
   * 没有任何合格条目 ⇒ 返回 null（不动 order）：宁可承认「没有测速结论」，也不把登记顺序当结论。
   */
  function applyRank(doc) {
    const rows = Array.isArray(doc?.rank) ? doc.rank : [];
    const head = [];
    // `config.byId.has(id)` 是**安全属性**，不能放宽：rank 是外部可写数据，照单全收会把玩家 302 到
    // 这份 sources.json 里根本没配过（因而没做过路径白名单校验）的源。真正的问题不是门槛本身，
    // 而是旧实现把「门槛拦下」与「本来就没有合格条目」混成同一种 null 结果，日志里都写成
    // 「no measured/usable entry」——排查时会误判成 rank 生成器坏了。这里把两种原因分开记录。
    const unmapped = [];   // 合格、但映射后的 id 不在本机源表里（配置漂移，需要改 RANK_ID_MAP 或 sources.json）
    const skipped = [];    // 合格、但被 RANK_ID_MAP 显式映射成 null（有意为之，如 ms-edge 是本容器自己）
    for (const r of rows) {
      if (!rankQualified(r)) continue;
      const id = Object.prototype.hasOwnProperty.call(RANK_ID_MAP, r.id) ? RANK_ID_MAP[r.id] : r.id;
      if (id === null || id === undefined) { skipped.push(r.id); continue; }
      if (typeof id === 'string' && id && !head.includes(id)) {
        if (config.byId.has(id)) head.push(id);
        else unmapped.push(`${r.id}→${id}`);
      }
    }
    if (!head.length) return { empty: true, unmapped, skipped };
    if (String(process.env.SP_RANK_ORDER || 'off') !== 'on') return { head, order: config.order.slice(), unmapped, skipped, informational: true };
    const tail = config.order.filter((id) => !head.includes(id));
    return { head, order: [...head, ...tail], unmapped, skipped };
  }
  function refresh() {
    if (inflight || !urls.length || !fetchImpl) return;
    inflight = (async () => {
      try {
        const { url, doc } = await fetchRank();
        const applied = applyRank(doc);
        if (!applied.empty) {
          ranked = applied.order;
          rankState = { at: new Date().toISOString(), ok: true, url, qualified: applied.head, order: [...ranked], unmapped: applied.unmapped, skipped: applied.skipped };
          log.info?.(`[http] asset jump: rank(${url}) qualified=[${applied.head.join(',')}] → ${ranked.join(' > ')}`);
        } else {
          ranked = null;
          const why = applied.unmapped.length
            ? `rank entries not in sources.json: ${applied.unmapped.join(', ')}`
            : (applied.skipped.length ? `all qualified entries mapped away: ${applied.skipped.join(', ')}` : 'no qualified (measured/usable/full) entry in rank');
          rankState = { at: new Date().toISOString(), ok: true, url, qualified: [], order: [...config.order], note: why };
          log.warn?.(`[http] asset jump: rank unusable — ${why} — keeping the static order`);
        }
      } catch (e) {
        rankState = { at: new Date().toISOString(), ok: false, error: String(e?.message || e) };
        log.warn?.(`[http] asset jump: rank unavailable (${e?.message || e}) — using the static order`);
      } finally { rankCheckedAt = Date.now(); inflight = null; }
    })();
  }
  /** 同步返回当前有效配置（后台按 TTL 刷新）：请求路径上永不等待网络。 */
  const effective = () => {
    if (Date.now() - rankCheckedAt >= RANK_TTL_MS) refresh();
    let order = ranked ?? config.order;
    if (probeLeads) {
      // 容器实测序（至少两个源测成功才有意义）插到最前，其余保持原相对顺序。
      const measured = speedProbe.measuredOrder().filter((id) => config.byId.has(id));
      if (measured.length > 1) order = [...measured, ...order.filter((id) => !measured.includes(id))];
    }
    return { ...config, order };
  };
  refresh();   // 启动即预热

  // ---- 存在性缓存：让 302 尽量不落到「还没有这个文件的镜像」上 -------------------------------------------
  // 跳转本身是同步的（static.js 直接调用），所以这里不阻塞：只信缓存里已知的「缺件」，未命中就先按既有顺序
  // 跳出去，同时对刚选中的源做一次 HEAD，把结果写进缓存（TTL 10 分钟）。⇒ 第一个请求可能仍打到缺件源，
  // 后续请求会自动避开；同步补齐（如刚上传的场景素材）在一个 TTL 之后自动恢复。
  const EXIST_TTL_MS = 10 * 60_000;
  const EXIST_MAX = 5000;
  // 边缘层快照：nginx 把 /assets|fonts/** 交给侧车（deploy/stardust/ms-edge/edge-sidecar.mjs），
  // 侧车不自己探测，只读这里写出的结论 —— 探测逻辑只有一份，不会两边漂移。
  const SNAPSHOT_PATH = process.env.SP_EDGE_SNAPSHOT
    || (process.env.TMPDIR || process.env.TEMP || '/tmp') + '/sp-asset-state.json';
  const publishSnapshot = () => {
    try {
      const down = [], dead = [], miss = [];
      for (const [id, v] of health) {
        if (v && v.v === 'down' && Date.now() - v.at < HEALTH_TTL_MS) { down.push(id); if (v.structural === true) dead.push(id); }
      }
      for (const [key, e] of exists) if (e && e.v === 'miss' && Date.now() - e.at < EXIST_TTL_MS) miss.push(key);
      const tmp = `${SNAPSHOT_PATH}.${process.pid}.tmp`;
      fsSync.writeFileSync(tmp, JSON.stringify({ down, dead, miss, at: Date.now() }));
      fsSync.renameSync(tmp, SNAPSHOT_PATH);
    } catch { /* 快照不可写不影响进程内跳转 */ }
  };
  const snapshotTimer = setInterval(publishSnapshot, 5000);
  snapshotTimer?.unref?.();
  const exists = new Map();            // key = 源 id + '\n' + 路径 → { v: 'ok' | 'miss' | null, at }
  const existProbing = new Set();
  const existKey = (id, pathname) => id + '\n' + pathname;
  const knownMiss = (id, pathname) => {
    const e = exists.get(existKey(id, pathname));
    return !!e && e.v === 'miss' && Date.now() - e.at < EXIST_TTL_MS;
  };
  const noteExist = (id, pathname, v) => {
    if (exists.size >= EXIST_MAX) { const first = exists.keys().next().value; if (first !== undefined) exists.delete(first); }
    exists.set(existKey(id, pathname), { v, at: Date.now() });
  };
  /**
   * 对一个 (源, 路径) 做一次 HEAD：2xx/3xx=有（镜像自己再跳也算能供），404=没有，其余=未知（不缓存结论）。
   * **403 不是「没有」**：Cloudflare 前置的镜像（weishucdn）对数据中心 IP / 限速 / 机器人判定都可能回 403，
   * 而玩家的浏览器取同一个文件是 200。把 403 记成 miss 会让整条 302 顺延链在 10 分钟内跳过这个源，
   * 实测表现为「第一次 302 到 r2、下一次同一个文件 404」——地图 scene.bin 的间歇性 404 就是这么来的。
   */
  const probeExist = (id, base, pathname, query) => {
    const key = existKey(id, pathname);
    if (existProbing.has(key) || !base) return;
    existProbing.add(key);
    const rest = stripSourceParam(query || '');
    const target = base + pathname + (rest ? `?${rest}` : '');
    Promise.resolve()
      .then(async () => (isModelscopeUrl(target) ? await modelscopeCookie() : null))
      .then((ck) => fetchImpl(target, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(5000), headers: ck ? { Cookie: ck } : {} }))
      .then((r) => noteExist(id, pathname, r.status < 400 ? 'ok' : (r.status === 404 ? 'miss' : null)))
      .catch(() => noteExist(id, pathname, null))
      .finally(() => existProbing.delete(key));
  };

  // ---- 源健康缓存：让 302 顺延到「下一个还能用的源」 -----------------------------------------------------
  // 与存在性缓存**正交**，别混成一个：这里只回答「这个源现在通不通」，不管它有没有某个文件。
  //   status < 400（**含 403/404**）    = 通（域名/节点活着；缺某个文件是存在性缓存的事，在这判 down 会误杀
  //                                     一个只是缺某文件的镜像）
  //   status >= 500 / 网络错 / 超时     = 不通 → 本轮不进候选，302 顺延到下一个源
  // **不做「太慢就降权」**：延迟阈值随网络抖动来回翻，会把 302 变成抖动源；ms 只记录、供诊断。
  const HEALTH_INTERVAL_MS = healthIntervalMs;
  const HEALTH_TTL_MS = Number(process.env.SP_ASSET_HEALTH_TTL_MS || 3 * 60_000);
  const HEALTH_PATH = process.env.SP_ASSET_HEALTH_PATH || '/assets/char/avatar/char_003_kalts.png';
  const HEALTH_TIMEOUT_MS = 4000;
  const health = new Map();          // 源 id → { v: 'ok' | 'down', at, ms, status|error }
  // 连续失败计数：一次探测抖动不该把整源降级（会把玩家推到覆盖不全的镜像上，造成素材 404）。
  const HEALTH_STRIKES = Math.max(1, Number(process.env.SP_ASSET_HEALTH_STRIKES || 1));
  const healthStrikes = new Map();
  const healthProbing = new Set();
  let healthSkips = 0;
  const knownDead = (id) => { const h = health.get(id); return !!h && h.structural === true && Date.now() - h.at < HEALTH_TTL_MS; };
  const knownDown = (id) => {
    const h = health.get(id);
    return !!h && h.v === 'down' && Date.now() - h.at < HEALTH_TTL_MS;
  };
  /** 对**固定健康路径**做一次 HEAD（可达性判定，口径见上）。可 await（诊断/测试用），也可 fire-and-forget。 */
  const probeHealth = (id, base) => {
    if (healthProbing.has(id) || !base || !fetchImpl) return Promise.resolve(health.get(id) ?? null);
    healthProbing.add(id);
    const t0 = Date.now();
    return Promise.resolve()
      .then(async () => (isModelscopeUrl(base) ? await modelscopeCookie() : null))
      .then((ck) => fetchImpl(base + HEALTH_PATH, { method: 'HEAD', redirect: 'manual', signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS), headers: ck ? { Cookie: ck } : {} }))
      .then((r) => {
        // 判据以本段上方的注释为准：**任何 HTTP 应答**都说明这个源活着；只有 5xx / 网络错 / 超时才判 down。
        // 403 是 Cloudflare 前置对数据中心 IP 的机器人/限速规则（实测：容器的 HEAD 403，玩家浏览器 GET 200），
        // 404 是「这个文件它没有」，两者都不该把整个源踢出 302 顺延链 —— 否则玩家看到的就是 scene.bin 全 404。
        const reachable = r.status < 500 && r.status !== 429;
        if (reachable) healthStrikes.set(id, 0);
        const strikes = reachable ? 0 : (healthStrikes.get(id) || 0) + 1;
        if (!reachable) healthStrikes.set(id, strikes);
        const structural = r.status >= 400 && r.status < 500;
        const v = { v: reachable ? 'ok' : (strikes >= HEALTH_STRIKES ? 'down' : 'unknown'), at: Date.now(), ms: Date.now() - t0, status: r.status, strikes, structural };
        health.set(id, v);
        if (v.v === 'down') log.warn?.(`[http] asset jump: source ${id} answered ${r.status} on ${HEALTH_PATH} — the next source will be used`);
        return v;
      })
      .catch((e) => {
        const strikes = (healthStrikes.get(id) || 0) + 1;
        healthStrikes.set(id, strikes);
        const down = strikes >= HEALTH_STRIKES;
        const v = { v: down ? 'down' : 'unknown', at: Date.now(), ms: Date.now() - t0, error: String(e?.message || e).slice(0, 80), strikes, structural: false };
        health.set(id, v);
        log.warn?.(`[http] asset jump: source ${id} unreachable (${v.error}) — ${down ? 'the next source will be used' : `strike ${strikes}/${HEALTH_STRIKES}, still tried once more`}`);
        return v;
      })
      .finally(() => healthProbing.delete(id));
  };
  // 常驻循环（与 server/upstreamWatch.js 同一范式）：每轮探**所有已配置源**，所以一个源挂掉/恢复都会在
  // 一个间隔内被发现，不需要任何 GitHub/CF 定时器。`unref()` 保证它不吊住进程退出（测试友好）。
  const healthTimer = HEALTH_INTERVAL_MS > 0
    ? setInterval(() => { for (const id of config.order) probeHealth(id, config.byId.get(id)); }, HEALTH_INTERVAL_MS)
    : null;
  healthTimer?.unref?.();
  if (healthTimer) for (const id of config.order) probeHealth(id, config.byId.get(id));   // 启动即预热

  // ---- 容器视角的测速（实测证据；默认只报告，不掌舵）----------------------------------------------------
  // 源集合**只来自 sources.json 的已配置源**；抽样池**只来自随服务发布的素材清单**
  // （data/assets.json 里的相对路径）—— 两边都不接受任何外部传入的 URL（否则这个端点就是一台扫描器）。
  const probePaths = loadProbePaths(fs, path, ROOT, log);
  const speedProbe = createMirrorProbe({
    sources: config.order.map((id) => ({ id, base: config.byId.get(id) })),
    paths: probePaths, fetchImpl, log, intervalMs: probeIntervalMs,
  });
  log.info?.(`[http] asset jump: speed probe — ${speedProbe.poolSize()} sample paths from data/assets.json`);

  /**
   * 顺延链的最后一跳：给定源 id，返回**指向同一路径**的后备绝对地址（复用 decide 的同一套实现，
   * 靠 `?sp_source=<id>` 点名 —— 不在这里另写一份拼 URL 的规则）。取不到就返回 null。
   */
  const altUrl = (conf, id, pathname, query) => {
    const q = new URLSearchParams(query || '');
    q.set('sp_source', id);
    const out = decide(conf, { method: 'GET', pathname, query: q.toString() });
    return out.status === 302 && out.location ? out.location : null;
  };
  /** 取（可能被 rank 覆盖过 order 的）当前配置：static.js 在每次请求前 await 一次，命中缓存时是零成本。 */
  const decideJump = (pathname, query, method, cfg = null, extraSkip = null) => {
    const conf = cfg || config;
    const order = Array.isArray(conf.order) ? conf.order : [];
    // 两条剔除线：①「这个源没有这个文件」（存在性）②「这个源现在不可达」（健康，本轮新增）。
    const down = order.filter((id) => knownDown(id));
    const skip = new Set(order.filter((id) => knownMiss(id, pathname)));
    for (const id of down) skip.add(id);
    // 本次请求里已经证实缺件的源：同一次请求内立刻顺延，不等存在性缓存下一轮刷新
    // （私有数据集 resolve 的 404 是**当场**就能看见的，玩家不能等 60 s）。
    if (extraSkip) for (const id of extraSkip) skip.add(id);
    // 点名一个**已知不可达**的源，等于点名到一个死链 —— 这时把点名降级为"偏好"：按顺序顺延，
    // 而不是照办给玩家一个打不开的地址。（点名一个只是缺这个文件的源，仍然照办。）
    let q = query;
    if (query && down.length) {
      const named = new URLSearchParams(query).get('sp_source');
      if (named && down.includes(named)) {
        q = stripSourceParam(query);
        log.info?.(`[http] asset jump: named source ${named} is unreachable — falling through by order`);
      }
    }
    let out = decide(conf, { method, pathname, query: q, skip: skip.size ? skip : null });
    // 全部候选都被剔除（缺件 / 不可达）→ 退回不带 skip 的主源兜底（给客户 302 比给 404 好），并让缓存继续刷新
    if (out.status !== 302 && skip.size) { const dead = new Set(order.filter((id) => knownDead(id))); out = decide(conf, { method, pathname, query: q, skip: dead.size ? dead : null }); }
    if (out.status !== 302) return null;
    const chosen = order.find((id) => conf.byId.get(id) && String(out.location).startsWith(conf.byId.get(id)));
    if (chosen) probeExist(chosen, conf.byId.get(chosen), pathname, query);
    if (down.length) {
      healthSkips += down.length;
      log.info?.(`[http] asset jump: skip(health) ${down.join(',')} → ${chosen || out.location}`);
    }
    // 后备清单（客户端侧的顺延）：生效顺序去掉已选中的、去掉已知不可达的，最多 3 条。
    // 标准 `Link: rel="alternate"` + 一个傻瓜头（我们的 pick.js / APK 更容易直接读），两头都给；
    // 不解析这两个头的客户端完全不受影响。
    const headers = { ...out.headers };
    const alts = order
      .filter((id) => id !== chosen && !down.includes(id) && conf.byId.get(id))
      .slice(0, 3)
      .map((id) => altUrl(conf, id, pathname, query))
      .filter(Boolean);
    if (alts.length) {
      headers.Link = alts.map((u) => `<${u}>; rel="alternate"`).join(', ');
      headers['X-SP-Fallbacks'] = alts.join(',');
    }
    return { status: out.status, headers };
  };
  // ---- 私有数据集的签名直链 ------------------------------------------------------------------------
  // 私有数据集上，sources.json 里的基址只对**持会话的一方**有效：匿名浏览器拿到的就是 404。
  // 这里在容器内追一次 resolve（带会话），拿它 302 出来的 cdn-lfs 地址（带 auth_key，自足），
  // 玩家拿这条直链取字节 —— 数据集保持私有，字节仍然不经过容器。
  const SIGNED_TTL_MS = Number(process.env.SP_ASSET_SIGNED_TTL_MS || 60_000);
  const SIGNED_MAX = 4096;
  /** A dataset file the resolve answers inline is proxied instead of redirected; only small tables need this. */
  const INLINE_MAX_BYTES = 1024 * 1024;
  const signedCache = new Map();
  const signedInflight = new Map();
  const signedFor = (target) => {
    const hit = signedCache.get(target);
    if (hit && Date.now() - hit.at < SIGNED_TTL_MS) return Promise.resolve(hit.body ? { body: hit.body, type: hit.type } : { url: hit.url });
    const running = signedInflight.get(target);
    if (running) return running;
    const p = (async () => {
      try {
        const ck = isModelscopeUrl(target) ? await modelscopeCookie() : null;
        const r = await fetchImpl(target, {
          method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(6000),
          headers: ck ? { Cookie: ck } : {},
        });
        const loc = r && r.headers && typeof r.headers.get === 'function' ? r.headers.get('location') : null;
        if (r.status >= 300 && r.status < 400 && loc) {
          if (signedCache.size >= SIGNED_MAX) { const first = signedCache.keys().next().value; if (first !== undefined) signedCache.delete(first); }
          signedCache.set(target, { url: loc, at: Date.now() });
          return { url: loc };
        }
        // 200 = 小文件被数据集**内联**返回（没有 302 可跟）。这条 URL 匿名浏览器读不了（私有数据集），
        // 所以由容器自己把字节转发出去。上限 1 MB：棋盘 tiles.json（8.7 KB）这类表都在这个量级。
        if (r.status < 300) {
          const type = (r.headers && typeof r.headers.get === 'function' ? r.headers.get('content-type') : null) || 'application/octet-stream';
          const buf = Buffer.from(await r.arrayBuffer());
          if (buf.length <= INLINE_MAX_BYTES) {
            if (signedCache.size >= SIGNED_MAX) { const first = signedCache.keys().next().value; if (first !== undefined) signedCache.delete(first); }
            signedCache.set(target, { body: buf, type, at: Date.now() });
            return { body: buf, type };
          }
          return null;
        }
        return null;
      } catch { return null; }
    })().finally(() => signedInflight.delete(target));
    signedInflight.set(target, p);
    return p;
  };

  const jump = async (pathname, query, method, cfg = null) => {
    const conf = cfg || config;
    const order = Array.isArray(conf.order) ? conf.order : [];
    // 私有数据集不是逐字节完整的：resolve 追进去才知道某一跳 404（实测 scene.bin、部分皮肤图）。
    // 这层必须**当场顺延**到下一个源（r2/weishucdn），而不是把那条匿名读不了的 302 交给玩家。
    // 每一轮把「已证实缺件」的源加进 skip，最多试完 order。
    const tried = new Set();
    let q = query;
    for (let i = 0; i < Math.max(1, order.length); i++) {
      const out = decideJump(pathname, q, method, cfg, tried.size ? tried : null);
      if (!out || out.status !== 302) return out;
      const loc = out.location || (out.headers && out.headers.Location);
      if (!loc || !isModelscopeUrl(loc)) return out;
      const resolved = await signedFor(loc);
      if (resolved && resolved.body) {
        // 数据集内联返回的文件：容器把字节转发给玩家（原 URL 匿名读不了）
        return { status: 200, headers: { 'Content-Type': resolved.type, 'Cache-Control': 'private, max-age=60', 'Content-Length': String(resolved.body.length) }, body: resolved.body };
      }
      if (resolved && resolved.url) {
        out.location = resolved.url;
        out.headers.Location = resolved.url;
        // 直链带 auth_key：别让浏览器把这条 302 缓存到它过期之后
        out.headers['Cache-Control'] = 'private, max-age=60';
        return out;
      }
      const chosen = order.find((id) => conf.byId.get(id) === out.source) || 'modelscope';
      noteExist(chosen, pathname, 'miss');
      tried.add(chosen);
      // 点名（?sp_source=）在缺件后必须让位：否则顺延又被同一个名字拉回去，来回空转。
      q = stripSourceParam(q);
      log.warn?.(`[http] asset jump: ${pathname} has no signed url on ${chosen} — trying the next source`);
    }
    return null;
  };

  /** 诊断用：存在性缓存的规模与其中「已判缺件」的条数（/sp-edge/status 会带上）。 */
  jump.exists = () => ({ size: exists.size, known: [...exists.values()].filter((e) => e.v === 'miss').length });
  /** 诊断用：每个源的健康判定 + 因为健康被顺延掉的次数（/sp-edge/status 会带上）。 */
  jump.health = () => ({
    sources: Object.fromEntries([...health].map(([id, v]) => [id, { ...v }])),
    byHealth: healthSkips,
    cfg: { intervalMs: HEALTH_INTERVAL_MS, ttlMs: HEALTH_TTL_MS, path: HEALTH_PATH },
  });
  /** 立刻把测速跑一轮并等到结果（线上排查/测试用；正常请求路径不需要它）。 */
  jump.checkProbe = async () => speedProbe.refresh();
  jump.probe = () => ({ ...speedProbe.state(), leads: probeLeads });
  /** 立刻把所有源探一遍并等到结果（线上排查/测试用；正常请求路径不需要它）。 */
  jump.checkHealth = async () => {
    await Promise.all(config.order.map((id) => probeHealth(id, config.byId.get(id))));
    return jump.health();
  };
  jump.config = effective;

  /**
   * C 方案（2026-10-22）：/cdn/v1/** 动态清单的路由器 —— 同一棵数据集（sources.json 的 `interfaceBase`），
   * 但走**容器代理**而不是 302：清单是私有数据集，匿名 302 玩家读不了。
   * 路径白名单收紧到 `/cdn/v1/<名>[.<ext>]`：拒绝穿越、拒绝子目录，绝不把这条代理变成开放读文件入口。
   * 字节经过容器，所以自带 60 s 小缓存（≤CAP 条 × SP_INTERFACE_MAX_BYTES，默认 8 MB）；
   * 大文件（index.json 4.4 MB）也在这里放得下，`signedFor` 那条 1 MB 内联线不适用。
   */
  const INTERFACE_PATH = /^\/cdn\/v1\/[A-Za-z0-9_.[-]{1,80}$/;
  const INTERFACE_MAX_BYTES = Number(process.env.SP_INTERFACE_MAX_BYTES || 8 * 1024 * 1024);
  const INTERFACE_CACHE_TTL_MS = Number(process.env.SP_INTERFACE_CACHE_MS || 60_000);
  const ifaceCache = new Map();
  const ifaceInflight = new Map();
  jump.interface = async (pathname, method) => {
    if (!INTERFACE_PATH.test(pathname) || (method !== 'GET' && method !== 'HEAD')) return null;
    const base = config.interfaceBase;
    if (!base) return null;
    const target = base + pathname;
    const hit = ifaceCache.get(target);
    if (hit && Date.now() - hit.at < INTERFACE_CACHE_TTL_MS) {
      return { status: 200, headers: { 'Content-Type': hit.type, 'Cache-Control': `public, max-age=${Math.floor(INTERFACE_CACHE_TTL_MS / 1000)}`, 'Content-Length': String(hit.body.length), 'Access-Control-Allow-Origin': '*', 'X-SP-Interface': 'cache' }, body: method === 'HEAD' ? undefined : hit.body };
    }
    const running = ifaceInflight.get(target);
    if (running) return running;
    const p = (async () => {
      try {
        const ck = await modelscopeCookie();
        const r = await fetchImpl(target, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(20_000), headers: ck ? { Cookie: ck } : {} });
        if (!r.ok) return null;
        if (method === 'HEAD') {
          return { status: 200, headers: { 'Content-Type': r.headers.get('content-type') || 'application/octet-stream', 'Cache-Control': `public, max-age=${Math.floor(INTERFACE_CACHE_TTL_MS / 1000)}`, 'Access-Control-Allow-Origin': '*' } };
        }
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > INTERFACE_MAX_BYTES) return null;
        const type = r.headers.get('content-type') || (/\.json$/.test(pathname) ? 'application/json' : 'application/octet-stream');
        if (ifaceCache.size >= 8) { const first = ifaceCache.keys().next().value; if (first !== undefined) ifaceCache.delete(first); }
        ifaceCache.set(target, { body: buf, type, at: Date.now() });
        return { status: 200, headers: { 'Content-Type': type, 'Cache-Control': `public, max-age=${Math.floor(INTERFACE_CACHE_TTL_MS / 1000)}`, 'Content-Length': String(buf.length), 'Access-Control-Allow-Origin': '*', 'X-SP-Interface': 'fetch' }, body: buf };
      } catch { return null; }
      finally { ifaceInflight.delete(target); }
    })();
    ifaceInflight.set(target, p);
    return p;
  };

  /**
   * Read-only status for the deployment's own diagnostics: what the jump knows (sources, rank) and, on demand, a
   * HEAD probe of the first source and of the upstream (so an operator can tell what this container can reach).
   * Never throws; probe failures are reported as data.
   */
  jump.status = async ({ probe = false, probeUrl = 'https://github.com/sgangs/Stronghold-Protocol/releases.atom' } = {}) => {
    const out = {
      order: effective().order,
      sources: effective().order.map((id) => ({ id, base: config.byId.get(id) })),
      rankUrls: [...urls], rank: rankState,
      jumpEnabled: true, sourcesPath,
      // 存在性缓存：size = 记录条数，known = 其中已判「该源没有这个文件」的条数（302 会避开这些源）
      exists: typeof jump.exists === 'function' ? jump.exists() : null,
      // 源健康：每个源当前通不通，以及因为健康被顺延掉的次数（byHealth）
      health: typeof jump.health === 'function' ? jump.health() : null,
      // 容器视角测速：逐源 TTFB/吞吐（EWMA 平滑）+ 实测序；leads 表示是否让实测序掌舵
      probe: { ...speedProbe.state(), leads: probeLeads },
    };
    if (!probe) return out;
    const head = async (u) => {
      const t0 = Date.now();
      try {
        const r = await fetchImpl(u, { method: 'HEAD', signal: AbortSignal.timeout(6000) });
        return { url: u, status: r.status, ms: Date.now() - t0 };
      } catch (e) { return { url: u, error: String(e?.message || e), ms: Date.now() - t0 }; }
    };
    // Fixed probe list (never a caller-supplied URL: this endpoint must not be an SSRF pivot): every configured
    // source's avatar, plus the upstream endpoints a listener would need.
    const targets = [
      ...effective().order.map((id) => config.byId.get(id) + '/assets/char/avatar/char_003_kalts.png'),
      probeUrl,
      'https://github.com/sganggs/Stronghold-Protocol/releases',
      'https://raw.githubusercontent.com/sganggs/Stronghold-Protocol/master/package.json',
      'https://ghfast.top/https://raw.githubusercontent.com/sganggs/Stronghold-Protocol/master/package.json',
      'https://api.github.com/repos/sganggs/Stronghold-Protocol',
      'https://api.github.com/repos/sganggs/Stronghold-Protocol/releases/latest',
    ];
    out.probes = await Promise.all([...new Set(targets)].map(head));
    return out;
  };
  return jump;
}

// call the publisher once at module init so a snapshot exists before any request
if (typeof publishSnapshot === 'function') publishSnapshot();
if (typeof snapshotTimer !== 'undefined' && snapshotTimer) { void snapshotTimer; }

/**
 * 本门牌会把浏览器 302 去的源（CSP 需要放行的 img-src / media-src）。
 * 由 config/sources.json 的 base 与 redirects 推出；读不到就返回空数组（CSP 保持最严）。
 */
export function cspOrigins(sourcesPath = DEFAULT_SOURCES_PATH) {
  try {
    const conf = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
    const out = new Set();
    for (const src of Array.isArray(conf.sources) ? conf.sources : []) {
      for (const u of [src.base, ...(Array.isArray(src.redirects) ? src.redirects : [])]) {
        if (typeof u !== 'string' || !u) continue;
        try { const o = new URL(u).origin; if (o.startsWith('https://')) out.add(o); } catch { /* 相对/坏 URL 跳过 */ }
      }
    }
    if (typeof conf.interfaceBase === 'string') { try { out.add(new URL(conf.interfaceBase).origin); } catch {} }
    return [...out];
  } catch { return []; }
}
