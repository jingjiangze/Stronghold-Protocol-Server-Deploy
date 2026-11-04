// N1–N20 难度生成器（2026-11-02）：锚点必须精确复现 4 档，其余档单调插值，重复执行幂等。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { applyNModes, ANCHORS, N_TIERS, bracket } from '../tools/build-nmodes.mjs';

const CONFIG = JSON.parse(fs.readFileSync(new URL('../data/config.json', import.meta.url), 'utf8'));
const BOSSES = JSON.parse(fs.readFileSync(new URL('../data/bosses.json', import.meta.url), 'utf8'));

const gen = () => applyNModes(CONFIG, BOSSES);

test('锚点精确复现 4 档（N1=FUNNY / N8=NORMAL / N14=HARD / N20=ABYSS）', () => {
  const { config } = gen();
  for (const { n, difficulty } of ANCHORS) {
    for (const type of ['single', 'multi']) {
      const anchor = CONFIG.modes[`mode_${type}_${difficulty.toLowerCase()}`];
      const made = config.modes[`mode_${type}_n${n}`];
      assert.ok(made, `${type} N${n} 应存在`);
      assert.equal(made.bossRound, anchor.bossRound, `${type} N${n} bossRound`);
      assert.equal(made.lastRound, anchor.lastRound, `${type} N${n} lastRound`);
      assert.equal(made.difficulty, `N${n}`);
      assert.deepEqual(made.enemyScale[String(anchor.bossRound)], anchor.enemyScale[String(anchor.bossRound)], `${type} N${n} boss 回合的敌人倍率`);
      assert.deepEqual(made.upgradePrices, anchor.upgradePrices, `${type} N${n} 升级价`);
    }
  }
});

test('20 档齐全，且插值结果落在相邻锚点之间（不外推）', () => {
  const { config } = gen();
  assert.equal(N_TIERS.length, 20);
  const val = (m) => {
    const s = m.enemyScale[String(m.bossRound)];
    return s ? { hp: s.hp, atk: s.atk } : null;
  };
  for (const type of ['single', 'multi']) {
    for (let n = 1; n <= 20; n++) {
      const m = config.modes[`mode_${type}_n${n}`];
      assert.ok(m, `${type} n${n} 缺失`);
      const got = val(m);
      assert.ok(got, `${type} n${n} 缺 boss 回合倍率`);
      const { a, b, t } = bracket(n);
      const av = val(CONFIG.modes[`mode_${type}_${a.difficulty.toLowerCase()}`]);
      const bv = val(CONFIG.modes[`mode_${type}_${b.difficulty.toLowerCase()}`]);
      for (const k of ['hp', 'atk']) {
        const lo = Math.min(av[k], bv[k]) - 1e-3, hi = Math.max(av[k], bv[k]) + 1e-3;   // 容差 = 插值保留 4 位小数的舍入步长
        assert.ok(got[k] >= lo && got[k] <= hi, `${type} n${n} ${k} 越界（${got[k]} 不在 [${lo}, ${hi}]）`);
      }
    }
  }
});

test('按难度查表的四处一起插值（bans / 奖励系数 / 奖杯 / 隐秘核心白名单）', () => {
  const { config } = gen();
  assert.deepEqual(config.bans.N1, CONFIG.bans.FUNNY);
  assert.deepEqual(config.bans.N20, CONFIG.bans.ABYSS);
  assert.equal(config.rewards.difficultyFactor.N1, CONFIG.rewards.difficultyFactor.FUNNY);
  assert.equal(config.rewards.difficultyFactor.N20, CONFIG.rewards.difficultyFactor.ABYSS);
  assert.equal(config.trophies.hiddenCore.N1, null, '最低档不开隐秘核心（与 FUNNY 一致）');
  assert.ok(config.hiddenCore.difficulties.includes('N8') && !config.hiddenCore.difficulties.includes('N7'));
  // 奖励系数单调不降
  let prev = -1;
  for (let n = 1; n <= 20; n++) {
    const v = config.rewards.difficultyFactor[`N${n}`];
    assert.ok(v >= prev - 1e-9, `N${n} 奖励系数应不降`);
    prev = v;
  }
});

test('BOSS 血量按档插值并覆盖 20 档', () => {
  const { bosses } = gen();
  for (const boss of Object.values(bosses)) {
    if (!boss || !boss.bloodPoint) continue;
    const bp = boss.bloodPoint;
    for (let n = 1; n <= 20; n++) assert.equal(typeof bp[`N${n}`], 'number', `${boss.id || 'boss'} 缺 N${n}`);
    assert.equal(bp.N1, bp.FUNNY ?? bp.N1);
    assert.equal(bp.N20, bp.ABYSS ?? bp.N20);
  }
});

test('幂等：对生成结果再跑一次，结果不变', () => {
  const once = gen();
  const twice = applyNModes(once.config, once.bosses);
  assert.deepEqual(twice.config, once.config);
  assert.deepEqual(twice.bosses, once.bosses);
});
