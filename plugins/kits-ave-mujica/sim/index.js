// sim/index.js — written by `node tools/plugin.mjs import-forge` from the Forge pack ave-mujica 1.8.24.
// Nothing in this file ran during the import. Each Forge file below keeps a scope of its own; only its import and
// export lines were rewritten: @kit/tier1.js → kit, @sim/constants.js → constants, @sim/detmath.js → math, @sim/dir.js → dir, @sim/targeting.js → targeting of sp:sdk@1.
// It runs only where the server owner set SP_PLUGIN_SCRIPTS=sandbox (or a trusted mode) and a room selects this plugin.

import { kit as __forgeKit } from 'sp:sdk@1';

const __forgeFreeze = Object.freeze;

// ---- kits/chess_char_5_25_a.js ----
const __forgeModule0 = (() => {
const num = __forgeKit["num"];
const talentBb = __forgeKit["talentBb"];
const traitBb = __forgeKit["traitBb"];
const skillBbOf = __forgeKit["skillBbOf"];
const batMod = __forgeKit["batMod"];
// workshop/rimbilliton/kits/chess_char_5_25_a.js — 雷姆必拓工坊包 kit（import 白名单：@kit/ @sim/ @ops/）。
// Kit contract and rules: server/sim/content/kits/README.md.
//
// 傀儡师 (professions.js installDollkeeper): 受到致命伤时切换成<替身>作战，20 s 后回本尊 — trait 无需代码；kit 只写
//   dollNoAttack（<替身>不进行普通攻击，engine 在替身形态施加减益缴械+沉默）。
// S1 多首野兽 (MANUAL, 时间回复, 14/15 s): 防御 +def、阻挡数 +block_cnt、更容易成为敌人的攻击目标 (taunt)；技能期间
//   被击倒后，<替身>也能阻挡敌人且享受技能效果，直到<替身>退场（dollSwap 进替身时延续 buff，回本尊移除）。
// S2 破坏与滋养 (MANUAL, 时间回复, 15 s): 攻击范围扩大 (rangeGrid 2-1)，攻击间隔略微缩短 (Lv7 base_attack_time)，
//   每次攻击变为 atk_scale 法术伤害的三连发，每次攻击到敌人时自身受到 value 点法术伤害。
// T1 另一个"她": 若叶睦和<替身>受到物理/法术伤害的 damage_resistance 转化为 dark_damage_mul_factor 的凋亡损伤；
//   <替身>不攻击，防御力 +def。[ASSUMED] "Ave Mujica 成员攻击时有 20% 概率使替身持续时间缩短 1 秒" — mod 无乐队成员
//   判定数据，不实现。
// T2 毋畏死亡: 受伤 Fever +cnt；在场时 Ave Mujica 成员生命上限 +max_hp —— 两半都由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）负责，团队判定在那侧，本 kit 不重复。


const onDefaultSkill = chess => {
      const d = (chess?.skills ?? []).find(s => s && s.isDefault);
      return !d || !chess?.skill || d.skillId === chess.skill.skillId;
    };

const S1 = "skx_ave_mujica_skchr_mortis_1";
const S2 = "skx_ave_mujica_skchr_mortis_2";
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => Number.isFinite(v) && v !== 0));

