import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const fsMocks = vi.hoisted(() => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
}));

const multerMocks = vi.hoisted(() => {
  const instances: Array<{ opts: Record<string, unknown>; single: ReturnType<typeof vi.fn> }> = [];
  let singleHandler: ((req: unknown, res: unknown, cb: (err?: unknown) => void) => void) | null = null;

  const diskStorage = vi.fn((opts: Record<string, unknown>) => opts);
  const multer = vi.fn((opts: Record<string, unknown>) => {
    const single = vi.fn((_field: string) => (req: unknown, res: unknown, cb: (err?: unknown) => void) => {
      if (singleHandler) {
        singleHandler(req, res, cb);
        return;
      }
      cb();
    });
    instances.push({ opts, single });
    return { single };
  });
  (multer as typeof multer & { diskStorage?: typeof diskStorage }).diskStorage = diskStorage;

  return {
    multer,
    diskStorage,
    instances,
    setSingleHandler: (handler: typeof singleHandler) => {
      singleHandler = handler;
    },
  };
});

vi.mock('fs', () => ({
  default: fsMocks,
  existsSync: fsMocks.existsSync,
  mkdirSync: fsMocks.mkdirSync,
}));

vi.mock('multer', () => ({
  default: multerMocks.multer,
  diskStorage: multerMocks.diskStorage,
}));

const baseEnv = { ...process.env };

type TestResponse = {
  statusCode: number;
  headersSent: boolean;
  body?: unknown;
  status: (code: number) => TestResponse;
  json: (body: unknown) => TestResponse;
};

function makeRes(): TestResponse {
  const res: TestResponse = {
    statusCode: 200,
    headersSent: false,
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(body: unknown) {
      res.body = body;
      return res;
    },
  };
  return res;
}

beforeEach(() => {
  process.env = { ...baseEnv };
  multerMocks.instances.length = 0;
  multerMocks.setSingleHandler(null);
  fsMocks.existsSync.mockReset().mockReturnValue(true);
  fsMocks.mkdirSync.mockReset();
  vi.resetModules();
});

afterEach(() => {
  process.env = { ...baseEnv };
  vi.restoreAllMocks();
});

describe('middleware: upload', () => {
  it('configures multer limits from env', async () => {
    process.env.MAX_FILE_SIZE = '12345';
    const { upload } = await import('../src/middleware/upload.js');

    expect(upload).toBeTruthy();
    expect(multerMocks.instances).toHaveLength(1);
    const opts = multerMocks.instances[0].opts;
    const limits = opts.limits as { fileSize?: number };
    expect(limits.fileSize).toBe(12345);
  });

  it('marks invalid file types via fileFilter', async () => {
    await import('../src/middleware/upload.js');
    const opts = multerMocks.instances[0].opts;
    const fileFilter = opts.fileFilter as (
      req: Record<string, unknown>,
      file: { mimetype: string; originalname?: string },
      cb: (err: unknown, accept?: boolean) => void
    ) => void;

    const req = {} as { fileValidationError?: { name?: string; errorCode?: string } };
    const cb = vi.fn();
    fileFilter(req, { mimetype: 'image/png', originalname: 'file.png' }, cb);

    expect(req.fileValidationError?.name).toBe('ApiError');
    expect(req.fileValidationError?.errorCode).toBe('INVALID_FILE_TYPE');
    expect(cb).toHaveBeenCalledWith(null, true);
  });

  it('handles multer size errors', async () => {
    const { uploadWithLogging } = await import('../src/middleware/upload.js');
    multerMocks.setSingleHandler((_req, _res, cb) => {
      cb({ code: 'LIMIT_FILE_SIZE', message: 'too big' });
    });

    const res = makeRes();
    const next = vi.fn();
    await uploadWithLogging({} as never, res as never, next);

    expect(res.statusCode).toBe(413);
    expect(res.body).toMatchObject({ errorCode: 'FILE_TOO_LARGE' });
    expect(next).not.toHaveBeenCalled();
  });

  it('handles ApiError from multer', async () => {
    const { uploadWithLogging } = await import('../src/middleware/upload.js');
    const { ApiError } = await import('../src/shared/apiError.js');
    const apiErr = new ApiError({ status: 400, errorCode: 'BAD_REQUEST', message: 'bad file' });
    multerMocks.setSingleHandler((_req, _res, cb) => cb(apiErr));

    const res = makeRes();
    await uploadWithLogging({} as never, res as never, vi.fn());

    expect(res.statusCode).toBe(400);
    expect(res.body).toMatchObject({ errorCode: 'BAD_REQUEST', error: 'bad file' });
  });

  it('calls next on successful upload', async () => {
    const { uploadWithLogging } = await import('../src/middleware/upload.js');
    multerMocks.setSingleHandler((_req, _res, cb) => cb());

    const res = makeRes();
    const next = vi.fn();
    await uploadWithLogging({} as never, res as never, next);

    expect(next).toHaveBeenCalled();
  });

  it('returns timeout response when upload hangs', async () => {
    vi.useFakeTimers();
    const { uploadWithLogging } = await import('../src/middleware/upload.js');
    multerMocks.setSingleHandler((_req, _res, _cb) => {
      // simulate hang
    });

    const res = makeRes();
    await uploadWithLogging({} as never, res as never, vi.fn());
    await vi.advanceTimersByTimeAsync(120000);

    expect(res.statusCode).toBe(408);
    expect(res.body).toMatchObject({ errorCode: 'UPLOAD_TIMEOUT' });
    vi.useRealTimers();
  });
});
