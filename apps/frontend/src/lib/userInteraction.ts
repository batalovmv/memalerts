import { useSyncExternalStore } from 'react';

type Listener = () => void;

let hasInteracted = false;
let initialized = false;
const listeners = new Set<Listener>();

function initOnce() {
  if (initialized) return;
  initialized = true;

  const mark = () => {
    if (hasInteracted) return;
    hasInteracted = true;
    for (const l of listeners) l();
    // No need to keep listeners once interacted; but keep Set for future subscribers.
    remove();
  };

  const opts: AddEventListenerOptions = { capture: true, passive: true, once: true };

  const remove = () => {
    document.removeEventListener('click', mark as EventListener, opts as any);
    document.removeEventListener('touchstart', mark as EventListener, opts as any);
    document.removeEventListener('keydown', mark as EventListener, opts as any);
  };

  // Any user gesture is enough to unlock autoplay-with-sound constraints in browsers.
  document.addEventListener('click', mark as EventListener, opts);
  document.addEventListener('touchstart', mark as EventListener, opts);
  document.addEventListener('keydown', mark as EventListener, opts);
}

function subscribe(listener: Listener): () => void {
  initOnce();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): boolean {
  return hasInteracted;
}

export function useHasUserInteracted(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}



