// 肉鸽地图浮层的缩略图模型（2026-11-02）：纯函数，直接拿真实 stages.json 校验。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildMinimapModel } from '../plugins/mota/client/js/ui/rogueMapModel.js';

const STAGES = JSON.parse(fs.readFileSync(new URL('../data/stages.json', import.meta.url), 'utf8'));
const ID = Object.keys(STAGES).find((k) => Array.isArray(STAGES[k].rows) && STAGES[k].rows.length);

test('缩略图模型：尺寸、可走格、部署格都来自 stage 数据', () => {
  const stage = STAGES[ID];
  const model = buildMinimapModel(stage);
  assert.ok(model, '真实 stage 应能出模型');
  assert.equal(model.height, stage.rows.length);
  assert.equal(model.width, Math.max(...stage.rows.map((r) => String(r).length)));
  assert.equal(model.floor.length, model.height);
  assert.equal(model.floor[0].length, model.width);
  // 可走格至少有一个（否则整张图是墙）
  const walkable = model.floor.flat().filter(Boolean).length;
  assert.ok(walkable > 0, `应识别出可走格（实得 ${walkable}）`);
  const dep = stage.deployTiles.normal;
  assert.equal(model.marks.length, (dep.melee || []).length + (dep.rangedOnly || []).length);
  assert.ok(model.marks.every((m) => Number.isInteger(m.r) && Number.isInteger(m.c)));
});

test('缺数据时返回 null（不炸 UI）', () => {
  assert.equal(buildMinimapModel(null), null);
  assert.equal(buildMinimapModel({}), null);
  assert.equal(buildMinimapModel({ rows: [] }), null);
  assert.equal(buildMinimapModel({ rows: [''] }), null);
});
