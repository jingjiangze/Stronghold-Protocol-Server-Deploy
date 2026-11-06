// test/content/enemies_bosses.test.js — 0.4.3 内容覆盖 + boss_11 冒烟（sim-upgrade）。
// 0.3.3 的逐技能行为断言已归档为 enemies_bosses.033.bak：它们断言的是旧 hit-shield/spring 语义，
// 0.4.3 sim/content 已重构为 setHits/hitCount/absorbArts，旧断言不适用于新引擎。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { makeBattle, checkInvariants } from '../helpers/battleHarness.js';
import * as enemiesMod from '../../server/sim/content/enemies.js';
import * as bossesMod from '../../server/sim/content/bosses.js';
import { claimedSlots, displayPlan } from '../../server/sim/content/enemies/unclaimed.js';

const E = JSON.parse(fs.readFileSync(new URL('../../data/enemies.json', import.meta.url), 'utf8'));
const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
const { KITS, STATS_ONLY } = enemiesMod;
const { BOSS_KITS } = bossesMod;

test('0.4.3 coverage: every enemy key is authored or stats-only', () => {
  const bad = [];
  for (const k of Object.keys(E)) {
    const n = (KITS[k] ? 1 : 0) + (BOSS_KITS[k] ? 1 : 0) + (STATS_ONLY[k] ? 1 : 0);
    if (n < 1) bad.push(`${k} ${E[k]?.name ?? ''}`);
  }
  assert.deepEqual(bad, [], `unauthored enemies: ${bad.slice(0, 20).join(', ')}`);
  for (const k of Object.keys(KITS)) assert.ok(E[k], `KITS unknown key ${k}`);
  for (const k of Object.keys(BOSS_KITS)) assert.ok(E[k], `BOSS_KITS unknown key ${k}`);
  for (const k of Object.keys(STATS_ONLY)) assert.ok(E[k], `STATS_ONLY unknown key ${k}`);
});

test('0.4.3 stats-only enemies attach no ability', () => {
  const h = makeBattle({ content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false });
  h.step();
  for (const k of Object.keys(STATS_ONLY)) {
    const e = h.spawn(k, { pos: [10, 7] });
    assert.ok(e, `spawn ${k}`);
    assert.ok(!e.mem.ab || !e.mem.ab.list.length, `${k} attaches an ability`);
  }
});

test('0.4.3+ display: every data prefabKey is announced — claimed by a kit ability, or by the unclaimed fallback', () => {
  // A skill with no kit behind it used to be invisible (no ['cast', id, slot], so no clip / telegraph / official
  // effects: server/sim/content/enemies/unclaimed.js). This gate pins the invariant that made it silent: every
  // prefabKey of a non-STATS_ONLY enemy is either named by one of the kit's abilities (`a.sk`) or is in the display
  // fallback's plan; the fallback itself stays within its per-enemy cap.
  const h = makeBattle({ content: 'generic', extraContent: [enemiesMod, bossesMod], seed: 7, autoFinish: false });
  h.step();
  const bad = [];
  for (const k of Object.keys(E)) {
    const skills = E[k].skills;
    if (!Array.isArray(skills) || !skills.length) continue;
    if (STATS_ONLY[k]) continue;                 // documented: this key attaches no ability (the stats-only test above)
    const e = h.spawn(k, { pos: [10, 7] });
    const ab = e && e.mem && e.mem.ab;
    if (!ab) { bad.push(`${k}: no ability record at spawn`); continue; }
    const kit = claimedSlots(ab);
    const plan = new Set(displayPlan(ab, Infinity).map((p) => p.key));
    const shown = ab.list.filter((a) => a && a.display).length;
    if (shown > 8) bad.push(`${k}: ${shown} display abilities (cap 8)`);
    if (shown !== displayPlan(ab).length) bad.push(`${k}: ${shown} display abilities, plan ${displayPlan(ab).length}`);
    for (const s of skills) if (s && s.prefabKey != null && !kit.has(s.prefabKey) && !plan.has(s.prefabKey)) bad.push(`${k}: ${s.prefabKey}`);
  }
  assert.deepEqual(bad, [], `prefabKeys neither claimed by a kit nor announced: ${bad.slice(0, 20).join(', ')}`);
});

test('boss_11: enemy_1515_bsnake spawns from act3autochess_h08_04 with its kit', () => {
  assert.ok(BOSS_KITS.enemy_1515_bsnake, 'blacksnake kit registered');
  const h = makeBattle({
    stageId: 'act1autochess_m01', waveTemplate: W.act3autochess_h08_04,
    content: 'full', autoFinish: false, timeLimit: 60, seed: 7,
  });
  const got = h.runUntil(() => h.enemies().some((e) => e.defId === 'enemy_1515_bsnake'), 60);
  assert.ok(got, 'boss spawned');
  const boss = h.enemies().find((e) => e.defId === 'enemy_1515_bsnake');
  assert.equal(boss.s.maxHp, 50000, 'black snake base HP');
  assert.ok(boss.mem && boss.mem.ab, 'boss ability state attached');
  h.run(5);
  assert.equal(h.result().errors, 0);
  assert.doesNotThrow(() => checkInvariants(h.b));
});
