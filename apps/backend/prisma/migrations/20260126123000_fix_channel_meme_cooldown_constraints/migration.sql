-- Normalize cooldownMinutes and add index for lastActivatedAt.
UPDATE "ChannelMeme"
  SET "cooldownMinutes" = 0
  WHERE "cooldownMinutes" IS NULL;

ALTER TABLE "ChannelMeme"
  ALTER COLUMN "cooldownMinutes" SET DEFAULT 0;

ALTER TABLE "ChannelMeme"
  ALTER COLUMN "cooldownMinutes" SET NOT NULL;

CREATE INDEX IF NOT EXISTS "ChannelMeme_lastActivatedAt_idx" ON "ChannelMeme" ("lastActivatedAt");
