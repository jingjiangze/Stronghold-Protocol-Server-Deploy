// plugins/mota/server/match/monsterContract.js — 怪物方 AI 契约（契约 + 校验，不含实现）。
// 与 botContract.js 同构：hook 化、构造期强校验、冻结。
//
// 为什么要有契约：攻方的 AI 决策有三处（选目标 / 买什么 / 投放什么），玩法会继续变。把决策抽成三个 hook 之后，
// 引擎（match/match/confront.js 的 botConfront）只负责「校验 + 落地」，策略可以换（内置 legacy / cardpool，
// 插件也能注册自己的），而不需要改引擎，也不需要碰 bot.js。
//
// 约定（引擎侧，见 botConfront）：
//   · pickTargets(m, ps) → playerId | null；null = 交回引擎的 assignConfrontTarget（按对手剩余 LP / 已被攻击次数）。
//   · shopPlan(m, ps)    → 本回合买了哪些格（诊断/测试用）；引擎不读它的返回值，副作用是 ps.monsterDraft.picks。
//   · deployPlan(m, ps)  → picks 数组 | null；null = 交回引擎既有的贪心填充（legacy 行为）。
//     返回数组时，引擎仍会过 `_botConfrontPlan`（路线/时刻）与 `_sanitizeBotPicks`（预算/只数/合法性）。
// 三个 hook 都必须是函数 —— 不会写就显式 `() => null`（= 交回引擎），或继承 base（缺省 = MONSTER_LEGACY_SENTINEL）。
//
// 实现只 import 契约与商店，不 import 注册表 —— 无环。

/** 策略必须实现的三个 hook（顺序即文档顺序）。 */
export const MONSTER_HOOKS = Object.freeze(['pickTargets', 'shopPlan', 'deployPlan']);

/** 策略 id 的形状：kebab-case（与 botContract.js 的 validId 同一条正则）。 */
const validId = (id) => typeof id === 'string' && /^[a-z][a-z0-9-]*$/.test(id);

/**
 * 契约层的 legacy 占位：三个 hook 一律返回 null = 「交给引擎既有实现」。
 * 它是 defineMonsterStrategy 的**缺省 base**，也是 createMonsterRegistry 恒含的 legacy
 * （除非调用方自己给了一份 legacy；真正的内置实现在 monsterStrategies.js）。
 * @type {Readonly<{ id: string, name: string, desc: string, base: null, pickTargets: Function, shopPlan: Function, deployPlan: Function }>}
 */
export const MONSTER_LEGACY_SENTINEL = Object.freeze({
  id: 'legacy',
  name: 'legacy',
  desc: '引擎既有行为（每个 hook 都交回引擎）',
  base: null,
  pickTargets: () => null,
  shopPlan: () => null,
  deployPlan: () => null,
});

/** 策略对象允许的键（其余键一律拒绝，避免拼错的 hook 静默失效）。 */
const STRATEGY_FIELDS = new Set(['id', 'name', 'desc', 'base', ...MONSTER_HOOKS]);

/**
 * 定义一个怪物方策略（构造期校验 + 冻结）。缺省的 hook 与 name/desc 从 base 继承，base 缺省 = legacy 占位。
 * @param {object} definition
 * @param {string} definition.id 必填，`/^[a-z][a-z0-9-]*$/`
 * @param {string} [definition.name] @param {string} [definition.desc]
 * @param {object} [definition.base] 继承来源（已定义的策略对象），缺省 = MONSTER_LEGACY_SENTINEL
 * @param {Function} [definition.pickTargets] @param {Function} [definition.shopPlan] @param {Function} [definition.deployPlan]
 * @returns {Readonly<object>} 冻结的策略对象（缺省字段已从 base 补齐）
 */
export function defineMonsterStrategy(definition) {
  if (!definition || typeof definition !== 'object' || Array.isArray(definition)) {
    throw new TypeError('Monster strategy: object required');
  }
  const { id } = definition;
  const base = definition.base ?? MONSTER_LEGACY_SENTINEL;
  if (!validId(id)) throw new TypeError('Monster strategy: id must be a lowercase identifier (letters, digits, hyphens)');
  if (!base || typeof base !== 'object' || !validId(base.id) || MONSTER_HOOKS.some((hook) => typeof base[hook] !== 'function')) {
    throw new TypeError(`Monster strategy ${id}: invalid base`);
  }
  for (const key of Object.keys(definition)) {
    if (!STRATEGY_FIELDS.has(key)) throw new TypeError(`Monster strategy ${id}: unknown hook ${key}`);
  }
  const out = {
    id,
    name: typeof definition.name === 'string' && definition.name ? definition.name : (base.name || id),
    desc: typeof definition.desc === 'string' ? definition.desc : (base.desc || ''),
  };
  for (const hook of MONSTER_HOOKS) {
    const fn = Object.hasOwn(definition, hook) ? definition[hook] : base[hook];
    if (typeof fn !== 'function') throw new TypeError(`Monster strategy ${id}: ${hook} must be a function`);
    out[hook] = fn;
  }
  return Object.freeze(out);
}

/**
 * 已经定义好的策略（defineMonsterStrategy 的产物）：冻结、id 合法、三个 hook 都是函数。
 * @param {any} x
 */
const isDefinedStrategy = (x) => !!x && typeof x === 'object' && Object.isFrozen(x) && validId(x.id)
  && MONSTER_HOOKS.every((hook) => typeof x[hook] === 'function');

/**
 * 建一张冻结的策略表。**恒含 legacy**（没给就用 MONSTER_LEGACY_SENTINEL；给了一份 id 为 legacy 的策略则用它——
 * 占位不是真策略，允许被替换）。重复 id 抛错；返回的是冻结的**普通对象**（`registry[id]` / `Object.hasOwn`）。
 * @param {object[]} [definitions] 策略定义（defineMonsterStrategy 的入参形状）或已定义好的策略
 * @returns {Readonly<Record<string, Readonly<object>>>}
 */
export function createMonsterRegistry(definitions = []) {
  if (!Array.isArray(definitions)) throw new TypeError('Monster registry: definitions must be an array');
  const out = { legacy: MONSTER_LEGACY_SENTINEL };
  for (const definition of definitions) {
    const strategy = isDefinedStrategy(definition) ? definition : defineMonsterStrategy(definition);
    // 占位 legacy 不是真策略：调用方自己提供的 legacy 直接顶替它（其它任何重复 id 仍然抛错）
    if (Object.hasOwn(out, strategy.id) && !(strategy.id === 'legacy' && out.legacy === MONSTER_LEGACY_SENTINEL)) {
      throw new Error(`Duplicate monster strategy: ${strategy.id}`);
    }
    out[strategy.id] = strategy;
  }
  return Object.freeze(out);
}
