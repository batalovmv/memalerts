import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import { detectFileTypeByMagicBytes, validateFileContent } from '../src/utils/fileTypeValidator.js';

async function writeTmpFile(buf: Buffer, name: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'memalerts-ft-'));
  const filePath = path.join(dir, name);
  await fs.writeFile(filePath, buf);
  return filePath;
}

describe('fileTypeValidator (magic bytes)', () => {
  it('detects mp4 and validates declared mime', async () => {
    // 00 00 00 18 ftyp isom ...
    const mp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const filePath = await writeTmpFile(mp4, 'a.mp4');

    expect(await detectFileTypeByMagicBytes(filePath)).toBe('video/mp4');
    expect(await validateFileContent(filePath, 'video/mp4')).toMatchObject({ valid: true, detectedType: 'video/mp4' });
  });

  it('detects webm/matroska and allows webm<->x-matroska', async () => {
    const webm = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0x93, 0x42, 0x82, 0x88, 0x77, 0x65, 0x62, 0x6d]);
    const filePath = await writeTmpFile(webm, 'a.webm');

    const detected = await detectFileTypeByMagicBytes(filePath);
    expect(detected === 'video/webm' || detected === 'video/x-matroska').toBe(true);

    // Either declared type should validate due to the compatibility rule.
    const v1 = await validateFileContent(filePath, 'video/webm');
    const v2 = await validateFileContent(filePath, 'video/x-matroska');
    expect(v1.valid || v2.valid).toBe(true);
  });

  it('rejects non-video declared mime', async () => {
    const junk = Buffer.from('hello world');
    const filePath = await writeTmpFile(junk, 'a.txt');
    const v = await validateFileContent(filePath, 'text/plain');
    expect(v.valid).toBe(false);
    expect(v.error).toContain('Only video files are allowed');
  });

  it('rejects mismatch between declared and detected type', async () => {
    const mp4 = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d]);
    const filePath = await writeTmpFile(mp4, 'a.mp4');
    const v = await validateFileContent(filePath, 'video/webm');
    expect(v.valid).toBe(false);
    expect(v.error).toContain('File type mismatch');
    expect(v.detectedType).toBe('video/mp4');
  });
});
