// bench/provenance.mjs — stamp a record file with what produced it (bench + scorer version + git sha).
// usage: node bench/provenance.mjs <out.json> [scorerVersion]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../../..');
const SEEDS = JSON.parse(fs.readFileSync(path.join(HERE, 'seeds.json'), 'utf8'));
let sha = 'unknown';
try { sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: ROOT }).toString().trim(); } catch { /* not a repo */ }
const out = process.argv[2] || path.join(HERE, 'provenance.json');
const doc = {
  benchVersion: SEEDS.version,
  scorerVersion: process.argv[3] || 'unknown',
  gitSha: sha,
  seeds: Object.fromEntries(Object.entries(SEEDS.difficulties).map(([d, list]) => [d, list.length])),
  ranAt: new Date().toISOString(),
};
fs.writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
console.log('provenance →', out, JSON.stringify(doc));
