-- Add new ExternalAccountProvider enum values (additive, safe for shared DB).
-- NOTE: PostgreSQL enums cannot remove/rename values easily; we keep legacy `vkplay`.

ALTER TYPE "ExternalAccountProvider" ADD VALUE IF NOT EXISTS 'vk';
ALTER TYPE "ExternalAccountProvider" ADD VALUE IF NOT EXISTS 'kick';


