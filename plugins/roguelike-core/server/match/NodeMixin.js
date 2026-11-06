// plugins/roguelike-core/server/match/NodeMixin.js
// P0 垂直切片（2026-11-03）→ 「每回合三选一 + 节点决定地图层级」（2026-11-04）。
//
// 形态：与 plugins/rogue 同一个机制 —— plugin.json 的 `code.matchMixin` 被
// server/match/host/mixins.js 按插件顺序拷到对局类原型上。只加方法、不碰构造函数；
// 方法名不能与种子 Match 或其它 mixin 重名（重名抛错）。
//
// 节点模型
//   · 数据表 plugins/roguelike-data-ro4/data/rogue-nodes.json 是 `layers[]`（每层 3 个候选）。
//     第 r 回合 → 第 r 层（1 起算，超出对齐到最后一层）。
//   · 每层的候选里玩家可以选一个（`rogueNodePick`），没选就用第 0 个（确定性默认）。
//   · 节点的 `tier` 决定本回合打哪张官方图：`rogueStageFor(r)` 在 `gd.mode.stages` 里
//     按 `rogue_ro<主题号>_<tier>-` 前缀取一张（主题 ro1–ro6 都参与；同 tier 多张时用
//     `deriveSeed(seed,'rogue-stage:'+r+':'+node.id)` 稳定选一张）。
//   · 时序：mota 的 phases.js 在回合开始调 `this.rogueNodeBegin?.(r)`（先落节点/行动力/奖励），
//     随后 `pickRoundStage(r)` → `stageIdForRound(r)` → `rogueStageFor(r)` 取图。所以要影响
//     某一回合的地图，选择必须在**该回合开始前**落下（上一回合的准备期）；同回合内改选只切
//     `st.current`（本回合地图与奖励已经结算，不重发）。
//
// 与 mota 的接口走「约定名 + typeof 守卫」：
//   · phases.js 每回合 `this.rogueNodeBegin?.(r)`；
//   · phases.js 的 `stageIdForRound(r)` 先问 `this.rogueStageFor?.(r)`；
//   · views.js 把 `this.rogueNodeState?.()` 放进 `pub.rogue.nodes`；
//   · intents.js 的 `g.rogueNode` 调 `this.rogueNodePick?.(ps, nodeId)`。
// 本插件被停用时，四个 typeof 守卫都会跳过，对局仍按原肉鸽逻辑跑。
//
// 数值（层数、候选、行动力、奖励）全部是**自设计（D 类）**，不是官方数据；数据文件头同样标注 selfDesigned。

import { createRng, deriveSeed } from '../../../../server/sim/rng.js';
import { isPool } from '../../../../shared/rogueThemes.js';

const TABLE = 'rogue-nodes';
/**
 * 肉鸽官方图的 id 形如 `rogue_ro<主题号>_<tier>-<编号>`（tools/build-rogue-maps-v2.mjs 生成，见
 * data/stages.json）；主题号不限（ro1–ro6，ro5 的 DLC 图带 `_dlc1` 后缀也照样匹配）。
 */
const STAGE_ID_RE = /^rogue_ro\d+_/;
/** 把 tier（来自数据表，可能含 `-`/`.` 等）转成正则字面量。 */
const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** 从图 id 里取 tier：`rogue_ro4_1-3` → `1`，`rogue_ro5_t-2_dlc1` → `t`；不是肉鸽图时返回空串。 */
const stageTierOf = (sid) => {
  const m = /^rogue_ro\d+_([^-_]+)-/.exec(String(sid));
  return m ? m[1] : '';
};
/** 「可战斗 tier」（主题内兜底第 ② 档）：普通 1–7、精英 t、首领 b。补给 d / 事件 ev / 剧情 fs·sv 等不在内。 */
const COMBAT_TIERS = new Set(['1', '2', '3', '4', '5', '6', '7', 'b', 't']);

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);
const str = (v, d = '') => (typeof v === 'string' && v ? v : d);

