// superbig-gateway — the CF Pages entry for superbig.jiangjiangze.icu.
//
// Page navigations get this site's shell; EVERYTHING else (js/css/vendor/data/assets/fonts/... /ws /healthz /api/*)
// is proxied to the studio byte-for-byte. The Host header is left alone (Cloudflare sets it from the target URL);
// overriding it made the upstream answer with an HTML error page instead of the file.
const ORIGIN = 'https://jingjiangze-stronghold-protocol.ms.show';
const STATIC_PREFIX = /^\/(js|css|vendor|data|assets|fonts|media|icons|packs|shared|schemas)\//;

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const wantsHtml = (req.headers.get('accept') || '').includes('text/html');
    const isStatic = STATIC_PREFIX.test(url.pathname);
    const isApi = url.pathname === '/ws' || url.pathname === '/healthz' || url.pathname.startsWith('/api/');
    if (wantsHtml && !isStatic && !isApi) { const r = await env.ASSETS.fetch(req); const o = new Response(r.body, r); o.headers.set('x-sbg','assets'); return o; }

    const target = new URL(url.pathname + url.search, ORIGIN);
    const init = { method: req.method, headers: req.headers, redirect: 'manual' };
    if (req.method !== 'GET' && req.method !== 'HEAD') init.body = req.body;
    const upstream = await fetch(target, init);
    const out = new Response(upstream.body, upstream);
    out.headers.set('access-control-allow-origin', '*');
    out.headers.set('x-sbg', 'proxy');
    return out;
  },
};
