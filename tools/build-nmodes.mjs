// tools/build-nmodes.mjs — 把 4 档难度扩成 N1–N20（业主 2026-11-02：「共 20 档替换 4 档，以 4 档为基准」）。
//
// 设计：
//   · 4 档作为**基准锚点**：N1 = FUNNY、N8 = NORMAL、N14 = HARD、N20 = ABYSS；
//   · 其余 16 档 = 相邻锚点之间的线性插值（数值四舍五入到各自合适的精度）；
//   · 只**新增** `mode_single_n<k>` / `mode_multi_n<k>` 记录，旧的 4 档 mode 记录原样保留（不可达但兼容旧房间/旧版本），
//     这样 `data/config.json` 的反向兼容不需要迁移脚本；
//   · 同步按难度键查表的四处：`bans`、`hiddenCore.difficulties`、`rewards.difficultyFactor`、`trophies.*`，以及
//     `data/bosses.json` 的 `bloodPoint[difficulty]`。
//
// 用法：
//   node tools/build-nmodes.mjs            # 写回 data/config.json 与 data/bosses.json
//   node tools/build-nmodes.mjs --check    # 只校验：现有数据是否与生成结果一致（CI 用，不写盘）
//   node tools/build-nmodes.mjs --dry      # 打印将要写入的内容摘要（不写盘）
//
// 纯函数 `applyNModes(config, bosses)` 导出给单测用，不做任何 IO。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ANCHORS = Object.freeze([
  { n: 1, difficulty: 'FUNNY' },
  { n: 8, difficulty: 'NORMAL' },
  { n: 14, difficulty: 'HARD' },
  { n: 20, difficulty: 'ABYSS' },
]);
export const N_TIERS = Object.freeze(Array.from({ length: 20 }, (_, i) => `N${i + 1}`));

/** 第 n 档落在哪两个锚点之间（含端点：落在锚点上时 t=0 / 1 都返回同一锚点值）。 */
export function bracket(n) {
  for (let i = 0; i < ANCHORS.length - 1; i++) {
    const a = ANCHORS[i], b = ANCHORS[i + 1];
    if (n >= a.n && n <= b.n) return { a, b, t: b.n === a.n ? 0 : (n - a.n) / (b.n - a.n) };
  }
  return { a: ANCHORS[ANCHORS.length - 1], b: ANCHORS[ANCHORS.length - 1], t: 0 };
}

const lerp = (x, y, t) => Number(x) + (Number(y) - Number(x)) * t;
const roundTo = (v, dp) => {
  const f = 10 ** dp;
  return Math.round(v * f) / f;
};

/** 深度插值：数字按 dp 取整；对象递归；数组逐项（长度不同取较小锚点原样）；其余取 t>=1 ? b : a。 */
function interp(a, b, t, dp = 4) {
  // 落在锚点上就原样返回（上游数值带 6 位小数，四舍五入会破坏「锚点精确复现 4 档」）
  if (t <= 0) return a;
  if (t >= 1) return b;
  if (typeof a === 'number' && typeof b === 'number') return roundTo(lerp(a, b, t), dp);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return t >= 1 ? b : a;
    return a.map((v, i) => interp(v, b[i], t, dp));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const out = {};
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (!(k in a)) { out[k] = b[k]; continue; }
      if (!(k in b)) { out[k] = a[k]; continue; }
      out[k] = interp(a[k], b[k], t, dp);
    }
    return out;
  }
  return t >= 1 ? b : a;
}

/** 颜色按锚点线性插值（#rrggbb）。 */
function interpColor(a, b, t) {
  const parse = (s) => {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(s || ''));
    if (!m) return null;
    const v = parseInt(m[1], 16);
    return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
  };
  const pa = parse(a), pb = parse(b);
  if (!pa || !pb) return t >= 1 ? b : a;
  const mix = pa.map((v, i) => Math.round(lerp(v, pb[i], t)));
  return '#' + mix.map((v) => v.toString(16).padStart(2, '0')).join('');
}

const modeKey = (type, n) => `mode_${type}_n${n}`;

