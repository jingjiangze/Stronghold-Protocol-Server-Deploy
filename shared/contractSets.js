// shared/contractSets.js — 危机合约的「指标集」分组 (owner:「将合约改成这种一集一集的分类」).
//
// 官方把危机合约分成若干「指标集」(一集里有若干条合约,勾选率与分数各不相同)。我们现在的合约表只有 **1 条**
// (shared/contracts.js `noLpSharing`),所以分组成立、但只有一个集 —— 这不是占位符,是数据的真实规模:
// 合约表铺开之后,只要给每条加一个 `set: { id, name }`,这里就会自动长出第二个、第三个集,界面不用改。
//
// 为什么单独一个文件而不是塞进 contracts.js:分组是**展示层**的事(合约本身不需要知道自己在第几集),
// 而且这一层是纯函数,可以直接对着它写测试。contracts.js 保持"规则 + 校验"的职责。

import { CONTRACTS, CONTRACT_SETS } from './contracts.js';

/** 没有声明 `set` 的合约落在这一集(比丢掉它们好 —— 一条合约不该因为没写分组就从界面消失)。 */
export const DEFAULT_SET = Object.freeze({ id: 'misc', name: '其他指标', nameEn: 'MISCELLANEOUS' });

/** 中文数字,用于「指标集·一」这种序号。超过十集就退回阿拉伯数字。 */
const CN = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
export const cnNum = (n) => (Number.isInteger(n) && n >= 1 && n <= 10 ? CN[n] : String(n));

/**
 * 把一个合约的 `set` 读成 `{ id, name, nameEn }`。接受两种写法:
 *   `set: 'xxx'`                     —— 只有 id(名字用默认的占位规则生成)
 *   `set: { id, name, nameEn }`      —— 完整
 * @param {any} c
 */
function setOf(c) {
  const s = c && c.set;
  if (typeof s === 'string' && s) return { id: s, name: '', nameEn: '' };
  if (s && typeof s === 'object' && typeof s.id === 'string' && s.id) {
    return { id: s.id, name: typeof s.name === 'string' ? s.name : '', nameEn: typeof s.nameEn === 'string' ? s.nameEn : '' };
  }
  return { ...DEFAULT_SET };
}

/**
 * 合约 → 指标集分组。
 *
 * 集的顺序:先按 `setOrder`(升序,缺省排最后),再按 id —— 和集内合约的顺序(`points` 降序,再按 id)一样,
 * 都是**确定的**:同一份数据每次渲染得到同一个顺序,不会因为对象键序抖动。
 *
 * @param {readonly any[]} [contracts]
 * @returns {{ id: string, name: string, nameEn: string, index: number, contracts: any[],
 *             points: number, pickedPoints: number, pickedCount: number }[]}
 *   `index` 是 1 起的集号(界面显示「指标集·一」);`pickedPoints` 未选中时为 0,由调用方传入 `picked` 才有值
 */
export function contractSets(contracts = CONTRACTS) {
  const list = Array.isArray(contracts) ? contracts.filter((c) => c && typeof c.id === 'string') : [];
  /*
   * 集的排序来自 `CONTRACT_SETS`(每个集**一条**定义),而不是各条合约上的 `setOrder`。
   *
   * 为什么:45 条合约里有 44 条没写 `setOrder`(写了也是重复 1..7),靠它排序会在"某条合约没写"时
   * 悄悄退化成按 id 字母序。集的顺序是**集自己的属性**,就该从集的定义读。
   * 兜底:定义里没有的集(数据写错时)排到最后,不丢内容。
   */
  const orderOf = new Map(CONTRACT_SETS.map((s) => [s.id, s.order]));
  const known = new Map(CONTRACT_SETS.map((s) => [s.id, s]));
  const buckets = new Map();
  for (const c of list) {
    const s = setOf(c);
    if (!buckets.has(s.id)) {
      const def = known.get(s.id);
      buckets.set(s.id, {
        ...s,
        // 名字优先用集定义里的(权威),合约上那份只是冗余
        name: (def && def.name) || s.name,
        nameEn: (def && def.nameEn) || s.nameEn,
        contracts: [],
        order: orderOf.has(s.id) ? orderOf.get(s.id) : 999,
      });
    }
    buckets.get(s.id).contracts.push(c);
  }
  return [...buckets.values()]
    .sort((a, b) => (a.order - b.order) || a.id.localeCompare(b.id))
    .map((s, i) => {
      /*
       * 集内顺序:**按点数升序**,同分再按声明顺序。
       *
       * 升序(不是降序)是有意的 —— 指标集是一条"越往下越狠"的链(临阵磨枪 −10% → 训练不足 −20% → 恢复期 −30%),
       * 排成升序时它读起来就是一条递进的路线,而且便宜的门槛在上、贵的在下,和玩家的浏览习惯一致。
       */
      const cs = s.contracts.slice().sort((a, b) => (a.points || 0) - (b.points || 0));
      return {
        id: s.id,
        // 没给名字就用序号起一个,保证界面上永远有字可显示
        name: s.name || `指标集：${cnNum(i + 1)}`,
        nameEn: s.nameEn || '',
        index: i + 1,
        contracts: cs,
        points: cs.reduce((sum, c) => sum + (c.points || 0), 0),
      };
    });
}

