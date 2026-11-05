// tools/fit-rogue-wave-times.mjs — 把 data/waves.json 里肉鸽（rogue_*）波的出怪时间压进该回合时限。
//
// 背景（2026-11-05 审计）：v2 转换器把官方 actions 里的 ACTIVATE_PREDEFINED 等非 SPAWN 行也推进了时间游标，
// 导致部分图首怪被推到 118s、末怪远超回合时限（combatTimeLimit × COMBAT_TIME_SCALE=2）。本脚本用与
// tools/build-rogue-maps-v2.mjs 完全相同的 fitTimeline 归一化**已有数据**（不重新生成地图/路线/出怪）。
//
// 用法：
//   node tools/fit-rogue-wave-times.mjs --dry-run   # 只打印统计，不写文件（默认）
//   node tools/fit-rogue-wave-times.mjs --apply     # 以紧凑 JSON 写回 data/waves.json
//
// 不动：data/stages.json、routes、branches、totalCount、spawn 的 key/count/routeIndex 等；只改 spawns[].time /
// spawns[].interval，并写 wave.timing = { k, before, after }（已知 tier 才有）。未知 tier（sv/fs/c/dv/s）原样跳过。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fitTimeline, tierOfStageId, spawnLimitForTier } from './build-rogue-maps-v2.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const WAVES_PATH = path.join(ROOT, 'data', 'waves.json');

/** 一波的 first / end（end = time + (count-1)*interval）；没有 spawn 时返回 null。 */
function boundsOf(spawns) {
  const rows = (Array.isArray(spawns) ? spawns : []).filter((s) => s && Number.isFinite(Number(s.time)));
  if (!rows.length) return null;
  const first = Math.min(...rows.map((s) => Number(s.time)));
  const end = Math.max(...rows.map((s) => Number(s.time) + Math.max(0, (Number(s.count) || 1) - 1) * Math.max(0, Number(s.interval) || 0)));
  return { first, end };
}

function main(argv) {
  const apply = argv.includes('--apply');
  const raw = fs.readFileSync(WAVES_PATH, 'utf8');
  const waves = JSON.parse(raw);
  const stats = {
    rogue: 0, known: 0, unknown: 0, noSpawns: 0, changed: 0,
    deadBefore: 0, deadAfter: 0, tailBefore: 0, tailAfter: 0,
  };
  const byTier = {};
  const changedIds = [];
  let sample = null;

  for (const [id, wave] of Object.entries(waves)) {
    if (!id.startsWith('rogue_') || !wave || typeof wave !== 'object') continue;
    stats.rogue += 1;
    const tier = tierOfStageId(id);
    const limit = spawnLimitForTier(tier);
    if (!limit) { stats.unknown += 1; continue; }
    stats.known += 1;
    const bounds = boundsOf(wave.spawns);
    if (!bounds) { stats.noSpawns += 1; continue; }
    const before = bounds;
    if (before.first >= limit) stats.deadBefore += 1;
    if (before.end > limit) stats.tailBefore += 1;

    const timing = fitTimeline(wave.spawns, limit);
    if (timing) wave.timing = timing;
    const after = boundsOf(wave.spawns) || before;
    if (timing && timing.k !== 1) { stats.changed += 1; changedIds.push(id); }
    if (after.first >= limit) stats.deadAfter += 1;
    if (after.end > limit) stats.tailAfter += 1;

    const t = (byTier[tier] ||= { waves: 0, changed: 0, deadBefore: 0, tailBefore: 0, deadAfter: 0, tailAfter: 0 });
    t.waves += 1;
    if (timing && timing.k !== 1) t.changed += 1;
    if (before.first >= limit) t.deadBefore += 1;
    if (before.end > limit) t.tailBefore += 1;
    if (after.first >= limit) t.deadAfter += 1;
    if (after.end > limit) t.tailAfter += 1;

    if (id === 'rogue_ro4_1-2') sample = { id, tier, limit, before, after, k: timing ? timing.k : 1 };
  }

  console.log(`fit-rogue-wave-times: ${apply ? 'APPLY' : 'DRY-RUN'} ${path.relative(ROOT, WAVES_PATH)}`);
  console.log(`fit-rogue-wave-times: rogue waves ${stats.rogue}（已知 tier ${stats.known}，未知 tier 跳过 ${stats.unknown}，无 spawn ${stats.noSpawns}）`);
  console.log(`fit-rogue-wave-times: 修改图数 ${stats.changed}`);
  console.log(`fit-rogue-wave-times: dead(首怪>=L) ${stats.deadBefore} → ${stats.deadAfter}`);
  console.log(`fit-rogue-wave-times: tail(末怪>L) ${stats.tailBefore} → ${stats.tailAfter}`);
  for (const tier of Object.keys(byTier).sort((a, b) => String(a).localeCompare(String(b), 'en', { numeric: true }))) {
    const t = byTier[tier];
    console.log(`fit-rogue-wave-times:   tier ${String(tier).padEnd(3)} waves ${String(t.waves).padStart(3)}  changed ${String(t.changed).padStart(3)}  dead ${String(t.deadBefore).padStart(2)}→${t.deadAfter}  tail ${String(t.tailBefore).padStart(3)}→${t.tailAfter}`);
  }
  if (sample) {
    console.log(`fit-rogue-wave-times: ${sample.id}（tier ${sample.tier}，L ${sample.limit}，k ${sample.k}）first ${sample.before.first}→${sample.after.first}  end ${sample.before.end}→${sample.after.end}`);
  }
  if (changedIds.length) console.log(`fit-rogue-wave-times: changed ids: ${changedIds.slice(0, 20).join(', ')}${changedIds.length > 20 ? ` …(+${changedIds.length - 20})` : ''}`);

  if (!apply) return;
  // 与现文件一致：紧凑 JSON + 结尾换行（原文件就是 JSON.stringify 后再补 \n）。
  fs.writeFileSync(WAVES_PATH, `${JSON.stringify(waves)}\n`);
  console.log(`fit-rogue-wave-times: wrote ${path.relative(ROOT, WAVES_PATH)}`);
}

main(process.argv.slice(2));
