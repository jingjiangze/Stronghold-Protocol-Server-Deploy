// Site policy (DESIGN §32.11). Hash only import maps, never arbitrary inline script. Worker/UI policies are independent.
// worker-src 'self' is the asset service worker at /sw.js. blob: stays for workers the page already creates
// (the simulation worker). Do not add a remote worker origin. SIM_WORKER_CSP is that worker's own policy and
// must not gain the asset worker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// SES evaluates confined code. This relaxation belongs only to the simulation Worker, never its parent document.
export const SIM_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

/**
 * The origins art may be served from today = the asset-jump source table's bases.
 *
 * Why this has to be read, not written here: the policy is emitted once at boot with whatever
 * sources.json says, and the jump layer 302s /assets|/fonts to those very bases. Writing the
 * origins here as well would be a second table that drifts the moment an operator edits one file,
 * and the failure is silent from the server's side — the browser refuses the image, the canvas
 * keeps its placeholder, and the console is the only place it says so (measured 2026-10-16 on
 * the ModelScope deployment: `Refused to load the image 'https://modelscope.cn/.../bkg_01.png'`,
 * while the same URL answers 200 to curl). That is exactly the reported "素材加载不出来".
 *
 * Only origins from the table are admitted, so this cannot become a way to allow arbitrary hosts.
 * Returns [] when the file is absent or unreadable — a policy that cannot read its own inputs
 * stays as tight as it was, rather than failing open.
 *
 * A source's own base is not always where the bytes come from. ModelScope's
 * `/datasets/.../resolve/...` answers 302 and hands off to its LFS edge
 * (`cdn-lfs-cn-1.modelscope.cn`, with an auth_key query). The browser follows both hops, so the
 * request it finally makes — the one CSP judges — is to the LFS host. Allowing only the base
 * still refused every image (measured 2026-10-16: `Refused to load the image
 * 'https://cdn-lfs-cn-1.modelscope.cn/prod/lfs-objects/...'`). `redirects` in the table names
 * each base's extra hops; they are declared, not guessed, and go through the same origin guard.
 */
export function artOrigins(sourcesPath, readFileSync = fs.readFileSync) {
  try {
    const doc = JSON.parse(readFileSync(sourcesPath, 'utf8'));
    if (!doc || !Array.isArray(doc.sources)) return [];
    const out = new Set();
    const admit = (raw) => {
      if (typeof raw !== 'string') return;
      if (!raw.startsWith('https://') || raw.includes('..')) return;   // same guard as parseSources
      try { out.add(new URL(raw).origin); } catch { /* skip an unparsable base */ }
    };
    for (const s of doc.sources) {
      if (!s) continue;
      admit(s.base);
      if (Array.isArray(s.redirects)) for (const r of s.redirects) admit(r);
    }
    return [...out];
  } catch {
    return [];
  }
}

export function siteCsp(publicDir, { sourcesPath } = {}) {
  const hashes = new Set();
  for (const rel of ['index.html', 'studio/index.html', 'studio/console.html', 'dev/game-mock.html', 'dev/render-demo.html', 'dev/battle-perf.html', 'dev/uikit.html']) {
    let html;
    try { html = fs.readFileSync(path.join(publicDir, rel), 'utf8'); } catch { continue; }
    for (const m of html.matchAll(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  const art = sourcesPath ? artOrigins(sourcesPath) : [];
  const artPart = art.length ? ' ' + art.join(' ') : '';
  // Audio is fetched by XHR/fetch, not by an <audio> element, so it is judged by connect-src;
  // it lands on the same 302 chain as the images and was refused for the same reason.
  return `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${artPart}; font-src 'self' https://fonts.gstatic.com${artPart}; img-src 'self' data: blob:${artPart}; connect-src 'self'${artPart}; media-src 'self' blob:${artPart}; worker-src 'self' blob:; frame-src 'self'; object-src 'none'; base-uri 'none'`;
}