const __forgeDefault = (bb, chess, def) => {
    const sid = onDefaultSkill(chess) ? (chess?.skill?.skillId ?? S2) : S2;
    const b1 = skillBbOf(chess, S1);
    const s2Grid = (chess?.skills ?? []).find((s) => s.skillId === S2)?.rangeGrid ?? null;
    const s1mods = nz({ defPct: num(b1.def), blockCnt: num(b1.block_cnt), taunt: num(b1.taunt_level) });
    const s1 = {
      kind: 'duration',
      mods: s1mods,
      onStart({ unit }) { unit.mem.mortisS1 = true; },
      // 技能被击倒（替身切换）时以 reason 'substitute' 结束 — 效果延续给替身（见 install 的 dollSwap），不清标记
      onEnd({ unit, reason }) { if (reason !== 'substitute') unit.mem.mortisS1 = false; },
    };
    const s2 = {
      kind: 'duration',
      targeting: s2Grid ? { rangeGrid: s2Grid.map((p) => [p[0], p[1]]) } : undefined,
      // 攻击范围扩大(2-1 > 自身1格) → 按 owner 0.2.0 规则 ACTIVE_RANGE（数据 DEFAULT 有缺，参照莱伊 S3 修正）
      ...(s2Grid ? { trigger: { rule: 'ACTIVE_RANGE', grid: s2Grid.map((p) => [p[0], p[1]]) } } : {}),
      mods: nz({ batPct: batMod(bb.base_attack_time, chess) }),
      attack: {
        dmgType: 'arts',
        atkScale: num(bb['attack@atk_scale'], 1),
        hits: 3, // 三连发
        onEachHit({ battle, unit, target }) {
          const v = num(bb.value, 0);
          if (target && target.alive && target.side === 'enemy' && v > 0) {
            battle.dealDamage(unit, unit, { amount: v, type: 'arts', isSkill: true, tags: ['skill', 'mortis:self'] });
          }
        },
      },
    };
    return {
      trait: { dollNoAttack: true }, // <替身>不攻击
      skill: sid === S2 ? s2 : s1,
      skills: { [S1]: s1 }, // 默认技能 S2 只放顶层 `skill`（skillSource 'kit'）
      talents: [
        { install(battle, unit) { // 另一个"她": 受物理/法术伤害 → 凋亡损伤; 替身防御 +def
          const dr = num(talentBb(chess, 0).damage_resistance, 0), half = num(talentBb(chess, 0).dark_damage_mul_factor, 0.5);
          if (dr > 0) {
            battle.on('damaged', (c) => {
              if (c.target !== unit || (c.type !== 'phys' && c.type !== 'arts') || !(c.amount > 0)) return;
              const fill = c.amount * dr * half;
              if (fill > 0) battle.dealDamage(unit, unit, { type: 'element', element: 'apoptosis', amount: fill, tags: ['talent', 'mortis:apoptosis'] });
            }, { owner: unit });
          }
          const def = num(talentBb(chess, 0).def, 0);
          if (def > 0) {
            battle.every(0.2, () => {
              if (unit.trait.doll) battle.addBuff(unit, { key: 'talent:mortis:dollDef', duration: 0.3, mods: { defPct: def }, tags: ['talent'] });
            }, { owner: unit });
          }
        } },
      ],
      install(battle, unit) {
        // S1: 技能期间被击倒 → <替身>也享受技能效果，直到替身退场（回本尊）
        battle.on('dollSwap', (c) => {
          if (c.unit !== unit) return;
          if (c.form === 'doll' && unit.mem.mortisS1 && Object.keys(s1mods).length) {
            battle.addBuff(unit, { key: 'skill:mortis:s1doll', persist: true, mods: s1mods, tags: ['skill'] });
          } else if (c.form === null) {
            battle.removeBuff(unit, 'skill:mortis:s1doll');
          }
        }, { owner: unit });
      },
    };
  };

return __forgeFreeze({ "default": __forgeDefault });
})();

