import type { z } from 'zod';
import type { updateChannelSettingsSchema } from '../../../shared/schemas.js';

export type UpdateChannelSettingsBody = z.infer<typeof updateChannelSettingsSchema>;

export function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
