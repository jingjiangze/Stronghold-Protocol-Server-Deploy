// 快速定向冒烟（临时）：只探这次改动的地方，不跑整局、不等真实计时。
//   ① 每回合换场景  ② 还钱 / 催钱  ③ 救援 30 秒冻结
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PHASE } from '../../shared/constants.js';
import { makeMatch } from './harness.js';

test('① 每回合换战场：同一 seed 确定性，多回合里战场不是恒定一张', () => {
  const h = makeMatch({ mode: 'coop', difficulty: 'HARD', bots: 1, seed: 7 }).start();
  const m = h.m;
  const seen = [];
  h.toPrep(1);
  seen.push(m.stageId);
  for (let r = 1; r < 5; r += 1) {
    h.drive(() => m.round === r + 1);
    seen.push(m.stageId);
  }
  assert.ok(seen.every((x) => typeof x === 'string' && x.length), '每回合都有 stageId');
  assert.ok(new Set(seen).size > 1, `5 个回合里战场应当变化过，实际：${seen.join(',')}`);
  m.dispose();

  // 同 seed 必须给出同一串（确定性）
  const h2 = makeMatch({ mode: 'coop', difficulty: 'HARD', bots: 1, seed: 7 }).start();
  const m2 = h2.m;
  const seen2 = [];
  h2.toPrep(1);
  seen2.push(m2.stageId);
  for (let r = 1; r < 5; r += 1) { h2.drive(() => m2.round === r + 1); seen2.push(m2.stageId); }
  assert.deepEqual(seen2, seen, '同一 seed 的战场序列必须一致');
  m2.dispose();
});

test('② 还钱 / 催钱：手动结清、债务跨回合保留、催钱每回合限一次', () => {
  const h = makeMatch({ modeId: 'mode_xie_normal', mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 11 }).start();
  const m = h.m;
  h.toPrep(1);
  const [a, b] = [h.ps('p_0'), h.ps('p_1')];
  assert.equal(m.teamEcon != null, true, '协同共竞模式应当带团队经济');

  // 造一笔 p_0 欠 p_1 的 3 资金
  m.econDebts.set('p_0', [{ to: 'p_1', amount: 3, round: m.round }]);
  a.funds = 5;
  const b0 = b.funds;

  // 催钱：第一次成功，第二次同一回合被拒绝
  const n1 = m.econNudge(b, 'p_0');
  assert.equal(n1 && n1.error, undefined, `第一次催钱应当成功，实际 ${JSON.stringify(n1)}`);
  const n2 = m.econNudge(b, 'p_0');
  assert.equal(n2 && n2.error, 'ALREADY', `同一回合第二次催钱应当被拒，实际 ${JSON.stringify(n2)}`);

  // 还钱：从 a 的钱里付给 b，债务清空
  const r1 = m.econRepay(a, {});
  assert.equal(r1 && r1.error, undefined, `还钱应当成功，实际 ${JSON.stringify(r1)}`);
  assert.equal(a.funds, 2, 'a 付掉 3，剩 2');
  assert.equal(b.funds, b0 + 3, 'b 收到 3');
  assert.equal(m.econDebts.get('p_0'), undefined, '债务结清后不应残留');
  m.dispose();
});

test('③ 救援 30 秒冻结：afterSettle 先挂起不推进，30 秒后才收尾', () => {
  const h = makeMatch({ modeId: 'mode_xie_normal', mode: 'coop', difficulty: 'NORMAL', humans: 2, seed: 13 }).start();
  const m = h.m;
  h.toPrep(1);
  const dead = h.ps('p_0');
  const alive = h.ps('p_1');
  assert.equal(m.revivalEnabled, true, '协同共竞应当启用救援');

  // 让 p_0 处于「已倒下、等待窗口」
  dead.alive = false;
  dead.pendingDeath = true;
  dead.lp = 0;
  m.revival = { round: m.round, windowOpen: false, consents: new Map() };
  m._revivalHeld = false;
  (m.alivePlayers?.() || []); // 保持调用顺序不变

  const roundBefore = m.round;
  let scheduled = null;
  const origLater = m.later.bind(m);
  m.later = (ms, fn) => { scheduled = { ms, fn }; return origLater(ms, () => {}); };

  m.afterSettle();
  assert.equal(scheduled && scheduled.ms, 30_000, '应当排一个 30 秒的窗口，实际 ' + JSON.stringify(scheduled && scheduled.ms));
  assert.equal(m.round, roundBefore, '窗口期间回合不推进');
  assert.equal(m._revivalHeld, true, '标记已挂起，避免重复开窗');
  assert.equal(m.revival.windowOpen, true, '窗口应当是打开的');
  assert.equal(alive.alive, true, '队友仍在场');

  // 到点回来才收尾：清掉标记后调用，p_0 被真正淘汰
  m.later = origLater;
  // 不移除 _revivalHeld：真实路径就是靠它让第二趟走收尾分支
  m.afterSettle();
  assert.equal(dead.pendingDeath, false, '窗口结束后应完成淘汰');
  m.dispose();
});
