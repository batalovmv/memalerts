import fs from 'fs';
import path from 'path';
import { extractAudioToMp3 } from '../../utils/ai/extractAudio.js';
import { transcribeAudioOpenAI } from '../../utils/ai/openaiAsr.js';
import { moderateTextOpenAI } from '../../utils/ai/openaiTextModeration.js';
import { generateTagNames } from '../../utils/ai/tagging.js';
import { extractFramesJpeg } from '../../utils/ai/extractFrames.js';
import { generateMemeMetadataOpenAI } from '../../utils/ai/openaiMemeMetadata.js';
import {
  clampInt,
  computeKeywordHeuristic,
  downloadPublicFileToDisk,
  isAllowedPublicFileUrl,
  parseBool,
} from './aiModerationHelpers.js';
import type { AiModerationPipelineResult, AiModerationSubmission } from './aiModerationTypes.js';
import type { AiModerationDecision } from './aiModerationHelpers.js';

type RunPipelineArgs = {
  submission: AiModerationSubmission;
  fileUrl: string;
  localPath: string | null;
};

export async function runAiModerationPipeline(args: RunPipelineArgs): Promise<AiModerationPipelineResult> {
  const { submission, fileUrl, localPath } = args;
  let decision: AiModerationDecision = 'low';
  let riskScore = 0.0;
  let labels: string[] = [];
  let autoTags: string[] = [];
  let transcript: string | null = null;
  let aiTitle: string | null = null;
  let metaDescription: string | null = null;
  let reason = 'ai:keyword_fallback';
  const modelVersions: AiModerationPipelineResult['modelVersions'] = { pipelineVersion: 'v2-openai-asr-moderation' };

  const openaiEnabled = !!String(process.env.OPENAI_API_KEY || '').trim();
  if (openaiEnabled && (localPath || (fileUrl && isAllowedPublicFileUrl(fileUrl)))) {
    const maxTags = clampInt(parseInt(String(process.env.AI_TAG_LIMIT || ''), 10), 1, 20, 5);
    const tmpDir = path.join(process.cwd(), 'uploads', 'temp', `ai-${submission.id}`);
    let audioPath: string | null = null;
    let inputPath: string | null = null;
    try {
      if (localPath) {
        inputPath = localPath;
      } else {
        const ext = (() => {
          try {
            return path.extname(new URL(fileUrl).pathname) || '.mp4';
          } catch {
            return '.mp4';
          }
        })();
        inputPath = path.join(tmpDir, `input${ext}`);
        const maxBytes = clampInt(
          parseInt(String(process.env.AI_DOWNLOAD_MAX_BYTES || ''), 10),
          1_000_000,
          200_000_000,
          60_000_000
        );
        await downloadPublicFileToDisk({ url: fileUrl, destPath: inputPath, maxBytes });
        modelVersions.download = { maxBytes, source: 'public_url' };
      }

      try {
        audioPath = await extractAudioToMp3({ inputVideoPath: inputPath, outputDir: tmpDir, baseName: 'audio' });
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e ?? '');
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
        const heuristic = computeKeywordHeuristic(String(submission.title || ''), submission.notes);
        riskScore = Math.max(riskScore, heuristic.riskScore);
        labels = [...labels, ...heuristic.labels];
        reason = 'ai:no_audio_stream';
      }

      const metaEnabled = parseBool(process.env.AI_METADATA_ENABLED ?? '1');
      if (metaEnabled) {
        const visionEnabled = parseBool(process.env.AI_VISION_ENABLED ?? '1');
        let frames: string[] = [];
        if (visionEnabled && inputPath) {
          const maxFrames = clampInt(parseInt(String(process.env.AI_VISION_MAX_FRAMES || ''), 10), 1, 12, 8);
          const stepSeconds = clampInt(parseInt(String(process.env.AI_VISION_STEP_SECONDS || ''), 10), 1, 10, 2);
          frames = await extractFramesJpeg({
            inputVideoPath: inputPath,
            outputDir: tmpDir,
            maxFrames,
            stepSeconds,
            width: 512,
          });
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

      if (!autoTags || autoTags.length === 0) {
        const tagRes = generateTagNames({ title: submission.title, transcript, labels, maxTags });
        if (tagRes.lowConfidence) labels = [...labels, 'low_confidence'];
        autoTags = tagRes.tagNames;
      }

      const mediumT = Math.max(0, Math.min(1, Number(process.env.AI_MODERATION_MEDIUM_THRESHOLD ?? 0.4)));
      const highT = Math.max(0, Math.min(1, Number(process.env.AI_MODERATION_HIGH_THRESHOLD ?? 0.7)));
      decision = riskScore >= highT ? 'high' : riskScore >= mediumT ? 'medium' : 'low';
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e ?? '');
      if (
        msg.includes('unsupported_country_region_territory') ||
        msg.startsWith('openai_http_403') ||
        msg === 'OPENAI_API_KEY_not_set'
      ) {
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

  return {
    decision,
    riskScore,
    labels,
    autoTags,
    transcript,
    aiTitle,
    metaDescription,
    reason,
    modelVersions,
  };
}
