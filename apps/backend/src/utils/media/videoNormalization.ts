import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import crypto from 'crypto';
import path from 'path';
import fs from 'fs';
import { spawnSync } from 'node:child_process';
import { Semaphore, parsePositiveIntEnv } from '../semaphore.js';
import { configureFfmpegPaths } from './configureFfmpeg.js';

configureFfmpegPaths();

const DEFAULT_MAX_WIDTH = parsePositiveIntEnv('VIDEO_MAX_WIDTH', 1920);
const DEFAULT_MAX_HEIGHT = parsePositiveIntEnv('VIDEO_MAX_HEIGHT', 1080);
const DEFAULT_MAX_FPS = parsePositiveIntEnv('VIDEO_MAX_FPS', 30);
const DEFAULT_TIMEOUT_MS = parsePositiveIntEnv('VIDEO_TRANSCODE_TIMEOUT_MS', 90_000);
const ffprobeConcurrency = parsePositiveIntEnv(
  'VIDEO_FFPROBE_CONCURRENCY',
  process.env.NODE_ENV === 'production' ? 2 : 4
);
const transcodeConcurrency = parsePositiveIntEnv(
  'VIDEO_TRANSCODE_CONCURRENCY',
  process.env.NODE_ENV === 'production' ? 1 : 2
);
const ffprobeSemaphore = new Semaphore(ffprobeConcurrency);
const transcodeSemaphore = new Semaphore(transcodeConcurrency);

export interface NormalizedVideoResult {
  outputPath: string;
  mimeType: string;
  transcodeSkipped: boolean;
  durationMs: number | null;
}

interface VideoProbe {
  formatName: string | null;
  durationMs: number | null;
  width?: number;
  height?: number;
  fps?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  hasAudio: boolean;
}

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function parseFps(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;
  if (raw.includes('/')) {
    const [numRaw, denRaw] = raw.split('/');
    const num = Number(numRaw);
    const den = Number(denRaw);
    if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
    return num / den;
  }
  const asNum = Number(raw);
  return Number.isFinite(asNum) ? asNum : null;
}

function parseDurationToMs(raw: string): number | null {
  const m = raw.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const sec = Number(m[3]);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(sec)) return null;
  const total = h * 3600 + min * 60 + sec;
  return total > 0 ? Math.round(total * 1000) : null;
}

function getFfmpegPath(): string | null {
  const envPath = String(process.env.FFMPEG_PATH || '').trim();
  if (envPath) return envPath;
  const installer = ffmpegInstaller as { path?: unknown };
  const installerPath = typeof installer.path === 'string' ? installer.path : '';
  return installerPath || null;
}

function probeWithFfmpegCli(filePath: string): VideoProbe | null {
  const bin = getFfmpegPath();
  if (!bin) return null;
  const res = spawnSync(bin, ['-hide_banner', '-i', filePath, '-f', 'null', '-'], { encoding: 'utf8' });
  const output = String(res.stderr || '');
  if (!output) return null;

  const formatMatch = output.match(/Input #0,\s*([^,]+(?:,[^,]+)*)/);
  const formatName = formatMatch ? String(formatMatch[1]).trim() : null;
  const durationMs = parseDurationToMs(output);

  const videoMatch = output.match(/Video:\s*([^ ,]+)/);
  const audioMatch = output.match(/Audio:\s*([^ ,]+)/);
  const sizeMatch = output.match(/,\s*(\d{2,5})x(\d{2,5})(?:\s|,)/);
  const fpsMatch = output.match(/(\d+(?:\.\d+)?)\s*fps/);

  return {
    formatName,
    durationMs,
    width: sizeMatch ? Number(sizeMatch[1]) : undefined,
    height: sizeMatch ? Number(sizeMatch[2]) : undefined,
    fps: fpsMatch ? Number(fpsMatch[1]) : null,
    videoCodec: videoMatch ? String(videoMatch[1]).toLowerCase() : null,
    audioCodec: audioMatch ? String(audioMatch[1]).toLowerCase() : null,
    hasAudio: Boolean(audioMatch),
  };
}

type ProbeStream = {
  codec_type?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string | number;
  r_frame_rate?: string | number;
  codec_name?: string;
};

type ProbeMetadata = {
  format?: {
    format_name?: string;
    duration?: number | string;
  };
  streams?: ProbeStream[];
};

async function probeVideo(filePath: string): Promise<VideoProbe | null> {
  return ffprobeSemaphore.use(
    () =>
      new Promise((resolve) => {
        let done = false;
        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          resolve(null);
        }, 10_000);

        try {
          ffmpeg.ffprobe(filePath, (err: Error | null, metadata: ProbeMetadata) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);
            if (err) {
              const fallback = probeWithFfmpegCli(filePath);
              return resolve(fallback);
            }

            const formatName = String(metadata?.format?.format_name || '');
            const durationSec = metadata?.format?.duration ? Number(metadata.format.duration) : 0;
            const durationMs = Number.isFinite(durationSec) && durationSec > 0 ? Math.round(durationSec * 1000) : null;
            const videoStream = metadata?.streams?.find((s) => s.codec_type === 'video');
            const audioStream = metadata?.streams?.find((s) => s.codec_type === 'audio');

            const fps = parseFps(videoStream?.avg_frame_rate) ?? parseFps(videoStream?.r_frame_rate);

            const width = Number.isFinite(videoStream?.width) ? Number(videoStream?.width) : undefined;
            const height = Number.isFinite(videoStream?.height) ? Number(videoStream?.height) : undefined;

            resolve({
              formatName: formatName || null,
              durationMs,
              width,
              height,
              fps,
              videoCodec: videoStream?.codec_name ? String(videoStream.codec_name) : null,
              audioCodec: audioStream?.codec_name ? String(audioStream.codec_name) : null,
              hasAudio: Boolean(audioStream),
            });
          });
        } catch {
          clearTimeout(timeout);
          resolve(probeWithFfmpegCli(filePath));
        }
      })
  );
}

function needsTranscode(probe: VideoProbe | null, maxWidth: number, maxHeight: number, maxFps: number): boolean {
  if (!probe) return true;
  const format = (probe.formatName || '').toLowerCase();
  const isMp4Container = format.includes('mp4');
  const isH264 = (probe.videoCodec || '').toLowerCase() === 'h264';
  const isAac = (probe.audioCodec || '').toLowerCase() === 'aac';
  const hasAudio = probe.hasAudio;

  const sizeTooLarge =
    (Number.isFinite(probe.width) && probe.width! > maxWidth) ||
    (Number.isFinite(probe.height) && probe.height! > maxHeight);
  const fpsTooHigh = Number.isFinite(probe.fps as number) && (probe.fps as number) > maxFps;

  if (!isMp4Container || !isH264) return true;
  if (hasAudio && !isAac) return true;
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
  return filters;
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
