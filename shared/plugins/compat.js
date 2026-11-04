// shared/plugins/compat.js — mod 兼容判定（纯函数，无 IO）
//
// (i18n-ignore-file: the compatibility reasons are author-facing and bilingual by design, 中文 · English — as
// shared/plugins/errors.js and server/plugins/forgeImport.js; never player UI)
//
// 为什么单独一层：Forge 工坊包的 pack.json 可以声明 `gameVersion` / `game` / `api`，manifest 2 插件声明
// `app` / `api`。在此之前的导入器把 pack.json 的三个版本字段当作「已知字段」直接跳过，产物又硬写
// `app: '>=0.3.0 <0.4.0'`、`api: 1` —— 于是「这个 mod 原本面向哪个版本」在导入报告里完全消失。
//
// 这里只做判定，不改变导入行为：Forge 包仍然由 importForge 转换，manifest 2 插件仍由 install 校验。
// 判定结果给导入报告与 /mod 返回用，让「装得上」和「玩法是否完整」分开表达。
//
// [ASSUMED] 状态口径：
//   supported    —— 声明范围覆盖当前版本；
//   convertible  —— 声明范围不覆盖，但导入器会按现有映射转换（Forge 包）；
//   incompatible —— manifest 2 插件的 api 超出本安装，或 app 不覆盖（启用会被拒绝）；
//   unknown      —— 没有声明，或声明不是可解析的版本范围。

import { APP_VERSION, PLUGIN_API } from '../constants.js';
import { appVersionMatches, isVersionRange } from './manifest.js';

export const COMPAT_STATUS = Object.freeze({
  SUPPORTED: 'supported',
  CONVERTIBLE: 'convertible',
  INCOMPATIBLE: 'incompatible',
  UNKNOWN: 'unknown',
});

/**
 * 本安装（核心 + 管理器这一侧）**实际提供**的插件能力面。插件用 manifest 2 的 capabilities 声明它需要哪些，
 * 管理器据此判定「装了能不能用」——插件不需要知道核心版本，只需要声明能力；版本差异由这里吸收。
 *
 * 增加一项能力 = 在这个集合里加一行；核心回退到不认识某项能力的版本时，对应行删掉即可，插件不用改。
 */
export const CORE_CAPABILITIES = Object.freeze(new Set([
  'code.match',        // 宿主按插件给的入口加载 Match（contentSet → 宿主 init options）
  'code.matchMixin',   // 对局类叠加层：code.matchMixin 模块的 Mixin 方法拷到种子 Match 原型上（2026-11-01）
  'code.client',       // 插件 client/** 按同路径顶替页面资源
  'code.data',         // 插件 data/config.json 覆盖内容集配置
  'code.lobby',        // lobby 级插件面（server/plugins/lobbyModules.js）
  'code.static',       // 静态层工厂（server/plugins/staticModules.js，素材门牌）
  'protocol.extend',   // api.protocol() 新增 C2S 键
  'room.option.variant',   // room.create 的 variant（玩法规则集）
  'room.option.teamSize',  // room.create 的 teamSize（分边人数）
  'csp.sources',       // CSP 放行插件声明的素材源
  'trusted.http',      // trusted 子进程的 /x/<id>/ HTTP 路由（server/plugins/trustedEntry.js）
]));

/**
 * 插件声明的能力里，本安装缺哪些。空数组 = 齐了。
 * @param {any} plugin 解析后的 plugin.json
 * @returns {string[]}
 */
export function missingCapabilities(plugin, offered = CORE_CAPABILITIES) {
  const list = Array.isArray(plugin?.needs) ? plugin.needs.filter((c) => typeof c === 'string' && c) : [];
  return list.filter((c) => !offered.has(c));
}

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const reason = (code, zh, en) => ({ code, zh, en });
/** @param {{ current: number, min: number }} [api] */
const levels = (api = PLUGIN_API) => ({ current: Number(api?.current), min: Number(api?.min) });

/** The 0.3.x-only top-level fields a pack can carry, or '' when it carries none. */
function newerSurface(pack) {
  if (!pack || typeof pack !== 'object') return '';
  if (Array.isArray(pack.server?.modules) && pack.server.modules.length) return 'server.modules';
  if (pack.matchKinds != null) return 'matchKinds';
  if (pack.serverModules != null) return 'serverModules';
  return '';
}

/**
 * The compatibility of a Forge workshop pack (`pack.json`) against this build.
 * @param {any} pack parsed pack.json
 * @param {{ app?: string, api?: { current: number, min: number } }} [opts]
 * @returns {{ kind: 'forge-pack', status: string, target: string, declared: { gameVersion: string, game: string, api: string }, reasons?: { code: string, zh: string, en: string }[] }}
 */
