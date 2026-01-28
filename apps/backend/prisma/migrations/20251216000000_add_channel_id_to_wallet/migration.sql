-- Step 1: Add channelId column as nullable first
ALTER TABLE "Wallet" ADD COLUMN IF NOT EXISTS "channelId" TEXT;

-- Step 2: Update existing wallets to use user's channelId
UPDATE "Wallet" 
SET "channelId" = "User"."channelId"
FROM "User"
WHERE "Wallet"."userId" = "User"."id" AND "User"."channelId" IS NOT NULL;

-- Step 3: For wallets without channelId, we need to handle this case
-- If there are no channels, we'll need to create a default channel or delete orphaned wallets
-- For now, delete wallets that cannot be assigned to a channel (they will be recreated when needed)
DELETE FROM "Wallet"
WHERE "channelId" IS NULL;

-- Step 4: Remove old unique constraint on userId
ALTER TABLE "Wallet" DROP CONSTRAINT IF EXISTS "Wallet_userId_key";

-- Step 5: Make channelId NOT NULL (will fail if there are still NULL values)
ALTER TABLE "Wallet" ALTER COLUMN "channelId" SET NOT NULL;

-- Step 6: Add foreign key constraint
ALTER TABLE "Wallet" ADD CONSTRAINT "Wallet_channelId_fkey" FOREIGN KEY ("channelId") REFERENCES "Channel"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Step 7: Create composite unique index
CREATE UNIQUE INDEX "Wallet_userId_channelId_key" ON "Wallet"("userId", "channelId");

-- Step 8: Create index on channelId for performance
CREATE INDEX "Wallet_channelId_idx" ON "Wallet"("channelId");

