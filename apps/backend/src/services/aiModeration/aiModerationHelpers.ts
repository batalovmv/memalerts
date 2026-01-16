import type { Prisma } from '@prisma/client';
import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { pipeline } from 'stream/promises';
import { prisma } from '../../lib/prisma.js';

export type AiModerationDecision = 'low' | 'medium' | 'high';

export function tryExtractSha256FromUploadsPath(fileUrlOrPath: string | null | undefined): string | null {
  const s = String(fileUrlOrPath || '');
  const m = s.match(/\/uploads\/memes\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i);
  return m ? m[1]!.toLowerCase() : null;
}

export function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

export function normalizeAiText(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[""<>"]/g, '')
    .trim();
}

export function extractTitleTokens(titleRaw: unknown): string[] {
  const title = normalizeAiText(String(titleRaw ?? ''));
  if (!title) return [];
  const cleaned = title.replace(/[^a-z0-9а-яё]+/gi, ' ');
  const tokens = cleaned
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens));
}

export function isEffectivelyEmptyAiDescription(descRaw: unknown, titleRaw: unknown): boolean {
  const desc = normalizeAiText(String(descRaw ?? ''));
  if (!desc) return true;

  const title = normalizeAiText(String(titleRaw ?? ''));
  if (title && desc === title) return true;

  const placeholders = new Set([
    'мем',
    'meme',
    'ai tags',
    'ai tag',
    'tags',
    'теги',
    'описание',
    'description',
    'ai description',
  ]);
  if (placeholders.has(desc)) return true;

  if (desc === 'мем ai tags мем' || desc === 'meme ai tags meme') return true;

  return false;
}

export function hasReusableAiTags(tagNamesJsonRaw: unknown, titleRaw: unknown, descRaw: unknown): boolean {
  const arr = Array.isArray(tagNamesJsonRaw) ? (tagNamesJsonRaw as unknown[]) : [];
  if (arr.length === 0) return false;

  const placeholders = new Set(['мем', 'meme', 'тест', 'test', 'ai tags', 'ai tag', 'tags', 'теги']);

  const nonPlaceholder = arr
    .map((t) => normalizeAiText(String(t ?? '')))
    .filter(Boolean)
    .filter((t) => !placeholders.has(t));
  if (nonPlaceholder.length === 0) return false;

  if (isEffectivelyEmptyAiDescription(descRaw, titleRaw)) {
    const titleTokens = new Set(extractTitleTokens(titleRaw));
    if (titleTokens.size > 0) {
      const allFromTitle = nonPlaceholder.every((t) => titleTokens.has(t));
      if (allFromTitle) return false;
    }
  }

  return nonPlaceholder.some((t) => {
    const n = normalizeAiText(String(t ?? ''));
    if (!n) return false;
    return !placeholders.has(n);
  });
}

export function validateAiOutputOrThrow(opts: {
  title: string;
  autoDescription: string | null;
  autoTags: string[] | null | undefined;
}) {
  const hasValidDescription = !isEffectivelyEmptyAiDescription(opts.autoDescription, opts.title);
  const hasValidTags = hasReusableAiTags(opts.autoTags, opts.title, opts.autoDescription);
  if (!hasValidDescription || !hasValidTags) {
    throw new Error('ai_output_invalid');
  }
}

export function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

export async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  if (!Number.isFinite(ms) || ms <= 0) return await p;
  let t: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      p,
      new Promise<T>((_, reject) => {
        t = setTimeout(() => reject(new Error(`${label}_timeout_${ms}`)), ms);
      }),
    ]);
  } finally {
    if (t) clearTimeout(t);
  }
}

export function isAllowedPublicFileUrl(p: string): boolean {
  const s = String(p || '').trim();
  if (!s) return false;
  if (s.startsWith('/uploads/')) return true;
  const s3Base = String(process.env.S3_PUBLIC_BASE_URL || '').trim();
  if (s3Base) {
    const base = s3Base.endsWith('/') ? s3Base : `${s3Base}/`;
    return s.startsWith(base) || s === s3Base;
  }
  return false;
}

export async function downloadPublicFileToDisk(opts: {
  url: string;
  destPath: string;
  maxBytes: number;
}): Promise<void> {
  const { url, destPath, maxBytes } = opts;
  const res = await fetch(url, { method: 'GET' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`download_http_${res.status}:${txt || res.statusText}`);
  }

  const len = Number(res.headers.get('content-length') || '0');
  if (len && Number.isFinite(len) && len > maxBytes) {
    throw new Error('download_too_large');
  }

  await fs.promises.mkdir(path.dirname(destPath), { recursive: true });
  const ws = fs.createWriteStream(destPath);
  let seen = 0;

  try {
    if (!res.body) {
      throw new Error('download_empty_body');
    }
    const rs = Readable.fromWeb(res.body as unknown as NodeReadableStream<Uint8Array>);
    rs.on('data', (chunk) => {
      seen += Buffer.byteLength(chunk);
      if (seen > maxBytes) {
        rs.destroy(new Error('download_too_large'));
      }
    });
    await pipeline(rs, ws);
  } catch (e) {
    try {
      ws.destroy();
    } catch {
      // ignore
    }
    try {
      await fs.promises.rm(destPath, { force: true });
    } catch {
      // ignore
    }
    throw e;
  }
}

