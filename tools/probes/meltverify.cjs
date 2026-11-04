// 熔毁代价的**战斗数值**验证：协同房打到 R3 → 买一格（debuff 支付）→ 打一场 → 读 b.start.spawns[].mods
// 期望：hpMul ≈ enemyScale[round].hpMul × (1 + allStats/100) × meltHpMul(dmg)
const WS = require('ws');
const fs = require('fs');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cfg = JSON.parse(fs.readFileSync('plugins/mota/data/config.json', 'utf8'));
const scal = ((cfg.modes['mode_xie_normal'] || {}).enemyScale) || {};
const pickMode = 'mode_xie_normal';
const scaleOf = (r) => ((cfg.modes[pickMode] || {}).enemyScale || {})[String(r)] || {};

(async () => {
  const ws = new WS(process.env.SP_WS || 'ws://127.0.0.1:3133/ws'); const msgs = [];
  const chunks = new Map();
  ws.on('message', (d) => {
    let m; try { m = JSON.parse(String(d)); } catch { return; }
    // 大帧会被切成 {kind:'chunk', id, part, parts, text}，这里按 id 重组后再当普通消息用
    if (m && m.kind === 'chunk' && Number.isInteger(m.id) && Number.isInteger(m.part)) {
      const e = chunks.get(m.id) || { parts: m.parts, got: [] };
      e.got[m.part] = m.text; chunks.set(m.id, e);
      if (e.got.filter((x) => typeof x === 'string').length === e.parts) {
        try { msgs.push(JSON.parse(e.got.join(''))); } catch {}
        chunks.delete(m.id);
      }
      return;
    }
    msgs.push(m);
  });
  await new Promise((r) => ws.on('open', r));
  let rid = 1;
  const req = (t, f = {}, timeout = 8000) => new Promise((r) => { const id = rid++; const to = setTimeout(() => r({ timeout: true }), timeout); const p = () => { const m = msgs.find((x) => x.rid === id); if (m) { clearTimeout(to); r(m); } else setTimeout(p, 40); }; ws.send(JSON.stringify({ ...f, t, rid: id })); p(); });
  const pub = () => msgs.filter((m) => m.t === 'm.public').pop() || null;
  const priv = () => msgs.filter((m) => m.t === 'm.private').pop() || null;
  const meltFrame = () => msgs.filter((m) => m.t === 'm.private' && m.meltdown).pop() || null;
  const starts = () => msgs.filter((m) => m.t === 'b.start');
  const wait = (pred, ms = 40000) => new Promise((r) => { const t0 = Date.now(); const p = () => { const m = pub(); if (m && pred(m)) return r(m); if (Date.now() - t0 > ms) return r(null); setTimeout(p, 120); }; p(); });

  await req('hello', { name: 'meltv', version: 1 }); await sleep(300);
  const meId = (msgs.find((m) => m.t === 'welcome') || {}).playerId;
  console.log('create:', (await req('room.create', { mode: 'coop', difficulty: 'NORMAL', variant: 'xie', coopScope: 'team', test: true })).t);
  await sleep(400);
  const rm = msgs.filter((m) => m.t === 'room.state' && m.mode).pop(); const cs = rm.content && rm.content.cs;
  if (cs) { await req('room.consent', { cs, accept: true }); await req('room.contentReady', { cs }); }
  await req('room.addBot', {}); await sleep(150);
  await req('room.ready', { ready: true }); await sleep(200); await req('room.start', {});
  await wait((p) => p.phase === 'INFO_CHECK'); await req('g.infoReady', { setupRevision: 0 });
  await wait((p) => p.phase === 'BAND_DRAFT');
  for (let i = 0; i < 20; i++) { const p = pub(); if (!p || p.phase !== 'BAND_DRAFT') break; if (p.draft && p.draft.turn === meId) { for (const id of ['band_amedic', 'band_amiya', 'band_arrow', 'band_bldsk']) { const r = await req('g.band', { bandId: id }); if (r.t === 'ok') break; } } await sleep(400); }

  const modsAt = () => { const s = starts().pop(); const sp = s && s.spec && s.spec.spawns; return Array.isArray(sp) && sp.length ? sp[0].mods : null; };
  const nStarts = () => starts().length;

  // R1：基线（无熔毁）
  await req('g.test', { cmd: 'round', args: { round: 1 } });
  { const p = await wait((x) => x.round === 1 && x.phase === 'PREP', 30000);
    if (p) { const b = nStarts(); await req('g.test', { cmd: 'phase', args: { name: 'combat' } }); for (let i=0;i<60;i++){ if (nStarts()>b) break; await sleep(300);} }
    console.log('R1: spawn mods =', JSON.stringify(modsAt()));
    await wait((x) => x.phase === 'SETTLE', 90000); }

  // R2 PREP：手动开熔毁商店 → 买一格（debuff 支付）→ 关店 → 打这一回合
  await req('g.test', { cmd: 'round', args: { round: 2 } });
  const p2 = await wait((x) => x.round === 2 && x.phase === 'PREP', 30000);
  if (!p2) { console.log('R2: no PREP'); process.exit(0); }
  console.log('R2 基线（未买）: spawn 未打，先买');
  console.log('meltOpen ->', JSON.stringify(await req('g.meltOpen', {})).slice(0, 60));
  let md = null;
  for (let i = 0; i < 20; i++) { md = (meltFrame() && meltFrame().meltdown) || null; if (md && Array.isArray(md.cards)) break; await sleep(300); }
  if (!md || !Array.isArray(md.cards)) {
    const pv = priv() || {};
    console.log('meltOpen 后仍没开 | priv keys =', Object.keys(pv).join(','), '| meltdown =', JSON.stringify(pv.meltdown).slice(0, 100));
    console.log('  所有 m.private 帧数 =', msgs.filter((x) => x.t === 'm.private').length, '| 带 meltdown 的 =', msgs.filter((x) => x.t === 'm.private' && x.meltdown).length);
    process.exit(0);
  }
  const cards = Array.isArray(md.cards) ? md.cards : [];
  let slot = cards.findIndex((c) => c && !c.exhausted && !c.sold && c.cost && (c.cost.type === 'dmg' || c.cost.type === 'allStats'));
  if (slot < 0) slot = cards.findIndex((c) => c && !c.exhausted && !c.sold);
  console.log('cards:', cards.map((c,i)=>`${i}:${c.kind}/${c.cost?c.cost.type+'+'+c.cost.value:'-'}${c.exhausted?'(空)':''}`).join(' '), '=> buy', slot);
  console.log('buy ->', JSON.stringify(await req('g.meltPick', { slot: slot < 0 ? 0 : slot, pay: 'debuff' })).slice(0, 60));
  await sleep(400);
  const md2 = (meltFrame() && meltFrame().meltdown) || null;
  const debt = (md2 && md2.debt) || {};
  console.log('debt after buy =', JSON.stringify(debt), '| growth =', md2 && md2.growth);
  console.log('meltClose ->', JSON.stringify(await req('g.meltClose', {})).slice(0, 60));

  // 打 R2
  const b2 = nStarts();
  for (let i = 0; i < 200; i++) {
    if (nStarts() > b2) break;
    const q = pub() || {};
    if (q.phase === 'PREP') await req('g.test', { cmd: 'phase', args: { name: 'combat' } });
    await sleep(400);
  }
  const m2 = modsAt();
  const sc = scaleOf(2);
  const gm = 1 + ((Number(debt.allStats) || 0) + (Number(md2 && md2.growth) || 0)) / 100;
  const hm = 1 / Math.max(0.2, 1 - Math.min(0.8, (Number(debt.dmg) || 0) / 100));
  const expectHp = (Number(sc.hp) || 1) * gm * hm;
  const expectAtk = (Number(sc.atk) || 1) * gm;
  console.log(`R2(买后): spawn mods = ${JSON.stringify(m2)}`);
  console.log(`R2: scale=${JSON.stringify(sc)} gm=${gm.toFixed(3)} hm=${hm.toFixed(3)} => expect hpMul≈${expectHp.toFixed(3)} atkMul≈${expectAtk.toFixed(3)}`);
  const ok = m2 && Math.abs(Number(m2.hpMul) - expectHp) < 0.03 && Math.abs(Number(m2.atkMul) - expectAtk) < 0.03;
  console.log(ok ? 'PASS: 熔毁代价已作用到战斗 spawn' : 'FAIL: spawn mods 与期望不符');
  try { ws.close(); } catch {} process.exit(0);
})().catch((e) => { console.log('ERR', e.stack || e.message); process.exit(1); });
