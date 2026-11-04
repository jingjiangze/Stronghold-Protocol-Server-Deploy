// server/sim/content/kits/ops/chess_char_6_01-lemuen.js — 蕾缪安 (char_4193_lemuen) kit, tier 6.
// Conventions of the tier-6 kits: ../shared/tier6.js; kit contract and rules: ../README.md.

import { sortEnemyTargets, canTargetEnemy } from '../../../targeting.js';
import { rotateOffset } from '../../../dir.js';
import { bodyDist, bodyKeys, bodyInRange } from '../../../body.js';
import { num, tbb, live, isElite, hasBond, ANY, bstate } from '../shared/tier6.js';

// ------------------------------------------------------------------------------------------------------------------
// 蕾缪安 chess_char_6_01 (神射手) — S3 礼炮·强制追思; 跨境追缉许可; 逃犯引渡手续

/** S3 bombardment: one shell every 0.3 s after the skill ends, for at most 10 s (PRTS S3 note, not in the data). */
const LEMUEN_SHELL_INTERVAL = 0.3;
const LEMUEN_SHELL_WINDOW = 10;
/**
 * Shell flight time [ASSUMED]: the first bombardment lands one interval after the skill ends, so every shell of the
 * PRTS count (≤ 33 in the 10 s window) lands inside it; the renderer draws the shell over this time (fx bombardShell).
 */
const LEMUEN_SHELL_FLIGHT = 0.3;

/**
 * S3 锁定阶段的**超时上限**(owner:「如果15秒内还没有消耗完弹药 已定位的锁定会直接轰炸其余弹药消失并重新回复技能」)。
 *
 * 原来锁定阶段**没有时间上限** —— 弹药打不完技能就一直开着(注释见 `skill.onTick` 下方那段:
 * "an ammo skill has no time limit"),场上没目标时她能挂着一辈子。超时规则把这种情况收口:
 * 15 秒到点 → 已锁定的标记**直接落地轰炸** → 剩余弹药作废 → `skill.end()` 让 SP 开始回复。
 */
const LEMUEN_LOCK_TIMEOUT = 15;

function ensureWanted(battle) {
  const S = bstate(battle);
  if (S.wanted) return S.wanted;
  const W = S.wanted = { lemuens: new Set(), sources: new Map(), refreshRanges: new Set() };
  const activeLem = () => [...W.lemuens].filter(live);
  const reconcile = () => {
    for (const e of battle.enemies) {
      const marked = [...W.sources.values()].some((s) => s.marks.has(e));
      if (marked && e.alive && !e.findBuff('lemuen:wanted')) {
        battle.addBuff(e, { key: 'lemuen:wanted', visible: true });
        battle.fx('wanted', { x: e.x, y: e.y, id: e.id });
      } else if (!marked && e.findBuff('lemuen:wanted')) battle.removeBuff(e, 'lemuen:wanted');
    }
    for (const refresh of W.refreshRanges) refresh();
  };
  // PRTS: the source leaving clears its timers and marks; another on-field Lemuen keeps her own progress.
  battle.on('death', ({ unit }) => {
    if (!W.lemuens.has(unit)) return;
    W.sources.delete(unit);
    reconcile();
  });
  battle.every(0.25, () => {
    const lems = activeLem();
    for (const u of W.sources.keys()) if (!lems.includes(u)) W.sources.delete(u);
    const lat = battle.allyUnits.filter((a) => live(a) && a.kind === 'op' && hasBond(a, 'lateranoShip'));
    for (const u of lems) {
      let state = W.sources.get(u);
      if (!state) W.sources.set(u, state = { time: new WeakMap(), marks: new Set() });
      for (const e of state.marks) if (!e.alive) state.marks.delete(e);
      for (const e of battle.enemies) {
        if (!e.alive || state.marks.has(e) || !isElite(e)) continue;
        // PRTS: starting the timer needs selectability; once attached, only its continuous stay is tested.
        if (e.hidden || !lat.some((a) => a.rangeKeySet && bodyInRange(e, a.rangeKeySet))) { state.time.delete(e); continue; }
        if (!state.time.has(e) && !canTargetEnemy(u, e, ANY)) continue;
        const t = (state.time.get(e) ?? 0) + 0.25;
        state.time.set(e, t);
        if (t >= u.mem.wantedInterval - 1e-9) state.marks.add(e);
      }
    }
    reconcile();
  });
  battle.on('hit', (ctx) => {
    const s = ctx.source, t = ctx.target;
    if (!s || !t || s.side !== 'ally' || t.side !== 'enemy' || !hasBond(s, 'lateranoShip')) return;
    if (!ctx.dmg.isAttack && !ctx.dmg.isSkill) return;
    if (!t.findBuff('lemuen:wanted')) return;
    const lems = activeLem();
    if (lems.length) ctx.dmg.mul *= Math.max(...lems.map((u) => u.mem.wantedScale));
  });
  return W;
}

