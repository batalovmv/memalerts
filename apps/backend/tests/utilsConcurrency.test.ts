import { prisma } from '../src/lib/prisma.js';
import { CircuitBreakerOpenError, getCircuitBreaker, listCircuitStatuses } from '../src/utils/circuitBreaker.js';
import { tryAcquireAdvisoryLock, releaseAdvisoryLock } from '../src/utils/pgAdvisoryLock.js';
import { getServiceRetryConfig, withRetry } from '../src/utils/retry.js';
import { parsePositiveIntEnv, Semaphore } from '../src/utils/semaphore.js';

describe('utils: semaphore', () => {
  it('limits concurrent work', async () => {
    const sem = new Semaphore(1);
    let active = 0;
    let maxActive = 0;

    const task = async () => {
      const release = await sem.acquire();
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      release();
    };

    await Promise.all([task(), task()]);
    expect(maxActive).toBe(1);
  });
});

describe('utils: parsePositiveIntEnv', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('parses env values with fallback', () => {
    process.env.TEST_INT = '5';
    expect(parsePositiveIntEnv('TEST_INT', 2)).toBe(5);
    process.env.TEST_INT = '-1';
    expect(parsePositiveIntEnv('TEST_INT', 2)).toBe(2);
    process.env.TEST_INT = 'nope';
    expect(parsePositiveIntEnv('TEST_INT', 3)).toBe(3);
  });
});

describe('utils: retry', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('retries failures until success', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error('fail');
        }
        return 'ok';
      },
      {
        service: 'test',
        maxAttempts: 3,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitter: 'none',
        onRetry: vi.fn(),
      }
    );
    expect(result).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('retries on result when configured', async () => {
    let attempts = 0;
    const result = await withRetry(
      async () => {
        attempts += 1;
        return { ok: attempts > 1 };
      },
      {
        service: 'test',
        maxAttempts: 2,
        baseDelayMs: 1,
        maxDelayMs: 1,
        jitter: 'none',
        retryOnResult: (res) => !res.ok,
        isSuccessResult: (res) => res.ok,
      }
    );
    expect(result.ok).toBe(true);
    expect(attempts).toBe(2);
  });

  it('uses env overrides for retry config', () => {
    process.env.TESTSVC_RETRY_MAX_ATTEMPTS = '0';
    process.env.TESTSVC_RETRY_BASE_DELAY_MS = '5';
    process.env.TESTSVC_RETRY_MAX_DELAY_MS = '1';
    const cfg = getServiceRetryConfig('testsvc', {
      maxAttempts: 4,
      baseDelayMs: 100,
      maxDelayMs: 1000,
    });
    expect(cfg.maxAttempts).toBe(1);
    expect(cfg.baseDelayMs).toBe(50);
    expect(cfg.maxDelayMs).toBe(50);
  });
});

describe('utils: circuit breaker', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('opens after failures and closes after reset', async () => {
    const service = 'cbtest';
    process.env.CBTEST_CIRCUIT_FAILURE_THRESHOLD = '2';
    process.env.CBTEST_CIRCUIT_RESET_TIMEOUT_MS = '1000';
    process.env.CBTEST_CIRCUIT_SUCCESS_THRESHOLD = '1';
    process.env.CBTEST_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT = '1';
    const circuit = getCircuitBreaker(service);

    await expect(circuit.execute(async () => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(circuit.execute(async () => Promise.reject(new Error('fail')))).rejects.toThrow('fail');
    await expect(circuit.execute(async () => 'ok')).rejects.toBeInstanceOf(CircuitBreakerOpenError);

    await new Promise((resolve) => setTimeout(resolve, 1100));
    await expect(circuit.execute(async () => 'ok')).resolves.toBe('ok');

    const status = circuit.status();
    expect(status.state).toBe('closed');
  });

  it('lists circuit statuses', () => {
    const first = getCircuitBreaker('list-a');
    const second = getCircuitBreaker('list-b');
    first.status();
    second.status();
    const list = listCircuitStatuses();
    const names = list.map((row) => row.name);
    expect(names.includes('list-a')).toBe(true);
    expect(names.includes('list-b')).toBe(true);
  });
});

describe('utils: pgAdvisoryLock', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns lock acquisition status', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw');
    spy.mockResolvedValueOnce([{ locked: true }] as Array<{ locked: boolean }>);
    const first = await tryAcquireAdvisoryLock(123n);
    expect(first).toBe(true);

    spy.mockResolvedValueOnce([{ locked: false }] as Array<{ locked: boolean }>);
    const second = await tryAcquireAdvisoryLock(123n);
    expect(second).toBe(false);
  });

  it('swallows unlock errors', async () => {
    const spy = vi.spyOn(prisma, '$queryRaw').mockRejectedValueOnce(new Error('boom'));
    await expect(releaseAdvisoryLock(456n)).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalled();
  });
});
