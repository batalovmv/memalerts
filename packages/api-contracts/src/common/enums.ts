import { z } from 'zod';

export const UserRoleSchema = z.enum(['viewer', 'streamer', 'admin']);

export const MemeCatalogModeSchema = z.enum(['channel', 'pool_all']);

export const BotProviderSchema = z.enum(['twitch', 'youtube', 'vkvideo', 'trovo', 'kick']);

export const SubmissionSourceKindSchema = z.enum(['upload', 'url', 'pool']);

export const MemeAssetStatusSchema = z.enum(['active', 'hidden', 'quarantined', 'deleted']);

export const SubmissionStatusSchema = z.enum(['pending', 'needs_changes', 'approved', 'rejected']);

export const SubmissionAiStatusSchema = z.enum(['pending', 'processing', 'done', 'failed', 'failed_final']);

export const SubmissionAiDecisionSchema = z.enum(['low', 'medium', 'high']);

export type UserRole = z.infer<typeof UserRoleSchema>;
export type MemeCatalogMode = z.infer<typeof MemeCatalogModeSchema>;
export type BotProvider = z.infer<typeof BotProviderSchema>;
export type SubmissionSourceKind = z.infer<typeof SubmissionSourceKindSchema>;
export type MemeAssetStatus = z.infer<typeof MemeAssetStatusSchema>;
export type SubmissionStatus = z.infer<typeof SubmissionStatusSchema>;
export type SubmissionAiStatus = z.infer<typeof SubmissionAiStatusSchema>;
export type SubmissionAiDecision = z.infer<typeof SubmissionAiDecisionSchema>;
