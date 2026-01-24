import ffmpeg from 'fluent-ffmpeg';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawn } from 'node:child_process';
import { Semaphore } from '../semaphore.js';
import { calculateFileHash } from '../fileHash.js';
import { buildLowPriorityCommand } from './systemLoad.js';
import {
  VIDEO_FORMATS,
  COMMON_VIDEO_ARGS,
  PREVIEW_VIDEO_ARGS,
  type VideoFormat,
} from './videoFormats.js';
import {
  clampInt,
  DEFAULT_MAX_FPS,
  DEFAULT_MAX_HEIGHT,
  DEFAULT_MAX_WIDTH,
  DEFAULT_TIMEOUT_MS,
  TRANSCODE_CONCURRENCY,
} from './videoConfig.js';
import { getFfmpegPath } from './ffmpegRuntime.js';
import { getShortSide, probeVideo, type VideoProbe } from './videoProbe.js';
import { isAudioCompatible } from './audioNormalization.js';

const transcodeSemaphore = new Semaphore(TRANSCODE_CONCURRENCY);

export interface NormalizedVideoResult {
  outputPath: string;
  mimeType: string;
  transcodeSkipped: boolean;
  durationMs: number | null;
}

export interface TranscodeResult {
  format: VideoFormat;
  outputPath: string;
  mimeType: string;
  codec: string;
  durationMs: number | null;
  width: number | undefined;
  height: number | undefined;
  fileSizeBytes: number;
  fileHash: string;
}

function needsTranscode(probe: VideoProbe | null, maxWidth: number, maxHeight: number, maxFps: number): boolean {
  if (!probe) return true;
  const format = (probe.formatName || '').toLowerCase();
  const isMp4Container = format.includes('mp4');
  const isH264 = (probe.videoCodec || '').toLowerCase() === 'h264';

  const sizeTooLarge =
    (Number.isFinite(probe.width) && probe.width! > maxWidth) ||
    (Number.isFinite(probe.height) && probe.height! > maxHeight);
  const fpsTooHigh = Number.isFinite(probe.fps as number) && (probe.fps as number) > maxFps;

  if (!isMp4Container || !isH264) return true;
  if (!isAudioCompatible(probe)) return true;
  if (sizeTooLarge || fpsTooHigh) return true;
  return false;
}

function buildOutputPath(inputPath: string): string {
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, path.extname(inputPath));
  const suffix = crypto.randomBytes(6).toString('hex');
  return path.join(dir, `${base}.normalized-${suffix}.mp4`);
}

function makeFilters(probe: VideoProbe | null, maxWidth: number, maxHeight: number, maxFps: number): string[] {
  const filters: string[] = [];
  const needScale =
    probe &&
    ((Number.isFinite(probe.width) && probe.width! > maxWidth) ||
      (Number.isFinite(probe.height) && probe.height! > maxHeight));
  if (needScale) {
    filters.push(`scale='min(${maxWidth},iw)':'min(${maxHeight},ih)':force_original_aspect_ratio=decrease`);
  }
  const needFps = probe && Number.isFinite(probe.fps as number) && (probe.fps as number) > maxFps;
  if (needFps) {
    filters.push(`fps=${maxFps}`);
  }
  const needsEvenDimensions =
    !probe ||
    needScale ||
    (Number.isFinite(probe.width) && (probe.width as number) % 2 !== 0) ||
    (Number.isFinite(probe.height) && (probe.height as number) % 2 !== 0);
  if (needsEvenDimensions) {
    // H.264 yuv420p requires even width/height; clamp to at least 2px to avoid invalid 0 dimensions.
    filters.push("scale='max(trunc(iw/2)*2,2)':'max(trunc(ih/2)*2,2)'");
  }
  return filters;
}

function shouldCopyPreview(probe: VideoProbe | null): boolean {
  const shortSide = getShortSide(probe);
  if (shortSide === null || shortSide > 360) return false;
  const format = (probe?.formatName || '').toLowerCase();
  const isMp4Container = format.includes('mp4');
  const isH264 = (probe?.videoCodec || '').toLowerCase() === 'h264';
  const fpsOk = !Number.isFinite(probe?.fps as number) || (probe?.fps as number) <= DEFAULT_MAX_FPS;
  return isMp4Container && isH264 && fpsOk;
}

