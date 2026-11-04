// shared/avatars.js — **自定义头像**(本分叉自己的功能, 上游没有)。
//
// ## 背景:原来头像只能是"干员立绘"
//
//   个人档案里的头像是个 `chessId`,由 `ui/assetUrls.js avatarSrc()` 拿去 `data/assets.json`
//   的 `chars[...].avatar` 里查一张官方立绘。**没有任何办法用一张自己带来的图**。
//
//   owner 2026-10-15 要求把「Q版黄发帽」当头像,**并且"只有我能用"** —— 于是有了这个模块。
//
// ## 设计
//
//   * 头像的**存储 id** 带前缀:`custom:<key>`,例如 `custom:hat`。
//     用前缀而不是裸 id,是为了**和官方的 chessId 永不冲突**
//     (官方 id 形如 `chess_char_6_13_a`,但"永不冲突"不该依赖对方的命名习惯)。
//   * 「谁能用」由服务端读 `data/avatar-registry.json` 决定,并按账号过滤后**只把该看到的发下去**
//     (`s.avatars` 帧)。客户端拿到的就是一份"我能选的头像"清单,不需要自己判权限。
//   * 图片走 `/data/avatars/<file>` —— `data/` 本来就是静态挂载(`server/http/static.js`),
//     所以**不用新增任何路由**。图片是公开可读的:头像本来就要展示给房间里的所有人看。
//
// ## ⚠ 为什么"只把该看到的发下去"而不是"发全量 + 客户端过滤"
//
//   客户端过滤 = 任何人改一下前端就能选中并显示出别人的专属头像。owner 要的是"只有我能用",
//   所以**权限必须在服务端**,而且清单本身就按权限裁剪 —— 别人连这个 id 都看不到。

/** 存储 id 的前缀。`parseAvatarId` 之外的任何地方都别自己拼。 */
export const CUSTOM_AVATAR_PREFIX = 'custom:';

/** 图片的静态前缀(`data/` 挂载 → 这个路径直接可取)。 */
export const CUSTOM_AVATAR_URL_BASE = '/data/avatars/';

/**
 * 一个自定义头像的存储 id。
 * @param {string} key 登记表里的 `id`(不含前缀)
 * @returns {string}
 */
export const avatarIdOf = (key) => `${CUSTOM_AVATAR_PREFIX}${key}`;

/**
 * 拆一个存储 id。**只认自己发出去的那种 id**,别的一律 null(官方 chessId 会走到这里)。
 *
 * @param {unknown} id
 * @returns {{ key: string } | null}
 */
export function parseAvatarId(id) {
  if (typeof id !== 'string' || !id.startsWith(CUSTOM_AVATAR_PREFIX)) return null;
  const key = id.slice(CUSTOM_AVATAR_PREFIX.length);
  /* `u/<账号名>` 是**玩家自己上传的那张**(见下面 uploadAvatarPath 的说明) */
  if (key.startsWith(UPLOAD_KEY_PREFIX)) {
    const k = key.slice(UPLOAD_KEY_PREFIX.length);
    const parts = k.split('/');
    if (parts.length === 2 && isSafeUploadKey(parts[0]) && /^[a-f0-9]{16}$/.test(parts[1])) return { key, upload: true, owner: parts[0], revision: parts[1] };
    return isSafeUploadKey(k) ? { key, upload: true, owner: k } : null;
  }
  /* key 只允许 [a-z0-9_-]:它会被拼进 URL,不能让它带 `/` 或 `..` */
  return /^[a-z0-9][a-z0-9_-]{0,31}$/.test(key) ? { key, upload: false, owner: null } : null;
}

