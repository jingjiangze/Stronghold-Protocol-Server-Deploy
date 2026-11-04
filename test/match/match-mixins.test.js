// 插件对局类的叠加层（2026-11-01，业主「肉鸽做成插件」）：server/match/host/mixins.js。
// 只测纯组合逻辑（不启动对局宿主）：顺序、重名报错、缺文件跳过、半个叠加层不留。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { applyMatchMixins } from '../../server/match/host/mixins.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, 'fixtures', 'mixins');
const entry = (id, file) => ({ id, root: ROOT, path: file });

class Base {
  baseMethod() { return 'base'; }
}

test('按顺序把各插件的 Mixin 方法叠到同一个对局类上', async () => {
  class Match extends Base {}
  const applied = await applyMatchMixins(Match, [entry('alpha', 'alpha.js'), entry('beta', 'beta.js')]);
  assert.deepEqual(applied, ['alpha', 'beta']);
  const m = new Match();
  m.tag = 'T';
  assert.equal(m.baseMethod(), 'base', '种子 Match 的方法还在');
  assert.equal(m.rogueAlpha(), 'alpha:T');
  assert.equal(m.rogueBeta(), 'beta');
});

test('重名直接报错，且不留下半个叠加层', async () => {
  class Match extends Base {}
  await assert.rejects(
    () => applyMatchMixins(Match, [entry('alpha', 'alpha.js'), entry('dup', 'dup.js')]),
    /redefines rogueAlpha/,
  );
  // dup 的查重发生在拷贝之前 ⇒ alpha 的方法仍然完整地叠上了（不会出现「拷了一半」）
  assert.equal(typeof Match.prototype.rogueAlpha, 'function');
});

test('文件缺失只跳过该插件并报错，不抛异常', async () => {
  class Match extends Base {}
  const errors = [];
  const applied = await applyMatchMixins(Match, [entry('ghost', 'nope.js'), entry('beta', 'beta.js')],
    { log: { info() {}, error: (m) => errors.push(m) } });
  assert.deepEqual(applied, ['beta']);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /match mixin missing: ghost/);
});

test('模块没有导出 Mixin 视为致命', async () => {
  class Match extends Base {}
  await assert.rejects(() => applyMatchMixins(Match, [entry('broken', 'broken.js')]), /exports no Mixin/);
});

test('空清单是零操作（没有插件声明 matchMixin 时与今天一致）', async () => {
  class Match extends Base {}
  assert.deepEqual(await applyMatchMixins(Match, []), []);
  assert.deepEqual(Reflect.ownKeys(Match.prototype).map(String), ['constructor'], '一个方法都没往类上加');
});
