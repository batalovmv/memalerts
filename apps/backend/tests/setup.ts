import { afterAll, afterEach, beforeAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { resetMockHandlers, startMockServer, stopMockServer } from './mocks/server.js';

const silent = process.env.LOG_SILENT_TESTS === '1' || process.env.NODE_ENV === 'test';
if (!process.env.LOG_LEVEL) {
  process.env.LOG_LEVEL = 'error';
}
if (!process.env.LOG_SILENT_TESTS) {
  process.env.LOG_SILENT_TESTS = '1';
}
if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test';
}

if (silent) {
  // Reduce noise in test output while keeping console.error intact.

  console.log = () => {};

  console.info = () => {};

  console.debug = () => {};

  console.warn = () => {};
}

const mockServerEnabled = String(process.env.MOCK_SERVER_ENABLED || '').toLowerCase();
const shouldStartMockServer = !(
  mockServerEnabled === '0' ||
  mockServerEnabled === 'false' ||
  mockServerEnabled === 'off'
);

beforeAll(() => {
  if (shouldStartMockServer) {
    startMockServer({ onUnhandledRequest: 'warn' });
  }
});

afterEach(() => {
  if (shouldStartMockServer) {
    resetMockHandlers();
  }
});

afterAll(async () => {
  if (shouldStartMockServer) {
    stopMockServer();
  }
  await prisma.$disconnect();
});
