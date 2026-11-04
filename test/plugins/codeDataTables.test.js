// test/plugins/codeDataTables.test.js — `code.data` 的顶替面到底有多大。
//
// 2026-10-30 之前引擎只认死 `data/config.json`；其它 `data/<name>.json` 一律跳过，
// 于是「整份替换 data/assets.json」这类真实需求（线上包 `nlc-skins` 的素材清单）在引擎层无路可走。
// 本文件钉住泛化之后的语义：
//   ① `config` 行为逐字节不变（回归保护）
//   ② 其它表也能整份顶替
//   ③ 只认 `data/<name>.json` 这一种形态，别的路径静默跳过（不抛错、不当成表）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildContentSet } from '../../server/plugins/contentSet.js';
import { fixture } from '../helpers/contentFixtures.js';

const build = (f, ids) => buildContentSet({ registry: f.registry, ids });

test('code.data 换 config：行为与从前一致', t => {
  const f = fixture(t);
  f.put('cfg', { code: { data: ['data/config.json'] } }, { 'data/config.json': { modes: {}, marker: 'cfg' } });
  const s = build(f, ['cfg']);
  assert.deepEqual(s.problems, []);
  assert.equal(s.data.config.marker, 'cfg');
});

test('code.data 能整份顶替任意 data/<name>.json（不只 config）', t => {
  const f = fixture(t);
  const doc = { hello: 1, list: ['a', 'b'] };
  f.put('notes-pack', { code: { data: ['data/notes.json'] } }, { 'data/notes.json': doc });
  const s = build(f, ['notes-pack']);
  assert.deepEqual(s.problems, []);
  assert.deepEqual(s.data.notes, doc, '非 config 的表也要整份顶替进来');
});

test('code.data 指向不存在的文件时不炸：插件照装，那张表不出现在内容集里', t => {
  const f = fixture(t);
  // 声明了却没放文件：`existsSync` 那道守卫负责跳过（否则 `JSON.parse(readFileSync(...))` 直接抛）。
  f.put('ghost', { code: { data: ['data/ghost.json'] } }, {});
  const s = build(f, ['ghost']);
  assert.deepEqual(s.problems, [], '缺文件不该让整包装载失败');
  assert.equal(s.data.ghost, undefined, '不存在的表不能被凭空创建');
});

// 说明：`code.data` 里写**不是** `data/<name>.json` 的路径（例如 `assets/x.png`、`noop`）时，
// 插件会先在**注册层**被判 `PLUGIN_UNKNOWN`（整个插件不成立），根本走不到这里那道过滤。
// 这与本仓「声明了却不生效比拒绝更糟」的口径一致 —— 所以这里不为「静默跳过」写用例，
// 免得把「被拒」误写成「被忽略」。
