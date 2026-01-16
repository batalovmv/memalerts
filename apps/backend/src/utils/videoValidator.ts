import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import { spawnSync } from 'node:child_process';
import { Semaphore, parsePositiveIntEnv } from './semaphore.js';
import { configureFfmpegPaths } from './media/configureFfmpeg.js';
import { logger } from './logger.js';

configureFfmpegPaths();

const MAX_DURATION_SECONDS = 15; // 15 seconds max
const ffprobeConcurrency = parsePositiveIntEnv(
  'VIDEO_FFPROBE_CONCURRENCY',
  process.env.NODE_ENV === 'production' ? 2 : 4
);
const ffprobeSemaphore = new Semaphore(ffprobeConcurrency);

export interface VideoMetadata {
  duration: number; // in seconds
  width?: number;
  height?: number;
  size: number; // in bytes
}

function parseDurationToSeconds(raw: string): number | null {
  const m = raw.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  const total = h * 3600 + min * 60 + sec;
  return total > 0 ? total : null;
}

function getFfmpegPath(): string | null {
  const envPath = String(process.env.FFMPEG_PATH || '').trim();
  if (envPath) return envPath;
  const installer = ffmpegInstaller as { path?: unknown };
  const installerPath = typeof installer.path === 'string' ? installer.path : '';
  return installerPath || null;
}

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
};

type ProbeMetadata = {
  format?: {
    duration?: number | string;
  };
  streams?: ProbeStream[];
};

function probeWithFfmpegCli(filePath: string, size: number): VideoMetadata | null {
  const bin = getFfmpegPath();
  if (!bin) return null;
  const res = spawnSync(bin, ['-hide_banner', '-i', filePath, '-f', 'null', '-'], { encoding: 'utf8' });
  const output = String(res.stderr || '');
  if (!output) return null;
  const duration = parseDurationToSeconds(output) ?? 0;
  const sizeMatch = output.match(/,\s*(\d{2,5})x(\d{2,5})(?:\s|,)/);
  return {
    duration,
    width: sizeMatch ? Number(sizeMatch[1]) : undefined,
    height: sizeMatch ? Number(sizeMatch[2]) : undefined,
    size,
  };
}

/**
 * Get video metadata including duration
 * Returns null if ffprobe is not available or video cannot be analyzed
 */
export async function getVideoMetadata(filePath: string): Promise<VideoMetadata | null> {
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    throw new Error('Video file not found');
  }

  return ffprobeSemaphore.use(
    () =>
      new Promise((resolve) => {
        let done = false;

        // Set timeout for ffprobe operation (10 seconds)
        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          logger.warn('video.ffprobe_timeout', { filePath });
          resolve({
            duration: 0, // Unknown duration
            size: stats.size,
          });
        }, 10000);

        try {
          ffmpeg.ffprobe(filePath, (err: Error | null, metadata: ProbeMetadata) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);

            if (err) {
              const fallback = probeWithFfmpegCli(filePath, stats.size);
              if (fallback) return resolve(fallback);
              if (process.env.LOG_SILENT_TESTS !== '1') {
                logger.warn('video.ffprobe_failed', { filePath, errorMessage: err.message });
              }
              return resolve({
                duration: 0,
                size: stats.size,
              });
            }

            const durationRaw = metadata?.format?.duration;
            const duration = Number.isFinite(Number(durationRaw)) ? Number(durationRaw) : 0;
            const videoStream = metadata?.streams?.find((s) => s.codec_type === 'video');
            const width = Number.isFinite(videoStream?.width) ? Number(videoStream?.width) : undefined;
            const height = Number.isFinite(videoStream?.height) ? Number(videoStream?.height) : undefined;

            resolve({
              duration,
              width,
              height,
              size: stats.size,
            });
          });
        } catch (error: unknown) {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          const fallback = probeWithFfmpegCli(filePath, stats.size);
          if (fallback) return resolve(fallback);
          if (process.env.LOG_SILENT_TESTS !== '1') {
            const message = error instanceof Error ? error.message : String(error);
            logger.warn('video.ffprobe_error', { filePath, errorMessage: message });
          }
          resolve({
            duration: 0,
            size: stats.size,
          });
        }
      })
  );
}

/**
 * Validate video file: check duration and size
 */
export async function validateVideo(filePath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const metadata = await getVideoMetadata(filePath);

    if (!metadata) {
      return { valid: false, error: 'Could not analyze video file' };
    }

    // Check duration
    if (metadata.duration > 0 && metadata.duration > MAX_DURATION_SECONDS) {
      return {
        valid: false,
        error: `Video duration (${metadata.duration.toFixed(2)}s) exceeds maximum allowed duration (${MAX_DURATION_SECONDS}s)`,
      };
    }

    // Check file size (50MB max)
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (metadata.size > MAX_SIZE) {
      return {
        valid: false,
        error: `Video file size (${(metadata.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (50MB)`,
      };
    }

    return { valid: true };
  } catch (error: unknown) {
    const err = error as Error;
    logger.error('video.validate_failed', { filePath, errorMessage: err.message });
    // If validation fails, we'll allow the file but log the error
    // This prevents blocking uploads if ffprobe is not available
    return { valid: true }; // Allow upload if validation fails (graceful degradation)
  }
}