function lemuen(bb, chess, def) {
  const t0 = tbb(def, 0), t1 = tbb(def, 1), tb = def?.traitBb || {};
  const aim = Math.max(0.05, num(bb['attack@aim_interval'], 0.5));
  const d1 = num(bb['attack@dist_1'], 0.8);
  const d2 = num(bb['attack@dist_2'], num(bb['attack@projectile_range'], 1.5));
  const s1 = num(bb['attack@proj_atk_scale_1'], 1), s2 = num(bb['attack@proj_atk_scale_2'], 1);
  const pickLock = (battle, unit, locks) => {
    let cands = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
    // 白铁's 铁钳号·原型机 (a registered ally target, an enemy-camp summon) is locked like an enemy when no enemy is in her
    // range — the owner's rule of 2026-10-08 (it draws aggro like an enemy): her bullets are spent on it, the shells' hits
    // are cancelled by it [ASSUMED: after every enemy, its 嘲讽等级 −2]
    if (!cands.length) cands = battle.allyTargetsInKeys(unit.rangeKeys, unit);
    if (!cands.length) return null;
    sortEnemyTargets(battle, unit, cands, 'lowDef');
    const cnt = (e) => locks.reduce((n, L) => n + (L.e === e ? 1 : 0), 0);
    let best = null;
    for (const e of cands) if (!best || cnt(e) < cnt(best)) best = e;
    return best;
  };
  // S3 bombardment (PRTS 蕾缪安 S3 note — the timing is not in the blackboard): after the skill ends ONE shell every
  // LEMUEN_SHELL_INTERVAL s, in lock order, on a random point of the square of side 2 × emit_offset (PRTS "边长0.4",
  // emit_offset 0.2) around its lock mark — the locked enemy while it is on the field ("持续追踪锁定目标"), else the spot
  // it left ("锁定标记会留在原地") — landing LEMUEN_SHELL_FLIGHT s later; each shell hits every enemy within dist_2 once
  // (limited_hit_time 1): proj_atk_scale_1 × ATK within dist_1 of its point, proj_atk_scale_2 × ATK beyond, all with the
  // ATK cached when the skill ended ("缓存攻击力"); at most LEMUEN_SHELL_WINDOW s of shells ("最多产生33次轰炸").
  const spread = Math.max(0, num(bb['attack@emit_offset'], 0.2));
  const markOf = (L) => {
    const e = L.e;
    if (!L.gone && (!e.alive || !e.hidden)) { L.x = e.x; L.y = e.y; if (!e.alive) L.gone = true; }
    return L;
  };
  const blast = (battle, unit, atk, x, y) => {
    battle.fx('bombard', { x, y, id: unit.id, r: d2 });
    for (const e of battle.foesInColliderRadius(x, y, d2)) {
      if (e.s.flags.untargetable) continue;
      const d = bodyDist(e, x, y);
      /*
       * ⚠ `noHitLimit: true` —— **对首领有效** (owner:「蕾缪安技能修改对boss有效」)。
       *
       * 首领战有条官方「限伤」规则:对领袖的**单次伤害 ≥ 300000 整次作废**(0 伤害、不计入血池)。
       * 而她这一发是「缓存攻击力」的**单发高倍率**,在低难度首领上必然越线 ——
       * 于是技能对首领**完全无效**(不是伤害太高,是整发被吃掉)。实测首领血量:
       * FUNNY 20~30 万、NORMAL 39~70 万 —— 连 FUNNY 的血量都不到那条线,可见阈值和她的单发量级不匹配。
       *
       * 豁免只开给这一发轰炸(`server/sim/damage.js` 的 `dmg.noHitLimit`),不动那条规则本身。
       */
      battle.dealDamage(unit, e, { amount: atk * (d <= d1 + 1e-9 ? s1 : s2), type: 'phys', isSkill: true, isSplash: true, noHitLimit: true, tags: ['skill', 'bombard'] });
    }
    // (the 铁钳号 too, like an enemy — its kit cancels the hit)
    for (const a of battle.allyTargetsInRadius(x, y, d2, unit)) {
      battle.dealDamage(unit, a, { amount: atk * s2, type: 'phys', isSkill: true, isSplash: true, tags: ['skill', 'bombard'] });
    }
  };
  /**
   * 锁定**超时**时的收尾:已锁定的标记**原地各炸一发**(不飞、延迟为 0),剩余弹药随之作废。
   *
   * 与 `bombard` 的区别:`bombard` 是"打完了"之后按 0.3 s 间隔、最多 33 发的礼炮;
   * 这里超时意味着**多半是场上没目标了**(所以弹药没打完),再按 0.3 s 慢慢放等于让技能白挂 10 秒 ——
   * 所以改成**立即全部引爆**,然后马上结束技能、开始回复 SP。
   */
  const boomLocks = (battle, unit, locks) => {
    if (!locks.length) return;
    const atk = unit.s.atk;
    for (const L of locks) {
      const m = markOf(L);
      const [oy, ox] = rotateOffset(battle.rng.range(-spread, spread), battle.rng.range(-spread, spread), unit.dir);
      blast(battle, unit, atk, m.x + ox, m.y + oy);
    }
  };
  const bombard = (battle, unit, locks) => {
    const atk = unit.s.atk;
    const seq = unit.deploySeq;
    const n = Math.min(locks.length, Math.floor(LEMUEN_SHELL_WINDOW / LEMUEN_SHELL_INTERVAL + 1e-9));
    const fire = (i) => {
      // knocked out / withdrawn after the skill ended: the shells not fired yet are dropped (those in the air land)
      if (!(unit.alive && unit.deployed && unit.deploySeq === seq)) return;
      const L = markOf(locks[i]);
      // the random offset is drawn in her facing frame (the square turns onto itself): a turned board plays alike
      const [oy, ox] = rotateOffset(battle.rng.range(-spread, spread), battle.rng.range(-spread, spread), unit.dir);
      const x = L.x + ox, y = L.y + oy;
      battle.fx('bombardShell', { x, y, id: unit.id, r: d2, t: LEMUEN_SHELL_FLIGHT, i });
      battle.after(LEMUEN_SHELL_FLIGHT, () => blast(battle, unit, atk, x, y), { owner: unit });
      if (i + 1 < n) battle.after(LEMUEN_SHELL_INTERVAL, () => fire(i + 1), { owner: unit });
    };
    if (n > 0) fire(0);
  };
  // S2 归乡邀约: aimed snipe at a wanted enemy — ATK scale ramps main → fin by ex every interval (at most trig_cnt
  // steps, aim_duration s), fired early once ATK × scale > the target's HP + DEF; ignores dodge; one bullet per aim
  const aimS = {
    main: num(bb['attack@main_atk_scale'], 1), ex: num(bb['attack@ex_atk_scale']), fin: num(bb['attack@fin_atk_scale'], 1),
    iv: Math.max(0.05, num(bb['attack@interval'], 0.25)), steps: Math.floor(num(bb['attack@trig_cnt'], 10)), dur: num(bb['attack@aim_duration'], 2.5),
  };
  const endAim = (battle, unit) => { unit.mem.lemAim = null; battle.removeBuff(unit, 'lemuen:aim'); };
  const skills = {
    // S1 重逢问候: ammo 5, attacks at attack@atk_scale × ATK on one extra target
    skchr_lemuen_1: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 5))),
      attack: { atkScale: num(bb['attack@atk_scale'], 1) },
      targeting: { maxTargets: 2 },
    },
    skchr_lemuen_2: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 6))),
      mods: { aspd: num(bb.attack_speed), atkPct: num(bb.atk) },
      onStart({ battle, unit }) { endAim(battle, unit); },
      onTick({ battle, unit, skill, dt }) {
        const m = unit.mem;
        let A = m.lemAim;
        if (A && (!A.e.alive || A.e.hidden || !A.e.findBuff('lemuen:wanted'))) { endAim(battle, unit); A = null; }
        if (!unit.canAct) return;
        if (!A) {
          const cands = battle.enemies.filter((e) => e.alive && !e.hidden && e.findBuff('lemuen:wanted') && canTargetEnemy(unit, e, ANY));
          if (!cands.length || skill.ammoLeft <= 0) return;
          sortEnemyTargets(battle, unit, cands, 'lowDef');
          A = m.lemAim = { e: cands[0], t: 0 };
          battle.addBuff(unit, { key: 'lemuen:aim', flags: { disarm: true } }); // aiming: no normal attack meanwhile
          skill.ammoLeft--;                                                      // "消耗子弹对其瞄准"
          battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
          battle.fx('lock', { x: A.e.x, y: A.e.y, id: A.e.id, src: unit.id });
        }
        A.t += dt;
        const scale = Math.min(aimS.fin, aimS.main + aimS.ex * Math.min(aimS.steps, Math.floor((A.t + 1e-9) / aimS.iv)));
        const e = A.e;
        if (A.t + 1e-9 < aimS.dur && !(unit.s.atk * scale > e.hp + e.s.def)) return;
        endAim(battle, unit);
        battle.fx('crit', { x: e.x, y: e.y, id: e.id, src: unit.id });
        battle.dealDamage(unit, e, { amount: unit.s.atk * scale, type: 'phys', canDodge: false, isSkill: true, tags: ['skill', 'snipe'] });
        if (skill.active && skill.ammoLeft <= 0) skill.end('ammo');
      },
      onEnd({ battle, unit }) { endAim(battle, unit); },
    },
  };
  return {
    skills,
    // S3 礼炮·强制追思, the lock phase: one lock every aim_interval s on an enemy in her range (the least locked first,
    // then the lowest DEF), one bullet each; the skill ends when the bullets are spent, then bombard. With nothing in
    // range it waits — bullets and locks kept (the marks follow their enemies / stay where they left) — and locks the
    // next enemy that comes at once: an ammo skill has no time limit ("攻击装有5发弹药，打完后结束（可随时停止技能）"; in
    // the client data her S3 lock needs a target and only the spent bullets end the skill buff lemuen_s_3) and the 卫戍协议
    // automation never stops a skill (PRTS 卫戍协议/帮助 技能操作: "通常不会自动关闭技能"). Until 0.2.0 the skill ended at
    // the first lock tick with nothing in range (community report: 「蕾缪安3技能范围里没人好像会自动结束」). Its fx 'lock'
    // carries `hold`: the renderer keeps those reticles up while her skill runs (render/fx/locks.js).
    skill: {
      kind: 'ammo',
      ammo: Math.max(1, Math.floor(num(bb['attack@trigger_time'], 5))),
      attack: { noAttack: true },
      allyTargets: true,   // its locks take 白铁's 铁钳号 too (pickLock) — skills.js allyTargetsOk
      onStart({ unit }) { unit.mem.lemLocks = []; unit.mem.lemAcc = aim; unit.mem.lemBoom = false; unit.mem.lemLockT = 0; },
      onTick({ battle, unit, skill, dt }) {
        const m = unit.mem;
        if (!m.lemLocks) return;
        /*
         * 锁定**超时** (owner:「如果15秒内还没有消耗完弹药 已定位的锁定会直接轰炸其余弹药消失并重新回复技能」)。
         *
         * ⚠ 放在 `canAct` 检查**之前**:超时是"这一发技能开了太久"的收口,不该因为她被晕/冰冻(暂时不能行动)
         * 就一直拖着 —— 那会把 15 秒变成"能行动的时间累计",与"15 秒"的字面意思不符。
         */
        m.lemLockT = (m.lemLockT || 0) + dt;
        if (m.lemLockT + 1e-9 >= LEMUEN_LOCK_TIMEOUT) {
          m.lemBoom = true;                 // 让 onEnd 走"立刻全部引爆"那条路
          if (skill.active) skill.end('timeout');
          return;
        }
        for (const L of m.lemLocks) markOf(L);
        if (!unit.canAct) return;
        m.lemAcc += dt;
        if (m.lemAcc + 1e-9 < aim) return;
        const e = pickLock(battle, unit, m.lemLocks);
        if (!e) { m.lemAcc = aim; return; }   // nothing to lock: wait, the next lock ready the moment an enemy comes
        m.lemAcc -= aim;
        m.lemLocks.push({ e, x: e.x, y: e.y });
        battle.fx('lock', { x: e.x, y: e.y, id: e.id, src: unit.id, hold: 1 });
        skill.ammoLeft--;
        battle.emit('ammoUsed', { unit, left: skill.ammoLeft, skill });
        if (skill.active && skill.ammoLeft <= 0) skill.end('ammo');
      },
      onEnd({ battle, unit, reason }) {
        const locks = unit.mem.lemLocks || [];
        const timedOut = !!unit.mem.lemBoom;
        unit.mem.lemLocks = null;
        unit.mem.lemBoom = false;
        unit.mem.lemLockT = 0;
        if (reason === 'death' || !unit.alive) return;
        /*
         * 超时:已锁定的标记**立刻各炸一发**,剩余弹药随 `skill.end()` 一起作废(它在 onEnd 之前就把 ammoLeft 清零了),
         * 之后 SP 正常回复。**不走 `bombard`** —— 那是"打完了"的礼炮,按 0.3 s 间隔放 33 发;
         * 超时说明场上多半已经没目标,再慢慢放等于让技能白挂 10 秒。
         */
        if (timedOut) boomLocks(battle, unit, locks);
        else bombard(battle, unit, locks);
      },
    },
    // elite module: "攻击的敌人未被击倒时自身额外获得1点技力"
    trait: num(tb.sp) > 0 ? {
      afterHit(battle, unit, target) { if (target && target.alive && unit.skill && !unit.skill.active) unit.skill.gainSp(num(tb.sp), 'trait'); },
    } : null,
    talents: [
      { install(battle, unit) { // 跨境追缉许可
        unit.mem.wantedInterval = num(t0.interval, 8);
        unit.mem.wantedScale = num(t0.damage_scale, 1);
        const wanted = ensureWanted(battle);
        wanted.lemuens.add(unit);
        const wantedKeys = () => {
          const keys = [];
          for (const e of battle.enemies) if (e.alive && !e.hidden && e.findBuff('lemuen:wanted')) keys.push(...bodyKeys(e));
          return keys;
        };
        // #428: extra attack range also opens her skill under the existing content-trigger contract.
        unit.skill?.addTriggerRange(() => [{ keys: wantedKeys(), profile: unit.profile }], { attackOnly: true });
        let sig = null;
        const refresh = () => { // update immediately when the last source leaves, before another attack can run
          const keys = live(unit) ? wantedKeys() : [];
          const s = keys.join(',');
          if (s === sig) return;
          sig = s;
          battle.setExtraRange(unit, keys);
        };
        wanted.refreshRanges.add(refresh);
        battle.on('tick', refresh, { owner: unit });
        battle.on('deploy', ({ unit: u }) => { if (u === unit) { sig = null; refresh(); } }, { owner: unit });
      } },
      { install(battle, unit) { // 逃犯引渡手续
        const iv = num(t1.interval, 20), atk = num(t1.atk), add = Math.floor(num(t1.add_count)), exAdd = Math.floor(num(t1.ex_add_count));
        const ready = () => live(unit) && battle.time - unit.deployedAt >= iv - 1e-6;
        battle.on('deploy', ({ unit: u }) => {
          if (u !== unit) return;
          const seq = unit.deploySeq;
          battle.after(iv, () => {
            if (!live(unit) || unit.deploySeq !== seq) return;
            if (atk) battle.addBuff(unit, { key: 'lemuen:extradition', mods: { atkPct: atk } });
            battle.fx('talent', { x: unit.x, y: unit.y, id: unit.id, name: 'extradition' });
          }, { owner: unit });
        }, { owner: unit });
        battle.on('skillStart', ({ unit: u, skill }) => {
          if (!ready() || !skill || skill.kind !== 'ammo') return;
          if (u === unit) { if (add > 0) skill.addAmmo(add); }
          else if (exAdd > 0 && u.side === 'ally' && u.kind === 'op' && hasBond(u, 'lateranoShip')) skill.addAmmo(exAdd);
        }, { owner: unit });
      } },
    ],
  };
}

export default {
  chess_char_6_01_a: lemuen,
};
