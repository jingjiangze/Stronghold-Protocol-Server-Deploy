// Official-data faction adapters. Exact hand-authored family kits take priority.
// Map devices absent from Stronghold are not invented by this adapter.
import {standby as marchingStandby} from './standby.js';
import { TRAINING_ENEMY_KEYS } from '../../../../shared/trainingEnemyCatalog.js';
import { stealth, unblockable, splashAttack, ep, onHitStatus, nthAttackStatus, lowHpBuff, refraction, skill } from './archetypes.js';
import { T, hurt, areaAllies, targetsNear, byPriority,setHits,hitCount,abilityAttackFx,abilityTargetFx } from './helpers.js';
const present = u => u?.alive && u.deployed && !u.removed;
const limit = (n, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(n) ? n : lo));
const findNumber = (table, pattern, fallback = 0) => {
  const pair = Object.entries(table || {}).find(([key, value]) => pattern.test(key) && typeof value === 'number');
  return pair ? pair[1] : fallback;
};
const targets = (b, e, r) => byPriority(e, targetsNear(b, e, r)).filter(present);

function nativeRoster(ab, enemy) {
  const raw = enemy.def.raw, abilities=raw.officialAbilities||raw.abilities||[],text = abilities.map(a => a.text || '').join('；');
  const silencedRow = pattern => abilities.some(a=>a.format==='SILENCE'&&pattern.test(a.text||''));
  const t = ab.t, out = [];
  const hitMatch=/需要(\d+)次[^；]*(?:伤害|攻击)/.exec(text);
  if(hitMatch||/受到一定次数的伤害后被摧毁/.test(text))out.push({spawn(b,e){
    const count=hitMatch?Number(hitMatch[1]):e.def.raw.stats.maxHp;
    e.mem.fixedHitCount=Math.max(1,Math.round(count));setHits(e,e.mem.fixedHitCount);hitCount(b,e,true,/法术或真实伤害/.test(text));
  }});
  if (/^隐匿|拥有隐匿|自身.{0,10}隐匿|获得隐匿/.test(text)) out.push(stealth());
  if (/无法被阻挡|不可被阻挡/.test(text)) out.push(unblockable());
  if (/折射/.test(text)) out.push(refraction(T(ab, 'refracting.magic_resistance', 'Refracting.magic_resistance') ?? 70));
  if (/溅射|群体物理|群体法术|攻击自身周围四格/.test(text)) out.push(splashAttack({ unblocked: false,
    radius: limit(findNumber(t, /(?:range_radius|damage_radius|splash_radius)$/i, 1), .5, 4), tiles: /周围四格/.test(text) ? 1 : 0 }));
  const element = /神经损伤/.test(text) ? 'neural' : /侵蚀损伤/.test(text) ? 'erosion' : /灼燃损伤/.test(text) ? 'burn' : /凋亡损伤/.test(text) ? 'apoptosis' : null;
  const ratio = findNumber(t, /(?:ep_damage_ratio|element_damage_ratio|epdamage_ratio)$/i);
  if (element && ratio > 0) out.push(ep(element, ratio,silencedRow(/损伤/)));
  if (/攻击.{0,12}寒冷|使目标寒冷/.test(text)) out.push({...onHitStatus('cold', findNumber(t, /(?:freeze|cold)(?:\.duration)?$/i, 5)),sil:silencedRow(/寒冷/)});
  const required = /阻挡数(?:大于等于|不小于|至少为|为)(\d)/.exec(text);
  if (required) out.push({ spawn(_b, e) { e.blockWeight = Math.max(e.blockWeight || 1, Number(required[1])); } });
  if (/被击倒.{0,12}爆炸|死亡.{0,8}爆炸/.test(text)) out.push({ sil: silencedRow(/爆炸/), death(c, b, e) {
    if (c.reason !== 'killed') return;
    const r = limit(findNumber(t, /(?:explosion|boom).*radius/i, 1.5), .5, 5);
    b.fx('explode', { id: e.id, x: e.x, y: e.y, r });
    for (const u of areaAllies(b, e, e.x, e.y, r)) hurt(b, e, u, findNumber(t, /(?:explosion|boom).*damage(?!_scale)/i, e.s.atk), /法术/.test(text) ? 'arts' : 'phys');
  } });
  const threshold = findNumber(t, /(?:hp_ratio|trigger_hp_ratio)$/i);
  if (threshold > 0 && threshold < 1 && /生命.{0,12}(低于|少于|下降)/.test(text)) out.push(lowHpBuff(threshold, {
    atkPct: findNumber(t, /(?:atk_add|atk)$/i), aspd: findNumber(t, /attack_speed$/i), moveMul: 1 + findNumber(t, /move_speed_add$/i),
  }));
  out.push({ silAware:abilities.some(a=>a.format==='SILENCE'),spawn(b, e) {
    const count = findNumber(t, /max_target(?:s|_cnt)?$/i, 1); if (count > 1) e.profile.maxTargets = limit(count, 1, 8);
    if (/优先攻击.{0,12}防御力最高/.test(text)) e.profile.priority = u => -u.s.def;
    if (/优先攻击.{0,12}防御力最低/.test(text)) e.profile.priority = u => u.s.def;
    if (/优先攻击.{0,12}生命.{0,8}最低/.test(text)) e.profile.priority = u => u.hpRatio;
    if (/不进行攻击|不会攻击|不攻击/.test(text) && !/失去.{0,8}时|被阻挡时/.test(text)) e.profile.noAttack = true;
    const regen = findNumber(t, /(?:hp_recovery_per_sec|hp_regen)$/i);
    if (regen > 0 && !e.base.hpRecoveryPerSec) b.addBuff(e, { key: 'training:regen', persist: true, mods: { hpRegen: regen } });
  } });
  for (const [name, s] of Object.entries(ab.sk)) {
    if (/lasso/i.test(name)) {
      out.push(skill(s, (b, e) => {
        const target = targets(b, e, Math.max(2, e.base.rangeRadius))[0]; if (!target) return;
        b.applyStatus(target, 'stun', { source: e, duration: limit(s.bb.duration || s.bb.stun || 10, .1, 30) });
        b.fx('beam', { id: e.id, from: e.id, to: target.id, kind: 'lasso' });
      }, { sil: silencedRow(/枷锁|瘫痪/), cond: (b, e) => targets(b, e, Math.max(2, e.base.rangeRadius)).length > 0 }));
      continue;
    }
    const status = s.bb.stun > 0 ? 'stun' : s.bb.freeze > 0 ? 'cold' : s.bb.disarmed_duration > 0 ? 'disarm' : null;
    if (s.sp > 0 && status) { out.push(nthAttackStatus(s.sp + 1, status, s.bb.stun || s.bb.freeze || s.bb.disarmed_duration, silencedRow(/晕眩|寒冷|缴械/), s)); continue; }
    if (!(s.cd > 0)) continue;
    const scale = s.bb.atk_scale ?? s.bb.damage_scale, damage = s.bb.damage;
    const heals = s.bb.heal_scale > 0 || /heal|cure/i.test(name);
    if (!heals && scale == null && damage == null && !status) continue;
    out.push(skill(s, (b, e) => {
      const r = limit(s.bb.range_radius ?? s.bb.radius ?? e.base.rawRangeRadius ?? 2, .5, 8);
      if (heals) {
        const allies = b.enemiesInRadius(e.x, e.y, r).filter(u => present(u) && u.hp < u.s.maxHp).sort((a, z) => a.hpRatio - z.hpRatio || a.id - z.id);
        for (const u of allies.slice(0, limit(s.bb.max_target || 3, 1, 8))) b.heal(e, u, e.s.atk * (s.bb.heal_scale || 1));
        b.fx('healAoe', { id: e.id, x: e.x, y: e.y, r }); return;
      }
      const victims = /aoe|range|burst|blast|bomb|whirl/i.test(name) ? areaAllies(b, e, e.x, e.y, r) : targets(b, e, r).slice(0, limit(s.bb.max_target || 1, 1, 8));
      for (const u of victims) {
        if (scale != null || damage != null) hurt(b, e, u, damage ?? e.s.atk * scale, e.base.dmgType === 'none' ? 'arts' : e.base.dmgType);
        if (status) b.applyStatus(u, status, { source: e, duration: limit(s.bb.stun || s.bb.freeze || s.bb.disarmed_duration, .1, 30) });
      }
      b.fx('explode', { id: e.id, x: e.x, y: e.y, r, kind: name });
    }, { sil: abilities.some(a=>a.format==='SILENCE'), cond: (b, e) => heals ? b.enemiesInRadius(e.x, e.y, 5).some(u => present(u) && u.hp < u.s.maxHp) : targets(b, e, Math.max(e.base.rangeRadius, 2)).length > 0 }));
  }
  return out;
}