/** 回合号 → 层下标（0 起）：夹在 [0, layers.length-1]。 */
const layerIndex = (layers, round) => Math.min(layers.length - 1, Math.max(0, Math.round(num(round, 1)) - 1));
/** 层内的节点（按 id）；找不到返回 null。 */
const nodeInLayer = (layer, id) => (layer && Array.isArray(layer.nodes) ? layer.nodes.find((n) => n.id === id) || null : null);

export class Mixin {
  /** 数据表：content 插件 code.data 的 data/rogue-nodes.json（新表，不覆盖核心表）。 */
  rogueNodeTable() {
    const raw = this.gd && this.gd.raw && typeof this.gd.raw === 'object' ? this.gd.raw[TABLE] : null;
    return raw && Array.isArray(raw.layers) ? raw : null;
  }

  /** 惰性初始化（mixin 拿不到构造函数，只能第一次调用时建）。 */
  rogueNodeInit(table) {
    if (this._rogueNodes) return this._rogueNodes;
    const rules = table.rules && typeof table.rules === 'object' ? table.rules : {};
    const types = table.nodeTypes && typeof table.nodeTypes === 'object' ? table.nodeTypes : {};
    const layers = [];
    for (const layer of table.layers) {
      if (!layer || !Array.isArray(layer.nodes)) continue;
      const lid = str(layer.id);
      const lname = str(layer.name);
      const nodes = [];
      for (const n of layer.nodes) {
        if (!n || !n.id) continue;
        const t = types[n.type] && typeof types[n.type] === 'object' ? types[n.type] : {};
        nodes.push({
          id: str(n.id),
          type: str(n.type, 'battle'),
          name: str(n.name, str(t.name, str(n.id))),
          // tier：肉鸽层级（'1'..'7' / 't' 精英 / 'd' 补给 / 'ev' 事件 / 'b' 首领），决定本回合打哪张图
          tier: str(n.tier),
          layer: lid,
          layerName: lname,
          cost: Math.max(0, num(n.cost, num(t.cost, 1))),
          reward: n.reward && typeof n.reward === 'object' ? { ...n.reward } : {},
        });
      }
      if (nodes.length) layers.push({ id: lid, name: lname, nodes });
    }
    const startAp = Math.max(1, num(rules.startAp, 5));
    this._rogueNodes = {
      ap: startAp,
      maxAp: Math.max(startAp, num(rules.maxAp, startAp)),
      index: -1,
      current: null,
      tier: null,
      visited: [],
      ended: false,
      layer: null,
      layerName: null,
      /** layer 下标 → 玩家选中的 nodeId（未选则缺省）。 */
      picks: Object.create(null),
      layers,
      /** 拍平的全部节点：只用于 state.sequence 的向后兼容展示。 */
      seq: layers.flatMap((l) => l.nodes),
    };
    return this._rogueNodes;
  }

