# AI Meme Analysis (Current State)

This document describes the **current** implementation of AI-based meme analysis in the MemAlerts backend: receiving signals from **video/audio**, generating **title/description/tags**, saving results to the database, deduplication by **SHA‑256 (`fileHash`)**, use in search, and access restrictions.

## Where the code is (quick links)

- **Main pipeline**: `src/jobs/aiModerationSubmissions.ts`
  - `processOneSubmission(submissionId)` — processes a single submission
  - `startAiModerationScheduler()` — scheduler (inside the API process)
- **ASR (speech‑to‑text)**: `src/utils/ai/openaiAsr.ts`
- **Text moderation**: `src/utils/ai/openaiTextModeration.ts`
- **Vision frames extraction**: `src/utils/ai/extractFrames.ts`
- **Audio extraction**: `src/utils/ai/extractAudio.ts`
- **Metadata generation (title/tags/description)**: `src/utils/ai/openaiMemeMetadata.ts`
- **Fallback tagging**: `src/utils/ai/tagging.ts`
- **Fallback description**: `src/utils/ai/description.ts`
- **OpenAI HTTP client**: `src/utils/ai/openaiClient.ts`
- **Manual run**: `scripts/run-ai-analysis.ts`
- **Backfill AI for ChannelMeme**: `scripts/backfill-channelmeme-ai.ts`

## Terms (how it’s designed)

- **`MemeSubmission`** — a “request” to add a meme (upload/url/pool). AI pipeline runs based on submissions.
- **`MemeAsset`** — a global “unique asset” (pool). A key point: AI metadata is stored **globally at the `MemeAsset` level**, so results can be reused for duplicates.
- **`ChannelMeme`** — a “meme in a channel” (channel wrapper around `MemeAsset`), the source of truth for a channel’s meme list.
- **`fileHash`** — the SHA‑256 hash of the file bytes (64 hex). Used for dedup and as a key for reusing AI results.

## Where AI analysis is triggered

There are two trigger points:

### 1) Automatically, inside the API process (scheduler)

In `src/index.ts`, on server start, `startAiModerationScheduler()` is called (see `src/jobs/aiModerationSubmissions.ts`).

- The scheduler is **off by default** and only enabled when `AI_MODERATION_ENABLED=1`.
- It uses a Postgres advisory lock (base id: `421399`) to **prevent parallel runs per instance** (to avoid races), but **does not block other instances** (important for shared DB beta+prod).
- It takes candidates from the database in batches and marks submissions as `aiStatus='processing'` atomically via `updateMany` (“claim”) to avoid races.

### 2) Manually (script)

`scripts/run-ai-analysis.ts` — a manual runner to process the submission queue. Useful for debugging/one-off runs.

## Which submissions are processed

The AI pipeline processes a `MemeSubmission` if the conditions are met:

- `status` ∈ `pending|approved`
- `sourceKind` ∈ `upload|url`  
  (pool submissions are a separate path; AI results for them are usually reused from `MemeAsset`)

The pipeline requires a stable key:

- Preferably a **`fileHash`**.
- If `fileHash` is missing:
  - it tries a “best-effort” to recover it from a path like `/uploads/memes/<sha256>.<ext>`.
  - if the file is local (`/uploads/...` exists on disk), it can **compute SHA‑256 during AI processing** (controlled by `AI_FILEHASH_TIMEOUT_MS`) to make the pipeline resilient to upload-time hashing timeouts.

## Operational notes (debugging / reliability)

- If submissions are uploaded but never reach AI processing, check logs for **`submission.ai.enqueue_failed`** — it means the backend failed to create the `MemeSubmission` row that drives the AI queue (often schema/migration mismatch).

## Most important: deduplication and reuse of AI results

### Dedup by `fileHash` (globally)

Before running “heavy” analysis, the pipeline checks:

- whether there already exists a `MemeAsset` with the same `fileHash` and `aiStatus='done'`.

If yes — AI **does not run again**. Instead:

- The `MemeSubmission` is immediately marked `aiStatus='done'` and the fields `aiAutoDescription/aiAutoTagNamesJson` are copied (and auxiliary `aiModelVersionsJson` with `pipelineVersion='v3-reuse-memeasset'`).
- The `ChannelMeme` for that `channelId+memeAssetId` gets a copy of the `aiAuto*` + `searchText` (so channel search takes AI into account).
- `ChannelMeme.title` can be replaced with the AI title **only if the user hasn’t edited the title** (the condition is “the title is still equal to the original submission.title”).

