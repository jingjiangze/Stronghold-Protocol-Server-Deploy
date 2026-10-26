# AI 投放怪物路线（对局内 AI 决策契约）

> 状态：**契约已定，实现随「对抗玩法插件」发布**。
> 本文把「AI 也能决定放哪些怪、走哪条路线、什么时候进场」这件事固定成引擎可依赖的形状，
> 使插件作者不必修改引擎即可覆写，也便于管理器侧做兼容判定。

## 1. 引擎侧已有的扩展点

| 扩展点 | 位置 | 说明 |
|---|---|---|
| `server.modules.matchClass(fn)` | `shared/workshop.js` 的 `SERVER_MODULE_USES`（`boot / shutdown / matchClass / healthz / metrics / route`） | 插件的 `server` 部分导出一个 `fn(Base) → Subclass`，进程级包装对局类。包声明 `uses` 含 `matchClass` 时必须带 `combat: true`（对局结果级的影响）。 |
| `opts.MatchClass` | `server/index.js` 启动参数 | 宿主直接注入包装后的对局类（等价能力，供无插件场景使用）。 |
| `wireOptions(opts)` | `server/match/host/proxy.js` | worker 宿主只转发白名单字段：`roomCode / mode / teamSize / difficulty / modeId / aiPicksLast / soloUnlimited / seats / spectators / seed / matchNo / cs / vs / requireCs / kitted / version / code / versusRule / versusAlt / coopScope`。插件自定义的对局选项必须在这里登记，否则子进程拿不到。 |

**结论**：AI 投放决策不需要新增引擎面 —— 用 `matchClass` 包装即可。管理器侧要做的是保证上表三项语义稳定。

## 2. 插件侧契约（对抗玩法）

对抗插件的对局类提供两个可覆写方法，`botConfront` 必须经由 `_botConfrontPlan` 产出投放，而不是内联自己的选怪逻辑：

```js
/**
 * AI 投放计划（缺省实现 = 预算内贪心选怪 + 按移动方式挑可行路线 + 错开投放时刻）。
 * @param {any} ps   该 AI 的 player state
 * @param {Array<{ enemyKey: string, gate: 'upper'|'lower' }>} picks 已选好的怪（预算/只数上限已判过）
 * @param {'front'|'mid'|'back'} position 投放位置档
 * @returns {Array<{ enemyKey: string, gate: string, routeIndex?: number, time?: number }>}
 */
_botConfrontPlan(ps, picks, position) { … }
```

覆写示例（按守方布阵挑路）：

```js
// plugins/<id>/server/index.js
export function server(api) {
  api.modules.matchClass((Base) => class extends Base {
    _botConfrontPlan(ps, picks, position) {
      const plan = super._botConfrontPlan(ps, picks, position);
      // 举例：把飞行怪全部塞到最短的飞行路线，并把投放时刻集中在后半段
      return plan.map((p) => ({ ...p /* 这里改 routeIndex / time */ }));
    }
  });
}
```

## 3. 校验规则（覆写者必须遵守，服务端会拒绝非法值）

| 规则 | 判据 |
|---|---|
| 路线存在 | `routeIndex` 必须是 `confrontRouteMetrics(routeIndex, enemyKey)` 返回非 null 的下标（WALK / FLY 与怪物移动方式必须匹配、每段可达） |
| 路线长度 | `metrics.len ≤ 40` |
| 时刻上限 | `time ≤ timeLimit` |
| 行程约束 | `time + metrics.travel + 2 ≤ timeLimit` |

不填 `routeIndex` / `time` 时，对局按默认行为补：`routeIndex = confrontRouteFor(enemyKey, gate)`，`time = 插入点 + i × 1`。

## 4. 参考实现

参考实现在对抗玩法插件（`plugins/mota/server/match/match/confront.js`，方法 `_botConfrontPlan`）：
按 `confrontRouteMetrics` 过滤出**该怪走得通**的路线，轮转分配，并把它在
`timeLimit − travel − 2` 窗口内按顺序铺开，避免同一路线同时涌入。

该插件（含整套对抗/狩猎子系统）不在本仓当前分支上，因此本仓只落契约；实现随插件包发布。

## 5. 兼容判定建议

插件对 `.zcode/plugins/config.json` 之外无需声明新能力；管理器侧若要拦「旧引擎 + 新插件」，
判据是：插件的 `uses` 是否包含 `matchClass` 且对局类是否提供 `_botConfrontPlan`。
