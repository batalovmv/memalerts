ALTER TABLE "MemeAsset" ADD COLUMN "aiTranscript" VARCHAR(50000);

CREATE TABLE "TagCategory" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "slug" TEXT NOT NULL UNIQUE,
  "displayName" TEXT NOT NULL,
  "sortOrder" INT NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "TagCategory_sortOrder_idx" ON "TagCategory"("sortOrder");

ALTER TABLE "Tag" ADD COLUMN "displayName" TEXT;
ALTER TABLE "Tag" ADD COLUMN "categoryId" TEXT;
ALTER TABLE "Tag" ADD COLUMN "status" VARCHAR(20) NOT NULL DEFAULT 'active';
ALTER TABLE "Tag" ADD COLUMN "usageCount" INT NOT NULL DEFAULT 0;

ALTER TABLE "Tag" ADD CONSTRAINT "Tag_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TagCategory"("id") ON DELETE SET NULL;

CREATE INDEX "Tag_categoryId_idx" ON "Tag"("categoryId");
CREATE INDEX "Tag_status_idx" ON "Tag"("status");
CREATE INDEX "Tag_usageCount_idx" ON "Tag"("usageCount");

CREATE TABLE "TagAlias" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "alias" TEXT NOT NULL UNIQUE,
  "tagId" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "TagAlias_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE
);

CREATE INDEX "TagAlias_tagId_idx" ON "TagAlias"("tagId");

CREATE TABLE "TagSuggestion" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "rawTag" TEXT NOT NULL,
  "normalizedTag" TEXT NOT NULL UNIQUE,
  "memeAssetId" TEXT,
  "count" INT NOT NULL DEFAULT 1,
  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',
  "mappedToTagId" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "reviewedAt" TIMESTAMP,
  "reviewedById" TEXT,
  CONSTRAINT "TagSuggestion_memeAssetId_fkey" FOREIGN KEY ("memeAssetId") REFERENCES "MemeAsset"("id") ON DELETE SET NULL,
  CONSTRAINT "TagSuggestion_mappedToTagId_fkey" FOREIGN KEY ("mappedToTagId") REFERENCES "Tag"("id") ON DELETE SET NULL,
  CONSTRAINT "TagSuggestion_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL
);

CREATE INDEX "TagSuggestion_status_count_idx" ON "TagSuggestion"("status", "count");

CREATE TABLE "UserTasteProfile" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "userId" TEXT NOT NULL UNIQUE,
  "tagWeightsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "categoryWeightsJson" JSONB NOT NULL DEFAULT '{}'::jsonb,
  "topTagsJson" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "totalActivations" INT NOT NULL DEFAULT 0,
  "profileVersion" INT NOT NULL DEFAULT 1,
  "lastActivationAt" TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "UserTasteProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE
);

CREATE INDEX "UserTasteProfile_userId_idx" ON "UserTasteProfile"("userId");

CREATE TABLE "UserTagActivity" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "userId" TEXT NOT NULL,
  "tagId" TEXT NOT NULL,
  "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  CONSTRAINT "UserTagActivity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE,
  CONSTRAINT "UserTagActivity_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE
);

CREATE INDEX "UserTagActivity_userId_tagId_idx" ON "UserTagActivity"("userId", "tagId");
CREATE INDEX "UserTagActivity_userId_createdAt_idx" ON "UserTagActivity"("userId", "createdAt");
