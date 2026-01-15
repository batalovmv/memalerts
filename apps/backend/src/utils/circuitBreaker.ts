import { setCircuitState } from './metrics.js';
import { isTransientHttpError } from './httpErrors.js';

export type CircuitState = 'closed' | 'open' | 'half_open';

type CircuitBreakerOptions = {
  name: string;
  failureThreshold: number;
  resetTimeoutMs: number;
  successThreshold: number;
  halfOpenMaxInFlight: number;
};

type CircuitExecuteOptions = {
  isFailure?: (error: unknown) => boolean;
};

export type CircuitStatus = {
  name: string;
  state: CircuitState;
  failureCount: number;
  successCount: number;
  openUntil: string | null;
  lastFailureAt: string | null;
  lastError: string | null;
  halfOpenInFlight: number;
  lastStateChangedAt: string;
};

export class CircuitBreakerOpenError extends Error {
  public readonly service: string;
  public readonly openUntil: number | null;

  constructor(service: string, openUntil: number | null) {
    super(`Circuit open for ${service}`);
    this.name = 'CircuitBreakerOpenError';
    this.service = service;
    this.openUntil = openUntil;
  }
}

const DEFAULTS: Omit<CircuitBreakerOptions, 'name'> = {
  failureThreshold: 5,
  resetTimeoutMs: 30_000,
  successThreshold: 1,
  halfOpenMaxInFlight: 1,
};

const SERVICE_DEFAULTS: Record<string, Partial<CircuitBreakerOptions>> = {
  twitch: { failureThreshold: 5 },
  youtube: { failureThreshold: 4 },
  openai: { failureThreshold: 3 },
};

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function resolveCircuitOptions(service: string): CircuitBreakerOptions {
  const name = service.toLowerCase();
  const defaults = SERVICE_DEFAULTS[name] ?? {};
  const upper = name.toUpperCase();
  const failureThreshold = clampInt(
    parseInt(String(process.env[`${upper}_CIRCUIT_FAILURE_THRESHOLD`] || ''), 10),
    1,
    50,
    defaults.failureThreshold ?? DEFAULTS.failureThreshold
  );
  const resetTimeoutMs = clampInt(
    parseInt(String(process.env[`${upper}_CIRCUIT_RESET_TIMEOUT_MS`] || ''), 10),
    1000,
    10 * 60_000,
    defaults.resetTimeoutMs ?? DEFAULTS.resetTimeoutMs
  );
  const successThreshold = clampInt(
    parseInt(String(process.env[`${upper}_CIRCUIT_SUCCESS_THRESHOLD`] || ''), 10),
    1,
    10,
    defaults.successThreshold ?? DEFAULTS.successThreshold
  );
  const halfOpenMaxInFlight = clampInt(
    parseInt(String(process.env[`${upper}_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT`] || ''), 10),
    1,
    20,
    defaults.halfOpenMaxInFlight ?? DEFAULTS.halfOpenMaxInFlight
  );
  return { name, failureThreshold, resetTimeoutMs, successThreshold, halfOpenMaxInFlight };
}

class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private successCount = 0;
  private openUntil: number | null = null;
  private lastFailureAt: number | null = null;
  private lastError: string | null = null;
  private halfOpenInFlight = 0;
  private lastStateChangedAt = Date.now();

  constructor(private readonly opts: CircuitBreakerOptions) {
    setCircuitState(this.opts.name, this.state);
  }

  private transition(next: CircuitState) {
    if (this.state === next) return;
    this.state = next;
    this.lastStateChangedAt = Date.now();
    setCircuitState(this.opts.name, next);
  }

  private open() {
    this.openUntil = Date.now() + this.opts.resetTimeoutMs;
    this.successCount = 0;
    this.transition('open');
  }

  private close() {
    this.failureCount = 0;
    this.successCount = 0;
    this.openUntil = null;
    this.halfOpenInFlight = 0;
    this.transition('closed');
  }

  private enterHalfOpen() {
    this.successCount = 0;
    this.halfOpenInFlight = 0;
    this.transition('half_open');
  }

  private refreshState() {
    if (this.state !== 'open' || this.openUntil == null) return;
    if (Date.now() >= this.openUntil) {
      this.openUntil = null;
      this.enterHalfOpen();
    }
  }

  async execute<T>(action: () => Promise<T>, options: CircuitExecuteOptions = {}): Promise<T> {
    const isFailure = options.isFailure ?? isTransientHttpError;
    this.refreshState();

    if (this.state === 'open') {
      throw new CircuitBreakerOpenError(this.opts.name, this.openUntil);
    }

    if (this.state === 'half_open' && this.halfOpenInFlight >= this.opts.halfOpenMaxInFlight) {
      throw new CircuitBreakerOpenError(this.opts.name, this.openUntil);
    }

    if (this.state === 'half_open') {
      this.halfOpenInFlight += 1;
    }
    const trackedHalfOpen = this.state === 'half_open';

    try {
      const result = await action();
      if (this.state === 'half_open') {
        this.successCount += 1;
        if (this.successCount >= this.opts.successThreshold) {
          this.close();
        }
      } else {
        this.failureCount = 0;
      }
      return result;
    } catch (error) {
      const shouldTrip = isFailure(error);
      if (shouldTrip) {
        this.failureCount += 1;
        this.lastFailureAt = Date.now();
        this.lastError = (error as Error)?.message || String(error);

        if (this.state === 'half_open') {
          this.open();
        } else if (this.state === 'closed' && this.failureCount >= this.opts.failureThreshold) {
          this.open();
        }
      } else if (this.state === 'half_open') {
        this.close();
      }
      throw error;
    } finally {
      if (trackedHalfOpen) {
        this.halfOpenInFlight = Math.max(0, this.halfOpenInFlight - 1);
      }
    }
  }

  status(): CircuitStatus {
    this.refreshState();
    return {
      name: this.opts.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      openUntil: this.openUntil ? new Date(this.openUntil).toISOString() : null,
      lastFailureAt: this.lastFailureAt ? new Date(this.lastFailureAt).toISOString() : null,
      lastError: this.lastError,
      halfOpenInFlight: this.halfOpenInFlight,
      lastStateChangedAt: new Date(this.lastStateChangedAt).toISOString(),
    };
  }
}

const circuits = new Map<string, CircuitBreaker>();

export function getCircuitBreaker(service: string): CircuitBreaker {
  const key = service.toLowerCase();
  const existing = circuits.get(key);
  if (existing) return existing;
  const circuit = new CircuitBreaker(resolveCircuitOptions(key));
  circuits.set(key, circuit);
  return circuit;
}

export function listCircuitStatuses(): CircuitStatus[] {
  return Array.from(circuits.values())
    .map((c) => c.status())
    .sort((a, b) => a.name.localeCompare(b.name));
}
