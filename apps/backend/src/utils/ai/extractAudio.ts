import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import fs from 'fs';
import { configureFfmpegPaths } from '../media/configureFfmpeg.js';

configureFfmpegPaths();

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function getAiFfmpegTimeoutMs(): number {
  const raw = parseInt(String(process.env.AI_FFMPEG_TIMEOUT_MS || ''), 10);
  // Default: 90s (ffmpeg should be fast for short clips, but allow some headroom on loaded VPS).
  return clampInt(raw, 1_000, 10 * 60_000, 90_000);
}

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function extractAudioToMp3(args: {
  inputVideoPath: string;
  outputDir: string;
  baseName: string;
}): Promise<string> {
  await ensureDir(args.outputDir);
  const out = path.join(args.outputDir, `${args.baseName}.mp3`);

  return await new Promise<string>((resolve, reject) => {
    const timeoutMs = getAiFfmpegTimeoutMs();
    const enableLoudnorm = String(process.env.AI_AUDIO_LOUDNORM || '').trim() === '1';
    // Reasonable defaults for speech-heavy short clips.
    // If you need different targets, override via env.
    const I = String(process.env.AI_AUDIO_LOUDNORM_I || '-16').trim();
    const LRA = String(process.env.AI_AUDIO_LOUDNORM_LRA || '11').trim();
    const TP = String(process.env.AI_AUDIO_LOUDNORM_TP || '-1.5').trim();
    const loudnorm = `loudnorm=I=${I}:LRA=${LRA}:TP=${TP}`;

    const cmd = ffmpeg(args.inputVideoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioChannels(1)
      .audioFrequency(16000)
      .outputOptions(['-b:a 64k']);

    if (enableLoudnorm) {
      cmd.audioFilters([loudnorm]);
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
        resolve(out);
      })
      .on('error', (err: NodeJS.ErrnoException) => {
        clearTimeout(timer);
        reject(err);
      })
      .save(out);
  });
}
