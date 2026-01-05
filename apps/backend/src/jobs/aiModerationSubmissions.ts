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

type AiModerationDecision = 'low' | 'medium' | 'high';

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

function parseBool(raw: unknown): boolean {
  const v = String(raw ?? '').toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
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
        aiModelVersionsJson: { pipelineVersion: 'v3-reuse-memeasset' } as any,
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

  // Validate fileUrlTemp / resolve local path if needed (best-effort).
  const fileUrl = submission.fileUrlTemp ? String(submission.fileUrlTemp) : '';
  const uploadsRoot = path.resolve(process.cwd(), process.env.UPLOAD_DIR || './uploads');
  let localPath: string | null = null;
  if (fileUrl.startsWith('/uploads/')) {
    const rel = fileUrl.replace(/^\/uploads\//, '');
    localPath = validatePathWithinDirectory(rel, uploadsRoot);
    if (!fs.existsSync(localPath)) {
      throw new Error('missing_file_on_disk');
    }
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

      audioPath = await extractAudioToMp3({ inputVideoPath: inputPath, outputDir: tmpDir, baseName: 'audio' });
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

      const maxTags = clampInt(parseInt(String(process.env.AI_TAG_LIMIT || ''), 10), 1, 20, 5);

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
  const enabled = parseBool(enabledRaw);
  if (!enabled) {
    logger.info('ai_moderation.scheduler.disabled', {
      aiModerationEnabled: enabledRaw ?? null,
      reason: 'env_flag_off',
    });
    return;
  }

  const intervalMs = clampInt(parseInt(String(process.env.AI_MODERATION_INTERVAL_MS || ''), 10), 1_000, 60 * 60_000, 30_000);
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
  const openaiApiKeySet = !!String(process.env.OPENAI_API_KEY || '').trim();
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
  const lockId = 421399n;

  const runOnce = async () => {
    if (running) return;
    running = true;
    const startedAt = Date.now();
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
    } catch (e: any) {
      logger.error('ai_moderation.submissions.failed', {
        errorMessage: e?.message,
        durationMs: Date.now() - startedAt,
      });
    } finally {
      if (locked) await releaseAdvisoryLock(lockId);
      running = false;
    }
  };

  setTimeout(() => void runOnce(), initialDelayMs);
  setInterval(() => void runOnce(), Math.max(1_000, intervalMs));
}


