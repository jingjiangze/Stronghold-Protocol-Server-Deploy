// public/js/ui/longPress.js — 长按看备注 (user report 2026-10-17: 「长按这些按钮显示备注，如升级效果」).
//
// A press held on one of the team-economy buttons for half a second shows a small plate above it with that button's
// own note (what the next level does, how many funds the project still needs, the borrow rules). The press that
// produced the plate never also clicks the button — otherwise reading the note would broadcast a borrow or start a
// project vote on the way out.
//
// Plain functions, no hooks: `EconStrip` is a hook-free component (test/ui renders it directly) and the borrow plate
// only needs pointer handlers. The plate is one document-level element reused by every button.

const HOLD_MS = 550;
/** How long a plate stays up after it appears (ms). */
const SHOW_MS = 4200;

/** element → its running hold timer */
const timers = new WeakMap();
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
};

/**
 * Pointer handlers for a button: hold it to see `noteOf()`. Spread onto the element next to its own `onClick`, which
 * must ask `heldClick(e)` first.
 * @param {string | (() => string)} noteOf the note, or a function evaluated when the hold fires (level changes)
 */
export function longPress(noteOf) {
  return {
    onPointerDown: (e) => {
      const el = e.currentTarget;
      if (e.button != null && e.button !== 0) return;
      cancelHold(el);
      hideNote();
      timers.set(el, setTimeout(() => {
        timers.delete(el);
        suppress.add(el);
        try { showNote(el, typeof noteOf === 'function' ? noteOf() : noteOf); } catch { /* a note is never fatal */ }
      }, HOLD_MS));
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
