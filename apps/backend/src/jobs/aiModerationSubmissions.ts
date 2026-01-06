import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { releaseAdvisoryLock, tryAcquireAdvisoryLock } from '../utils/pgAdvisoryLock.js';
import { approveSubmissionInternal } from '../services/approveSubmissionInternal.js';
import { validatePathWithinDirectory } from '../utils/pathSecurity.js';
import { Prisma } from '@prisma/client';
import path from 'path';
import fs from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { extractAudioToMp3 } from '../utils/ai/extractAudio.js';
import { transcribeAudioOpenAI } from '../utils/ai/openaiAsr.js';
import { moderateTextOpenAI } from '../utils/ai/openaiTextModeration.js';
import { generateTagNames } from '../utils/ai/tagging.js';
import { makeAutoDescription } from '../utils/ai/description.js';
import { extractFramesJpeg } from '../utils/ai/extractFrames.js';
import { generateMemeMetadataOpenAI } from '../utils/ai/openaiMemeMetadata.js';
import { auditLog } from '../utils/auditLogger.js';
import { calculateFileHash } from '../utils/fileHash.js';

type AiModerationDecision = 'low' | 'medium' | 'high';

type AiModerationRunStats = {
  claimed: number;
  processed: number;
  failed: number;
  durationMs: number;
};

type AiModerationSchedulerStatus = {
  enabled: boolean;
  disabledReason: string | null;
  openaiApiKeySet: boolean;
  intervalMs: number | null;
  lastRunStartedAt: string | null;
  lastRunCompletedAt: string | null;
  lastRunStats: AiModerationRunStats | null;
};

const aiSchedulerStatus: AiModerationSchedulerStatus = {
  enabled: false,
  disabledReason: null,
  openaiApiKeySet: false,
  intervalMs: null,
  lastRunStartedAt: null,
  lastRunCompletedAt: null,
  lastRunStats: null,
};

export function getAiModerationSchedulerStatus(): AiModerationSchedulerStatus {
  return { ...aiSchedulerStatus, lastRunStats: aiSchedulerStatus.lastRunStats ? { ...aiSchedulerStatus.lastRunStats } : null };
}

