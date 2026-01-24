import type { VideoProbe } from './videoProbe.js';

export function isAudioCompatible(probe: VideoProbe | null): boolean {
  if (!probe?.hasAudio) return true;
  return (probe.audioCodec || '').toLowerCase() === 'aac';
}
