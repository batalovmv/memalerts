import type { Channel, ExternalAccount, Prisma, User } from '@prisma/client';
import { prisma } from '../../src/lib/prisma.js';
import { createChannel } from './channelFactory.js';
import { uniqueId } from './utils.js';

export async function createUser(overrides: Partial<Prisma.UserUncheckedCreateInput> = {}): Promise<User> {
  const seed = uniqueId('user');
  const data: Prisma.UserUncheckedCreateInput = {
    displayName: `User ${seed}`,
    role: 'viewer',
    hasBetaAccess: false,
    channelId: null,
    ...overrides,
  };
  return prisma.user.create({ data });
}

export async function createUserWithChannel(
  userOverrides: Partial<Prisma.UserUncheckedCreateInput> = {},
  channelOverrides: Partial<Prisma.ChannelUncheckedCreateInput> = {}
): Promise<{ user: User; channel: Channel }> {
  const channel = await createChannel(channelOverrides);
  const user = await createUser({ ...userOverrides, channelId: channel.id });
  return { user, channel };
}

export async function createExternalAccount(
  overrides: Partial<Prisma.ExternalAccountUncheckedCreateInput> = {}
): Promise<ExternalAccount> {
  const seed = uniqueId('external');
  let userId = overrides.userId;
  if (!userId) {
    const user = await createUser();
    userId = user.id;
  }

  const data: Prisma.ExternalAccountUncheckedCreateInput = {
    userId,
    provider: 'twitch',
    providerAccountId: `provider_${seed}`,
    ...overrides,
  };
  return prisma.externalAccount.create({ data });
}
