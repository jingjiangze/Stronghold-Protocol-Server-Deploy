// test/plugins/upstream043-content.test.js — 0.4.3 合并数据能否被真实内容集装载。
// 只验证 code.data 顶替后的表形状/计数/旧数据保留；不代表新技能/规则已实现。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { fixture } from '../helpers/contentFixtures.js';

const DIR = new URL('../../plugins/upstream-043-content/data/', import.meta.url);
const TABLES = ['enemies', 'bosses', 'bands', 'effects', 'stages', 'waves', 'factions'];

test('upstream-043-content：内容集可装载，超集表生效且旧肉鸽图保留', (t) => {
  const f = fixture(t);
  const docs = {};
  for (const n of TABLES) docs[`data/${n}.json`] = JSON.parse(fs.readFileSync(new URL(`${n}.json`, DIR), 'utf8'));
  f.put('upstream-043-content', {
    class: 'content', api: 2, app: '>=0.3.0 <0.5.0', scope: ['room'],
    permissions: ['data.add'],
    code: { data: TABLES.map((n) => `data/${n}.json`) },
  }, docs);
  const s = buildContentSet({ registry: f.registry, ids: ['upstream-043-content'] });
  assert.deepEqual(s.problems, []);
  assert.equal(Object.keys(s.data.enemies).length, 828, '0.4.3 enemies 全量');
  assert.ok(s.data.enemies.enemy_1515_bsnake, '新 boss 敌人');
  assert.equal(Object.keys(s.data.bosses).length, 14, '新 boss');
  assert.ok(s.data.bosses.boss_11);
  assert.equal(Object.keys(s.data.stages).length, 90, '89 当前 + sui_raid');
  assert.ok(s.data.stages['rogue_ro4_1-4'], '旧肉鸽图仍在');
  assert.ok(s.data.stages.sui_raid);
  assert.equal(Object.keys(s.data.waves).length, 122, '114 当前 + 8 新波次');
  assert.ok(s.data.waves.patriot_raid);
  assert.ok(s.data.waves.sui_raid);
  assert.equal(Object.keys(s.data.factions.types || {}).length, 30, '7 旧 + 23 新 faction 类型');
  assert.ok(s.data.factions.types.URSUS);
  assert.ok(s.data.factions.types.BOLIVAR);
});
