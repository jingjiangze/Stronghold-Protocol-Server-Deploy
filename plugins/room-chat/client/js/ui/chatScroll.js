// One owner for chat scroll position: follow the bottom, or retain the visible message.
export function createChatScroll(log) {
  let pinned = true, frame = 0, saved = null, expectedTop = null, disposed = false;
  let inputUntil = 0, pointerDown = false;
  const raf = globalThis.requestAnimationFrame || (fn => setTimeout(fn, 0));
  const cancel = globalThis.cancelAnimationFrame || clearTimeout;
  const nearBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight <= 2;
  const recentInput = () => pointerDown || Date.now() < inputUntil;
  const changedLayout = () => saved && (saved.height !== log.scrollHeight || saved.client !== log.clientHeight);
  const moved = () => saved && Math.abs(saved.top - log.scrollTop) > .5;
  // A layout change only clamps scrollTop when the previous position exceeds the
  // new scroll range. Height changes alone do not prove a scroll came from layout:
  // touch inertia, scrollbar/assistive input can continue beyond the input grace.
  const layoutClamped = () => {
    const max = Math.max(0, log.scrollHeight - log.clientHeight);
    return saved && saved.top > max + .5 && Math.abs(log.scrollTop - max) <= .5;
  };
  function capture() {
    const rect = log.getBoundingClientRect();
    const scale = log.offsetHeight ? rect.height / log.offsetHeight || 1 : 1;
    let anchor = null;
    for (const el of log.children) {
      if (el.getBoundingClientRect().bottom > rect.top + log.clientTop * scale + 2) { anchor = el; break; }
    }
    return { pinned, top: log.scrollTop, height: log.scrollHeight, client: log.clientHeight,
      key: anchor?.dataset.chatKey, anchor,
      offset: anchor ? (anchor.getBoundingClientRect().top - rect.top) / scale : 0 };
  }
  function write(top) {
    log.scrollTop = top;
    expectedTop = log.scrollTop;
    saved = capture();
  }
  function bottom() {
    pinned = true;
    write(log.scrollHeight);
  }
  function restoreView(s) {
    if (!s || !log.clientHeight) { saved = capture(); return; }
    if (pinned) { bottom(); return; }
    const anchor = s.anchor?.parentNode === log ? s.anchor
      : [...log.children].find(el => el.dataset.chatKey === s.key);
    if (anchor) {
      const rect = log.getBoundingClientRect();
      const scale = log.offsetHeight ? rect.height / log.offsetHeight || 1 : 1;
      write(log.scrollTop + (anchor.getBoundingClientRect().top - rect.top) / scale - s.offset);
    } else write(Math.min(s.top, Math.max(0, log.scrollHeight - log.clientHeight)));
  }
  function schedule() {
    if (disposed) return;
    cancel(frame);
    frame = raf(() => {
      frame = 0;
      if (disposed || !log.clientHeight) return;
      // Reaching the real bottom wins over an old history anchor, even if a layout change
      // and the browser's delayed scroll event arrive after the input grace period.
      if (nearBottom()) { pinned = true; saved = capture(); }
      // A scroll gesture may have moved the viewport before its scroll event is delivered.
      else if (moved() && (!changedLayout() || recentInput() || !layoutClamped())) {
        pinned = nearBottom(); saved = capture();
      }
      restoreView(saved);
    });
  }
  function onScroll() {
    if (nearBottom()) { pinned = true; expectedTop = null; saved = capture(); return; }
    if (expectedTop !== null && Math.abs(log.scrollTop - expectedTop) <= .5) {
      expectedTop = null; return;
    }
    expectedTop = null;
    // Browser clamping after a size change is not a request to abandon our anchor.
    if (changedLayout() && !recentInput() && (!moved() || layoutClamped())) { schedule(); return; }
    pinned = nearBottom(); saved = capture();
  }
  function input(event) {
    inputUntil = Date.now() + 1000;
    cancel(frame); frame = 0; expectedTop = null;
    if ((event.type === 'wheel' && event.deltaY < 0) || event.type === 'touchmove' ||
        (event.type === 'keydown' && ['ArrowUp','PageUp','Home'].includes(event.key))) pinned = false;
  }
  function down(event) { pointerDown = true; input(event); }
  function up() { pointerDown = false; }
  log.addEventListener('scroll', onScroll, { passive: true });
  for (const type of ['wheel','touchmove','keydown']) log.addEventListener(type, input, { passive: true });
  log.addEventListener('pointerdown', down, { passive: true });
  // The chat shell stops bubbling pointer events; release the gesture in capture phase.
  globalThis.addEventListener?.('pointerup', up, { passive: true, capture: true });
  globalThis.addEventListener?.('pointercancel', up, { passive: true, capture: true });
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
  observer?.observe(log);
  saved = capture();
  return {
    snapshot() {
      // Read the actual position now, not a cached scroll event from the previous frame.
      if (nearBottom()) pinned = true;
      else if (moved() && (!changedLayout() || recentInput() || !layoutClamped())) pinned = false;
      if (changedLayout() && !moved()) restoreView(saved);
      saved = capture(); return saved;
    },
    restore(s, force = false) {
      pinned = force || s.pinned;
      restoreView(s);
    },
    bottom,
    watch: el => observer?.observe(el),
    unwatch: el => observer?.unobserve(el),
    dispose() {
      disposed = true; cancel(frame); observer?.disconnect();
      log.removeEventListener('scroll', onScroll);
      for (const type of ['wheel','touchmove','keydown']) log.removeEventListener(type, input);
      log.removeEventListener('pointerdown', down);
      globalThis.removeEventListener?.('pointerup', up, true);
      globalThis.removeEventListener?.('pointercancel', up, true);
    },
  };
}