/**
 * 一个集里选了几条、共几分 —— 集标题上的 `3/5` 与右侧「已开启」栏用它。
 * @param {{ contracts: any[] }} set @param {Set<string>|readonly string[]} picked
 */
export function setProgress(set, picked) {
  const has = picked instanceof Set ? (id) => picked.has(id) : (id) => Array.isArray(picked) && picked.includes(id);
  const on = (set && Array.isArray(set.contracts) ? set.contracts : []).filter((c) => has(c.id));
  return { count: on.length, total: (set && set.contracts ? set.contracts.length : 0), points: on.reduce((s, c) => s + (c.points || 0), 0) };
}

/**
 * 把一个指标集里的合约排成**连线图**。
 *
 * ── 规则(owner 定的,他连着强调了三次)──────────────────────────────────────────────────────────
 *
 * **横着 = 左右,不是上下。**
 *
 *   · **没有前置的合约并排在同一行** —— 「资金中断 │ 临时阵地 │ 破屋 │ 人手不足」是四个挨着的瓦片。
 *   · **链往右接** —— 「资金中断 → 价格上涨 → 最大极限」是一行三个,从左往右读。
 *   · **只有真正分叉时才往下长一行** —— 一个节点有多个孩子时,**最长的**那条子链继续留在本行右边,
 *     其余孩子落到下一行、从那一行往右排。
 *
 * 前两版都把"行"当成了链的深度(每条链各占一行、上下叠起来),于是「资金中断」下面才是「价格上涨」,
 * 正是 owner 说的「你这不是竖的上下吗」。
 *
 * ── 档位链 ──────────────────────────────────────────────────────────────────────────────────────
 *
 * 一组两两互斥、谁也不 requires 谁的合约(人手不足 −1 → 堪堪一用 −2 → 紧张后援 −3 → 通讯中断 −5;
 * 临阵磨枪 → 训练不足 → 恢复期 → 重伤残)是一条**只能靠点数分深浅**的递进链:数据里它们只用
 * `excludes` 表达(写 `requires` 会与 `excludes` 自相矛盾,实测会让整个选择集变空)。
 * 整组按点数从浅到深**横着排在同一行**,组外的孩子(准备不足 / 紧凑 / 医疗保障缺失 …)挂在**最深那一档**
 * 右边,另起新行。
 *
 * ── 资金链为什么不是档位组 ──────────────────────────────────────────────────────────────────────
 *
 * 「资金中断 / 价格上涨 / 最大极限」也是两两互斥,但它们**真有 requires**,是一条显式前置链,
 * 不能被当成"同位档位"塞进一格 —— 否则链条顺序会被点数排序打乱、连线也会整条丢失。
 * 判据必须用**传递闭包**:「最大极限」是**经「价格上涨」间接**依赖「资金中断」的,只看直接边拦不住。
 *
 * @param {{ contracts: any[] }} set
 * @returns {{ nodes: { c: any, x: number, y: number, parent: string|null }[],
 *             links: { from: string, to: string, x: number, y: number, fromX: number, dir: 'right'|'down'|'diag' }[],
 *             cols: number, rows: number, minX: number }}
 */