/** 生成 20 档里的一种模式记录（`type` = 'single' | 'multi'）。 */
function modeFor(config, type, n) {
  const modes = config.modes || {};
  const { a, b, t } = bracket(n);
  const pick = (d) => modes[`mode_${type}_${d.toLowerCase()}`] || null;
  const ma = pick(a.difficulty), mb = pick(b.difficulty);
  if (!ma) throw new Error(`missing anchor mode for ${type}/${a.difficulty}`);
  const src = mb ? interp(ma, mb, t) : ma;
  // 回合号必须是整数（插值出来的 9.71 会让 enemyScale["9.7143"] 查不到）
  for (const k of ['bossRound', 'lastRound', 'hiddenRound']) {
    if (typeof src[k] === 'number') src[k] = Math.round(src[k]);
  }
  if (Array.isArray(src.spRounds)) src.spRounds = src.spRounds.map((v) => Math.round(Number(v) || 0));
  const onAnchor = ANCHORS.find((x) => x.n === n);
  const label = `N${n}`;
  return {
    ...src,
    modeId: modeKey(type, n),
    name: onAnchor ? `${src.name}` : `模拟 ${label}`,
    code: `AC-${label}`,   // 统一成 AC-N8 这种，免得锚点档显示旧代号 AC-2 而邻档显示 AC-N9
    sortId: 100 + n,
    difficulty: label,
    // 这 20 条是「难度档」而不是新的玩法模式：不进 studio 可选模式列表（inScope 只作此用）
    inScope: false,
    color: mb ? interpColor(ma.color, mb.color, t) : ma.color,
  };
}

/** 按难度键查表的四张表 + bosses 血量，一起插值。 */
function tablesFor(config, n) {
  const { a, b, t } = bracket(n);
  const label = `N${n}`;
  const bans = config.bans || {};
  const rewards = (config.rewards && config.rewards.difficultyFactor) || {};
  const hidden = (config.hiddenCore && config.trophies && config.trophies.hiddenCore) || {};
  const bansA = bans[a.difficulty] || { core: 0, addon: 0 };
  const bansB = bans[b.difficulty] || bansA;
  // 0.4.3: extraChess (the extra post-bond bans) is 7 in every difficulty tier, so it is not interpolated; core/addon are.
  const ban = { core: Math.round(lerp(bansA.core, bansB.core, t)), addon: Math.round(lerp(bansA.addon, bansB.addon, t)), extraChess: 7 };
  const rA = Number(rewards[a.difficulty] ?? 1), rB = Number(rewards[b.difficulty] ?? rA);
  const hA = hidden[a.difficulty], hB = hidden[b.difficulty];
  let trophy = null;
  if (typeof hA === 'number' && typeof hB === 'number') trophy = Math.round(lerp(hA, hB, t));
  else if (typeof hB === 'number' && n >= b.n) trophy = hB;
  else if (typeof hA === 'number') trophy = hA;
  return { label, ban, factor: roundTo(lerp(rA, rB, t), 2), trophy };
}

/**
 * 把 config（data/config.json 的对象）与 bosses（data/bosses.json 的对象）就地扩成 20 档。
 * 纯函数：不读写文件，返回新的 config / bosses（不修改入参）。
 */
