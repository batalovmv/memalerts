import ffmpeg from 'fluent-ffmpeg';
import fs from 'fs';
import path from 'path';
import { configureFfmpegPaths } from '../media/configureFfmpeg.js';

configureFfmpegPaths();

async function ensureDir(dir: string): Promise<void> {
  await fs.promises.mkdir(dir, { recursive: true });
}

export async function extractFramesJpeg(args: {
  inputVideoPath: string;
  outputDir: string;
  stepSeconds?: number;
  maxFrames?: number;
  width?: number;
}): Promise<string[]> {
  const stepSeconds = Number.isFinite(args.stepSeconds as any) ? (args.stepSeconds as number) : 2;
  const maxFrames = Number.isFinite(args.maxFrames as any) ? (args.maxFrames as number) : 8;
  const width = Number.isFinite(args.width as any) ? (args.width as number) : 512;

  await ensureDir(args.outputDir);

  // Fluent-ffmpeg screenshots uses timestamps, so we precompute a small list.
  const timestamps: number[] = [];
  for (let i = 0; i < maxFrames; i += 1) {
    timestamps.push(Math.max(0, i * stepSeconds));
  }

  // Filename must include %i to avoid collisions.
  const filename = 'frame-%i.jpg';

  await new Promise<void>((resolve, reject) => {
    ffmpeg(args.inputVideoPath)
      .on('end', () => resolve())
      .on('error', (err: NodeJS.ErrnoException) => reject(err))
      .screenshots({
        timestamps,
        filename,
        folder: args.outputDir,
        size: `${Math.max(64, Math.floor(width))}x?`,
      });
  });

  // Collect produced frames (sorted).
  const files = (await fs.promises.readdir(args.outputDir))
    .filter((f) => /^frame-\d+\.jpg$/i.test(f))
    .sort((a, b) => {
      const ai = parseInt(a.replace(/\D+/g, ''), 10);
      const bi = parseInt(b.replace(/\D+/g, ''), 10);
      return ai - bi;
    })
    .map((f) => path.join(args.outputDir, f));

  return files;
}


