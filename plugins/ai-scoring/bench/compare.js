// bench/compare.mjs — aggregate two record files over the same benchmark and print the delta.
//
// usage: node bench/compare.mjs <a.jsonl> <b.jsonl>
// Games are keyed by (difficulty, seed); a game counts as a win when any settle line says outcome=win.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const load = (f) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const summarize = (rows) => {
  const games = new Map();
  for (const r of rows) {
    const k = r.difficulty + ':' + r.seed;
    const g = games.get(k) || { difficulty: r.difficulty, seed: r.seed, win: false, funds: [], rounds: 0, kinds: {} };
    if (r.kind === 'settle' && r.outcome === 'win') g.win = true;
    if (Number.isFinite(r.funds)) g.funds.push(r.funds);
    if (Number.isFinite(r.round)) g.rounds = Math.max(g.rounds, r.round);
    g.kinds[r.kind] = (g.kinds[r.kind] || 0) + 1;
    games.set(k, g);
  }
  const all = [...games.values()];
  const byDiff = {};
  for (const d of ['FUNNY', 'NORMAL', 'HARD', 'ABYSS']) {
    const list = all.filter((g) => g.difficulty === d);
    const wins = list.filter((g) => g.win).length;
    const funds = list.flatMap((g) => g.funds);
    byDiff[d] = {
      games: list.length, wins,
      winRate: list.length ? +(wins / list.length * 100).toFixed(1) : 0,
      avgFunds: funds.length ? +(funds.reduce((a, b) => a + b, 0) / funds.length).toFixed(1) : 0,
      buys: list.reduce((n, g) => n + (g.kinds.buy || 0), 0),
      rolls: list.reduce((n, g) => n + (g.kinds.roll || 0), 0),
      levelUps: list.reduce((n, g) => n + (g.kind || g.kinds.levelUp || 0), 0),
    };
  }
  return byDiff;
};
const [fa, fb] = process.argv.slice(2);
if (!fa || !fb) { console.error('usage: compare.mjs <a.jsonl> <b.jsonl>'); process.exit(2); }
const A = summarize(load(fa));
const B = summarize(load(fb));
console.log('difficulty   A:games/wins/rate/avgFunds      B:games/wins/rate/avgFunds      ΔwinRate  Δfunds');
for (const d of Object.keys(A)) {
  const a = A[d], b = B[d];
  const dw = +(b.winRate - a.winRate).toFixed(1);
  const df = +(b.avgFunds - a.avgFunds).toFixed(1);
  console.log(d.padEnd(12), String(a.games).padStart(3), String(a.wins).padStart(3), String(a.winRate).padStart(6), String(a.avgFunds).padStart(9), '   ',
    String(b.games).padStart(3), String(b.wins).padStart(3), String(b.winRate).padStart(6), String(b.avgFunds).padStart(9), '   ',
    String(dw).padStart(8), String(df).padStart(8));
}
