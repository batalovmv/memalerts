import { isLocalhostAddress } from '../src/utils/isLocalhostAddress.js';

describe('isLocalhostAddress', () => {
  it('accepts common localhost forms', () => {
    expect(isLocalhostAddress('127.0.0.1')).toBe(true);
    expect(isLocalhostAddress('::1')).toBe(true);
    expect(isLocalhostAddress('::ffff:127.0.0.1')).toBe(true);
    expect(isLocalhostAddress('  ::ffff:127.0.0.1  ')).toBe(true);
  });

  it('rejects non-local addresses', () => {
    expect(isLocalhostAddress('')).toBe(false);
    expect(isLocalhostAddress(null)).toBe(false);
    expect(isLocalhostAddress(undefined)).toBe(false);
    expect(isLocalhostAddress('10.0.0.1')).toBe(false);
    expect(isLocalhostAddress('192.168.0.1')).toBe(false);
    expect(isLocalhostAddress('::ffff:10.0.0.1')).toBe(false);
    expect(isLocalhostAddress('8.8.8.8')).toBe(false);
  });
});
