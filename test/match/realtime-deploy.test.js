// 战斗中实时部署 (方案 A, spec.flags.liveDeploy) — the engine slice:
//   · the opening deployment is skipped (Battle.flags.liveDeploy → lifecycle): every board operator waits held;
//   · deployLive puts one of the player's own operators on a tapped tile (or its board tile) and charges base.cost —
//     an out-of-rect tile, an occupied tile, a knocked-out operator's tile or short DP refuses with its own reason;
//   · retreatLive withdraws a standing operator: off the field, its redeploy timer (base.respawnTime) armed, NO DP
//     refunded; the order is refused with 'respawn' until the window passes;
//   · the automatic home-tile redeploy never runs under liveDeploy (deploy.js _checkRedeploys) — the player chooses;
//   · ownership is per player (another player's uid is 'unknown'), and without the flag every path is the old one;
//   · a recorded order list (spec.cmds) is replayed at its tick, which is what a takeover re-simulation runs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle, chessRec } from '../helpers/battleHarness.js';
import { buildBattleSpec, createBattleFromSpec } from '../../server/sim/spec.js';
import { getDefaultSource } from '../../server/sim/simdata.js';

const guard = (o = {}) => chessRec({ id: 'rt_guard', profession: 'WARRIOR', stats: { atk: 100, cost: 5, maxHp: 3000, respawnTime: 4 }, skill: null, ...o });
const gunner = (o = {}) => chessRec({ id: 'rt_gunner', position: 'RANGED', rangeGrid: [[0, 0], [0, 1], [0, 2]], stats: { atk: 100, cost: 3, maxHp: 3000, respawnTime: 4 }, skill: null, ...o });

/** Two board operators of one player on the synthetic flat stage (rows 9–12 are the normal field). */
const board = (o = {}) => ({
  defs: { chess: { rt_guard: guard(), rt_gunner: gunner() } },
  units: [{ chessId: 'rt_guard', uid: 1, row: 9, col: 5 }, { chessId: 'rt_gunner', uid: 2, row: 10, col: 4 }],
  content: 'none',
  ...o,
});

/** A battle of the live-deploy mode (方案 A) — held board, no automatic redeploy. */
const liveBattle = (o = {}) => makeBattle({ ...board(), ...o, flags: { liveDeploy: true, ...(o.flags || {}) } });

const unitOf = (b, uid) => b.allyUnits.find((u) => u.uid === uid) ?? null;

/** A free, legal standing tile of the normal field for a melee / ranged operator, skipping `skip` ([r, c] pairs). */
function freeTile(b, { ranged = false, skip = [] } = {}) {
  const R = b.rect;
  for (let r = R.r0; r <= R.r1; r++) {
    for (let c = R.c0; c <= R.c1; c++) {
      if (skip.some(([sr, sc]) => sr === r && sc === c)) continue;
      if (!b.grid.canStand(r, c, { ranged })) continue;
      const occ = b._occ[r * 21 + c];
      if (occ) continue;
      if (b.downOn(r, c)) continue;
      return [r, c];
    }
  }
  return null;
}

test('liveDeploy: the opening deployment is skipped — every board operator waits held', () => {
  const h = liveBattle();
  h.step();
  const b = h.b;
  assert.equal(b.flags.liveDeploy, true);
  const held = b.players[0].units.filter((u) => u.kind === 'op');
  assert.equal(held.length, 2, 'both board pieces exist as units');
  for (const u of held) assert.equal(u.deployed, false, `${u.defId} waits held off the field`);
  // the battle itself runs: it is not finished and nothing else stalled
  assert.equal(b.finished, false);
  h.invariants();
});

