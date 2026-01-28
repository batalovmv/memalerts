-- AlterTable
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "hasBetaAccess" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "BetaAccess" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BetaAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BetaAccess_userId_idx" ON "BetaAccess"("userId");

-- CreateIndex
CREATE INDEX "BetaAccess_status_idx" ON "BetaAccess"("status");

-- CreateIndex
CREATE INDEX "BetaAccess_requestedAt_idx" ON "BetaAccess"("requestedAt");

-- CreateIndex
CREATE INDEX "User_hasBetaAccess_idx" ON "User"("hasBetaAccess");

-- AddForeignKey
ALTER TABLE "BetaAccess" ADD CONSTRAINT "BetaAccess_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateUniqueIndex
CREATE UNIQUE INDEX "BetaAccess_userId_key" ON "BetaAccess"("userId");


