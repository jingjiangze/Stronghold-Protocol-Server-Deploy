// shared/mapCharSpot.js —— 联盟约地图角色(<预备干员-医疗> / <Touch>)该站在哪一格。
//
// 两处必须用**同一套规则**,所以放在 shared/:
//   · 战斗侧   server/sim/content/tokens.js   `spawnMapChar`  —— 开战那一刻真的把人放上场
//   · 整备期   server/match/match/views.js   `prepMapChars`  —— 开战前客户端画的那只(只读、可点开看)
// 两边一旦不一致,玩家看到的就是"整备期站在这儿,开打跑到别处"。
//
// ## 规则(owner 2026-10-17:「让 touch/预备医疗干员优先部署在蓝门上一格的位置,让联防也生效」)
//
//   **蓝门 = `tile_end`('E')** —— 就是「保护目标」那一格。名字出处:客户端
//   `public/js/ui/gameLogic/terrain.js` 的 `end: { name: '蓝门', tag: '保护目标' }`。
//   **「上一格」= 行号 +1** —— `public/js/render/projection.js` 的约定是 `row 0 = bottom`
//   (行号越大,屏幕上越高、离相机越远),所以"上一格"就是 `row + 1`,列不变。
//
// ## 为什么用这条规则,而不是照抄官方 `mapChars` 固定格
//
//   · 官方固定格只在**普通 / 首领**那 8 张图里有(每张图 4 个);**联防的两张图 `mapChars` 是空的** ——
//     所以联防阶段这只单位从来没出现过(owner 报的就是这个:「让联防也生效」)。
//   · 实测 10 张图(8 张普通 + 2 张联防)的"蓝门上一格"**全都是 `# tile_forbidden`**:不可部署、
//     地面敌人也走不到 —— 与官方固定格**同一类**。也就是说这条规则在现有全部地图上与官方固定格重合
//     (普通场地 (10,2)、首领场地 (3,2)),只是它不再依赖那张表,联防图也照样成立。
//   · 换成人工改过的图(社区地图包、以后的新图)会自动跟着新的蓝门走,不需要再补数据。
//
// 本模块是**纯函数**:只读 `stage.rows`,不碰 sim 的 grid —— 整备期(那会儿还没有战斗、没有 grid)也能算。

/**
 * 蓝门上一格的候选格,按 `prefer` 排序后返回。
 *
 * @param {{ rows?: string[] } | null | undefined} stage data/stages.json 的一条(或战斗里 `battle.stage`)
 * @param {(pos: [number, number]) => boolean} [prefer] true = 这一格属于"自己这半场",排在前面
 * @returns {Array<[number, number]>} `[[row, col], …]`,行号已经 +1(即"蓝门上一格"本身)
 */
export function gateAboveTiles(stage, prefer = null) {
  const rows = Array.isArray(stage?.rows) ? stage.rows : [];
  const out = [];
  // 最后一行没有"上一格",所以扫到 rows.length - 1 为止
  for (let r = 0; r < rows.length - 1; r++) {
    const line = String(rows[r] ?? '');
    for (let c = 0; c < line.length; c++) {
      if (line[c] === 'E') out.push([r + 1, c]);
    }
  }
  /* 排序必须确定性:自己半场优先 → 行 → 列。地图角色有好几只候选(左半场 / 右半场 / 首领半场)。 */
  out.sort((a, b) => (prefer ? (prefer(a) ? 0 : 1) - (prefer(b) ? 0 : 1) : 0) || a[0] - b[0] || a[1] - b[1]);
  return out;
}

export default gateAboveTiles;