test('deployLive: a tapped tile lands the operator there, charges base.cost, and its board tile stays the home', () => {
  const h = liveBattle();
  h.step();
  const b = h.b;
  const ps = b.getPlayer('p1');
  ps.dp = 40;
  const tile = freeTile(b, { skip: [[9, 5], [10, 4]] });
  assert.ok(tile, 'a free legal tile exists');
  const out = b.deployLive('p1', 1, tile);
  assert.deepEqual(out, { ok: true, uid: 1, dp: 35 }, 'ok carries the uid and the DP left after base.cost (5)');
  const u = unitOf(b, 1);
  assert.equal(u.alive && u.deployed, true, 'standing');
  assert.deepEqual([u.tileR, u.tileC], tile, 'on the tapped tile');
  assert.deepEqual([u.homeR, u.homeC], [9, 5], 'the board tile is still the home');
  h.invariants();
});

test('deployLive: an out-of-rect tile, a standing unit\'s tile and short DP are each refused with their own reason', () => {
  const h = liveBattle();
  h.step();
  const b = h.b;
  const ps = b.getPlayer('p1');
  ps.dp = 40;
  const tile = freeTile(b, { skip: [[9, 5], [10, 4]] });
  assert.ok(tile, 'a free legal tile exists');
  assert.equal(b.deployLive('p1', 1, tile).ok, true);
  assert.equal(b.deployLive('p1', 2, [2, 2]).error, 'tile', 'outside the field rect');
  const [r, c] = tile;
  assert.equal(b.deployLive('p1', 2, [r, c]).error, 'occupied', 'a living unit stands there');
  ps.dp = 1;
  assert.equal(b.deployLive('p1', 2, null).error, 'dp', 'the DP cannot afford it');
  assert.equal(unitOf(b, 2).deployed, false);
  h.invariants();
});

test('retreatLive: a standing operator is withdrawn, its timer arms, no DP comes back, and it waits for its window', () => {
  const h = liveBattle();
  h.step();
  const b = h.b;
  const ps = b.getPlayer('p1');
  ps.dp = 40;
  assert.equal(b.deployLive('p1', 1, null).ok, true, 'on its board tile');
  const u = unitOf(b, 1);
  assert.equal(u.alive, true);
  const dpBefore = ps.dp;

  // a piece that is not standing cannot be withdrawn
  assert.equal(b.retreatLive('p1', 2).error, 'notdeployed');

  assert.deepEqual(b.retreatLive('p1', 1), { ok: true, uid: 1 });
  assert.equal(u.alive, false, 'withdrawn');
  assert.ok(Number.isFinite(u.respawnAt) && u.respawnAt > b.time, 'the redeploy timer armed');
  assert.equal(ps.dp, dpBefore, 'a retreat refunds nothing');

  // before the window: refused
  assert.equal(b.deployLive('p1', 1, null).error, 'respawn');
  // the automatic home-tile redeploy never runs under liveDeploy (it would fire once base.respawnTime passed)
  u.respawnAt = b.time;
  for (let i = 0; i < 5; i++) b.step();
  assert.equal(u.deployed, false, 'no automatic redeploy in live mode');

  // after the window (and with DP): back on its board tile, paying base.cost again — no penalty multiplier
  ps.dp = 40;
  const back = b.deployLive('p1', 1, null);
  assert.deepEqual(back, { ok: true, uid: 1, dp: 35 }, 'the return costs base.cost (5), not 1.5× / 2×');
  assert.equal(u.alive && u.deployed, true);
  assert.deepEqual([u.tileR, u.tileC], [u.homeR, u.homeC], 'no tile named = the board tile');
  h.invariants();
});

