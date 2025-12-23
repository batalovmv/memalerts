import ffmpeg from 'fluent-ffmpeg';
import ffmpegInstaller from '@ffmpeg-installer/ffmpeg';
import path from 'path';
import fs from 'fs';
import { Semaphore, parsePositiveIntEnv } from './semaphore.js';

// Set ffmpeg path
ffmpeg.setFfmpegPath(ffmpegInstaller.path);

const MAX_DURATION_SECONDS = 15; // 15 seconds max
const ffprobeConcurrency = parsePositiveIntEnv(
  'VIDEO_FFPROBE_CONCURRENCY',
  process.env.NODE_ENV === 'production' ? 2 : 4
);
const ffprobeSemaphore = new Semaphore(ffprobeConcurrency);

export interface VideoMetadata {
  duration: number; // in seconds
  width?: number;
  height?: number;
  size: number; // in bytes
}

/**
 * Get video metadata including duration
 * Returns null if ffprobe is not available or video cannot be analyzed
 */
export async function getVideoMetadata(filePath: string): Promise<VideoMetadata | null> {
  let stats: fs.Stats;
  try {
    stats = await fs.promises.stat(filePath);
  } catch {
    throw new Error('Video file not found');
  }

  return ffprobeSemaphore.use(
    () =>
      new Promise((resolve) => {
        let done = false;

        // Set timeout for ffprobe operation (10 seconds)
        const timeout = setTimeout(() => {
          if (done) return;
          done = true;
          console.warn('ffprobe timeout, using file size only');
          resolve({
            duration: 0, // Unknown duration
            size: stats.size,
          });
        }, 10000);

        try {
          ffmpeg.ffprobe(filePath, (err: Error | null, metadata: any) => {
            if (done) return;
            done = true;
            clearTimeout(timeout);

            if (err) {
              console.warn('Failed to get video metadata with ffprobe:', err.message);
              resolve({
                duration: 0,
                size: stats.size,
              });
              return;
            }

            const duration = metadata?.format?.duration || 0;
            const videoStream = metadata?.streams?.find((s: any) => s.codec_type === 'video');
            const width = videoStream?.width;
            const height = videoStream?.height;

            resolve({
              duration,
              width,
              height,
              size: stats.size,
            });
          });
        } catch (error: any) {
          if (done) return;
          done = true;
          clearTimeout(timeout);
          console.warn('Error calling ffprobe:', error.message);
          resolve({
            duration: 0,
            size: stats.size,
          });
        }
      })
  );
}

/**
 * Validate video file: check duration and size
 */
export async function validateVideo(filePath: string): Promise<{ valid: boolean; error?: string }> {
  try {
    const metadata = await getVideoMetadata(filePath);
    
    if (!metadata) {
      return { valid: false, error: 'Could not analyze video file' };
    }

    // Check duration
    if (metadata.duration > 0 && metadata.duration > MAX_DURATION_SECONDS) {
      return {
        valid: false,
        error: `Video duration (${metadata.duration.toFixed(2)}s) exceeds maximum allowed duration (${MAX_DURATION_SECONDS}s)`,
      };
    }

    // Check file size (50MB max)
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    if (metadata.size > MAX_SIZE) {
      return {
        valid: false,
        error: `Video file size (${(metadata.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size (50MB)`,
      };
    }

    return { valid: true };
  } catch (error: any) {
    console.error('Error validating video:', error);
    // If validation fails, we'll allow the file but log the error
    // This prevents blocking uploads if ffprobe is not available
    return { valid: true }; // Allow upload if validation fails (graceful degradation)
  }
}

