import { beforeEach, describe, expect, it, vi } from 'vitest';

const aiMocks = vi.hoisted(() => ({
  extractAudioToMp3: vi.fn(),
  extractFramesJpeg: vi.fn(),
  generateMemeMetadataOpenAI: vi.fn(),
  generateTagNames: vi.fn(),
  moderateTextOpenAI: vi.fn(),
  transcribeAudioOpenAI: vi.fn(),
}));
const approveMocks = vi.hoisted(() => ({
  approveSubmissionInternal: vi.fn(),
}));
const auditMocks = vi.hoisted(() => ({
  auditLog: vi.fn(),
}));

vi.mock('../src/utils/ai/extractAudio.js', () => ({
  extractAudioToMp3: aiMocks.extractAudioToMp3,
}));
vi.mock('../src/utils/ai/openaiAsr.js', () => ({
  transcribeAudioOpenAI: aiMocks.transcribeAudioOpenAI,
}));
vi.mock('../src/utils/ai/openaiTextModeration.js', () => ({
  moderateTextOpenAI: aiMocks.moderateTextOpenAI,
}));
vi.mock('../src/utils/ai/openaiMemeMetadata.js', () => ({
  generateMemeMetadataOpenAI: aiMocks.generateMemeMetadataOpenAI,
}));
vi.mock('../src/utils/ai/extractFrames.js', () => ({
  extractFramesJpeg: aiMocks.extractFramesJpeg,
}));
vi.mock('../src/utils/ai/tagging.js', async () => {
  const actual = await vi.importActual('../src/utils/ai/tagging.js');
  return { ...actual, generateTagNames: aiMocks.generateTagNames };
});
vi.mock('../src/services/approveSubmissionInternal.js', () => approveMocks);
vi.mock('../src/utils/auditLogger.js', () => auditMocks);

import { prisma } from '../src/lib/prisma.js';
import * as pipelineModule from '../src/services/aiModeration/aiModerationPipeline.js';
import { runAiModerationPipeline } from '../src/services/aiModeration/aiModerationPipeline.js';
import { maybeAutoApproveSubmission } from '../src/services/aiModeration/aiModerationAutoApprove.js';
import { processOneSubmission } from '../src/services/aiModeration/processOneSubmission.js';
import type {
  AiModerationPipelineResult,
  AiModerationSubmission,
} from '../src/services/aiModeration/aiModerationTypes.js';
import {
  createChannel,
  createChannelMeme,
  createFileHash,
  createMemeAsset,
  createSubmission,
  createUser,
} from './factories/index.js';

function buildSubmission(overrides: Partial<AiModerationSubmission> = {}): AiModerationSubmission {
  return {
    id: 'submission-1',
    channelId: 'channel-1',
    submitterUserId: 'user-1',
    memeAssetId: null,
    title: 'Test meme',
    notes: null,
    status: 'pending',
    sourceKind: 'upload',
    fileUrlTemp: 'https://example.com/video.mp4',
    fileHash: 'hash-1',
    durationMs: 1200,
    aiStatus: 'pending',
    aiRetryCount: 0,
    ...overrides,
  };
}

