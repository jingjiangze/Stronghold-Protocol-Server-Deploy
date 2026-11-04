// 验证 debt.deploy 真的降了 DP 回复：R2 买 deploy 档 → 读 b.start 的 flags.dpPerSec
const WS = require('ws');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  const ws = new WS(process.env.SP_WS || 'ws://127.0.0.1:3133/ws'); const msgs = []; const chunks = new Map();
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(String(d)); } catch { return; }
    if (m && m.kind === 'chunk' && Number.isInteger(m.id)) {
      const e = chunks.get(m.id) || { parts: m.parts, got: [] }; e.got[m.part] = m.text; chunks.set(m.id, e);
      if (e.got.filter((x) => typeof x === 'string').length === e.parts) { try { msgs.push(JSON.parse(e.got.join(''))); } catch {} chunks.delete(m.id); }
      return;
    }
    msgs.push(m);
  });
  await new Promise((r) => ws.on('open', r));
  let rid = 1;
  const req = (t, f = {}, timeout = 8000) => new Promise((r) => { const id = rid++; const to = setTimeout(() => r({ timeout: true }), timeout); const p = () => { const m = msgs.find((x) => x.rid === id); if (m) { clearTimeout(to); r(m); } else setTimeout(p, 40); }; ws.send(JSON.stringify({ ...f, t, rid: id })); p(); });
  const pub = () => msgs.filter((m) => m.t === 'm.public').pop() || null;
  const meltF = () => msgs.filter((m) => m.t === 'm.private' && m.meltdown).pop() || null;
  const starts = () => msgs.filter((m) => m.t === 'b.start');
  const wait = (pred, ms = 40000) => new Promise((r) => { const t0 = Date.now(); const p = () => { const m = pub(); if (m && pred(m)) return r(m); if (Date.now() - t0 > ms) return r(null); setTimeout(p, 120); }; p(); });
  await req('hello', { name: 'deployv', version: 1 }); await sleep(300);
  const meId = (msgs.find((m) => m.t === 'welcome') || {}).playerId;
  await req('room.create', { mode: 'coop', difficulty: 'NORMAL', variant: 'xie', test: true }); await sleep(400);
  const rm = msgs.filter((m) => m.t === 'room.state' && m.mode).pop(); const cs = rm.content && rm.content.cs;
  await req('room.consent', { cs, accept: true }); await req('room.contentReady', { cs });
  await req('room.addBot', {}); await sleep(150); await req('room.ready', { ready: true }); await sleep(200); await req('room.start', {});
  await wait((p) => p.phase === 'INFO_CHECK'); await req('g.infoReady', { setupRevision: 0 });
  await wait((p) => p.phase === 'BAND_DRAFT');
  for (let i = 0; i < 20; i++) { const p = pub(); if (!p || p.phase !== 'BAND_DRAFT') break; if (p.draft && p.draft.turn === meId) { for (const id of ['band_amedic','band_amiya','band_arrow','band_bldsk']) { const r = await req('g.band', { bandId: id }); if (r.t === 'ok') break; } } await sleep(400); }
  // R1 基线
  await req('g.test', { cmd: 'round', args: { round: 1 } });
  let p1 = await wait((x) => x.round === 1 && x.phase === 'PREP', 30000);
  if (p1) { const b = starts().length; await req('g.test', { cmd: 'phase', args: { name: 'combat' } }); for (let i=0;i<60;i++){ if (starts().length>b) break; await sleep(300);} }
  const s1 = starts().pop(); const dp1 = s1 && s1.spec && s1.spec.flags && s1.spec.flags.dpPerSec;
  console.log('R1 基线 dpPerSec =', dp1);
  await wait((x) => x.phase === 'SETTLE', 90000);
  // R2 买 deploy 档
  await req('g.test', { cmd: 'round', args: { round: 2 } });
  const p2 = await wait((x) => x.round === 2 && x.phase === 'PREP', 30000);
  if (!p2) { console.log('R2 无 PREP'); process.exit(0); }
  await req('g.meltOpen', {});
  let md = null; for (let i=0;i<20;i++){ md = meltF() && meltF().meltdown; if (md && Array.isArray(md.cards)) break; await sleep(300); }
  const cards = (md && md.cards) || [];
  const slot = cards.findIndex((c) => c && !c.exhausted && c.cost && c.cost.type === 'deploy');
  if (slot < 0) { console.log('本轮没有 deploy 档卡片，cards=', cards.map(c=>c.cost&&c.cost.type).join(',')); process.exit(0); }
  console.log('买 deploy 档 slot', slot, 'value', cards[slot].cost.value);
  console.log('buy ->', (await req('g.meltPick', { slot, pay: 'debuff' })).t);
  await sleep(300);
  console.log('debt =', JSON.stringify((meltF() && meltF().meltdown || {}).debt));
  await req('g.meltClose', {});
  const b2 = starts().length;
  for (let i=0;i<200;i++){ if (starts().length>b2) break; const q=pub()||{}; if (q.phase==='PREP') await req('g.test',{cmd:'phase',args:{name:'combat'}}); await sleep(400); }
  const s2 = starts().pop(); const dp2 = s2 && s2.spec && s2.spec.flags && s2.spec.flags.dpPerSec;
  console.log('R2 买后 dpPerSec =', dp2, '(期望 = 基线 × (1 - deploy/100))');
  console.log(dp2 < dp1 ? 'PASS: deploy 档已降低 DP 回复' : 'FAIL: dpPerSec 未下降');
  try { ws.close(); } catch {} process.exit(0);
})().catch((e) => { console.log('ERR', e.message); process.exit(1); });
