import fs from 'node:fs';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type CommandMock = {
  outputOptions: ReturnType<typeof vi.fn>;
  videoFilters: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  kill: ReturnType<typeof vi.fn>;
};

const ffmpegMocks = vi.hoisted(() => {
  const state = { commands: [] as CommandMock[] };
  const ffprobe = vi.fn();
  const setFfmpegPath = vi.fn();
  const setFfprobePath = vi.fn();

  const createCommand = (): CommandMock => {
    const handlers: Record<string, (...args: unknown[]) => void> = {};
    const command: CommandMock = {
      outputOptions: vi.fn(() => command),
      videoFilters: vi.fn(() => command),
      on: vi.fn((event: string, cb: (...args: unknown[]) => void) => {
        handlers[event] = cb;
        return command;
      }),
      save: vi.fn(() => {
        if (handlers.end) handlers.end();
        return command;
      }),
      kill: vi.fn(),
    };
    return command;
  };

  const factory = vi.fn(() => {
    const command = createCommand();
    state.commands.push(command);
    return command;
  });

  return {
    factory,
    ffprobe,
    setFfmpegPath,
    setFfprobePath,
    state,
  };
});

const ffmpegInstallerState = vi.hoisted(() => ({ path: '' }));

const loggerMock = vi.hoisted(() => ({
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock('fluent-ffmpeg', () => {
  const factory = ffmpegMocks.factory;
  factory.ffprobe = ffmpegMocks.ffprobe;
  factory.setFfmpegPath = ffmpegMocks.setFfmpegPath;
  factory.setFfprobePath = ffmpegMocks.setFfprobePath;
  return { default: factory };
});
vi.mock('@ffmpeg-installer/ffmpeg', () => ({ default: ffmpegInstallerState }));
vi.mock('../src/utils/logger.js', () => ({ logger: loggerMock }));

const baseEnv = { ...process.env };

async function importConfigure() {
  return await import('../src/utils/media/configureFfmpeg.js');
}

async function importVideoNormalization() {
  return await import('../src/utils/media/videoNormalization.js');
}

async function importVideoValidator() {
  return await import('../src/utils/videoValidator.js');
}

beforeEach(() => {
  process.env = { ...baseEnv, LOG_SILENT_TESTS: '1' };
  ffmpegMocks.state.commands.length = 0;
  ffmpegMocks.factory.mockClear();
  ffmpegMocks.ffprobe.mockReset();
  ffmpegMocks.setFfmpegPath.mockReset();
  ffmpegMocks.setFfprobePath.mockReset();
  loggerMock.debug.mockReset();
  loggerMock.info.mockReset();
  loggerMock.warn.mockReset();
  loggerMock.error.mockReset();
  ffmpegInstallerState.path = '';
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('utils: media', () => {
  it('configures ffmpeg paths from env overrides', async () => {
    const ffmpegPath = path.join('C:', 'ffmpeg', 'bin', 'ffmpeg.exe');
    const ffprobePath = path.join('C:', 'ffmpeg', 'bin', 'ffprobe.exe');
    process.env.FFMPEG_PATH = ffmpegPath;
    process.env.FFPROBE_PATH = ffprobePath;

    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const candidate = String(p);
      return candidate === ffmpegPath || candidate === ffprobePath;
    });

    const { configureFfmpegPaths } = await importConfigure();
    configureFfmpegPaths();

    expect(ffmpegMocks.setFfmpegPath).toHaveBeenCalledWith(ffmpegPath);
    expect(ffmpegMocks.setFfprobePath).toHaveBeenCalledWith(ffprobePath);
  });

  it('infers ffprobe path next to ffmpeg when not provided', async () => {
    const ffmpegPath =
      process.platform === 'win32' ? path.join('C:', 'ffmpeg', 'bin', 'ffmpeg.exe') : '/usr/bin/ffmpeg';
    const inferred = path.join(path.dirname(ffmpegPath), process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe');
    process.env.FFMPEG_PATH = ffmpegPath;
    delete process.env.FFPROBE_PATH;

    vi.spyOn(fs, 'existsSync').mockImplementation((p) => {
      const candidate = String(p);
      return candidate === ffmpegPath || candidate === inferred;
    });

    const { configureFfmpegPaths } = await importConfigure();
    configureFfmpegPaths();

    expect(ffmpegMocks.setFfmpegPath).toHaveBeenCalledWith(ffmpegPath);
    expect(ffmpegMocks.setFfprobePath).toHaveBeenCalledWith(inferred);
  });

  it('skips transcode when video already matches constraints', async () => {
    ffmpegMocks.ffprobe.mockImplementationOnce((file: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, {
        format: { format_name: 'mov,mp4,m4a,3gp,3g2,mj2', duration: 1 },
        streams: [
          { codec_type: 'video', codec_name: 'h264', width: 640, height: 360, avg_frame_rate: '30/1' },
          { codec_type: 'audio', codec_name: 'aac' },
        ],
      });
    });

    const { normalizeVideoForPlayback } = await importVideoNormalization();
    const inputPath = path.join('C:', 'tmp', 'input.mp4');
    const result = await normalizeVideoForPlayback({ inputPath, maxWidth: 1920, maxHeight: 1080, maxFps: 30 });

    expect(result.transcodeSkipped).toBe(true);
    expect(result.outputPath).toBe(inputPath);
    expect(result.durationMs).toBe(1000);
    expect(ffmpegMocks.factory).not.toHaveBeenCalled();
  });

  it('transcodes and applies filters when constraints are exceeded', async () => {
    ffmpegMocks.ffprobe
      .mockImplementationOnce((file: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          format: { format_name: 'matroska', duration: 1.5 },
          streams: [
            { codec_type: 'video', codec_name: 'vp9', width: 640, height: 480, avg_frame_rate: '30/1' },
            { codec_type: 'audio', codec_name: 'opus' },
          ],
        });
      })
      .mockImplementationOnce((file: string, cb: (err: Error | null, data: unknown) => void) => {
        cb(null, {
          format: { format_name: 'mov,mp4,m4a', duration: 2.5 },
          streams: [{ codec_type: 'video', codec_name: 'h264', width: 320, height: 240, avg_frame_rate: '24/1' }],
        });
      });

    vi.spyOn(fs.promises, 'mkdir').mockResolvedValue(undefined);

    const { normalizeVideoForPlayback } = await importVideoNormalization();
    const inputPath = path.join('C:', 'tmp', 'input.mkv');
    const result = await normalizeVideoForPlayback({ inputPath, maxWidth: 320, maxHeight: 240, maxFps: 24 });

    expect(result.transcodeSkipped).toBe(false);
    expect(result.outputPath).toContain('.normalized-');
    expect(result.outputPath).toMatch(/\.mp4$/);
    expect(result.durationMs).toBe(2500);
    expect(ffmpegMocks.factory).toHaveBeenCalledTimes(1);
    expect(ffmpegMocks.state.commands).toHaveLength(1);
    expect(ffmpegMocks.state.commands[0].videoFilters).toHaveBeenCalledWith([
      "scale='min(320,iw)':'min(240,ih)':force_original_aspect_ratio=decrease",
      'fps=24',
      "scale='max(trunc(iw/2)*2,2)':'max(trunc(ih/2)*2,2)'",
    ]);
  });

  it('reads metadata via ffprobe', async () => {
    ffmpegMocks.ffprobe.mockImplementationOnce((file: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, {
        format: { duration: 12.3 },
        streams: [{ codec_type: 'video', width: 1280, height: 720 }],
      });
    });

    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 2048 } as fs.Stats);

    const { getVideoMetadata } = await importVideoValidator();
    const metadata = await getVideoMetadata(path.join('C:', 'tmp', 'video.mp4'));

    expect(metadata).toEqual({ duration: 12.3, width: 1280, height: 720, size: 2048 });
  });

  it('rejects videos exceeding max duration', async () => {
    ffmpegMocks.ffprobe.mockImplementationOnce((file: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, {
        format: { duration: 20 },
        streams: [{ codec_type: 'video', width: 640, height: 360 }],
      });
    });

    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 1024 } as fs.Stats);

    const { validateVideo } = await importVideoValidator();
    const result = await validateVideo(path.join('C:', 'tmp', 'video.mp4'));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/duration/i);
  });

  it('rejects videos exceeding max size', async () => {
    ffmpegMocks.ffprobe.mockImplementationOnce((file: string, cb: (err: Error | null, data: unknown) => void) => {
      cb(null, {
        format: { duration: 10 },
        streams: [{ codec_type: 'video', width: 640, height: 360 }],
      });
    });

    vi.spyOn(fs.promises, 'stat').mockResolvedValue({ size: 60 * 1024 * 1024 } as fs.Stats);

    const { validateVideo } = await importVideoValidator();
    const result = await validateVideo(path.join('C:', 'tmp', 'video.mp4'));

    expect(result.valid).toBe(false);
    expect(result.error).toMatch(/size/i);
  });
});
