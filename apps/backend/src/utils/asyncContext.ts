import { AsyncLocalStorage } from 'node:async_hooks';

export type SlowQuerySummary = {
  durationMs: number;
  query: string | null;
};

export type RequestContextStore = {
  requestId: string;
  traceId?: string | null;
  // Best-effort: may be filled by auth middleware later in the request lifecycle.
  userId?: string | null;
  channelId?: string | null;
  db: {
    queryCount: number;
    totalMs: number;
    slowQueryCount: number;
    slowQueries?: SlowQuerySummary[];
  };
};

const storage = new AsyncLocalStorage<RequestContextStore>();

export function runWithRequestContext<T>(store: RequestContextStore, fn: () => T): T {
  return storage.run(store, fn);
}

export function getRequestContext(): RequestContextStore | undefined {
  return storage.getStore();
}
