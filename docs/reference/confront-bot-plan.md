// docs/reference/confront-bot-plan.js —— 参考实现：AI 如何「操作怪物」而不是只丢默认路线
//
// 这不是可直接 import 的模块（本仓当前分支不含对抗/狩猎子系统，见 docs/AI-MONSTER-ROUTING.md）。
// 它是**参考代码**：把这段原样贴进随对抗玩法插件发布的对局类
// （`plugins/<id>/server/match/match/confront.js`），并让 `botConfront` 用它的返回值写 `confrontSubs`
// 的 `picks`，AI 就会按怪物移动方式挑可行路线、并把投放时刻错开。
//
// 关键约定：
//   · 只挑 `confrontRouteMetrics(i, enemyKey)` 返回非 null 的路线（WALK/FLY 与怪物移动方式必须匹配、每段可达）
//   · `time + metrics.travel + 2 <= timeLimit`，否则服务端 `_confrontMember` 会以 CONFRONT_ROUTE 拒绝人类提交
//   · 返回的每项形如 `{ enemyKey, gate, routeIndex?, time? }`
//
// 下面是参考实现的原文（来自 plugins/mota/server/match/match/confront.js）：

```js
  _botConfrontPlan(ps, picks, position = 'mid') {
    void ps; void position;
    const list = Array.isArray(picks) ? picks : [];
    if (!list.length) return list;
    const routes = (this._confrontRoutes().routes || []).length;
    const tl = Math.max(1, Number(this.wave && this.wave.timeLimit) || 60);
    const out = [];
    let slot = 0;
    for (const p of list) {
      // 只挑「这条路线这只怪走得通」的（confrontRouteMetrics 会按 WALK/FLY 与可达性返回 null）
      const compat = [];
      for (let i = 0; i < routes; i++) {
        const m = this.confrontRouteMetrics(i, p.enemyKey);
        if (m) compat.push({ i, travel: Number(m.travel) || 0 });
      }
      const pick = compat.length ? compat[slot++ % compat.length] : null;
      const travel = pick ? pick.travel : 0;
      const room = Math.max(0, tl - travel - 2);
      // 按顺序铺在可用时间窗里（至少 1 秒间隔），同一路线会分摊到不同时刻
      const time = room > 0 ? Math.min(room, Math.round((out.length * room) / Math.max(1, list.length))) : undefined;
      out.push({ ...p, ...(pick ? { routeIndex: pick.i } : {}), ...(Number.isFinite(time) ? { time } : {}) });
    }
    return out;
  }
```
