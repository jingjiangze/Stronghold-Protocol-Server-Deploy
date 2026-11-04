// test/match/econ-projects.test.js — 商店设施三项（商店等级 / 协同资金获取 / 装备造价）的效果与上限。
// 实现在 plugins/mota/server/match/match/projectEffects.js；本测试与实现 import 同一份代码，避免复刻版漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { PROJECT_MAX_LEVEL, shopLevelOf, equipPriceOf, teamIncomeCapOf } from '../../plugins/mota/server/match/match/projectEffects.js';
import { GameData } from '../../plugins/mota/server/match/gamedata.js';

test('三项的最大级数是 4 / 3 / 2（与 DEFAULTS 的 costs 长度一致）', () => {
  assert.deepEqual(PROJECT_MAX_LEVEL, { shopLevel: 4, teamIncome: 3, equipCost: 2 });
});

test('商店等级：每级 +1，且不会低于 1、不会超过 20', () => {
  assert.equal(shopLevelOf(3, 0), 3);
  assert.equal(shopLevelOf(3, 1), 4);
  assert.equal(shopLevelOf(6, 4), 10);
  assert.equal(shopLevelOf(0, 0), 1, '空输入也不返回 0 级商店');
  assert.equal(shopLevelOf(19, 4), 20, '上限夹到 20');
  assert.equal(shopLevelOf(3, -5), 3, '负数级数按 0 处理');
});

test('装备造价：每级 -1，但下限 2（装备永远不会免费）', () => {
  assert.equal(equipPriceOf(12, 0), 12);
  assert.equal(equipPriceOf(12, 2), 10);
  assert.equal(equipPriceOf(3, 2), 2, '3-2=1 被下限抬回 2');
  assert.equal(equipPriceOf(2, 2), 2);
  assert.equal(equipPriceOf(12, 9), 3, '超过最大级数时仍只按级数扣（不越界成负数）');
  assert.equal(equipPriceOf(12, 99), 2, '再多的级数也只到下限');
});

test('协同资金获取：每级 +1（加到每回合收入上限上）', () => {
  assert.equal(teamIncomeCapOf(1, 0), 1);
  assert.equal(teamIncomeCapOf(1, 1), 2);
  assert.equal(teamIncomeCapOf(1, 3), 4);
  assert.equal(teamIncomeCapOf(1, -2), 1, '负数按 0 处理');
});

test('三项互不影响：各自只读自己那一级', () => {
  const lv = { shopLevel: 2, teamIncome: 3, equipCost: 1 };
  assert.equal(shopLevelOf(4, lv.shopLevel), 6);
  assert.equal(teamIncomeCapOf(1, lv.teamIncome), 4);
  assert.equal(equipPriceOf(10, lv.equipCost), 9);
});

// ---- 肉鸽并入协同（2026-10-30 业主「肉鸽不作为新玩法了，还是加到协同里面」）---------------------
// 肉鸽房的 modeId 是 `mode_rogue_*`，config.modes 里没有这一条，所以团队经济过去靠 GameData.teamEconomy 的
// `matchIsRogue` 闸门显式关掉。现在改由 `config.economy.rogueTeam` 给一份规则块：数值与协同共竞同档，
// 但 `projects` 只列 `teamIncome`——肉鸽没有熔毁商店（meltdown.js 只对 mode_xie_* 开放），另两项买了也用不上。
const PLUGIN_CFG = JSON.parse(fs.readFileSync(new URL('../../plugins/mota/data/config.json', import.meta.url), 'utf8'));
const pluginGd = (modeId) => new GameData({ config: PLUGIN_CFG, chess: {} }, modeId);

test('肉鸽局取 economy.rogueTeam：团队储备开着，但只卖 teamIncome 一项', () => {
  const gd = pluginGd('mode_rogue_normal');
  assert.equal(gd.teamEconomy, null, '没有 matchIsRogue 标记时仍关着（改动前的老行为）');
  gd.matchIsRogue = true;
  const te = gd.teamEconomy;
  assert.ok(te, '肉鸽局现在拿得到团队经济');
  assert.equal(te.transfer.maxPerRequest, 1);
  assert.equal(te.transfer.teamCapPerRound, 4);
  assert.equal(te.transfer.repayInterest, 0);
  assert.deepEqual(te.reserve, { perfectReward: 1, fullDefenceReward: 1, perfectRewardCapPerRound: 1 });
  assert.deepEqual(Object.keys(te.projects), ['teamIncome'], '肉鸽没有熔毁商店，只留团队储备获取一项');
  assert.equal(te.relief.enabled, false, '救济默认不开');
});

test('rogueTeam 不外溢：普通合作与独立模拟都拿不到，协同共竞仍是三项', () => {
  assert.equal(pluginGd('mode_multi_hard').teamEconomy, null, '普通合作模式不变');
  const solo = pluginGd('mode_single_hard');
  solo.matchIsRogue = true;
  assert.equal(solo.teamEconomy, null, '独立模拟永远没有团队经济');
  const xie = pluginGd('mode_xie_normal');
  assert.deepEqual(Object.keys(xie.teamEconomy.projects), ['shopLevel', 'teamIncome', 'equipCost'], '协同共竞不变');
});
