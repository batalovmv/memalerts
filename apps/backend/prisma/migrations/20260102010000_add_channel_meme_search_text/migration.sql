-- Add hidden search-only text to ChannelMeme to include AI-generated description in search.
-- This field is intentionally NOT exposed to end-users by DTOs.

ALTER TABLE "ChannelMeme"
ADD COLUMN "searchText" VARCHAR(4000);


