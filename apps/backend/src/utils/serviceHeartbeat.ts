import os from 'os';
import { prisma } from '../lib/prisma.js';
import { logger } from './logger.js';
import fs from 'fs';
import path from 'path';

let cachedVersion: string | null = null;
let cachedResolved = false;

function resolveVersion(): string | null {
  if (cachedResolved) return cachedVersion;
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw);
    cachedVersion = typeof pkg?.version === 'string' ? pkg.version : null;
    cachedResolved = true;
    return cachedVersion;
  } catch {
    cachedVersion = null;
    cachedResolved = true;
    return cachedVersion;
  }
}

export function resolveServiceHeartbeatId(service: string): string {
  const base = String(service || '').trim();
  const instance = String(process.env.INSTANCE || '').trim();
  if (!base) return instance ? `unknown-${instance}` : 'unknown';
  return instance ? `${base}-${instance}` : base;
}

export function startServiceHeartbeat(opts: {
  service: string;
  intervalMs?: number;
  meta?: Record<string, unknown>;
}): {
  stop: () => void;
} {
  const id = resolveServiceHeartbeatId(opts.service);
  const intervalMs = Number.isFinite(opts.intervalMs) ? Math.max(5_000, Math.floor(opts.intervalMs!)) : 30_000;
  const baseMeta = {
    pid: process.pid,
    host: os.hostname(),
    version: resolveVersion(),
    ...(opts.meta || {}),
  };

  let stopped = false;
  let timer: NodeJS.Timeout | null = null;
  let tableMissing = false;

  const tick = async () => {
    if (stopped || tableMissing) return;
    try {
      await prisma.serviceHeartbeat.upsert({
        where: { id },
        create: {
          id,
          meta: baseMeta,
          lastSeenAt: new Date(),
        },
        update: {
          meta: baseMeta,
          lastSeenAt: new Date(),
        },
      });
    } catch (error) {
      const err = error as { code?: string; message?: string };
      if (err.code === 'P2021') {
        tableMissing = true;
        logger.warn('heartbeat.table_missing', { service: id });
        return;
      }
      logger.warn('heartbeat.tick_failed', { service: id, errorMessage: err.message || String(error) });
    }
  };

  void tick();
  timer = setInterval(() => void tick(), intervalMs);

  return {
    stop: () => {
      stopped = true;
      if (timer) clearInterval(timer);
    },
  };
}