const scout = () => [{ iv: .2, spawn(_b,e){e.profile.noAttack=true;},tick(b, e) { const r=e.base.rawRangeRadius||2.5;
  for(const u of b.allyUnits)if(present(u)&&(u.x-e.x)*(u.x-e.x)+(u.y-e.y)*(u.y-e.y)<=r*r)b.addBuff(u,{key:'training:detected',duration:.3,flags:{reveal:true}});
} }];
const host = (ab, e) => [...nativeRoster(ab, e), { iv: 1, tick(b, u) {
  const ratio = findNumber(ab.t, /(?:lose_hp_ratio|hp_loss_ratio)$/i);
  if (ratio > 0) b.loseHp(u, u.s.maxHp * ratio);
} }];
const commander = (ab, e) => [...nativeRoster(ab, e), { iv: .5, tick(b, u) {
  const atk = findNumber(ab.t, /(?:inspire|command|buff|strength).*atk$/i), def = findNumber(ab.t, /(?:inspire|command|buff|strength).*def$/i);
  if (!atk && !def) return;
  for (const ally of b.enemies) if (present(ally) && ally !== u) b.addBuff(ally, { key: 'training:command:' + u.defId, duration: .6, mods: { atkPct: atk, ...(Math.abs(def)>2?{defFlat:def}:{defPct:def}) } });
} }];
const standby = (ab, e) => [...nativeRoster(ab,e),marchingStandby(ab,{maxTargets:2})];
const sentinel = (ab, e) => [...nativeRoster(ab, e), {
  spawn(_b,u){u.profile.noAttack=true;},
  taken(_c,b,u){if(u.mem.trainingAlarm)return;u.mem.trainingAlarm=true;castAlarm(b,u,ab);},
}];
function castAlarm(b,u,ab){
  const s=ab.sk.Awake;b.fx('buff',{id:u.id,x:u.x,y:u.y,kind:'alarm'});
  for(const other of b.enemies){if(!present(other))continue;b.addBuff(other,{key:'training:alarm:'+u.defId,persist:true,mods:{atkPct:s?.bb.atk??.3,defPct:s?.bb.def??.3}});
    if(other.mem.standbyWake)other.mem.standbyWake();}
}
const bloodWitch = (ab,e) => [...nativeRoster(ab,e),{iv:1,
  tick(b,u){const loss=T(ab,'periodic_damage.damage')||0;if(loss>0)b.loseHp(u,loss);},
  death(c,b,u){if(c.reason!=='killed')return;const r=1.5;b.fx('explode',{id:u.id,x:u.x,y:u.y,r,kind:'bloodWitch'});for(const target of areaAllies(b,u,u.x,u.y,r))hurt(b,u,target,u.s.atk*(T(ab,'boom.atk_scale')??2),'arts');},
}];
const alchemy = (ab, e) => [...nativeRoster(ab, e), { spawn(b, u) {
  // No alchemy launchers exist on Stronghold boards: retain native initial
  // matrix stacks; do not invent pickups, resource spending or a stage field.
  const stacks = T(ab, 'fireseedAbility.init_stack_cnt') || 0;
  if (stacks > 0) b.addBuff(u, { key: 'training:matrix', persist: true, mods: { atkFlat: stacks * (T(ab, 'fireseedAbility.atk') || 0),
    dmgTakenMul: 1 - Math.min(.9, stacks * (T(ab, 'fireseedAbility.damage_resistance') || 0)) } });
} }];
export const imperialSupport = ab => [{spawn(_b,e){e.profile.noAttack=true;}},skill(ab.sk.BringDown,(b,e)=>{
  const target=targets(b,e,2.5).find(u=>!u.findBuff('training:imperialWeak'));if(!target)return;
  b.addBuff(target,{key:'training:imperialWeak',duration:20,mods:{defPct:ab.sk.BringDown?.bb.def??-.5,resMul:1+(ab.sk.BringDown?.bb.magic_resistance??-.5)},visible:true});
  abilityAttackFx(b,e,target);abilityTargetFx(b,e,target,20);
  b.fx('beam',{id:e.id,from:e.id,to:target.id,kind:'imperialWeak'});
},{cd:25,icd:7,cond:(b,e)=>targets(b,e,2.5).some(u=>!u.findBuff('training:imperialWeak'))})];

export function trainingKits(baseKits,statsOnly={}) {
  return Object.fromEntries(TRAINING_ENEMY_KEYS.filter(key => !baseKits[key]&&!statsOnly[key]).map(key => {
    const family = key.replace(/_\d+$/, '');
    if (baseKits[family]) return [key, baseKits[family]];
    const fn = /^enemy_102(?:1[2-9]|20)_/.test(key) ? alchemy
      : key==='enemy_1115_embald' ? imperialSupport
      : /^enemy_1073_dscout/.test(key) ? sentinel
      : /^enemy_1074_dbskar/.test(key) ? standby
      : /^enemy_1089_ltlntc/.test(key) ? bloodWitch
      : /^enemy_(?:1080_sotidp|10125_uacomd)/.test(key) ? commander
      : /^enemy_106[123]_/.test(key) ? host : key === 'enemy_1020_obsv' ? scout : nativeRoster;
    return [key, fn];
  }));
}