test('deployLive: ownership is per player — another player\'s uid is unknown', () => {
  const h = liveBattle({
    players: [
      { playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [{ uid: 1, kind: 'chess', chessId: 'rt_guard', row: 9, col: 5 }] },
      { playerId: 'p2', seat: 1, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units: [{ uid: 9, kind: 'chess', chessId: 'rt_guard', row: 10, col: 7 }] },
    ],
  });
  h.step();
  const b = h.b;
  assert.equal(b.deployLive('p2', 1, null).error, 'unknown', "p1's uid is not p2's to deploy");
  assert.equal(b.retreatLive('p2', 1).error, 'unknown');
  assert.equal(b.deployLive('nobody', 1, null).error, 'player', 'an unknown player has no units');
  const own = b.players.find((p) => p.playerId === 'p2').units.find((u) => u.uid === 9);
  b.getPlayer('p2').dp = 40;
  assert.equal(b.deployLive('p2', 9, [own.homeR, own.homeC]).ok, true, 'its own operator deploys');
  h.invariants();
});

test('liveDeploy off: the opening deployment, the automatic redeploy and every refusal are the old ones', () => {
  const h = makeBattle(board()); // no flags.liveDeploy
  h.step();
  const b = h.b;
  assert.equal(b.flags.liveDeploy, undefined);
  for (const u of b.players[0].units.filter((x) => x.kind === 'op')) assert.equal(u.deployed, true, 'deployed at battle start');
  assert.deepEqual(b.deployLive('p1', 1, null), { ok: false, error: 'mode' });
  assert.deepEqual(b.retreatLive('p1', 1), { ok: false, error: 'mode' });
  // the automatic redeploy still runs: a knock-out comes back on its own once the timer is done
  const u = unitOf(b, 1);
  b.kill(u);
  assert.equal(u.alive, false);
  assert.ok(u.respawnAt > b.time, 'the redeploy timer armed');
  u.respawnAt = b.time;
  b.getPlayer('p1').dp = 40;
  b.step();
  assert.equal(u.alive && u.deployed, true, 'the automatic redeploy brought it back');
  h.invariants();
});

test('liveDeploy: a recorded order list (spec.cmds) is replayed at its tick — a takeover re-simulation deploys it', () => {
  // the spec plumbing: no orders ⇒ no key (an official spec is unchanged); with orders ⇒ carried and attached to the Battle
  const ds = getDefaultSource();
  const units = [{ uid: 1, kind: 'chess', chessId: 'chess_char_1_01_a', row: 10, col: 5 }];
  const spec = (cmds) => buildBattleSpec({
    battleId: 'rt-cmds', fieldId: 'n:p1', kind: 'normal', seed: 7, modeId: 'mode_multi_normal', round: 1, stageId: 'act2autochess_m01',
    timeLimit: 60, players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, bonds: {}, playerEffects: [], units }],
    spawns: [], routes: [], flags: { liveDeploy: true, dpInit: 40 },
    ...(cmds ? { cmds } : {}),
  });
  assert.equal(Object.hasOwn(spec(), 'cmds'), false, 'no cmds key when the match recorded none');
  const s = spec([[15, 'p1', 'deploy', 1, 11, 6]]);
  assert.deepEqual(s.cmds, [[15, 'p1', 'deploy', 1, 11, 6]]);
  const fromSpec = createBattleFromSpec(s, ds, { quiet: true, recordEvents: false });
  assert.deepEqual(fromSpec._cmds, [[15, 'p1', 'deploy', 1, 11, 6]], 'createBattleFromSpec attaches the recorded orders');
  assert.equal(fromSpec._cmdI, 0);

  // the replay at its tick: a battle that runs on (the harness keeps it running) holds the piece until tick 15
  const h = liveBattle();
  const b = h.b;
  b._cmds = [[15, 'p1', 'deploy', 1, 11, 6]];
  b._cmdI = 0;
  const u = () => unitOf(b, 1);
  // the first step is tick 0: the order is not applied before its tick…
  for (let i = 0; i < 15; i++) b.step();
  assert.equal(b.tickCount, 15);
  assert.equal(u().deployed, false, 'still held before its tick');
  // …and lands on the next step
  b.step();
  assert.equal(u().deployed, true, 'replayed at tick 15');
  assert.deepEqual([u().tileR, u().tileC], [11, 6]);
  h.invariants();
});