async function runFfmpegCli(
  args: string[],
  opts?: { timeoutMs?: number; lowPriority?: boolean }
): Promise<void> {
  const ffmpegPath = getFfmpegPath() || 'ffmpeg';
  const timeoutMs = clampInt(opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 10 * 60_000, DEFAULT_TIMEOUT_MS);

  const runOnce = (cmd: string, cmdArgs: string[]) =>
    new Promise<void>((resolve, reject) => {
      const child = spawn(cmd, cmdArgs, { stdio: ['ignore', 'pipe', 'pipe'] });
      let stderr = '';
      const timer = setTimeout(() => {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
        reject(new Error(`ffmpeg_timeout_${timeoutMs}`));
      }, timeoutMs);

      child.stderr.on('data', (chunk) => {
        stderr += String(chunk);
      });

      child.on('error', reject);
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve();
          return;
        }
        reject(new Error(`ffmpeg_exit_${code}${stderr ? `: ${stderr}` : ''}`));
      });
    });

  if (!opts?.lowPriority) {
    return runOnce(ffmpegPath, args);
  }

  const lowPriority = buildLowPriorityCommand(ffmpegPath, args);
  try {
    await runOnce(lowPriority.cmd, lowPriority.args);
  } catch (error) {
    const err = error as NodeJS.ErrnoException;
    if (err?.code === 'ENOENT') {
      await runOnce(ffmpegPath, args);
      return;
    }
    throw error;
  }
}

async function runTranscode(
  inputPath: string,
  outputPath: string,
  filters: string[],
  timeoutMs: number
): Promise<void> {
  await fs.promises.mkdir(path.dirname(outputPath), { recursive: true });

  return await new Promise<void>((resolve, reject) => {
    const cmd = ffmpeg(inputPath).outputOptions([
      '-map 0:v:0',
      '-map 0:a?',
      '-c:v libx264',
      '-preset veryfast',
      '-pix_fmt yuv420p',
      '-profile:v high',
      '-level 4.1',
      '-c:a aac',
      '-b:a 128k',
      '-movflags +faststart',
    ]);

    if (filters.length > 0) {
      cmd.videoFilters(filters);
    }

    const timer = setTimeout(() => {
      try {
        cmd.kill('SIGKILL');
      } catch {
        // ignore
      }
      reject(new Error(`ffmpeg_timeout_${timeoutMs}`));
    }, timeoutMs);

    cmd
      .on('end', () => {
        clearTimeout(timer);
        resolve();
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(err);
      })
      .save(outputPath);
  });
}

export async function normalizeVideoForPlayback(args: {
  inputPath: string;
  maxWidth?: number;
  maxHeight?: number;
  maxFps?: number;
  timeoutMs?: number;
}): Promise<NormalizedVideoResult> {
  const maxWidth = clampInt(args.maxWidth ?? DEFAULT_MAX_WIDTH, 64, 7680, DEFAULT_MAX_WIDTH);
  const maxHeight = clampInt(args.maxHeight ?? DEFAULT_MAX_HEIGHT, 64, 4320, DEFAULT_MAX_HEIGHT);
  const maxFps = clampInt(args.maxFps ?? DEFAULT_MAX_FPS, 1, 240, DEFAULT_MAX_FPS);
  const timeoutMs = clampInt(args.timeoutMs ?? DEFAULT_TIMEOUT_MS, 1_000, 10 * 60_000, DEFAULT_TIMEOUT_MS);

  return transcodeSemaphore.use(async () => {
    const probe = await probeVideo(args.inputPath);
    const shouldTranscode = needsTranscode(probe, maxWidth, maxHeight, maxFps);
    if (!shouldTranscode) {
      return {
        outputPath: args.inputPath,
        mimeType: 'video/mp4',
        transcodeSkipped: true,
        durationMs: probe?.durationMs ?? null,
      };
    }

    const outputPath = buildOutputPath(args.inputPath);
    const filters = makeFilters(probe, maxWidth, maxHeight, maxFps);
    try {
      await runTranscode(args.inputPath, outputPath, filters, timeoutMs);
    } catch (error) {
      try {
        await fs.promises.unlink(outputPath);
      } catch {
        // ignore
      }
      throw error;
    }

    const outputProbe = await probeVideo(outputPath);
    return {
      outputPath,
      mimeType: 'video/mp4',
      transcodeSkipped: false,
      durationMs: outputProbe?.durationMs ?? null,
    };
  });
}

