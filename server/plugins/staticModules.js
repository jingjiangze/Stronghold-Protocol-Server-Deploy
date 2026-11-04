// server/plugins/staticModules.js — 静态层的插件面（2026-10-26）。
//
// 背景：素材 302 门牌（/assets|/fonts|/media 本机缺失时跳 CDN）原本硬写进核心 server/http/asset-jump.js，
// 于是「CDN 指向」这件事必须改核心才能动。这里把它变成插件：manifest 2 的 `code.static` 指向插件里的一个
// ES 模块，导出 `createAssetJump({ log, sourcesPath })`，由本文件在启动时装载。
//
// 边界（与 lobbyModules 同一条安全线）：
//   * 只有 **trusted 且 status==='loaded'**（服主显式启用 + 信任钉命中）的插件会被读；
//   * 模块在**主进程内**执行（它要直接给 HTTP 层返回工厂函数），所以必须 trusted，不能是 script/sandbox；
//   * 只有第一个声明 `code.static` 的插件生效（后加载者不覆盖：避免两个门牌互相打架）；
//   * 任何异常只记日志并返回 null —— 没有门牌时静态层照旧返回 404，不会把服务器拖垮。
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * @param {{ plugins?: () => any[] } | null} registry 插件注册表
 * @param {{ log?: any }} [opts]
 * @returns {Promise<{ assetJump: any | null, from: string | null }>}
 */
export async function createStaticModules(registry, { log = console } = {}) {
  const all = typeof registry?.plugins === 'function' ? registry.plugins() : [];
  const list = all.filter((p) => p && p.status === 'loaded' && p.manifest?.class === 'trusted'
    && p.manifest?.code && typeof p.manifest.code.static === 'string' && p.manifest.code.static);
  for (const p of list) {
    const rel = p.manifest.code.static;
    if (rel.includes('..') || rel.startsWith('/')) { log.warn?.(`[static] ${p.id}: code.static must be a relative path`); continue; }
    const abs = path.join(p.dir, ...rel.split('/'));
    if (!fs.existsSync(abs)) { log.warn?.(`[static] ${p.id}: code.static ${rel} not found`); continue; }
    try {
      const mod = await import(pathToFileURL(abs).href);
      if (typeof mod.createAssetJump !== 'function') { log.warn?.(`[static] ${p.id}: code.static exports no createAssetJump()`); continue; }
      const sourcesPath = path.join(p.dir, 'config', 'sources.json');
      const assetJump = mod.createAssetJump({ log, ...(fs.existsSync(sourcesPath) ? { sourcesPath } : {}) });
      log.info?.(`[static] asset jump from plugin ${p.id} (${rel})`);
      const origins = typeof mod.cspOrigins === 'function' ? (() => { try { return mod.cspOrigins(sourcesPath); } catch { return []; } })() : [];
      return { assetJump, from: p.id, csp: { img: origins, media: origins, connect: origins, style: origins, font: origins } };
    } catch (e) {
      log.error?.(`[static] ${p.id}: code.static failed`, e);
    }
  }
  return { assetJump: null, from: null, csp: { img: [], media: [], connect: [], style: [], font: [] } };
}
