import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { startServer } from '../server/boot-main.js';
import { Match } from '../server/match/Match.js';
import { LEGACY_BOT } from '../server/match/botStrategyContract.js';
import { TestClient } from './helpers/wsClient.js';

test('invalid SP_BOT_STRATEGY rejects startup before data loading or listening', async () => {
  const previous = process.env.SP_BOT_STRATEGY;
  try {
    process.env.SP_BOT_STRATEGY = 'legcay';
    // A nonexistent data directory would fail first if validation were deferred until after loading.
    await assert.rejects(startServer({ port: 0, quiet: true, dataDir: 'missing-bot-strategy-test-data' }), (error) => {
      assert.match(error.message, /Invalid SP_BOT_STRATEGY/);
      assert.match(error.message, /Unknown bot strategy: legcay; available: legacy/);
      assert.match(error.message, /Unset SP_BOT_STRATEGY/);
      return true;
    });
  } finally {
    if (previous == null) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = previous;
  }
});

test('unset, empty and explicit legacy selections start a real room with a working AI teammate', async (t) => {
  const previous = process.env.SP_BOT_STRATEGY;
  try {
    for (const selection of [undefined, '', 'legacy']) {
      await t.test(`SP_BOT_STRATEGY=${String(selection)}`, async () => {
        if (selection == null) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = selection;
        let match, client;
        class OpeningMatch extends Match {
          constructor(opts) { super({ ...opts, timerScale: 0.01, botRehearsal: 0, botSliceMs: 0.001 }); match = this; }
        }
        const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, assetIndex: false, studio: false,
          MatchClass: OpeningMatch, seedFn: () => 69 });
        try {
          const res = await fetch(`${srv.url}/healthz`);
          assert.equal(res.status, 200);
          client = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
          const welcome = await client.hello('BotTest');
          const request = async (msg) => assert.equal((await client.request(msg)).t, 'ok', msg.t);
          await request({ t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
          await request({ t: 'room.addBot' });
          await request({ t: 'room.start' });
          await client.waitFor('m.public', (p) => p.phase === 'INFO_CHECK');
          assert.equal(match.bot, LEGACY_BOT);
          await request({ t: 'g.infoReady' });
          const draft = await client.waitFor('m.public', (p) => p.phase === 'BAND_DRAFT' && p.draft.turn === welcome.playerId, 10000);
          const taken = new Set(Object.values(draft.draft.picks));
          await request({ t: 'g.band', bandId: match.gd.bandIds().find((id) => !taken.has(id)) });
          await client.waitFor('m.public', (p) => p.phase === 'PREP' && p.round === 1 && p.players.some((ps) => ps.isBot && ps.ready), 10000);
          const ai = match.order.find((ps) => ps.isBot);
          assert.ok(ai.bandId && ai.ready && ai.board.size > 0, 'the real bot drafted, bought and deployed');
          assert.equal(match.errorCount, 0);
        } finally { await client?.terminate(); await srv.close(); }
      });
    }
  } finally {
    if (previous == null) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = previous;
  }
});

test('the process entry reports an invalid strategy on the boot-diag port instead of serving a game', async () => {
  // runMain opens the boot-diag port when start() throws (containers judge health by the port, and their logs are often
  // unreadable), so the entry no longer exits for a bad configuration: what this pins is the report it serves — the
  // strategy it rejected — and that no game is listening behind it.
  const probe = net.createServer();
  const port = await new Promise((resolve) => probe.listen(0, '127.0.0.1', () => resolve(probe.address().port)));
  await new Promise((r) => probe.close(r));
  const child = spawn(process.execPath, ['server/index.js'], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    env: { ...process.env, SP_BOT_STRATEGY: 'legcay', PORT: String(port), HOST: '127.0.0.1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (b) => { log += b; });
  child.stderr.on('data', (b) => { log += b; });
  try {
    let body = null;
    for (let i = 0; i < 100 && !body; i++) {
      try { body = await (await fetch(`http://127.0.0.1:${port}/healthz`)).json(); }
      catch { await new Promise((r) => setTimeout(r, 150)); }
    }
    assert.ok(body, `the boot-diag port never answered; log:\n${log}`);
    assert.equal(body.ok, false);
    assert.equal(body.boot, 'failed');
    assert.match(body.error, /Invalid SP_BOT_STRATEGY: Unknown bot strategy: legcay; available: legacy/);
    assert.match(body.error, /Unset SP_BOT_STRATEGY/);
    assert.equal(body.env.PORT, String(port));
    assert.match(log, /\[boot\] failed to start/);
    assert.doesNotMatch(log, /Local:/, 'no game is served');
  } finally {
    child.kill();
  }
});

test('external selection requires operator transport configuration before listening', async () => {
  const previous = { strategy: process.env.SP_BOT_STRATEGY, transport: process.env.SP_EXTERNAL_AI_TRANSPORT };
  try {
    process.env.SP_BOT_STRATEGY = 'external';
    delete process.env.SP_EXTERNAL_AI_TRANSPORT;
    await assert.rejects(startServer({ port: 0, host: '127.0.0.1', quiet: true, dataDir: 'missing-external-test-data' }), /SP_EXTERNAL_AI_TRANSPORT/);
  } finally {
    if (previous.strategy == null) delete process.env.SP_BOT_STRATEGY; else process.env.SP_BOT_STRATEGY = previous.strategy;
    if (previous.transport == null) delete process.env.SP_EXTERNAL_AI_TRANSPORT; else process.env.SP_EXTERNAL_AI_TRANSPORT = previous.transport;
  }
});
