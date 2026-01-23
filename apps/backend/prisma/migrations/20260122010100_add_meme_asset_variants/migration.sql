CREATE TABLE "MemeAssetVariant" (
  "id" TEXT PRIMARY KEY DEFAULT (gen_random_uuid()::text),
  "memeAssetId" TEXT NOT NULL REFERENCES "MemeAsset"("id") ON DELETE CASCADE,

  "format" VARCHAR(10) NOT NULL,        -- preview | webm | mp4
  "codec" VARCHAR(50) NOT NULL,         -- e.g. avc1.42E01E, vp9, avc1.4d401f
  "container" VARCHAR(10) NOT NULL,     -- mp4 | webm
  "mimeType" VARCHAR(50) NOT NULL,      -- video/mp4 | video/webm

  "fileUrl" TEXT NOT NULL,
  "fileHash" VARCHAR(64),
  "fileSizeBytes" BIGINT,

  "durationMs" INT,
  "width" INT,
  "height" INT,
  "bitrate" INT,

  "status" VARCHAR(20) NOT NULL DEFAULT 'pending',  -- pending | processing | done | failed
  "priority" INT NOT NULL DEFAULT 0,                -- 0=webm, 1=mp4, 2=preview
  "errorMessage" TEXT,
  "retryCount" INT DEFAULT 0,
  "lastTriedAt" TIMESTAMP,
  "completedAt" TIMESTAMP,

  "createdAt" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX "MemeAssetVariant_memeAssetId_idx" ON "MemeAssetVariant"("memeAssetId");
CREATE INDEX "MemeAssetVariant_status_idx" ON "MemeAssetVariant"("status");
CREATE INDEX "MemeAssetVariant_format_idx" ON "MemeAssetVariant"("format");
CREATE UNIQUE INDEX "MemeAssetVariant_memeAssetId_format_key" ON "MemeAssetVariant"("memeAssetId", "format");
