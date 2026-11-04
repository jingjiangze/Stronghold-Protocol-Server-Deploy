





import { net } from '../net.js';
import { store } from '../store.js';
// 贴纸图与清单都随插件一起分发（照参考服的 /community-emotes/ 同源做法）：离线、免 CORS、不受第三方节点影响。
const BASE = '/community-emotes/';
// 清单走同源（插件自带）。
const MANIFEST_URL = '/community-emotes/manifest.json';
const chatTimeFormat = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' });
const chatDateFormat = new Intl.DateTimeFormat('zh-CN', { timeZone:'Asia/Shanghai', year:'numeric', month:'2-digit', day:'2-digit' });
// Show the original server send time, including when old messages are loaded.
function appendMessageTimestamp(element, value) {
  const stamp = Number(value), date = new Date(stamp);
  if (!Number.isFinite(stamp) || stamp <= 0 || !Number.isFinite(date.getTime())) return;
  const time = document.createElement('time');
  time.className = 'community-chat__time';
  time.dateTime = date.toISOString();
  time.textContent = chatTimeFormat.format(date);
  time.title = `北京时间 ${chatDateFormat.format(date)} ${time.textContent}`;
  time.style.whiteSpace = 'nowrap';
  element.append(document.createTextNode(' · '), time);
}

let manifestPromise;
export const stickerManifest = () => manifestPromise ||= fetch(MANIFEST_URL,{cache:'no-cache'}).then(r=>{if(!r.ok)throw Error('表情暂不可用');return r.json();}).catch(e=>{manifestPromise=null;throw e;});
// 预取清单：贴纸面板原来只在**第一次点击**时才 fetch 清单、再同步建 76 个 <img>，
// 慢网络下就是「点了没反应」（2026-10-30 反馈）。清单只有几 KB 且同源，模块加载时先拉一次。
if (typeof window !== 'undefined') stickerManifest().catch(() => {});
// 面板只建一次：76 个按钮与图片复用，之后点开只是挂上/摘下同一棵 DOM。
let stickerGrid = null;
export async function stickerPicker() {
  if (stickerGrid) return stickerGrid;
  const manifest = await stickerManifest(), grid = document.createElement('div');
  grid.className = 'community-stickers';
  for (const item of manifest) {
    const button = document.createElement('button');
    button.type = 'button'; button.title = item.name; button.setAttribute('aria-label', item.name);
    const preview = stickerImage(item.id, manifest, { preview: true });
    button.append(preview);
    button.addEventListener('click', () => sendSticker(item.id));
    grid.append(button);
  }
  stickerGrid = grid;
  return grid;
}
export function stickerImage(id, manifest, { preview = true } = {}) {
  const item = manifest.find(s => s.id === id);
  if (!item) return null;
  // 实测（2026-10-23）：参考服的香港节点 hk1.bbsmc.cn 在本机不可用 —— 1 MB 的 gif 要 30 s，preview 直接超时。
  // 所以图片主源用 sp.isomer319.xyz 的 **preview**（2.4 KB webp），香港节点只作兜底；显示效果与整图一致。
  const local = BASE + (preview && item.preview ? item.preview : item.file);
  const fallback = preview && item.cdnPreview ? item.cdnPreview : item.cdnFile;
  const image = document.createElement('img');
  image.alt = item.name; image.loading = 'lazy'; image.decoding = 'async'; image.className = 'community-sticker';
  image.referrerPolicy = 'no-referrer';
  image.onerror = () => {
    image.onerror = null;
    if (typeof fallback === 'string' && fallback && image.src !== fallback) image.src = fallback;
  };
  image.src = local;
  return image;
}
/** 贴纸点击回调由挂载方逐次设置（面板 DOM 复用，不重建）。 */
let sendSticker = () => {};
export async function mountStickerPicker(container, onSend) {
  sendSticker = onSend;
  container.replaceChildren(await stickerPicker());
}
const activeBubbles = new Map();
export async function showBattleSticker(message) {
  const id=/^\[表情:(s\d{2,4})\]$/.exec(message.text || '')?.[1];
  if (!id || document.hidden || Date.now() - message.time > 5000) return;
  const image=stickerImage(id,await stickerManifest());if(!image)return;
  const state=store.get();if(message.code!==state.room?.code)return;
  const seat=message.seat ?? state.room?.seats?.find(s=>s?.playerId===message.playerId)?.seat;
  const anchor=[...document.querySelectorAll('.team__row')].find(row=>row.querySelector('.team__seat')?.textContent.trim()===`P${seat+1}`);
  if(!anchor)return;
  const previous=activeBubbles.get(message.playerId);if(previous){clearTimeout(previous.timer);previous.element.remove();}
  const bubble=document.createElement('div');bubble.className='community-battle-bubble';bubble.append(image);
  const rect=anchor.getBoundingClientRect();bubble.style.left=Math.min(innerWidth-108,rect.right+8)+'px';bubble.style.top=Math.max(8,Math.min(innerHeight-100,rect.top))+'px';
  document.body.append(bubble);const timer=setTimeout(()=>{bubble.remove();if(activeBubbles.get(message.playerId)?.element===bubble)activeBubbles.delete(message.playerId);},4000);activeBubbles.set(message.playerId,{element:bubble,timer});
}
let lastBattleSticker=0;
export async function sendBattleSticker(id) {
  const state=store.get(),room=state.room;
  if(!room||net.status!=='online')throw Error('请等待房间连接恢复');
  if(Date.now()-lastBattleSticker<1100)throw Error('发送过于频繁，请稍候');
  const manifest=await stickerManifest();if(!manifest.some(s=>s.id===id))throw Error('未知表情');
  lastBattleSticker=Date.now();
  if(room.mode==='coop')return net.request('room.chat',{code:room.code,text:`[表情:${id}]`});
  // Solo has no recipients: retain the same avatar feedback without a room chat broadcast.
  await showBattleSticker({text:`[表情:${id}]`,code:room.code,playerId:state.me.playerId,time:Date.now(),seat:0});
}
export function installRoomStickers(root, input, form, showError) {
  const button=document.createElement('button');button.type='button';button.textContent='表情';button.className='spchat__emoji';button.setAttribute('aria-label','发送表情包');
  const picker=document.createElement('div');picker.className='spchat__stickers';picker.hidden=true;form.before(picker);form.prepend(button);
  let loaded=false,disposed=false;
  button.addEventListener('click',async()=>{picker.hidden=!picker.hidden;if(!loaded&&!picker.hidden){try{await mountStickerPicker(picker,id=>{input.value=`[表情:${id}]`;form.requestSubmit();picker.hidden=true;});loaded=true;}catch(e){showError(e.message);}}});
  let scheduled=false;
  const observer=new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(async()=>{scheduled=false;const bubbles=[...root.querySelectorAll('.spchat__bubble')].filter(el=>!el.dataset.stickerRendered&&/^\[表情:s\d{2,4}\]$/.test(el.textContent));if(!bubbles.length)return;try{const manifest=await stickerManifest();if(disposed)return;for(const bubble of bubbles){const id= /^\[表情:(s\d{2,4})\]$/.exec(bubble.textContent)?.[1];const image=stickerImage(id,manifest);if(image){bubble.dataset.stickerRendered='1';bubble.replaceChildren(image);}}}catch{}});});
  observer.observe(root,{childList:true,subtree:true});return()=>{disposed=true;observer.disconnect();};
}