export function computeKeywordHeuristic(
  title: string,
  notes: string | null | undefined
): {
  decision: AiModerationDecision;
  riskScore: number;
  labels: string[];
  tagNames: string[];
  reason: string;
} {
  const t = `${title || ''}\n${notes || ''}`.toLowerCase();

  const high = ['porn', 'nsfw', 'sex', 'nude', 'naz', 'hitler', 'swastika'];
  const medium = ['18+', 'adult', 'violence', 'blood', 'gore'];

  const labels: string[] = [];
  for (const w of high) if (t.includes(w)) labels.push(`kw:${w}`);
  for (const w of medium) if (t.includes(w)) labels.push(`kw:${w}`);

  if (labels.some((l) => high.some((w) => l === `kw:${w}`))) {
    return { decision: 'high', riskScore: 0.9, labels, tagNames: ['nsfw'], reason: 'ai:keyword_high' };
  }
  if (labels.length > 0) {
    return { decision: 'medium', riskScore: 0.5, labels, tagNames: ['review'], reason: 'ai:keyword_medium' };
  }
  return { decision: 'low', riskScore: 0.1, labels, tagNames: [], reason: 'ai:keyword_low' };
}

export async function upsertQuarantineAsset(opts: {
  fileHash: string;
  fileUrl: string | null;
  durationMs: number;
  decision: AiModerationDecision;
  reason: string;
  quarantineDays: number;
}): Promise<void> {
  const { fileHash, fileUrl, durationMs, decision, reason, quarantineDays } = opts;
  const now = new Date();

  await prisma.$transaction(async (tx) => {
    const existing = await tx.memeAsset.findFirst({
      where: { fileHash },
      select: {
        id: true,
        fileUrl: true,
        durationMs: true,
        poolVisibility: true,
        poolHiddenAt: true,
        poolHiddenByUserId: true,
        poolHiddenReason: true,
        purgeRequestedAt: true,
        purgedAt: true,
        purgeByUserId: true,
        purgeReason: true,
      },
    });

    if (!existing) {
      const data: Prisma.MemeAssetUncheckedCreateInput = {
        type: 'video',
        fileHash,
        fileUrl,
        durationMs,
        poolVisibility: decision === 'low' ? 'visible' : 'hidden',
        poolHiddenAt: decision === 'low' ? null : now,
        poolHiddenReason: decision === 'low' ? null : reason,
      };
      if (decision === 'high') {
        data.purgeRequestedAt = now;
        data.purgeNotBefore = new Date(now.getTime() + Math.max(0, quarantineDays) * 24 * 60 * 60 * 1000);
        data.purgeReason = reason;
      }
      await tx.memeAsset.create({ data });
      return;
    }

    const aiOwnsHidden =
      (!existing.poolHiddenReason || String(existing.poolHiddenReason).startsWith('ai:')) &&
      !existing.poolHiddenByUserId;
    const aiOwnsPurge =
      (!existing.purgeReason || String(existing.purgeReason).startsWith('ai:')) && !existing.purgeByUserId;

    if (!aiOwnsHidden && !aiOwnsPurge) return;

    const data: Prisma.MemeAssetUpdateInput = {};
    if (decision !== 'low') {
      if (aiOwnsHidden) {
        data.poolVisibility = 'hidden';
        data.poolHiddenAt = existing.poolHiddenAt ?? now;
        data.poolHiddenReason = reason;
      }
    }
    if (decision === 'high') {
      if (aiOwnsPurge && !existing.purgeRequestedAt && !existing.purgedAt) {
        data.purgeRequestedAt = now;
        data.purgeNotBefore = new Date(now.getTime() + Math.max(0, quarantineDays) * 24 * 60 * 60 * 1000);
        data.purgeReason = reason;
      }
    }

    if (aiOwnsHidden || aiOwnsPurge) {
      if (!existing.fileUrl && fileUrl) data.fileUrl = fileUrl;
      if (!existing.durationMs && durationMs) data.durationMs = durationMs;
    }

    if (Object.keys(data).length > 0) {
      await tx.memeAsset.update({ where: { id: existing.id }, data });
    }
  });
}
