import {BLACKFLOW_ELITE_KITS} from './enemies/blackflow-elites-20261102.js';
import {ARK_UPDATE_URSUS_KITS} from './enemies/ark-update-ursus-20261101.js';
import {URSUS_WAR_CASTER_KITS} from './enemies/ursus-war-caster.js';
import {installEnemyPressure} from './enemies/pressure.js';
import {installUnclaimed} from './enemies/unclaimed.js';
import {BOLIVAR_KITS} from './enemies/bolivar.js';
import {PRISONER_KITS} from './enemies/prisoners.js';
import {ORCHESTRA_KITS} from './enemies/orchestra.js';
import {RETURNING_BOSS_KITS} from './enemies/returning-boss.js';
import {trainingKits,imperialSupport} from './enemies/training-roster.js';
import {installAmbush} from './enemies/ambush.js';
import {FACTION_LEADER_KITS} from './enemies/faction-leaders.js';
import {KAZIMIERZ_KITS} from './enemies/kazimierz.js';
import {ROGUE_LEADER_KITS} from './enemies/rogue-leaders.js';
import {COMPATIBILITY_BASIC_KITS} from './enemies/compatibility-basic.js';
import {COMPATIBILITY_AMMO_KITS} from './enemies/compatibility-ammo.js';
import {COMPATIBILITY_DEEP_KITS} from './enemies/compatibility-deep.js';
import {COMPATIBILITY_SARKAZ_KITS} from './enemies/compatibility-sarkaz.js';
import {COMPATIBILITY_MOBILITY_KITS} from './enemies/compatibility-mobility.js';
import {COMPATIBILITY_PAPER_KITS} from './enemies/compatibility-paper.js';
import {COMPATIBILITY_NAMED_KITS} from './enemies/compatibility-named.js';
import {COLUMBIA_KITS} from './enemies/columbia.js';
import {SIRACUSA_KITS} from './enemies/siracusa.js';
import {OTHER_LEADER_KITS} from './enemies/other-leaders.js';
import {ADDITIONAL_CORE_KITS} from './enemies/additional-leaders-core.js';
import {ADDITIONAL_COMBAT_KITS} from './enemies/additional-leaders-combat.js';
import {ADDITIONAL_OBJECTIVE_KITS} from './enemies/additional-leaders-objectives.js';
import {ADDITIONAL_SUPPORT_KITS,ADDITIONAL_SUPPORT_STATS} from './enemies/additional-leader-supports.js';
import {SUNKEN_KITS} from './enemies/sunken.js';
import {KALTSIT_TALULAH_KITS} from './enemies/kaltsit-talulah.js';
import {EXTRA_MINI_KITS,EXTRA_MINI_STATS} from './enemies/extra-mini-bosses.js';
import {ARK_UPDATE_ELITE_BOUNTY_KITS} from './enemies/ark-update-elite-bounties-20261101.js';
import {SANKTA_KITS} from './enemies/sankta.js';
import {CONTRACT_CREATURE_KITS,CONTRACT_CREATURE_STATS} from './enemies/contract-creatures.js';
import {CONTRACT_ENEMY_KITS,CONTRACT_ENEMY_STATS} from './enemies/contract-expansion.js';
// server/sim/content/enemies.js — enemy special types (特训敌人) and individual enemy abilities (DESIGN §7).
//
// Battle side: install(battle) registers ONE set of global dispatch hooks per battle (ensureInstalled — idempotent,
// bosses.js calls it too) and attaches an ability list to every spawned enemy whose key has a kit in KITS.
// Every number comes from the enemy's talent / skill blackboard (data/enemies.json, merged with the wave template's
// `overrides[key].talents/skills` — the engine only applies `overrides.stats`). Numbers that exist nowhere in the
// data are named constants (enemies/helpers.js when several kit families use them, else in the family's file), marked
// [ASSUMED] or sourced from the official term table (gamedata_const termDescriptionDict) / PRTS.
//
// Runtime model: `enemy.mem.ab = { key, t (talent bb), tS (talent bbStr), sk {prefabKey → {cd, icd, sp, bb, bs}},
//   list [abilities], times, hitShield, atkType, immune, … }`. An ability is a plain object with optional methods
//   spawn(b,e,a,ab) · dealt(c,…) ('damaged' by one of e's ATTACKS on an ally, non-element) · taken(c,…) ('damaged' on e,
//   non-element) · hitIn(c,…) ('hit' on e, late: after every other hit handler) · hitOut(c,…) ('hit' from e, early) ·
//   (`c.source` is null for 无来源 damage — element bursts; target-side reactions that must still fire, e.g. damage
//   sharing, read `c.source || c.credit`, `credit` naming the unit that filled the gauge) ·
//   before(c,…) (beforeAttack of e) · attack(c,…) · blocked(c,…) · killed(c,…) (return true = revived; the kill is then
//   hidden from later 'kill' handlers) · death(c,…) · status(c,…) (statusApplied on e) · burst(c,…) (elementBurst on e)
//   · tick(b,e,a,dt) every `iv` s (every tick when iv is 0) · skill: `cd`/`left`(=icd)/`cond`/`fire` (cooldown runs
//   continuously; fires when ready, the enemy can act and `cond` holds). `sil: true` = the ability's handbook line
//   is flagged SILENCE (沉默 disables it: exactly the data's `format: "SILENCE"` lines). 萨卡兹枯朽战士 / 组长's
//   【污染秽蚀】 death fog is the one NORMAL line also silenced (archetypes.js kitPolluted, `enemy_1267_nhpbr` and
//   `_2` only): the owner's official-play recall of 2026-10-12 is that a death while silenced creates no fog, and
//   that recall contradicts the PRTS / in-game text 「不可沉默」 (DESIGN §30.23). stun / freeze / sleep block
//   skills. Enemy SP skills ("数次攻击后…"): SP +1 per attack, the (spCost+1)-th attack is the skill attack (official
//   粉碎攻坚手 text: spCost 2 = "攻击2次后，下一次攻击").
// Shared mechanics: reborn() — "首次被击倒后重生 / 第二形态" (the first KO is hidden from kill credit and bounty; a
//   rebirth of Reborn.duration s, untargetable and inert, then the new form); artsBarrier() — "吸收法术伤害的屏障"
//   (absorbs arts after RES); frontGuard() — "来自正面的伤害降低" (facing = walking direction or the bigger crowd);
//   unbalanced() — 失衡 detection (displacement beyond the enemy's own speed; engine displace() has no hook);
//   husk() — "被击倒时暂时变为…，一段时间后重生" (Revive[Trigger]: every knock-out of the first form ⇒ 1 s 重生 ⇒ a walking
//   hit-count husk — 隐匿 逐火 embers, the unblockable 再生 puppet — until the real death or its revival); every 重生
//   (reborn / husk / statue) clears the enemy's statuses and the buffs allies gave it (rebirthCleanse, PRTS 特殊机制
//   §重生 "清空自身身上除白名单外所有Buff"); a data-unarmed
//   enemy armed by a form (转译基底) sets `e.profile` noAttack / melee / dmgType / maxTargets and attacks through the
//   engine (ai.js enemyAttack); float() — 近地悬浮 (an air unit that
//   keeps its ground path, Unit.isFlying; kitSyufo / kitParrot lose it when stunned). `e.profile.canTarget(ally)` = the
//   enemy's own target rule (只攻击地面单位 …), applied by the engine to the candidates before its priority order; a
//   special priority (优先攻击防御力最高的… / 生命上限最高的…) sorts by its key, ties by taunt then latest deployed
//   (targeting.js aggroCmp — PRTS 索敌: 特殊优先级 → 仇恨值). Area effects — splash, blasts, area skills and statuses,
//   pulses, the zones an enemy leaves, chain / bounce jumps, 周围四格 additions, whole-column / whole-field skills —
//   select with areaAllies / areaAlliesInTiles / fieldAllies (targeting.js areaSelectable; PRTS 作战机制 §AOE伤害判定
//   "AOE的判定是对攻击范围内的每个可以被选中的敌人进行判定"): no 隐匿 ally, the one blocking the enemy included (GitHub #97), no untargetable
//   or sleeping one, no airborne 起飞 one for a ground enemy; 迷彩 is not checked (splash-type, 中点判定 / 格子判定 and
//   aura effects ignore it — ba.camou "无法躲避溅射类攻击", PRTS 异常效果 迷彩; the sites with no such reading are
//   [ASSUMED] in DESIGN §22.12). Buff auras select with auraAllies (auraSelectable: 隐匿 kept out, 起飞 not). A locked
//   target (an attack's, a channel's, a C4's) is hit as a direct pick, only the others around it as an area
//   (targetAndArea). Until 0.1.2 they took every ally in the area (GitHub issue #32 item 6; DESIGN §22.12). An airborne ally
//   (起飞, flag `liftoff`) is no target of a ground enemy (对地规避, targeting.js evadesGround): targetsNear / allTargets
//   skip it through canTargetAlly, the area selectors through areaSelectable, and the engine refuses a ground enemy's
//   damage and statuses on it. Not selections, so they still reach it (`ignoreSelect`): abilities PRTS marks "无视无法
//   选择 / 无视(目标)可选性" (【污染秽蚀】, 【盲信之誓】, 萨卡兹悖谬暴虐兵长's 暴击 splash, 假想敌：淤困's burst spread),
//   direct picks of the attacker (碎铳之簧's counter — PRTS 异常效果 "'直接选中'的能力…不受这些仅在选择时生效的异常效果
//   制约"), the blasts of flying units credited to a ground leader (刺胄之弹, 斩胄之剑 / 破胄之锤) and the ticks of a debuff
//   already on it (出血, 沙狱, “庞贝”'s burning, 淤困, 【自然涌动】 — a tick selects nobody). Ground enemies' buff auras
//   (深池伙友卫队, 扎罗's 远古威慑) and the sourceless 毒雾 of 假想敌：蚀裂 still reach it [ASSUMED, §21.22] while keeping
//   a 隐匿 ally out; 寒霜's aura (PRTS: its debuff "无视隐匿状态起作用") and map / tile effects (“墓碑” — PRTS: a map effect —,
//   【国度】, the chimera's 源石污染区 [ASSUMED]) reach every ally.
//
// Special types (factions.json):
//   FLY        — engine (FLY motion, ranged-only targeting). Flyer kits in enemies/fly.js (御4, 护障, 寒霜, 萨科塔之翼/眼, 黑云 …).
//   TIMES 频次 — "需要N次伤害击倒": maxHp := N hits; engine buff flag hitCount — every damage instance (any type, element
//                bursts included) removes exactly 1 on its own DamageInfo (茶器 hitCountArts: phys removes 0); HP loss
//                (loseHp) bypasses the rule. The faction's enemies
//                create those units (death spawns, embers, blades, 再生).
//   ELEMENT    — element damage on hit = ATK × ep_damage_ratio into the ally's gauge. 侵蚀 (erosion) is an engine
//                gauge whose burst is the official one (termDescription ba.dt.erosion: "永久降低100点防御力并受到800点物理伤害").
//   DOT        — damage zones (污染秽蚀: true damage, one tick per second however many cover a unit, "可对空，无视无法选择"
//                — `ignoreSelect`, 起飞 / 隐匿 allies included; 燃烧区域: the enemy's area selection — PRTS 集团军重型火炮
//                "碰撞不受迷彩制约，不可对空", no 无视无法选择 —, so no 起飞 or 隐匿 ally; 假想敌：蚀裂's sourceless
//                毒雾 skips a 隐匿 ally, not a 起飞 one), bleeding (removed by healing), pulsing damage around an enemy
//                (area selection).
//   INVISIBLE  — permanent `stealth` flag (engine: untargetable unless blocked or revealed). An operator's radius area
//                damage skips an unblocked one too (Battle.foesInRadius: profession splash around a struck target,
//                skill circles — PRTS 作战机制 §AOE伤害判定 "对攻击范围内的每个可以被选中的敌人进行判定"; until 0.1.1 it
//                still hit it); tile selectors (enemiesInKeys) always skipped it. After a block it hides again only
//                STEALTH_RESTORE (3) s later — or after the "（解除阻挡N秒后恢复）" of its PRTS page (STEALTH_RESTORE_BY_KEY,
//                清明's veil 0 s) — Battle._stealthSwitch / targeting.js enemyStealthed (until 0.1.2: at once).
//                The mirror rule for an ally's 隐匿 — enemy area effects skip it even when it blocks the enemy (0.1.3, GitHub #97) — is areaAllies.
//   REFLECTION — 折射 (ba.refraction "生效时，法术抗性+70"): RES +refracting.magic_resistance while NOT silenced
//                (the ability line is SILENCE-flagged: silencing turns it off); 镜膜 also gets max HP +100 % until its first silence, which permanently stops its fan.
//   SPECIAL    — mostly stats; prisoners, 穿刺手, 暴虐兵长, 镜卫, 动力装甲 … in enemies/special.js.
// Every enemy key of data/enemies.json is either in KITS (this file), BOSS_KEYS (bosses.js) or STATS_ONLY (with the
// reason) — pinned by test/content/enemies_bosses.test.js. Bounty (悬赏) leaders are included: multi-form ones
// (巨大的丑东西, 杰斯顿, 自在, 锏, 扎罗) get their second form; event-only mechanics (芦苇, 摄影区, 狂欢时刻, 悬索桥, 唤血祭坛,
// 封冻/供暖器, 赘生甲壳, 锁链, 血债账款, 晦明) have no counterpart in this mode and are listed where they apply.
//
// fx kinds emitted (battle.fx(kind, {x, y, …})): 'explode' {r, kind} · 'zone' {r, dur, kind} · 'telegraph' {r, dur,
//   kind, tiles?, id?, form?} (delayed strikes, charges, 'reborn' with form 'reborn') · 'beam' {from, to, kind} ·
//   'summon' {id, key} · 'ember' {id, hits, dur, form: 'husk'} · 'revive' {id, kind?, form: 'form2' | 'revived' | 'fly'}
//   · 'stone' {id, dur, form: 'stone'} · 'blink' {id, fx, fy} · 'charge' {id, tx, ty} · 'expose' {id} · 'shieldBreak'
//   {id} · 'liberate' {id, form: 'liberty'} · 'phase' {id, kind, dur?, form?} (form changes — 掠海漂移体 'crawl', 暴鸰
//   'bombed', translator_*, a prisoner's 'warning' — and barrier / charge states) · 'lpLoss' {value, reason} · 'steal' · 'ignite'. Forms go through
//   setForm(): the unit keeps it (`e.form`, UnitInfo `form`) and the fx's `form` is the model's clip set from then on
//   (render/app.js → UnitView.setForm, units.js FORMS); the client keeps every fx with a `form` through catch-ups and
//   hidden tabs (shared/protocol.js fxForm).
// Custom hook: 'lpLoss' {amount, reason, source} — leader "扣除目标生命" effects; also summed into result.lpLoss.
//
// Code layout (0.2.0): this file installs the battle-wide dispatch hooks (ensureInstalled), runs the global
// dispatchers, builds KITS from the kit families and lists STATS_ONLY; the rest lives in server/sim/content/enemies/ —
//   helpers.js      constants several families use, per-battle state, ability bookkeeping (abOf / attach / dispatch, T,
//                   canCast …), selection and damage helpers (elem, hurt, areaAllies & friends, zone, spawnChildren,
//                   setForm, lpLoss, expose, absorbArts …)
//   archetypes.js   ability building blocks (stealth, splashAttack, deathBoom, refraction, float, reborn, husk, statue,
//                   artsBarrier, bleed, pollution, dmgZone, skill(), blinkForward …) and the archetype kits reused by
//                   several keys (kitEp, kitStealth, kitTimes, kitRefraction, kitPrisoner, kitDeathSpawn, kitStun3 …)
//   invisible.js, times.js, element.js, dot.js, reflection.js, fly.js, special.js — one file per special type
//                   (factions.json): its kits, its kit-only constants and its part of KITS
//   passengers.js   shared 载客 for the two carriers in special.js (伊利昂的木驮兽, “越长尘”)
//   leaders.js      bounty (悬赏) leaders: kitLeaderMisc (single form) and the multi-form kits
//   unclaimed.js    display-only fallback: for every data skill no kit casts, an ability that only emits the skill's
//                   `cast` and a telegraph ring (so an unimplemented line is still visible; no gameplay)
// Every name this file exported before the split is still exported from here.