// ---- kits/chess_char_5_30_a.js ----
const __forgeModule1 = (() => {
const num = __forgeKit["num"];
const skillBbOf = __forgeKit["skillBbOf"];
const talentBb = __forgeKit["talentBb"];
const traitBb = __forgeKit["traitBb"];
const toggleBuff = __forgeKit["toggleBuff"];
// workshop/ave-mujica/kits/chess_char_5_30_a.js — 三角初华/Doloris（颂乐人偶 mod）
// 速射手 (SNIPER fastshot): 物伤, 可对空, 攻速快。
// 吟游者特性「不攻击，持续恢复范围内友军生命，自身不受鼓舞影响」: 初华给自己上不了鼓舞（mem.noInspire）。
// S1 我思念的 (duration): 攻击范围扩大，范围内友方获得相当于自身攻击力 share 与防御力 def_share 的鼓舞（flat 加值），友方受伤时为其治疗 heal 点。
// S2 我悲悯的 (duration): 每 interval 秒对随机敌人造成 atk×dps_scale 法伤并治疗最伤友方 atk×heal_scale；范围内其他友方获得 atk×inspire 的鼓舞。[ASSUMED]
// T1 谎言的假面: 技能未开启时每 interval 秒治疗攻击范围内生命最低的友方以 atk×heal_scale 生命（「优先选择丰川祥子」需乐队成员判定，未实现）。
// T2 毋畏悲伤: Fever（治疗成员 +5）与「攻击范围内成员攻击时附带 初华攻击力×bonus_scale 的法术伤害」都由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）负责，本 kit 不重复。
// 模组 BAR-X「占卜的意义」: 攻击范围内存在 2 名及以上其他干员时，攻击力+8%（不受技能影响 — 近似为 atkPct）。


// 技能 id 用**官方 id**（与包内 fx 索引 `assets/fx/index.json` 的 `skchr_dolris_*` 一致），见 6_30 的说明。
const S1 = "skx_ave_mujica_skchr_dolris_1";
const S2 = "skx_ave_mujica_skchr_dolris_2";
const INSPIRE = 'am:doloris:inspire';

const __forgeDefault = (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);

  const giveInspire = (battle, unit, atkShare, defShare, dur) => {
    const m = {};
    if (atkShare > 0) m.atkFlat = unit.s.atk * atkShare;
    if (defShare > 0) m.defFlat = unit.s.def * defShare;
    if (!Object.keys(m).length) return;
    for (const a of battle.alliesInGrid(unit)) {
      // 吟游者特性「自身不受鼓舞影响」: 不能给自己上鼓舞（否则 atkFlat 取自自身当前攻击力、每次刷新自我放大），也不给其他受鼓舞免疫的单位上
      if (a === unit || a.mem?.noInspire) continue;
      battle.addBuff(a, { key: INSPIRE, duration: dur, refresh: 'replace', source: unit, mods: m, tags: ['aura'] });
    }
  };

  const s1 = {
    kind: 'duration',
    duration: num(b1.duration, 30),
    targeting: { rangeExtend: Math.max(1, Math.floor(num(b1.rangeExtend, 1))) },
  };
  const s2 = {
    kind: 'duration',
    duration: num(b2.duration, 12),
    onTick({ battle, unit, dt }) {
      const tick = (unit._d2 = (unit._d2 || 0) + dt);
      const iv = Math.max(0.05, num(b2.interval, 0.3));
      if (tick < iv) return;
      unit._d2 = 0;
      const dps = num(b2.dps_scale, 0.7);
      if (dps > 0) {
        const foes = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
        if (foes.length) {
          const e = foes[Math.floor(battle.rng() * foes.length)];
          if (e && e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * dps, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'am:doloris'] });
        }
      }
      const hs = num(b2.heal_scale, 0.15);
      if (hs > 0) {
        let best = null;
        for (const a of battle.alliesInGrid(unit)) if (a.hp < a.s.maxHp && (!best || a.hpRatio < best.hpRatio)) best = a;
        if (best) battle.heal(unit, best, unit.s.atk * hs);
      }
      const insp = num(b2.inspire, 0.8);
      if (insp > 0) {
        for (const a of battle.alliesInGrid(unit)) {
          if (a === unit || a.mem?.noInspire) continue;   // 自身不受鼓舞影响
          battle.addBuff(a, { key: INSPIRE, duration: iv + 0.1, refresh: 'replace', source: unit, mods: { atkFlat: unit.s.atk * insp }, tags: ['aura'] });
        }
      }
    },
  };

  const t1 = talentBb(chess, 0);
  const talents = [
    { install(battle, unit) { // T1 谎言的假面: 技能未开启时定时治疗范围内生命最低的友方
      const iv = Math.max(0.5, num(t1.interval, 4));
      const sc = num(t1.heal_scale, 0.3);
      if (!(sc > 0)) return;
      battle.every(iv, () => {
        if (!unit.alive || !unit.deployed) return;
        if (unit.skill && unit.skill.active) return;   // 技能未开启时
        let best = null;
        for (const a of battle.alliesInGrid(unit)) if (a.hp < a.s.maxHp && (!best || a.hpRatio < best.hpRatio)) best = a;
        if (best) battle.heal(unit, best, unit.s.atk * sc);
      }, { owner: unit });
    } },
    { install(battle, unit) { // 模组 BAR-X: 攻击范围内存在 2 名及以上其他干员时，攻击力+8%
      const a = num(traitBb(chess).atk, 0);
      if (!(a > 0)) return;
      toggleBuff(battle, unit, 'am:doloris:modAtk',
        () => battle.alliesInGrid(unit).filter((x) => x !== unit).length >= 2,
        { atkPct: a });
    } },
  ];

  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2 },
    talents,
    install(battle, unit) {
      unit.mem.noInspire = true; // 吟游者特性「自身不受鼓舞影响」（本 kit 与其他来源的鼓舞都跳过她）
      battle.every(0.5, () => {
        if (!unit.alive || !unit.deployed || !unit.skill || !unit.skill.active || unit.skill.id !== S1) return;
        giveInspire(battle, unit, num(b1.share, 0.3), num(b1.def_share, 0.3), 0.7);
      }, { owner: unit });
      battle.on('damaged', (ctx) => {
        if (!unit.skill || !unit.skill.active || unit.skill.id !== S1) return;
        const t = ctx.target;
        if (!t || t.side !== 'ally' || t.kind === 'device' || !t.alive) return;
        const inRange = battle.alliesInGrid(unit).some((a) => a.id === t.id);
        if (!inRange) return;
        const h = num(b1.heal, 50);
        if (h > 0) battle.heal(unit, t, h);
      }, { owner: unit });
    },
  };
};;
return __forgeFreeze({ "default": __forgeDefault });
})();

