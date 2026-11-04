// 抓 bot 的投放 picks，验证 routeIndex / time 是否为非默认值
const WS = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ws = new WS(process.env.SP_WS || 'ws://127.0.0.1:3133/ws'); const msgs = [];
  const chunks = new Map();
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(String(d)); } catch { return; }
    if (m && m.kind === 'chunk' && Number.isInteger(m.id)) {
      const e = chunks.get(m.id) || { parts: m.parts, got: [] };
      e.got[m.part] = m.text; chunks.set(m.id, e);
      if (e.got.filter((x) => typeof x === 'string').length === e.parts) { try { msgs.push(JSON.parse(e.got.join(''))); } catch {} chunks.delete(m.id); }
      return;
    }
    msgs.push(m);
  });
  await new Promise((r) => ws.on('open', r));
  let rid = 1;
  const req = (t, f = {}, timeout = 8000) => new Promise((r) => { const id = rid++; const to = setTimeout(() => r({ timeout: true }), timeout); const p = () => { const m = msgs.find((x) => x.rid === id); if (m) { clearTimeout(to); r(m); } else setTimeout(p, 40); }; ws.send(JSON.stringify({ ...f, t, rid: id })); p(); });
  const pub = () => msgs.filter((m) => m.t === 'm.public').pop() || null;
  const wait = (pred, ms = 40000) => new Promise((r) => { const t0 = Date.now(); const p = () => { const m = pub(); if (m && pred(m)) return r(m); if (Date.now() - t0 > ms) return r(null); setTimeout(p, 120); }; p(); });
  await req('hello', { name: 'botpicks', version: 1 }); await sleep(300);
  const meId = (msgs.find((m) => m.t === 'welcome') || {}).playerId;
  await req('room.create', { mode: 'versus', difficulty: 'FUNNY', teamSize: 2, variant: 'confront', test: true }); await sleep(400);
  const rm = msgs.filter((m) => m.t === 'room.state' && m.mode).pop(); const cs = rm.content && rm.content.cs;
  await req('room.consent', { cs, accept: true }); await req('room.contentReady', { cs });
  for (let i = 0; i < 3; i++) { await req('room.addBot', {}); await sleep(120); }
  await req('room.ready', { ready: true }); await sleep(200); await req('room.start', {});
  await wait((p) => p.phase === 'INFO_CHECK'); await req('g.infoReady', { setupRevision: 0 });
  await wait((p) => p.phase === 'BAND_DRAFT');
  for (let i = 0; i < 20; i++) { const p = pub(); if (!p || p.phase !== 'BAND_DRAFT') break; if (p.draft && p.draft.turn === meId) { for (const id of ['band_amedic', 'band_amiya', 'band_arrow', 'band_bldsk']) { const r = await req('g.band', { bandId: id }); if (r.t === 'ok') break; } } await sleep(400); }
  // 第 2 回合：蓝队（全 bot）进攻
  await req('g.test', { cmd: 'round', args: { round: Number(process.argv[2] || 2) } });
  let best = null;
  for (let i = 0; i < 120; i++) {
    const p = pub();
    const c = p && p.confront;
    if (c && c.subs && Object.keys(c.subs).length) {
      const withPicks = Object.entries(c.subs).filter(([, s]) => s && Array.isArray(s.picks) && s.picks.length);
      if (withPicks.length) { best = { round: c.round, stage: c.stage, subs: withPicks }; break; }
    }
    if (p && p.phase === 'PREP') await req('g.test', { cmd: 'phase', args: { name: 'combat' } });
    await sleep(300);
  }
  if (!best) { console.log('NO SUBMISSIONS OBSERVED'); process.exit(0); }
  console.log('round=' + best.round + ' stage=' + best.stage + ' subs=' + best.subs.length);
  for (const [pid, s] of best.subs) {
    const isBot = /^ai_/.test(pid);
    console.log(`  ${isBot ? 'BOT' : 'HUMAN'} ${pid} seat=${s.picks[0] && ''} picks=`, JSON.stringify(s.picks));
  }
  const botPicks = best.subs.filter(([pid]) => /^ai_/.test(pid)).flatMap(([, s]) => s.picks);
  const withRoute = botPicks.filter((p) => Number.isInteger(p.routeIndex));
  const withTime = botPicks.filter((p) => Number.isFinite(p.time));
  console.log(`bot picks: ${botPicks.length} 条 | 带 routeIndex ${withRoute.length} | 带 time ${withTime.length}`);
  console.log(withRoute.length && withTime.length ? 'PASS: bot picks 带路线与时刻' : 'FAIL: bot picks 仍是默认值');
  try { ws.close(); } catch {} process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
