// plugins/ai-scoring/bench/run.mjs — drive the frozen benchmark through the headless match runner and record it.
//
// usage:
//   node plugins/ai-scoring/bench/run.mjs <out.jsonl> [--difficulty FUNNY|NORMAL|HARD|ABYSS|ALL] [--limit N]
//
// Each run is `tools/matchrun.mjs --mode coop --players 2 --seed <frozen seed>` (virtual time, real simulation). The
// runner reports per round: lp / level / units / killed / total / leaks; that is what lands in the record as a
// `settle` line per round plus one final `settle` with the outcome. buy/roll/sell/levelUp/combine are already legal
// in record.mjs — they need a hook in the match (the runner does not expose the shop), which is the next step.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SEEDS = JSON.parse(fs.readFileSync(path.join(HERE, 'seeds.json'), 'utf8'));

const args = process.argv.slice(2);
const out = args[0];
if (!out) { console.error('usage: run.mjs <out.jsonl> [--difficulty D] [--limit N]'); process.exit(2); }
const opt = (name, fallback) => { const i = args.indexOf('--' + name); return i > 0 && args[i + 1] ? args[i + 1] : fallback; };
const want = opt('difficulty', 'HARD').toUpperCase();
const limit = Number(opt('limit', '0')) || 0;

const diffs = want === 'ALL' ? Object.keys(SEEDS.difficulties) : [want];
if (!SEEDS.difficulties[diffs[0]]) { console.error('no such difficulty in the benchmark'); process.exit(2); }

let wrote = 0;
for (const d of diffs) {
  let list = SEEDS.difficulties[d];
  if (limit) list = list.slice(0, limit);
  for (const item of list) {
    const raw = execFileSync('node', ['tools/matchrun.mjs', '--mode', 'coop', '--difficulty', d, '--players', '2', '--seed', String(item.seed), '--json', '--quiet'], { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }).toString();
    const [run] = JSON.parse(raw);
    for (const r of run.rounds || []) {
      const p = Object.values(r.players || {})[0] || {};
      fs.appendFileSync(out, JSON.stringify({
        benchVersion: SEEDS.version, difficulty: d, seed: item.seed, stage: run.stageId, round: r.round, kind: 'settle',
        lp: p.lp, level: p.level, units: p.units, kills: p.killed, leaks: p.leaks,
      }) + '\n');
      wrote++;
    }
    fs.appendFileSync(out, JSON.stringify({
      benchVersion: SEEDS.version, difficulty: d, seed: item.seed, round: run.roundsPassed || 0, kind: 'settle',
      outcome: run.victory ? 'win' : 'loss', stage: run.stageId, bossId: run.bossId,
    }) + '\n');
    wrote++;
    console.log(d, 'seed', item.seed, run.victory ? 'win' : 'loss', 'rounds', run.roundsPassed);
  }
}
console.log('recorded', wrote, 'lines →', out);
