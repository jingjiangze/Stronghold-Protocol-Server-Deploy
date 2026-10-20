// server/mods/inbox.js — drop a zip into a folder and it is installed (拖目录即装). The watcher is a plain debounce over
// fs.watch: a file is taken once its size has stopped changing for two ticks, so a copy that is still being written is
// never read halfway. A successful import moves the zip to `_done/`; a refused one moves it to `_failed/` beside a
// `<name>.reason.txt` that says why — nothing is ever deleted.
import fs from 'node:fs';
import path from 'node:path';

const TICK_MS = 250;
const SETTLE_TICKS = 2;

/** A name that cannot collide: `20261018T041500-<name>`. */
function stamped(name) {
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}T${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}-${name}`;
}

function move(zip, into, name = path.basename(zip)) {
  const dir = path.join(path.dirname(zip), into);
  fs.mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, stamped(name));
  try { fs.renameSync(zip, dest); } catch { /* another process took it */ }
  return dest;
}

/**
 * Watch a folder of zips.
 * @param {{ dir: string, importFile: (file: string) => Promise<{ ok: boolean, kind?: string, error?: string, detail?: string }>,
 *   log?: { info?: Function, warn?: Function }, tickMs?: number }} opts
 * @returns {{ close: () => void, drain: () => Promise<void>, dir: string }}
 */
export function startInbox({ dir, importFile, log = {}, tickMs = TICK_MS }) {
  const root = path.resolve(dir);
  fs.mkdirSync(root, { recursive: true });
  /** @type {Map<string, { size: number, stable: number }>} */
  const seen = new Map();
  let timer = null;
  let running = false;
  let closed = false;

  const zips = () => {
    let names = [];
    try { names = fs.readdirSync(root); } catch { return []; }
    return names.filter((n) => n.toLowerCase().endsWith('.zip') && !n.startsWith('.') && fs.lstatSync(path.join(root, n)).isFile());
  };

  async function drain() {
    if (running || closed) return;
    running = true;
    try {
      for (const name of zips()) {
        const file = path.join(root, name);
        let size;
        try { size = fs.statSync(file).size; } catch { continue; }
        const prev = seen.get(name);
        if (!prev || prev.size !== size) { seen.set(name, { size, stable: 0 }); continue; }
        if (prev.stable < SETTLE_TICKS) { prev.stable++; continue; }
        seen.delete(name);
        try {
          const r = await importFile(file);
          if (r.ok) {
            const to = move(file, '_done');
            log.info?.(`[mods] ${name} → ${r.kind}${r.wrote === false ? '（没有可导入的内容）' : ''} · _done/${path.basename(to)}`);
          } else {
            const to = move(file, '_failed');
            fs.writeFileSync(`${to}.reason.txt`, `${r.error || 'IMPORT_FAILED'}\n${r.detail || ''}\n`, 'utf8');
            log.warn?.(`[mods] ${name} 被拒绝：${r.error || 'IMPORT_FAILED'} · ${r.detail || ''}`);
          }
        } catch (e) {
          const to = move(file, '_failed');
          fs.writeFileSync(`${to}.reason.txt`, `IMPORT_FAILED\n${String(e?.message || e)}\n`, 'utf8');
          log.warn?.(`[mods] ${name} 导入失败：${e?.message || e}`);
        }
      }
    } finally { running = false; }
  }

  const kick = () => { if (!timer && !closed) timer = setTimeout(async () => { timer = null; await drain(); }, tickMs); };
  let watcher = null;
  try {
    watcher = fs.watch(root, { persistent: false }, () => kick());
  } catch { /* the folder is drained on demand instead */ }
  kick();

  return {
    dir: root,
    drain,
    close() {
      closed = true;
      if (timer) clearTimeout(timer);
      try { watcher?.close(); } catch { /* already closed */ }
    },
  };
}
