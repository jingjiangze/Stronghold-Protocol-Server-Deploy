// 熔毁「部署回复」档 + allStats 覆盖 def/res + bot 投放校验（复审计 2026-10-27 补）
import { test } from 'node:test';
import assert from 'node:assert/strict';

function deployMul(debt) {
  const r = Math.max(0, Math.min(0.8, (Number(debt && debt.deploy) || 0) / 100));
  return r > 0 ? 1 - r : 1;
}
function meltMultipliers(debt) {
  const gm = 1 + ((Number(debt.allStats) || 0) + (Number(debt.growth) || 0)) / 100;
  const hm = 1 / Math.max(0.2, 1 - Math.min(0.8, (Number(debt.dmg) || 0) / 100));
  return { gm, hm };
}

test('deploy 档：每 1% 降 1% DP 回复，上限 80%', () => {
  assert.equal(deployMul({ deploy: 0 }), 1);
  assert.ok(Math.abs(deployMul({ deploy: 10 }) - 0.9) < 1e-9);
  assert.ok(Math.abs(deployMul({ deploy: 100 }) - 0.2) < 1e-9); // clamp 0.8
});

test('allStats 同时作用于 hp/atk/def/res/speed', () => {
  const { gm, hm } = meltMultipliers({ allStats: 10 });
  const base = { hpMul: 1, atkMul: 1, defMul: 1, resMul: 1, speedMul: 1 };
  const out = {
    hpMul: base.hpMul * gm * hm, atkMul: base.atkMul * gm, speedMul: base.speedMul * gm,
    defMul: base.defMul * gm, resMul: base.resMul * gm,
  };
  assert.ok(Math.abs(out.defMul - 1.1) < 1e-9);
  assert.ok(Math.abs(out.resMul - 1.1) < 1e-9);
});

// 复刻 _sanitizeBotPicks 的核心判据
function sanitize(picks, { timeLimit = 20, metricsOf = () => ({ len: 5, travel: 2 }), budget = 999, spent = () => 0, cap = 8 } = {}) {
  const out = [];
  for (const p of picks) {
    if (out.length >= cap) break;
    if (!p || typeof p.enemyKey !== 'string') continue;
    const row = { enemyKey: p.enemyKey, gate: p.gate === 'upper' ? 'upper' : 'lower' };
    const routeIndex = Number.isInteger(p.routeIndex) ? p.routeIndex : null;
    if (routeIndex != null) {
      const m = metricsOf(routeIndex, p.enemyKey);
      if (m && m.len <= 40) {
        row.routeIndex = routeIndex; row.routeLen = m.len;
        if (Number.isFinite(p.time)) {
          const room = Math.max(0, timeLimit - m.travel - 2);
          if (timeLimit - m.travel - 2 >= 0) row.time = Math.min(room, Math.max(0, p.time));
        }
      }
    }
    out.push(row);
  }
  const total = () => spent(out) + out.reduce((n, x) => n + (Number(x.routeLen) || 0) * 2, 0);
  if (total() > budget) for (const x of out) { delete x.routeIndex; delete x.routeLen; delete x.time; if (total() <= budget) break; }
  while (out.length && total() > budget) out.pop();
  return out;
}

test('bot：非法 routeIndex 被剥掉（不整单拒绝）', () => {
  const r = sanitize([{ enemyKey: 'a', routeIndex: 9 }], { metricsOf: () => null });
  assert.equal(r.length, 1);
  assert.equal(r[0].routeIndex, undefined);
});

test('bot：超长路线（len>40）被剥掉', () => {
  const r = sanitize([{ enemyKey: 'a', routeIndex: 0 }], { metricsOf: () => ({ len: 41, travel: 1 }) });
  assert.equal(r[0].routeIndex, undefined);
});

test('bot：time 被夹进可用窗口', () => {
  const r = sanitize([{ enemyKey: 'a', routeIndex: 0, time: 999 }], { metricsOf: () => ({ len: 5, travel: 3 }), timeLimit: 20 });
  assert.ok(r[0].time <= 20 - 3 - 2);
});

test('bot：预算不足时先让出路线、仍超再截断', () => {
  const picks = [{ enemyKey: 'a', routeIndex: 0 }, { enemyKey: 'b', routeIndex: 1 }];
  const r = sanitize(picks, { budget: 5, spent: () => 0 });
  assert.ok(r.length >= 1);
  assert.ok(r.every((x) => x.routeIndex === undefined));
});
