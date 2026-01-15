-- Composite indexes for cursor pagination on MemeSubmission.
-- Safe expand-only migration (shared DB compatible).

CREATE INDEX IF NOT EXISTS "MemeSubmission_channelId_status_createdAt_desc_idx"
  ON "MemeSubmission" ("channelId", "status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "MemeSubmission_submitterUserId_status_createdAt_desc_idx"
  ON "MemeSubmission" ("submitterUserId", "status", "createdAt" DESC);

CREATE INDEX IF NOT EXISTS "MemeSubmission_submitterUserId_createdAt_desc_idx"
  ON "MemeSubmission" ("submitterUserId", "createdAt" DESC);










