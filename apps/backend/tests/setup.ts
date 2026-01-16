import { afterAll } from 'vitest';
import { prisma } from '../src/lib/prisma.js';

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

afterAll(async () => {
  await prisma.$disconnect();
});
