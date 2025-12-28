import { isBetaDomain } from '../src/middleware/betaAccess.js';

function makeReq(headers: Record<string, string | undefined>) {
  return {
    get(name: string) {
      const key = Object.keys(headers).find((k) => k.toLowerCase() === name.toLowerCase());
      return (key ? headers[key] : undefined) as any;
    },
  } as any;
}

describe('betaAccess.isBetaDomain', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('detects beta from x-forwarded-host or host', () => {
    process.env.DOMAIN = 'example.com';
    expect(isBetaDomain(makeReq({ 'x-forwarded-host': 'beta.example.com' }))).toBe(true);
    expect(isBetaDomain(makeReq({ host: 'beta.example.com' }))).toBe(true);
    expect(isBetaDomain(makeReq({ host: 'example.com' }))).toBe(false);
  });

  it('detects beta from process.env.DOMAIN', () => {
    process.env.DOMAIN = 'beta.example.com';
    expect(isBetaDomain(makeReq({ host: 'example.com' }))).toBe(true);
  });
});


