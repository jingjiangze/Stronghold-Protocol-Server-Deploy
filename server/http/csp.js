// Site policy (DESIGN §32.11). Hash only import maps, never arbitrary inline script. Worker/UI policies are independent.
// worker-src 'self' is the asset service worker at /sw.js. blob: stays for workers the page already creates
// (the simulation worker). Do not add a remote worker origin. SIM_WORKER_CSP is that worker's own policy and
// must not gain the asset worker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// SES evaluates confined code. This relaxation belongs only to the simulation Worker, never its parent document.
export const SIM_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

export function siteCsp(publicDir, { sourcesPath = null } = {}) {
  const hashes = new Set();
  for (const rel of ['index.html', 'studio/index.html', 'studio/console.html', 'dev/game-mock.html', 'dev/render-demo.html', 'dev/battle-perf.html', 'dev/uikit.html']) {
    let html;
    try { html = fs.readFileSync(path.join(publicDir, rel), 'utf8'); } catch { continue; }
    for (const m of html.matchAll(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  // 素材门牌的来源要进 CSP，否则浏览器会把 CDN 上的图/字体全拦掉（图不显示、单位不渲染）。
  const art = new Set();
  if (sourcesPath) {
    try {
      const cfg = JSON.parse(fs.readFileSync(sourcesPath, 'utf8'));
      for (const src of cfg.sources || []) for (const u of [src.base, ...(src.redirects || [])]) {
        try { art.add(new URL(u).origin); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }
  }
  const artList = [...art].join(' ');
  return `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com ${artList}; font-src 'self' https://fonts.gstatic.com ${artList}; img-src 'self' data: blob: ${artList}; connect-src 'self' ${artList}; media-src 'self' blob: ${artList}; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'`;
}
