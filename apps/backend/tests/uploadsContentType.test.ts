import express from 'express';
import request from 'supertest';
import path from 'path';
import os from 'os';
import fs from 'fs/promises';

describe('Uploads security', () => {
  const uploadStaticOptions = {
    maxAge: '1y',
    immutable: true,
    etag: true,
    setHeaders: (res: { setHeader: (key: string, value: string) => void }, filePath: string) => {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      res.setHeader('X-Content-Type-Options', 'nosniff');
      const ext = filePath.split('.').pop()?.toLowerCase();
      const videoExts = ['mp4', 'webm', 'mov', 'avi', 'mkv'];
      if (!videoExts.includes(ext || '')) {
        res.setHeader('Content-Disposition', 'attachment');
        res.setHeader('Content-Type', 'application/octet-stream');
      }
    },
  };

  let uploadRoot = '';

  afterEach(async () => {
    if (uploadRoot) {
      await fs.rm(uploadRoot, { recursive: true, force: true });
    }
    uploadRoot = '';
  });

  it('serves video files with correct Content-Type', async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-'));
    const videoPath = path.join(uploadRoot, 'test.mp4');
    await fs.writeFile(videoPath, Buffer.from([0x00, 0x01, 0x02]));

    const app = express();
    app.use('/uploads', express.static(uploadRoot, uploadStaticOptions));

    const res = await request(app).get('/uploads/test.mp4');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^video\/mp4/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-disposition']).toBeUndefined();
  });

  it('never serves text/html from /uploads', async () => {
    uploadRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-uploads-'));
    const htmlPath = path.join(uploadRoot, 'evil.html');
    await fs.writeFile(htmlPath, '<html><body>evil</body></html>');

    const app = express();
    app.use('/uploads', express.static(uploadRoot, uploadStaticOptions));

    const res = await request(app).get('/uploads/evil.html');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/^application\/octet-stream/);
    expect(res.headers['content-disposition']).toBe('attachment');
  });
});
