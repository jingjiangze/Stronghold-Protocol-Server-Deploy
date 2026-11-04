// test/match/econ-loan-policy.test.js — 协同借贷 P1（2026-11-01，审计 findings §1.4）：
//   ① 池垫付只在借款人落后于队伍中位数时生效（transfer.poolFillBehindOnly，默认开）；
//   ② 债务账本独立开关（debtLedger，默认开，利息仍 0）：借出即记账、催钱可用、还钱清账；
//   ③ botLend 不再被 maxPct 预钳：配置 basePct 75 生效，最终上限在 econBotLendChance 里按 maxPct 钳；
//   ④ bot 有余粮主动存 1 点进团队储备（每人每回合 1 次）。
// 团队经济的方法住在 mota 插件的 Match 里（不是核心 Match），所以这里用 harness 的 matchClass 挂插件类。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GameData } from '../../plugins/mota/server/match/gamedata.js';
import { Match as MotaMatch } from '../../plugins/mota/server/match/Match.js';
import { botEconMaybeDeposit } from '../../plugins/mota/server/match/bot.js';
import { tileKey } from '../../server/match/board.js';
import { DATA, makeMatch, legalTileFor, chessOfTier } from './harness.js';

const PLUGIN_CFG = JSON.parse(fs.readFileSync(new URL('../../plugins/mota/data/config.json', import.meta.url), 'utf8'));
const pluginGd = (modeId) => new GameData({ config: PLUGIN_CFG, chess: {} }, modeId);
const CHESS_IDS = chessOfTier(1);

/** deployCount 是 board 上 kind==='chess' 的计数（getter，不可赋值）——往棋盘**追加** n 个棋子。 */
function deployN(m, ps, n) {
  const used = new Set([...ps.board.keys()]);
  const before = ps.deployCount;
  for (let i = 0; i < n; i++) {
    const id = CHESS_IDS[(before + i) % CHESS_IDS.length];
    const rc = legalTileFor(m, ps, id, used);
    assert.ok(rc, `legal tile for chess #${i}`);
    const key = tileKey(rc[0], rc[1]);
    used.add(key);
    ps.board.set(key, ps.newPiece('chess', id, { poolCopies: 0 }));
  }
  assert.equal(ps.deployCount, before + n);
}

const xieMatch = (o = {}) => makeMatch({
  matchClass: MotaMatch, mode: 'coop', modeId: 'mode_xie_normal', difficulty: 'NORMAL',
  humans: 2, bots: 1, seed: 11, fake: true, data: { ...DATA, config: PLUGIN_CFG }, ...o,
});

test('gamedata：botLend basePct 75 不再被预钳；debtLedger / poolFillBehindOnly 默认开', () => {
  const te = pluginGd('mode_xie_normal').teamEconomy;
  assert.ok(te, 'xie 模式必须有团队经济');
  assert.equal(te.botLend.basePct, 75, '配置的 basePct 原样生效');
  assert.equal(te.botLend.maxPct, 95, '四模式配置的上限已抬到 95');
  assert.equal(te.debtLedger, true, '债务账本默认开');
  assert.equal(te.transfer.poolFillBehindOnly, true, '池垫付默认只在落后时');
  // 显式关掉时映射为 false（逃生门）
  const cfg = JSON.parse(JSON.stringify(PLUGIN_CFG));
  const teCfg = cfg.modes.mode_xie_normal.teamEconomy;
  teCfg.debtLedger = false;
  teCfg.transfer.poolFillBehindOnly = false;
  const gd2 = new GameData({ config: cfg, chess: {} }, 'mode_xie_normal');
  assert.equal(gd2.teamEconomy.debtLedger, false);
  assert.equal(gd2.teamEconomy.transfer.poolFillBehindOnly, false);
});

test('池垫付：借款人健康 ⇒ 请求走队友、池子不动；借款人落后 ⇒ 池子救助垫付', () => {
  const h = xieMatch();
  h.start();
  h.toPrep(1);
  const m = h.m;
  const [p0, p1, ai] = [h.ps('p_0'), h.ps('p_1'), h.ps('ai_0')];
  m.teamReserve = 5;
  // 健康：三人部署数相同 ⇒ 没人落后 ⇒ 池子不垫，请求发给队友
  deployN(m, p0, 3); deployN(m, p1, 3); deployN(m, ai, 3);
  assert.equal(m.econBorrowerBehind(p0.playerId), 0);
  assert.deepEqual(m.econRequest(p0, 'ai_0', 1), { ok: true });
  assert.equal(m.teamReserve, 5, '健康借款人不动用池子');
  assert.equal(m.econRequests.size, 1, '请求单已发出（问队友）');
  for (const req of [...m.econRequests.values()]) m.econCloseRequest(req, 'test');
  assert.equal(m.econRequests.size, 0);
  // 落后：自己 0 只、队友各 4 只 ⇒ behind > 0 ⇒ 池子直接垫付，不建请求单
  deployN(m, p1, 1); deployN(m, ai, 1);
  assert.ok(m.econBorrowerBehind(p0.playerId) > 0);
  const funds0 = p0.funds;
  assert.deepEqual(m.econRequest(p0, 'ai_0', 1), { ok: true });
  assert.equal(m.teamReserve, 4, '落后借款人由池子救助');
  assert.equal(p0.funds, funds0 + 1);
  assert.equal(m.econRequests.size, 0, '池子一个人就够：不惊动队友');
});

test('债务账本：借出即记账（免息）、催钱可用、还钱清账', () => {
  const h = xieMatch();
  h.start();
  h.toPrep(1);
  const m = h.m;
  const [p0, p1, ai] = [h.ps('p_0'), h.ps('p_1'), h.ps('ai_0')];
  m.teamReserve = 0; // 池子空 ⇒ 整笔走队友
  deployN(m, p1, 4); deployN(m, ai, 4);
  assert.deepEqual(m.econRequest(p0, 'ai_0', 1), { ok: true });
  const req = [...m.econRequests.values()][0];
  assert.ok(req, '请求单存在');
  ai.funds = 10;
  assert.deepEqual(m.econRespond(ai, req.id, true), { ok: true });
  assert.equal(ai.funds, 9, '出借方被扣 1');
  const debts = m.econDebts.get(p0.playerId) || [];
  assert.equal(debts.length, 1, '借出即记账');
  assert.equal(debts[0].amount, 1, '免息：本金 1');
  assert.equal(debts[0].to, ai.playerId);
  assert.deepEqual(m.econNudge(ai, p0.playerId), { ok: true }, '债权人可催钱');
  p0.funds = 2;
  assert.deepEqual(m.econRepay(p0), { ok: true });
  assert.equal((m.econDebts.get(p0.playerId) || []).length, 0, '还清后账本清空');
  assert.equal(p0.funds, 1);
});

test('bot 存池：有余粮且未 ready 时存 1 点；每回合一次', () => {
  const h = xieMatch();
  h.start();
  h.toPrep(1);
  const m = h.m;
  const ai = h.ps('ai_0');
  ai.bandId = 'band_no_bonus'; // 排除坎诺特整额保留带（keep 5）干扰
  ai.funds = 6;
  const before = Number(m.teamReserve) || 0;
  assert.equal(botEconMaybeDeposit(m, ai), true);
  assert.equal(m.teamReserve, before + 1);
  assert.equal(ai.funds, 5);
  assert.equal(botEconMaybeDeposit(m, ai), false, '每人每回合最多 1 次');
  // 非协同模式（无 teamEcon）是 no-op
  assert.equal(botEconMaybeDeposit({ teamEcon: null }, ai), false);
});
