-- Auto-approve flag for viewer submissions (expand-only).
ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "autoApproveEnabled" BOOLEAN NOT NULL DEFAULT false;