### Fast reuse at submission creation stage

In `src/controllers/submission/createSubmission.ts` there is an optimization: if the upload is a duplicate (`fileHash`) and `MemeAsset` already has AI (`aiStatus='done'`), the created `MemeSubmission` immediately gets `aiStatus='done'` and a copy of AI fields, without waiting for the scheduler.

## Analysis pipeline: what exactly happens

The main function: `processOneSubmission(submissionId)` in `src/jobs/aiModerationSubmissions.ts`.

### Step 0. Getting the file (local path vs public URL)

The pipeline attempts to get `inputPath`:

- If `fileUrlTemp` starts with `/uploads/…` — it calculates the local path within `UPLOAD_DIR` and validates it (protection against path traversal).
- If the file is at a public link (e.g. S3) — it downloads it to a temporary folder (with a domain/base URL restriction + byte limit).

A public URL is allowed only if:

- it is `/uploads/*` **or**
- it starts with `S3_PUBLIC_BASE_URL`.

### Step 1. Extracting audio (ffmpeg)

`extractAudioToMp3()` (`src/utils/ai/extractAudio.ts`):

- ffmpeg: `noVideo`, mp3, mono, 16kHz, ~64k bitrate
- optionally **loudnorm**, if `AI_AUDIO_LOUDNORM=1` is enabled
- timeout: `AI_FFMPEG_TIMEOUT_MS` (default 90s)

If a video **has no audio track**, this is considered a normal scenario: ASR is skipped, the pipeline continues with fallback signals.

### Step 2. ASR (speech‑to‑text) via OpenAI

`transcribeAudioOpenAI()` (`src/utils/ai/openaiAsr.ts`):

- `POST /v1/audio/transcriptions`
- model: `OPENAI_ASR_MODEL` (default `gpt-4o-mini-transcribe`)
- language: `OPENAI_ASR_LANGUAGE`, or auto‑selection (if `submission.title` contains Cyrillic → `ru`)

Result: `transcript` (string).

### Step 3. Text moderation of transcript via OpenAI

`moderateTextOpenAI()` (`src/utils/ai/openaiTextModeration.ts`):

- `POST /v1/moderations`
- model: `OPENAI_MODERATION_MODEL` (default `omni-moderation-latest`)

Output:

- `labels`: an array of strings like `text:<category>`
- `riskScore`: a number 0..1 (max of `category_scores`, or ≥0.9 if flagged)

### Step 4. Vision + metadata generation (title/tags/description)

This part is controlled by flags:

- `AI_METADATA_ENABLED` (enabled by default)
- `AI_VISION_ENABLED` (enabled by default)

If vision is enabled:

- `extractFramesJpeg()` (`src/utils/ai/extractFrames.ts`) retrieves frames (jpeg):
  - `AI_VISION_MAX_FRAMES` (1..12, default 8)
  - `AI_VISION_STEP_SECONDS` (1..10, default 2)
  - width 512px

Then `generateMemeMetadataOpenAI()` (`src/utils/ai/openaiMemeMetadata.ts`):

- `POST /v1/chat/completions`
- model: `OPENAI_MEME_METADATA_MODEL` (default `gpt-4o-mini`)
- `response_format: json_object` — strictly expects JSON `{title, tags, description}`
- the prompt includes:
  - `titleHint` (original submission title)
  - `labels` from text moderation
  - `transcript` (truncated by length)
  - (optionally) frames as `image_url` with `data:image/jpeg;base64,…`

Sanitization of the result:

- `title`: short (≈3–4 words), trimmed to 80 characters, placeholder titles (“Meme”, “Untitled”…​) are discarded
- `tags`: normalized, allowing Latin/Cyrillic/numbers/`_`/`-`, length 2..24, spaces → `_`, limited by `AI_TAG_LIMIT`
- `description`: trimmed to 1500 (in `MemeAsset`) / 2000 (in `MemeSubmission` / `ChannelMeme`)

### Step 5. Fallback tags (without OpenAI metadata)

If `AI_METADATA_ENABLED=0` or OpenAI returns empty tags — a local `generateTagNames()` (`src/utils/ai/tagging.ts`) is used:

- it takes tokens from `title + transcript`
- adds cleaned `labels` from moderation
- if the `transcript` is too short → `lowConfidence` and tags are limited to 3

### Step 6. Decision low/medium/high

