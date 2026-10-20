// Site policy (DESIGN §32.11). Hash only import maps, never arbitrary inline script. Worker/UI policies are independent.
// worker-src 'self' is the asset service worker at /sw.js. blob: stays for workers the page already creates
// (the simulation worker). Do not add a remote worker origin. SIM_WORKER_CSP is that worker's own policy and
// must not gain the asset worker.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// SES evaluates confined code. This relaxation belongs only to the simulation Worker, never its parent document.
export const SIM_WORKER_CSP = "default-src 'none'; script-src 'self' 'unsafe-eval'; connect-src 'none'";

/** 插件可声明的指令；object-src / base-uri / worker-src 不开放给插件（安全边界）。 */
export const CSP_PLUGIN_DIRECTIVES = Object.freeze(['script', 'style', 'font', 'img', 'media', 'connect', 'frame']);

/**
 * 只收明确的 https 源（或 http://localhost），拒绝 '*'、'unsafe-inline'、'unsafe-eval' 这类放开关键字。
 * 插件能加白名单，但不能把 CSP 关成“任意脚本可执行”。
 */
export function isAllowedCspSource(src) {
  const s = String(src || '').trim();
  if (!s) return false;
  if (/^https:\/\/[a-z0-9.*-]+(:\d{1,5})?(\/[^\s;]*)?$/i.test(s)) return true;
  if (/^http:\/\/localhost(:\d{1,5})?$/i.test(s)) return true;
  return false;
}

/** 合并多个插件的声明；返回 { [directive]: string[] }，去重保序。 */
export function mergeCspSources(declarations) {
  const out = Object.fromEntries(CSP_PLUGIN_DIRECTIVES.map(k => [k, []]));
  for (const spec of declarations) {
    if (!spec || typeof spec !== 'object' || Array.isArray(spec)) continue;
    for (const k of CSP_PLUGIN_DIRECTIVES) {
      const list = Array.isArray(spec[k]) ? spec[k] : [];
      for (const raw of list) {
        if (!isAllowedCspSource(raw)) continue;
        const s = String(raw).trim();
        if (!out[k].includes(s)) out[k].push(s);
      }
    }
  }
  return out;
}

export function siteCsp(publicDir, extra = {}) {
  const hashes = new Set();
  for (const rel of ['index.html', 'studio/index.html', 'studio/console.html', 'dev/game-mock.html', 'dev/render-demo.html', 'dev/battle-perf.html', 'dev/uikit.html']) {
    let html;
    try { html = fs.readFileSync(path.join(publicDir, rel), 'utf8'); } catch { continue; }
    for (const m of html.matchAll(/<script\s+type=["']importmap["']\s*>([\s\S]*?)<\/script>/g)) {
      hashes.add(`'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`);
    }
  }
  // 素材源：这个包是 CDN 版，data/assets.json 与 data/emotes.json 里的 art 直接指向 speedcdn。
  // 不放行的话浏览器会拦掉大厅背景与表情图（CSP 检查的是最终 URL）。
  const ASSET_CDN = 'https://speedcdn.jiangjiangze.icu';
  // 大厅音乐插件：搜索走 Meting 端点，音频/封面由它 302 到网易云 CDN。
  const MUSIC_API = 'https://api.qijieya.cn https://api.injahow.cn https://www.ffapi.cn';
  const MUSIC_CDN = 'https://*.music.126.net https://*.126.net https://*.127.net';
  const more = (k) => (Array.isArray(extra[k]) && extra[k].length ? ' ' + extra[k].join(' ') : '');
  const raw = `default-src 'self'; script-src 'self'${hashes.size ? ' ' + [...hashes].join(' ') : ''}${more('script')}; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com${more('style')}; font-src 'self' https://fonts.gstatic.com${more('font')}; img-src 'self' data: blob: ${ASSET_CDN} ${MUSIC_API} ${MUSIC_CDN}${more('img')}; media-src 'self' blob: ${ASSET_CDN} ${MUSIC_API} ${MUSIC_CDN}${more('media')}; connect-src 'self' ${ASSET_CDN} ${MUSIC_API}${more('connect')}; worker-src 'self' blob:; frame-src 'self'${more('frame')}; object-src 'none'; base-uri 'none'`;
  // 硬编码的默认源与插件声明会重叠：按指令去重（保序），否则响应头里同一个域名出现两次。
  return raw.split(';').map((part) => {
    const [dir, ...tokens] = part.trim().split(/\s+/).filter(Boolean);
    return dir ? [dir, ...new Set(tokens)].join(' ') : '';
  }).filter(Boolean).join('; ');
}