export function contractTree(set) {
  const list = set && Array.isArray(set.contracts) ? set.contracts : [];
  if (!list.length) return { nodes: [], links: [], cols: 0, rows: 0, minX: 0 };
  const byId = new Map(list.map((c) => [c.id, c]));
  const ids = new Set(byId.keys());

  /** 集内顺序:按点数升序,同分按声明顺序。 */
  const pos = new Map(list.map((c, i) => [c.id, i]));
  const byScore = list.slice().sort((a, b) => (a.points || 0) - (b.points || 0) || pos.get(a.id) - pos.get(b.id));
  const order = new Map(byScore.map((c, i) => [c.id, i]));

  /*
   * ── 档位分组 ──────────────────────────────────────────────────────────────────────────────────
   *
   * 先**对称化** `excludes`:数据里只保证"我排除谁",不保证反向也写(「重伤残」排除了「恢复期」,
   * 而「恢复期」的列表里没有「重伤残」)。语义上互斥是对称的,走单向边会断链,
   * 实测「临阵磨枪/训练不足/恢复期/重伤残」被拆成两组、主干直接散架。
   */
  const excludesOf = (id) => {
    const out = new Set((byId.get(id)?.excludes || []).filter((e) => ids.has(e) && e !== id));
    for (const c of list) if (c.id !== id && (c.excludes || []).includes(id)) out.add(c.id);
    return [...out];
  };
  /** 沿 `requires` 往上走一遍,返回 `id` 的所有祖先(传递闭包)。 */
  const ancestorsOf = (id) => {
    const out = new Set();
    const stack = [...(byId.get(id)?.requires || [])];
    while (stack.length) {
      const p = stack.pop();
      if (!ids.has(p) || out.has(p)) continue;
      out.add(p);
      for (const q of byId.get(p)?.requires || []) stack.push(q);
    }
    return out;
  };
  const anc = new Map(list.map((c) => [c.id, ancestorsOf(c.id)]));
  const reqLinked = (a, b) => anc.get(a)?.has(b) || anc.get(b)?.has(a);

  const group = new Map();         // id → 组号
  const groups = [];
  {
    const seen = new Set();
    for (const c of list) {
      if (seen.has(c.id)) continue;
      const peers = excludesOf(c.id);
      if (!peers.length) continue;
      const raw = [c.id];
      seen.add(c.id);
      const stack = [...peers];
      while (stack.length) {
        const id = stack.pop();
        if (!ids.has(id) || seen.has(id)) continue;
        seen.add(id);
        raw.push(id);
        for (const e of excludesOf(id)) stack.push(e);
      }
      if (raw.length < 2) continue;
      /* 并查集:没有 requires 关系的才合并(同位替代);有前置关系的拆开。 */
      const up = new Map(raw.map((id) => [id, id]));
      const find = (x) => { while (up.get(x) !== x) { up.set(x, up.get(up.get(x))); x = up.get(x); } return x; };
      for (let i = 0; i < raw.length; i++) {
        for (let j = i + 1; j < raw.length; j++) {
          if (reqLinked(raw[i], raw[j])) continue;
          const a = find(raw[i]); const b = find(raw[j]);
          if (a !== b) up.set(a, b);
        }
      }
      const buckets = new Map();
      for (const id of raw) {
        const r = find(id);
        if (!buckets.has(r)) buckets.set(r, []);
        buckets.get(r).push(id);
      }
      for (const chain of buckets.values()) {
        if (chain.length < 2) continue;
        chain.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));   // 从浅到深
        const gi = groups.length;
        groups.push(chain);
        for (const id of chain) group.set(id, gi);
      }
    }
  }
  const chainOf = (id) => (group.has(id) ? groups[group.get(id)] : [id]);
  const repOf = (id) => { const ch = chainOf(id); return ch[ch.length - 1]; };   // 组代表 = 最深那一档

  /*
   * ── 树边:只认 `requires` ──────────────────────────────────────────────────────────────────────
   *
   * 每个节点最多认**一个**父(取它 requires 里点数最浅的那个),这样才是一棵树。
   * 父若属于某个档位组,改挂到该组的**代表**:「准备不足」写的是 `requires: ['doomHasty']`,
   * 而「临阵磨枪」在布局上不单独占格,挂到「重伤残」才接得上 —— 否则这条边会被整条丢掉
   * (实测:五个共享子节点全成了孤立的根)。
   */
  const parentOf = new Map();
  for (const c of list) {
    const reqs = (c.requires || [])
      .filter((p) => ids.has(p) && p !== c.id)
      .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
    if (!reqs.length) continue;
    const rep = repOf(reqs[0]);
    if (rep === c.id) continue;
    parentOf.set(c.id, rep);
  }
  /* 成环兜底:沿父链走一圈若回到自己就丢掉这条边(数据不该有环,但别死循环)。 */
  for (const id of [...parentOf.keys()]) {
    const seen = new Set([id]);
    let cur = parentOf.get(id);
    while (cur) {
      if (seen.has(cur)) { parentOf.delete(id); break; }
      seen.add(cur);
      cur = parentOf.get(cur);
    }
  }

  /** 逻辑节点 = 档位组的代表;不在组里的就是自己。 */
  const kidsOf = (id) => list
    .filter((k) => parentOf.get(k.id) === id && repOf(k.id) === k.id)
    .map((k) => k.id)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  /** 从 `id` 出发沿最长子链能走多远(含自身,按逻辑节点计)。 */
  const depthOf = new Map();
  const calcDepth = (id, seen) => {
    if (depthOf.has(id)) return depthOf.get(id);
    if (seen.has(id)) return 1;
    seen.add(id);
    let d = 1;
    for (const k of kidsOf(id)) d = Math.max(d, 1 + calcDepth(k, seen));
    seen.delete(id);
    depthOf.set(id, d);
    return d;
  };
  for (const c of list) if (repOf(c.id) === c.id) calcDepth(c.id, new Set());

  /*
   * ── 铺行:同层左右排开,链往右接 ────────────────────────────────────────────────────────────────
   *
   * `next[x]` = 每个**行**上"下一个空位"的列号。行只在真正分叉时才 +1,所以同一层的东西一定会
   * 左右并排,而不会被推成上下一串。
   */
  const nodes = [];
  const links = [];
  const xOf = new Map();
  /** 已铺节点 → 它的格子对象(算父坐标、判"是否已铺"都用它)。 */
  const placedAt = new Map();
  /** 目前用到过的最大的行号(换行时往它下面接)。 */
  const highestRow = () => (cursor.length ? cursor.length - 1 : 0);
  /*
   * ── 铺格子(从左到右,满了换行)────────────────────────────────────────────────────────────────
   *
   * `cursor[row]` = 该行**下一个空位**的列号。
   *
   * ⚠ 必须**按宽度换行**,不能让一条链无限往右长。
   * 「毁灭」去掉前置之后支线减益都成了根,一格一格往右排下去实测有 **19 列 ≈ 1370px**,
   * 而面板只有 ~822px —— 右边三分之一直接被 `overflow` 切掉(owner:「人手不足这条线超出了框架往左挪动ui」)。
   * `MAX_COLS` 是面板能容纳的列数,超了就换到下一行、从最左边重新开始。
   *
   * ⚠ `MAX_COLS` 只在**树的边界**上生效(也就是说换行永远发生在"另一个根/分叉"开头),
   * 不会把一条链从中间劈开 —— 链读起来仍然是一整行。
   */
  const MAX_COLS = 11;                                   // 11 · 1.04rem ≈ 793px < 822px
  const cursor = [];                                     // cursor[row] = 该行下一个空位的列号
  const at = (row) => cursor[row] ?? 0;
  const bump = (row, to) => { cursor[row] = Math.max(at(row), to); };
  /** 这一行还放得下 `n` 格吗。 */
  const fits = (row, n) => at(row) + n <= MAX_COLS;
  const pending = [];

  /**
   * 铺一条从 `root` 起的链(档位组横着展开,分叉落下一行)。
   * @param {string|null} fromParent 这一行是**从哪个节点分叉下来的** —— 直接作为 `root` 的父,
   *   跨行归属线要靠它(第一版每行都把 `parent` 重置成 null,于是"落到下一行"的节点
   *   丢了父信息,`lane` 一条也画不出来)。
   */
  const layoutRow = (root, row, gap = false, fromParent = null) => {
    let parent = fromParent;
    let cur = root;
    for (;;) {
      const chain = chainOf(cur);
      if (placedAt.has(cur)) break;                       // 已经铺过(多个父共享一个孩子)
      /* 放不下就整条链换到下一行,别从中间劈开。 */
      let r = row;
      if (!fits(r, chain.length)) { r = highestRow() + 1; }
      let x = at(r) + (gap ? 1 : 0);
      bump(r, x);
      let prev = null;
      for (const cid of chain) {
        nodes.push({ c: byId.get(cid), x, y: r, parent: prev || parent });
        placedAt.set(cid, nodes[nodes.length - 1]);
        xOf.set(cid, x);
        if (prev) {
          links.push({ from: prev, to: cid, x, y: r, fromX: xOf.get(prev), dir: 'right' });
        } else if (parent != null) {
          const pNode = placedAt.get(parent);
          const fx = pNode ? pNode.x : x;
          links.push({ from: parent, to: cid, x, y: r, fromX: fx, dir: pNode && pNode.y === r ? 'right' : 'diag' });
        }
        prev = cid;
        x += 1;
      }
      bump(r, x);
      gap = false;
      const tail = prev;
      const kids = kidsOf(tail);
      if (!kids.length) break;
      /* 最长的子链续在本行右边;其余孩子落到下一行(带上父,跨行归属线要用)。 */
      let deep = kids[0];
      for (const k of kids) if ((depthOf.get(k) ?? 1) > (depthOf.get(deep) ?? 1)) deep = k;
      for (const k of kids) if (k !== deep) pending.push({ root: k, row: r + 1, from: tail });
      parent = tail;
      row = r;
      cur = deep;
    }
  };

  /* 根 = 没有前置、且不是组里非代表档位的节点,按点数升序 —— 于是它们**并排在前面的行里**。 */
  const rootIds = byScore.filter((c) => !parentOf.has(c.id) && repOf(c.id) === c.id).map((c) => c.id);
  let rootRow = 0;
  for (const r of rootIds) {
    /*
     * 树与树之间留 **1 格空白**(行首不留):这样「资金中断→价格上涨→最大极限」「临时阵地」「破屋」
     * 「人手不足→…」读起来是几段,而不是一串挨着的瓦片。
     */
    const need = chainOf(r).length + (at(rootRow) > 0 ? 1 : 0);
    if (!fits(rootRow, need)) rootRow = highestRow() + 1;
    pending.push({ root: r, row: rootRow, gap: at(rootRow) > 0 });
  }
  for (let qi = 0; qi < pending.length; qi++) {
    const job = pending[qi];
    layoutRow(job.root, job.row, job.gap, job.from ?? null);
  }

  /* 兜底:环导致谁都没被铺到 —— 直接追加,绝不丢内容。 */
  const placed = new Set(nodes.map((n) => n.c.id));
  for (const c of list) {
    if (placed.has(c.id)) continue;
    const row = cursor.length + 1;
    nodes.push({ c, x: at(row), y: row, parent: null });
    bump(row, at(row) + 1);
  }

  /*
   * 跨行归属线:每个"落到下一行"的节点,从它的**父节点**引一条线下来。
   *
   * ⚠ 少了这一步,下一行的瓦片**看不出是谁的孩子** —— 实测「湮灭」里
   * `披甲铁卫 │ 鳞片 → 山` 并排躺在第二行,和第一行的「精锐之敌」之间一条线都没有,
   * 读起来像"披甲铁卫和鳞片互相连着"(owner 就是这么报的:「鳞片需要和披甲铁卫链接」)。
   * 有了这条线,归属一眼可见。
   *
   * 放在所有行都铺完之后 —— 要读父与子已定的坐标。
   */
  for (const n of nodes) {
    if (!n.parent) continue;
    const p = placedAt.get(n.parent);
    if (!p || p.y === n.y) continue;
    const py = p.y + 1;
    if (py >= n.y) continue;                              // 相邻行:交给常规边,别叠一条重复的
    if (links.some((l) => l.from === n.parent && l.to === n.c.id)) continue;
    links.push({ from: n.parent, to: n.c.id, x: n.x, y: n.y, fromX: p.x, dir: 'lane', laneY: py });
  }

  const minX = Math.min(0, ...nodes.map((n) => n.x));
  const maxX = Math.max(0, ...nodes.map((n) => n.x));
  const maxY = Math.max(0, ...nodes.map((n) => n.y));
  return { nodes, links, cols: maxX - minX + 1, rows: maxY + 1, minX };
}