export function applyNModes(config, bosses) {
  const out = JSON.parse(JSON.stringify(config));
  const bs = JSON.parse(JSON.stringify(bosses || {}));

  out.modes = out.modes || {};
  for (const type of ['single', 'multi']) {
    for (let n = 1; n <= 20; n++) out.modes[modeKey(type, n)] = modeFor(config, type, n);
  }
  // 肉鸽独立模式（2026-11-02）：房间 mode='rogue' 时对局读 `mode_rogue_<难度>`。
  // 记录 = 多人档的副本（数值同源），只换 modeId / 名字 / 代号；**回合数以这份记录为准**，
  // 等 R4 拿到官方「整章战斗数」后只改这里（改 ROGUE_ROUNDS 即可），其余代码不用动。
  for (let n = 1; n <= 20; n++) {
    const base = out.modes[modeKey('multi', n)];
    const prev = config.modes ? config.modes[`mode_rogue_n${n}`] : null;
    // 官方肉鸽地图池由 tools/build-rogue-maps.mjs 写入（`rogue_*`）；重跑本生成器时**必须保留**，否则会把池子冲回 autochess 场景
    const pool = prev && Array.isArray(prev.stages) && prev.stages.length && prev.stages.every((id) => String(id).startsWith('rogue_'))
      ? prev.stages.slice() : base.stages;
    out.modes[`mode_rogue_n${n}`] = {
      ...base,
      modeId: `mode_rogue_n${n}`,
      name: `肉鸽 ${n}`,
      code: `RG-N${n}`,
      difficulty: `N${n}`,
      type: 'MULTI',
      inScope: false,
      stages: pool,
    };
  }

  // bans / rewards / trophies / hiddenCore
  out.bans = out.bans || {};
  out.rewards = out.rewards || {};
  out.rewards.difficultyFactor = out.rewards.difficultyFactor || {};
  out.trophies = out.trophies || {};
  out.trophies.hiddenCore = out.trophies.hiddenCore || {};
  const byRounds = Array.isArray(out.trophies.byRoundsPassed) ? out.trophies.byRoundsPassed : [];
  const allowHidden = [];
  for (let n = 1; n <= 20; n++) {
    const { label, ban, factor, trophy } = tablesFor(config, n);
    out.bans[label] = ban;
    out.rewards.difficultyFactor[label] = factor;
    out.trophies.hiddenCore[label] = trophy;
    // 隐秘核心：与 NORMAL 及以上一致（锚点 a 支持则本档也支持）
    if (ANCHORS.some((x) => x.difficulty === 'NORMAL' && n >= x.n)) allowHidden.push(label);
  }
  out.hiddenCore = out.hiddenCore || {};
  // 旧 4 档的名字必须保留：`finalAssault.js` 用 `hiddenCore.difficulties.includes(gd.difficulty)` 判定，
  // 只写 N 档会让旧档（FUNNY 除外）永远进不了隐秘核心。
  const legacyAllowed = ['NORMAL', 'HARD', 'ABYSS'];   // 旧档名固定保留（数据里原有就是这三档 + FUNNY 排除）
  out.hiddenCore.difficulties = [...legacyAllowed, ...allowHidden];
  // byRoundsPassed 每条都有难度键：按锚点插值
  for (const row of byRounds) {
    if (!row || typeof row !== 'object') continue;
    for (let n = 1; n <= 20; n++) {
      const { a, b, t } = bracket(n);
      const va = row[a.difficulty], vb = row[b.difficulty];
      if (typeof va === 'number' && typeof vb === 'number') row[`N${n}`] = Math.round(lerp(va, vb, t));
      else if (typeof va === 'number') row[`N${n}`] = va;
      else if (typeof vb === 'number') row[`N${n}`] = vb;
    }
  }

  // bosses.json：bloodPoint[难度]
  for (const boss of Object.values(bs)) {
    const bp = boss && boss.bloodPoint;
    if (!bp || typeof bp !== 'object') continue;
    for (let n = 1; n <= 20; n++) {
      const { a, b, t } = bracket(n);
      const va = bp[a.difficulty], vb = bp[b.difficulty];
      if (typeof va === 'number' && typeof vb === 'number') bp[`N${n}`] = Math.round(lerp(va, vb, t));
      else if (typeof va === 'number') bp[`N${n}`] = va;
      else if (typeof vb === 'number') bp[`N${n}`] = vb;
    }
  }
  return { config: out, bosses: bs };
}

// ---------------------------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------------------------
const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

/**
 * 内容集里 **mota 插件自带的 `data/config.json` 会覆盖根 data/config.json**（contentSet.js：code.data 的 config 胜出）。
 * 不跟着同步的话，对局侧读到的还是插件里那份旧配置（没有 N 档、没有肉鸽 mode）——线上表现为
 * 「modeId 是 mode_rogue_n8，但 stage 池空、回合数回落 14」。
 */
