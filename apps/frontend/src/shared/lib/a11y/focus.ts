const FOCUSABLE_SELECTOR = [
  'a[href]',
  'area[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'iframe',
  'object',
  'embed',
  '[contenteditable="true"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isVisible(el: HTMLElement) {
  // Works well for most cases; avoids focusing elements that are not actually visible.
  if (el.getClientRects().length === 0) return false;
  const style = window.getComputedStyle(el);
  if (style.visibility === 'hidden' || style.display === 'none') return false;
  return true;
}

export function getFocusableElements(container: HTMLElement): HTMLElement[] {
  const nodes = Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR));
  return nodes.filter((el) => isVisible(el) && !el.hasAttribute('disabled') && el.getAttribute('aria-hidden') !== 'true');
}

export function focusSafely(el: HTMLElement | null | undefined) {
  if (!el) return;
  try {
    el.focus({ preventScroll: true });
  } catch {
    // ignore
  }
}









