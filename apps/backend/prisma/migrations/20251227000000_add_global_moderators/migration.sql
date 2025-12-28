-- Add GlobalModerator permission table (expand-only).
-- This does NOT change User.role; it is used for shared meme pool moderation access.

CREATE TABLE IF NOT EXISTS "GlobalModerator" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "grantedByUserId" TEXT,
  "revokedAt" TIMESTAMP(3),
  "revokedByUserId" TEXT,
  CONSTRAINT "GlobalModerator_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "GlobalModerator_userId_key" ON "GlobalModerator"("userId");
CREATE INDEX IF NOT EXISTS "GlobalModerator_grantedAt_idx" ON "GlobalModerator"("grantedAt");
CREATE INDEX IF NOT EXISTS "GlobalModerator_revokedAt_idx" ON "GlobalModerator"("revokedAt");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GlobalModerator_userId_fkey'
  ) THEN
    ALTER TABLE "GlobalModerator"
      ADD CONSTRAINT "GlobalModerator_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GlobalModerator_grantedByUserId_fkey'
  ) THEN
    ALTER TABLE "GlobalModerator"
      ADD CONSTRAINT "GlobalModerator_grantedByUserId_fkey"
      FOREIGN KEY ("grantedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'GlobalModerator_revokedByUserId_fkey'
  ) THEN
    ALTER TABLE "GlobalModerator"
      ADD CONSTRAINT "GlobalModerator_revokedByUserId_fkey"
      FOREIGN KEY ("revokedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;