// ---- kits/chess_char_5_31_a.js ----
const __forgeModule2 = (() => {
const num = __forgeKit["num"];
const skillBbOf = __forgeKit["skillBbOf"];
const talentBb = __forgeKit["talentBb"];
const traitBb = __forgeKit["traitBb"];
const isMainHit = __forgeKit["isMainHit"];
const cheb = __forgeKit["cheb"];
// workshop/ave-mujica/kits/chess_char_5_31_a.js — 祐天寺若麦/Amoris（颂乐人偶 mod）
// 撼地者 (WARRIOR hammer): 近战, 物伤, 溅射 1.0 / 50%（professions.js hammer）。
// S1 如焰般热烈 (duration): 攻击变为三连击（首击溅射）；段 1 = atk×first_scale（130%），段 2–3 = atk×sub_scale（20%）。
// S2 如麦般生长 (duration): 攻击范围扩大，攻击变为八连击；**段 1 与段 5** = atk×main_scale（100%）、其余 6 段
//   = atk×sub_scale（10%）；每段在攻击范围内**随机**选目标（数据原文「随机攻击范围内的目标」）。
// T1 双利手: 「进行持续攻击」由本包盟约安装器（battle/main.mjs 的 installAveMujica，与祥子同款）实现；
//   攻击时 prob 概率使敌人获得 fragile 脆弱，持续 fragile_dur 秒。
// T2 毋畏爱意 / 模组成员增伤: Fever 系统与成员判定由本包盟约安装器（battle/main.mjs 的 installAveMujica）负责，本 kit 不重复。
// 模组 HAM-X「年轻的麦子」: 溅射范围内有 ≥3 个敌人时，使当次攻击力提升至 atk_scale（近似：主目标伤害 ×atk_scale）。


// 技能 id 用**官方 id**（与包内 fx 索引 `assets/fx/index.json` 的 `skchr_amoris_*` 一致），见 6_30 的说明。
const S1 = "skx_ave_mujica_skchr_amoris_1";
const S2 = "skx_ave_mujica_skchr_amoris_2";

const __forgeDefault = (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  // 每段倍率（**逐段取自该技能自己的黑板**；缺 `first_scale` / `main_scale` / `sub_scale` 的键一律回落到
  // 旧的单一 `atk_scale` ⇒ 数据没写这几个键的技能行为与改动前逐字一致）：
  //   S1：段 1 = first_scale，段 2–3 = sub_scale（记录里 1.3 / 0.2；合计 ≈ 1.7×atk）
  //   S2：段 1 与段 5 = main_scale，其余 6 段 = sub_scale（记录里 1 / 0.1；合计 ≈ 2.6×atk）
  const atk1 = num(b1.atk_scale, 1.0), atk2 = num(b2.atk_scale, 1.0);
  const s1Hits = Math.max(1, Math.floor(num(b1.hits, 3)));
  const s2Hits = Math.max(1, Math.floor(num(b2.hits, 8)));
  const s1Scales = Array.from({ length: s1Hits }, (_, i) => num(i === 0 ? b1.first_scale : b1.sub_scale, atk1));
  const s2Scales = Array.from({ length: s2Hits }, (_, i) => num(i === 0 || i === 4 ? b2.main_scale : b2.sub_scale, atk2));
  /**
   * 一套「N 段」的攻击档（业主 2026-10-18：S2 八段 / S1 三段），**每段各自的倍率**由 `scales[i]` 给出
   * （`scales[0]` = 引擎那一下 = 第 1 段；`scales[i]` = `onHit` 补的第 i+1 段）。
   *
   * ⚠️ 为什么不是直接 `hits: N`：引擎连击循环写的是 `for (h < hits && target.alive)`（`server/sim/ai.js`
   * resolveHit）—— 目标在**第 1 段**就被打死时整条连击立刻中断，玩家看到的就是「只有第一段」。那是引擎对
   * **所有**干员的既有语义（不能只给若麦翻掉，否则黄金语料不再逐字节一致）。
   *
   * 包侧做法：引擎那一下只算 **第 1 段**（`hits: 1`，它一定会发生、不受后续循环影响，倍率走 `scales[0]`），
   * 其余 `N − 1` 段在 `attack.onHit` 里补完 —— **一段一次 `dealDamage`**，每段**重新**在攻击范围内随机取一个
   * **存活**敌人（数据原文「随机攻击范围内的目标」）。因此：一套动作必定完整打满 N 段；目标阵亡 / 目标转移都
   * **不会**重置或提前结束这一套（无可选目标的那一段空过，段数照旧走完）。
   * 每段伤害与引擎同一式：`atk × 该段倍率 × 单位的 atkScaleMul`。
   */
  const combo = (hits, scales, extra = {}) => ({
    hits: 1,
    atkScale: scales[0],
    dmgType: 'phys',
    ...extra,
    onHit({ battle, unit }) {
      for (let h = 1; h < hits; h += 1) {
        const list = battle.enemiesInKeys(unit.rangeKeys, unit, unit.profile);
        const live = list ? list.filter((e) => e && e.alive) : [];
        if (!live.length) break; // 这一段没有可选目标 ⇒ 空过，不重置段数
        const e = live[Math.min(live.length - 1, Math.floor(battle.rng() * live.length))];
        battle.dealDamage(unit, e, { amount: unit.s.atk * unit.s.atkScaleMul * num(scales[h], scales[0]),
          type: 'phys', isAttack: true, isSkill: true, tags: ['skill', 'amoris'] });
      }
    },
  });
  const s1 = {
    kind: 'duration',
    duration: num(b1.duration, 15),
    // 三连击：首击（引擎那一下）带溅射、段 1 = first_scale（缺则回落 atk_scale，即改动前的单一倍率行为）；
    // 其余两段 = sub_scale（同样回落）
    attack: combo(s1Hits, s1Scales, { splashRadius: num(b1.splash_radius, 1.1) }),
  };
  const s2 = {
    kind: 'duration',
    duration: num(b2.duration, 24),
    targeting: { rangeExtend: Math.max(1, Math.floor(num(b2.rangeExtend, 1))) },
    // 八连击：1（引擎）+ 7（onHit）；段 1 与段 5 = main_scale，其余 = sub_scale（缺键一律回落 atk_scale）
    attack: combo(s2Hits, s2Scales),
  };
  const t1 = talentBb(chess, 0);
  const talents = [
    { install(battle, unit) { // T1 双利手: 攻击时概率使敌人获得 8% 脆弱，持续 2 秒
      const p = num(t1.prob, 0.1), v = num(t1.fragile, 0.08), d = num(t1.fragile_dur, 2);
      if (!(p > 0 && v > 0 && d > 0)) return;
      battle.on('hit', (ctx) => {
        const tg = ctx.target;
        if (ctx.source !== unit || !tg || tg.side !== 'enemy' || !tg.alive) return;
        if (!(p >= 1 || battle.rng() < p)) return;
        battle.applyStatus(tg, 'fragile', { duration: d, value: v, source: unit });
      }, { owner: unit });
    } },
    { install(battle, unit) { // 模组 HAM-X: 溅射范围内 ≥3 个敌人时，当次攻击力提升至 115%
      const r = num(traitBb(chess).atk_scale, 1);
      if (!(r > 1)) return;
      battle.on('hit', (ctx) => {
        if (ctx.source !== unit || !isMainHit(ctx.dmg)) return;
        const tg = ctx.target;
        if (!tg || tg.side !== 'enemy' || !ctx.dmg) return;
        let n = 0;
        for (const e of battle.enemies) if (e.alive && cheb(tg, e) <= 1) n++;
        if (n >= 3) ctx.dmg.amount *= r;
      }, { owner: unit });
    } },
  ];
  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2 },
    talents,
  };
};;
return __forgeFreeze({ "default": __forgeDefault });
})();

