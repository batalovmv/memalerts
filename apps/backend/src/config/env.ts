import { z } from 'zod';
import { logger } from '../utils/logger.js';

const envSchemaBase = z.object({
  DATABASE_URL: z.string().url(),
  JWT_SECRET: z.string().min(16),
  JWT_SECRET_PREVIOUS: z.string().min(16).optional(),
  TWITCH_CLIENT_ID: z.string().min(1),
  TWITCH_CLIENT_SECRET: z.string().min(1),
  TWITCH_EVENTSUB_SECRET: z.string().min(1),

  DOMAIN: z.string().min(1).optional(),
  WEB_URL: z.string().url().optional(),
  OVERLAY_URL: z.string().url().optional(),
  TWITCH_CALLBACK_URL: z.string().url().optional(),

  PORT: z.coerce.number().int().optional().default(3001),
  NODE_ENV: z.enum(['development', 'test', 'production']).optional().default('development'),
  INSTANCE: z.enum(['beta', 'production', '']).optional().default(''),
  INSTANCE_ID: z.string().min(1).optional(),

  JSON_BODY_LIMIT: z.string().min(1).optional(),
  URLENCODED_BODY_LIMIT: z.string().min(1).optional(),

  JWT_EXPIRES_IN: z.string().min(1).optional(),

  YOUTUBE_CLIENT_ID: z.string().min(1).optional(),
  YOUTUBE_CLIENT_SECRET: z.string().min(1).optional(),
  YOUTUBE_CALLBACK_URL: z.string().url().optional(),
  YOUTUBE_BOT_REFRESH_TOKEN: z.string().min(1).optional(),

  VK_CLIENT_ID: z.string().min(1).optional(),
  VK_CLIENT_SECRET: z.string().min(1).optional(),
  VK_CALLBACK_URL: z.string().url().optional(),

  TROVO_ENABLED: z.string().min(1).optional(),
  TROVO_CLIENT_ID: z.string().min(1).optional(),
  TROVO_CLIENT_SECRET: z.string().min(1).optional(),
  TROVO_CALLBACK_URL: z.string().url().optional(),
  TROVO_SCOPES: z.string().min(1).optional(),
  TROVO_TOKEN_URL: z.string().url().optional(),
  TROVO_REFRESH_URL: z.string().url().optional(),
  TROVO_USERINFO_URL: z.string().url().optional(),

  KICK_CLIENT_ID: z.string().min(1).optional(),
  KICK_CLIENT_SECRET: z.string().min(1).optional(),
  KICK_CALLBACK_URL: z.string().url().optional(),
  KICK_AUTHORIZE_URL: z.string().url().optional(),
  KICK_TOKEN_URL: z.string().url().optional(),
  KICK_REFRESH_URL: z.string().url().optional(),
  KICK_USERINFO_URL: z.string().url().optional(),
  KICK_SCOPES: z.string().min(1).optional(),

  KICK_WEBHOOK_CALLBACK_URL: z.string().url().optional(),
  KICK_WEBHOOK_REPLAY_WINDOW_MS: z.coerce.number().int().optional(),
  KICK_WEBHOOK_PUBLIC_KEY_PEM: z.string().min(1).optional(),

  MAX_FILE_SIZE: z.coerce.number().int().optional(),
  UPLOAD_DIR: z.string().min(1).optional(),

  VIDEO_FFPROBE_CONCURRENCY: z.coerce.number().int().optional(),
  FILE_HASH_CONCURRENCY: z.coerce.number().int().optional(),
  VIDEO_TRANSCODE_CONCURRENCY: z.coerce.number().int().optional(),
  VIDEO_TRANSCODE_TIMEOUT_MS: z.coerce.number().int().optional(),
  VIDEO_MAX_WIDTH: z.coerce.number().int().optional(),
  VIDEO_MAX_HEIGHT: z.coerce.number().int().optional(),
  VIDEO_MAX_FPS: z.coerce.number().int().optional(),

  UPLOAD_STORAGE: z.enum(['local', 's3']).optional(),
  S3_BUCKET: z.string().min(1).optional(),
  S3_ACCESS_KEY_ID: z.string().min(1).optional(),
  S3_SECRET_ACCESS_KEY: z.string().min(1).optional(),
  S3_PUBLIC_BASE_URL: z.string().url().optional(),
  S3_ENDPOINT: z.string().url().optional(),
  S3_REGION: z.string().min(1).optional(),
  S3_KEY_PREFIX: z.string().min(1).optional(),
  S3_FORCE_PATH_STYLE: z.string().min(1).optional(),

  REDIS_URL: z.string().min(1).optional(),
  RATE_LIMIT_REDIS: z.string().min(1).optional(),
  TRUSTED_PROXY_IPS: z.string().min(1).optional(),
  BULLMQ_PREFIX: z.string().min(1).optional(),

  AI_MODERATION_STUCK_MS: z.coerce.number().int().optional(),
  AI_MAX_RETRIES: z.coerce.number().int().optional(),
  AI_MODERATION_MEDIUM_THRESHOLD: z.coerce.number().optional(),
  AI_MODERATION_HIGH_THRESHOLD: z.coerce.number().optional(),
  AI_QUARANTINE_DAYS: z.coerce.number().int().optional(),
  AI_LOW_AUTOPROVE_ENABLED: z.string().min(1).optional(),
  AI_PENDING_FILE_RETENTION_HOURS: z.coerce.number().int().optional(),
  AI_PENDING_FILE_CLEANUP_INTERVAL_MS: z.coerce.number().int().optional(),
  AI_PENDING_FILE_CLEANUP_BATCH: z.coerce.number().int().optional(),

  AI_METADATA_ENABLED: z.string().min(1).optional(),
  AI_VISION_ENABLED: z.string().min(1).optional(),
  AI_VISION_MAX_FRAMES: z.coerce.number().int().optional(),
  AI_VISION_STEP_SECONDS: z.coerce.number().int().optional(),
  AI_BULLMQ_ENABLED: z.string().min(1).optional(),
  AI_BULLMQ_CONCURRENCY: z.coerce.number().int().optional(),

  OPENAI_API_KEY: z.string().min(1).optional(),
  OPENAI_HTTP_TIMEOUT_MS: z.coerce.number().int().optional(),
  AI_FFMPEG_TIMEOUT_MS: z.coerce.number().int().optional(),
  AI_PER_SUBMISSION_TIMEOUT_MS: z.coerce.number().int().optional(),
  AI_LOCK_TTL_MS: z.coerce.number().int().optional(),
  AI_FILEHASH_TIMEOUT_MS: z.coerce.number().int().optional(),
  OPENAI_ASR_MODEL: z.string().min(1).optional(),
  OPENAI_MODERATION_MODEL: z.string().min(1).optional(),

  CHAT_BOT_ENABLED: z.string().min(1).optional(),
  CHAT_BOT_LOGIN: z.string().min(1).optional(),
  CHAT_BOT_USER_ID: z.string().min(1).optional(),
  CHAT_BOT_TWITCH_USER_ID: z.string().min(1).optional(),
  CHAT_BOT_CHANNELS: z.string().min(1).optional(),
  CHAT_BOT_CHANNEL_MAP_JSON: z.string().min(1).optional(),
  CHATBOT_BACKEND_BASE_URL: z.string().url().optional(),
  CHATBOT_BACKEND_BASE_URLS: z.string().min(1).optional(),
  CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),
  CHATBOT_COMMANDS_REFRESH_SECONDS: z.coerce.number().int().optional(),

  YOUTUBE_CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  YOUTUBE_CHATBOT_LIVE_CHECK_SECONDS: z.coerce.number().int().optional(),
  YOUTUBE_CHATBOT_COMMANDS_REFRESH_SECONDS: z.coerce.number().int().optional(),
  YOUTUBE_CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),

  VKVIDEO_CHAT_BOT_ENABLED: z.string().min(1).optional(),
  VKVIDEO_API_BASE_URL: z.string().url().optional(),
  VKVIDEO_PUBSUB_WS_URL: z.string().url().optional(),
  VKVIDEO_CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  VKVIDEO_CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),
  VKVIDEO_CHATBOT_COMMANDS_REFRESH_SECONDS: z.coerce.number().int().optional(),
  VKVIDEO_PUBSUB_REFRESH_SECONDS: z.coerce.number().int().optional(),
  VKVIDEO_USER_ROLES_CACHE_TTL_MS: z.coerce.number().int().optional(),
  VKVIDEO_CHANNEL_ROLES_USER_URL_TEMPLATE: z.string().min(1).optional(),

  TROVO_CHAT_BOT_ENABLED: z.string().min(1).optional(),
  TROVO_CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  TROVO_CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),
  TROVO_CHATBOT_COMMANDS_REFRESH_SECONDS: z.coerce.number().int().optional(),
  TROVO_CHAT_WS_URL: z.string().url().optional(),
  TROVO_CHAT_TOKEN_URL: z.string().url().optional(),
  TROVO_SEND_CHAT_URL: z.string().url().optional(),
  TROVO_BOT_SCOPES: z.string().min(1).optional(),

  KICK_CHAT_BOT_ENABLED: z.string().min(1).optional(),
  KICK_CHATBOT_SYNC_SECONDS: z.coerce.number().int().optional(),
  KICK_CHATBOT_OUTBOX_POLL_MS: z.coerce.number().int().optional(),
  KICK_CHATBOT_COMMANDS_REFRESH_SECONDS: z.coerce.number().int().optional(),
  KICK_CHAT_POLL_URL_TEMPLATE: z.string().min(1).optional(),
  KICK_CHATBOT_INGEST_POLL_MS: z.coerce.number().int().optional(),
  KICK_SEND_CHAT_URL: z.string().min(1).optional(),
  KICK_BOT_SCOPES: z.string().min(1).optional(),

  CHANNEL_DAILY_STATS_ROLLUP_DAYS: z.coerce.number().int().optional(),
  CHANNEL_DAILY_STATS_ROLLUP_INTERVAL_MS: z.coerce.number().int().optional(),
  CHANNEL_DAILY_STATS_ROLLUP_INITIAL_DELAY_MS: z.coerce.number().int().optional(),
  TOP_STATS_30D_ROLLUP_DAYS: z.coerce.number().int().optional(),
  TOP_STATS_30D_ROLLUP_INTERVAL_MS: z.coerce.number().int().optional(),
  TOP_STATS_30D_ROLLUP_INITIAL_DELAY_MS: z.coerce.number().int().optional(),
  MEME_DAILY_STATS_ROLLUP_DAYS: z.coerce.number().int().optional(),
  MEME_DAILY_STATS_ROLLUP_INTERVAL_MS: z.coerce.number().int().optional(),
  MEME_DAILY_STATS_ROLLUP_INITIAL_DELAY_MS: z.coerce.number().int().optional(),

  LOG_LEVEL: z.string().min(1).optional(),
  LOG_DESTINATION: z.string().min(1).optional(),
  LOG_TRANSPORT_TARGET: z.string().min(1).optional(),
  LOG_TRANSPORT_OPTIONS: z.string().min(1).optional(),
  LOG_TRANSPORT_LEVEL: z.string().min(1).optional(),
  OTEL_ENABLED: z.string().min(1).optional(),
  OTEL_DIAG_LOGS: z.string().min(1).optional(),
  OTEL_SUCCESS_SAMPLE_RATE: z.string().min(1).optional(),
  OTEL_TRACE_MAX_MS: z.string().min(1).optional(),
  OTEL_TRACE_DECISION_TTL_MS: z.string().min(1).optional(),
  OTEL_EXPORTER_JAEGER_ENDPOINT: z.string().min(1).optional(),
  OTEL_EXPORTER_JAEGER_AGENT_HOST: z.string().min(1).optional(),
  OTEL_EXPORTER_JAEGER_AGENT_PORT: z.string().min(1).optional(),
  JAEGER_ENDPOINT: z.string().min(1).optional(),
  JAEGER_AGENT_HOST: z.string().min(1).optional(),
  JAEGER_AGENT_PORT: z.string().min(1).optional(),
  SENTRY_DSN: z.string().min(1).optional(),
  SENTRY_RELEASE: z.string().min(1).optional(),
  HTTP_COMPRESSION: z.string().min(1).optional(),
  HTTP_COMPRESSION_THRESHOLD_BYTES: z.coerce.number().int().optional(),
  SOCKET_ORIGINS_LOG: z.string().min(1).optional(),
  SEARCH_PAGE_MAX: z.coerce.number().int().optional(),
  SEARCH_CACHE_MS: z.coerce.number().int().optional(),
  MEME_STATS_CACHE_MS: z.coerce.number().int().optional(),
  PROMO_CACHE_MS: z.coerce.number().int().optional(),

  BOOSTY_REWARDS_MODE: z.enum(['boosty_api', 'discord_roles']).optional(),
  BOOSTY_REWARDS_SYNC_INTERVAL_MS: z.coerce.number().int().optional(),
  BOOSTY_REWARDS_SYNC_INITIAL_DELAY_MS: z.coerce.number().int().optional(),
  BOOSTY_REWARDS_SUBSCRIPTIONS_LIMIT: z.coerce.number().int().optional(),
  BOOSTY_API_BASE_URL: z.string().url().optional(),

  DISCORD_CLIENT_ID: z.string().min(1).optional(),
  DISCORD_CLIENT_SECRET: z.string().min(1).optional(),
  DISCORD_CALLBACK_URL: z.string().url().optional(),
  DISCORD_JOIN_SCOPES: z.string().min(1).optional(),
  DISCORD_TOKEN_URL: z.string().url().optional(),
  DISCORD_USERINFO_URL: z.string().url().optional(),
  DISCORD_DEFAULT_SUBSCRIPTIONS_GUILD_ID: z.string().min(1).optional(),
  DISCORD_SUBSCRIPTIONS_GUILD_ID: z.string().min(1).optional(),
  DISCORD_BOT_TOKEN: z.string().min(1).optional(),
  DISCORD_AUTO_JOIN_GUILD: z.string().min(1).optional(),
  DISCORD_MEMBER_CACHE_TTL_MS: z.coerce.number().int().optional(),
  DISCORD_HTTP_TIMEOUT_MS: z.coerce.number().int().optional(),
});

const envSchema = envSchemaBase.superRefine((env, ctx) => {
  if (env.NODE_ENV !== 'production') return;

  if (!env.DOMAIN) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'DOMAIN is required in production',
      path: ['DOMAIN'],
    });
  }
  if (!env.WEB_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'WEB_URL is required in production',
      path: ['WEB_URL'],
    });
  }
  if (!env.TWITCH_CALLBACK_URL) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'TWITCH_CALLBACK_URL is required in production',
      path: ['TWITCH_CALLBACK_URL'],
    });
  }
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    logger.error('env.invalid', { errors: result.error.format() });
    process.exit(1);
  }
  return result.data;
}

export const env = validateEnv();