import { TICK } from '../constants.js';
import { stOf, abOf, attach, safe, dispatch, canCast, elem, alliesInTiles, castSlot } from './enemies/helpers.js';
import { INVISIBLE_KITS } from './enemies/invisible.js';
import { TIMES_KITS } from './enemies/times.js';
import { ELEMENT_KITS } from './enemies/element.js';
import { DOT_KITS } from './enemies/dot.js';
import { REFLECTION_KITS } from './enemies/reflection.js';
import { FLY_KITS } from './enemies/fly.js';
import { SPECIAL_KITS } from './enemies/special.js';
import { LEADER_KITS } from './enemies/leaders.js';
import { hypot } from '../detmath.js';

export {
  EROSION, EROSION_BURST, HUSK_REBIRTH, nthOf, abOf, attach, T, silenced, canCast, unbalancedNow, elem, hurt, alliesInTiles,
  targetsNear, allTargets, areaAllies, areaAlliesInTiles, fieldAllies, auraAllies, targetAndArea, byPriority, zone,
  remainingRoute, stayRoute, spawnChildren, stepToward, setHits, hitCount, isHitCount, setForm, lpLoss, expose,
  expectedFinal, absorbArts, castSlot,
} from './enemies/helpers.js';
export { TRANSLATOR_CHANGE } from './enemies/leaders.js';
export { BOMBD_RELEASE, BOMBD_POST_DELAY } from './enemies/fly.js';
export { HOVER_KEYS, blinkForward } from './enemies/archetypes.js';

