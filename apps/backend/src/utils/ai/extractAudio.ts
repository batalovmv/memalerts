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
    ffmpeg(args.inputVideoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioChannels(1)
      .audioFrequency(16000)
      .outputOptions(['-b:a 64k'])
      .on('end', () => resolve(out))
      .on('error', (err) => reject(err))
      .save(out);
  });
}


