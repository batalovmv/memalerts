import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import fs from 'fs';
import path from 'path';

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

/**
 * Configure fluent-ffmpeg paths in a resilient way.
 *
 * Why: on some environments (e.g. pnpm with ignored build scripts), the
 * @ffmpeg-installer binary may not be present even though the package is installed.
 * In that case we should fall back to system ffmpeg/ffprobe from PATH.
 *
 * Override via:
 * - FFMPEG_PATH=/usr/bin/ffmpeg
 * - FFPROBE_PATH=/usr/bin/ffprobe
 */
export function configureFfmpegPaths(): void {
  const envFfmpeg = String(process.env.FFMPEG_PATH || '').trim();
  const envFfprobe = String(process.env.FFPROBE_PATH || '').trim();

  const installerPath = (ffmpegInstaller as any)?.path ? String((ffmpegInstaller as any).path) : '';
  const candidateFfmpeg = envFfmpeg || installerPath;

  if (candidateFfmpeg && fileExists(candidateFfmpeg)) {
    ffmpeg.setFfmpegPath(candidateFfmpeg);
  }

  // Prefer explicit ffprobe path, otherwise try to infer next to ffmpeg installer binary.
  if (envFfprobe && fileExists(envFfprobe)) {
    (ffmpeg as any).setFfprobePath(envFfprobe);
    return;
  }

  // If we have a concrete ffmpeg path, try co-located ffprobe.
  if (candidateFfmpeg && fileExists(candidateFfmpeg)) {
    const dir = path.dirname(candidateFfmpeg);
    const ffprobeBin = process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe';
    const inferred = path.join(dir, ffprobeBin);
    if (fileExists(inferred)) {
      (ffmpeg as any).setFfprobePath(inferred);
    }
  }
}