// ---------------------------------------------------------------------------------------------------------------
// per-battle state + installation

/** Register the global dispatch hooks once per battle (idempotent). */
export function ensureInstalled(b) {
  const st = stOf(b);
  if (st.installed) return st;
  st.installed = true;
  installEnemyPressure(b);
  b.on('enemySpawn', ({ enemy }) => onSpawn(b, enemy), { priority: 100 });
  b.on('enemySpawn', ({ enemy }) => onSpawnDisplay(b, enemy), { priority: -1000 });
  b.on('hit', (c) => onHitOut(b, c), { priority: 200 });
  b.on('hit', (c) => chaliceShare(b, c), { priority: -400 });
  b.on('hit', (c) => onHitIn(b, c), { priority: -500 });
  b.on('damaged', (c) => onDamaged(b, c), { priority: 50 });
  b.on('beforeAttack', (c) => onBeforeAttack(b, c), { priority: 50 });
  b.on('attack', (c) => { if (c.attacker && c.attacker.side === 'enemy') dispatch(b, c.attacker, 'attack', c); }, { priority: 50 });
  b.on('blocked', (c) => dispatch(b, c.enemy, 'blocked', c), { priority: 50 });
  b.on('kill', (c) => onKill(b, c), { priority: 1000 });
  b.on('death', (c) => onDeath(b, c), { priority: 50 });
  b.on('beforeStatus', (c) => {
    const ab = c.target && c.target.mem && c.target.mem.ab;
    if (!ab) return;
    if (ab.immune && ab.immune.has(c.status)) c.cancel = true;
  }, { priority: 50 });
  b.on('statusApplied', (c) => { if (c.target && c.target.side === 'enemy') dispatch(b, c.target, 'status', c); }, { priority: 50 });
  b.on('heal', (c) => {
    // 逐腐兽 bleeding ends when the target receives healing (natural regeneration excluded)
    if (c.amount > 0 && c.target && c.target.side === 'ally' && !(c.opts && c.opts.regen) && c.target.findBuff('ab:bleed')) b.removeBuff(c.target, 'ab:bleed');
  }, { priority: -50 });
  b.on('elementBurst', (c) => onBurst(b, c), { priority: 50 });
  b.on('tick', (c) => onTick(b, c.dt), { priority: 50 });
  b.on('battleEnd', ({ result }) => { if (st.lpLoss > 0 && result) result.lpLoss = (result.lpLoss ?? 0) + st.lpLoss; });
  return st;
}