  /**
   * 每回合开始推进到第 r 层（mota phases.js 的 typeof 守卫调用）。
   * 玩家选过（`picks[layer]`）就用选中的，否则用该层第 0 个。
   * 行动力不够时：本层有付得起的休整就改走休整，否则本节点免费（保证最小可玩）。
   * @param {number} r
   */
  rogueNodeBegin(r) {
    if (this.isRogue !== true) return null;
    const table = this.rogueNodeTable();
    if (!table) return null;
    const st = this.rogueNodeInit(table);
    const { layers } = st;
    if (!layers.length) return null;
    const round = Math.max(1, num(r, 1));
    const li = layerIndex(layers, round);
    const layer = layers[li];
    if (!layer) return null;
    let node = nodeInLayer(layer, st.picks[li]) || layer.nodes[0];
    if (!node) return null;

    if (node.cost > st.ap) {
      const rest = layer.nodes.find((n) => n.type === 'rest' && n.cost <= st.ap) || null;
      node = rest ? rest : { ...node, cost: 0 }; // 没有付得起的休整：本节点免费
    }

    st.index = li;
    st.current = node.id;
    st.picks[li] = node.id; // 记录「本层实际落地的节点」：行动力回退后也要与 current 一致
    st.layer = layer.id;
    st.layerName = layer.name;
    st.tier = node.tier;
    st.ap = Math.max(0, st.ap - node.cost);
    if (!st.visited.includes(node.id)) st.visited.push(node.id);

    // 奖励（自设计）：资金 / 生命 / 部署上限 / 行动力。只对存活玩家结算。
    const reward = node.reward || {};
    const players = typeof this.alivePlayers === 'function' ? this.alivePlayers() : [];
    for (const ps of players) {
      if (!ps || ps.alive === false) continue;
      try {
        if (num(reward.funds) !== 0 && typeof ps.addFunds === 'function') ps.addFunds(num(reward.funds), { reason: 'rogue-node' });
        if (num(reward.lp) !== 0) ps.lp = Math.max(1, num(ps.lp, 1) + num(reward.lp));
        if (num(reward.deployCap) !== 0) ps.deployCapBonus = num(ps.deployCapBonus) + num(reward.deployCap);
      } catch (e) { this.reportError?.('rogue node reward', e); }
    }
    if (num(reward.ap) !== 0) st.ap = Math.min(st.maxAp, st.ap + num(reward.ap));

    // 结局钩子：走到最后一层或到达最终回合。
    const lastRound = num(this.gd && this.gd.lastRound, 14);
    if (li >= layers.length - 1 || round >= lastRound) st.ended = true;

    try { this.markPublic?.(); } catch { /* best effort */ }
    return this.rogueNodeState();
  }

  /**
   * 第 r 回合将要落地的节点类型（`battle`/`elite`/`event`/`shop`/`rest`/`boss`），没有节点表时 null。
   *
   * 与 `rogueNodeBegin` 解耦：`phases.js` 的 `_startRoundAfterOffers` 在 `rogueNodeBegin(r)` **之前**就发藏品
   * 与随机事件，那一刻 `st.index` 还停在上一个层，所以节奏判断只能按回合号反算，不能读 `st.index`。
   * @param {number} r 回合号（1 起算）
   * @returns {string|null}
   */
  rogueNodeTypeFor(r) {
    if (this.isRogue !== true) return null;
    const table = this.rogueNodeTable();
    if (!table) return null;
    const st = this.rogueNodeInit(table);
    const { layers } = st;
    if (!layers.length) return null;
    const li = layerIndex(layers, Math.max(1, num(r, 1)));
    const layer = layers[li];
    if (!layer) return null;
    const node = nodeInLayer(layer, st.picks[li]) || layer.nodes[0];
    return node ? String(node.type || '') || null : null;
  }

  /**
   * 某一层（默认当前层）的 3 个候选，供 UI 渲染。
   * @param {number} [round] 回合号（1 起算）；缺省 = 当前已落地的层
   * @returns {Array<{id:string,type:string,name:string,tier:string,cost:number,reward:object,available:boolean}>}
   */
  rogueNodeChoices(round) {
    if (this.isRogue !== true) return [];
    const table = this.rogueNodeTable();
    if (!table) return [];
    const st = this.rogueNodeInit(table);
    const { layers } = st;
    if (!layers.length) return [];
    const r = round === undefined || round === null
      ? (st.index >= 0 ? st.index + 1 : num(this.round, 1))
      : round;
    const layer = layers[layerIndex(layers, r)];
    if (!layer) return [];
    return layer.nodes.map((n) => ({
      id: n.id,
      type: n.type,
      name: n.name,
      tier: n.tier,
      cost: n.cost,
      reward: { ...n.reward },
      available: n.cost <= st.ap,
    }));
  }