function tryExtractSha256FromUploadsPath(fileUrlOrPath: string | null | undefined): string | null {
  const s = String(fileUrlOrPath || '');
  // Typical local path: /uploads/memes/<sha256>.<ext>
  // We only trust a strict 64-hex prefix to avoid false positives.
  const m = s.match(/\/uploads\/memes\/([a-f0-9]{64})(?:\.[a-z0-9]+)?$/i);
  return m ? m[1]!.toLowerCase() : null;
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function normalizeAiText(s: string): string {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[“”«»"]/g, '')
    .trim();
}

function extractTitleTokens(titleRaw: unknown): string[] {
  const title = normalizeAiText(String(titleRaw ?? ''));
  if (!title) return [];
  // Keep letters/numbers, treat other chars as separators.
  const cleaned = title.replace(/[^a-z0-9а-яё]+/gi, ' ');
  const tokens = cleaned
    .split(' ')
    .map((t) => t.trim())
    .filter(Boolean)
    // Ignore very short tokens (noise).
    .filter((t) => t.length >= 2);
  return Array.from(new Set(tokens));
}

/**
 * Some UIs/legacy paths can end up with placeholder AI fields like "Мем".
 * Those should NOT be treated as reusable "AI done" metadata, otherwise duplicates never get real analysis.
 */
function isEffectivelyEmptyAiDescription(descRaw: unknown, titleRaw: unknown): boolean {
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

function hasReusableAiTags(tagNamesJsonRaw: unknown, titleRaw: unknown, descRaw: unknown): boolean {
  const arr = Array.isArray(tagNamesJsonRaw) ? (tagNamesJsonRaw as unknown[]) : [];
  if (arr.length === 0) return false;

  const placeholders = new Set([
    'мем',
    'meme',
    'тест',
    'test',
    'ai tags',
    'ai tag',
    'tags',
    'теги',
  ]);

  const nonPlaceholder = arr
    .map((t) => normalizeAiText(String(t ?? '')))
    .filter(Boolean)
    .filter((t) => !placeholders.has(t));
  if (nonPlaceholder.length === 0) return false;

  // If description is effectively empty and tags are just tokenized title words,
  // treat this as "no real AI" (avoid locking in heuristic results).
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

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function fnv1a32(input: string): number {
  // Deterministic, fast hash for advisory-lock partitioning (NOT crypto).
  let h = 0x811c9dc5; // offset basis
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    // h *= 16777619 (FNV prime) but in 32-bit.
    h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
  }
  return h >>> 0;
}

function computeAiSchedulerLockId(): bigint {
  // Important for shared-DB beta+prod: do NOT use a single global lock across all instances.
  // Otherwise one instance can starve the other, and with local uploads it may not have the files.
  const base = 421399n;
  const key = `${process.env.INSTANCE || ''}|${process.cwd()}`;
  const h = fnv1a32(key);
  // Keep it close to base to reduce the chance of colliding with other unrelated locks.
  return base + BigInt(h % 100000);
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
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

function isAllowedPublicFileUrl(p: string): boolean {
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

async function downloadPublicFileToDisk(opts: { url: string; destPath: string; maxBytes: number }): Promise<void> {
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
    // Node 18+: Response.body is a web ReadableStream; convert it to Node stream.
    const rs = Readable.fromWeb(res.body as any);
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

function computeKeywordHeuristic(title: string, notes: string | null | undefined): {
  decision: AiModerationDecision;
  riskScore: number;
  labels: string[];
  tagNames: string[];
  reason: string;
} {
  const t = `${title || ''}\n${notes || ''}`.toLowerCase();

  // Minimal, deterministic heuristic (placeholder until real ML pipeline is plugged in).
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

async function upsertQuarantineAsset(opts: {
  fileHash: string;
  fileUrl: string | null;
  durationMs: number;
  decision: AiModerationDecision;
  reason: string;
  quarantineDays: number;
}): Promise<void> {
  const { fileHash, fileUrl, durationMs, decision, reason, quarantineDays } = opts;
  const now = new Date();

  // Atomic: find/create/update in a single transaction to avoid any visibility flicker.
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
      const data: any = {
        type: 'video',
        fileHash,
        fileUrl,
        durationMs,
        // MEDIUM/HIGH always create as hidden (no visible moment).
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

    // Do not interfere with manual moderation decisions.
    const aiOwnsHidden = (!existing.poolHiddenReason || String(existing.poolHiddenReason).startsWith('ai:')) && !existing.poolHiddenByUserId;
    const aiOwnsPurge = (!existing.purgeReason || String(existing.purgeReason).startsWith('ai:')) && !existing.purgeByUserId;

    // If a human already decided (and it's not AI-owned), do not touch anything (including fileUrl/durationMs).
    if (!aiOwnsHidden && !aiOwnsPurge) return;

    const data: any = {};
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

    // Fill missing fileUrl/durationMs only if AI owns the decision and the fields are missing.
    if (aiOwnsHidden || aiOwnsPurge) {
      if (!existing.fileUrl && fileUrl) data.fileUrl = fileUrl;
      if (!existing.durationMs && durationMs) data.durationMs = durationMs;
    }

    if (Object.keys(data).length > 0) {
      await tx.memeAsset.update({ where: { id: existing.id }, data });
    }
  });
}

export async function processOneSubmission(submissionId: string): Promise<void> {
  const now = new Date();

  const submission = await prisma.memeSubmission.findUnique({
    where: { id: submissionId },
    select: {
      id: true,
      channelId: true,
      submitterUserId: true,
      memeAssetId: true,
      title: true,
      notes: true,
      status: true,
      sourceKind: true,
      fileUrlTemp: true,
      fileHash: true,
      durationMs: true,
      aiStatus: true,
      aiRetryCount: true,
    },
  });

  if (!submission) return;
  if (submission.status !== 'pending' && submission.status !== 'approved') return;
  {
    const sk = String(submission.sourceKind || '').toLowerCase();
    if (sk !== 'upload' && sk !== 'url') return;
  }

  // Validate fileUrlTemp / resolve local path if needed (best-effort).
  const fileUrl = submission.fileUrlTemp ? String(submission.fileUrlTemp) : '';
  let localPath: string | null = null;
  let localFileExists = false;
  let localRootUsed: string | null = null;
  if (fileUrl.startsWith('/uploads/')) {
    const rel = fileUrl.replace(/^\/uploads\//, '');
    // Back-compat + ops safety:
    // - Static serving supports both UPLOAD_DIR and legacy ./uploads (see src/index.ts).
    // - AI pipeline should be resilient to UPLOAD_DIR misconfiguration during deploy.
    const roots = Array.from(
      new Set([path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads'), path.resolve(process.cwd(), './uploads')])
    );

    for (const r of roots) {
      const candidate = validatePathWithinDirectory(rel, r);
      if (fs.existsSync(candidate)) {
        localPath = candidate;
        localFileExists = true;
        localRootUsed = r;
        break;
      }
      // Keep the first candidate for better error messages / hashing attempts.
      if (!localPath) {
        localPath = candidate;
        localRootUsed = r;
      }
    }
  }

  // Some historical / URL-imported submissions might have fileHash missing (hashing timeout / older code).
  // Best-effort: recover it from fileUrlTemp when it looks like /uploads/memes/<sha256>.<ext>.
  let fileHash = submission.fileHash ? String(submission.fileHash) : null;
  if (!fileHash) {
    const recovered = tryExtractSha256FromUploadsPath(submission.fileUrlTemp);
    if (recovered) {
      fileHash = recovered;
      await prisma.memeSubmission.update({
        where: { id: submissionId },
        data: { fileHash: recovered },
      });
    }
  }
  // If still missing and we have a local file, compute hash now (this makes AI resilient to upload-time hash timeouts).
  if (!fileHash && localPath) {
    if (!localFileExists) {
      logger.warn('ai_moderation.file_missing', {
        submissionId,
        fileUrl,
        uploadDirEnv: process.env.UPLOAD_DIR || null,
        localRootUsed,
        reason: 'missing_file_on_disk_before_hash',
      });
      throw new Error('missing_file_on_disk');
    }
    const hashTimeoutMs = clampInt(
      parseInt(String(process.env.AI_FILEHASH_TIMEOUT_MS || ''), 10),
      5_000,
      10 * 60_000,
      2 * 60_000
    );
    const computed = await withTimeout(calculateFileHash(localPath), hashTimeoutMs, 'ai_filehash');
    fileHash = computed;
    await prisma.memeSubmission.update({
      where: { id: submissionId },
      data: { fileHash: computed },
    });
  }
  const durationMs =
    Number.isFinite(submission.durationMs as any) && (submission.durationMs as number) > 0 ? (submission.durationMs as number) : null;
  if (!fileHash) throw new Error('missing_filehash');

  // Global dedup: if this exact fileHash already has AI results in MemeAsset, reuse them
  // (skip rerunning analysis for duplicates).
  const existingAsset = await prisma.memeAsset.findFirst({
    where: { fileHash, aiStatus: 'done' },
    select: { id: true, aiAutoTitle: true, aiAutoDescription: true, aiAutoTagNamesJson: true, aiSearchText: true },
  });

  if (existingAsset) {
    const hasReusableDescription = !isEffectivelyEmptyAiDescription(existingAsset.aiAutoDescription, submission.title);
    const hasReusableTags = hasReusableAiTags(existingAsset.aiAutoTagNamesJson, submission.title, existingAsset.aiAutoDescription);
    if (!hasReusableDescription && !hasReusableTags) {
      logger.info('ai_moderation.dedup.skip_reuse_placeholder', {
        submissionId,
        fileHash,
        memeAssetId: existingAsset.id,
        reason: 'placeholder_ai_fields',
      });
    } else {
    const tagNamesJson =
      existingAsset.aiAutoTagNamesJson === null ? Prisma.DbNull : (existingAsset.aiAutoTagNamesJson as Prisma.InputJsonValue);
    await prisma.memeSubmission.update({
      where: { id: submissionId },
      data: {
        aiStatus: 'done',
        aiDecision: null,
        aiRiskScore: null,
        aiLabelsJson: Prisma.DbNull,
        aiTranscript: null,
        aiAutoTagNamesJson: tagNamesJson,
        aiAutoDescription: existingAsset.aiAutoDescription ?? null,
        aiModelVersionsJson: {
          pipelineVersion: 'v3-reuse-memeasset',
          reuse: {
            hasReusableDescription,
            hasReusableTags,
            titleTokens: extractTitleTokens(submission.title),
            assetAiAutoDescriptionNorm: normalizeAiText(String(existingAsset.aiAutoDescription ?? '')),
            assetAiAutoTagNamesNorm: Array.isArray(existingAsset.aiAutoTagNamesJson)
              ? (existingAsset.aiAutoTagNamesJson as any[]).map((t) => normalizeAiText(String(t ?? ''))).filter(Boolean)
              : null,
          },
        } as any,
        aiCompletedAt: now,
        aiError: null,
        aiNextRetryAt: null,
      },
    });

    const assetId = submission.memeAssetId ?? existingAsset.id;
    await prisma.channelMeme.updateMany({
      where: { channelId: submission.channelId, memeAssetId: assetId },
      data: {
        aiAutoDescription: existingAsset.aiAutoDescription ?? null,
        aiAutoTagNamesJson: tagNamesJson,
        searchText: existingAsset.aiSearchText ?? (existingAsset.aiAutoDescription ? String(existingAsset.aiAutoDescription).slice(0, 4000) : null),
      },
    });

    // Only set title if user hasn't edited it (still equals original submission.title).
    if (existingAsset.aiAutoTitle) {
      await prisma.channelMeme.updateMany({
        where: { channelId: submission.channelId, memeAssetId: assetId, title: submission.title },
        data: { title: String(existingAsset.aiAutoTitle).slice(0, 80) },
      });
    }

    return;
    }
  }

  // If the submission points at a local /uploads/* path but the file is missing on disk,
  // fail and let the scheduler retry. (But dedup above must still work even if the file is gone.)
  if (fileUrl.startsWith('/uploads/') && localPath && !localFileExists) {
    logger.warn('ai_moderation.file_missing', {
      submissionId,
      fileUrl,
      uploadDirEnv: process.env.UPLOAD_DIR || null,
      localRootUsed,
      reason: 'missing_file_on_disk_before_processing',
    });
    throw new Error('missing_file_on_disk');
  }

  // Try “real” AI pipeline when possible; otherwise fall back to deterministic keyword heuristic.
  let decision: AiModerationDecision;
  let riskScore = 0.0;
  let labels: string[] = [];
  let autoTags: string[] = [];
  let transcript: string | null = null;
  let aiTitle: string | null = null;
  let metaDescription: string | null = null;
  let reason = 'ai:keyword_fallback';
  const modelVersions: any = { pipelineVersion: 'v2-openai-asr-moderation' };

  const openaiEnabled = !!String(process.env.OPENAI_API_KEY || '').trim();
  if (openaiEnabled && (localPath || (fileUrl && isAllowedPublicFileUrl(fileUrl)))) {
    const maxTags = clampInt(parseInt(String(process.env.AI_TAG_LIMIT || ''), 10), 1, 20, 5);
    // Temporary working directory (cleaned up in finally).
    const tmpDir = path.join(process.cwd(), 'uploads', 'temp', `ai-${submissionId}`);
    let audioPath: string | null = null;
    let inputPath: string | null = null;
    try {
      if (localPath) {
        inputPath = localPath;
      } else {
        // Public URL case (e.g. S3): download to tmp first, then run ffmpeg locally.
        // Safety: restricted by isAllowedPublicFileUrl() to /uploads/* or S3_PUBLIC_BASE_URL.
        const ext = (() => {
          try {
            return path.extname(new URL(fileUrl).pathname) || '.mp4';
          } catch {
            return '.mp4';
          }
        })();
        inputPath = path.join(tmpDir, `input${ext}`);
        const maxBytes = clampInt(parseInt(String(process.env.AI_DOWNLOAD_MAX_BYTES || ''), 10), 1_000_000, 200_000_000, 60_000_000);
        await downloadPublicFileToDisk({ url: fileUrl, destPath: inputPath, maxBytes });
        modelVersions.download = { maxBytes, source: 'public_url' };
      }

      // ASR (optional): some videos can be silent / have no audio stream.
      try {
        audioPath = await extractAudioToMp3({ inputVideoPath: inputPath, outputDir: tmpDir, baseName: 'audio' });
      } catch (e: any) {
        const msg = String(e?.message || e || '');
        // Common ffmpeg error for videos without audio stream.
        if (msg.toLowerCase().includes('does not contain any stream') || msg.toLowerCase().includes('no stream')) {
          audioPath = null;
          modelVersions.audio = { skipped: 'no_audio_stream', error: msg.slice(0, 200) };
        } else {
          throw e;
        }
      }

      if (audioPath) {
        const asrLanguageEnv = String(process.env.OPENAI_ASR_LANGUAGE || '').trim();
        const asrLanguageAuto = /[а-яё]/i.test(String(submission.title || '')) ? 'ru' : '';
        const asrLanguage = asrLanguageEnv || asrLanguageAuto || undefined;
        const asr = await transcribeAudioOpenAI({ audioFilePath: audioPath, language: asrLanguage });
        transcript = asr.transcript;
        modelVersions.asrModel = asr.model;

        const mod = await moderateTextOpenAI({ text: transcript || '' });
        modelVersions.moderationModel = mod.model;
        labels = [...labels, ...mod.labels];
        riskScore = Math.max(riskScore, mod.riskScore);
        reason = mod.flagged ? 'ai:text_flagged' : 'ai:text_ok';
      } else {
        // No transcript possible; still run a lightweight heuristic on title/notes to keep moderation signal.
        const heuristic = computeKeywordHeuristic(String(submission.title || ''), submission.notes);
        riskScore = Math.max(riskScore, heuristic.riskScore);
        labels = [...labels, ...heuristic.labels];
        reason = 'ai:no_audio_stream';
      }

      // Vision + metadata generation (title/tags/description).
      const metaEnabled = parseBool(process.env.AI_METADATA_ENABLED ?? '1');
      if (metaEnabled) {
        const visionEnabled = parseBool(process.env.AI_VISION_ENABLED ?? '1');
        let frames: string[] = [];
        if (visionEnabled && inputPath) {
          const maxFrames = clampInt(parseInt(String(process.env.AI_VISION_MAX_FRAMES || ''), 10), 1, 12, 8);
          const stepSeconds = clampInt(parseInt(String(process.env.AI_VISION_STEP_SECONDS || ''), 10), 1, 10, 2);
          frames = await extractFramesJpeg({ inputVideoPath: inputPath, outputDir: tmpDir, maxFrames, stepSeconds, width: 512 });
          modelVersions.vision = { maxFrames, stepSeconds };
        }

        const meta = await generateMemeMetadataOpenAI({
          titleHint: submission.title,
          transcript,
          labels,
          framePaths: frames,
          maxTags,
        });
        modelVersions.metadataModel = meta.model;
        aiTitle = meta.title;
        autoTags = meta.tags;
        metaDescription = meta.description;
      }

      // Fallback tags (if metadata generation is disabled or returned empty tags).
      if (!autoTags || autoTags.length === 0) {
        const tagRes = generateTagNames({ title: submission.title, transcript, labels, maxTags });
        if (tagRes.lowConfidence) labels = [...labels, 'low_confidence'];
        autoTags = tagRes.tagNames;
      }

      const mediumT = Math.max(0, Math.min(1, Number(process.env.AI_MODERATION_MEDIUM_THRESHOLD ?? 0.4)));
      const highT = Math.max(0, Math.min(1, Number(process.env.AI_MODERATION_HIGH_THRESHOLD ?? 0.7)));
      decision = riskScore >= highT ? 'high' : riskScore >= mediumT ? 'medium' : 'low';
    } catch (e: any) {
      const msg = String(e?.message || e || '');
      // OpenAI can be region-blocked from certain VPS locations (403 unsupported_country_region_territory).
      // In that case, do NOT retry forever: fall back to heuristic and mark the submission done.
      if (msg.includes('unsupported_country_region_territory') || msg.startsWith('openai_http_403') || msg === 'OPENAI_API_KEY_not_set') {
        const heuristic = computeKeywordHeuristic(String(submission.title || ''), submission.notes);
        decision = heuristic.decision;
        riskScore = heuristic.riskScore;
        labels = heuristic.labels;
        const tagRes = generateTagNames({ title: submission.title, transcript: null, labels, maxTags: 6 });
        autoTags = heuristic.tagNames.length > 0 ? heuristic.tagNames : tagRes.tagNames;
        reason = 'ai:openai_unavailable';
        modelVersions.pipelineVersion = 'v1-keyword-heuristic';
        modelVersions.openaiError = msg.slice(0, 500);
        transcript = null;
      } else {
        throw e;
      }
    } finally {
      // Cleanup tmp directory best-effort.
      try {
        await fs.promises.rm(tmpDir, { recursive: true, force: true });
      } catch {
        // ignore
      }
    }
  } else {
    const heuristic = computeKeywordHeuristic(String(submission.title || ''), submission.notes);
    decision = heuristic.decision;
    riskScore = heuristic.riskScore;
    labels = heuristic.labels;
    const tagRes = generateTagNames({ title: submission.title, transcript: null, labels, maxTags: 6 });
    autoTags = heuristic.tagNames.length > 0 ? heuristic.tagNames : tagRes.tagNames;
    reason = heuristic.reason;
    modelVersions.pipelineVersion = 'v1-keyword-heuristic';
  }

  // MEDIUM/HIGH: create/update stub asset and hide/quarantine ASAP.
  if (decision !== 'low' && durationMs !== null) {
    const quarantineDays = clampInt(parseInt(String(process.env.AI_QUARANTINE_DAYS || ''), 10), 0, 365, 14);
    const publicFileUrl = fileUrl && isAllowedPublicFileUrl(fileUrl) ? String(fileUrl) : null;
    if (!publicFileUrl) {
      throw new Error('unexpected_file_url');
    }
    await upsertQuarantineAsset({
      fileHash,
      fileUrl: publicFileUrl,
      durationMs,
      decision,
      reason,
      quarantineDays,
    });
  }

  // Persist AI results on submission.
  // Description: detailed, can include transcript text (but limited by 2000 chars field).
  const baseDescription = metaDescription ?? makeAutoDescription({ title: submission.title, transcript, labels });
  const transcriptText = transcript ? String(transcript).slice(0, 50000) : null;
  const autoDescription = (() => {
    const base = baseDescription ? String(baseDescription).trim() : '';
    const t = transcriptText ? String(transcriptText).trim() : '';
    if (!t) return base ? base.slice(0, 2000) : null;
    const prefix = base ? `${base}\n\nТранскрипт:\n` : `Транскрипт:\n`;
    const room = 2000 - prefix.length;
    if (room <= 0) return prefix.slice(0, 2000);
    return (prefix + t.slice(0, room)).slice(0, 2000);
  })();
  await prisma.memeSubmission.update({
    where: { id: submissionId },
    data: {
      aiStatus: 'done',
      aiDecision: decision,
      aiRiskScore: riskScore,
      aiLabelsJson: labels,
      aiTranscript: transcriptText,
      aiAutoTagNamesJson: autoTags,
      aiAutoDescription: autoDescription,
      aiModelVersionsJson: modelVersions as any,
      aiCompletedAt: now,
      aiError: null,
      aiNextRetryAt: null,
    },
  });

  // Persist AI results globally on MemeAsset (per fileHash) when possible.
  const aiSearchText = (() => {
    const parts = [
      aiTitle ? String(aiTitle) : submission.title ? String(submission.title) : '',
      Array.isArray(autoTags) && autoTags.length > 0 ? autoTags.join(' ') : '',
      autoDescription ? String(autoDescription) : '',
    ]
      .map((s) => String(s || '').trim())
      .filter(Boolean);
    const merged = parts.join('\n');
    return merged ? merged.slice(0, 4000) : null;
  })();
  const assetToUpdate =
    submission.memeAssetId ??
    (
      await prisma.memeAsset.findFirst({
        where: { fileHash },
        select: { id: true },
      })
    )?.id ??
    null;

  if (assetToUpdate) {
    await prisma.memeAsset.update({
      where: { id: assetToUpdate },
      data: {
        aiStatus: 'done',
        aiAutoTitle: aiTitle ? String(aiTitle).slice(0, 80) : null,
        aiAutoDescription: autoDescription ? String(autoDescription).slice(0, 2000) : null,
        aiAutoTagNamesJson: autoTags,
        aiSearchText,
        aiCompletedAt: now,
      },
    });
  }

  // Best-effort: copy AI fields into ChannelMeme so includeAi=1 and channel search (searchText) work
  // even when a submission was approved directly (owner bypass) before AI finished.
  const assetIdForChannelMeme = submission.memeAssetId ?? assetToUpdate;
  if (assetIdForChannelMeme) {
    await prisma.channelMeme.updateMany({
      where: { channelId: submission.channelId, memeAssetId: assetIdForChannelMeme },
      data: {
        aiAutoDescription: autoDescription ? String(autoDescription).slice(0, 2000) : null,
        aiAutoTagNamesJson: autoTags,
        searchText: aiSearchText,
      },
    });

    // Only set title if user hasn't edited it (still equals original submission.title).
    if (aiTitle) {
      await prisma.channelMeme.updateMany({
        where: { channelId: submission.channelId, memeAssetId: assetIdForChannelMeme, title: submission.title },
        data: { title: String(aiTitle).slice(0, 80) },
      });
    }
  }

  // Optional: LOW auto-approve (viewer uploads only), guarded by env flag.
  const autoApproveEnabled = parseBool(process.env.AI_LOW_AUTOPROVE_ENABLED);
  if (autoApproveEnabled && decision === 'low') {
    if (!isAllowedPublicFileUrl(fileUrl)) return;
    if (durationMs === null) return;
    const submitter = await prisma.user.findUnique({
      where: { id: submission.submitterUserId },
      select: { role: true },
    });
    if (submitter?.role === 'viewer') {
      // Extra safety: do not auto-approve if the hash already has a purged/quarantined asset.
      const existingAsset = await prisma.memeAsset.findFirst({
        where: { fileHash },
        select: { id: true, poolVisibility: true, poolHiddenByUserId: true, poolHiddenReason: true, purgeRequestedAt: true, purgedAt: true },
      });
      const blocked =
        !!existingAsset?.purgeRequestedAt ||
        !!existingAsset?.purgedAt ||
        (String(existingAsset?.poolVisibility || '') === 'hidden' &&
          !(String(existingAsset?.poolHiddenReason || '').startsWith('ai:') && !existingAsset?.poolHiddenByUserId));

      if (!blocked) {
        const channel = await prisma.channel.findUnique({
          where: { id: submission.channelId },
          select: { defaultPriceCoins: true },
        });

        const priceCoins = channel?.defaultPriceCoins ?? 100;

        await prisma.$transaction(async (tx) => {
          const res = await approveSubmissionInternal({
            tx,
            submissionId,
            approvedByUserId: null,
            resolved: {
              finalFileUrl: fileUrl,
              fileHash,
              durationMs,
              priceCoins,
              tagNames: autoTags,
            },
          });

          // Best-effort audit for explainability.
          try {
            await auditLog({
              action: 'ai.autoApprove',
              actorId: null,
              channelId: submission.channelId,
              payload: {
                submissionId,
                fileHash,
                aiDecision: 'low',
                aiRiskScore: riskScore,
                labels,
                tagNames: autoTags,
                pipelineVersion: modelVersions?.pipelineVersion ?? null,
                memeAssetId: res.memeAssetId,
                channelMemeId: res.channelMemeId,
                alreadyApproved: res.alreadyApproved,
              },
            });
          } catch {
            // ignore
          }
        });
      }
    }
  }
}

export function startAiModerationScheduler() {
  const enabledRaw = process.env.AI_MODERATION_ENABLED;
  const openaiApiKeySet = !!String(process.env.OPENAI_API_KEY || '').trim();
  const nodeEnv = String(process.env.NODE_ENV || '').trim();
  const isProd = nodeEnv === 'production';

  let enabled = false;
  let disabledReason = 'env_flag_off';

  // Back-compat + ops safety:
  // - If AI_MODERATION_ENABLED is explicitly set, respect it.
  // - If it's missing, auto-enable ONLY in production when OPENAI_API_KEY is configured.
  const enabledRawTrimmed = enabledRaw == null ? '' : String(enabledRaw).trim();
  if (enabledRawTrimmed) {
    enabled = parseBool(enabledRawTrimmed);
    disabledReason = enabled ? 'enabled_by_env' : 'env_flag_off';
  } else {
    enabled = isProd && openaiApiKeySet;
    disabledReason = enabled ? 'enabled_by_default' : 'env_flag_missing';
  }

  aiSchedulerStatus.enabled = enabled;
  aiSchedulerStatus.disabledReason = enabled ? null : disabledReason;
  aiSchedulerStatus.openaiApiKeySet = openaiApiKeySet;

  if (!enabled) {
    logger.info('ai_moderation.scheduler.disabled', {
      aiModerationEnabled: enabledRaw ?? null,
      nodeEnv: nodeEnv || null,
      openaiApiKeySet,
      reason: disabledReason,
      hint: 'Set AI_MODERATION_ENABLED=1 (or set OPENAI_API_KEY in production) to enable',
    });
    return;
  }

  const intervalMs = clampInt(parseInt(String(process.env.AI_MODERATION_INTERVAL_MS || ''), 10), 1_000, 60 * 60_000, 30_000);
  aiSchedulerStatus.intervalMs = intervalMs;
  const initialDelayMs = clampInt(parseInt(String(process.env.AI_MODERATION_INITIAL_DELAY_MS || ''), 10), 0, 60 * 60_000, 15_000);
  const batch = clampInt(parseInt(String(process.env.AI_MODERATION_BATCH || ''), 10), 1, 500, 25);
  const stuckMs = clampInt(parseInt(String(process.env.AI_MODERATION_STUCK_MS || ''), 10), 5_000, 7 * 24 * 60 * 60_000, 10 * 60_000);
  const maxRetries = clampInt(parseInt(String(process.env.AI_MAX_RETRIES || ''), 10), 0, 50, 5);
  // Safety: ensure a single stuck submission cannot stall the whole scheduler indefinitely.
  const perSubmissionTimeoutMs = clampInt(
    parseInt(String(process.env.AI_PER_SUBMISSION_TIMEOUT_MS || ''), 10),
    5_000,
    30 * 60_000,
    5 * 60_000
  );
  const metaEnabled = parseBool(process.env.AI_METADATA_ENABLED ?? '1');
  const visionEnabled = parseBool(process.env.AI_VISION_ENABLED ?? '1');

  logger.info('ai_moderation.scheduler.enabled', {
    intervalMs,
    initialDelayMs,
    batch,
    stuckMs,
    maxRetries,
    perSubmissionTimeoutMs,
    openaiApiKeySet,
    metaEnabled,
    visionEnabled,
    uploadStorage: process.env.UPLOAD_STORAGE || 'local',
    uploadDir: process.env.UPLOAD_DIR || './uploads',
    s3PublicBaseUrlConfigured: !!String(process.env.S3_PUBLIC_BASE_URL || '').trim(),
  });
  if (!openaiApiKeySet) {
    logger.warn('ai_moderation.openai.disabled', { reason: 'OPENAI_API_KEY_not_set' });
  }

  let running = false;
  const lockId = computeAiSchedulerLockId();

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
    aiSchedulerStatus.lastRunStartedAt = new Date(startedAt).toISOString();
    aiSchedulerStatus.lastRunCompletedAt = null;
    aiSchedulerStatus.lastRunStats = null;
    let locked = false;

    try {
      locked = await tryAcquireAdvisoryLock(lockId);
      if (!locked) return;

      const now = new Date();
      const stuckBefore = new Date(Date.now() - stuckMs);

      const candidates = await prisma.memeSubmission.findMany({
        where: {
          status: { in: ['pending', 'approved'] },
          sourceKind: { in: ['upload', 'url'] },
          OR: [
            { aiStatus: 'pending' },
            { aiStatus: 'failed', OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }] },
            { aiStatus: 'processing', aiLastTriedAt: { lt: stuckBefore } },
          ],
        },
        select: { id: true, aiStatus: true, aiRetryCount: true },
        take: batch,
        orderBy: { createdAt: 'asc' },
      });

      let processed = 0;
      let claimed = 0;
      let failed = 0;
      let autoApproved = 0;

      for (const c of candidates) {
        // Guard: permanent failure
        if ((c.aiRetryCount ?? 0) >= maxRetries) {
          await prisma.memeSubmission.update({
            where: { id: c.id },
            data: {
              aiStatus: 'failed_final',
              aiError: 'max_retries_exceeded',
              aiNextRetryAt: null,
            },
          });
          continue;
        }

        const claim = await prisma.memeSubmission.updateMany({
          where: {
            id: c.id,
            status: { in: ['pending', 'approved'] },
            sourceKind: { in: ['upload', 'url'] },
            OR: [
              { aiStatus: 'pending' },
              { aiStatus: 'failed', OR: [{ aiNextRetryAt: null }, { aiNextRetryAt: { lte: now } }] },
              { aiStatus: 'processing', aiLastTriedAt: { lt: stuckBefore } },
            ],
          },
          data: {
            aiStatus: 'processing',
            aiLastTriedAt: now,
          },
        });

        if (claim.count !== 1) continue;
        claimed += 1;

        try {
          await withTimeout(processOneSubmission(c.id), perSubmissionTimeoutMs, 'ai_submission');
          processed += 1;

          // Best-effort: detect auto-approve by checking submission status.
          if (parseBool(process.env.AI_LOW_AUTOPROVE_ENABLED)) {
            const s = await prisma.memeSubmission.findUnique({ where: { id: c.id }, select: { status: true } });
            if (s?.status === 'approved') autoApproved += 1;
          }
        } catch (e: any) {
          failed += 1;
          const prevRetries = Number.isFinite(c.aiRetryCount as any) ? (c.aiRetryCount as number) : 0;
          const nextRetryCount = prevRetries + 1;
          const backoffMs = Math.min(60 * 60_000, 5_000 * Math.pow(2, Math.max(0, nextRetryCount - 1)));

          await prisma.memeSubmission.update({
            where: { id: c.id },
            data: {
              aiStatus: nextRetryCount >= maxRetries ? 'failed_final' : 'failed',
              aiRetryCount: nextRetryCount,
              aiLastTriedAt: now,
              aiNextRetryAt: nextRetryCount >= maxRetries ? null : new Date(Date.now() + backoffMs),
              aiError: String(e?.message || 'ai_failed'),
            },
          });
        }
      }

      logger.info('ai_moderation.submissions.completed', {
        batch,
        stuckMs,
        maxRetries,
        claimed,
        processed,
        failed,
        autoApproved,
        durationMs: Date.now() - startedAt,
      });

      aiSchedulerStatus.lastRunCompletedAt = new Date().toISOString();
      aiSchedulerStatus.lastRunStats = {
        claimed,
        processed,
        failed,
        durationMs: Date.now() - startedAt,
      };
    } catch (e: any) {
      logger.error('ai_moderation.submissions.failed', {
        errorMessage: e?.message,
        durationMs: Date.now() - startedAt,
      });

      aiSchedulerStatus.lastRunCompletedAt = new Date().toISOString();
      aiSchedulerStatus.lastRunStats = {
        claimed: 0,
        processed: 0,
        failed: 1,
        durationMs: Date.now() - startedAt,
      };
    } finally {
      if (locked) await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  setInterval(() => void runOnce(), Math.max(1_000, intervalMs));
}


