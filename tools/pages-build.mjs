// tools/pages-build.mjs — 把这一份游戏导出成一个纯静态目录：CDN / GitHub Pages 直接下发，不跑任何服务器。
//
// 为什么能这样：「本机独立模拟」（plugins/offline-solo + public/js/offline）让页面在没有服务器时
// 自带一整套对局引擎 —— public/js/main.js 开机 HEAD 一次 /healthz，拿不到「真服务器的 JSON」就把
// net 的传输换成页内 loopback，对局跑**真 Match**（本工具导出的 /match/ 那棵树）。界面、引擎、数据
// 全是同一份代码，静态站点上的离线局与联机局同规则。
//
// 导出内容 = 服务器 static.js 挂载表的一份镜像（server/http/static.js createStaticHandler）：
//   public/  → /（排除 public/assets 与 local-assets.json：官方素材不入库，客户端按 DEPLOY.md §6 回落）
//   data/    → /data/（排除 local-*：那是某台机器本机提取的素材清单）
//   shared/  → /shared/
//   server/sim/*.js → /sim/（跳过 nodeData.js：Node-only 加载器，与 SIM_PRIVATE 同一条规则）
//   server/match/*.js → /match/（跳过 host/**：child_process / worker_threads 的 Node-only 传输层）
//   data.js 垫片 → /data.js（逐字节 import 自 server/http/static.js 的 DATA_SHIM_JS：离线 Match 从
//                '../data.js' 引 getConfig / getMode，两份不一致 = 静态站跑不起对局，这里不留第二份真相）
//   plugins/offline-solo/client/** → 同路径覆盖（页内大厅/补传队列随站点分发；clientOverlay 在服务器上
//                是同一件事 —— 导出物与在线页逐路径对齐）
//
// 项目子路径（Pages 默认 /<repo>/）：所有根绝对引用加 base 前缀；ESM 相对 import 的「过深 ..」减一层
// （服务器上 URL 在根被钳制吞掉多余 ..，加了 base 后不吞 —— 参考 himobrine/Stronghold-Protocol-pure-web
// 的 tools/pages-build.mjs 同一处理）。每个 import 都必须落在站点内：落不进去 = 构建失败，不是首屏 404。
//
// Run: node tools/pages-build.mjs [--base /repo] [--out _site] [--no-plugins]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DATA_SHIM_JS } from '../server/http/static.js';
import { maskComments } from './check-imports.mjs';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** 服务器挂载 / 页面会引用的根绝对前缀（server/http/static.js 的 mounts + public/ 的子目录）。 */
const ABS_PREFIXES = ['css', 'js', 'vendor', 'data', 'shared', 'sim', 'match', 'i18n', 'icons', 'fonts',
  'manifest', 'packs', 'assets', 'media', 'studio', 'mods', 'mod', 'cs', 'vs', 'p', 'room-data',
  'workshop-assets', 'workshop-kits', 'workshop-panels', 'workshop-resources', 'workshop-battle', 'dev'];

/** Rewrite `"/prefix…` / `'/prefix…` / backtick / `url(/prefix…` to `${base}/prefix…`. */
function rewriteAbs(text, base) {
  const re = new RegExp(`(["'\`(?:])\\/(${ABS_PREFIXES.join('|')})(?![\\w-])`, 'g');
  return text.replace(re, (m, quote, name) => `${quote}${base}/${name}`);
}

/**
 * 相对 import 爬到站点根之上的少一层：服务器上 `/` 钳制吞掉多余的 `..`（/js/ 的 `../../shared/x` → /shared/x），
 * 加了 base 之后那个 `..` 会逃出错站 —— 每个过深的说明符减一个 `..`。只动真 import/export/import() 的说明符。
 */
function rewriteRel(text, depth) {
  const re = /(\b(?:from|import)\s*\(?\s*)(['"])((?:\.\.\/)+)([^'"]*)\2/g;
  return text.replace(re, (m, head, quote, ups, rest) => {
    const n = ups.length / 3;
    return n > depth ? `${head}${quote}${'../'.repeat(n - 1)}${rest}${quote}` : m;
  });
}

function normalizeUrl(p) {
  const out = [];
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') out.pop();
    else out.push(seg);
  }
  return `/${out.join('/')}`;
}

/** 导出后每个 import 必须仍在站内：漏网 = 构建失败（而不是第一次点开页面才 404）。注释里的示例路径不算 import。 */
function checkEscapes(out, base) {
  const SPEC = /\b(?:from|import)\s*\(?\s*(['"])([^'"]+)\1/g;
  const problems = [];
  for (const file of walk(out)) {
    const rel = path.relative(out, file).split(path.sep).join('/');
    if (rel.startsWith('vendor/') || rel.endsWith('.min.js')) continue;
    if (!/\.(?:js|mjs|html)$/.test(file)) continue;
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';
    const src = maskComments(fs.readFileSync(file, 'utf8')); // doc strings like '/workshop-kits/<pack>/<id>.js?v=…' are not imports
    for (const m of src.matchAll(SPEC)) {
      const spec = m[2];
      let abs;
      if (spec.startsWith('/')) abs = normalizeUrl(spec);
      else if (spec.startsWith('.')) abs = normalizeUrl(`${base}/${dir}/${spec}`);
      else {
        if (/\.\w+$/.test(spec)) problems.push(`${rel}: bare path '${spec}'`);
        continue;
      }
      if (abs !== base && !abs.startsWith(`${base}/`)) problems.push(`${rel}: '${spec}' → ${abs}`);
    }
  }
  return problems;
}

/** 递归拷贝；不用 fs.cpSync：Windows + 非 ASCII 路径下它会在递归里硬死（无 JS 错误、半截输出）。 */
function copyTree(src, dest, keep = () => true) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (!keep(entry.name)) continue;
    const from = path.join(src, entry.name);
    if (entry.isDirectory()) copyTree(from, path.join(dest, entry.name), keep);
    else fs.copyFileSync(from, path.join(dest, entry.name));
  }
}

/** server/sim 或 server/match → out/sim 或 out/match：只带 .js，跳过 Node-only 的加载器与 host/ 传输层。 */
function copyEngineDir(srcDir, destDir, { skipNames = [], skipDirs = [] } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    if (skipNames.includes(entry.name.toLowerCase())) continue;
    const src = path.join(srcDir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs.includes(entry.name.toLowerCase())) continue; // /match/host: never on the wire
      copyEngineDir(src, path.join(destDir, entry.name), { skipNames, skipDirs });
    } else if (entry.name.endsWith('.js')) fs.copyFileSync(src, path.join(destDir, entry.name));
  }
}

function walk(dir, into = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, into);
    else into.push(p);
  }
  return into;
}

