// BattleSpec 的 relicMods 通道（2026-11-01 扩三组：initSp / spRegenMul / stunOnDeploy）。
// 判据：给了值就生效；不给（缺省）时与没有这条通道逐位一致。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeBattle } from '../helpers/battleHarness.js';
import { sanitizeUnitLoadout } from '../../server/sim/spec.js';

const CHESS = 'chess_char_1_01_a'; // 有技能、初始技力 0

function battle(relicMods) {
  const unit = { uid: 1, kind: 'chess', chessId: CHESS, row: 10, col: 5 };
  if (relicMods) unit.relicMods = relicMods;
  const h = makeBattle({
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0, units: [unit], bonds: {}, bandId: null, playerEffects: [] }],
    content: 'generic', autoFinish: false,
  });
  h.step();
  return h;
}

test('缺省（没有 relicMods）时技力/晕眩与今天一致', () => {
  const h = battle(null);
  const u = h.allies()[0];
  assert.equal(u.relicInitSp, 0);
  assert.equal(u.relicSpRegenMul, 1);
  assert.equal(u.relicStunOnDeploy, 0);
  assert.equal(u.findBuff && u.findBuff('stun'), null);
});

test('initSp 抬高/压低初始技力（负值夹到 0）', () => {
  const up = battle({ initSp: 5 });
  const u = up.allies()[0];
  // 该棋子的技能自带 initSp=8 ⇒ 8+5=13；一步模拟里还会自然回复一点点，所以按整数部分比
  assert.equal(u.skill.initSp, 13, '初始技力叠加到技能上');
  assert.equal(Math.floor(u.skill.sp), 13, '部署时确实按 initSp 给了技力');

  const down = battle({ initSp: -999 });
  const d = down.allies()[0];
  assert.equal(d.skill.initSp, 0, '初始技力不会低于 0');
  assert.ok(d.skill.sp < 1, `初始技力被压低后应接近 0（实得 ${d.skill.sp}）`);
});

test('spRegenMul 乘技力回复；stunOnDeploy 部署即晕眩', () => {
  const slow = battle({ spRegenMul: 0 });
  const u = slow.allies()[0];
  assert.equal(u.s.spRecovery, 0, '×0 之后自然回复为 0');

  const stunned = battle({ stunOnDeploy: 6 });
  const s = stunned.allies()[0];
  const buff = s.findBuff('stun');
  assert.ok(buff, '部署后应有晕眩 buff');
  assert.ok(Number.isFinite(buff.until) ? buff.until > stunned.b.time : true, '晕眩应有时长');
});

test('spec 白名单：三组新字段放行，非数值整块剔除', () => {
  const ok = { uid: 1, kind: 'chess', chessId: CHESS, row: 10, col: 5,
    relicMods: { atkMul: 1.2, initSp: -10, spRegenMul: 0.8, stunOnDeploy: 3 } };
  sanitizeUnitLoadout(ok);
  assert.deepEqual(ok.relicMods, { atkMul: 1.2, initSp: -10, spRegenMul: 0.8, stunOnDeploy: 3 });

  const bad = { uid: 1, kind: 'chess', chessId: CHESS, row: 10, col: 5, relicMods: { initSp: 'lots' } };
  sanitizeUnitLoadout(bad);
  assert.equal(bad.relicMods, undefined, '非数值 ⇒ 整块丢弃');
});

test('shelter 走引擎承伤通道（dmgTakenMul）', () => {
  const h = battle({ shelter: 0.4 });
  const u = h.allies()[0];
  assert.ok(Math.abs((u.s.dmgTakenMul ?? 1) - 0.6) < 1e-9, `承伤应 ×0.6（实得 ${u.s.dmgTakenMul}）`);
  const plain = battle(null);
  assert.equal(plain.allies()[0].s.dmgTakenMul ?? 1, 1, '缺省不动');
});