Threshold values:

- `AI_MODERATION_MEDIUM_THRESHOLD` (default 0.4)
- `AI_MODERATION_HIGH_THRESHOLD` (default 0.7)

`decision = high|medium|low` is calculated based on `riskScore`.

### Step 7. Special fallback when OpenAI is unavailable

If OpenAI is unavailable (e.g. `unsupported_country_region_territory` / 403) — the pipeline:

- **does not retry endlessly**
- falls back to the deterministic heuristic `computeKeywordHeuristic(title, notes)`
- marks the result as done, so the queue does not “hang”

## What gets saved and where in the database

Schema: `prisma/schema.prisma`.

### 1) `MemeSubmission` — results “per analysis attempt”

Stores:

- `aiStatus`: `pending|processing|done|failed|failed_final`
- `aiDecision`: `low|medium|high`
- `aiRiskScore`: float
- `aiLabelsJson`: JSON array of strings (e.g. `text:*`, `kw:*`, `low_confidence`)
- `aiTranscript`: `VarChar(50000)`
- `aiAutoTagNamesJson`: Json
- `aiAutoDescription`: `VarChar(2000)`
- `aiModelVersionsJson`: Json (including vision parameters, models, download limits, etc.)
- retry/backoff fields: `aiRetryCount`, `aiLastTriedAt`, `aiNextRetryAt`, `aiError`

Important:

- AI title is **not stored** in `MemeSubmission`; it lives at the `MemeAsset` level (`aiAutoTitle`).

### 2) `MemeAsset` — global AI metadata (dedup by `fileHash`)

Stores:

- `aiStatus`: `pending|done`
- `aiAutoTitle`: `VarChar(200)`
- `aiAutoTagNamesJson`: Json
- `aiAutoDescription`: `VarChar(2000)`
- `aiSearchText`: `VarChar(4000)` — text for search (title + tags + description)
- `aiCompletedAt`

### 3) `ChannelMeme` — channel copy + “hidden” search

Stores:

- `aiAutoTagNamesJson`, `aiAutoDescription` — **hidden** fields (returned only when `includeAi=1` and with permissions)
- `searchText` — hidden text for channel search (includes AI description/tags)

## How `aiSearchText` / `searchText` is formed (for search)

The composition is unified: **title + tags + description**, joined by newline and trimmed to 4000.

- In `aiModerationSubmissions.ts` this is assembled from:
  - `aiTitle` (if present, otherwise `submission.title`)
  - `autoTags.join(' ')`
  - `autoDescription`
- In `approveSubmissionInternal.ts` the assembly is similar, but additionally merges “AI tags” and “real tags applied upon approve”.

## Where AI is used in output and search

### Viewer/search (authenticated /channels/memes/search)

`src/controllers/viewer/search.ts`:

- In the “search by channel” mode (not pool_all) the query searches by:
  - `ChannelMeme.title`
  - **`ChannelMeme.searchText`** (hidden field, where AI goes)

### Public search (/public/channels/:slug/memes/search)

`src/controllers/public/channelPublicController.ts`:

- public search **does not return AI fields**, but uses `ChannelMeme.searchText` for matches (so AI helps find a meme without exposing internal text).
- In `pool_all` mode, public search goes through `MemeAsset.aiAutoTitle` and `MemeAsset.aiSearchText`.

## Access to AI fields (who can see)

The gate to output AI fields in lists of memes: `src/controllers/viewer/channelMemeListDto.ts`.

Rules:

- require query parameter `includeAi=1` (or `true/yes/on`)
- the user must be authorized
- `admin` always sees
- `streamer` sees only for their own channel (scoped `req.channelId`)

Similarly, there is a flag `includeFileHash=1` to output `fileHash` (also only admin/owner).

## Quarantine/hiding from pool and auto‑approve (optional)

### Quarantine (medium/high)

If the decision is `medium` or `high`, the pipeline “as early as possible” creates/updates the `MemeAsset` in state:

- `poolVisibility='hidden'`
- if `high` additionally:
  - `purgeRequestedAt`
  - `purgeNotBefore = now + AI_QUARANTINE_DAYS`

Purpose: **to prevent a “visible window”** where a potentially problematic asset appears in the pool.

### Auto‑approve (low)

If `AI_LOW_AUTOPROVE_ENABLED=1`:

- auto‑approve is done only for `decision='low'`
- only if the submitter is a `viewer`
- with an extra safeguard: do not auto‑approve if an asset with this `fileHash` is already in purge/quarantine or hidden manually

