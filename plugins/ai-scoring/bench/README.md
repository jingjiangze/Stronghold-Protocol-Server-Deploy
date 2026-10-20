# 布阵 / 整局决策基准（lineup-bench-v1）

从 HankDUMPLINGZhong/Stronghold-Protocol-AI 的 `enemy-diversity-v1` 借来的方法学，不是它的代码：

- **种子按覆盖挑，不看结果**：`make-bench.js` 从 10,000 个候选里按关卡铺满 13 张图，每难度 28 局冻结进 `seeds.json`。
- **同一基准确认对照**：任何评分器改动都跑同一批种子，`compare.js` 出 A/B 两栏与增量。
- **三件套存档**：`provenance.js` 把 benchVersion / scorerVersion / gitSha / 跑批时间钉在结果旁边。
- **决策面覆盖**：`kind` 取值 `buy | roll | sell | levelUp | place | combine | ready | settle`，所以商店购买、刷新、卖子、升级时机、合成与布阵都在同一条记录里。

## 用法

```bash
node plugins/ai-scoring/bench/make-bench.js --write      # 只在改基准集时跑，产物冻结
node plugins/ai-scoring/bench/record.js out.jsonl '{"difficulty":"HARD","seed":123,"round":5,"kind":"buy","funds":12,"hp":9}'
node plugins/ai-scoring/bench/compare.js a.jsonl b.jsonl
node plugins/ai-scoring/bench/provenance.js provenance.json 0.3.1
```

`record.js` 会拒绝不在基准集里的种子 —— 自造种子的"跑分"进不了对照表。