export function syncMotaConfig(root = ROOT) {
  const src = path.join(root, 'data', 'config.json');
  const dst = path.join(root, 'plugins', 'mota', 'data', 'config.json');
  if (!fs.existsSync(dst)) return false;
  const base = JSON.parse(fs.readFileSync(src, 'utf8'));
  const prev = JSON.parse(fs.readFileSync(dst, 'utf8'));
  // 以**根配置为准**，但保留插件独有的键（实测只有 `economy.rogueTeam`：肉鸽团队储备那套规则块）
  const next = { ...prev, ...base };
  next.economy = { ...(prev.economy && typeof prev.economy === 'object' ? prev.economy : {}),
    ...(base.economy && typeof base.economy === 'object' ? base.economy : {}) };
  // modes 也要合并：插件在**模式记录内部**还带自己的键（如 `teamEconomy`：协同共竞/肉鸽的团队储备规则块），
  // 整份覆盖会把它们冲掉（econ-loan-policy 等测试直接读插件配置）。
  const nextModes = {};
  for (const [id, m] of Object.entries(base.modes || {})) {
    const pm = prev.modes && prev.modes[id];
    nextModes[id] = pm ? { ...pm, ...m } : m;
  }
  for (const [id, pm] of Object.entries(prev.modes || {})) if (!(id in nextModes)) nextModes[id] = pm;
  next.modes = nextModes;
  const text = JSON.stringify(next);
  if (fs.readFileSync(dst, 'utf8').trim() === text) return false;
  fs.writeFileSync(dst, text);
  console.log('nmodes: 同步 plugins/mota/data/config.json（根配置为准，保留插件独有的 economy 键）');
  return true;
}

function main(argv) {
  const check = argv.includes('--check');
  const dry = argv.includes('--dry');
  const cfgPath = path.join(ROOT, 'data', 'config.json');
  const bossPath = path.join(ROOT, 'data', 'bosses.json');
  const config = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  const bosses = JSON.parse(fs.readFileSync(bossPath, 'utf8'));
  const { config: nextConfig, bosses: nextBosses } = applyNModes(config, bosses);
  const cfgText = JSON.stringify(nextConfig);
  const bossText = JSON.stringify(nextBosses);
  if (check) {
    const sameCfg = fs.readFileSync(cfgPath, 'utf8').trim() === cfgText;
    const sameBoss = fs.readFileSync(bossPath, 'utf8').trim() === bossText;
    const dst = path.join(ROOT, 'plugins', 'mota', 'data', 'config.json');
    let sameMota = true;
    if (fs.existsSync(dst)) {
      const prev = JSON.parse(fs.readFileSync(dst, 'utf8'));
      const merged = { ...prev, ...nextConfig };
      merged.economy = { ...(prev.economy || {}), ...(nextConfig.economy || {}) };
      sameMota = fs.readFileSync(dst, 'utf8').trim() === JSON.stringify(merged);
    }
    if (!sameCfg || !sameBoss || !sameMota) {
      console.error(`nmodes: data out of date (config ${sameCfg ? 'ok' : 'differs'}, bosses ${sameBoss ? 'ok' : 'differs'}, mota ${sameMota ? 'ok' : 'differs'})`);
      process.exitCode = 1;
    } else console.log('nmodes: up to date');
    return;
  }
  const summary = N_TIERS.map((label) => {
    const m = nextConfig.modes[`mode_single_${label.toLowerCase()}`];
    const scale = m.enemyScale && m.enemyScale[m.bossRound] ? m.enemyScale[m.bossRound] : null;
    return `${label}: bossR=${m.bossRound} last=${m.lastRound} ban=${JSON.stringify(nextConfig.bans[label])} hp@boss=${scale ? scale.hp : '-'}`;
  }).join('\n');
  if (dry) { console.log(summary); return; }
  fs.writeFileSync(cfgPath, cfgText);
  fs.writeFileSync(bossPath, bossText);
  syncMotaConfig();
  console.log(summary);
  console.log('nmodes: wrote data/config.json + data/bosses.json');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
