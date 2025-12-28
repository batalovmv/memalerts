import path from 'node:path';
import { sanitizeFilename, validatePathWithinDirectory, safePathJoin } from '../src/utils/pathSecurity.js';

describe('pathSecurity', () => {
  it('sanitizeFilename removes traversal and dangerous characters', () => {
    // We only care that traversal/dir separators are removed; exact prefixing may vary.
    expect(sanitizeFilename('../evil.mp4')).toMatch(/evil\.mp4$/);
    expect(sanitizeFilename('..\\evil.mp4')).toMatch(/evil\.mp4$/);
    const s = sanitizeFilename('sub/dir\\name<>:"|?*.mp4');
    expect(s).toMatch(/^sub_dir_name_+\.mp4$/);
    expect(s).not.toMatch(/[\/\\]/);
    expect(s).not.toMatch(/[<>:"|?*]/);
  });

  it('validatePathWithinDirectory blocks escaping baseDir', () => {
    const base = path.resolve('/tmp/base');
    expect(() => validatePathWithinDirectory('../outside.txt', base)).toThrow(/Path traversal detected/i);
    expect(() => validatePathWithinDirectory('/etc/passwd', base)).toThrow(/Path traversal detected/i);
    expect(validatePathWithinDirectory('ok/file.txt', base)).toContain(path.join(base, 'ok', 'file.txt'));
  });

  it('safePathJoin always returns a path within baseDir', () => {
    const base = path.resolve('/tmp/uploads');
    const p = safePathJoin(base, '../../etc/passwd');
    expect(p.startsWith(base)).toBe(true);
    expect(path.basename(p)).toBe('passwd');
  });
});


