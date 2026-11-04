// shared/bossRounds.js —— **"这一轮是不是首领战/隐秘核心"的共用判据**。
//
// ## 为什么必须共用一份
//
//   「合同」集(延长线 / 防火地带 / 新战线)会让整局有 **3~4 场**首领战,插在延长局中间:
//
//     延长线    bossRounds=[10, 16]
//     防火地带  bossRounds=[8, 14, 18]
//     新战线    bossRounds=[8, 14, 18, 19]
//
//   而 `m.public.bossRound` 是**最后一场**那个回合号(16 / 18 / 19)——
//   于是任何"只跟 `bossRound` 比相等"的判据,在**中间那几场**上全都判错。
//
//   实测就踩到了这个(owner:「合约提前首领轮:场地不切换 + 休息期看不见 boss」):
//
//     public/js/ui/gameLogic/camera.js
//       if (!(r === pub.bossRound || r === pub.hiddenRound)) return normal;   // ← R8 / R10 判成普通轮
//
//   于是那一轮的休息期**用普通棋盘取景**、预览里也**没有 boss**。
//
//   服务端一直是对的(`gamedata.isBossRound` / `bossRoundList` 会查合约的完整列表),
//   错的只有客户端那几处手写的比较。把它们统一到这个模块,两边就不会再漂。
//
// ## 服务端与客户端的输入不同,所以给两个入口
//
//   · `isBossRoundAt(gd, r)`  —— 服务端:`GameData` 上有完整的合约信息
//   · `isBossRoundIn(pub, r)` —— 客户端:`m.public` 里有服务端算好的 `bossSchedule`
//
//   两者的判据**在语义上必须一致**(都是"这一轮在首领列表里,或者是隐秘核心那一轮"),
//   所以放在同一个文件里,改动时一眼能看见另一个。

/**
 * 服务端:这一轮是不是首领战(普通首领轮或隐秘核心)。
 *
 * ⚠⚠ **必须把隐秘核心那一轮也算进来。**
 *
 *   `gd.isBossRound(r)` 查的是合约的 `bossRounds` 列表 —— 那份列表**只有普通首领战**,
 *   核心是打完最后一场之后额外接上的一轮,不在里面。所以 `gd.isBossRound(hiddenRound)`
 *   返回 **false**,只用它就会把核心轮判成普通回合(休息期用普通棋盘取景、预览里看不到核心 boss)。
 *
 *   `phases.js startRound` 里那句就是这么补的:
 *       const isHidden = hiddenRound != null && r === hiddenRound && r !== gd.bossRound;
 *       const isBoss = gd.isBossRound(r) || isHidden;
 *   这里把它固化下来,免得每个调用方各补一遍(补漏一处就是 owner 报的那个 bug)。
 *
 * @param {any} gd GameData
 * @param {number} r 回合号
 * @returns {boolean}
 */
export function isBossRoundAt(gd, r) {
  const round = Number(r);
  if (!gd || !Number.isInteger(round) || round <= 0) return false;
  /* 核心轮:单独判,`isBossRound` 不认它 */
  if (gd.hiddenRound != null && round === gd.hiddenRound) return true;
  if (typeof gd.isBossRound === 'function') return !!gd.isBossRound(round);
  if (typeof gd.bossRoundList === 'function') {
    const list = gd.bossRoundList();
    if (Array.isArray(list) && list.length) return list.includes(round);
  }
  return round === gd.bossRound;
}

/**
 * 客户端:这一轮是不是首领战(普通首领轮或隐秘核心),只看 `m.public`。
 *
 * ⚠ **判据是 `pub.bossSchedule`(所有首领轮),不是 `pub.bossRound`(只有最后一场)。**
 *   这正是那几个 bug 的根源;`bossSchedule` 缺省(老服务端 / 还没开对局)时,
 *   退回"单场模式"的老判据 —— 那种情况下它恰好是对的(整局只有一场首领)。
 *
 * @param {any} pub m.public
 * @param {number} r 回合号
 * @returns {boolean}
 */
export function isBossRoundIn(pub, r) {
  const round = Number(r);
  if (!Number.isInteger(round) || round <= 0) return false;
  if (pub && pub.hiddenRound != null && round === pub.hiddenRound) return true;
  const schedule = pub && Array.isArray(pub.bossSchedule) ? pub.bossSchedule : null;
  if (schedule && schedule.length) {
    return schedule.some((x) => x && Number(x.round) === round);
  }
  /* 老服务端 / 单场模式:整局只有一场首领,直接比就等于查列表 */
  return !!pub && round === pub.bossRound;
}

/**
 * 客户端:这一轮是**隐秘核心**吗(和普通首领轮分开,取景/难度修正不同)。
 * @param {any} pub m.public
 * @param {number} r
 */
export function isHiddenRoundIn(pub, r) {
  const round = Number(r);
  if (!Number.isInteger(round) || round <= 0) return false;
  return !!pub && pub.hiddenRound != null && round === pub.hiddenRound;
}

/**
 * 客户端:这一轮的 bossId(普通首领轮从 `bossSchedule` 取,没有就退回 `pub.bossId`)。
 * @param {any} pub m.public
 * @param {number} r
 * @returns {string|null}
 */
export function bossIdAtRound(pub, r) {
  const round = Number(r);
  if (!Number.isInteger(round) || round <= 0) return null;
  if (pub && round === pub.hiddenRound && round !== pub.bossRound && typeof pub.hiddenBossId === 'string' && pub.hiddenBossId) return pub.hiddenBossId;
  const schedule = pub && Array.isArray(pub.bossSchedule) ? pub.bossSchedule : null;
  if (schedule) {
    const hit = schedule.find((x) => x && Number(x.round) === round);
    if (hit && typeof hit.bossId === 'string' && hit.bossId) return hit.bossId;
  }
  return (pub && typeof pub.bossId === 'string') ? pub.bossId : null;
}
