// tools/build-rogue-maps.mjs — 把官方集成战略（ISW/ro1..ro6）的战斗关卡接进本作数据（2026-11-03）。
//
// 做三件事，全部幂等（只替换 `rogue_` 前缀的记录，别的一律不动）：
//   ① data/stages.json 里补 `rogue_<roN>_<x-y>` 的 stage（地形/部署格来自官方 mapData，见 tools/rogue-stages.mjs）
//   ② data/waves.json 里补同名 wave 模板（官方 waves → 绝对时间出怪）
//   ③ data/config.json 里把 `mode_rogue_n*` 的 `stages` 池换成这批肉鸽图（没有别的图就保持原样）
//
// 用法：
//   node tools/build-rogue-maps.mjs --levels <目录> [--theme ro4] [--topic <topic.json>] [--dry]
//   <目录> 下放 `level_rogue*.json`（可以按主题分子目录）；`--topic` 给出官方 roguelike_topic_table.json 时
//   会顺带补上关卡的中文名（`details.rogue_N.stages[*].name`）。
//
// 只读官方 JSON、只写本作 data/；不改任何代码。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { convertRogueLevel, wavesOf, routesInFrame, frameOf, FRAME } from './rogue-stages.mjs';
import { syncMotaConfig } from './build-nmodes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/** `level_rogue4_1-1.json` → `{ theme: 'ro4', code: '4_1-1', id: 'rogue_ro4_1-1' }` */
export function idOfFile(file) {
  const m = /^level_rogue(\d+)_(.+)\.json$/i.exec(path.basename(file));
  if (!m) return null;
  return { theme: `ro${m[1]}`, code: m[2], id: `rogue_ro${m[1]}_${m[2]}` };
}

/** 官方 topic 表里 `levelId → 中文名`。 */
export function namesFromTopic(topic) {
  const out = new Map();
  for (const detail of Object.values((topic && topic.details) || {})) {
    for (const st of Object.values((detail && detail.stages) || {})) {
      const levelId = st && typeof st.levelId === 'string' ? st.levelId.toLowerCase() : null;
      if (levelId && typeof st.name === 'string' && st.name) out.set(levelId, st.name);
    }
  }
  return out;
}

/**
 * 一个关卡文件 → { stage, wave }（解析失败/没有地形就返回 null）。
 *
 * 出怪的取舍（2026-11-03，实证）：官方肉鸽出怪里有 **317 个敌人 key，本作 enemies.json 只覆盖 75 个（24%）**，
 * 照搬会刷出未知敌人。所以这里**只借官方的地图与路线**：出怪沿用本作已知敌人的基础模板（`baseWave`），
 * 把路线索引夹进这张图的路线数里。官方自己的出怪表留在 `officialCount` 里做统计，不写进数据。
 */
export function convertOne(lv, file, names = new Map(), baseWave = null) {
  const idn = idOfFile(file);
  if (!idn) return null;
  if (!lv || !lv.mapData || !Array.isArray(lv.mapData.map) || !lv.mapData.map.length) return null;
  // 超出 19×21 画框的图显式跳过：frameOf 的偏移会被夹到 0，超出的列/行在画框里根本不存在，
  // 静默截断会丢地形、丢 S/E 与路径起点（实测 b-7 8×25、b-8 9×36），所以这里直接放弃。
  const frame = frameOf(lv);
  if (frame.h > FRAME.rows || frame.w > FRAME.cols) return null;
  const name = (lv.levelId && names.get(String(lv.levelId).toLowerCase())) || idn.id;
  const stage = convertRogueLevel(lv, { id: idn.id, name, active: true, modes: [] });
  stage.weight = 1;
  // 出怪路线用**本作画框里可走**的 BFS 路线（官方 routes 会穿不可走格，见 routesInFrame 注释）
  const walkRoutes = routesInFrame(stage);
  const official = wavesOf(lv, idn.id, walkRoutes);
  const wave = { ...official };
  if (baseWave && Array.isArray(baseWave.spawns) && baseWave.spawns.length) {
    const nRoutes = Math.max(1, official.routes.length);
    wave.spawns = baseWave.spawns.map((s) => ({ ...s, routeIndex: Math.abs(Number(s.routeIndex) || 0) % nRoutes }));
    wave.dp = { ...baseWave.dp };
    wave.characterLimit = baseWave.characterLimit;
    wave.maxPlayTime = baseWave.maxPlayTime > 0 ? baseWave.maxPlayTime : official.maxPlayTime;
    wave.baseTemplate = baseWave.id || null;
    // 出怪换成本作模板后，totalCount 必须跟着实际 spawns 重算（口径同 wavesOf），否则会留着官方值
    wave.totalCount = wave.spawns
      .filter((s) => !s.action || String(s.action).toUpperCase() === 'SPAWN')
      .reduce((n, s) => n + (Number(s.count) || 1), 0);
  }
  wave.officialCount = official.totalCount;
  return { id: idn.id, stage, wave };
}