export async function transcodeToFormat(
  inputPath: string,
  outputDir: string,
  format: VideoFormat,
  baseName: string,
  opts?: { timeoutMs?: number; lowPriority?: boolean }
): Promise<TranscodeResult> {
  const config = VIDEO_FORMATS[format];
  const outputPath = path.join(outputDir, `${baseName}.${format}.${config.container}`);
  const probe = await probeVideo(inputPath);
  const maxWidth = config.maxWidth ?? DEFAULT_MAX_WIDTH;
  const maxHeight = config.maxHeight ?? DEFAULT_MAX_HEIGHT;
  const filters = makeFilters(probe, maxWidth, maxHeight, DEFAULT_MAX_FPS);

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
    ...COMMON_VIDEO_ARGS,
    ...config.ffmpegArgs,
    '-y',
    outputPath,
  ];

  await runFfmpegCli(args, opts);

  const outputProbe = await probeVideo(outputPath);
  const stats = await fs.promises.stat(outputPath);
  const fileHash = await calculateFileHash(outputPath);

  return {
    format,
    outputPath,
    mimeType: config.mimeType,
    codec: config.codecString,
    durationMs: outputProbe?.durationMs ?? null,
    width: outputProbe?.width,
    height: outputProbe?.height,
    fileSizeBytes: stats.size,
    fileHash,
  };
}

function getAdaptivePreviewParams(probe: VideoProbe | null): { crf: number; maxrate: string } {
  if (!probe) return { crf: 28, maxrate: '1M' };
  const sourceWidth = probe.width ?? 1920;
  const sourceHeight = probe.height ?? 1080;
  const shortSide = Math.min(sourceWidth, sourceHeight);

  if (shortSide <= 360) return { crf: 23, maxrate: '600k' };
  if (shortSide <= 480) return { crf: 25, maxrate: '800k' };
  if (shortSide <= 720) return { crf: 27, maxrate: '1M' };
  return { crf: 28, maxrate: '1M' };
}

export async function transcodeToPreview(
  inputPath: string,
  outputDir: string,
  baseName: string,
  opts?: { timeoutMs?: number; lowPriority?: boolean }
): Promise<TranscodeResult> {
  const config = VIDEO_FORMATS.preview;
  const outputPath = path.join(outputDir, `${baseName}.preview.${config.container}`);
  const probe = await probeVideo(inputPath);
  const adaptive = getAdaptivePreviewParams(probe);

  if (shouldCopyPreview(probe)) {
    const args = [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      inputPath,
      '-map',
      '0:v:0',
      '-c:v',
      'copy',
      '-an',
      '-movflags',
      '+faststart',
      '-y',
      outputPath,
    ];

    await runFfmpegCli(args, opts);

    const outputProbe = await probeVideo(outputPath);
    const stats = await fs.promises.stat(outputPath);
    const fileHash = await calculateFileHash(outputPath);

    return {
      format: 'preview',
      outputPath,
      mimeType: config.mimeType,
      codec: config.codecString,
      durationMs: outputProbe?.durationMs ?? null,
      width: outputProbe?.width,
      height: outputProbe?.height,
      fileSizeBytes: stats.size,
      fileHash,
    };
  }

  const maxWidth = config.maxWidth ?? 854;
  const maxHeight = config.maxHeight ?? 480;
  const filters = makeFilters(probe, maxWidth, maxHeight, DEFAULT_MAX_FPS);

  const ffmpegArgs = config.ffmpegArgs.map((arg, index, arr) => {
    if (arr[index - 1] === '-crf') return String(adaptive.crf);
    if (arr[index - 1] === '-maxrate') return adaptive.maxrate;
    return arg;
  });

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    ...(filters.length > 0 ? ['-vf', filters.join(',')] : []),
    ...PREVIEW_VIDEO_ARGS,
    ...ffmpegArgs,
    '-y',
    outputPath,
  ];

  await runFfmpegCli(args, opts);

  const outputProbe = await probeVideo(outputPath);
  const stats = await fs.promises.stat(outputPath);
  const fileHash = await calculateFileHash(outputPath);

  return {
    format: 'preview',
    outputPath,
    mimeType: config.mimeType,
    codec: config.codecString,
    durationMs: outputProbe?.durationMs ?? null,
    width: outputProbe?.width,
    height: outputProbe?.height,
    fileSizeBytes: stats.size,
    fileHash,
  };
}

export async function transcodeAllFormats(
  inputPath: string,
  outputDir: string,
  baseName: string,
  opts?: { timeoutMs?: number; lowPriority?: boolean }
): Promise<TranscodeResult[]> {
  const results: TranscodeResult[] = [];

  const [previewResult, mp4Result] = await Promise.all([
    transcodeToPreview(inputPath, outputDir, baseName, opts),
    transcodeToFormat(inputPath, outputDir, 'mp4', baseName, opts),
  ]);

  results.push(previewResult, mp4Result);

  const webmResult = await transcodeToFormat(inputPath, outputDir, 'webm', baseName, opts);
  results.push(webmResult);

  return results;
}
