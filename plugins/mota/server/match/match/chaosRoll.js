// server/match/match/chaosRoll.js — 混沌投掷 (this fork, 赌局系列：赌神！/ 赌王！/ 赌徒！)。
//
// `chaosRoll: { times, every }`（shared/hexes.js）：
//   · times   选中该海克斯时立即投几次（赌王 2 次，其余 1 次）
//   · every   > 0 时（赌神），此后每 `every` 个回合的部署阶段开始时再投一次（MatchPhases.startRound 调 chaosRoundStart）
//
// 掷 3d6，判定（隐藏规则，卡面只写「按点数获得奖励」）：
//   666 → 大吉大利：随机获得一个金色海克斯（池子与熔毁协议同一套过滤）
//   111 → 王不见王：层数最高的已激活盟约 +111 层（无激活盟约 → 改发随机 6 阶干员）
//   235 → 已完成！：随机获得 3 / 2 / 5 阶干员各 1 名
//   豹子（222/333/444/555）→ 大吉：主盟约（层数最高的已激活核心）的 6 阶干员 1 名（无主盟约 → 随机 6 阶）
//   顺子 123/234/345/456 → 吉：随机 5 阶道具 1 件
//   恰好两颗相同 → 小吉：10 资金 + 全体干员全属性 +2%（ps.hexAllStats，与王室宝库同一通道）
//   其余 → 散牌：8 资金 + 全属性 +1%
//
// 演出：结果写进 `ps.chaosEvent { seq, dice, key, word, reward, hex }` 并 markPrivate —— 客户端
// （public/js/ui/chaosRollOverlay.js）按 seq 幂等播放骰子动画，掷点本身永远由服务端算好下发。

import { createRng, deriveSeed } from '../../sim/rng.js';
import { HEXES, hexById } from '../../../shared/hexes.js';
import { convertAllStats } from '../../../shared/pierce.js';

/** 点数 → 判定键。纯函数，测试直接引用。 */
export function chaosJudge(dice) {
  if (!Array.isArray(dice) || dice.length !== 3) return 'none';
  const [a, b, c] = dice.map((n) => Math.trunc(Number(n)) || 0);
  const sorted = [a, b, c].sort((x, y) => x - y).join('');
  if (a === 6 && b === 6 && c === 6) return 'jackpot';
  if (a === 1 && b === 1 && c === 1) return 'kings';
  if (sorted === '235') return 'done';
  if (a === b && b === c) return 'great';
  if (sorted === '123' || sorted === '234' || sorted === '345' || sorted === '456') return 'good';
  if (a === b || b === c || a === c) return 'small';
  return 'none';
}

export const CHAOS_WORD = Object.freeze({
  jackpot: '【大吉大利】',
  kings: '【王不见王】',
  done: '【已完成！】',
  great: '大 吉',
  good: '吉',
  small: '小 吉',
  none: '散 牌',
});

const ROMAN = Object.freeze({ 1: 'I', 2: 'II', 3: 'III', 4: 'IV', 5: 'V', 6: 'VI' });
export const chaosRoman = (n) => ROMAN[Math.trunc(Number(n))] || String(n);

/** 3d6（用调用方给的 rng，保证可复现） */
function roll3d6(rng) {
  return [1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6), 1 + Math.floor(rng() * 6)];
}

export class MatchChaos {
  /**
   * 一次完整的混沌投掷：掷点 → 判定 → 发奖 → 写 `ps.chaosEvent` 并 markPrivate（客户端按 seq 播演出）。
   * @param {object} ps 玩家
   * @param {object} hex 触发投掷的那条海克斯记录（shared/hexes.js），用于文案
   * @returns {{dice:number[], key:string}} 本次的点数与判定
   */
  chaosRoll(ps, hex, forcedDice = null) {
    ps.chaosCount = (Number(ps.chaosCount) || 0) + 1;
    const rng = createRng(deriveSeed(this.seed, `chaos:${ps.seat}:${ps.chaosCount}`));
    // forcedDice 仅测试 / 工具用：指定三颗骰子的点数（跳过随机，判定与发放照常）
    const dice = Array.isArray(forcedDice) && forcedDice.length === 3
      ? forcedDice.map((n) => Math.max(1, Math.min(6, Math.trunc(Number(n)) || 1)))
      : roll3d6(rng);
    const key = chaosJudge(dice);
    const reward = this._chaosGrant(ps, key, dice, rng, hex);
    ps.chaosSeq = (Number(ps.chaosSeq) || 0) + 1;
    ps.chaosEvent = Object.freeze({
      seq: ps.chaosSeq,
      dice: dice.slice(),
      key,
      word: CHAOS_WORD[key] || key,
      reward: reward.text,
      ok: reward.ok !== false,
      hex: hex ? hex.name : '混沌投掷',
      roman: dice.map(chaosRoman),
    });
    this.markPrivate(ps);
    return { dice, key };
  }

