import express from 'express';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { setupRoutes } from '../src/routes/index.js';
import { prisma } from '../src/lib/prisma.js';

function makeJwt(payload: Record<string, any>): string {
  return jwt.sign(payload, process.env.JWT_SECRET!, { expiresIn: '5m' });
}

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.set('io', { to: () => ({ emit: () => {} }) });
  setupRoutes(app);
  return app;
}

function mockFetchJsonOnce(status: number, json: any) {
  global.fetch = vi.fn(async () => {
    return {
      status,
      json: async () => json,
      text: async () => JSON.stringify(json),
    } as any;
  }) as any;
}

describe('GET /channels/:channelId/boosty-access (discord_roles)', () => {
  const originalEnv = { ...process.env };
  const originalFetch = global.fetch;

  beforeEach(async () => {
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'production';
    process.env.PORT = '3001';
    process.env.DOMAIN = 'example.com';
    process.env.WEB_URL = 'https://example.com';
    process.env.JWT_SECRET = process.env.JWT_SECRET || 'test-secret';

    process.env.DISCORD_BOT_TOKEN = 'bot-token';
    process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID = 'g_default';
    process.env.DISCORD_AUTO_JOIN_GUILD = '1';
  });

  afterEach(async () => {
    process.env = originalEnv;
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('need_discord_link when no Discord external account', async () => {
    const userId = randomUUID();
    const channelId = randomUUID();
    const slug = `ch_${Date.now()}_a`;

    await prisma.user.create({ data: { id: userId, displayName: 'Viewer', role: 'viewer' } as any });
    await prisma.channel.create({
      data: {
        id: channelId,
        slug,
        name: 'Channel',
        boostyDiscordTierRolesJson: [{ tier: 't3', roleId: 'role3' }],
      } as any,
    });

    const token = makeJwt({ userId, role: 'viewer', channelId: null });
    const res = await request(makeApp()).get(`/channels/${channelId}/boosty-access`).set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('need_discord_link');
    expect(res.body?.requiredGuild?.guildId).toBe('g_default');
    expect(res.body?.requiredGuild?.autoJoin).toBe(true);
  });

  it('need_join_guild when Discord user is not in required guild', async () => {
    const userId = randomUUID();
    const channelId = randomUUID();
    const slug = `ch_${Date.now()}_b`;
    const discordUserId = `discord_${randomUUID()}`;

    await prisma.user.create({ data: { id: userId, displayName: 'Viewer', role: 'viewer' } as any });
    await prisma.channel.create({
      data: {
        id: channelId,
        slug,
        name: 'Channel',
        boostyDiscordTierRolesJson: [{ tier: 't3', roleId: 'role3' }],
      } as any,
    });
    await prisma.externalAccount.create({
      data: { userId, provider: 'discord', providerAccountId: discordUserId } as any,
    });

    mockFetchJsonOnce(404, { message: 'Unknown Member' });

    const token = makeJwt({ userId, role: 'viewer', channelId: null });
    const res = await request(makeApp()).get(`/channels/${channelId}/boosty-access`).set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('need_join_guild');
    expect(res.body?.requiredGuild?.guildId).toBe('g_default');
  });

  it('not_subscribed when member roles do not match any configured tier role', async () => {
    const userId = randomUUID();
    const channelId = randomUUID();
    const slug = `ch_${Date.now()}_c`;
    const discordUserId = `discord_${randomUUID()}`;

    await prisma.user.create({ data: { id: userId, displayName: 'Viewer', role: 'viewer' } as any });
    await prisma.channel.create({
      data: {
        id: channelId,
        slug,
        name: 'Channel',
        boostyDiscordTierRolesJson: [{ tier: 't3', roleId: 'role3' }],
      } as any,
    });
    await prisma.externalAccount.create({
      data: { userId, provider: 'discord', providerAccountId: discordUserId } as any,
    });

    mockFetchJsonOnce(200, { roles: ['some_other_role'] });

    const token = makeJwt({ userId, role: 'viewer', channelId: null });
    const res = await request(makeApp()).get(`/channels/${channelId}/boosty-access`).set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('not_subscribed');
    expect(res.body?.tier).toBe(null);
  });

  it('subscribed when member roles match; returns tier', async () => {
    const userId = randomUUID();
    const channelId = randomUUID();
    const slug = `ch_${Date.now()}_d`;
    const discordUserId = `discord_${randomUUID()}`;

    await prisma.user.create({ data: { id: userId, displayName: 'Viewer', role: 'viewer' } as any });
    await prisma.channel.create({
      data: {
        id: channelId,
        slug,
        name: 'Channel',
        boostyDiscordTierRolesJson: [{ tier: 't3', roleId: 'role3' }],
      } as any,
    });
    await prisma.externalAccount.create({
      data: { userId, provider: 'discord', providerAccountId: discordUserId } as any,
    });

    mockFetchJsonOnce(200, { roles: ['role3'] });

    const token = makeJwt({ userId, role: 'viewer', channelId: null });
    const res = await request(makeApp()).get(`/channels/${channelId}/boosty-access`).set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.status).toBe('subscribed');
    expect(res.body?.tier).toBe('t3');
    expect(res.body?.matchedTier).toBe('t3');
    expect(res.body?.matchedRoleId).toBe('role3');
  });

  it('uses per-channel discordSubscriptionsGuildId override when set', async () => {
    const userId = randomUUID();
    const channelId = randomUUID();
    const slug = `ch_${Date.now()}_e`;
    const discordUserId = `discord_${randomUUID()}`;

    await prisma.user.create({ data: { id: userId, displayName: 'Viewer', role: 'viewer' } as any });
    await prisma.channel.create({
      data: {
        id: channelId,
        slug,
        name: 'Channel',
        discordSubscriptionsGuildId: 'g_override',
        boostyDiscordTierRolesJson: [{ tier: 't3', roleId: 'role3' }],
      } as any,
    });
    await prisma.externalAccount.create({
      data: { userId, provider: 'discord', providerAccountId: discordUserId } as any,
    });

    global.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toContain('/guilds/g_override/members/');
      return {
        status: 404,
        json: async () => ({ message: 'Unknown Member' }),
        text: async () => '',
      } as any;
    }) as any;

    const token = makeJwt({ userId, role: 'viewer', channelId: null });
    const res = await request(makeApp()).get(`/channels/${channelId}/boosty-access`).set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.requiredGuild?.guildId).toBe('g_override');
    expect(res.body?.status).toBe('need_join_guild');
  });

  it('falls back to legacy DISCORD_SUBSCRIPTIONS_GUILD_ID when default is not set', async () => {
    process.env.DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID = '';
    process.env.DISCORD_SUBSCRIPTIONS_GUILD_ID = 'g_legacy';

    const userId = randomUUID();
    const channelId = randomUUID();
    const slug = `ch_${Date.now()}_f`;
    const discordUserId = `discord_${randomUUID()}`;

    await prisma.user.create({ data: { id: userId, displayName: 'Viewer', role: 'viewer' } as any });
    await prisma.channel.create({
      data: {
        id: channelId,
        slug,
        name: 'Channel',
        boostyDiscordTierRolesJson: [{ tier: 't3', roleId: 'role3' }],
      } as any,
    });
    await prisma.externalAccount.create({
      data: { userId, provider: 'discord', providerAccountId: discordUserId } as any,
    });

    global.fetch = vi.fn(async (url: any) => {
      expect(String(url)).toContain('/guilds/g_legacy/members/');
      return {
        status: 404,
        json: async () => ({ message: 'Unknown Member' }),
        text: async () => '',
      } as any;
    }) as any;

    const token = makeJwt({ userId, role: 'viewer', channelId: null });
    const res = await request(makeApp()).get(`/channels/${channelId}/boosty-access`).set('Cookie', [`token=${encodeURIComponent(token)}`]);

    expect(res.status).toBe(200);
    expect(res.body?.requiredGuild?.guildId).toBe('g_legacy');
    expect(res.body?.status).toBe('need_join_guild');
  });
});


