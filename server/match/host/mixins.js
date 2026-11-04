// server/match/host/mixins.js — 插件对局类的叠加层（2026-11-01，业主「肉鸽做成插件」）。
//
// 一个内容集的 Match 只有一个「种子」：`code.match` 里 reverse 顺序的第一个（server/plugins/contentSet.js），
// 对局宿主把它包成 `class ContentMatch extends Inner`（server/match/host/entry.js）。此前第二个插件没有任何办法
// 往这个类上加行为 —— 想加就只能整份替换，等于把种子 Match（mota 的整套引擎）顶掉。
//
// `code.matchMixin` 补上这一格：声明它的插件各出一个模块，导出 `Mixin`（一个类，只用原型方法、不必有构造逻辑），
// 叠加层把这些方法按插件加载顺序拷到对局类原型上：
//   · 顺序 = resolvePluginOrder（shared/plugins/order.js：priority 降序 + id，requires/loadAfter 已解析），
//     即「先加载者先叠」，后来的插件看不到也覆盖不了前面的方法；
//   · 重名**直接报错**：与 mota 自己的「a name defined twice is an error」同一规则，绝不静默覆盖 ——
//     静默覆盖正是这类「插件互相顶掉」事故的来源；
//   · 文件缺失只报错跳过该插件，不拖垮整个内容集；模块没有导出可构造的 `Mixin` 视为致命（内容集自身的错）。
//
// 与 `code.lobby`（server/plugins/lobbyModules.js，可累加的房间钩子）互补：那个管房间层，这个管对局类。

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * 把每个 mixin 模块的 `Mixin` 原型方法拷到 `MatchClass.prototype` 上。
 * @param {Function} MatchClass 对局类（种子 Match 或它的子类）
 * @param {{ id: string, root: string, path: string }[]} mixins 插件加载顺序的叠加层清单
 * @param {{ log?: { info: Function, error: Function } | null }} [opts]
 * @returns {Promise<string[]>} 实际叠上的插件 id（按顺序）
 */
export async function applyMatchMixins(MatchClass, mixins, { log = null } = {}) {
  if (typeof MatchClass !== 'function') throw new Error('applyMatchMixins needs a match class');
  const list = Array.isArray(mixins) ? mixins : [];
  if (!list.length) return [];
  const applied = [];
  for (const mx of list) {
    const rel = mx && typeof mx.path === 'string' ? mx.path : '';
    if (!mx || !mx.id || !mx.root || !rel) { log?.error?.(`[plugins] match mixin entry is malformed: ${JSON.stringify(mx)}`); continue; }
    const abs = path.join(mx.root, ...rel.split('/'));
    if (!fs.existsSync(abs)) { log?.error?.(`[plugins] match mixin missing: ${mx.id} ${rel}`); continue; }
    const mod = await import(pathToFileURL(abs).href);
    const Mixin = mod.Mixin || mod.default;
    if (typeof Mixin !== 'function' || !Mixin.prototype) throw new Error(`the match mixin module exports no Mixin (${mx.id})`);
    // 先整体查重再拷，避免「拷了一半才报错」留下半个叠加层
    const keys = Reflect.ownKeys(Mixin.prototype).filter((k) => k !== 'constructor');
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(MatchClass.prototype, key)) {
        throw new Error(`match mixin "${mx.id}" redefines ${String(key)} (a name defined twice is an error)`);
      }
    }
    for (const key of keys) Object.defineProperty(MatchClass.prototype, key, Object.getOwnPropertyDescriptor(Mixin.prototype, key));
    applied.push(mx.id);
  }
  return applied;
}