export function install(battle) { ensureInstalled(battle); }

export function registerMeta() {}

// ---------------------------------------------------------------------------------------------------------------
// global dispatchers

function onSpawn(b, e) {
  const kit = KITS[e.def.raw?.effectRef ?? e.defId];
  if (typeof kit === 'function') {
    const ab = abOf(b, e);
    const list = safe(b, e, () => kit(ab, e, b)) || [];
    attach(b, e, list);
  }
  installAmbush(b,e);
}

// The skills no kit casts announce themselves anyway (unclaimed.js: the skill's `cast` event + a telegraph ring, no
// gameplay state). It runs after every kit installer — this file's onSpawn (priority 100), bosses.js (90), the
// extensions — so an ability a kit attaches later is not announced twice. STATS_ONLY keys keep the "no ability"
// promise of their entry; a missing module must not break a spawn.
function onSpawnDisplay(b, e) {
  const key = e.def.raw?.effectRef ?? e.defId;
  if (typeof installUnclaimed !== 'function' || STATS_ONLY[e.defId] || STATS_ONLY[key]) return;
  installUnclaimed(b, e, e.mem.ab || null);
}

function onHitOut(b, c) {
  const s = c.source;
  if (!s || s.side !== 'enemy' || !s.mem.ab || c.dmg.cancel) return;
  const ab = s.mem.ab;
  if (ab.atkType && c.dmg.isAttack && c.dmg.type !== 'element') c.dmg.type = ab.atkType;
  dispatch(b, s, 'hitOut', c);
}

