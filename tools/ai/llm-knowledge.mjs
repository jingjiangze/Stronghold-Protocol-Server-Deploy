// §35.15. [ASSUMED] System-prompt view of an sp-knowledge/1 pack. The pack itself is unchanged:
// strategyCandidates still reads the full local playbook. Third-party agents still receive the full hello pack.
const capsOf = (op, byId) => {
  const row = byId.get(op.id) || byId.get(op.baseId);
  const c = row?.capabilities;
  return { air: !!c?.air, block: !!c?.block, sustain: !!c?.sustain, elementRecovery: !!c?.elementRecovery };
};

export function slimKnowledge(pack, { maxChars = Infinity } = {}) {
  const view = slimView(pack);
  // [ASSUMED] Compact enemies stay while the example system text fits in 200000 characters.
  // Translated catalogues (English funny) exceed that; the round's upcoming list still names those enemies.
  // 2026-11-03：modes 数据变大后，英文目录仅靠「丢弃 enemies」已经压不进 200k（实测仍超 885 字符）⇒
  // 再加两级兜底：先丢 items（30k 级），再丢 bosses。中文提示词本来就在预算内，不受影响。
  // 2026-11-05：怪物表 249 → 491 后整段丢弃 enemies 让中文 hard 也拿不到任何敌人（顾问看不见敌方图鉴）⇒
  // 改成按预算截断：保留能装下的前 N 条，只有连 1 条都装不下（前缀已接近预算）时才是空数组。
  // 仍然先动 enemies，再依次兜底丢 items、bosses；总长始终 <= maxChars。截断按数组原序取前缀，结果确定。
  let out = view;
  if (out.enemies.length && JSON.stringify(out).length > maxChars) {
    out = { ...out, enemies: out.enemies.slice(0, fitEnemies(view, maxChars)) };
  }
  if (out.items && out.items.length && JSON.stringify(out).length > maxChars) out = { ...out, items: [] };
  if (out.bosses && out.bosses.length && JSON.stringify(out).length > maxChars) out = { ...out, bosses: [] };
  return out;
}

// Largest enemies prefix whose whole-view JSON still fits the budget. JSON length grows monotonically with the
// prefix length, so the binary search (about log2(n) stringify passes) is deterministic. 0 when not even one fits.
function fitEnemies(view, maxChars) {
  const fits = n => JSON.stringify({ ...view, enemies: view.enemies.slice(0, n) }).length <= maxChars;
  if (fits(view.enemies.length)) return view.enemies.length;
  let lo = 0, hi = view.enemies.length; // fits(hi) is false; fits(0) may be false too
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (fits(mid)) lo = mid; else hi = mid - 1;
  }
  return fits(lo) ? lo : 0;
}

function slimView(pack) {
  const pb = pack.playbook || {};
  const byId = new Map((pb.operators || []).map(o => [o.id, o]));
  const fly = new Map((pb.enemies || []).map(e => [e.id, !!e.fly]));
  const insights = new Map((pb.bands || []).map(b => [b.id, b.insights || []]));
  const trait = op => String(Array.isArray(op.traits) ? op.traits[0] || '' : '').slice(0, 120);
  return {
    schema: pack.schema, version: pack.version, language: pack.language, modeId: pack.modeId,
    rulesSummary: pack.rulesSummary, economy: pack.economy,
    bonds: (pack.bonds || []).map(b => ({ id: b.id, name: b.name, kind: b.core ? 'core' : 'class', thresholds: b.thresholds, countMode: b.countMode,
      countsGoldenOnly: b.countsGoldenOnly, effect: b.effect })),
    operators: (pack.operators || []).map(o => ({ id: o.id, name: o.name, tier: o.tier, cost: o.cost, class: o.class,
      bonds: o.bonds || [], caps: capsOf(o, byId), trait: trait(o), skill: o.skill?.name || '' })),
    items: (pack.items || []).map(i => ({ id: i.id, name: i.name, cost: i.cost, effect: i.effect })),
    bands: (pack.bands || []).map(b => ({ id: b.id, name: b.name, lp: b.lp, effect: b.effect, carriesFunds: b.carriesFunds,
      insights: insights.get(b.id) || [] })),
    bosses: (pack.bosses || []).map(b => ({ id: b.id, name: b.name, enemyKey: b.enemyKey, hpByDifficulty: b.hpByDifficulty,
      // Pack notes stay ability objects (sp-knowledge/1). The prompt view keeps their readable text only.
      notes: Array.isArray(b.notes) ? b.notes.map(n => typeof n === 'string' ? n : (n && (n.text || n.desc)) || '').filter(Boolean).join(' ').slice(0, 240) : '' })),
    enemies: (pack.enemies || []).map(e => ({ id: e.id, name: e.name, hp: e.stats?.maxHp || 0, def: e.stats?.def || 0,
      res: e.stats?.res || 0, motion: e.stats?.motion || '', fly: fly.get(e.id) || e.stats?.motion === 'FLY' })),
    playbook: {
      schema: pb.schema, policy: pb.policy, inactiveBonds: pb.inactiveBonds, maxShopLevel: pb.maxShopLevel,
      community: pb.community, cycles: pb.cycles, graph: pb.graph,
      pairings: (pb.bonds || []).map(b => ({ id: b.id, pairings: b.pairings || [] })),
      schedule: pb.schedule, recommendedSchedule: pb.recommendedSchedule, legacyReference: pb.legacyReference,
      bandInsights: (pb.bands || []).map(b => ({ id: b.id, insights: b.insights || [] })),
      warnings: pb.warnings, lateRule: pb.lateRule, leaderHitLimit: pb.leaderHitLimit,
    },
  };
}
