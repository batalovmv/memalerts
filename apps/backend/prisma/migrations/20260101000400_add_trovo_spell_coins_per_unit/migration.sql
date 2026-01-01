-- Trovo spells -> coins: per-channel conversion rates (coins per 1 unit), 0 disables.
-- Safe for environments where schema might already be partially applied (prod/beta shared DB / db push).

ALTER TABLE "Channel"
  ADD COLUMN IF NOT EXISTS "trovoManaCoinsPerUnit" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "trovoElixirCoinsPerUnit" INTEGER NOT NULL DEFAULT 0;


