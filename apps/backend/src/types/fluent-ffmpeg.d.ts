declare module 'fluent-ffmpeg' {
  import type { EventEmitter } from 'events';

  interface FFProbeStream {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    bit_rate?: string;
    channels?: number;
    sample_rate?: string;
    duration?: number | string;
    [key: string]: unknown;
  }

  interface FFProbeData {
    format?: {
      duration?: number | string;
      size?: number | string;
      bit_rate?: number | string;
      format_name?: string;
      [key: string]: unknown;
    };
    streams?: FFProbeStream[];
    [key: string]: unknown;
  }

  interface FFProbeCallback {
    (err: Error | null, metadata: FFProbeData): void;
  }

  interface FfmpegCommand extends EventEmitter {
    setFfmpegPath(path: string): FfmpegCommand;
    noVideo(): FfmpegCommand;
    audioCodec(codec: string): FfmpegCommand;
    audioChannels(channels: number): FfmpegCommand;
    audioFrequency(freq: number): FfmpegCommand;
    outputOptions(options: string[]): FfmpegCommand;
    audioFilters(filters: string[] | string): FfmpegCommand;
    videoFilters(filters: string[] | string): FfmpegCommand;
    screenshots(options: { timestamps: number[]; filename: string; folder: string; size?: string }): void;
    save(path: string): FfmpegCommand;
    kill(signal?: string): void;
    on(event: 'end', listener: () => void): FfmpegCommand;
    on(event: 'error', listener: (err: Error) => void): FfmpegCommand;
    on(event: string, listener: (...args: unknown[]) => void): FfmpegCommand;
    [key: string]: unknown;
  }

  function ffmpeg(input?: string): FfmpegCommand;

  namespace ffmpeg {
    function setFfmpegPath(path: string): void;
    function ffprobe(file: string, callback: FFProbeCallback): void;
  }

  export = ffmpeg;
}
