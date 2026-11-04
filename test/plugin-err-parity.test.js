// 错误码表的「两张表」一致性守卫（2026-10-27）。
//
// 背景（线上事故）：`server/net.js` 的 `isErrCode()` 用**核心** `shared/constants.js` 的 `ERR` 判断码是否合法，
// 非法就兜底成 `ERR.INTERNAL`。而 mota 插件把 `shared/constants.js` 整份覆盖成了自己那份（键集不同），
// `confront.js` 返回的 `CONFRONT_ROUTE / CONFRONT_BUDGET / CONFRONT_COUNT` 在核心表里不存在
// ⇒ 玩家手动提交怪物时看到「服务器内部错误」，实际只是路线/预算被拒。
//
// 这条测试把「两张表必须是同一键集、且每个码都有文案」钉死，避免再次静默漂移。
import test from 'node:test';
import assert from 'node:assert/strict';
import { ERR as CORE_ERR, ERR_TEXT as CORE_TEXT } from '../shared/constants.js';
import { ERR as MOTA_ERR, ERR_TEXT as MOTA_TEXT } from '../plugins/mota/shared/constants.js';

test('插件 shared/constants.js 的错误码不得少于核心（否则会被兜底成 INTERNAL）', () => {
  const missing = Object.keys(MOTA_ERR).filter((k) => !(k in CORE_ERR));
  assert.deepEqual(missing, [], `核心 ERR 缺少插件在用的码：${missing.join(', ')}`);
});

test('插件 shared/constants.js 必须覆盖核心的每个错误码（否则客户端拿到码却没有文案）', () => {
  const missing = Object.keys(CORE_ERR).filter((k) => !(k in MOTA_ERR));
  assert.deepEqual(missing, [], `插件 ERR 缺少核心的码：${missing.join(', ')}`);
});

test('每个错误码在两张表里都有文案', () => {
  const noCore = Object.keys(CORE_ERR).filter((k) => !(k in CORE_TEXT));
  const noMota = Object.keys(MOTA_ERR).filter((k) => !(k in MOTA_TEXT));
  assert.deepEqual(noCore, [], `核心 ERR_TEXT 缺少：${noCore.join(', ')}`);
  assert.deepEqual(noMota, [], `插件 ERR_TEXT 缺少：${noMota.join(', ')}`);
});
