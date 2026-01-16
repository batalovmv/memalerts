import type { Prisma, ServiceHeartbeat } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { uniqueId } from './utils.js';

export async function createServiceHeartbeat(
  overrides: Partial<Prisma.ServiceHeartbeatUncheckedCreateInput> = {}
): Promise<ServiceHeartbeat> {
  const seed = uniqueId('heartbeat');
  const data: Prisma.ServiceHeartbeatUncheckedCreateInput = {
    id: `svc_${seed}`,
    ...overrides,
  };
  return prisma.serviceHeartbeat.create({ data });
}