/*
 * ── 玩家上传的那一张 (owner 2026-10-15:「做在个人档案里(每个玩家都能传自己的)」) ────────────────
 *
 * key 的形状是 `u/<账号名>`,例如 `custom:u/alice`。
 *
 * ⚠ **为什么 key 里带账号名,而不是一个随机 id**
 *
 *   因为"这张图是谁的"必须**能从 id 自己看出来**。这样:
 *     · 服务端写文件、判权限,都只认 `session.account` 与自己这个 key 是否一致 ——
 *       不需要另一张"id → 主人"的表,也就不会出现两张表对不上的情况;
 *     · 别的玩家看到 `custom:u/alice` 时,取图路径直接就是 `/data/avatars/u/alice.png`,
 *       **不需要把 URL 发给任何人**(头像要在房间里被所有人看到,这一点很关键)。
 *
 * ⚠ **`u/` 这个分隔的选择很讲究**:`isSafeUploadKey` 只允许 `[a-z0-9_-]`,**不含 `/`** ——
 *   所以"账号名里再插一个 `/`"这类路径穿越从根上不成立(不是靠转义,是靠字符集)。
 *   账号名本身在 `server/accounts.js cleanAccountName` 已经限过一次,这里是第二道。
 */
export const UPLOAD_KEY_PREFIX = 'u/';

/** 上传头像的账号名部分:只允许 `[a-z0-9_-]`,长度 1~32(路径穿越在这里被挡死)。 */
export const isSafeUploadKey = (k) => typeof k === 'string' && /^[a-z0-9][a-z0-9_-]{0,31}$/.test(k);

/** 一个"玩家自己上传的头像"的存储 id。 */
export const uploadedAvatarId = (account, revision = null) => `${CUSTOM_AVATAR_PREFIX}${UPLOAD_KEY_PREFIX}${account}${revision ? '/'+revision : ''}`;

/** 上传头像的图片路径(服务端写文件 / 客户端取图都是它)。 */
export const uploadAvatarPath = (account) => `${CUSTOM_AVATAR_URL_BASE}${UPLOAD_KEY_PREFIX}${account}.png`;

/**
 * 登记表里的一条 → 客户端用的记录。
 *
 * ⚠ **不带 `onlyAccount`** —— 那是服务端的判据,没有必要发给客户端(发了就等于告诉人家
 * "这个头像是谁的专属",而清单本来就已经按权限裁剪过了)。
 *
 * @param {{ id: string, file: string, label?: string, by?: string }} rec
 */
export const publicAvatarRecord = (rec) => Object.freeze({
  id: avatarIdOf(rec.id),
  url: `${CUSTOM_AVATAR_URL_BASE}${rec.file}`,
  label: typeof rec.label === 'string' && rec.label ? rec.label : rec.id,
  by: typeof rec.by === 'string' && rec.by ? rec.by : null,
});

/*
 * ── 客户端侧的"当前可用清单" ────────────────────────────────────────────────────────────────
 *
 * 服务端在 `s.avatars` 帧里发下来**按权限裁剪过**的清单(游客/别人看不到你的专属头像),
 * 客户端把它存这里,给 `avatarSrc()` 与档案选择器读。
 *
 * ⚠ 为什么不做成 `data.js` 的一个清单:那份数据是**游戏数据**(data/*.json),
 *   而这份清单是**每个会话不同的**(按账号过滤),塞进游戏数据会在多账号/重连时串味。
 *   所以单独一个模块级的小仓库,由 `main.js` 在收到 `s.avatars` 时灌进来。
 */
let currentList = Object.freeze([]);

/**
 * ★★ **所有人可见的 id → URL 映射** (owner 2026-10-17:「自定义头像 别的玩家不显示看不到」)。
 *
 * 服务端 `s.avatars.urls` 发下来:登记表里**每一张**图片的 id 与公开 URL,不含权限信息。
 * 它存在的唯一理由是**让没被授权的人也能把别人档案上的头像画出来** ——
 * 而 `currentList` 是按账号裁剪的,那时候画不出来(显示成首字母)。
 *
 * ⚠ 这不放松权限:选头像仍然要过服务端(`server/avatars.js allows` +
 *   `net.onProfileMsg` 的白名单拦截)。凭这份映射改前端也**选不上**别人的专属头像。
 */
let publicUrls = Object.freeze([]);

/** 服务端发下来的清单(已经按权限裁剪过)。 */
export const customAvatars = () => currentList;

