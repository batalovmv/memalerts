import { prisma } from '../lib/prisma.js';

export async function tryAcquireAdvisoryLock(lockId: bigint): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>`
    SELECT pg_try_advisory_lock(${lockId}) as locked
  `;
  return !!rows?.[0]?.locked;
}

export async function releaseAdvisoryLock(lockId: bigint): Promise<void> {
  try {
    await prisma.$queryRaw<Array<{ unlocked: boolean }>>`
      SELECT pg_advisory_unlock(${lockId}) as unlocked
    `;
  } catch {
    // ignore
  }
}
