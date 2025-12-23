import { AsyncLocalStorage } from 'node:async_hooks';

export type RequestContextStore = {
  requestId: string;
  // Best-effort: may be filled by auth middleware later in the request lifecycle.
  userId?: string | null;
  channelId?: string | null;
  db: {
    queryCount: number;
    totalMs: number;
    slowQueryCount: number;
  };
};

const storage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestContext<T>(store: RequestContextStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function getRequestContext(): RequestContextStore | undefined {
  return storage.getStore();
}