/**
 * 灌入新清单。**只接受形状对的记录**,并且**整体替换**(不做合并)——
 * 服务端每次发的都是完整清单,合并只会让"权限被收回"的头像留在本地。
 *
 * @param {unknown} list
 */
export function setCustomAvatars(list) {
  if (!Array.isArray(list)) { currentList = Object.freeze([]); return currentList; }
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const p = parseAvatarId(r.id);
    if (!p) continue;
    if (typeof r.url !== 'string' || !r.url.startsWith(CUSTOM_AVATAR_URL_BASE)) continue;
    out.push(Object.freeze({
      id: r.id,
      url: r.url,
      label: typeof r.label === 'string' && r.label ? r.label : p.key,
      by: typeof r.by === 'string' && r.by ? r.by : null,
    }));
  }
  currentList = Object.freeze(out);
  return currentList;
}

/**
 * 收下服务端发的"所有人可见"映射(`s.avatars.urls`)。
 *
 * 和 `setCustomAvatars` 一样**整体替换**、并做同样的消毒(只收合法 id + 站内相对路径)——
 * 服务端发什么都不直接信。
 *
 * @param {unknown} list
 */
export function setPublicAvatarUrls(list) {
  const out = [];
  if (Array.isArray(list)) {
    for (const r of list) {
      const p = r && parseAvatarId(r.id);
      if (!p) continue;
      if (typeof r.url !== 'string' || !r.url.startsWith(CUSTOM_AVATAR_URL_BASE)) continue;
      out.push(Object.freeze({ id: r.id, url: r.url }));
    }
  }
  publicUrls = Object.freeze(out);
  return publicUrls;
}

/** 只读一份(诊断 / 测试用)。 */
export const publicAvatarUrls = () => publicUrls;

/**
 * 存储 id → 图片 URL。认不出来时 **null**(和一个解不出的官方 chessId 一样:
 * 调用方会退回"名字首字母/默认图标",不会画出破图)。
 *
 * Player upload IDs include an immutable revision. Only server-supplied approved URL mappings resolve them.
 * Legacy unversioned upload IDs never resolve. Selection permission is enforced again by the server.
 *
 * @param {unknown} id
 * @returns {string|null}
 */
export function customAvatarUrl(id) {
  const p = parseAvatarId(id);
  if (!p) return null;
  if (p.upload && !p.revision) return null; // Unreviewed legacy upload IDs remain unusable.
  /*
   * ★★ **先查"所有人可见"的映射** (owner 2026-10-17:「自定义头像 别的玩家不显示看不到」)。
   *
   *   原来这里只有下面那一条(`currentList`,按账号裁剪过的"我能选哪些")——
   *   于是**没被授权的人画不出你的头像**,房间里看你就成了首字母。
   *
   *   而 owner 要的是:**所有人看得见,只有被授权的人能选**。
   *   "能不能选"和"能不能看到"是两件事,原来把它们绑在一起了。
   *
   *   映射来自服务端 `s.avatars.urls`(不含权限信息,只够把图取出来);
   *   选头像那一步仍然要过服务端白名单(`net.onProfileMsg`)—— 所以这不放松权限。
   */
  const pub = publicUrls.find((a) => a.id === id);
  if (pub) return pub.url;
  /* 退回"我能选的那些":映射还没到时(刚连上那一刻)仍然画得出来 */
  const hit = currentList.find((a) => a.id === id);
  return hit ? hit.url : null;
}

let ownReview = null;
let ownReviews = [];
const avatarListeners = new Set();
export const avatarReview = () => ownReview;
export const avatarReviews = () => ownReviews;
export function setAvatarReview(review, reviews=null) { ownReview = review && typeof review === 'object' ? review : null; ownReviews=Array.isArray(reviews)?reviews:ownReview?[ownReview]:[];for (const fn of avatarListeners) fn(); }
export function subscribeAvatarReview(fn) { avatarListeners.add(fn); return () => avatarListeners.delete(fn); }