  /**
   * 选中一个节点（g.rogueNode）。只接受**当前层**或**下一层**的候选 id。
   *   · 下一层：记进 `st.picks`，下一回合 `rogueNodeBegin` 生效（本回合的地图与奖励不变）；
   *   · 当前层：改 `st.current/tier`（本回合的地图层级随之改变），但**不重发奖励、不退行动力**
   *     ——那些在回合开始已经结算过，重复结算会让资金/生命凭空增长。
   * @param {object} _ps 发起意图的 PlayerState（肉鸽节点是全队共享的，这里只用于保持意图签名）
   * @param {string} nodeId
   * @returns {object} 状态对象（成功）或 `{error:'BAD_TARGET'}`（非法 id）
   */
  rogueNodePick(_ps, nodeId) {
    if (this.isRogue !== true) return { error: 'BAD_TARGET' };
    const id = str(nodeId);
    if (!id) return { error: 'BAD_TARGET' };
    const table = this.rogueNodeTable();
    if (!table) return { error: 'BAD_TARGET' };
    const st = this.rogueNodeInit(table);
    const { layers } = st;
    if (!layers.length) return { error: 'BAD_TARGET' };
    const cur = Number.isInteger(st.index) ? st.index : -1;
    const cands = cur < 0 ? [0] : [cur, cur + 1];
    for (const li of cands) {
      const layer = layers[li];
      if (!layer) continue;
      const node = nodeInLayer(layer, id);
      if (!node) continue;
      st.picks[li] = node.id;
      if (li === cur) {
        // 同层改选：visited 里换成真正生效的那个（奖励/行动力已在回合开始结算，不重算）
        const at = st.visited.lastIndexOf(st.current);
        if (at >= 0) st.visited[at] = node.id;
        else if (!st.visited.includes(node.id)) st.visited.push(node.id);
        st.current = node.id;
        st.tier = node.tier;
      }
      try { this.markPublic?.(); } catch { /* best effort */ }
      return this.rogueNodeState();
    }
    return { error: 'BAD_TARGET' };
  }

  /**
   * 第 r 回合该打哪张肉鸽图：当前节点 tier → `rogue_ro<主题号>_<tier>-*`（主题 ro1–ro6 都算；
   * 同 tier 多张时按 seed 稳定选一张）。
   *
   * 肉鸽「地图主题池」 (this.rogueMapPool, room.create { mapPool }; shared/rogueThemes.js, 2026-11-06):
   * 选池后先按 `^rogue_<池>_` 收窄，再在主题内按 tier / scene / active 过滤。tier 在该主题里没有图时
   * **不回全局**，按下面的顺序在主题内兜底：
   *   ① 同主题同 tier（正常路径）；
   *   ② 同主题的**可战斗 tier**（1..7 / t / b，见 COMBAT_TIERS）；
   *   ③ 同主题任意可用图。
   * 只有该主题一张可用图都没有时才返回 null，调用方落回原来的权重抽取（MatchPhases._stagePool 同样只在该主题内兜底）。
   * 已知缺口：ro1 / ro2 / ro3 没有 `d` 与 `7`，所以补给（d）节点会落到 ②；`'all'`（缺省 / 非法）不收窄、
   * 也不走主题内兜底 —— 行为与加这个开关之前逐字节一致。
   * @param {number} r
   * @returns {string|null}
   */
  rogueStageFor(r) {
    if (this.isRogue !== true) return null;
    const table = this.rogueNodeTable();
    if (!table) return null;
    const st = this.rogueNodeInit(table);
    const { layers } = st;
    if (!layers.length) return null;
    const round = Math.max(1, num(r, 1));
    const li = layerIndex(layers, round);
    const layer = layers[li];
    if (!layer) return null;
    // 已推进到本层：以真正落地的 current 为准（行动力回退后可能与玩家原先的选择不同）。
    let node = st.index === li && st.current ? nodeInLayer(layer, st.current) : null;
    if (!node) node = nodeInLayer(layer, st.picks[li]);
    if (!node) node = layer.nodes[0];
    if (!node) return null;
    const tier = str(node.tier);
    if (!tier) return null;

    const theme = isPool(this.rogueMapPool) ? this.rogueMapPool : 'all';
    const base = Array.isArray(this.gd && this.gd.mode && this.gd.mode.stages) ? this.gd.mode.stages : [];
    // 主题收窄：'all' 收窄成空操作（同一批 id，顺序不变），其余只留该主题前缀。
    const pool = theme === 'all' ? base : base.filter((x) => String(x).startsWith(`rogue_${theme}_`));
    const usable = (sid) => {
      const stage = typeof this.gd.stage === 'function' ? this.gd.stage(sid) : null;
      return !!stage && stage.active !== false;
    };
    const ids = pool.map(String).filter(usable);
    const re = new RegExp(`${STAGE_ID_RE.source}${escapeRe(tier)}-`);

    // 「包含无场景地图」 (Match opts.incompleteMaps, room.setIncompleteMaps; off by default): a tier map without an official
    // scene package would put the round on the procedural board, so only scene-backed ids are drawn — unless the tier has
    // none at all (then the old behaviour: whatever the tier offers), and an empty tier still returns null so
    // MatchPhases.stageIdForRound falls back to its weighted pool.
    const scene = this.sceneStages instanceof Set ? this.sceneStages
      : (this.gd && this.gd.sceneStages instanceof Set ? this.gd.sceneStages : null);
    const draw = (candidates) => {
      const kept = this.incompleteMaps === true || !scene ? candidates : candidates.filter((sid) => scene.has(sid));
      const cands = kept.length ? kept : candidates;
      if (!cands.length) return null;
      const rng = createRng(deriveSeed(this.seed, `rogue-stage:${round}:${node.id}`));
      return cands[rng.int(cands.length)] || null;
    };

    // ① 同 tier
    const tierHit = draw(ids.filter((sid) => re.test(sid)));
    if (tierHit) return tierHit;
    // 'all'：老行为 —— 该 tier 没有可用图就是 null（不回别的 tier，调用方落回权重抽取）。
    if (theme === 'all') return null;
    // ② 主题内的可战斗 tier
    const combatHit = draw(ids.filter((sid) => COMBAT_TIERS.has(stageTierOf(sid))));
    if (combatHit) return combatHit;
    // ③ 主题内任意可用图；该主题一张可用图都没有时才是 null
    return draw(ids);
  }

