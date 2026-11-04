// test/match/econ-pool-first.test.js — 「借钱优先取团队储备」（业主 2026-10-30）的纯分配逻辑。
//
// 规则：一次借款先由团队储备垫（不产生债务），池子不够的部分才问队友；池子能垫多少同时受
// ① 请求金额 ② 池子余额 ③ 本回合团队资金流动剩余额度 三者钳制。实现在
// plugins/mota/server/match/match/poolFill.js，本测试与实现 import 同一份代码，避免复刻版漂移。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitPoolFill } from '../../plugins/mota/server/match/match/poolFill.js';

test('池子够：全额由团队储备垫，无需向队友借', () => {
  assert.deepEqual(splitPoolFill({ amount: 3, teamReserve: 10, capLeft: 10 }), { fromPool: 3, remaining: 0 });
});

test('池子只够一部分：垫剩下的才问队友', () => {
  assert.deepEqual(splitPoolFill({ amount: 5, teamReserve: 2, capLeft: 10 }), { fromPool: 2, remaining: 3 });
});

test('池子空：整笔都走队友借款', () => {
  assert.deepEqual(splitPoolFill({ amount: 2, teamReserve: 0, capLeft: 10 }), { fromPool: 0, remaining: 2 });
});

test('本回合额度先被钳：余额再足也只能垫额度剩下的部分', () => {
  assert.deepEqual(splitPoolFill({ amount: 4, teamReserve: 99, capLeft: 1 }), { fromPool: 1, remaining: 3 });
  assert.deepEqual(splitPoolFill({ amount: 4, teamReserve: 99, capLeft: 0 }), { fromPool: 0, remaining: 4 });
});

test('脏输入不放大金额：负数/非数/小数一律向下取整且不为负', () => {
  assert.deepEqual(splitPoolFill({ amount: -5, teamReserve: 10, capLeft: 10 }), { fromPool: 0, remaining: 0 });
  assert.deepEqual(splitPoolFill({ amount: 2.9, teamReserve: 10, capLeft: 10 }), { fromPool: 2, remaining: 0 });
  assert.deepEqual(splitPoolFill({ amount: 'x', teamReserve: 10, capLeft: 10 }), { fromPool: 0, remaining: 0 });
  assert.deepEqual(splitPoolFill({ amount: 3, teamReserve: -4, capLeft: 10 }), { fromPool: 0, remaining: 3 });
  assert.deepEqual(splitPoolFill({ amount: 3, teamReserve: 10, capLeft: -1 }), { fromPool: 0, remaining: 3 });
  assert.deepEqual(splitPoolFill(), { fromPool: 0, remaining: 0 });
});

test('守恒：垫付 + 剩余 === 请求金额（池子/额度都充足时）', () => {
  for (const amount of [1, 2, 3, 7, 64]) {
    const r = splitPoolFill({ amount, teamReserve: 100, capLeft: 100 });
    assert.equal(r.fromPool + r.remaining, amount, `amount ${amount}`);
  }
});