function parseArgs(argv) {
  const args = { base: '', out: path.join(ROOT, '_site'), plugins: true };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--base') args.base = argv[++i] || '';
    else if (argv[i] === '--out') args.out = path.resolve(argv[++i]);
    else if (argv[i] === '--no-plugins') args.plugins = false;
    else throw new Error(`pages-build: unknown argument ${argv[i]}`);
  }
  if (args.base && !args.base.startsWith('/')) args.base = `/${args.base}`;
  if (args.base.endsWith('/')) args.base = args.base.slice(0, -1);
  return args;
}

function main() {
  const { base, out, plugins } = parseArgs(process.argv);
  fs.rmSync(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  if (fs.existsSync(out)) throw new Error(`pages-build: cannot remove ${out} (a file is held open?)`);
  fs.mkdirSync(out, { recursive: true });

  // public/ without the game art（never in git; the client falls back, docs/DEPLOY.md §6）
  copyTree(path.join(ROOT, 'public'), out, (name) => name !== 'assets' && name !== 'local-assets.json');
  copyTree(path.join(ROOT, 'shared'), path.join(out, 'shared'));
  copyTree(path.join(ROOT, 'data'), path.join(out, 'data'), (name) => !['local-assets.json', 'local-fx.json'].includes(name));
  // the simulation and the match engine, exactly the way static.js serves them to a page
  copyEngineDir(path.join(ROOT, 'server', 'sim'), path.join(out, 'sim'), { skipNames: ['nodedata.js'] });
  copyEngineDir(path.join(ROOT, 'server', 'match'), path.join(out, 'match'), { skipDirs: ['host'] });
  // the browser stand-in of server/data.js — the server's own bytes (DATA_SHIM_JS), one truth for both shapes
  fs.writeFileSync(path.join(out, 'data.js'), DATA_SHIM_JS);
  fs.writeFileSync(path.join(out, '.nojekyll'), '');

  // 离线模块的插件真源：public/js/offline/ 随 public 拷贝已在站内；这里只补服务器会经 clientOverlay
  // 顶替的那一份语义 —— 把插件 client 文件按相对路径盖进导出树，保证「装了插件的服务器」与「静态站」
  // 服务的是同一字节（不一致 = 两条路径行为漂移，正是本仓双写纪律要防的）。
  if (plugins && fs.existsSync(path.join(ROOT, 'plugins', 'offline-solo', 'client'))) {
    copyTree(path.join(ROOT, 'plugins', 'offline-solo', 'client'), out);
  }

  const TEXT = new Set(['.html', '.js', '.mjs', '.css']);
  let rewritten = 0;
  for (const file of walk(out)) {
    const relParts = path.relative(out, file).split(path.sep);
    if (relParts[0] === 'vendor' || file.endsWith('.min.js')) continue;
    const isManifest = relParts.length === 1 && relParts[0] === 'manifest.json';
    if (!TEXT.has(path.extname(file)) && !isManifest) continue;
    const src = fs.readFileSync(file, 'utf8');
    let dst = src;
    if (base) {
      dst = rewriteAbs(dst, base);
      const depth = Math.max(0, relParts.length - 1);
      dst = rewriteRel(dst, depth);
    }
    if (isManifest && base) {
      const man = JSON.parse(dst);
      man.id = `${base}/`;
      man.start_url = `${base}/`;
      man.scope = `${base}/`;
      dst = `${JSON.stringify(man, null, 2)}\n`;
    }
    if (dst !== src) { fs.writeFileSync(file, dst); rewritten++; }
  }

  if (base) {
    const problems = checkEscapes(out, base);
    if (problems.length) {
      console.error(`pages-build: ${problems.length} import(s) still escape the site:`);
      for (const p of problems) console.error(`  ${p}`);
      throw new Error('pages-build: import escapes (see above)');
    }
  }

  const files = walk(out);
  const bytes = files.reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log(`pages-build: ${files.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB in ${path.relative(ROOT, out) || out}`
    + `${base ? `, base ${base}` : ''} (${rewritten} files rewritten)`);
}

main();
