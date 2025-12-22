-- Add compound indexes to speed up popularity/favorites queries on MemeActivation
-- Created: 2025-12-22

-- Popularity: filter by channelId + status + createdAt (range), group by memeId
CREATE INDEX IF NOT EXISTS "MemeActivation_channelId_status_createdAt_memeId_idx"
ON "MemeActivation" ("channelId", "status", "createdAt", "memeId");

-- Favorites: filter by channelId + userId + status, group by memeId
CREATE INDEX IF NOT EXISTS "MemeActivation_channelId_userId_status_memeId_idx"
ON "MemeActivation" ("channelId", "userId", "status", "memeId");


