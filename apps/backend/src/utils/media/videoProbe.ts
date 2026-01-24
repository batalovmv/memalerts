import ffmpeg from 'fluent-ffmpeg';
import { spawnSync } from 'node:child_process';
import { Semaphore } from '../semaphore.js';
import { FFPROBE_CONCURRENCY } from './videoConfig.js';
import { getFfmpegPath } from './ffmpegRuntime.js';

export interface VideoProbe {
  formatName: string | null;
  durationMs: number | null;
  width?: number;
  height?: number;
  fps?: number | null;
  videoCodec?: string | null;
  audioCodec?: string | null;
  hasAudio: boolean;
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

const ffprobeSemaphore = new Semaphore(FFPROBE_CONCURRENCY);

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

export async function probeVideo(filePath: string): Promise<VideoProbe | null> {
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

export function getShortSide(probe: VideoProbe | null): number | null {
  if (!probe) return null;
  if (!Number.isFinite(probe.width as number) || !Number.isFinite(probe.height as number)) return null;
  return Math.min(Number(probe.width), Number(probe.height));
}
