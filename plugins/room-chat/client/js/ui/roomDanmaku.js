export function createRoomDanmaku() {
  const layer = document.createElement('div');
  layer.className = 'spchat-danmaku';layer.setAttribute('aria-hidden', 'true');
  Object.assign(layer.style, { position: 'fixed', inset: '0', overflow: 'hidden', pointerEvents: 'none', zIndex: '120' });
  document.body.append(layer);
  let enabled = true;
  try { enabled = localStorage.getItem('sp.chat.danmaku.enabled') !== '0'; } catch {}
  const active = new Map();
  function clear() { for (const [el, item] of active) { clearTimeout(item.timer);item.animation?.cancel();el.remove(); }active.clear(); }
  // message.media: an <img> (room sticker) shown in place of the text; it takes two lanes so the picture stays legible
  function show(message, mine) {
    if (!enabled || document.hidden) return;
    const small = innerHeight < 420, lanes = small ? 3 : 4, span = message.media ? 2 : 1;
    const busy = new Set([...active.values()].flatMap(item => Array.from({ length: item.span || 1 }, (_, i) => item.lane + i)));
    let lane = 0;while (lane + span <= lanes && Array.from({ length: span }, (_, i) => lane + i).some(l => busy.has(l))) lane++;
    if (lane + span > lanes) return;
    const el = document.createElement('span');
    Object.assign(el.style, { position: 'absolute', left: '100%', top: `${Math.max(78, innerHeight * .14) + lane * 30}px`, whiteSpace: 'nowrap', fontSize: small ? '14px' : '18px', fontWeight: '600', lineHeight: '28px', color: mine ? '#65f1ca' : '#ffffff', textShadow: '0 1px 3px #000, 1px 0 3px #000', maxWidth: 'min(680px, 85vw)', overflow: 'hidden', textOverflow: 'ellipsis', pointerEvents: 'none' });
    if (message.media) {
      el.textContent = `${message.name.slice(0, 24)}：`;
      Object.assign(el.style, { display: 'flex', alignItems: 'center', gap: '4px', height: '58px', lineHeight: '58px' });
      Object.assign(message.media.style, { height: '54px', width: 'auto', maxWidth: '96px', objectFit: 'contain', borderRadius: '6px', filter: 'drop-shadow(0 1px 3px #000)' });
      message.media.removeAttribute('loading');
      el.append(message.media);
    } else el.textContent = `${message.name.slice(0, 24)}：${message.text}`;
    layer.append(el);
    const duration = 8000, distance = innerWidth + Math.max(el.getBoundingClientRect().width, message.media ? 160 : 0) + 20;
    const animation = el.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${distance}px)` }], { duration, easing: 'linear' });
    const remove = () => { clearTimeout(active.get(el)?.timer);active.delete(el);el.remove(); };
    active.set(el, { lane, span, animation, timer: setTimeout(remove, duration + 500) });animation.onfinish = remove;
  }
  const visibility = () => { if (document.hidden) clear(); };
  document.addEventListener('visibilitychange', visibility);window.addEventListener('resize', clear);
  return { show, clear, get enabled() { return enabled; }, toggle() { enabled = !enabled;if (!enabled) clear();try { localStorage.setItem('sp.chat.danmaku.enabled', enabled ? '1' : '0'); } catch {}return enabled; }, dispose() { clear();layer.remove();document.removeEventListener('visibilitychange', visibility);window.removeEventListener('resize', clear); } };
}
