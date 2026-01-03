import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';

ffmpeg.setFfmpegPath(ffmpegInstaller.path);

function clampInt(n: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(n)) return fallback;
  if (n < min) return min;
  if (n > max) return max;
  return Math.floor(n);
}

function getLoudnormFilter(): string {
  const I = String(process.env.PLAYBACK_LOUDNORM_I || '-16').trim();
  const LRA = String(process.env.PLAYBACK_LOUDNORM_LRA || '11').trim();
  const TP = String(process.env.PLAYBACK_LOUDNORM_TP || '-1.5').trim();
  return `loudnorm=I=${I}:LRA=${LRA}:TP=${TP}`;
}

export async function normalizeVideoAudioForPlayback(args: {
  inputPath: string;
  outputPath: string;
}): Promise<void> {
  const ext = path.extname(args.outputPath).toLowerCase();
  const isWebm = ext === '.webm';
  const isMp4 = ext === '.mp4';

  const audioCodec = isWebm ? 'libopus' : isMp4 ? 'aac' : null;
  if (!audioCodec) {
    throw new Error('unsupported_container_for_normalization');
  }

  const audioBitrateK = clampInt(parseInt(String(process.env.PLAYBACK_AUDIO_BITRATE_K || ''), 10), 32, 256, isWebm ? 96 : 128);
  const tmpPath = `${args.outputPath}.tmp`;

  await fs.promises.mkdir(path.dirname(args.outputPath), { recursive: true });

  // Ensure no stale tmp file.
  try {
    await fs.promises.rm(tmpPath, { force: true });
  } catch {
    // ignore
  }

  await new Promise<void>((resolve, reject) => {
    ffmpeg(args.inputPath)
      // Copy video stream as-is (cheap), normalize+re-encode audio.
      .outputOptions(['-c:v copy'])
      .audioCodec(audioCodec)
      .audioFilters([getLoudnormFilter()])
      .outputOptions([`-b:a ${audioBitrateK}k`])
      .on('end', () => resolve())
      .on('error', (err: NodeJS.ErrnoException) => reject(err))
      .save(tmpPath);
  });

  // Atomic-ish replace.
  await fs.promises.rename(tmpPath, args.outputPath);
}