function onHitIn(b, c) {
  const t = c.target;
  if (!t || t.side !== 'enemy' || !t.mem.ab || c.dmg.cancel) return;
  const ab = t.mem.ab;
  dispatch(b, t, 'hitIn', c);
  if (c.dmg.cancel) return;
  const ty = c.dmg.type;
  if (ab.hitShield > 0 && (ty === 'phys' || ty === 'arts')) {
    // "可以抵挡一次物理或法术伤害" / 再生's aura shield: the whole instance is negated
    c.dmg.cancel = true;
    ab.hitShield--;
    if (ab.hitShield <= 0) b.fx('shieldBreak', { x: t.x, y: t.y, id: t.id });
  }
}

function onDamaged(b, c) {
  const { source: s, target: t, dmg } = c;
  if (!dmg || dmg.type === 'element') return;
  if (t && t.side === 'enemy' && t.mem.ab) dispatch(b, t, 'taken', c);
  if (s && s.side === 'enemy' && s.mem.ab && dmg.isAttack && t && t.side === 'ally') dispatch(b, s, 'dealt', c);
}

function onBeforeAttack(b, c) {
  const a = c.attacker;
  if (a && a.side === 'enemy' && a.mem.ab) dispatch(b, a, 'before', c);
}

function onKill(b, c) {
  const v = c.victim;
  if (!v || v.side !== 'enemy' || !v.mem.ab) return;
  if (dispatch(b, v, 'killed', c) && v.hp > 0) c.stopPropagation = true; // revived: not a kill for anyone else
}

