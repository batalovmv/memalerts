import type { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { prisma } from '../../lib/prisma.js';
import { getAiModerationDlqCounts, getAiModerationQueueCounts } from '../../queues/aiModerationQueue.js';
import { getChatOutboxQueueCounts } from '../../queues/chatOutboxQueue.js';
import { listCircuitStatuses } from '../../utils/circuitBreaker.js';
import { getShutdownInfo, isShuttingDown } from '../../utils/shutdownState.js';

type HealthBuildInfo = {
  name: string | null;
  version: string | null;
  deployTrigger: string | null;
};

let healthBuildInfoCache: HealthBuildInfo | null = null;
function getHealthBuildInfo(): HealthBuildInfo {
  if (healthBuildInfoCache) return healthBuildInfoCache;
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const raw = fs.readFileSync(pkgPath, 'utf8');
    const pkg = JSON.parse(raw) as { name?: string; version?: string; _deploy_trigger?: string };
    healthBuildInfoCache = {
      name: pkg?.name ?? null,
      version: pkg?.version ?? null,
      deployTrigger: pkg?._deploy_trigger ?? null,
    };
    return healthBuildInfoCache;
  } catch {
    healthBuildInfoCache = { name: null, version: null, deployTrigger: null };
    return healthBuildInfoCache;
  }
}

function resolveServiceName(): string | null {
  const svc = String(process.env.INSTANCE || '').trim();
  return svc || null;
}

function resolveEnvName(): string | null {
  const env = String(process.env.NODE_ENV || '').trim();
  return env || null;
}

function resolveInstanceId(): string | null {
  const instanceId = String(process.env.INSTANCE_ID || process.env.HOSTNAME || '').trim();
  return instanceId || null;
}

export function registerHealthRoutes(app: Router) {
  app.get('/health', (req, res) => {
    const payload = {
      status: 'ok',
      build: getHealthBuildInfo(),
      instance: {
        port: process.env.PORT ?? null,
        domain: process.env.DOMAIN ?? null,
        instance: process.env.INSTANCE ?? null,
        instanceId: resolveInstanceId(),
      },
    };
    if (isShuttingDown()) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Server is shutting down',
        details: { ...payload, status: 'shutting_down', shutdown: getShutdownInfo() },
      });
    }
    return res.json(payload);
  });

  app.get('/healthz', (_req, res) => {
    const payload = {
      status: 'ok',
      service: resolveServiceName(),
      env: resolveEnvName(),
      instanceId: resolveInstanceId(),
      version: getHealthBuildInfo()?.version ?? null,
      time: new Date().toISOString(),
    };
    if (isShuttingDown()) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Server is shutting down',
        details: { ...payload, status: 'shutting_down', shutdown: getShutdownInfo() },
      });
    }
    return res.json(payload);
  });

  app.get('/health/circuits', (_req, res) => {
    if (isShuttingDown()) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Server is shutting down',
        details: { status: 'shutting_down', shutdown: getShutdownInfo() },
      });
    }
    const circuits = listCircuitStatuses();
    const isDegraded = circuits.some((c) => c.state === 'open' || c.state === 'half_open');
    return res.json({
      status: isDegraded ? 'degraded' : 'ok',
      circuits,
    });
  });

  app.get('/readyz', async (_req, res) => {
    const payload = {
      status: 'ok',
      service: resolveServiceName(),
      env: resolveEnvName(),
      instanceId: resolveInstanceId(),
      version: getHealthBuildInfo()?.version ?? null,
      time: new Date().toISOString(),
      checks: {
        database: 'ok',
      },
    };
    if (isShuttingDown()) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Server is shutting down',
        details: { ...payload, status: 'shutting_down', shutdown: getShutdownInfo() },
      });
    }
    try {
      await prisma.$queryRaw`SELECT 1`;
      return res.json(payload);
    } catch {
      return res.status(503).json({
        ...payload,
        status: 'degraded',
        checks: {
          database: 'error',
        },
      });
    }
  });

  app.get('/health/workers', async (_req, res) => {
    if (isShuttingDown()) {
      return res.status(503).json({
        error: 'Service Unavailable',
        message: 'Server is shutting down',
        details: { status: 'shutting_down', shutdown: getShutdownInfo() },
      });
    }
    const now = Date.now();
    const [
      rows,
      aiQueueCounts,
      aiDlqCounts,
      twitchOutboxCounts,
      youtubeOutboxCounts,
      vkvideoOutboxCounts,
    ] = await Promise.all([
      prisma.serviceHeartbeat.findMany({ orderBy: { id: 'asc' } }),
      getAiModerationQueueCounts(),
      getAiModerationDlqCounts(),
      getChatOutboxQueueCounts('twitch'),
      getChatOutboxQueueCounts('youtube'),
      getChatOutboxQueueCounts('vkvideo'),
    ]);
    const workers = rows.map((row) => {
      const lastSeenAt = row.lastSeenAt ? new Date(row.lastSeenAt).toISOString() : null;
      const deltaMs = row.lastSeenAt ? now - row.lastSeenAt.getTime() : Number.POSITIVE_INFINITY;
      let status: 'alive' | 'stale' | 'dead' = 'dead';
      if (deltaMs <= 60_000) status = 'alive';
      else if (deltaMs <= 5 * 60_000) status = 'stale';
      return {
        id: row.id,
        lastSeenAt,
        status,
        meta: row.meta ?? null,
      };
    });
    return res.json({
      workers,
      queues: {
        aiModeration: aiQueueCounts,
        aiModerationDlq: aiDlqCounts,
        chatOutbox: {
          twitch: twitchOutboxCounts,
          youtube: youtubeOutboxCounts,
          vkvideo: vkvideoOutboxCounts,
        },
      },
    });
  });
}
