import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import { configureFfmpegPaths } from './configureFfmpeg.js';

configureFfmpegPaths();

export function getFfmpegPath(): string | null {
  const envPath = String(process.env.FFMPEG_PATH || '').trim();
  if (envPath) return envPath;
  const installer = ffmpegInstaller as { path?: unknown };
  const installerPath = typeof installer.path === 'string' ? installer.path : '';
  return installerPath || null;
}
