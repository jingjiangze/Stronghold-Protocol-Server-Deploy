#!/usr/bin/env node
// tools/mota-plugin-pack.mjs — 把魔塔服务器原树打成一个「无损插件」目录。
//
// 无损 = 魔塔源码一个字节都不改：
//   · server/** 与 shared/** 原样复制（只有三个**单例模块**换成再导出桩，见 SINGLETONS）；
//   · 与上游不同的 public/js、public/css 原样复制到 client/（客户端按 /cs/<hash>/… 前缀加载）；
//   · 与上游不同的 data/*.json 原样复制到 data/（宿主在该内容集里原样安装）。
//
// 用法：
//   node tools/mota-plugin-pack.mjs --source <魔塔原树> [--repo <Forge 仓库>] [--base v0.3.1] [--out plugins/mota]

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * 这三个模块是「进程级单例」：宿主在导入 Match 之前已经把内容集的数据装进上游那份，
 * 插件里如果再放一份副本，getData() 会是另一个空单例。桩文件让插件图复用上游同一实例。
 */
const SINGLETONS = [
  'server/data.js',
  'server/match/effectsMeta.js',
  'server/match/dslMeta.js',
];

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

function git(repo, args) {
  const r = spawnSync('git', ['-C', repo, ...args], { maxBuffer: 512 * 1024 * 1024 });
  return r.status === 0 ? r.stdout : null;
}

function walk(root, rel = '', out = []) {
  for (const e of fs.readdirSync(path.join(root, ...rel.split('/').filter(Boolean)), { withFileTypes: true })) {
    const child = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(root, child, out);
    else out.push(child);
  }
  return out;
}

const lf = (buf) => {
  const s = Buffer.from(buf).toString('utf8');
  return Buffer.from(s.includes('\r\n') ? s.split('\r\n').join('\n') : s, 'utf8');
};

function main(argv) {
  const o = { source: null, repo: REPO, base: 'v0.3.0', out: 'plugins/mota' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--source') o.source = path.resolve(argv[++i]);
    else if (a === '--repo') o.repo = path.resolve(argv[++i]);
    else if (a === '--base') o.base = argv[++i];   // 来源自己的基线（不是上游最新），只用来判断「魔塔改过哪些文件」
    else if (a === '--out') o.out = path.resolve(argv[++i]);
    else if (a === '-h' || a === '--help') { console.log('node tools/mota-plugin-pack.mjs --source <tree> [--repo <dir>] [--base v0.3.1] [--out plugins/mota]'); return 0; }
    else throw new Error(`不认识的参数：${a}`);
  }
  if (!o.source) throw new Error('缺 --source');

  const upstreamFile = (rel) => {
    const out = git(o.repo, ['show', `${o.base}:${rel}`]);
    return out ? lf(out) : null;
  };
  const copy = (rel, dstRel = rel) => {
    const dst = path.join(o.out, ...dstRel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(o.source, ...rel.split('/')), dst);
  };

  fs.rmSync(o.out, { recursive: true, force: true });
  fs.mkdirSync(o.out, { recursive: true });

  // 1. 服务端与共享层：原样复制，三个单例换成再导出桩
  let serverFiles = 0;
  for (const rel of walk(o.source, 'server')) {
    if (SINGLETONS.includes(rel)) continue;
    copy(rel); serverFiles++;
  }
  for (const rel of walk(o.source, 'shared')) { copy(rel); serverFiles++; }
  for (const rel of SINGLETONS) {
    // 相对路径：插件目录被拷进任何部署树后都指向那棵树自己的 server/，不绑打包机路径。
    const stubDir = path.join(o.out, ...rel.split('/').slice(0, -1));
    const upstream = path.join(o.repo, ...rel.split('/'));
    let spec = path.relative(stubDir, upstream).split(path.sep).join('/');
    if (!spec.startsWith('.')) spec = `./${spec}`;
    const stub = `// 无损插件桩：复用上游同一份模块实例（数据/元数据是进程级单例）。\nexport * from ${JSON.stringify(spec)};\n`;
    const dst = path.join(o.out, ...rel.split('/'));
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.writeFileSync(dst, stub);
  }

  // 2. 客户端覆盖：只收**魔塔相对自己基线**改过的 js/css（拿最新上游比会把上游自己的演进也算进来）
  const client = [];
  for (const dir of ['public/js', 'public/css']) {
    for (const rel of walk(o.source, dir)) {
      const src = lf(fs.readFileSync(path.join(o.source, ...rel.split('/'))));
      const up = upstreamFile(rel);
      if (up && Buffer.compare(src, up) === 0) continue;
      copy(rel, `client/${rel.replace(/^public\//, '')}`);
      client.push(rel.replace(/^public\//, ''));
    }
  }

  // 3. 数据文件：魔塔相对自己基线改过的整份（宿主在该内容集里原样安装）
  const data = [];
  for (const rel of walk(o.source, 'data')) {
    if (!rel.endsWith('.json')) continue;
    const src = lf(fs.readFileSync(path.join(o.source, ...rel.split('/'))));
    const up = upstreamFile(rel);
    if (up && Buffer.compare(src, up) === 0) continue;
    copy(rel, rel);
    data.push(rel);
  }

  const pkg = JSON.parse(fs.readFileSync(path.join(o.source, 'package.json'), 'utf8'));
  const manifest = {
    manifest: 2,
    id: 'mota',
    name: '魔塔（无损挂载）',
    englishName: 'Mota (lossless mount)',
    description: '把魔塔服务器的原树按内容集挂载：源码不改，功能与 UI 保持原样。',
    version: pkg.version || '0.0.0',
    app: '>=0.3.0 <0.4.0',
    api: 2,
    class: 'trusted',
    scope: ['room'],
    permissions: ['trusted.server'],
    entry: { server: 'host/noop.js' },
    code: { match: 'server/match/Match.js', client, data },
  };
  // trusted 运行时会用 data: URL 加载 entry.server，相对导入在那里解析不了；真正的对局入口走 code.match（内容集宿主）。
  fs.mkdirSync(path.join(o.out, 'host'), { recursive: true });
  fs.writeFileSync(path.join(o.out, 'host/noop.js'), '// 占位：对局入口在 code.match，由内容集宿主导入。\nexport {};\n');
  fs.writeFileSync(path.join(o.out, 'plugin.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const files = walk(o.out).filter((r) => r !== 'plugin.json');
  const total = files.reduce((n, r) => n + fs.statSync(path.join(o.out, ...r.split('/'))).size, 0);
  console.log(`✔ 插件已生成：${o.out}`);
  console.log(`  服务端/共享 ${serverFiles} 个（含 ${SINGLETONS.length} 个单例桩）`);
  console.log(`  客户端覆盖 ${client.length} 个 · 数据 ${data.length} 个`);
  console.log(`  合计 ${files.length} 个文件，${(total / 1048576).toFixed(1)} MB`);
  console.log(`  指纹 ${sha(Buffer.from(JSON.stringify(files.map((r) => [r, sha(fs.readFileSync(path.join(o.out, ...r.split('/'))))])))).slice(0, 16)}`);
  return 0;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invoked) {
  try { process.exit(main(process.argv.slice(2))); } catch (e) { console.error(`✖ ${e.message}`); process.exit(2); }
}
export { main };
