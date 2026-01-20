export class Semaphore {
  private readonly max: number;
  private active = 0;
  private readonly queue: Array<() => void> = [];

  constructor(max: number) {
    const n = Number.isFinite(max) ? Math.floor(max) : 1;
    this.max = n > 0 ? n : 1;
  }

  async acquire(): Promise<() => void> {
    if (this.active < this.max) {
      this.active += 1;
      return () => this.release();
    }
    await new Promise<void>((resolve) => this.queue.push(resolve));
    this.active += 1;
    return () => this.release();
  }

  private release(): void {
    this.active = Math.max(0, this.active - 1);
    const next = this.queue.shift();
    if (next) next();
  }

  async use<T>(fn: () => Promise<T>): Promise<T> {
    const release = await this.acquire();
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export function parsePositiveIntEnv(name: string, fallback: number): number {
  const raw = parseInt(String(process.env[name] ?? ''), 10);
  if (!Number.isFinite(raw)) return fallback;
  if (raw <= 0) return fallback;
  return raw;
}
