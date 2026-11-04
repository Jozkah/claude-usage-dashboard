/** Pure keyboard / pointer helpers, kept free of the DOM so they can be unit tested. */

export const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Where Tab should land to keep focus inside a container of `count` focusable items.
 * `index` is the focused item (-1 when focus is outside the container).
 * Returns the index to focus, or null to let the browser move focus normally.
 */
export function tabTarget(count: number, index: number, shift: boolean): number | null {
  if (count === 0) return -1; // nothing focusable: hold focus where it is
  if (index < 0) return shift ? count - 1 : 0;
  if (shift && index === 0) return count - 1;
  if (!shift && index === count - 1) return 0;
  return null;
}

/** Keeps Tab / Shift+Tab inside `container`. Returns true when the event was handled. */
export function trapTab(e: KeyboardEvent, container: HTMLElement | null): boolean {
  if (e.key !== 'Tab' || !container) return false;
  const items = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0);
  const i = tabTarget(items.length, items.indexOf(document.activeElement as HTMLElement), e.shiftKey);
  if (i === null) return false;
  e.preventDefault();
  items[i]?.focus();
  return true;
}

/** Roving focus for a vertical menu: index to focus after `key`, or null if the key is not a menu key. */
export function menuIndex(key: string, index: number, count: number): number | null {
  if (!count) return null;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return index < 0 ? count - 1 : (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

export const LONG_PRESS_MS = 550;
const LONG_PRESS_SLOP = 10;

/** A touch that drifted this far is a scroll or swipe, not a long press. */
export function movedTooFar(dx: number, dy: number): boolean {
  return Math.hypot(dx, dy) > LONG_PRESS_SLOP;
}
