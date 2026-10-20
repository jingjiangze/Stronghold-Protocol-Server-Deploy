#!/usr/bin/env node
// tools/mod.mjs — the mod manager's command line, beside the /mod page. Same two import paths: a Forge pack goes
// through server/plugins/forgeImport.js, a plugin zip through installPluginBytes. Nothing is enabled by an import.
//
//   node tools/mod.mjs import <pack-dir | zip> [--force] [--dry-run]
//   node tools/mod.mjs check  <pack-dir | zip>          (a dry run: writes nothing)
//   node tools/mod.mjs pack   <pack-dir> [-o out.zip]    (a deterministic zip of the folder)
//   node tools/mod.mjs list                             (installed plugin folders)
//   node tools/mod.mjs watch  [inbox-dir]               (install every zip dropped in; Ctrl-C to stop)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { importForge } from '../server/plugins/forgeImport.js';
import { readVanillaAssets } from '../server/plugins/registry.js';
import { zipFiles } from '../server/plugins/zip.js';
import { importArchive } from '../server/mods/import.js';
import { startInbox } from '../server/mods/inbox.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = path.join(ROOT, 'plugins');
const DATA = path.join(ROOT, 'data');
const EXCLUDE = new Set(['.git', 'node_modules', 'dist', '.DS_Store']);

const out = (s = '') => process.stdout.write(`${s}\n`);
const err = (s = '') => process.stderr.write(`${s}\n`);

function parseArgs(argv) {
  const args = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-o' || a === '--out') { flags.out = argv[++i]; continue; }
    if (a.startsWith('--')) { flags[a.slice(2)] = true; continue; }
    args.push(a);
  }
  return { args, flags };
}

/** Every file under `dir`, as `{ name, data }` for zipFiles (sorted by zipFiles itself). */
function readTree(dir, rel = '') {
  const files = [];
  for (const name of fs.readdirSync(path.join(dir, rel))) {
    if (EXCLUDE.has(name) || name.startsWith('.')) continue;
    const next = rel ? `${rel}/${name}` : name;
    const abs = path.join(dir, next);
    const st = fs.lstatSync(abs);
    if (st.isSymbolicLink()) continue;
    if (st.isDirectory()) files.push(...readTree(dir, next));
    else files.push({ name: next, data: fs.readFileSync(abs) });
  }
  return files;
}

const vanilla = () => { try { return readVanillaAssets(DATA); } catch { return null; } };

function report(result) {
  if (result.markdown) out(result.markdown);
  else if (result.ok) out(`ok · ${result.kind || ''}${result.id ? ` ${result.id}` : ''}${result.wrote === false ? '（没有写出）' : ''}`);
  if (!result.ok) { err(`拒绝 · refused: ${result.error || 'IMPORT_FAILED'}${result.detail ? ` — ${result.detail}` : ''}`); return 1; }
  for (const issue of result.issues || []) err(`注意 · ${issue.code}: ${issue.detail}`);
  return 0;
}

/** Import one input (a folder is read as a Forge pack; a zip is sniffed). */
export async function importPath(input, { force = false, dryRun = false } = {}) {
  const abs = path.resolve(input);
  const st = fs.lstatSync(abs);
  if (st.isDirectory()) {
    const r = await importForge(abs, { root: ROOT, pluginsDir: PLUGINS, dataDir: DATA, vanilla: vanilla(), force, dryRun });
    return { kind: 'pack', ...r };
  }
  return importArchive(fs.readFileSync(abs), { root: ROOT, pluginsDir: PLUGINS, dataDir: DATA, vanilla: vanilla(), force, dryRun });
}

function listInstalled() {
  let names = [];
  try { names = fs.readdirSync(PLUGINS); } catch { return []; }
  const rows = [];
  for (const id of names) {
    if (id.startsWith('_') || id.startsWith('.')) continue;
    const abs = path.join(PLUGINS, id);
    try { if (!fs.lstatSync(abs).isDirectory()) continue; } catch { continue; }
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(abs, 'plugin.json'), 'utf8')); } catch { /* not a plugin folder */ }
    if (!manifest && !fs.existsSync(path.join(abs, 'pack.json'))) continue;
    rows.push({ id, name: manifest?.name || id, version: manifest?.version || '', class: manifest?.class || (manifest ? '' : 'forge-raw') });
  }
  return rows.sort((a, b) => (a.id < b.id ? -1 : 1));
}

export async function main(argv) {
  const { args, flags } = parseArgs(argv);
  const cmd = args[0];
  try {
    if (cmd === 'import' || cmd === 'check') {
      if (!args[1]) { err('用法 · usage: node tools/mod.mjs import <pack-dir | zip>'); return 2; }
      return report(await importPath(args[1], { force: !!flags.force, dryRun: cmd === 'check' || !!flags['dry-run'] }));
    }
    if (cmd === 'pack') {
      const dir = args[1];
      if (!dir) { err('用法 · usage: node tools/mod.mjs pack <pack-dir> [-o out.zip]'); return 2; }
      const abs = path.resolve(dir);
      if (!fs.existsSync(path.join(abs, 'pack.json'))) { err('目录里没有 pack.json · no pack.json in the folder'); return 2; }
      const id = (() => { try { return JSON.parse(fs.readFileSync(path.join(abs, 'pack.json'), 'utf8')).id || path.basename(abs); } catch { return path.basename(abs); } })();
      const files = readTree(abs);
      const zip = zipFiles(files);
      const dest = path.resolve(flags.out || path.join(abs, '..', `${id}.zip`));
      fs.writeFileSync(dest, zip);
      out(`${path.relative(process.cwd(), dest)} · ${files.length} files · ${zip.length} bytes`);
      return 0;
    }
    if (cmd === 'list') {
      const rows = listInstalled();
      if (!rows.length) out('（没有已安装的插件 · nothing installed）');
      for (const r of rows) out(`${r.id}\t${r.class}\t${r.version}\t${r.name}`);
      return 0;
    }
    if (cmd === 'watch') {
      const dir = path.resolve(args[1] || path.join(ROOT, 'mod-inbox'));
      out(`监听 · watching ${dir}（把 zip 丢进去 · drop zips in）`);
      const inbox = startInbox({
        dir,
        importFile: async (file) => {
          const r = await importArchive(fs.readFileSync(file), { root: ROOT, pluginsDir: PLUGINS, dataDir: DATA, vanilla: vanilla() });
          report(r);
          return r;
        },
        log: { info: (m) => out(m), warn: (m) => err(m) },
      });
      await new Promise((resolve) => {
        process.once('SIGINT', () => { inbox.close(); resolve(); });
        process.once('SIGTERM', () => { inbox.close(); resolve(); });
      });
      return 0;
    }
    out('命令 · commands:\n  import <pack-dir | zip> [--force] [--dry-run]\n  check  <pack-dir | zip>\n  pack   <pack-dir> [-o out.zip]\n  list\n  watch  [inbox-dir]');
    return cmd ? 2 : 0;
  } catch (e) {
    err(`失败 · failed: ${e?.stack || e}`);
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
