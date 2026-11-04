#!/usr/bin/env node
// tools/check-plugin-tracked.mjs —— 守卫：每个插件 `plugin.lock.json` 里列的文件，**必须**被 git 跟踪。
//
// 为什么需要它：`plugins/` 在 .gitignore 里（历史原因，插件内容仍作为已跟踪文件随仓库发布）。于是
// **新加**的插件文件会被普通 `git add` 静默跳过 —— 本地一切正常（磁盘有文件），推上去的树却没有它，
// 容器里插件 import 失败 → 整个插件被判无效 → 它的 client 覆盖层全部回落 vanilla。
// 2026-10-27 就是这样：`plugins/mota/server/match/match/pureShares.js` 没进 git，线上 mota 被禁用。
//
// 用法：node tools/check-plugin-tracked.mjs   （退出码 1 = 有漏跟踪文件）
// 建议在 `git push` 前跑一次；CI 也可跑（插件文件在仓库里是被跟踪的）。
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const pluginsDir = path.join(root, 'plugins');
const tracked = new Set(
  execFileSync('git', ['ls-files', '-z', 'plugins'], { cwd: root, maxBuffer: 1 << 28 })
    .toString('utf8').split('\0').filter(Boolean),
);

let missing = 0;
let checked = 0;
for (const id of fs.readdirSync(pluginsDir)) {
  const lockPath = path.join(pluginsDir, id, 'plugin.lock.json');
  if (!fs.existsSync(lockPath)) continue;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  for (const rel of Object.keys(lock.files || {})) {
    checked += 1;
    const repoRel = `plugins/${id}/${rel}`;
    if (!tracked.has(repoRel)) {
      missing += 1;
      console.log(`未跟踪  ${repoRel}`);
    }
  }
}
// 反向：已跟踪但锁里没有的（pack 之后新加的文件 —— 同样会让 pin/锁不一致）
let unstaged = 0;
for (const id of fs.readdirSync(pluginsDir)) {
  const lockPath = path.join(pluginsDir, id, 'plugin.lock.json');
  if (!fs.existsSync(lockPath)) continue;
  const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
  const prefix = `plugins/${id}/`;
  for (const rel of tracked) {
    if (!rel.startsWith(prefix)) continue;
    const sub = rel.slice(prefix.length);
    if (sub === 'plugin.lock.json' || sub === 'plugin.json') continue;
    if (!Object.hasOwn(lock.files || {}, sub)) { unstaged += 1; console.log(`不在锁里  ${rel}`); }
  }
}

console.log(`check-plugin-tracked: 核对 ${checked} 条锁条目；未跟踪 ${missing}；未入锁 ${unstaged}`);
if (missing || unstaged) {
  console.log('处置：git add -f <路径>（plugins/ 被 .gitignore 忽略，新文件必须 -f），必要时 node tools/plugin.mjs pack <id> 重打包并刷新信任钉。');
  process.exit(1);
}
