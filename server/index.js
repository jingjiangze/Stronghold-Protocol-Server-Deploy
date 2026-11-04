// server/index.js — 自举入口。
//
// 真正的实现放在 server/boot-main.js，由这里**动态导入**。这样任何**顶层 import 失败**（容器里缺依赖 / 缺文件 /
// 语法不被该 Node 版本支持）都能被捕获并打开一个诊断端口回报原因；否则进程会在 runMain 之前直接退出，
// 容器平台只报 Failed，日志又拿不到（2026-10-26 实测踩过：创空间里启动失败，远程无法定位）。
import { runMain } from './http/boot.js';
import { isProcessEntry } from './http/boot.js';

async function diagPort(e) {
  try {
    const http = await import('node:http');
    const info = {
      ok: false, boot: 'failed', phase: 'import',
      error: String((e && (e.stack || e.message)) || e).slice(0, 4000),
      node: process.version,
      env: { PORT: process.env.PORT || null, HOST: process.env.HOST || null, cwd: process.cwd() },
      at: new Date().toISOString(),
    };
    const body = JSON.stringify(info, null, 2);
    const server = http.createServer((req, res) => {
      res.writeHead(String(req.url || '').startsWith('/healthz') ? 200 : 503, {
        'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
      });
      res.end(body);
    });
    const port = Number(process.env.PORT || 3000);
    const host = process.env.HOST || '0.0.0.0';
    const ok = await new Promise((resolve) => {
      server.once('error', () => resolve(false));
      server.listen(port, host, () => resolve(true));
    });
    if (ok) { console.error('[boot-diag] import failed; diagnostic server up'); return; }
  } catch (e2) { console.error('[boot-diag] cannot open a diagnostic port', e2); }
  process.exit(1);
}

let mod = null;
try {
  mod = await import('./boot-main.js');
} catch (e) {
  console.error('[boot] import failed', e);
  await diagPort(e);
}

// The public API: tests and tools import these from the entry (docs/ARCHITECTURE.md: `startServer() … server/index.js`;
// docs/ENGINE-SURFACE.md names it the same way, and server/boot-main.js is where they live). They are re-exported from
// the namespace the dynamic import above already resolved instead of a static `export … from`, so a top-level import
// failure still reaches diagPort above instead of throwing at link time with no diagnostic port.
export const DATA_SHIM_JS = mod?.DATA_SHIM_JS;
export const acceptsGzip = mod?.acceptsGzip;
export const buildTag = mod?.buildTag;
export const computeBuildTag = mod?.computeBuildTag;
export const createStaticHandler = mod?.createStaticHandler;
export const parseRange = mod?.parseRange;
export const parseTrustProxy = mod?.parseTrustProxy;
export const pickEncoding = mod?.pickEncoding;
export const resetBuildTag = mod?.resetBuildTag;
export const roomCodeFromArgv = mod?.roomCodeFromArgv;
export const startServer = mod?.startServer;

// Only the process entry boots (`node server/index.js`, npm start, the deploy units). Importing the entry — 46 test files
// do — must not bind a port: that would fight the `startServer({ port: 0 })` each test opens, and the tests are the
// reason these symbols are exported at all.
if (isProcessEntry(import.meta.url)) {
  if (mod) mod.main?.();
  else runMain(async () => { throw new Error('boot-main.js did not load'); });
}
