#!/usr/bin/env node
// tools/tier-bands.mjs — 重取怪物卡池的六阶等分位切点（monsterPool.js 的 MONSTER_TIER_BANDS）。
//
// 用途：`data/enemies.json` 的条目数 / 数值一变，阶位切点就必须重取（业主 2026-11-05：全表 475 条下
// 旧切点 [39,57,87,134,176]（在 120 只旧基线池上取的）会把 34 % 的表压进 tier6）。本工具只读数据、只打印，
// 不写任何文件；把打印出来的切点手抄进 plugins/mota/server/match/monsterPool.js 的 MONSTER_TIER_BANDS。
//
// 口径（与 monsterPool.js 完全一致，别在这里另造一套）：
//   · 阶位由**基础价** `confrontValue(rec)`（= round((maxHp + atk×5 + def×3 + res×3) / 120)，下限 1）定，
//     **不带**本回合倍率；见 plugins/mota/server/match/match/confront.js 的 confrontValue。
//   · `monsterTierOf(v)`：`v > MONSTER_TIER_BANDS[k]` 逐级 +1 ⇒ 切点 band[k] 是 tier k+1 的**下界 − 1**，
//     即 band[k] = tier k 这一组的最大值。
//   · 等分位 = 按只数把排序后的表切成 6 组（cumulative rounding），band[k] 取第 k 组的最大值；
//     重合值导致切点不递增时抬到 band[k−1] + 1（否则会出现空档 / 空档里没有卡）。
//
// 三个口径都打印（业主 2026-11-05 的两条要求会给出不同答案，这里不替他选，只把数字摆出来）：
//   all       = data/enemies.json 全表（当前 475 条）
//   noToken   = 全表 − tokenOnly（当前 467 条，= 池的遍历源）
//   shop      = noToken − rank === 'BOSS'（= 商店真能发出来的卡，tier 只对它们有意义）
// 默认把 **shop** 口径的切点写成可直接粘贴的一行（`--base` 可切）。
//
// Usage:
//   node tools/tier-bands.mjs [--base shop|noToken|all] [--json]
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { confrontValue } from '../plugins/mota/server/match/match/confront.js';
import {
  MONSTER_TIER_BANDS,
  MONSTER_COPIES_BY_TIER,
  MONSTER_MAX_TIER,
  monsterTierOf,
} from '../plugins/mota/server/match/monsterPool.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/** 六等分（只数尽量均分；tier 数 = bands.length + 1）。 */
export const TIER_COUNT = 6;

/**
 * 按只数把 `sorted`（升序的数值）切成 TIER_COUNT 组，返回 5 个切点（= 每组最大值，严格递增）。
 * @param {number[]} sorted 升序价格
 * @returns {number[]} 长度 TIER_COUNT − 1
 */
export function equalCountBands(sorted) {
  const n = sorted.length;
  const bands = [];
  if (!n) return bands;
  for (let k = 1; k < TIER_COUNT; k++) {
    const end = Math.max(1, Math.min(n, Math.round((k * n) / TIER_COUNT)));
    let v = sorted[end - 1];
    const prev = bands.length ? bands[bands.length - 1] : -Infinity;
    if (!(v > prev)) v = prev === -Infinity ? v : prev + 1;
    bands.push(v);
  }
  return bands;
}

/** 用给定切点分档并统计每档只数 / 占比。 */
function distribution(values, bands) {
  const max = bands.length + 1;
  const tierOf = (v) => {
    let t = 1;
    for (const b of bands) if (v > b) t += 1;
    return Math.min(max, t);
  };
  const counts = new Array(max + 1).fill(0);
  for (const v of values) counts[tierOf(v)] += 1;
  const total = values.length || 1;
  const rows = [];
  for (let t = 1; t <= max; t++) {
    const copies = MONSTER_COPIES_BY_TIER[t] || 1;
    rows.push({ tier: t, count: counts[t], share: counts[t] / total, copies, tierCopies: counts[t] * copies });
  }
  return rows;
}

function readEnemies() {
  const raw = JSON.parse(readFileSync(join(ROOT, 'data/enemies.json'), 'utf8'));
  return raw && typeof raw === 'object' ? raw : {};
}

function basesOf(enemies) {
  const all = [];
  const noToken = [];
  const shop = [];
  for (const [key, rec] of Object.entries(enemies)) {
    if (!rec || typeof rec !== 'object') continue;
    const v = confrontValue(rec);
    all.push({ key, v, tokenOnly: rec.tokenOnly === true, boss: rec.rank === 'BOSS' });
    if (rec.tokenOnly === true) continue;
    noToken.push({ key, v, boss: rec.rank === 'BOSS' });
    if (rec.rank === 'BOSS') continue;
    shop.push({ key, v });
  }
  return { all, noToken, shop };
}

