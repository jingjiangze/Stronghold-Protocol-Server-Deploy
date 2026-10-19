// server/mods/import.js — one archive in, one answer out. The mod manager never opens a second loading path: a Forge
// pack goes through upstream's forgeImport (which converts it into ordinary plugin folders), a plugin zip through
// upstream's installPluginBytes (which checks and stages it). This module only decides which one is in front of it.
import { importForge, readUntrustedZip } from '../plugins/forgeImport.js';
import { installPluginBytes, InstallError } from '../plugins/install.js';

/** What kind of archive is this? Reads the zip's central directory only (never extracts to disk). */
export async function sniffArchive(buffer) {
  const files = await readUntrustedZip(buffer);
  if (files.has('pack.json')) return { kind: 'pack', files };
  if (files.has('plugin.json')) return { kind: 'plugin', files };
  return { kind: 'unknown', files };
}

/**
 * Import a zip: a Forge pack (`pack.json`) or a plugin (`plugin.json`).
 * @param {Buffer} buffer
 * @param {{ root?: string, pluginsDir: string, dataDir: string, vanilla?: object|null, force?: boolean, dryRun?: boolean }} opts
 * @returns {Promise<{ ok: boolean, kind: string, wrote?: boolean, dryRun?: boolean, report?: any, markdown?: string,
 *   issues?: any[], id?: string, error?: string, detail?: string }>}
 */
export async function importArchive(buffer, { root, pluginsDir, dataDir, vanilla = null, force = false, dryRun = false } = {}) {
  let kind;
  try { ({ kind } = await sniffArchive(buffer)); } catch (e) {
    return { ok: false, kind: 'unknown', error: 'PLUGIN_INSTALL_ZIP', detail: String(e?.message || e).slice(0, 300) };
  }
  if (kind === 'pack') {
    const r = await importForge({ zip: buffer }, { root, pluginsDir, dataDir, vanilla, dryRun });
    return { kind, ...r };
  }
  if (kind === 'plugin') {
    if (dryRun) return { kind, ok: true, wrote: false, dryRun: true, markdown: '插件包（plugin.json）：不写出。· a plugin zip; nothing written.' };
    try {
      const r = installPluginBytes(buffer, { pluginsDir, force });
      return { kind, ok: true, wrote: true, ...r };
    } catch (e) {
      if (e instanceof InstallError) return { kind, ok: false, wrote: false, error: e.code, detail: String(e.message).slice(0, 300) };
      return { kind, ok: false, wrote: false, error: 'PLUGIN_INSTALL_ZIP', detail: String(e?.message || e).slice(0, 300) };
    }
  }
  return { kind, ok: false, wrote: false, error: 'PLUGIN_INSTALL_ZIP', detail: 'zip 里既没有 pack.json（Forge 包）也没有 plugin.json（插件） · neither pack.json nor plugin.json' };
}
