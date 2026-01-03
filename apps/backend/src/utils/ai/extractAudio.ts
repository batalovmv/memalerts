import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs';

// Ensure ffmpeg is configured (same pattern as videoValidator).
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

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

    cmd
      .on('end', () => resolve(out))
      .on('error', (err: NodeJS.ErrnoException) => reject(err))
      .save(out);
  });
}