function pct(x) { return `${(x * 100).toFixed(1)}%`; }

function printBase(name, list, crossList = null, crossName = '') {
  const sorted = list.map((e) => e.v).sort((a, b) => a - b);
  const bands = equalCountBands(sorted);
  console.log(`\n=== ${name}：${list.length} 条 ===`);
  console.log(`  价格区间 ${sorted[0]} … ${sorted[sorted.length - 1]}（min/median/max）`);
  const med = sorted[Math.floor(sorted.length / 2)] ?? 0;
  console.log(`  min ${sorted[0]} / median ${med} / max ${sorted[sorted.length - 1]}`);
  console.log(`  新切点（等分位）[${bands.join(', ')}]`);
  const rows = distribution(sorted, bands);
  console.log('  档 | 只数 | 占比 | 每卡份数 | 该阶总份数');
  for (const r of rows) {
    console.log(`  T${r.tier} | ${r.count} | ${pct(r.share)} | ${r.copies} | ${r.tierCopies}`);
  }
  const same = MONSTER_TIER_BANDS.length === bands.length && MONSTER_TIER_BANDS.every((b, i) => b === bands[i]);
  if (same) {
    console.log('  ↳ 文件里的 MONSTER_TIER_BANDS 已与这组切点一致');
  } else {
    const curRows = distribution(sorted, MONSTER_TIER_BANDS);
    console.log(`  ↳ 文件里当前的切点 [${MONSTER_TIER_BANDS.join(', ')}] 下同口径分布：`
      + curRows.map((r) => `T${r.tier}=${r.count}`).join(' / '));
  }
  if (crossList) {
    // 交叉检查：这组切点落到「商店真能发出来的卡」上是什么分布（tier 只对它们有意义）
    const crossSorted = crossList.map((e) => e.v).sort((a, b) => a - b);
    const crossRows = distribution(crossSorted, bands);
    console.log(`  ↳ 若用这组切点，${crossName}（${crossSorted.length} 条）分布：`
      + crossRows.map((r) => `T${r.tier}=${r.count}(${pct(r.share)})`).join(' / '));
  }
  return { name, n: list.length, bands, rows };
}

function main(argv) {
  let base = 'shop';
  let json = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') base = String(argv[++i] || 'shop');
    else if (a === '--json') json = true;
    else if (a === '--help' || a === '-h') {
      console.log('usage: node tools/tier-bands.mjs [--base shop|noToken|all] [--json]');
      return;
    }
  }
  const enemies = readEnemies();
  const sets = basesOf(enemies);
  const out = {
    enemiesTotal: Object.keys(enemies).length,
    maxTier: MONSTER_MAX_TIER,
    copiesByTier: { ...MONSTER_COPIES_BY_TIER },
    oldBands: [...MONSTER_TIER_BANDS],
    bases: {},
  };
  if (!json) {
    console.log(`data/enemies.json 共 ${out.enemiesTotal} 条；tokenOnly ${sets.all.length - sets.noToken.length} 条；`
      + `BOSS ${sets.noToken.filter((e) => e.boss).length} 条（其中 tokenOnly ${sets.all.filter((e) => e.boss && e.tokenOnly).length} 条）`);
    console.log(`当前 MONSTER_TIER_BANDS = [${MONSTER_TIER_BANDS.join(', ')}]（${MONSTER_TIER_BANDS.length} 切点 ⇒ ${MONSTER_MAX_TIER} 档）`);
  }
  for (const [name, list] of Object.entries(sets)) {
    const r = json ? null : printBase(name, list, name === 'shop' ? null : sets.shop, '商店池 shop');
    out.bases[name] = json
      ? (() => {
        const sorted = list.map((e) => e.v).sort((a, b) => a - b);
        const bands = equalCountBands(sorted);
        return { n: list.length, bands, rows: distribution(sorted, bands) };
      })()
      : r;
  }
  const chosen = out.bases[base] || out.bases.shop;
  if (json) { console.log(JSON.stringify(out, null, 2)); return; }
  console.log(`\n>>> 建议写进 monsterPool.js（--base ${base}）：export const MONSTER_TIER_BANDS = Object.freeze([${chosen.bands.join(', ')}]);`);
}

main(process.argv.slice(2));
