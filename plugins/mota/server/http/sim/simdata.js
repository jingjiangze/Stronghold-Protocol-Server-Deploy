// server/http/sim/simdata.js — 0.3.0 的 server/http/static.js 以 `./sim/simdata.js` 引用 sim 数据层，
// 而数据层真身在 server/sim/simdata.js（官方树布局差异；这里 re-export 对齐两者）。
export * from '../../sim/simdata.js';