// ---- kits/chess_char_5_32_a.js ----
const __forgeModule3 = (() => {
const num = __forgeKit["num"];
const skillBbOf = __forgeKit["skillBbOf"];
// workshop/ave-mujica/kits/chess_char_5_32_a.js — 八幡海铃/Timoris（颂乐人偶 mod）
// 铁卫 (DEFENDER protector): 近战重装, 阻挡2, 物伤。
// S1 颤栗之弦 (charges ×2): 一次5连击，对范围内敌人每次造成 atk×atk_scale 的法术伤害。[ASSUMED]
// S2 无存之所 (duration): 立即使范围内敌人恐惧 fear_dur 秒；期间每秒对范围内敌人造成 atk×dps_scale 法伤。[ASSUMED]
// T1 应召而至: 「被伤害的敌人 21% 概率停顿 3 秒」已由本包盟约安装器（battle/main.mjs 的 Timoris：全员 25%+每层0.05%）统一实现，
//   本 kit 不重复；「技能期间攻击范围扩大」无对应范围数据，未实现。
// T2 毋畏恐惧: Fever（造成停顿 +2）与「在场时成员对停顿/恐惧敌人增伤 dmg_up」为团队效果，由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）负责，本 kit 不重复。
// 模组 AMB-Y「额外训练」: 特性 50%→65% 闪避由 professions.js 的 stalker 规则读取 trait.bb.prob 生效，无需 kit。


// 技能 id 用**官方 id**（与包内 fx 索引 `assets/fx/index.json` 的 `skchr_tmoris_*` 一致），见 6_30 的说明。
const S1 = "skx_ave_mujica_skchr_tmoris_1";
const S2 = "skx_ave_mujica_skchr_tmoris_2";

const __forgeDefault = (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  const s1 = {
    kind: 'charges',
    charges: num(b1.charges, 2),
    attack: {
      hits: Math.max(1, Math.floor(num(b1.hits, 5))),
      atkScale: num(b1.atk_scale, 0.55),
      dmgType: 'arts',
    },
  };
  const s2 = {
    kind: 'duration',
    duration: num(b2.duration, 15),
    onStart({ battle, unit }) {
      const fd = num(b2.fear_dur, 1.5);
      if (fd > 0) {
        for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
          battle.applyStatus(e, 'fear', { duration: fd, source: unit });
        }
      }
    },
    onTick({ battle, unit, dt }) {
      const tick = (unit._t2 = (unit._t2 || 0) + dt);
      if (tick < 1) return;
      unit._t2 = 0;
      const dps = num(b2.dps_scale, 0.7);
      if (dps <= 0) return;
      for (const e of battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true })) {
        if (e.alive) battle.dealDamage(unit, e, { amount: unit.s.atk * dps, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'am:timoris'] });
      }
    },
  };
  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2 },
    talents: [],
  };
};;
return __forgeFreeze({ "default": __forgeDefault });
})();

