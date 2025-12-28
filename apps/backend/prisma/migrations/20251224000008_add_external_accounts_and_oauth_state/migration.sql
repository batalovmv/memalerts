-- Multi-provider identities (expand-first):
-- - Make legacy Twitch IDs optional (nullable) to allow non-Twitch identities later.
-- - Add ExternalAccount (provider identities) and OAuthState (server-side OAuth state verification).

-- 1) Make legacy Twitch IDs nullable (safe forward-compat).
ALTER TABLE "Channel"
  ALTER COLUMN "twitchChannelId" DROP NOT NULL;

ALTER TABLE "User"
  ALTER COLUMN "twitchUserId" DROP NOT NULL;

-- 2) Enums for provider + state kind (Prisma enums compile to PostgreSQL enum types)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'ExternalAccountProvider') THEN
    CREATE TYPE "ExternalAccountProvider" AS ENUM ('twitch', 'youtube', 'vkplay', 'trovo', 'boosty');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'OAuthStateKind') THEN
    CREATE TYPE "OAuthStateKind" AS ENUM ('login', 'link');
  END IF;
END $$;

-- 3) ExternalAccount table
CREATE TABLE IF NOT EXISTS "ExternalAccount" (
  "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
  "userId" TEXT NOT NULL,
  "provider" "ExternalAccountProvider" NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "displayName" TEXT,
  "login" TEXT,
  "avatarUrl" TEXT,
  "profileUrl" TEXT,
  "accessToken" TEXT,
  "refreshToken" TEXT,
  "tokenExpiresAt" TIMESTAMP(3),
  "scopes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ExternalAccount_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ExternalAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "ExternalAccount_provider_providerAccountId_key" ON "ExternalAccount"("provider", "providerAccountId");
CREATE INDEX IF NOT EXISTS "ExternalAccount_userId_idx" ON "ExternalAccount"("userId");
CREATE INDEX IF NOT EXISTS "ExternalAccount_provider_idx" ON "ExternalAccount"("provider");
CREATE INDEX IF NOT EXISTS "ExternalAccount_providerAccountId_idx" ON "ExternalAccount"("providerAccountId");

-- 4) OAuthState table
CREATE TABLE IF NOT EXISTS "OAuthState" (
  "state" TEXT NOT NULL,
  "provider" "ExternalAccountProvider" NOT NULL,
  "kind" "OAuthStateKind" NOT NULL,
  "userId" TEXT,
  "redirectTo" TEXT,
  "origin" TEXT,
  "codeVerifier" TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "OAuthState_pkey" PRIMARY KEY ("state"),
  CONSTRAINT "OAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "OAuthState_expiresAt_idx" ON "OAuthState"("expiresAt");
CREATE INDEX IF NOT EXISTS "OAuthState_provider_kind_idx" ON "OAuthState"("provider", "kind");
CREATE INDEX IF NOT EXISTS "OAuthState_userId_idx" ON "OAuthState"("userId");