describe('AI moderation service', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.NODE_ENV = 'test';
    process.env.OPENAI_API_KEY = '';
    process.env.AI_METADATA_ENABLED = '1';
    process.env.AI_VISION_ENABLED = '1';
    process.env.AI_TAG_LIMIT = '5';
    process.env.AI_VISION_MAX_FRAMES = '2';
    process.env.AI_VISION_STEP_SECONDS = '1';
    process.env.AI_MODERATION_MEDIUM_THRESHOLD = '0.4';
    process.env.AI_MODERATION_HIGH_THRESHOLD = '0.7';
  });

  it('runs the moderation pipeline with transcription and metadata', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    aiMocks.extractAudioToMp3.mockResolvedValue('C:\\tmp\\audio.mp3');
    aiMocks.transcribeAudioOpenAI.mockResolvedValue({ transcript: 'Hello world', model: 'whisper-1' });
    aiMocks.moderateTextOpenAI.mockResolvedValue({
      flagged: false,
      labels: ['text:violence'],
      riskScore: 0.3,
      model: 'mod-1',
    });
    aiMocks.extractFramesJpeg.mockResolvedValue(['C:\\tmp\\frame1.jpg']);
    aiMocks.generateMemeMetadataOpenAI.mockResolvedValue({
      model: 'meta-1',
      title: 'AI Title',
      tags: ['tag1', 'tag2'],
      description: 'AI Desc',
    });
    aiMocks.generateTagNames.mockReturnValue({ tagNames: ['fallback'], lowConfidence: false });

    const submission = buildSubmission();
    const result = await runAiModerationPipeline({
      submission,
      fileUrl: submission.fileUrlTemp,
      localPath: 'C:\\tmp\\video.mp4',
    });

    expect(aiMocks.extractAudioToMp3).toHaveBeenCalled();
    expect(aiMocks.transcribeAudioOpenAI).toHaveBeenCalledWith(
      expect.objectContaining({ audioFilePath: 'C:\\tmp\\audio.mp3' })
    );
    expect(aiMocks.moderateTextOpenAI).toHaveBeenCalledWith(expect.objectContaining({ text: 'Hello world' }));
    expect(aiMocks.extractFramesJpeg).toHaveBeenCalledWith(expect.objectContaining({ maxFrames: 2, stepSeconds: 1 }));
    expect(aiMocks.generateMemeMetadataOpenAI).toHaveBeenCalled();

    expect(result.decision).toBe('low');
      expect(result.riskScore).toBe(0.1);
    expect(result.labels).toContain('text:violence');
    expect(result.transcript).toBe('Hello world');
    expect(result.aiTitle).toBe('AI Title');
    expect(result.metaDescription).toBe('AI Desc');
    expect(result.autoTags).toEqual(['tag1', 'tag2']);
    expect(result.modelVersions.pipelineVersion).toBe('v2-openai-asr-moderation');
  });

  it('falls back to keyword heuristic when OpenAI is unavailable', async () => {
    process.env.OPENAI_API_KEY = 'test-key';

    aiMocks.extractAudioToMp3.mockRejectedValue(new Error('OPENAI_API_KEY_not_set'));
    aiMocks.generateTagNames.mockReturnValue({ tagNames: ['fallback'], lowConfidence: false });

    const submission = buildSubmission({ title: 'nsfw content', notes: 'explicit' });
    const result = await runAiModerationPipeline({
      submission,
      fileUrl: submission.fileUrlTemp,
      localPath: 'C:\\tmp\\video.mp4',
    });

      expect(result.decision).toBe('low');
    expect(result.reason).toBe('ai:openai_unavailable');
    expect(result.autoTags).toContain('nsfw');
    expect(result.modelVersions.pipelineVersion).toBe('v1-keyword-heuristic');
  });

  it('reuses AI results from existing meme assets', async () => {
    const channel = await createChannel({ slug: 'ai-reuse', name: 'AI Reuse' });
    const submitter = await createUser({ role: 'viewer', channelId: channel.id });
    const fileHash = await createFileHash();
    const asset = await createMemeAsset({
      fileHash: fileHash.hash,
      aiStatus: 'done',
      aiAutoTitle: 'Auto Title',
      aiAutoDescription: 'Auto description',
      aiAutoTagNamesJson: ['funny'],
      aiSearchText: 'auto search',
    });
    await createChannelMeme({
      channelId: channel.id,
      memeAssetId: asset.id,
      title: 'Reuse Title',
    });

    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      memeAssetId: asset.id,
      title: 'Reuse Title',
      fileHash: fileHash.hash,
      fileUrlTemp: 'https://cdn.example.com/meme.mp4',
      status: 'pending',
      sourceKind: 'upload',
    });

    const pipelineSpy = vi.spyOn(pipelineModule, 'runAiModerationPipeline');
    await processOneSubmission(submission.id);
    expect(pipelineSpy).not.toHaveBeenCalled();
    pipelineSpy.mockRestore();

    const updated = await prisma.memeSubmission.findUnique({
      where: { id: submission.id },
      select: { aiStatus: true, aiAutoDescription: true, aiAutoTagNamesJson: true, aiModelVersionsJson: true },
    });
    expect(updated?.aiStatus).toBe('done');
    expect(updated?.aiAutoDescription).toBe('Auto description');
    expect(updated?.aiAutoTagNamesJson).toEqual(['funny']);
    expect((updated?.aiModelVersionsJson as { pipelineVersion?: string } | null)?.pipelineVersion).toBe(
      'v3-reuse-memeasset'
    );

    const channelMeme = await prisma.channelMeme.findUnique({
      where: { channelId_memeAssetId: { channelId: channel.id, memeAssetId: asset.id } },
      select: { title: true, aiAutoDescription: true, aiAutoTagNamesJson: true },
    });
    expect(channelMeme?.title).toBe('Auto Title');
    expect(channelMeme?.aiAutoDescription).toBe('Auto description');
    expect(channelMeme?.aiAutoTagNamesJson).toEqual(['funny']);
  });

  it('auto-approves low-risk submissions when enabled', async () => {
    process.env.AI_LOW_AUTOPROVE_ENABLED = '1';
    process.env.S3_PUBLIC_BASE_URL = 'https://cdn.example.com/memes';

    approveMocks.approveSubmissionInternal.mockResolvedValue({
      legacyMeme: null,
      alreadyApproved: false,
      memeAssetId: 'asset-1',
      channelMemeId: 'channel-meme-1',
    });
    auditMocks.auditLog.mockResolvedValue(undefined);

    const channel = await createChannel({
      slug: 'ai-auto',
      name: 'AI Auto',
      defaultPriceCoins: 250,
      autoApproveEnabled: true,
    });
    const submitter = await createUser({ role: 'viewer', channelId: channel.id });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      fileHash: 'hash-auto',
      status: 'pending',
      sourceKind: 'upload',
    });

    const pipeline: AiModerationPipelineResult = {
      decision: 'low',
      riskScore: 0.1,
      labels: [],
      autoTags: ['safe'],
      transcript: null,
      aiTitle: null,
      metaDescription: 'Safe',
      reason: 'ai:text_ok',
      modelVersions: { pipelineVersion: 'test' },
    };

    await maybeAutoApproveSubmission({
      submission,
      fileUrl: 'https://cdn.example.com/memes/file.mp4',
      fileHash: 'hash-auto',
      durationMs: 1500,
      pipeline,
    });

    expect(approveMocks.approveSubmissionInternal).toHaveBeenCalledWith(
      expect.objectContaining({
        resolved: expect.objectContaining({
          finalFileUrl: 'https://cdn.example.com/memes/file.mp4',
          fileHash: 'hash-auto',
          durationMs: 1500,
          priceCoins: 250,
          tagNames: ['safe'],
        }),
      })
    );
    expect(auditMocks.auditLog).toHaveBeenCalledWith(expect.objectContaining({ action: 'ai.autoApprove' }));
  });

  it('errors when local upload files are missing', async () => {
    const channel = await createChannel({ slug: 'ai-missing', name: 'AI Missing' });
    const submitter = await createUser({ role: 'viewer', channelId: channel.id });
    const submission = await createSubmission({
      channelId: channel.id,
      submitterUserId: submitter.id,
      fileHash: 'hash-missing',
      fileUrlTemp: '/uploads/memes/hash-missing.webm',
      status: 'pending',
      sourceKind: 'upload',
    });

    await expect(processOneSubmission(submission.id)).rejects.toThrow('missing_file_on_disk');
  });
});