/**
 * 连线路径的**几何常量**(单位:rem,和 CSS 里的网格尺寸一一对应)。
 *
 * ⚠ 这里必须和 `contracts.css` 的 `.ctrset__body--tree`(`--cell-w` / `--cell-h`)保持一致 —— 两边不一致
 * 的话 SVG 会被拉伸/压扁,连线看起来就是"接了半截"。
 *
 * `rowH` 必须**大于** `tile`:每个节点除了瓦片还有下面一行名称,跨行连线要从名称**下方**才开始,
 * 否则它会横穿父节点的名称(实测截图里「精锐之敌」被红线压过)。
 */
export const LINK_GEO = Object.freeze({ tile: 0.9, gapX: 0.14, rowH: 1.22, r: 0.14 });
/** 一格(瓦片 + 列距)的宽度,rem。 */
export const CELL_W = LINK_GEO.tile + LINK_GEO.gapX;

/**
 * 把 `contractTree` 的网格坐标换成**可直接画线的 SVG 路径**。
 *
 * 三种边,三种走法:
 *   · `right` —— **同一行的链**(资金中断 → 价格上涨 → 最大极限):父的**右缘中点**直连子的**左缘中点**,
 *     一条水平短线。这是新布局的主边,绝大多数连线都是它。
 *   · `diag`  —— 分叉落到下一行:父的**下缘中点**竖直下探到两行之间,水平折到子那一列,再竖直进入子的上缘。
 *   · `lane`  —— **远距离归属线**(隔了一行以上的分叉):从父的**下缘中点**一路竖直下探到子所在行的
 *     上方通道,再水平折到子那一列进入。没有它,隔行的孩子看起来不属于任何人。
 *   · `down`  —— 同列跨行(新布局理论上不出现,保留兜底)。
 *
 * ⚠ 同一行的链**不能**再用"下缘中点 → 上缘中点":两个端点的 y 相同,那段会退化成零长度、什么也看不见,
 * 而且会从瓦片中间横穿过去。
 *
 * ⚠ 跨行连线的横段不能画在 `cy`(子节点上缘):同一层所有子节点的上缘 y 相同,横段会**全部叠在
 * 同一根 y 上**,渲染出来是一条横穿整行的长红线,看不出哪条接哪个孩子。放在 `py` 与 `cy` 的中点,
 * 每条连线就有一段自己的竖直下探。
 *
 * @param {{ nodes: any[], links: any[] }} tree `contractTree` 的结果
 * @returns {{ d: string, key: string }[]}
 */
