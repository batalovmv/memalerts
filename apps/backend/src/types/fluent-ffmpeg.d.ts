declare module 'fluent-ffmpeg' {
  import { EventEmitter } from 'events';

  interface FFProbeData {
    format: {
      duration?: number;
      size?: number;
      bit_rate?: number;
      [key: string]: any;
    };
    streams?: any[];
    [key: string]: any;
  }

  interface FFProbeCallback {
    (err: Error | null, metadata: FFProbeData): void;
  }

  interface FfmpegCommand extends EventEmitter {
    setFfmpegPath(path: string): FfmpegCommand;
    [key: string]: any;
  }

  function ffmpeg(input?: string): FfmpegCommand;
  
  namespace ffmpeg {
    function setFfmpegPath(path: string): void;
    function ffprobe(file: string, callback: FFProbeCallback): void;
  }

  export = ffmpeg;
}

