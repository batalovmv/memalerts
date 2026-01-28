# Environment variables

This table mirrors `ENV.example` and lists all supported environment variables for the backend.

| Variable | Required | Default | Description | Security |
| --- | --- | --- | --- | --- |
| DATABASE_URL | yes | -- | PostgreSQL connection string | secret |
| SKIP_DB_CONNECT | no | -- | Skip DB connection check on startup (dev only) | non-secret |
| PORT | no | 3001 | API HTTP port | non-secret |
| NODE_ENV | no | development | Runtime mode (`development`, `test`, `production`) | non-secret |
| INSTANCE | no | -- | Instance label (`beta`, `production`) | non-secret |
| INSTANCE_ID | no | -- | Unique instance identifier (hostname/pod) | non-secret |
| JSON_BODY_LIMIT | no | 5mb (dev), 1mb (prod) | JSON body size limit | non-secret |
| URLENCODED_BODY_LIMIT | no | 5mb (dev), 1mb (prod) | URL-encoded body size limit | non-secret |
| WEB_URL | prod | -- | Frontend URL for CORS | non-secret |
| OVERLAY_URL | no | -- | Overlay URL for CORS | non-secret |
| DOMAIN | prod | -- | Base domain for API and callbacks | non-secret |
| DEPRECATION_ENABLED | no | -- | Emit deprecation headers on legacy routes | non-secret |
| DEPRECATION_SUNSET | no | -- | Sunset date (RFC1123) for legacy routes | non-secret |
| DEPRECATION_SUCCESSOR | no | /api/v1 | Successor-version URL for legacy routes | non-secret |
| JWT_SECRET | yes | -- | JWT signing secret (use different values for beta/prod) | secret |
| JWT_EXPIRES_IN | no | 7d | JWT expiration duration | non-secret |
| TWITCH_CLIENT_ID | yes | -- | Twitch OAuth client id | secret |
| TWITCH_CLIENT_SECRET | yes | -- | Twitch OAuth client secret | secret |
| TWITCH_CALLBACK_URL | prod | -- | Twitch OAuth callback URL | non-secret |
| TWITCH_EVENTSUB_SECRET | yes | -- | Twitch EventSub signing secret | secret |
| YOUTUBE_CLIENT_ID | no | -- | YouTube OAuth client id (linking) | secret |
| YOUTUBE_CLIENT_SECRET | no | -- | YouTube OAuth client secret (linking) | secret |
| YOUTUBE_CALLBACK_URL | no | -- | YouTube OAuth callback URL | non-secret |
| YOUTUBE_BOT_REFRESH_TOKEN | no | -- | YouTube bot refresh token for sending chat messages | secret |
| VK_CLIENT_ID | no | -- | VK OAuth client id (linking) | secret |
| VK_CLIENT_SECRET | no | -- | VK OAuth client secret (linking) | secret |
| VK_CALLBACK_URL | no | -- | VK OAuth callback URL | non-secret |
| MAX_FILE_SIZE | no | 52428800 | Max upload file size (bytes) | non-secret |
| UPLOAD_DIR | no | ./uploads | Upload directory path | non-secret |
| VIDEO_FFPROBE_CONCURRENCY | no | -- | FFprobe concurrency limit | non-secret |
| FILE_HASH_CONCURRENCY | no | -- | File hashing concurrency limit | non-secret |
| VIDEO_TRANSCODE_CONCURRENCY | no | -- | Transcode concurrency limit | non-secret |
| VIDEO_TRANSCODE_TIMEOUT_MS | no | -- | Transcode timeout (ms) | non-secret |
| VIDEO_MAX_WIDTH | no | -- | Max video width for normalization | non-secret |
| VIDEO_MAX_HEIGHT | no | -- | Max video height for normalization | non-secret |
| VIDEO_MAX_FPS | no | -- | Max FPS for normalization | non-secret |
| UPLOAD_STORAGE | no | local | Upload storage provider (`local` or `s3`) | non-secret |
| S3_BUCKET | no | -- | S3 bucket name | non-secret |
| S3_ACCESS_KEY_ID | no | -- | S3 access key id | secret |
| S3_SECRET_ACCESS_KEY | no | -- | S3 secret access key | secret |
| S3_PUBLIC_BASE_URL | no | -- | Public base URL for uploaded files | non-secret |
| S3_ENDPOINT | no | -- | S3-compatible endpoint (R2/MinIO) | non-secret |
| S3_REGION | no | auto | S3 region | non-secret |
| S3_KEY_PREFIX | no | -- | S3 key prefix for uploads | non-secret |
| S3_FORCE_PATH_STYLE | no | -- | Force path-style S3 URLs | non-secret |
| REDIS_URL | no | -- | Redis connection URL | non-secret |
| RATE_LIMIT_REDIS | no | -- | Enable Redis-backed rate limiting | non-secret |
| BULLMQ_PREFIX | no | -- | BullMQ key prefix override (defaults to `memalerts:<namespace>`) | non-secret |
| AI_BULLMQ_ENABLED | no | -- | Enable BullMQ AI moderation worker | non-secret |
| AI_BULLMQ_CONCURRENCY | no | 2 | AI moderation worker concurrency | non-secret |
| CHAT_OUTBOX_BULLMQ_ENABLED | no | -- | Enable BullMQ chat outbox workers | non-secret |
| CHAT_OUTBOX_MAX_ATTEMPTS | no | 5 | Chat outbox max attempts | non-secret |
| CHAT_OUTBOX_CHANNEL_LOCK_TTL_MS | no | 30000 | Chat outbox per-channel lock TTL (ms) | non-secret |
| CHAT_OUTBOX_LOCK_DELAY_MS | no | 1000 | Chat outbox lock delay when busy (ms) | non-secret |
| CHAT_OUTBOX_PROCESSING_STALE_MS | no | 60000 | Treat processing outbox rows as stale after (ms) | non-secret |
| CHAT_OUTBOX_CLEANUP_DAYS | no | 14 | Remove sent/failed outbox rows older than N days | non-secret |
| CHAT_OUTBOX_CLEANUP_BATCH | no | 500 | Max outbox rows per table per cleanup run | non-secret |
| CHAT_OUTBOX_CLEANUP_INTERVAL_MS | no | 86400000 | Cleanup interval (ms) | non-secret |
| CHAT_OUTBOX_CLEANUP_INITIAL_DELAY_MS | no | 600000 | Initial delay before first cleanup (ms) | non-secret |
| TWITCH_CHAT_OUTBOX_CONCURRENCY | no | 2 | Twitch outbox worker concurrency | non-secret |
| TWITCH_CHAT_OUTBOX_RATE_LIMIT_MAX | no | 20 | Twitch outbox rate limit max | non-secret |
| TWITCH_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS | no | 30000 | Twitch outbox rate limit window (ms) | non-secret |
| TWITCH_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_MAX | no | 10 | Twitch per-channel outbox rate limit max | non-secret |
| TWITCH_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_WINDOW_MS | no | 20000 | Twitch per-channel outbox rate limit window (ms) | non-secret |
| TWITCH_CHAT_OUTBOX_DEDUP_WINDOW_MS | no | 30000 | Twitch outbox dedup window (ms) | non-secret |
| YOUTUBE_CHAT_OUTBOX_CONCURRENCY | no | 2 | YouTube outbox worker concurrency | non-secret |
| YOUTUBE_CHAT_OUTBOX_RATE_LIMIT_MAX | no | 10 | YouTube outbox rate limit max | non-secret |
| YOUTUBE_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS | no | 30000 | YouTube outbox rate limit window (ms) | non-secret |
| YOUTUBE_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_MAX | no | 10 | YouTube per-channel outbox rate limit max | non-secret |
| YOUTUBE_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_WINDOW_MS | no | 20000 | YouTube per-channel outbox rate limit window (ms) | non-secret |
| YOUTUBE_CHAT_OUTBOX_DEDUP_WINDOW_MS | no | 30000 | YouTube outbox dedup window (ms) | non-secret |
| VKVIDEO_CHAT_OUTBOX_CONCURRENCY | no | 2 | VKVideo outbox worker concurrency | non-secret |
| VKVIDEO_CHAT_OUTBOX_RATE_LIMIT_MAX | no | 20 | VKVideo outbox rate limit max | non-secret |
| VKVIDEO_CHAT_OUTBOX_RATE_LIMIT_WINDOW_MS | no | 30000 | VKVideo outbox rate limit window (ms) | non-secret |
| VKVIDEO_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_MAX | no | 10 | VKVideo per-channel outbox rate limit max | non-secret |
| VKVIDEO_CHAT_OUTBOX_CHANNEL_RATE_LIMIT_WINDOW_MS | no | 20000 | VKVideo per-channel outbox rate limit window (ms) | non-secret |
| VKVIDEO_CHAT_OUTBOX_DEDUP_WINDOW_MS | no | 30000 | VKVideo outbox dedup window (ms) | non-secret |
| AI_MODERATION_STUCK_MS | no | 900000 | Stuck job timeout (ms) | non-secret |
| AI_MAX_RETRIES | no | 5 | AI retry count | non-secret |
| AI_MODERATION_MEDIUM_THRESHOLD | no | 0.4 | Medium threshold | non-secret |
| AI_MODERATION_HIGH_THRESHOLD | no | 0.7 | High threshold | non-secret |
| AI_QUARANTINE_DAYS | no | 14 | Quarantine duration (days) | non-secret |
| AI_LOW_AUTOPROVE_ENABLED | no | -- | Auto-approve low risk submissions | non-secret |
| TAG_AI_VALIDATION_ENABLED | no | true | Enable AI tag auto-validation | non-secret |
| TAG_AI_VALIDATION_MODEL | no | gpt-4o-mini | OpenAI model for tag validation | non-secret |
| AI_PENDING_FILE_RETENTION_HOURS | no | 72 | Retain pending files (hours) | non-secret |
| AI_PENDING_FILE_CLEANUP_INTERVAL_MS | no | 21600000 | Cleanup interval (ms) | non-secret |
| AI_PENDING_FILE_CLEANUP_BATCH | no | 200 | Cleanup batch size | non-secret |
| QUALITY_SCORE_ENABLED | no | true | Enable meme asset quality score scheduler | non-secret |
| QUALITY_SCORE_WINDOW_DAYS | no | 30 | Quality score lookback window (days) | non-secret |
| QUALITY_SCORE_RECENCY_DAYS | no | 20 | Quality score recency window (days) | non-secret |
| QUALITY_SCORE_ENGAGEMENT_MULTIPLIER | no | 2 | Quality score engagement multiplier | non-secret |
| QUALITY_SCORE_MAX_SCORE | no | 100 | Quality score max score | non-secret |
| QUALITY_SCORE_INTERVAL_MS | no | 86400000 | Quality score recompute interval (ms) | non-secret |
| QUALITY_SCORE_INITIAL_DELAY_MS | no | 60000 | Quality score initial delay (ms) | non-secret |
| AI_METADATA_ENABLED | no | -- | Enable AI metadata generation | non-secret |
| AI_VISION_ENABLED | no | -- | Enable AI vision frames | non-secret |
| AI_VISION_MAX_FRAMES | no | 8 | Max vision frames | non-secret |
| AI_VISION_STEP_SECONDS | no | 2 | Vision frame step (seconds) | non-secret |
| OPENAI_API_KEY | no | -- | OpenAI API key | secret |
| OPENAI_HTTP_TIMEOUT_MS | no | 60000 | OpenAI HTTP timeout (ms) | non-secret |
| AI_FFMPEG_TIMEOUT_MS | no | 90000 | FFmpeg timeout (ms) | non-secret |
| AI_PER_SUBMISSION_TIMEOUT_MS | no | 300000 | Per-submission timeout (ms) | non-secret |
| AI_LOCK_TTL_MS | no | 480000 | AI lock TTL (ms) | non-secret |
| AI_FILEHASH_TIMEOUT_MS | no | 120000 | AI file hash timeout (ms) | non-secret |
| OPENAI_ASR_MODEL | no | -- | OpenAI ASR model override | non-secret |
| OPENAI_MODERATION_MODEL | no | -- | OpenAI moderation model override | non-secret |
| CHAT_BOT_ENABLED | no | -- | Enable Twitch chat bot | non-secret |
| CHAT_BOT_LOGIN | no | lotas_bot | Twitch bot login | non-secret |
| CHAT_BOT_USER_ID | no | -- | Internal user id for bot | non-secret |
| CHAT_BOT_TWITCH_USER_ID | no | -- | Twitch user id for bot | non-secret |
| CHAT_BOT_CHANNELS | no | -- | Twitch channel mapping (simple format) | non-secret |
| CHAT_BOT_CHANNEL_MAP_JSON | no | -- | Twitch channel mapping (JSON) | non-secret |
| CHATBOT_BACKEND_BASE_URL | no | -- | Internal relay base URL for chatbot runners | non-secret |
| CHATBOT_BACKEND_BASE_URLS | no | -- | Internal relay base URLs for chatbot runners (comma-separated) | non-secret |
| CHATBOT_SYNC_SECONDS | no | 30 | Sync interval for chatbot runners | non-secret |
| CHATBOT_OUTBOX_POLL_MS | no | 1000 | Twitch outbox polling interval (ms) | non-secret |
| YOUTUBE_CHATBOT_SYNC_SECONDS | no | 20 | YouTube chatbot sync interval | non-secret |
| YOUTUBE_CHATBOT_LIVE_CHECK_SECONDS | no | 20 | YouTube live check interval | non-secret |
| YOUTUBE_CHATBOT_OUTBOX_POLL_MS | no | 1000 | YouTube outbox polling interval (ms) | non-secret |
| VKVIDEO_CHAT_BOT_ENABLED | no | -- | Enable VKVideo chatbot | non-secret |
| VKVIDEO_API_BASE_URL | no | -- | VKVideo API base URL | non-secret |
| VKVIDEO_PUBSUB_WS_URL | no | -- | VKVideo PubSub websocket URL | non-secret |
| VKVIDEO_CHATBOT_SYNC_SECONDS | no | 30 | VKVideo chatbot sync interval | non-secret |
| VKVIDEO_CHATBOT_OUTBOX_POLL_MS | no | 1000 | VKVideo outbox polling interval (ms) | non-secret |
| VKVIDEO_PUBSUB_REFRESH_SECONDS | no | 600 | VKVideo PubSub refresh interval (s) | non-secret |
| CHANNEL_DAILY_STATS_ROLLUP_DAYS | no | 45 | Channel daily rollup window (days) | non-secret |
| CHANNEL_DAILY_STATS_ROLLUP_INTERVAL_MS | no | 3600000 | Channel daily rollup interval (ms) | non-secret |
| CHANNEL_DAILY_STATS_ROLLUP_INITIAL_DELAY_MS | no | 60000 | Channel daily rollup initial delay (ms) | non-secret |
| TOP_STATS_30D_ROLLUP_DAYS | no | 30 | Top stats rollup window (days) | non-secret |
| TOP_STATS_30D_ROLLUP_INTERVAL_MS | no | 7200000 | Top stats rollup interval (ms) | non-secret |
| TOP_STATS_30D_ROLLUP_INITIAL_DELAY_MS | no | 90000 | Top stats rollup initial delay (ms) | non-secret |
| MEME_DAILY_STATS_ROLLUP_DAYS | no | 45 | Meme daily rollup window (days) | non-secret |
| MEME_DAILY_STATS_ROLLUP_INTERVAL_MS | no | 3600000 | Meme daily rollup interval (ms) | non-secret |
| MEME_DAILY_STATS_ROLLUP_INITIAL_DELAY_MS | no | 75000 | Meme daily rollup initial delay (ms) | non-secret |
| COOCCURRENCE_RECALC_ENABLED | no | true | Enable co-occurrence matrix recalculation | non-secret |
| COOCCURRENCE_RECALC_INTERVAL_MS | no | 3600000 | Co-occurrence recalculation interval (ms) | non-secret |
| COOCCURRENCE_RECALC_INITIAL_DELAY_MS | no | 60000 | Co-occurrence recalculation initial delay (ms) | non-secret |
| DB_SLOW_MS | no | 500 | Slow DB query logging threshold (ms) | non-secret |
| LOG_LEVEL | no | -- | Log verbosity (`debug`, etc) | non-secret |
| LOG_DESTINATION | no | -- | Log file destination (optional) | non-secret |
| LOG_TRANSPORT_TARGET | no | -- | Pino transport target (shipping) | non-secret |
| LOG_TRANSPORT_OPTIONS | no | -- | JSON options for log transport | non-secret |
| LOG_TRANSPORT_LEVEL | no | -- | Override log transport level | non-secret |
| OTEL_ENABLED | no | -- | Enable OpenTelemetry tracing | non-secret |
| OTEL_DIAG_LOGS | no | -- | Enable OpenTelemetry diagnostics logs | non-secret |
| OTEL_SUCCESS_SAMPLE_RATE | no | 0.1 | Sample rate for successful traces | non-secret |
| OTEL_TRACE_MAX_MS | no | 300000 | Max buffered trace duration (ms) | non-secret |
| OTEL_TRACE_DECISION_TTL_MS | no | 300000 | TTL for trace sampling decisions (ms) | non-secret |
| OTEL_EXPORTER_JAEGER_ENDPOINT | no | -- | Jaeger collector endpoint | non-secret |
| OTEL_EXPORTER_JAEGER_AGENT_HOST | no | -- | Jaeger agent host | non-secret |
| OTEL_EXPORTER_JAEGER_AGENT_PORT | no | -- | Jaeger agent port | non-secret |
| JAEGER_ENDPOINT | no | -- | Jaeger collector endpoint (alias) | non-secret |
| JAEGER_AGENT_HOST | no | -- | Jaeger agent host (alias) | non-secret |
| JAEGER_AGENT_PORT | no | -- | Jaeger agent port (alias) | non-secret |
| SENTRY_DSN | no | -- | Sentry DSN | secret |
| SENTRY_RELEASE | no | -- | Sentry release identifier | non-secret |
| HTTP_COMPRESSION | no | -- | Enable HTTP compression | non-secret |
| SEARCH_PAGE_MAX | no | 50 | Search page size limit | non-secret |
| SEARCH_CACHE_MS | no | 30000 | Search cache TTL (ms) | non-secret |
| MEME_STATS_CACHE_MS | no | 30000 | Meme stats cache TTL (ms) | non-secret |
| PROMO_CACHE_MS | no | 5000 | Promo cache TTL (ms) | non-secret |
| TWITCH_HTTP_TIMEOUT_MS | no | 10000 | Twitch HTTP timeout (ms) | non-secret |
| YOUTUBE_HTTP_TIMEOUT_MS | no | 10000 | YouTube HTTP timeout (ms) | non-secret |
| TWITCH_CIRCUIT_FAILURE_THRESHOLD | no | 5 | Twitch circuit breaker failure threshold | non-secret |
| TWITCH_CIRCUIT_RESET_TIMEOUT_MS | no | 30000 | Twitch circuit breaker reset timeout (ms) | non-secret |
| TWITCH_CIRCUIT_SUCCESS_THRESHOLD | no | 1 | Twitch circuit breaker success threshold | non-secret |
| TWITCH_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT | no | 1 | Twitch circuit breaker half-open max in-flight | non-secret |
| YOUTUBE_CIRCUIT_FAILURE_THRESHOLD | no | 4 | YouTube circuit breaker failure threshold | non-secret |
| YOUTUBE_CIRCUIT_RESET_TIMEOUT_MS | no | 30000 | YouTube circuit breaker reset timeout (ms) | non-secret |
| YOUTUBE_CIRCUIT_SUCCESS_THRESHOLD | no | 1 | YouTube circuit breaker success threshold | non-secret |
| YOUTUBE_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT | no | 1 | YouTube circuit breaker half-open max in-flight | non-secret |
| OPENAI_CIRCUIT_FAILURE_THRESHOLD | no | 3 | OpenAI circuit breaker failure threshold | non-secret |
| OPENAI_CIRCUIT_RESET_TIMEOUT_MS | no | 30000 | OpenAI circuit breaker reset timeout (ms) | non-secret |
| OPENAI_CIRCUIT_SUCCESS_THRESHOLD | no | 1 | OpenAI circuit breaker success threshold | non-secret |
| OPENAI_CIRCUIT_HALF_OPEN_MAX_IN_FLIGHT | no | 1 | OpenAI circuit breaker half-open max in-flight | non-secret |
