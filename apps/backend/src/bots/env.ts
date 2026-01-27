import { z } from 'zod';
import { logger } from '../utils/logger.js';

const baseRunnerSchema = z.object({
  DATABASE_URL: z.string().url(),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  CHATBOT_BACKEND_BASE_URL: z.string().url().optional(),
  CHATBOT_BACKEND_BASE_URLS: z.string().min(1).optional(),

  CHAT_BOT_LOGIN: z.string().min(1).optional(),
  CHAT_BOT_USER_ID: z.string().min(1).optional(),
  CHAT_BOT_TWITCH_USER_ID: z.string().min(1).optional(),
  CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),

  YOUTUBE_BOT_REFRESH_TOKEN: z.string().min(1).optional(),
  YOUTUBE_CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  YOUTUBE_CHATBOT_LIVE_CHECK_SECONDS: z.coerce.number().int().optional(),
  YOUTUBE_CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),

  VKVIDEO_CHAT_BOT_ENABLED: z.string().min(1).optional(),
  VKVIDEO_API_BASE_URL: z.string().url().optional(),
  VKVIDEO_PUBSUB_WS_URL: z.string().url().optional(),
  VKVIDEO_CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  VKVIDEO_CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),
  VKVIDEO_PUBSUB_REFRESH_SECONDS: z.coerce.number().int().optional(),

  DOMAIN: z.string().min(1).optional(),
  PORT: z.coerce.number().int().optional(),
});

function withBaseUrlValidation<T extends typeof baseRunnerSchema>(schema: T, label: string) {
  return schema.superRefine((env, ctx) => {
    const urls: string[] = [];
    if (env.CHATBOT_BACKEND_BASE_URL) {
      urls.push(env.CHATBOT_BACKEND_BASE_URL);
    }
    if (env.CHATBOT_BACKEND_BASE_URLS) {
      const parts = env.CHATBOT_BACKEND_BASE_URLS.split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      urls.push(...parts);
      for (const part of parts) {
        try {
          new URL(part);
        } catch {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `CHATBOT_BACKEND_BASE_URLS contains invalid URL: ${part}`,
            path: ['CHATBOT_BACKEND_BASE_URLS'],
          });
          break;
        }
      }
    }
    if (urls.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `${label} requires CHATBOT_BACKEND_BASE_URL or CHATBOT_BACKEND_BASE_URLS`,
        path: ['CHATBOT_BACKEND_BASE_URL'],
      });
    }
  });
}

const chatbotRunnerSchema = withBaseUrlValidation(baseRunnerSchema, 'chatbot runner');
const youtubeChatbotRunnerSchema = withBaseUrlValidation(baseRunnerSchema, 'youtube chatbot runner');
const vkvideoChatbotRunnerSchema = withBaseUrlValidation(baseRunnerSchema, 'vkvideo chatbot runner');
export type ChatbotRunnerEnv = z.infer<typeof chatbotRunnerSchema>;
export type YoutubeChatbotRunnerEnv = z.infer<typeof youtubeChatbotRunnerSchema>;
export type VkvideoChatbotRunnerEnv = z.infer<typeof vkvideoChatbotRunnerSchema>;

function validateRunnerEnv<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, label: string): T {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    logger.error('chatbot.env_invalid', { label, errors: result.error.format() });
    process.exit(1);
  }
  return result.data;
}

export function validateChatbotEnv(): ChatbotRunnerEnv {
  return validateRunnerEnv(chatbotRunnerSchema, 'chatbot runner');
}

export function validateYoutubeChatbotEnv(): YoutubeChatbotRunnerEnv {
  return validateRunnerEnv(youtubeChatbotRunnerSchema, 'youtube chatbot runner');
}

export function validateVkvideoChatbotEnv(): VkvideoChatbotRunnerEnv {
  return validateRunnerEnv(vkvideoChatbotRunnerSchema, 'vkvideo chatbot runner');
}