test('startDebuff：开战限时 debuff 到期自动消失', () => {
  const base = battle(null).allies()[0];
  const h = battle({ startAtkPct: -0.2, startAspd: -20, startSpMul: 0.8, startDur: 5 });
  const u = h.allies()[0];
  assert.ok(Math.abs(u.s.atk - base.s.atk * 0.8) < 1e-6, `开战攻击应 ×0.8（${base.s.atk} → ${u.s.atk}）`);
  assert.ok(Math.abs(u.s.spRecovery - base.s.spRecovery * 0.8) < 1e-6, '技力回复应 ×0.8');
  h.run(6);
  assert.ok(Math.abs(u.s.atk - base.s.atk) < 1e-6, `5 秒后攻击应恢复（实得 ${u.s.atk} / ${base.s.atk}）`);
  assert.ok(Math.abs(u.s.spRecovery - base.s.spRecovery) < 1e-6, '技力回复倍率也应恢复');
});

test('DoT：每秒固定伤害持续掉血（fogOnDeploy / neuralDps 同一条路）', () => {
  const h = battle({ flatDps: 10 });
  const u = h.allies()[0];
  const hp0 = u.hp;
  h.run(2);
  assert.ok(u.hp <= hp0 - 15, `两秒至少掉 15 血（${hp0} → ${u.hp}）`);
});

test('DoT 带 duration 的版本会在到期后停止（fogOnDeploy 60s）', () => {
  const h = battle({ dotMaxHpPct: 0.02, dotDur: 1 });
  const u = h.allies()[0];
  const hp0 = u.hp;
  h.run(1.5);
  const afterDot = u.hp;
  assert.ok(afterDot < hp0, '限时 DoT 期间应掉血');
  h.run(2);
  assert.equal(u.hp, afterDot, '到期后不再掉血');
});

test('敌人 spawn 级修正：防御加成 + 受击衰减 / 异常时长倍率', () => {
  const h = makeBattle({
    units: [{ chessId: CHESS, row: 10, col: 5 }],
    enemies: [{ key: 'enemy_1422_lrsldr', time: 0, route: 0 }],
    content: 'generic', autoFinish: false,
    enemyMods: { defAdd: 3000, defShredPerHit: -100, defShredMax: 30, statusDurationMul: 2.5 },
  });
  h.step();
  const e = h.enemies()[0];
  assert.ok(e, '敌人应已生成');
  assert.ok(e.s.def >= 3000, `防御应含 +3000（实得 ${e.s.def}）`);
  const before = e.s.def;
  h.b.dealDamage(null, e, { amount: 1, type: 'true', canDodge: false, ignoreSelect: true });
  assert.ok(Math.abs(e.s.def - (before - 100)) < 1e-6, `受击一次应 −100 防（${before} → ${e.s.def}）`);

  // 异常状态时长 ×2.5（晕眩 10s → 25s）
  h.b.applyStatus(e, 'stun', { duration: 10, ignoreSelect: true });
  const st = e.findBuff('stun');
  assert.ok(st && Math.abs(st.timeLeft - 25) < 1e-6, `晕眩时长应 ×2.5（实得 ${st && st.timeLeft}）`);
});

test('shelterOnDebuff：有干员中负面后全队获得庇护与无视双防', () => {
  const h = makeBattle({
    players: [{ playerId: 'p1', seat: 0, side: 'L', colOffset: 0,
      units: [{ uid: 1, kind: 'chess', chessId: CHESS, row: 10, col: 5, relicMods: { debuffShelter: 0.35, debuffIgnore: 0.35 } },
        { uid: 2, kind: 'chess', chessId: CHESS, row: 10, col: 6, relicMods: { debuffShelter: 0.35, debuffIgnore: 0.35 } }],
      bonds: {}, bandId: null, playerEffects: [] }],
    content: 'generic', autoFinish: false,
  });
  h.step();
  const [a1, a2] = h.allies();
  h.b.applyStatus(a1, 'stun', { duration: 3, ignoreSelect: true });
  assert.ok(Math.abs((a1.s.dmgTakenMul ?? 1) - 0.65) < 1e-9, `中负面后承伤应 ×0.65（实得 ${a1.s.dmgTakenMul}）`);
  assert.ok(Math.abs((a2.s.dmgTakenMul ?? 1) - 0.65) < 1e-9, '队友也应吃到');
  assert.ok(Math.abs((a2.s.defIgnorePct ?? 0) - 0.35) < 1e-9, '攻击应无视 35% 防御');
});
