// 熔毁代价接线：幂等（联防/接力不得重复乘）与行为边界（业主 2026-10-26 接线；复审计 2026-10-27 补）
import { test } from 'node:test';
import assert from 'node:assert/strict';

// 复刻 server/match/match/combat.js 的 melt 段落（保持与实现同构）
function applyMelt(spec, { gm = 1.05, hm = 1 / (1 - 0.04) } = {}) {
  const mods = { ...(spec.mods || {}) };
  if (mods.meltApplied) return mods;
  if (gm !== 1 || hm !== 1) {
    const mul = (k, f) => { const v = Number(mods[k]); return (Number.isFinite(v) && v > 0 ? v : 1) * f; };
    mods.hpMul = mul('hpMul', gm * hm);
    mods.atkMul = mul('atkMul', gm);
    mods.speedMul = mul('speedMul', gm);
  }
  mods.meltApplied = true;
  return mods;
}

test('无债务时不动 mods', () => {
  const m = applyMelt({ mods: { hpMul: 0.96, atkMul: 0.88 } }, { gm: 1, hm: 1 });
  assert.equal(m.hpMul, 0.96);
  assert.equal(m.atkMul, 0.88);
});

test('普通场乘一次', () => {
  const m = applyMelt({ mods: { hpMul: 0.96, atkMul: 0.88 } });
  assert.ok(Math.abs(m.hpMul - 0.96 * 1.05 * (1 / 0.96)) < 1e-9);
  assert.ok(Math.abs(m.atkMul - 0.88 * 1.05) < 1e-9);
});

test('幂等：联防/接力重复过 _sanitizeSpawns 不再乘', () => {
  let mods = { hpMul: 0.96, atkMul: 0.88 };
  const first = applyMelt({ mods });
  const second = applyMelt({ mods: first });
  const third = applyMelt({ mods: second });
  assert.equal(second.hpMul, first.hpMul);
  assert.equal(third.hpMul, first.hpMul);
});
