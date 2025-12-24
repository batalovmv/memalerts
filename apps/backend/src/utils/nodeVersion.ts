import { logger } from './logger.js';

export function ensureNodeMajor(requiredMajor: number): void {
  const raw = String(process.versions?.node || '');
  const major = Number.parseInt(raw.split('.')[0] || '', 10);
  if (!Number.isFinite(major) || major < requiredMajor) {
    logger.error('runtime.node_version_unsupported', {
      requiredMajor,
      actual: raw || null,
    });
    throw new Error(`Unsupported Node.js version: ${raw || 'unknown'}. Required: ${requiredMajor}+`);
  }
}


