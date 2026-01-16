import { afterEach, describe, expect, it, vi } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { CircuitBreakerOpenError, getCircuitBreaker } from '../src/utils/circuitBreaker.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../src/utils/pgAdvisoryLock.js';
import { withRetry } from '../src/utils/retry.js';
import { Semaphore } from '../src/utils/semaphore.js';

describe('utils: concurrency', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('enforces semaphore concurrency limits', async () => {
    const sem = new Semaphore(2);
    let active = 0;
    let maxActive = 0;

    const tasks = Array.from({ length: 5 }, () =>
      sem.use(async () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      })
    );

    await Promise.all(tasks);
    expect(maxActive).toBe(2);
  });

  it('retries with backoff until success', async () => {
    vi.useFakeTimers();
    let attempts = 0;

    const work = withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) throw new Error('fail');
        return 'ok';
      },
      {
        service: 'retry-test',
        maxAttempts: 3,
        baseDelayMs: 100,
        maxDelayMs: 100,
        factor: 2,
        jitter: 'none',
      }
    );

    await vi.runAllTimersAsync();
    await expect(work).resolves.toBe('ok');
    expect(attempts).toBe(3);
  });

  it('opens circuit on failures and recovers after reset', async () => {
    vi.useFakeTimers();
    const service = `test_${Date.now()}`;
    const upper = service.toUpperCase();
    process.env[`${upper}_CIRCUIT_FAILURE_THRESHOLD`] = '2';
    process.env[`${upper}_CIRCUIT_RESET_TIMEOUT_MS`] = '1000';
    process.env[`${upper}_CIRCUIT_SUCCESS_THRESHOLD`] = '1';
    process.env[`${upper}_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT`] = '1';

    const circuit = getCircuitBreaker(service);

    await expect(circuit.execute(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(circuit.execute(async () => Promise.reject(new Error('boom')))).rejects.toThrow('boom');

    await expect(circuit.execute(async () => 'ok')).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    await vi.advanceTimersByTimeAsync(1000);
    const result = await circuit.execute(async () => 'ok');
    expect(result).toBe('ok');
    expect(circuit.status().state).toBe('closed');
  });

  it('handles advisory lock acquire/release results', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw');
    spy.mockResolvedValueOnce([{ locked: true }]);
    await expect(tryAcquireAdvisoryLock(1n)).resolves.toBe(true);

    spy.mockResolvedValueOnce([{ locked: false }]);
    await expect(tryAcquireAdvisoryLock(1n)).resolves.toBe(false);

    spy.mockRejectedValueOnce(new Error('fail'));
    await expect(releaseAdvisoryLock(1n)).resolves.toBeUndefined();
  });
});
