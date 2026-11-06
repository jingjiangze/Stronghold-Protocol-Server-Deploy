// public/js/ui/longPress.js — 长按看备注 (user report 2026-10-17: 「长按这些按钮显示备注，如升级效果」).
//
// A press held on one of the team-economy buttons for half a second shows a small plate above it with that button's
// own note (what the next level does, how many funds the project still needs, the borrow rules). The press that
// produced the plate never also clicks the button — otherwise reading the note would broadcast a borrow or start a
// project vote on the way out.
//
// Plain functions, no hooks: `EconStrip` is a hook-free component (test/ui renders it directly) and the borrow plate
// only needs pointer handlers. The plate is one document-level element reused by every button.
//
// 2026-11-04: two additions for 怪物卡的多选态 (ui/shopBar.js MonsterCard) — the hold may run an injected callback
// instead of showing a plate (`options.onHold`), and the handlers gained `onPointerMove`, which cancels the hold once the
// pointer travels more than `options.cancelPx` (default 8 px) so a drag never also counts as a hold. Existing callers
// (EconStrip, borrowPlate) pass no options and do not spread `onPointerMove`: their behaviour is unchanged.

const HOLD_MS = 550;
/** How long a plate stays up after it appears (ms). */
const SHOW_MS = 4200;
/** How far (px) the pointer may wander before the press stops being a hold (a drag, a scroll, a sloppy tap). */
const CANCEL_PX = 8;

/** element → its running hold timer */
const timers = new WeakMap();
/** element → where its press started ({ x, y }): a move past CANCEL_PX cancels the hold */
const origins = new WeakMap();
/** element → the hold fired: swallow the click that follows */
const suppress = new WeakSet();

let plate = null;
let plateTimer = 0;

const ensurePlate = () => {
  if (plate) return plate;
  plate = document.createElement('div');
  plate.className = 'econnote';
  plate.setAttribute('role', 'tooltip');
  document.body.appendChild(plate);
  return plate;
};

export const hideNote = () => {
  if (plateTimer) { clearTimeout(plateTimer); plateTimer = 0; }
  if (plate && plate.classList.contains('is-shown')) plate.classList.remove('is-shown');
};

/**
 * @param {Element} el the button the note belongs to
 * @param {string} text the note (newlines are kept: `.econnote` is `white-space: pre-line`)
 */
const showNote = (el, text) => {
  if (!text) return;
  const p = ensurePlate();
  p.textContent = text;
  p.style.left = '0px';
  p.style.top = '0px';
  p.classList.add('is-shown');
  const r = el.getBoundingClientRect();
  const box = p.getBoundingClientRect();
  const half = box.width / 2;
  // centred over the button, clamped into the viewport; above it unless that would leave the screen
  const x = Math.min(Math.max(half + 8, r.left + r.width / 2), window.innerWidth - half - 8);
  const above = r.top - box.height - 8 >= 8;
  const y = above ? r.top - 8 : r.bottom + box.height + 8;
  p.style.left = `${Math.round(x)}px`;
  p.style.top = `${Math.round(y)}px`;
  p.style.transform = above ? 'translate(-50%, -100%)' : 'translate(-50%, 0)';
  if (plateTimer) clearTimeout(plateTimer);
  plateTimer = setTimeout(hideNote, SHOW_MS);
};

const cancelHold = (el) => {
  const t = el && timers.get(el);
  if (t) { clearTimeout(t); timers.delete(el); }
  if (el) origins.delete(el);
};

/**
 * Pointer handlers for a button: hold it to see `noteOf()`. Spread onto the element next to its own `onClick`, which
 * must ask `heldClick(e)` first.
 *
 * `options.onHold` replaces the note: the hold calls that callback instead (`el` — the element — is passed), which is how
 * 怪物卡 turns a hold into its 多选态 (ui/shopBar.js MonsterCard) without a plate. `options.cancelPx` moves the pointer
 * distance that cancels the hold (default 8 px); the handlers now include `onPointerMove` for it — a caller that does not
 * spread it keeps the old behaviour exactly (there is no move-cancel then).
 * @param {string | (() => string) | null} noteOf the note, or a function evaluated when the hold fires (level changes);
 *   null / '' shows nothing (use with `onHold`)
 * @param {{ onHold?: (el: Element) => void, cancelPx?: number }} [options]
 */
export function longPress(noteOf, options = {}) {
  const onHold = options && typeof options.onHold === 'function' ? options.onHold : null;
  const cancelPx = options && Number.isFinite(options.cancelPx) ? Math.max(0, Number(options.cancelPx)) : CANCEL_PX;
  return {
    onPointerDown: (e) => {
      const el = e.currentTarget;
      if (e.button != null && e.button !== 0) return;
      cancelHold(el);
      hideNote();
      origins.set(el, { x: Number(e.clientX) || 0, y: Number(e.clientY) || 0 });
      timers.set(el, setTimeout(() => {
        timers.delete(el);
        origins.delete(el);
        suppress.add(el);
        // an injected callback wins over the plate: 多选态 must open without a note popping up over the cards
        if (onHold) { try { onHold(el); } catch { /* a hold is never fatal */ } return; }
        try { showNote(el, typeof noteOf === 'function' ? noteOf() : noteOf); } catch { /* a note is never fatal */ }
      }, HOLD_MS));
    },
    /** Moved too far to still be a hold: the press is a drag / a scroll instead (the click still fires by itself). */
    onPointerMove: (e) => {
      const el = e.currentTarget;
      if (!el || !timers.has(el)) return;
      const o = origins.get(el);
      if (!o) return;
      const dx = Number(e.clientX) - o.x;
      const dy = Number(e.clientY) - o.y;
      if (Number.isFinite(dx) && Number.isFinite(dy) && Math.hypot(dx, dy) > cancelPx) cancelHold(el);
    },
    onPointerUp: (e) => cancelHold(e.currentTarget),
    onPointerLeave: (e) => cancelHold(e.currentTarget),
    onPointerCancel: (e) => cancelHold(e.currentTarget),
  };
}

/**
 * `true` when the click belongs to a long press: the note is already up, so the button's own action is skipped.
 * @param {Event & { currentTarget: Element }} e the click event
 */
export function heldClick(e) {
  const el = e && e.currentTarget;
  if (!el || !suppress.has(el)) return false;
  suppress.delete(el);
  return true;
}
