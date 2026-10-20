// bench/record.mjs — append one decision/game line to a record file.
//
// usage: node bench/record.mjs <out.jsonl> '<json>'
//   {"seed":123,"difficulty":"HARD","round":5,"kind":"buy","detail":{...},"funds":12,"hp":9,"outcome":"win"}
// Every line is validated against seeds.json (the seed must belong to the frozen benchmark), so a run that invents
// seeds cannot pass as a benchmark run.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SEEDS = JSON.parse(fs.readFileSync(path.join(HERE, 'seeds.json'), 'utf8'));
const [out, raw] = process.argv.slice(2);
if (!out || !raw) { console.error('usage: record.mjs <out.jsonl> <json>'); process.exit(2); }
let line; try { line = JSON.parse(raw); } catch { console.error('not JSON'); process.exit(2); }
const set = SEEDS.difficulties[line.difficulty] || [];
if (!set.some((x) => x.seed === line.seed)) { console.error('seed not in the benchmark set for', line.difficulty); process.exit(3); }
if (!Number.isInteger(line.round) || line.round < 0 || line.round > 200) { console.error('bad round'); process.exit(3); }
if (!['buy', 'roll', 'sell', 'levelUp', 'place', 'combine', 'ready', 'settle'].includes(line.kind)) { console.error('bad kind'); process.exit(3); }
line.benchVersion = SEEDS.version;
fs.appendFileSync(out, JSON.stringify(line) + '\n');
console.log('recorded', line.kind, 'seed', line.seed, 'round', line.round);
