import type { Server as HttpServer } from 'http';
import type { Socket } from 'net';
import type { Server as SocketIOServer } from 'socket.io';
import { logger } from '../utils/logger.js';
import { shutdownSocketIO } from '../socket/index.js';
import { isShuttingDown, markShuttingDown } from '../utils/shutdownState.js';

type ShutdownDeps = {
  httpServer: HttpServer;
  io: SocketIOServer;
  shutdownTimeoutMs: number;
  httpDrainTimeoutMs: number;
  getChatBotHandle?: () => { stop?: () => Promise<void> | void } | null;
  getAiModerationWorkerHandle: () => { stop: (opts: { timeoutMs: number }) => Promise<void> } | null;
  getTranscodeWorkerHandle?: () => { stop: (opts: { timeoutMs: number }) => Promise<void> } | null;
  closeBullmqConnection: () => Promise<void>;
  prismaDisconnect: () => Promise<void>;
};

export function setupShutdownHandlers(deps: ShutdownDeps) {
  const { httpServer } = deps;
  const activeHttpConnections = new Set<Socket>();
  httpServer.on('connection', (socket) => {
    activeHttpConnections.add(socket);
    socket.on('close', () => {
      activeHttpConnections.delete(socket);
    });
  });

  async function closeHttpServerWithDrain(timeoutMs: number): Promise<void> {
    if (!httpServer.listening) return;
    await new Promise<void>((resolve) => {
      let settled = false;
      const done = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      };

      const timer = setTimeout(() => {
        logger.warn('shutdown.http_drain_timeout', {
          timeoutMs,
          openConnections: activeHttpConnections.size,
        });
        for (const socket of activeHttpConnections) {
          socket.destroy();
        }
        done();
      }, timeoutMs);
      timer.unref?.();

      try {
        httpServer.close((err) => {
          if (err) logger.error('shutdown.http_close_failed', { errorMessage: err.message });
          done();
        });
        httpServer.closeIdleConnections?.();
      } catch (error) {
        const err = error as Error;
        logger.warn('shutdown.http_close_failed', { errorMessage: err.message });
        done();
      }
    });
  }

  async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    if (!Number.isFinite(ms) || ms <= 0) return await promise;
    let timer: NodeJS.Timeout | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`${label}_timeout_${ms}`)), ms);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function remainingMs(deadlineAt: number): number {
    return Math.max(0, deadlineAt - Date.now());
  }

  async function runShutdownStep(opts: {
    label: string;
    deadlineAt: number;
    maxMs: number;
    action: (budgetMs: number) => Promise<void>;
  }): Promise<void> {
    const { label, deadlineAt, maxMs, action } = opts;
    const remaining = Math.max(0, remainingMs(deadlineAt) - 250);
    const budget = Math.min(maxMs, remaining);
    if (budget <= 0) {
      logger.warn('shutdown.step_skipped', { step: label, reason: 'deadline_reached' });
      return;
    }
    try {
      await withTimeout(action(budget), budget, `shutdown_${label}`);
    } catch (error) {
      const err = error as Error;
      logger.warn(`shutdown.${label}_failed`, { errorMessage: err?.message || String(error), timeoutMs: budget });
    }
  }

  async function shutdown(signal: NodeJS.Signals): Promise<void> {
    if (isShuttingDown()) return;
    markShuttingDown(signal);

    logger.info('shutdown.start', {
      signal,
      timeoutMs: deps.shutdownTimeoutMs,
      httpDrainTimeoutMs: deps.httpDrainTimeoutMs,
    });

    const deadlineAt = Date.now() + deps.shutdownTimeoutMs;
    const timer = setTimeout(() => {
      logger.error('shutdown.timeout', { signal, timeoutMs: deps.shutdownTimeoutMs });
      process.exit(1);
    }, deps.shutdownTimeoutMs);
    timer.unref?.();

    await runShutdownStep({
      label: 'ai_moderation_worker_stop',
      deadlineAt,
      maxMs: Math.min(15000, deps.shutdownTimeoutMs),
      action: (budgetMs) => deps.getAiModerationWorkerHandle()?.stop({ timeoutMs: budgetMs }) ?? Promise.resolve(),
    });

    await runShutdownStep({
      label: 'transcode_worker_stop',
      deadlineAt,
      maxMs: Math.min(15000, deps.shutdownTimeoutMs),
      action: (budgetMs) =>
        deps.getTranscodeWorkerHandle?.()?.stop({ timeoutMs: budgetMs }) ?? Promise.resolve(),
    });

    await runShutdownStep({
      label: 'chatbot_stop',
      deadlineAt,
      maxMs: 5000,
      action: () => deps.getChatBotHandle?.()?.stop?.() ?? Promise.resolve(),
    });

    await runShutdownStep({
      label: 'socketio_close',
      deadlineAt,
      maxMs: 5000,
      action: () =>
        new Promise<void>((resolve, reject) => {
          try {
            shutdownSocketIO(deps.io);
          } catch (error) {
            const err = error as Error;
            logger.warn('shutdown.socketio_emit_failed', { errorMessage: err?.message || String(error) });
          }
          try {
            void deps.io.close(() => resolve());
          } catch (error) {
            reject(error);
          }
        }),
    });

    await runShutdownStep({
      label: 'http_drain',
      deadlineAt,
      maxMs: Math.min(deps.httpDrainTimeoutMs + 1000, deps.shutdownTimeoutMs),
      action: () => closeHttpServerWithDrain(deps.httpDrainTimeoutMs),
    });

    await runShutdownStep({
      label: 'prisma_disconnect',
      deadlineAt,
      maxMs: 5000,
      action: () => deps.prismaDisconnect(),
    });
    await runShutdownStep({
      label: 'bullmq_disconnect',
      deadlineAt,
      maxMs: 3000,
      action: () => deps.closeBullmqConnection(),
    });

    clearTimeout(timer);
    logger.info('shutdown.complete', { signal });
    process.exit(0);
  }

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
