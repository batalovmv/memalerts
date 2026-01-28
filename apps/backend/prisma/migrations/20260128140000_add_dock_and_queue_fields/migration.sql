-- AlterTable
ALTER TABLE "Channel" ADD COLUMN     "dockTokenHash" TEXT,
ADD COLUMN     "dockTokenVersion" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "activationsEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "overlayPlaybackPaused" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "queueRevision" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "currentActivationId" TEXT;

-- AlterTable
ALTER TABLE "MemeActivation" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endedReason" TEXT,
ADD COLUMN     "endedById" TEXT,
ADD COLUMN     "endedByRole" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "Channel_dockTokenHash_key" ON "Channel"("dockTokenHash");

-- CreateIndex
CREATE INDEX "MemeActivation_channelId_status_createdAt_idx" ON "MemeActivation"("channelId", "status", "createdAt");
