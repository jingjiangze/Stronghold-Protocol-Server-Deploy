# tools/probes —— 运行态探针（需要先起服）

这几个是**验收探针**，不是单元测试：它们用 WebSocket 连一个**正在跑的服务端**，驱动真实对局并读取服务端下发
的帧来核对数值。CI 不跑它们（`node --test` 不扫 `tools/`）。

## 起服

```bash
# 测试房需要 SP_TEST_MODE；插件需要 trusted 才会装载
PORT=3133 HOST=127.0.0.1 SP_PLUGIN_SCRIPTS=trusted SP_TEST_MODE=1 node server/index.js
```

## 探针

| 探针 | 验收什么 | 期望输出 |
|---|---|---|
| `cooprun.cjs` | 协同三层资金：回合末结余拆进个人储备 | `R1 funds4/reserve0 → R2 reserve3 → 结束 reserve 6~7` |
| `meltverify.cjs` | 熔毁代价真的乘进战斗 spawn | `hpMul ≈ enemyScale.hp × meltHpMul`，末行 `PASS` |
| `deployverify.cjs` | 「部署回复」档降 DP 回复 | `dpPerSec 1 → 0.93`（deploy 7% 时），末行 `PASS` |
| `botpicks.cjs [round]` | AI 投放带 `routeIndex` / `time`（非默认） | `bot picks: N 条 \| 带 routeIndex N \| 带 time N` + `PASS` |

## 用法

```bash
SP_WS=ws://127.0.0.1:3133/ws node tools/probes/cooprun.cjs
SP_WS=ws://127.0.0.1:3133/ws node tools/probes/botpicks.cjs 6
```

端口默认 `3133`（`botpicks` 默认 `3132`），可用 `SP_WS` 覆盖。探针只读：不改仓库文件、不写库，
只往服务端发 `room.create` / `g.test` / `g.melt*` 这类测试房命令。
