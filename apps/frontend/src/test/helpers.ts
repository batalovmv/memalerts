import { vi } from 'vitest';

/**
 * Common test helpers to keep integration tests small and deterministic.
 *
 * Note: these are intentionally lightweight. Prefer MSW (`onUnhandledRequest: 'error'`)
 * for network assertions and Testing Library for DOM assertions.
 */

export function stubMatchMedia(matches = false) {
  const fn = vi.fn().mockReturnValue({ matches } as any);
  vi.stubGlobal('matchMedia', fn);
  return fn;
}

/**
 * Install a deterministic IntersectionObserver that immediately reports
 * `isIntersecting: true` once per observed element.
 *
 * Returns a restore function.
 */
export function installIntersectionObserverOncePerElement() {
  const prev = globalThis.IntersectionObserver;
  const seen = new WeakSet<object>();

  // @ts-expect-error test env polyfill
  globalThis.IntersectionObserver = class IO {
    private cb: (entries: Array<{ isIntersecting: boolean; target: Element }>) => void;
    constructor(cb: any) {
      this.cb = cb;
    }
    observe(el: any) {
      if (el && typeof el === 'object') {
        if (seen.has(el)) return;
        seen.add(el);
      }
      this.cb([{ isIntersecting: true, target: el }]);
    }
    unobserve() {}
    disconnect() {}
  };

  return () => {
    globalThis.IntersectionObserver = prev;
  };
}

/**
 * Flush microtasks queued by async effects and small helpers.
 */
export async function flushMicrotasks() {
  await Promise.resolve();
}