  /** 下发给客户端的节点状态（views.js 的 pub.rogue.nodes）。 */
  rogueNodeState() {
    const st = this._rogueNodes;
    if (!st) return null;
    const li = Number.isInteger(st.index) && st.index >= 0 ? st.index : -1;
    const round = li + 1;
    const nextRound = li < 0 ? 1 : round + 1;
    const nextChoices = li < 0 || nextRound <= st.layers.length ? this.rogueNodeChoices(nextRound) : [];
    return {
      ap: st.ap,
      maxAp: st.maxAp,
      index: st.index,
      current: st.current,
      layer: st.layer,
      layerName: st.layerName,
      tier: st.tier,
      picked: li >= 0 ? st.picks[li] || null : null,
      // 当前层（已落地）的 3 个候选；round 是它对应的回合号（UI 用来标「第 N 层」）
      round: li >= 0 ? round : 0,
      choices: this.rogueNodeChoices(li >= 0 ? round : 1),
      // 下一层的候选：这是**真正能改变下一回合地图**的那一组（见文件头的时序说明）
      nextRound: nextChoices.length ? nextRound : 0,
      nextChoices,
      nextPicked: nextChoices.length ? st.picks[li + 1] || null : null,
      mapId: li >= 0 ? this.rogueStageFor(round) : null,
      ended: st.ended,
      visited: st.visited.slice(),
      sequence: st.seq.map((n) => ({
        id: n.id, type: n.type, name: n.name, tier: n.tier, layer: n.layer, layerName: n.layerName, cost: n.cost,
      })),
    };
  }

  /** 探针：宿主日志 / 真机自检确认叠加层到位（不参与玩法）。 */
  rogueNodePluginInfo() {
    return { id: 'roguelike-core', mixin: true, round: this.round ?? null, rogue: this.isRogue === true };
  }
}
