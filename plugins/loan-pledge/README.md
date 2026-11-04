# loan-pledge — 魔塔借贷抵押

在 `mota` 插件之上做的一层对局包装（`code.match` 指向 `server/match/LoanMatch.js`，通过 `extends` 复用 mota 的 `Match`），不改 mota 源码。

## 规则

1. **只扣利息（L2）**：每回合开始时，对每笔仍有未付利息的借款，从借款人资金里扣掉当期利息，**本金不动**；每笔最多扣 `maxInterestRounds`（默认 3）个回合。扣到的钱转给债权人。
2. **干员抵押（F1）**：借款成功时，把借款人手牌里第一个干员标记为抵押；抵押中的干员**不能部署、不能出售**；欠款结清后自动解锁。

## 依赖

- `mota >= 0.3.0`（`requires` + `loadAfter`，引擎按 `shared/plugins/order.js` 排序，后加载者的 `code.match` 胜出）

## 已知边界

- 抵押只覆盖 `move`（上场）与 `sell`（出售）两个入口；合并、赠予尚未拦截。
- 只押手牌里的干员（不押临时区，避免 `resolveTemp` 到期销毁）。
- `plugin.json` 的 `settings` 目前只供管理面板展示：match host 不把插件 settings 传进 `Match`，运行时以 `LoanMatch.js` 里的 `LOAN` 常量为准。

## 装载

```bash
node tools/plugin.mjs pack loan-pledge
```

然后把 `plugin.lock.json` 的 pin 写进 `plugins/config.json` 的 `trusted.loan-pledge`，并在 `default` 里加入 `loan-pledge`。
