// shared/deviceId.js — **设备身份 token**:让"从没注册过"的玩家也有一个稳定账号。
//
// ## 为什么需要它 (owner 2026-10-17:「服务器排行榜和获赞还是不生效」→「都修」)
//
//   排行榜、获赞、档案上传、自定义头像授权 —— **四个功能全都挂在"账号"上**。
//   而先前的决定是「取消注册登录功能 默认用户名得了」,于是**没有任何人有账号**:
//   台账拿不到账号名 ⇒ 一条战绩都不记(排行榜恒空);档案存不上服务器;赞只能记在本地。
//
//   这个文件就是补上"身份"的那一环,**而且玩家侧什么都感觉不到** ——
//   他还是只填一个博士代号,不注册、不登录、不输密码。
//
// ## 怎么做到"零操作"
//
//   第一次用的时候生成一个随机 token 存进 localStorage,之后**每次连接都带上**。
//   服务端(`server/devices.js`)没见过这个 token 就替它建账号,见过就认回原账号。
//
// ## ⚠ 边界(要如实告诉 owner,不要包装成"账号系统")
//
//   · 这个 token **就是凭证**:谁拿到它谁就能冒充这个账号。强度等同于
//     "记住登录状态"的 cookie —— **不是密码**,没有第二因子。
//   · **清掉浏览器数据 / 换设备 / 换浏览器 ⇒ 变成新身份**,旧的战绩和赞留在旧账号上。
//     这是"零操作"必然的代价。要跨设备就得有真正的登录(那是另一个决定)。
//   · 隐私模式里 localStorage 会抛异常 ⇒ 这时**没有身份**(按游客玩),
//     而不是让整个连接失败 —— `read()` 会返回 null,`net.js` 就不发这个字段。
//
// ## 和"重连令牌"不是一回事
//
//   `hello.token` 是**断线重连令牌**(服务端会话级、几分钟就过期);
//   `hello.device` 是**长期身份**(几个月,存在玩家机器上)。两个别混。

/** localStorage 的键。 */
export const DEVICE_PREF = 'sp.device';

/** token 的长度范围(必须和 `server/devices.js` 的 `TOKEN_RE` 一致)。 */
const TOKEN_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** @param {unknown} v */
export const isDeviceToken = (v) => typeof v === 'string' && TOKEN_RE.test(v);

/**
 * 生成一个随机 token。
 *
 * 优先 `crypto.randomUUID()`(122 位随机,格式带 `-`,在允许字符集里);
 * 老环境退回 `crypto.getRandomValues`;再退回 `Math.random`(仍然够长,
 * 而且这里的目标是"不撞车",不是抗暴力破解 —— 真正的防线是服务端不把这个值给任何人)。
 *
 * @returns {string}
 */
function makeToken() {
  try {
    const c = globalThis.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    if (c && typeof c.getRandomValues === 'function') {
      const bytes = new Uint8Array(16);
      c.getRandomValues(bytes);
      return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch { /* 下面兜底 */ }
  let s = '';
  while (s.length < 32) s += Math.floor(Math.random() * 36 ** 6).toString(36);
  return s.slice(0, 32);
}

/** 读一个键;隐私模式下 localStorage 会抛,所以整段包起来。 */
function readPref(key) {
  try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; }
}
function writePref(key, value) {
  try { globalThis.localStorage?.setItem(key, value); return true; } catch { return false; }
}

/** 进程内缓存 —— localStorage 被禁用时也保证"这一次会话里是同一个值"。 */
let cached = null;
/** @type {null | (() => string|null)} 测试注入用(默认走 localStorage)。 */
let generator = null;

/**
 * 拿到这台设备的身份 token(没有就生成一个并存下来)。
 *
 * @param {{ fresh?: boolean }} [opts] `fresh` 强制换一个新的(测试 / "重置身份"用)
 * @returns {string|null} 取不到(没有可用的存储)时返回 null —— 调用方按游客处理
 */
export function deviceId({ fresh = false } = {}) {
  if (!fresh && cached && isDeviceToken(cached)) return cached;
  if (!fresh) {
    const stored = readPref(DEVICE_PREF);
    if (isDeviceToken(stored)) { cached = stored; return cached; }
  }
  const token = generator ? generator() : makeToken();
  if (!isDeviceToken(token)) return null;
  cached = token;
  writePref(DEVICE_PREF, token);
  return cached;
}

/**
 * 把服务端回的 token 记下来(正常情况下就是原样回显,不需要做什么)。
 *
 * ⚠ 存在的理由:如果客户端因为存储不可用而**没带** token,服务端不会替它建账号,
 *   也就不会回;而如果将来改成"服务端发 token",这条路径就是接入点。
 *   现在它只做一件事:**服务端回的 token 如果是合法的,就用它覆盖本地那份**
 *   (以服务端为准,避免本地那份被改坏之后一直用一个坏值)。
 *
 * @param {unknown} token
 * @returns {boolean} 是否采纳
 */
export function adoptDeviceId(token) {
  if (!isDeviceToken(token)) return false;
  cached = token;
  writePref(DEVICE_PREF, token);
  return true;
}

/** 清掉本地身份(下一次连接会拿到一个**新**账号;旧的战绩与赞不跟着走)。 */
export function forgetDeviceId() {
  cached = null;
  try { globalThis.localStorage?.removeItem(DEVICE_PREF); } catch { /* ignore */ }
}

/** 测试用:注入 token 生成器。 */
export function _setGenerator(fn) {
  generator = typeof fn === 'function' ? fn : null;
  cached = null;
}