function onDeath(b, c) {
  const u = c.unit;
  const st = stOf(b);
  if (u && u.side === 'enemy' && u.mem.ab) dispatch(b, u, 'death', c);
  if (st.deathWatch.size) for (const w of [...st.deathWatch]) { if (!w.alive) { st.deathWatch.delete(w); continue; } dispatch(b, w, 'otherDeath', c); }
}

function onBurst(b, c) {
  const t = c.target;
  if (!t) return;
  if (t.side === 'enemy') { if (t.mem.ab) dispatch(b, t, 'burst', c); return; }
  // 假想敌：淤困 parasite: the host's burst spreads the same element to the 4 neighbouring allies — PRTS 天赋 "（中点判定，
  // 无视目标可选性，不受迷彩制约）": every ally there, 隐匿 / untargetable / airborne 起飞 ones included (`ignoreSelect`)
  const par = t.findBuff('ab:parasite');
  if (par && par.data && par.data.src) {
    const src = par.data.src;
    for (const o of alliesInTiles(b, t.tileR, t.tileC, 'plus', 1)) if (o !== t) elem(b, src, o, c.element, par.data.spread, { ignoreSelect: true });
  }
}

function onTick(b, dt) {
  const list = b.enemies;
  const n = list.length;
  for (let i = 0; i < n; i++) {
    const e = list[i];
    if (!e || !e.alive || e.mem.carrier || !e.mem.ab) continue;
    const ab = e.mem.ab;
    for (let j = 0; j < ab.list.length; j++) {
      const a = ab.list[j];
      if (!e.alive) break;
      if (a.tick) {
        if (!(a.sil && e.s.flags.silence)) {
          if (!(a.iv > 0)) safe(b, e, () => a.tick(b, e, a, dt));
          else {
            a._acc = (a._acc ?? 0) + dt;
            let k = 0;
            while (a._acc >= a.iv - 1e-9 && k++ < 4 && e.alive) { a._acc -= a.iv; safe(b, e, () => a.tick(b, e, a, a.iv)); } // loop-cap: at most 4 ability ticks
          }
        }
      }
      if (a.fire && a.cd != null) {
        a.left -= dt;
        if (a.left <= 1e-9 && canCast(e, a.sil, b) && (!a.cond || safe(b, e, () => a.cond(b, e, a)))) {
          a.left = Math.max(TICK, a.cd);
          a.casts = (a.casts ?? 0) + 1;
          e.skillAnimUntil = b.time + 0.5;
          if (a.sk) castSlot(b, e, a.sk,a.fxDuration);   // display only: the skill slot it uses (render/app.js 'cast')
          safe(b, e, () => a.fire(b, e, a));
        }
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// KITS: enemyKey → (ab, e, battle) => ability list. One line per key (name · what), in the family files
// (enemies/*.js); spread here in the original order — the same keys in the same order as before the split.

const BASE_KITS = {
  ...BLACKFLOW_ELITE_KITS,
  ...ARK_UPDATE_URSUS_KITS,
  ...URSUS_WAR_CASTER_KITS,
  ...COMPATIBILITY_BASIC_KITS,...ORCHESTRA_KITS,...PRISONER_KITS,
  ...COMPATIBILITY_AMMO_KITS,
  ...COMPATIBILITY_DEEP_KITS,
  ...COMPATIBILITY_SARKAZ_KITS,
  ...COMPATIBILITY_MOBILITY_KITS,
  ...COMPATIBILITY_PAPER_KITS,
  ...COMPATIBILITY_NAMED_KITS,
  ...COLUMBIA_KITS,
  ...ROGUE_LEADER_KITS,
  enemy_1115_embald:imperialSupport,
  ...KAZIMIERZ_KITS,
  ...FACTION_LEADER_KITS,
  ...ADDITIONAL_CORE_KITS,
  ...SUNKEN_KITS,
  ...KALTSIT_TALULAH_KITS,
  ...ADDITIONAL_COMBAT_KITS,
  ...ADDITIONAL_OBJECTIVE_KITS,
  ...ADDITIONAL_SUPPORT_KITS,
  ...OTHER_LEADER_KITS,
  ...EXTRA_MINI_KITS,
  ...ARK_UPDATE_ELITE_BOUNTY_KITS,
  ...CONTRACT_CREATURE_KITS,
  ...CONTRACT_ENEMY_KITS,
  ...RETURNING_BOSS_KITS,
  ...INVISIBLE_KITS,
  ...TIMES_KITS,
  ...ELEMENT_KITS,
  ...DOT_KITS,
  ...REFLECTION_KITS,
  ...FLY_KITS,
  ...SPECIAL_KITS,
  ...BOLIVAR_KITS,
  ...SANKTA_KITS,
  ...LEADER_KITS,
  ...SIRACUSA_KITS,
};

/** Keys deliberately left to their data stats (reason). */
export const STATS_ONLY = Object.freeze({
  trap_007_ballis: 'Native fixed-direction bounty device; owned objective helper configures its arrow.',
  trap_041_fcanon: 'Native cannon support device; standalone objective adapter.',
  trap_043_dupilr: 'Native broken pillar; parent owns shield interaction.',
  trap_054_dancdol: 'Native stage assistant; parent owns objective interaction.',
  trap_127_bldore: 'Native blood throne; parent owns transition.',
  trap_137_winfire: 'Native emergency heater; parent owns standalone heat count.',
  enemy_1380_dthmak: 'Native logical deathmark; parent owns control cleanup.',
  enemy_1294_duchns: 'Native logical dying flame; parent owns control cleanup.',
  bounty_scene_cledub_answer: 'Existing standalone destructible ground-mark adaptation; not a troop.',
  enemy_1137_plasm: 'ordinary spawned aberration; native movement and goal life cost',
  enemy_1334_ristar: 'attackable scene star; parent controls protection and explosion',
  enemy_2040_syrott: 'attackable corruption tear; parent controls charging and suppression',
  enemy_1367_dseed: 'altar pulse absent (骸骨拷打者 leaves them inert, uncounted, in place)',
  enemy_1001_bigbo_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1147_dshond: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1147_dshond_2: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1149_dsbow: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1149_dsbow_2: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1099_nbkght: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1102_sdkght: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1102_sdkght_2: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1189_krgaxe: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1189_krgaxe_2: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1012_dcross: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1012_dcross_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1298_ymmonk: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1298_ymmonk_2: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1043_zomsbr_2: 'official basic stats; stage-only identity, blood-debt and construction devices are absent',
  enemy_1011_wizard_2: 'plain ranged Arts',
  enemy_1015_litamr_2: 'plain armored infantry',
  enemy_1035_haxe: 'plain heavy infantry',
  enemy_1035_haxe_2: 'plain heavy infantry',
  enemy_1108_uterer: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1108_uterer_2: 'plain trained beast',
  enemy_1109_uabone: 'ordinary ranged infantry; airdrop is a stage spawn rule',
  enemy_1109_uabone_2: 'same',
  enemy_1110_uamord: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1110_uamord_2: 'same',
  enemy_1111_ucommd_2: 'block weight two is official data; civilian targets absent',
  enemy_1003_ncbow_2: 'plain ranged infantry',
  enemy_1086_ltsodr: 'plain infantry',
  enemy_1086_ltsodr_2: 'plain infantry',
  enemy_1087_ltwolf: 'plain hound',
  enemy_1087_ltwolf_2: 'plain hound',
  enemy_1088_ltsmer: 'gramophones are absent from this mode',
  enemy_1000_gopro_2: 'plain melee',
  enemy_1001_bigbo: 'plain leader (bounty)',
  enemy_1005_yokai: 'FLY, no attack (engine)',
  enemy_1005_yokai_2: 'FLY ranged (engine)',
  enemy_1005_yokai_3: 'FLY ranged (engine)',
  enemy_1006_shield: 'heavy defender',
  enemy_1006_shield_2: 'heavy defender',
  enemy_1006_shield_3: 'heavy defender',
  enemy_1007_slime: 'plain',
  enemy_1010_demon: 'plain',
  enemy_1010_demon_2: 'plain',
  enemy_1041_lazerd: 'FLY arts (engine)',
  enemy_1041_lazerd_2: 'FLY arts (engine)',
  enemy_1043_zomsbr: 'regen is data (hpRecoveryPerSec 80)',
  enemy_1061_zomshd: 'regen is data (hpRecoveryPerSec 200)',
  enemy_1046_agent: 'plain',
  enemy_1071_dftman: 'plain',
  enemy_1092_mdgint: 'plain (bounty)',
  enemy_1254_lypa_2: 'no listed ability',
  enemy_1325_cbgpro: 'plain',
  enemy_1325_cbgpro_2: 'plain',
  enemy_1381_winman: 'plain',
  enemy_1381_winman_2: 'plain',
  enemy_1387_winshd: '封冻/供暖器 zones absent',
  enemy_1415_mmkabi_2: 'chains absent',
  enemy_1433_dsbasi: 'plain',
  enemy_1433_dsbasi_2: 'plain',
  enemy_1438_dspred: '赘生甲壳 absent',
  enemy_2002_bearmi: 'plain',
  enemy_2002_bearmi_2: 'plain',
  enemy_9012_acloon: '炎佑 is a bond summon (bonds.js)',
  enemy_10043_sailor: 'bridges/cannons absent',
  enemy_10073_mpcar: 'plain',
  enemy_10124_uashld_2: 'taunt is data; 矿工游击队 absent',
  enemy_10003_trwlpl: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1000_gopro: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1007_slime_3: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1008_ghost: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1010_demon_a: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1012_dcross_a: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1016_diaman: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1020_obsv: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1022_dmage: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1022_dmage_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1024_mortar: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1024_mortar_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1027_mob: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1039_breakr: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1039_breakr_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1047_sagent: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1047_sagent_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1053_norgst_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1056_ganwar: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1056_ganwar_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1058_traink: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1060_emouse_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1063_rageth_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1068_snmage_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1071_dftman_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1072_dlancer_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1073_dscout: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1074_dbskar_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1074_dbskar_2b: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1074_dbskar_2c: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1076_bsthmr_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1080_sotidp: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1080_sotidp_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1082_soticn: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1082_soticn_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1084_sotidm: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1084_sotidm_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1085_sotiwz: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1090_mdsnpr_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1103_wdkght_3: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1104_lfkght_3: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1106_byokai: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1107_uoffcr: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1113_empace_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1123_spsbr_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1128_spmage_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1133_harchn: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1134_diamd: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1136_redace: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1136_redace_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1141_merbow: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1143_merrpg: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1144_merlgd: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1162_magmot_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1191_krgrg: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1199_sfjin_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1212_mtrfol_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1219_mtrbty: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1220_dzoms_2_a: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1221_dzomg_a: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1223_dmech: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1224_dsuply_b: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1238_ltmob: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1238_ltmob_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1240_ltgint_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1242_ltsmag: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1243_ltswar: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1263_durbus: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1263_durbus_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1276_telex: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1285_sgwlf: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1287_ducrb: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1287_ducrb_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1291_dusrch: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1293_duswrd_3: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1302_ymtro: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1306_mhtrtl_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1309_mhboar_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1311_mhkryk_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1313_wdfmr: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1317_wdexg: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1317_wdexg_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1318_wdsmgc: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1321_wdarft_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1332_cbterm_2_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1336_bldbat: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1352_eslime: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1384_winfrz: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1401_pogpro: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1412_mmjump: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1415_mmkabi: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1418_mmkonm: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1418_mmkonm_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1423_lrfkkt_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1424_lrboom: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1427_lrnazg_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1428_lrsoul: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1428_lrsoul_a: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1429_lrwzrd: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1429_lrwzrd_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1430_lrrook_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_1431_lrmzrd_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2027_syudg2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2028_syevil: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2029_symon: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2046_smwar: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2063_skzlch: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2064_skzwdd: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2064_skzwdd_a: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2064_skzwdd_b: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2066_skzlcp: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2067_skzcy: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2068_skzirn_b: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2069_skzbox: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2070_skzfbx: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2072_skdny2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2073_skzrck: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2075_skgly2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2077_skklz2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2079_skmst2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2080_skzlwy: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2081_skztxs: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2082_skzdd: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2084_skzcan: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2089_skzjkl: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2090_skzjbc: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2091_skzgds: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2092_skzamy: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2093_skzams: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2094_skzamb: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_2094_skzamb_2: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_3001_upeopl: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_3001_upeopl_a: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_3004_speople: 'merged roster (rogue/story data); no authored kit — fights on data stats',
  enemy_3005_lpeopl: 'merged roster (rogue/story data); no authored kit — fights on data stats',
});
export const KITS = Object.freeze({...trainingKits(BASE_KITS,STATS_ONLY), ...BASE_KITS});

// 圣杯 damage sharing: ground enemies near a living chalice pass `share` of the damage they take to it.
function chaliceShare(b, c) {
  const st = stOf(b);
  if (!(st.chalices > 0)) return;
  const t = c.target;
  if (!t || t.side !== 'enemy' || t.isFlying || c.dmg.cancel || c.dmg.type === 'element' || (c.dmg.tags && c.dmg.tags.includes('chalice'))) return;
  for (const o of b.enemies) {
    if (!o.alive || o === t || o.defId !== 'enemy_1430_lrrook' || !o.mem.ab) continue;
    const a = o.mem.ab.list[0];
    if (!a || !(a.share > 0) || hypot(o.x - t.x, o.y - t.y) > a.r) continue;
    const part = c.dmg.amount * a.share;
    c.dmg.amount -= part;
    // a 无来源 burst's share stays 无来源, credited like the burst (damage.js)
    b.dealDamage(c.dmg.sourceless ? c.credit : c.source, o, { amount: part, type: c.dmg.type, canDodge: false, sourceless: c.dmg.sourceless, tags: [...(c.dmg.tags || []), 'chalice'] });
    break;
  }
}