## Retry/backoff and stuck processing

The scheduler supports:

- `stuck` detection (if `aiStatus='processing'` and `aiLastTriedAt` is older than `AI_MODERATION_STUCK_MS`)
- retry/backoff:
  - limit `AI_MAX_RETRIES`
  - exponential backoff (up to 1 hour)
- protection from a “permanent” submission: `AI_PER_SUBMISSION_TIMEOUT_MS` — timeout for processing a single submission

## Temporary directories and cleanup

To process a submission, a `tmpDir` is created like:

- `uploads/temp/ai-<submissionId>`

The directory is removed with `rm -r` in `finally` (best‑effort).

## Settings (ENV) — what really affects behavior

### Enable/frequency

- `AI_MODERATION_ENABLED=1` — enable scheduler
- `AI_MODERATION_INTERVAL_MS` (default 30000)
- `AI_MODERATION_INITIAL_DELAY_MS` (default 15000)
- `AI_MODERATION_BATCH` (default 25)
- `AI_MODERATION_STUCK_MS` (default 600000)
- `AI_MAX_RETRIES` (default 5)
- `AI_PER_SUBMISSION_TIMEOUT_MS` (default 300000)
- `AI_FILEHASH_TIMEOUT_MS` (default 120000) — when `fileHash` is missing but the file exists locally, AI can compute SHA‑256 during processing (bounded by this timeout)

### OpenAI / HTTP

- `OPENAI_API_KEY` — required for the “real” pipeline (otherwise only heuristics)
- `OPENAI_BASE_URL` / `OPENAI_API_BASE_URL` — override base URL (e.g. gateway)
- `OPENAI_HTTP_TIMEOUT_MS` (default 60000)

### Models

- `OPENAI_ASR_MODEL` (default `gpt-4o-mini-transcribe`)
- `OPENAI_ASR_LANGUAGE` (optional)
- `OPENAI_MODERATION_MODEL` (default `omni-moderation-latest`)
- `OPENAI_MEME_METADATA_MODEL` (default `gpt-4o-mini`)

### Vision / metadata

- `AI_METADATA_ENABLED` (default `1`)
- `AI_VISION_ENABLED` (default `1`)
- `AI_VISION_MAX_FRAMES` (default `8`, 1..12)
- `AI_VISION_STEP_SECONDS` (default `2`, 1..10)
- `AI_TAG_LIMIT` (default `5`, 1..20)

### Audio/ffmpeg

- `AI_FFMPEG_TIMEOUT_MS` (default 90000)
- `AI_AUDIO_LOUDNORM=1` (enable)
- `AI_AUDIO_LOUDNORM_I`, `AI_AUDIO_LOUDNORM_LRA`, `AI_AUDIO_LOUDNORM_TP` — loudnorm parameters

### Threshold values/policies

- `AI_MODERATION_MEDIUM_THRESHOLD` (default 0.4)
- `AI_MODERATION_HIGH_THRESHOLD` (default 0.7)
- `AI_QUARANTINE_DAYS` (default 14)
- `AI_LOW_AUTOPROVE_ENABLED` (disabled by default)

### File access

- `UPLOAD_DIR` (default `./uploads`)
- `S3_PUBLIC_BASE_URL` — to allow file analysis via public URL
- `AI_DOWNLOAD_MAX_BYTES` (default 60000000)

## Backfill: how to run AI for old memes

`scripts/backfill-channelmeme-ai.ts`:

- finds `ChannelMeme` in a channel without AI fields
- if a `MemeAsset` already contains AI (`aiStatus='done'`) — copies to `ChannelMeme`
- otherwise creates a `MemeSubmission` (linked to `memeAssetId`) and runs through `processOneSubmission()`
- can “pull” the file/recover `fileHash` for a trusted domain (conservative allow-list)

## Diagnostics / common reasons “AI doesn’t work”

- **`OPENAI_API_KEY` not set** → OpenAI pipeline doesn’t start (you’ll see log `ai_moderation.openai.disabled`)
- **ffmpeg/ffprobe unavailable** → audio/frames not extracted (see `src/utils/media/configureFfmpeg.ts`)
- **region-block OpenAI** → pipeline falls back to heuristic and marks submission as done (with `ai:openai_unavailable`)
- **no audio stream** → transcript is empty, fallback by title/notes + tags heuristics/metadata without transcript