export function contractLinkPaths(tree) {
  if (!tree || !Array.isArray(tree.links)) return [];
  const { tile, rowH, r } = LINK_GEO;
  const nodeAt = new Map((tree.nodes || []).map((n) => [n.c.id, n]));
  const cxOf = (n) => n.x * CELL_W + tile / 2;
  const leftOf = (n) => n.x * CELL_W;
  const rightOf = (n) => n.x * CELL_W + tile;
  const topOf = (n) => n.y * rowH;
  const botOf = (n) => n.y * rowH + tile;
  const out = [];
  for (const l of tree.links) {
    const p = nodeAt.get(l.from);
    const c = nodeAt.get(l.to);
    if (!p || !c) continue;
    const key = l.from + '>' + l.to;
    if (p.y === c.y) {
      const y = (topOf(p) + botOf(p)) / 2;
      out.push({ key, d: `M ${rightOf(p)} ${y} L ${leftOf(c)} ${y}` });
      continue;
    }
    const px = cxOf(p), py = botOf(p);
    const cx = cxOf(c), cy = topOf(c);
    if (Math.abs(px - cx) < 1e-6) {
      out.push({ key, d: `M ${px} ${py} L ${cx} ${cy}` });
      continue;
    }
    const chan = (py + cy) / 2;
    const rr = Math.max(0, Math.min(r, Math.abs(chan - py) / 2));
    const dir = cx > px ? 1 : -1;
    out.push({
      key,
      d: `M ${px} ${py} L ${px} ${chan - rr} Q ${px} ${chan} ${px + dir * rr} ${chan}`
        + ` L ${cx - dir * rr} ${chan} Q ${cx} ${chan} ${cx} ${chan + rr} L ${cx} ${cy}`,
    });
  }
  return out;
}
