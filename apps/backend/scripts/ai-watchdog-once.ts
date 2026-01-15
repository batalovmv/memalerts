import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/utils/logger.js';
import { runAiWatchdogOnce } from '../src/jobs/aiQueue.js';

async function main() {
  const limit = Number.isFinite(Number(process.env.LIMIT))
    ? Math.max(1, Math.min(5000, Number(process.env.LIMIT)))
    : 500;
  const res = await runAiWatchdogOnce({ limit });
  logger.info('ai_watchdog.completed', res);
}

main()
  .catch((e) => {
    logger.error('ai_watchdog.failed', { errorMessage: e?.message || String(e) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
