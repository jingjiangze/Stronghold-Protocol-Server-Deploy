// 官方肉鸽关卡 → 本作 stage 记录（2026-11-03）：三张真实 ro4 关卡做夹具，转完要能直接跑一场战斗。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { convertRogueLevel, routesOf, deployKindOf } from '../tools/rogue-stages.mjs';
import { makeBattle } from './helpers/battleHarness.js';

const DIR = new URL('./fixtures/rogue-levels/', import.meta.url);
const NAMES = ['level_rogue4_1-1', 'level_rogue4_1-2', 'level_rogue4_1-4'];
const load = (n) => JSON.parse(fs.readFileSync(new URL(`${n}.json`, DIR), 'utf8'));

test('转换：官方图原样嵌进 19×21 画框，部署格只算棋盘窗口内', () => {
  for (const n of NAMES) {
    const lv = load(n);
    const st = convertRogueLevel(lv);
    assert.deepEqual(st.size, [19, 21], `${n} 画框固定 19×21`);
    assert.equal(st.rows.length, 19);
    assert.ok(st.rows.every((r) => r.length === 21));
    assert.ok(st.rogueFrame && Number.isInteger(st.rogueFrame.row) && Number.isInteger(st.rogueFrame.col), `${n} 记录偏移`);
    // 官方地图的行数/列数在偏移之后仍能还原
    assert.equal(st.rogueFrame.h, lv.mapData.map.length);
    // 画框里的官方区域必须落在画框内
    assert.ok(st.rogueFrame.row + st.rogueFrame.h <= 19 && st.rogueFrame.col + st.rogueFrame.w <= 21);
    // 字形只用本作标准字形（'#' 是画框空白）
    const allowed = new Set('#XrRfphbaASEIOmgdi'.split(''));
    for (const row of st.rows) for (const ch of row) assert.ok(allowed.has(ch), `${n} glyph ${ch}`);
    // 部署格必须在棋盘窗口 rows 9–12 / cols 2–10 内
    for (const [r, c] of [...st.deployTiles.normal.melee, ...st.deployTiles.normal.rangedOnly]) {
      assert.ok(r >= 9 && r <= 12 && c >= 2 && c <= 10, `${n} 部署格越出窗口 ${r},${c}`);
    }
    // 每张图至少要有一个可部署格（官方图都有 tile_start 附近的可建造地面）
    assert.ok(st.deployTiles.normal.melee.length + st.deployTiles.normal.rangedOnly.length > 0, `${n} 没有部署格`);
  }
});

test('转换：官方信息不丢（画框内能看到官方地形）', () => {
  const lv = load('level_rogue4_1-1');
  const st = convertRogueLevel(lv);
  const { row, col, h, w } = st.rogueFrame;
  // 官方 mapData 的每个 tileKey 都应该出现在 legend 里（glyph 映射后）
  const officialKeys = new Set(Object.values(lv.mapData.tiles).map((t) => t.tileKey));
  const legendKeys = new Set(Object.values(st.tiles).map((t) => t.tileKey));
  for (const k of officialKeys) assert.ok(legendKeys.has(k), `缺 tileKey ${k}`);
  // 画框里的官方区域不是全 '#'（说明地图真的贴进去了）
  let nonWall = 0;
  for (let r = row; r < row + h; r++) for (let c = col; c < col + w; c++) if (st.rows[r][c] !== '#') nonWall += 1;
  assert.ok(nonWall > 5, `画框里官方区域几乎全是禁区（${nonWall}）`);
});

test('routes：官方 row 从下往上数，转换后叠加画框偏移', () => {
  const lv = load('level_rogue4_1-1');
  const routes = routesOf(lv);
  const st = convertRogueLevel(lv);
  const { row, col } = st.rogueFrame;
  assert.ok(routes.length > 0, '官方关卡应有可用 routes');
  const raw = (lv.routes || []).find((r) => r.startPosition && (r.startPosition.row || r.startPosition.col));
  assert.deepEqual(routes[0].start, [raw.startPosition.row + row, raw.startPosition.col + col]);
  for (const r of routes) {
    assert.ok(Number.isInteger(r.start[0]) && Number.isInteger(r.start[1]));
    assert.ok(r.start[0] >= 0 && r.start[0] < 19 && r.start[1] >= 0 && r.start[1] < 21);
  }
});

test('转换结果能直接跑一场战斗（7×9 这类小图引擎支持）', () => {
  const st = convertRogueLevel(load('level_rogue4_1-1'), { id: 'rogue_ro4_1-1' });
  const [tile] = st.deployTiles.normal.melee;
  assert.ok(tile, '需要一个可部署格');
  const h = makeBattle({
    stage: st,
    rect: { r0: 0, r1: st.size[0] - 1, c0: 0, c1: st.size[1] - 1 },
    units: [{ chessId: 'chess_char_1_01_a', row: tile[0], col: tile[1] }],
    content: 'generic', autoFinish: false,
  });
  h.step();
  const u = h.allies()[0];
  assert.ok(u && u.deployed, '在肉鸽地图的部署格上应该能落地');
  assert.deepEqual([h.b.rect.r1 + 1, h.b.rect.c1 + 1], st.size);
});

test('deployKindOf：高台只放远程，不可建造不给格', () => {
  assert.equal(deployKindOf(null), null);
  assert.equal(deployKindOf({ buildableType: 'NONE' }), null);
  assert.equal(deployKindOf({ buildableType: 'ALL', heightType: 'LOWLAND' }), 'melee');
  assert.equal(deployKindOf({ buildableType: 'ALL', heightType: 'HIGHLAND' }), 'rangedOnly');
});

test('wavesOf：官方 waves/fragments/actions → 本作 wave 模板（绝对时间、路线索引在图内）', async () => {
  const { wavesOf } = await import('../tools/rogue-stages.mjs');
  for (const n of NAMES) {
    const lv = load(n);
    const st = convertRogueLevel(lv, { id: n });
    const w = wavesOf(lv, n);
    assert.equal(w.id, `rogue_${n}`);
    assert.equal(w.kind, 'normal');
    assert.ok(w.maxPlayTime > 0, `${n} 时长必须是正数（官方 -1 要回落）`);
    assert.ok(w.spawns.length > 0, `${n} 应该解析出出怪`);
    assert.ok(w.totalCount > 0);
    const H = st.size[0], W = st.size[1];
    for (const sp of w.spawns) {
      assert.ok(sp.time >= 0, `${n} 出怪时间非负`);
      if (sp.routeIndex >= 0) assert.ok(sp.routeIndex < Math.max(1, (lv.routes || []).length), `${n} 路线索引越界 ${sp.routeIndex}`);
    }
    for (const r of w.routes) {
      assert.ok(r.start[0] >= -1 && r.start[0] <= H + 1 && r.start[1] >= -1 && r.start[1] <= W + 1, `${n} 路线起点越界`);
    }
  }
});
