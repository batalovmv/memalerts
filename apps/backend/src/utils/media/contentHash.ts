import { spawn } from 'node:child_process';
import crypto from 'crypto';

const CONTENT_HASH_VERSION = 'v2';

function getFfmpegBinary(): string {
  const envPath = String(process.env.FFMPEG_PATH || '').trim();
  return envPath || 'ffmpeg';
}

/**
 * Compute perceptual content hash (versioned) from video frames.
 * Format: "v2:<sha256>".
 */
export async function computeContentHash(inputPath: string): Promise<string> {
  const frameCount = 8;
  const frameInterval = 0.5; // seconds
  const hashWidth = 9;
  const hashHeight = 8;
  const frameSize = hashWidth * hashHeight;

  const args = [
    '-hide_banner',
    '-loglevel',
    'error',
    '-i',
    inputPath,
    '-vf',
    `fps=1/${frameInterval},scale=${hashWidth}:${hashHeight}:force_original_aspect_ratio=decrease,pad=${hashWidth}:${hashHeight}:(ow-iw)/2:(oh-ih)/2,format=gray`,
    '-frames:v',
    String(frameCount),
    '-f',
    'rawvideo',
    '-pix_fmt',
    'gray',
    'pipe:1',
  ];

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn(getFfmpegBinary(), args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks: Buffer[] = [];
    let stderr = '';

    ffmpeg.stdout.on('data', (chunk) => chunks.push(chunk));
    ffmpeg.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });

    ffmpeg.on('error', reject);
    ffmpeg.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`ffmpeg_exit_${code}${stderr ? `: ${stderr}` : ''}`));
        return;
      }

      const pixels = Buffer.concat(chunks);
      if (pixels.length < frameSize) {
        reject(new Error('contenthash_no_frames'));
        return;
      }

      const totalFrames = Math.floor(pixels.length / frameSize);
      const hashBytes = Buffer.alloc(totalFrames * 8);
      let byteIndex = 0;

      for (let frame = 0; frame < totalFrames; frame += 1) {
        const offset = frame * frameSize;
        let currentByte = 0;
        let bitIndex = 0;

        for (let y = 0; y < hashHeight; y += 1) {
          const rowOffset = offset + y * hashWidth;
          for (let x = 0; x < hashWidth - 1; x += 1) {
            const left = pixels[rowOffset + x] ?? 0;
            const right = pixels[rowOffset + x + 1] ?? 0;
            const bit = left > right ? 1 : 0;
            currentByte = (currentByte << 1) | bit;
            bitIndex += 1;
            if (bitIndex === 8) {
              hashBytes[byteIndex] = currentByte;
              byteIndex += 1;
              currentByte = 0;
              bitIndex = 0;
            }
          }
        }
      }

      const rawHash = crypto.createHash('sha256').update(hashBytes).digest('hex');
      resolve(`${CONTENT_HASH_VERSION}:${rawHash}`);
    });
  });
}

export function parseContentHashVersion(
  contentHash: string
): { version: string; hash: string } | null {
  const match = contentHash.match(/^(v\d+):(.+)$/);
  if (!match) return null;
  return { version: match[1], hash: match[2] };
}

export function isCurrentHashVersion(contentHash: string): boolean {
  return contentHash.startsWith(`${CONTENT_HASH_VERSION}:`);
}