  /**
   * 赌神的周期投掷：部署阶段开始时（MatchPhases.startRound）检查每条 `chaosRoll.every > 0` 的海克斯。
   * `ps.chaosNextRound` 在选中时（_hexApply）设为 `选中回合 + every`，此后每投一次 +every。
   * @param {object[]} players 存活玩家 @param {number} round 即将开始的回合
   */
  chaosRoundStart(players, round) {
    if (!Array.isArray(players)) return;
    for (const ps of players) {
      if (!ps || !ps.alive) continue;
      for (const h of this.hexAllOf(ps)) {
        const spec = h && h.chaosRoll;
        if (!spec || !(Number(spec.every) > 0)) continue;
        const every = Math.max(1, Math.trunc(Number(spec.every)));
        const next = Number.isInteger(ps.chaosNextRound) ? ps.chaosNextRound : round + every;
        if (round < next) continue;
        ps.chaosNextRound = next + every;
        this.chaosRoll(ps, h);
      }
    }
  }

  /** 层数最高的已激活核心盟约（大吉的「主盟约」口径，与熔毁协议的装备栏一致）。 */
  _chaosMainBond(ps) {
    let best = null;
    for (const [id, st] of Object.entries(ps.bonds || {})) {
      if (!st || !st.active) continue;
      const rec = this.gd.raw && this.gd.raw.bonds ? this.gd.raw.bonds[id] : null;
      if (!rec || !rec.isCore) continue;
      const layers = Number(st.layers ?? st.stacks ?? st.count ?? 0) || 0;
      if (!best || layers > best.layers) best = { id, layers, rec };
    }
    return best;
  }

  /** 层数最高的已激活盟约（王不见王的口径：不要求 isCore）。 */
  _chaosTopActiveBond(ps) {
    let best = null;
    for (const [id, st] of Object.entries(ps.bonds || {})) {
      if (!st || !st.active) continue;
      const layers = Number(st.layers ?? st.stacks ?? st.count ?? 0) || 0;
      if (!best || layers > best.layers) best = { id, layers };
    }
    return best;
  }

  /** 随机 6 阶干员（「精英化 6 阶」）。返回 {id, name} 或 null。 */
  _chaosRandomTier6(ps, salt, rng) {
    const pool = (this.gd.visibleChess || []).filter((cid) => {
      const rec = this.gd.chess(cid);
      return rec && Number(rec.tier) === 6;
    });
    const id = this._hexPickChess(pool, `chaos6:${salt}`, rng);
    if (!id) return null;
    return { id, name: this.gd.chess(id)?.name || id };
  }

