// 协同（xie）× 三层资金冒烟：建房 → 开局 → 推到第 2 回合，确认服务端没抛异常。
const WS = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ws = new WS(process.env.SP_WS || 'ws://127.0.0.1:3133/ws'); const msgs = [];
  ws.on('message', (d) => { try { msgs.push(JSON.parse(String(d))); } catch {} });
  await new Promise((r) => ws.on('open', r));
  let rid = 1;
  const req = (t, f = {}, timeout = 8000) => new Promise((r) => { const id = rid++; const to = setTimeout(() => r({ timeout: true }), timeout); const p = () => { const m = msgs.find((x) => x.rid === id); if (m) { clearTimeout(to); r(m); } else setTimeout(p, 40); }; ws.send(JSON.stringify({ ...f, t, rid: id })); p(); });
  const pub = () => msgs.filter((m) => m.t === 'm.public').pop() || null;
  const priv = () => msgs.filter((m) => m.t === 'm.private').pop() || null;
  const wait = (pred, ms = 25000) => new Promise((r) => { const t0 = Date.now(); const p = () => { const m = pub(); if (m && pred(m)) return r(m); if (Date.now() - t0 > ms) return r(null); setTimeout(p, 120); }; p(); });
  await req('hello', { name: 'cooprun', version: 1 }); await sleep(300);
  const meId = (msgs.find((m) => m.t === 'welcome') || {}).playerId;
  const cr = await req('room.create', { mode: 'coop', difficulty: 'NORMAL', variant: 'xie', coopScope: 'team', test: true });
  console.log('create:', cr.t, cr.code || '');
  await sleep(400);
  const rm = msgs.filter((m) => m.t === 'room.state' && m.mode).pop();
  const cs = rm && rm.content && rm.content.cs;
  if (cs) { await req('room.consent', { cs, accept: true }); await req('room.contentReady', { cs }); }
  await req('room.addBot', {}); await sleep(150);
  await req('room.ready', { ready: true }); await sleep(200);
  console.log('start:', JSON.stringify(await req('room.start', {})).slice(0, 80));
  await wait((p) => p.phase === 'INFO_CHECK'); await req('g.infoReady', { setupRevision: 0 });
  await wait((p) => p.phase === 'BAND_DRAFT');
  for (let i = 0; i < 20; i++) { const p = pub(); if (!p || p.phase !== 'BAND_DRAFT') break; if (p.draft && p.draft.turn === meId) { for (const id of ['band_amedic', 'band_amiya', 'band_arrow', 'band_bldsk']) { const r = await req('g.band', { bandId: id }); if (r.t === 'ok') break; } } await sleep(400); }
  for (let round = 1; round <= 2; round++) {
    const p = await wait((x) => x.phase === 'PREP' && x.round === round, 30000);
    if (p) {
      const e = priv() && priv().econ;
      console.log(`round ${round}: PREP ok, priv.econ keys =`, e ? Object.keys(e).join(',') : '(none)', '| funds', e && e.funds, '| reserve', e && e.reserve);
      await req('g.test', { cmd: 'phase', args: { name: 'combat' } });
    } else {
      console.log(`round ${round}: no PREP (phase=${(pub() || {}).phase})`);
      break;
    }
    await wait((x) => x.phase === 'SETTLE', 90000);
  }
  const e2 = priv() && priv().econ;
  console.log('after: funds', e2 && e2.funds, 'reserve', e2 && e2.reserve);
  try { ws.close(); } catch {} process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
