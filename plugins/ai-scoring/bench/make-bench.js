// plugins/ai-scoring/bench/make-bench.mjs — build the fixed benchmark seed set.
//
// Metho dology borrowed from HankDUMPLINGZhong/Stronghold-Protocol-AI's enemy-diversity-v1: seeds are chosen for
// COVERAGE of stages, never for how well a policy scores on them. The set is frozen in seeds.json; every later run
// uses exactly those seeds, so two policies are always compared on the same games.
//
// usage: node plugins/ai-scoring/bench/make-bench.mjs [--write]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const DIFFICULTIES = ['FUNNY', 'NORMAL', 'HARD', 'ABYSS'];
const PER_DIFFICULTY = 28;
const CANDIDATES = 10000;

const stages = (() => {
  const raw = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/stages.json'), 'utf8'));
  const list = Array.isArray(raw) ? raw : Object.values(raw.stages || raw);
  return list.map((s) => String(s.id)).sort();
})();

/** The stage a seed would field: a stable hash, the same shape the game derives stages with (no RNG state needed). */
const stageFor = (seed) => {
  const h = createHash('sha256').update(`stage:${seed}`).digest();
  return stages[h.readUInt32BE(0) % stages.length];
};

const pick = () => {
  const byStage = new Map(stages.map((id) => [id, []]));
  for (let i = 0; i < CANDIDATES; i++) {
    const seed = (0x5eed0000 + i) >>> 0;
    const id = stageFor(seed);
    const bucket = byStage.get(id);
    if (bucket && bucket.length < 8) bucket.push(seed);
  }
  const out = [];
  for (let round = 0; out.length < PER_DIFFICULTY; round++) {
    for (const id of stages) {
      const seed = byStage.get(id)[round];
      if (seed === undefined) continue;
      out.push({ index: out.length + 1, stage: id, seed });
      if (out.length === PER_DIFFICULTY) break;
    }
    if (round > 64) break;
  }
  return out;
};

const base = pick();
const bench = {
  version: 'lineup-bench-v1',
  note: '种子按关卡覆盖挑，不看任何策略的胜负；改动评分器后必须跑完整集合。',
  generatedAt: new Date().toISOString(),
  stages,
  difficulties: Object.fromEntries(DIFFICULTIES.map((d) => [d, base.map((x, i) => ({ ...x, seed: ((x.seed + i * 0x9e37 + d.length * 7919) >>> 0) }))])),
};

if (process.argv.includes('--write')) {
  fs.writeFileSync(path.join(HERE, 'seeds.json'), JSON.stringify(bench, null, 2) + '\n');
  console.log('wrote seeds.json:', DIFFICULTIES.map((d) => `${d}=${bench.difficulties[d].length}`).join(' '));
} else {
  console.log('dry run:', DIFFICULTIES.map((d) => `${d}=${bench.difficulties[d].length}`).join(' '), '| stages covered:', new Set(base.map((x) => x.stage)).size);
}