// ---- kits/chess_char_6_30_a.js ----
const __forgeModule4 = (() => {
const num = __forgeKit["num"];
const skillBbOf = __forgeKit["skillBbOf"];
// workshop/ave-mujica/kits/chess_char_6_30_a.js — 丰川祥子/Oblivionis（颂乐人偶 mod）
// 领主 (WARRIOR lord): 近战, 远程攻击, 可同时攻击2名敌人, 物伤/法伤。
// S1 新月的苏醒 (charges ×2): 对范围内一名敌人依次演奏8个音符，造成依次递减的法术伤害。
// S2 满月的舞会 (toggle): 攻击力+atkMul、攻击速度+aspd，攻击变为造成法术伤害的二连击。
// S3 残月的余响 (duration): 攻击范围扩大，攻击变为造成 atk_scale 法伤的4连击。
// T1 颂乐音符: 「每存在一个音符，成员无视敌人 def_pen 防御 / res_pen 法抗（最多 max_stack 层）」由本包盟约安装器
//   （battle/main.mjs 的 installAveMujica）实现：祥子每造成一次敌人伤害记一个音符（寿命 3 s [ASSUMED]），按在场音符数给成员穿透。
// T2 毋畏遗忘: 「造成伤害时 Fever+3」由本包盟约安装器（battle/main.mjs）负责，本 kit 不重复。
// 模组 LOR-Y「无言的约定」: 「攻击范围内存在 2 名及以上敌人时攻击速度+12」由引擎 traitMods.js 读取
//   trait.moduleDesc + trait.bb.attack_speed 生效，无需 kit。


// 技能 id 用**官方 id**（与包内 fx 索引 `assets/fx/index.json` 的 `skchr_oblvns_*` 一致）：
// 引擎的官方技能特效（VFX 计划）只认官方 id，写 mod 自造的 `skchr_am_*` 会让技能 prefab 一次都不播。
const S1 = 'skchr_oblvns_1';
const S2 = 'skchr_oblvns_2'; // 满月的舞会 (toggle；图标 art.skills 仍按 mod 名 am_oblivionis_3)
const S3 = 'skchr_oblvns_3'; // 残月的余响 (duration；图标 art.skills 仍按 mod 名 am_oblivionis_2)

const __forgeDefault = (bb, chess) => {
  const b1 = skillBbOf(chess, S1);
  const b2 = skillBbOf(chess, S2);
  const b3 = skillBbOf(chess, S3);
  const scales = Array.isArray(b1.scales) && b1.scales.length ? b1.scales : [0.5, 0.46, 0.38, 0.29, 0.21, 0.17, 0.08, 0.03];
  const s1 = {
    kind: 'charges',
    charges: num(b1.charges, 2),
    onStart({ battle, unit }) {
      const list = battle.enemiesInKeys(unit.rangeKeys, unit, { canHitFly: true });
      const e = list && list.length ? list[0] : null;
      if (!e || !e.alive) return;
      for (const sc of scales) {
        if (!e.alive) break;
        battle.dealDamage(unit, e, { amount: unit.s.atk * sc, type: 'arts', isSkill: true, canDodge: false, tags: ['skill', 'am:oblivionis'] });
      }
    },
  };
  const s2 = {
    kind: 'toggle',
    mods: { atkMul: num(b2.atkMul, 1.4), aspd: num(b2.aspd, 60) },
    attack: { hits: Math.max(1, Math.floor(num(b2.hits, 2))), dmgType: 'arts', atkScale: 1 },
  };
  const s3 = {
    kind: 'duration',
    duration: num(b3.duration, 25),
    targeting: { rangeExtend: Math.max(1, Math.floor(num(b3.rangeExtend, 1))) },
    attack: { hits: Math.max(1, Math.floor(num(b3.hits, 4))), dmgType: 'arts', atkScale: num(b3.atk_scale, 1.4) },
  };
  return {
    skill: s1,
    skills: { [S1]: s1, [S2]: s2, [S3]: s3 },
    talents: [],
  };
};;
return __forgeFreeze({ "default": __forgeDefault });
})();

export default function setup(sp) {
  sp.kits.register("char_x_ave_mujica_char_5_25", __forgeModule0["default"]);
  sp.kits.register("char_x_ave_mujica_char_5_30", __forgeModule1["default"]);
  sp.kits.register("char_x_ave_mujica_char_5_31", __forgeModule2["default"]);
  sp.kits.register("char_x_ave_mujica_char_5_32", __forgeModule3["default"]);
  sp.kits.register("char_x_ave_mujica_char_6_30", __forgeModule4["default"]);
}
