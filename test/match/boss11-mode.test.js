// test/match/boss11-mode.test.js — boss_11（不死黑蛇）必须能通过 base/N 模式的 boss 轮被选中。
// 0.4.3 内容 + sim-upgrade 的 mode 绑定：bossWeights.boss_11 + rounds[bossRound].bossTemplates.boss_11。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildBossWave } from '../../plugins/mota/server/match/waves.js';

const CFG = JSON.parse(fs.readFileSync(new URL('../../plugins/mota/data/config.json', import.meta.url), 'utf8'));
const W = JSON.parse(fs.readFileSync(new URL('../../data/waves.json', import.meta.url), 'utf8'));
const B = JSON.parse(fs.readFileSync(new URL('../../data/bosses.json', import.meta.url), 'utf8'));

test('boss_11 is bound to base/N modes; the runtime wave is act3autochess_h08_04 (solo keeps _s), both with the boss spawn', () => {
  for (const mid of ['mode_single_normal', 'mode_multi_normal', 'mode_single_n8', 'mode_multi_n8']) {
    const m = CFG.modes[mid];
    assert.ok(m, mid);
    const round = m.rounds[String(m.bossRound)];
    assert.equal(round.bossTemplates.boss_11, 'act3autochess_h08_04_s', `${mid} bossTemplates`);
    assert.ok(m.bossWeights.boss_11 > 0, `${mid} bossWeights`);
  }
  const m = CFG.modes.mode_multi_normal;
  const gd = {
    modeId: 'mode_multi_normal',
    roundCfg: (r) => m.rounds[String(r)],
    wave: (id) => W[id] ?? null,
    enemy: () => null,
    factions: {},
    lastRound: m.lastRound, bossRound: m.bossRound, hiddenRound: m.hiddenRound,
    enemyScale: () => ({ atkMul: 1, hpMul: 1, speedMul: 1 }),
    combatTimeLimit: () => 120,
  };
  // The data binds the template id `act3autochess_h08_04_s` (line 17 above), but waves.js:426 normalises it at
  // runtime: a non-solo boss round strips the `_s` suffix when the plain wave exists (waves.js:425 adds it for solo).
  // So the asserted runtime id is `act3autochess_h08_04` for solo:false and `act3autochess_h08_04_s` for solo:true.
  for (const [solo, wantId] of [[false, 'act3autochess_h08_04'], [true, 'act3autochess_h08_04_s']]) {
    const out = buildBossWave(gd, () => 0.5, [], m.bossRound, { bossId: 'boss_11', solo }, 'act1autochess_m01');
    assert.equal(out.templateId, wantId, `solo:${solo}`);
    const wave = W[wantId];
    assert.ok(wave, `${wantId} wave`);
    assert.ok(wave.spawns.some((s) => s.key === 'enemy_1515_bsnake' && s.tag === 'boss'), `${wantId}: boss spawn in wave`);
  }
  assert.ok(B.boss_11, 'boss_11 record');
  assert.equal(B.boss_11.enemyKey, 'enemy_1515_bsnake');
});
