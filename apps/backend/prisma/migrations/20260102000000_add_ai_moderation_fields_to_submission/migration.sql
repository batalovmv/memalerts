-- AI moderation fields for MemeSubmission (expand-only, safe for shared DB).
-- Use IF NOT EXISTS to be resilient across environments.

ALTER TABLE "MemeSubmission"
  -- Upload metadata (best-effort; required for AI and better moderation UX).
  ADD COLUMN IF NOT EXISTS "fileHash" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "durationMs" INTEGER,
  ADD COLUMN IF NOT EXISTS "mimeType" VARCHAR(64),
  ADD COLUMN IF NOT EXISTS "fileSizeBytes" INTEGER,

  -- AI moderation pipeline state (best-effort; safe defaults for backfill).
  ADD COLUMN IF NOT EXISTS "aiStatus" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS "aiDecision" VARCHAR(16),
  ADD COLUMN IF NOT EXISTS "aiRiskScore" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "aiLabelsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "aiTranscript" VARCHAR(50000),
  ADD COLUMN IF NOT EXISTS "aiAutoTagNamesJson" JSONB,
  ADD COLUMN IF NOT EXISTS "aiAutoDescription" VARCHAR(2000),
  ADD COLUMN IF NOT EXISTS "aiModelVersionsJson" JSONB,
  ADD COLUMN IF NOT EXISTS "aiCompletedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "aiRetryCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "aiLastTriedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "aiNextRetryAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "aiError" TEXT;

CREATE INDEX IF NOT EXISTS "MemeSubmission_fileHash_idx"
  ON "MemeSubmission" ("fileHash");

CREATE INDEX IF NOT EXISTS "MemeSubmission_status_sourceKind_aiStatus_aiNextRetryAt_createdAt_idx"
  ON "MemeSubmission" ("status", "sourceKind", "aiStatus", "aiNextRetryAt", "createdAt");


