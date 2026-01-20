import express from 'express';
import helmet from 'helmet';
import request from 'supertest';

describe('Security headers', () => {
  it('includes required security headers', async () => {
    const app = express();
    app.use(
      helmet({
        crossOriginEmbedderPolicy: false,
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://static-cdn.jtvnw.net', 'https://*.twitch.tv'],
            mediaSrc: ["'self'", 'data:', 'blob:', 'https://static-cdn.jtvnw.net'],
            connectSrc: [
              "'self'",
              'wss:',
              'ws:',
              'https://id.twitch.tv',
              'https://api.twitch.tv',
              'https://static-cdn.jtvnw.net',
            ],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'", 'https://id.twitch.tv'],
            frameAncestors: ["'none'"],
            upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null,
          },
        },
        permissionsPolicy: {
          directives: {
            accelerometer: [],
            camera: [],
            geolocation: [],
            gyroscope: [],
            magnetometer: [],
            microphone: [],
            payment: [],
            usb: [],
          },
        },
      })
    );
    app.use((_req, res, next) => {
      res.setHeader(
        'Permissions-Policy',
        'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()'
      );
      next();
    });
    app.get('/health', (_req, res) => res.json({ ok: true }));

    const res = await request(app).get('/health');

    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBeDefined();
    expect(res.headers['x-frame-options']).toBeDefined();
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['permissions-policy']).toContain('accelerometer=()');
  });
});