export function packCompatibility(pack, { app = APP_VERSION, api = PLUGIN_API } = {}) {
  const declared = {
    gameVersion: text(pack?.gameVersion),
    game: text(pack?.game),
    api: text(pack?.api),
  };
  const range = declared.gameVersion || declared.game;
  const { current, min } = levels(api);
  const reasons = [];
  let status;

  if (!range) {
    status = COMPAT_STATUS.UNKNOWN;
    reasons.push(reason('NO_GAME_RANGE',
      '包没有声明 gameVersion / game，无法判断它面向哪个游戏版本。',
      'The pack declares neither gameVersion nor game, so its target version is unknown.'));
  } else if (!isVersionRange(range)) {
    status = COMPAT_STATUS.UNKNOWN;
    reasons.push(reason('BAD_GAME_RANGE',
      `gameVersion / game「${range.slice(0, 60)}」不是可解析的版本范围。`,
      `gameVersion / game "${range.slice(0, 60)}" is not a readable version range.`));
  } else if (appVersionMatches(range, app)) {
    status = COMPAT_STATUS.SUPPORTED;
  } else {
    status = COMPAT_STATUS.CONVERTIBLE;
    reasons.push(reason('GAME_RANGE_MISMATCH',
      `包声明面向 ${range}，当前是 ${app}；导入器会按现有映射转换，装好后需要验收玩法是否完整。`,
      `The pack targets ${range}; this build is ${app}. The importer converts what it can — check the gameplay after installing.`));
  }

  if (declared.api) {
    const parsed = isVersionRange(declared.api);
    const covered = parsed ? appVersionMatches(declared.api, `${current}.0.0`) : false;
    if (!parsed) {
      reasons.push(reason('BAD_API_RANGE',
        `包声明 api「${declared.api.slice(0, 60)}」不是可解析的版本范围。`,
        `The pack declares api "${declared.api.slice(0, 60)}", which is not a readable version range.`));
    } else if (!covered) {
      if (status === COMPAT_STATUS.SUPPORTED) status = COMPAT_STATUS.CONVERTIBLE;
      reasons.push(reason('API_RANGE_MISMATCH',
        `包声明 api ${declared.api}，当前插件 API 是 ${min}–${current}；导入器仍会转换，但该声明未被满足。`,
        `The pack declares api ${declared.api}; this build supports ${min}–${current}. The importer still converts it, but the declaration is not met.`));
    }
  }

  const newer = newerSurface(pack);
  if (newer && status !== COMPAT_STATUS.SUPPORTED) {
    reasons.push(reason('USES_NEWER_SURFACE',
      `包使用了 ${newer} 这类新版本字段，与它声明的 ${range || '（未声明）'} 不一致；按新版本行为验收。`,
      `The pack uses ${newer}, which belongs to a newer build than its declared ${range || '(none)'}. Verify it against the newer behavior.`));
  }

  return { kind: 'forge-pack', status, target: app, declared, ...(reasons.length ? { reasons } : {}) };
}

/**
 * The compatibility of a manifest-2 plugin (`plugin.json`) against this build.
 * @param {any} plugin parsed plugin.json
 * @param {{ app?: string, api?: { current: number, min: number } }} [opts]
 */
export function pluginCompatibility(plugin, { app = APP_VERSION, api = PLUGIN_API } = {}) {
  const declared = {
    app: text(plugin?.app),
    api: plugin?.api == null ? '' : String(plugin.api),
  };
  const { current, min } = levels(api);
  const level = Number(plugin?.api);
  const reasons = [];
  let status;

  if (plugin?.api == null && plugin?.class === 'lang') {
    // A lang pack carries no gameplay API level; report it as unknown rather than incompatible.
    status = COMPAT_STATUS.UNKNOWN;
    reasons.push(reason('NO_API_LANG',
      '语言包没有声明 api；语言包不参与玩法装载。',
      'The language pack declares no api; language packs do not take part in gameplay loading.'));
  } else if (!Number.isInteger(level) || level < min || level > current) {
    status = COMPAT_STATUS.INCOMPATIBLE;
    reasons.push(reason('API_UNSUPPORTED',
      `插件 api ${declared.api || '（缺失）'} 不在本安装支持的 ${min}–${current} 内。`,
      `The plugin api ${declared.api || '(missing)'} is outside ${min}–${current}.`));
  } else if (!declared.app) {
    status = COMPAT_STATUS.UNKNOWN;
    reasons.push(reason('NO_APP_RANGE',
      '插件没有声明 app 版本范围。',
      'The plugin declares no app range.'));
  } else if (!isVersionRange(declared.app)) {
    status = COMPAT_STATUS.UNKNOWN;
    reasons.push(reason('BAD_APP_RANGE',
      `app「${declared.app.slice(0, 60)}」不是可解析的版本范围。`,
      `app "${declared.app.slice(0, 60)}" is not a readable version range.`));
  } else if (!appVersionMatches(declared.app, app)) {
    status = COMPAT_STATUS.INCOMPATIBLE;
    reasons.push(reason('APP_MISMATCH',
      `插件声明面向 ${declared.app}，当前是 ${app}；装载只警告，启用会被拒绝（除非 allowIncompatible）。`,
      `The plugin targets ${declared.app}; this build is ${app}. It loads with a warning, and enabling is refused unless allowIncompatible.`));
  } else {
    status = COMPAT_STATUS.SUPPORTED;
  }

  // 能力面判定：插件只声明「我要什么能力」，核心版本差异由 CORE_CAPABILITIES 吸收，
  // 缺项就提前报不可用 —— 而不是装完在运行时静默失效（这正是 0.3.3 迁移里踩过的坑）。
  const missing = missingCapabilities(plugin);
  if (missing.length) {
    status = COMPAT_STATUS.INCOMPATIBLE;
    const zh = `本安装缺少插件需要的能力：${missing.join('、')}（装得上但用不了）。`;
    const en = `This build lacks: ${missing.join(', ')} (it installs but cannot work).`;
    reasons.push(reason('CAPABILITY_MISSING', zh, en));
  }

  return {
    kind: 'plugin', status, target: app, declared,
    ...(missing.length ? { missing } : {}),
    ...(reasons.length ? { reasons } : {}),
  };
}

/** The one-line human summary used by reports. */
export function compatSummary(compat) {
  if (!compat) return '';
  const d = compat.declared || {};
  const declared = [d.gameVersion && `gameVersion=${d.gameVersion}`, d.game && `game=${d.game}`, d.app && `app=${d.app}`, d.api && `api=${d.api}`]
    .filter(Boolean).join(' ');
  return `${compat.status} (target ${compat.target}${declared ? `; declared ${declared}` : ''})`;
}
