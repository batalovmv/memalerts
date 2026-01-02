-- Add hidden AI fields to ChannelMeme for search + admin QA.
-- NOTE: These fields are intentionally NOT exposed in public DTOs.

ALTER TABLE "ChannelMeme"
ADD COLUMN "aiAutoTagNamesJson" JSONB;

ALTER TABLE "ChannelMeme"
ADD COLUMN "aiAutoDescription" VARCHAR(2000);