function listLevelFiles(dir) {
  const out = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/^level_rogue\d+_.+\.json$/i.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out.sort();
}

function main(argv) {
  const arg = (k, dflt = null) => { const i = argv.indexOf(k); return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt; };
  const dir = arg('--levels');
  const spawnsFrom = arg('--spawns-from');
  const theme = arg('--theme');
  const topicPath = arg('--topic');
  const dry = argv.includes('--dry');
  if (!dir) { console.error('usage: node tools/build-rogue-maps.mjs --levels <dir> [--theme ro4] [--topic topic.json] [--dry]'); process.exit(2); }

  const names = topicPath && fs.existsSync(topicPath) ? namesFromTopic(JSON.parse(fs.readFileSync(topicPath, 'utf8'))) : new Map();
  const files = listLevelFiles(dir).filter((f) => (theme ? idOfFile(f)?.theme === theme : true));
  const stagesPath = path.join(ROOT, 'data', 'stages.json');
  const wavesPath = path.join(ROOT, 'data', 'waves.json');
  const cfgPath = path.join(ROOT, 'data', 'config.json');
  const stages = JSON.parse(fs.readFileSync(stagesPath, 'utf8'));
  const waves = JSON.parse(fs.readFileSync(wavesPath, 'utf8'));
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));

  // 基础出怪模板：优先 CLI 指定，否则取第一条「非 rogue、kind=normal、有出怪」的模板
  const baseWave = spawnsFrom
    ? waves[spawnsFrom]
    : Object.values(waves).find((t) => t && t.kind === 'normal' && !String(t.id).startsWith('rogue_') && Array.isArray(t.spawns) && t.spawns.length);
  if (!baseWave) { console.error('nmodes-rogue: 找不到可用的基础出怪模板（--spawns-from）'); process.exit(2); }

  // 幂等：先清掉上一轮的肉鸽记录（含历史命名 `rogue_rogue_*`），避免旧键残留
  for (const k of Object.keys(stages)) if (k.startsWith('rogue_')) delete stages[k];
  for (const k of Object.keys(waves)) if (k.startsWith('rogue_')) delete waves[k];

  let added = 0, skipped = 0;
  const skippedWide = [];
  for (const f of files) {
    let lv = null;
    try { lv = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { skipped += 1; continue; }
    // 超宽/超高图单独计数（与解析失败等 skipped 分开），convertOne 内部也会拒绝
    const fr = lv && lv.mapData && Array.isArray(lv.mapData.map) && lv.mapData.map.length ? frameOf(lv) : null;
    if (fr && (fr.h > FRAME.rows || fr.w > FRAME.cols)) { skippedWide.push(path.basename(f)); continue; }
    const one = convertOne(lv, f, names, baseWave);
    if (!one) { skipped += 1; continue; }
    stages[one.id] = one.stage;
    waves[one.wave.id] = one.wave;
    added += 1;
  }

  // mode_rogue_n* 的 stages 池换成这批肉鸽图（按主题/关卡名排序，保证确定性）
  const rogueIds = Object.keys(stages).filter((id) => id.startsWith('rogue_')).sort();
  let modesTouched = 0;
  for (const [mid, mode] of Object.entries(config.modes || {})) {
    if (!/^mode_rogue_n\d+$/.test(mid)) continue;
    const before = JSON.stringify(mode.stages || []);
    mode.stages = rogueIds.slice();
    if (JSON.stringify(mode.stages) !== before) modesTouched += 1;
  }

  const wideNote = skippedWide.length ? `；skippedWide: ${skippedWide.length} [${skippedWide.join(', ')}]` : '；skippedWide: 0';
  console.log(`nmodes-rogue: ${files.length} 个关卡文件 → ${added} 张图 / ${skipped} 个跳过${wideNote}；池子 ${rogueIds.length} 张；改了 ${modesTouched} 条 mode_rogue_n* 的 stages`);
  if (dry) return;
  fs.writeFileSync(stagesPath, JSON.stringify(stages));
  fs.writeFileSync(wavesPath, JSON.stringify(waves));
  fs.writeFileSync(cfgPath, JSON.stringify(config));
  syncMotaConfig();   // 内容集里插件那份 config 会覆盖根配置（见 build-nmodes.syncMotaConfig）
  console.log('nmodes-rogue: 写入 data/stages.json / data/waves.json / data/config.json');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