  /**
   * 发奖。@returns {{text:string, ok:boolean}} 奖励描述（进 chaosEvent.reward）
   */
  _chaosGrant(ps, key, dice, rng, hex) {
    const who = hex ? hex.name : '混沌投掷';
    switch (key) {
      case 'great':
      case 'kings_fallback': {
        const main = this._chaosMainBond(ps);
        let got = null;
        if (main) {
          const id = this._hexPickChess(this.hexBondChess(main.id, { tier: 6 }), `chaosMain:${ps.seat}:${ps.chaosCount}`, rng);
          if (id) got = { id, name: this.gd.chess(id)?.name || id };
        }
        if (!got) got = this._chaosRandomTier6(ps, `${ps.seat}:${ps.chaosCount}`, rng);
        if (!got) {
          this.toast(ps, 'warn', `${who}：当前没有可发放的 6 阶干员`);
          return { text: '当前没有可发放的 6 阶干员', ok: false };
        }
        if (ps.acquireChess(got.id, { source: 'grant' })) {
          this.toast(ps, 'info', `${who} · 获得 6 阶干员 ${got.name}`);
          const bondName = main ? this.gd.bond(main.id)?.name : null;
          return { text: bondName ? `获得 1 名精英化 6 阶【${bondName}】干员` : '获得 1 名随机 6 阶干员' };
        }
        this.toast(ps, 'warn', `${who}：整备区已满，${got.name} 未获得`);
        return { text: '整备区已满，干员未获得', ok: false };
      }

      case 'kings': {
        const top = this._chaosTopActiveBond(ps);
        if (top) {
          const bondName = this.gd.bond(top.id)?.name || top.id;
          ps.addLayers(top.id, 111, { requireActive: false, reason: 'chaos' });
          this.toast(ps, 'info', `${who} · 【${bondName}】盟约 +111 层`);
          return { text: `你已经激活的【${bondName}】盟约 +111 层` };
        }
        // 无激活盟约：改发随机 6 阶干员（与用户规则一致）
        return this._chaosGrant(ps, 'kings_fallback', dice, rng, hex);
      }

      case 'good': {
        const items = Object.values((this.gd.raw && this.gd.raw.items) || {}).filter((r) => r && Number(r.tier) === 5);
        const rec = items.length ? items[Math.floor(rng() * items.length)] : null;
        if (!rec) {
          this.toast(ps, 'warn', `${who}：当前没有 5 阶道具`);
          return { text: '当前没有可发放的 5 阶道具', ok: false };
        }
        if (ps.acquireItem(rec.id, { source: 'grant' })) {
          this.toast(ps, 'info', `${who} · 获得 5 阶道具 ${rec.name}`);
          return { text: `获得 1 件 5 阶道具【${rec.name}】` };
        }
        this.toast(ps, 'warn', `${who}：整备区已满，${rec.name} 未获得`);
        return { text: '整备区已满，道具未获得', ok: false };
      }

      case 'small':
      case 'none': {
        const funds = key === 'small' ? 10 : 8;
        const pct = key === 'small' ? 0.02 : 0.01;
        const got = ps.addFunds(funds, { reason: 'chaos' });
        // 平衡调整 (v0.05)：全属性提升里取出 25% 按 R=50 折成「全能穿透」（与王室宝库同一条通道）
        const split = convertAllStats({ allPct: pct * 100 });
        ps.hexAllStats = Math.round(((Number(ps.hexAllStats) || 0) + split.kept / 100) * 1e6) / 1e6;
        if (split.pierce > 0) ps.hexAllStatsPierce = Math.round(((Number(ps.hexAllStatsPierce) || 0) + split.pierce) * 100) / 100;
        this.toast(ps, 'info', `${who} · 获得 ${got} 资金 · 全体干员全属性 +${split.kept}%、全能穿透 +${split.pierce}%`);
        return { text: `获得 ${got} 资金 · 全体干员全属性 +${split.kept}%、全能穿透 +${split.pierce}%` };
      }

      case 'done': {
        const names = [];
        for (const tier of [3, 2, 5]) {
          const pool = (this.gd.visibleChess || []).filter((cid) => {
            const rec = this.gd.chess(cid);
            return rec && Number(rec.tier) === tier;
          });
          const id = this._hexPickChess(pool, `chaos325:${ps.seat}:${tier}:${ps.chaosCount}`, rng);
          if (id && ps.acquireChess(id, { source: 'grant' })) names.push(this.gd.chess(id)?.name || id);
        }
        if (names.length) this.toast(ps, 'info', `${who} · 获得 ${names.join('、')}`);
        else this.toast(ps, 'warn', `${who}：没有可发放的干员`);
        return { text: names.length ? `获得 3 阶 · 2 阶 · 5 阶干员各 1 名` : '没有可发放的干员', ok: names.length > 0 };
      }

      case 'jackpot': {
        // 金色海克斯：池子与熔毁协议同一套过滤（战斗类 / 排除天选·盟约专属·增援·凭证·联机专属），
        // 再排除混沌类自己（防 666 连环投掷）与命运（bonusHex，防连环）与首草案限定。
        const mode = this.isSolo ? 'solo' : 'coop';
        const owned = new Set(this.hexPicks(ps));
        const pool = HEXES.filter((h) => h
          && h.grade === 'gold'
          && String(h.category || '').toLowerCase() === 'combat'
          && !h.chaosRoll && !h.bonusHex && !h.firstDraftOnly && !h.pendingHook
          && !/^(tianxuan_|bx_)/.test(h.id)
          && !/增援|凭证|天选/.test(h.name)
          && !(h.requires && h.requires.mode && h.requires.mode !== mode)
          && !owned.has(h.id));
        const rec = pool.length ? pool[Math.floor(rng() * pool.length)] : null;
        if (!rec) {
          const got = ps.addFunds(15, { reason: 'chaos' });
          this.toast(ps, 'warn', `${who}：当前没有可获得的金色海克斯，改发 ${got} 资金`);
          return { text: '没有可获得的金色海克斯，改发 15 资金', ok: false };
        }
        ps.hexes.push(rec.id);        // 与命运（bonusHex）同形：先进 ps.hexes，被动钩子才读得到
        this._hexApply(ps, rec.id);   // 走标准发放：效果栏徽章 + 立即结算类一样不少
        this.toast(ps, 'info', `${who} · 大吉大利！获得金色海克斯【${rec.name}】`);
        return { text: `随机获得 1 个金色海克斯【${rec.name}】` };
      }

      default:
        return { text: '', ok: false };
    }
  }
}
