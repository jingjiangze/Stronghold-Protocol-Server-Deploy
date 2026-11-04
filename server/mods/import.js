// server/mods/import.js — one archive in, one answer out. The mod manager never opens a second loading path: a Forge
// pack goes through upstream's forgeImport (which converts it into ordinary plugin folders), a plugin zip through
// upstream's installPluginBytes (which checks and stages it). This module only decides which one is in front of it.
//
// (i18n-ignore-file: the reports it returns are bilingual by design, 中文 · English — the same rule
// server/http/common.js carries, docs/I18N.md.)
import { importForge, readUntrustedZip } from '../plugins/forgeImport.js';
import { installPluginBytes, InstallError } from '../plugins/install.js';
import { pluginCompatibility } from '../../shared/plugins/compat.js';

/**
 * `<id>/plugin.json` — the layout `tools/plugin.mjs pack --zip` writes (server/plugins/pack.js, `zipPlugin`).
 * `readUntrustedZip` already unwraps `pack.json` (forgeImport's `stripWrapper`), but that rule only knows
 * pack.json, so a wrapped plugin zip stayed `unknown` here while `installPluginBytes` accepted it. One folder,
 * one manifest, same rule; anything deeper is left alone.
 * @param {Map<string, Buffer>} files
 */
function stripPluginWrapper(files) {
  if (files.has('plugin.json')) return files;
  const tops = new Set([...files.keys()].map((n) => n.split('/')[0]));
  if (tops.size !== 1) return files;
  const top = [...tops][0];
  if (!files.has(`${top}/plugin.json`)) return files;
  const out = new Map();
  for (const [n, d] of files) if (n.length > top.length + 1) out.set(n.slice(top.length + 1), d);
  return out;
}

/** What kind of archive is this? Reads the zip's central directory only (never extracts to disk). */
export async function sniffArchive(buffer) {
  const files = stripPluginWrapper(await readUntrustedZip(buffer));
  if (files.has('pack.json')) return { kind: 'pack', files };
  if (files.has('plugin.json')) return { kind: 'plugin', files };
  return { kind: 'unknown', files };
}

/**
 * Import a zip: a Forge pack (`pack.json`) or a plugin (`plugin.json`).
 * @param {Buffer} buffer
 * @param {{ root?: string, pluginsDir: string, dataDir: string, vanilla?: object|null, force?: boolean, dryRun?: boolean }} opts
 * @returns {Promise<{ ok: boolean, kind: string, wrote?: boolean, dryRun?: boolean, report?: any, markdown?: string,
 *   compat?: any, issues?: any[], id?: string, error?: string, detail?: string }>}
 */
export async function importArchive(buffer, { root, pluginsDir, dataDir, vanilla = null, force = false, dryRun = false } = {}) {
  let kind, files;
  try { ({ kind, files } = await sniffArchive(buffer)); } catch (e) {
    return { ok: false, kind: 'unknown', error: 'PLUGIN_INSTALL_ZIP', detail: String(e?.message || e).slice(0, 300) };
  }
  if (kind === 'pack') {
    const r = await importForge({ zip: buffer }, { root, pluginsDir, dataDir, vanilla, dryRun });
    return { kind, ...r };
  }
  if (kind === 'plugin') {
    // The manifest is already checked by installPluginBytes; this reads only the version declaration for the report.
    let compat = null;
    try { compat = pluginCompatibility(JSON.parse(files.get('plugin.json').toString('utf8'))); } catch { compat = null; }
    if (dryRun) return { kind, ok: true, wrote: false, dryRun: true, ...(compat ? { compat } : {}), markdown: '插件包（plugin.json）：不写出。· a plugin zip; nothing written.' };
    try {
      const r = installPluginBytes(buffer, { pluginsDir, force });
      return { kind, ok: true, wrote: true, ...(compat ? { compat } : {}), ...r };
    } catch (e) {
      if (e instanceof InstallError) return { kind, ok: false, wrote: false, ...(compat ? { compat } : {}), error: e.code, detail: String(e.message).slice(0, 300) };
      return { kind, ok: false, wrote: false, ...(compat ? { compat } : {}), error: 'PLUGIN_INSTALL_ZIP', detail: String(e?.message || e).slice(0, 300) };
    }
  }
  return { kind, ok: false, wrote: false, error: 'PLUGIN_INSTALL_ZIP', detail: 'zip 里既没有 pack.json（Forge 包）也没有 plugin.json（插件） · neither pack.json nor plugin.json' };
}
