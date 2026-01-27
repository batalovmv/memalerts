import { getRedisClient } from '../utils/redisClient.js';
import { nsKey } from '../utils/redisCache.js';

type StreamStatusMeta = {
  status: 'online' | 'offline';
  updatedAt: number;
};

function normalizeSlug(slug: string): string {
  return String(slug || '')
    .trim()
    .toLowerCase();
}

function kStatus(slug: string) {
  return nsKey('streamStatus', `status:${slug}`);
}

function ttlSeconds(): number {
  return 48 * 60 * 60; // 48h
}

async function readMeta(slug: string): Promise<StreamStatusMeta | null> {
  const client = await getRedisClient();
  if (!client) return null;
  const raw = await client.hGetAll(kStatus(slug));
  if (!raw || !raw.status) return null;
  const status = raw.status === 'online' ? 'online' : 'offline';
  const updatedAt = Number(raw.updatedAt);
  return {
    status,
    updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now(),
  };
}

async function writeMeta(slug: string, meta: StreamStatusMeta): Promise<void> {
  const client = await getRedisClient();
  if (!client) return;
  await client.hSet(kStatus(slug), {
    status: meta.status,
    updatedAt: String(meta.updatedAt),
  });
  await client.expire(kStatus(slug), ttlSeconds());
}

export async function handleStreamOnline(channelSlug: string): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  await writeMeta(slug, { status: 'online', updatedAt: Date.now() });
}

export async function handleStreamOffline(channelSlug: string): Promise<void> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return;
  await writeMeta(slug, { status: 'offline', updatedAt: Date.now() });
}

export async function getStreamStatusSnapshot(
  channelSlug: string
): Promise<{ status: 'online' | 'offline' }> {
  const slug = normalizeSlug(channelSlug);
  if (!slug) return { status: 'offline' };
  const meta = await readMeta(slug);
  if (!meta) return { status: 'offline' };
  return { status: meta.status };
}
