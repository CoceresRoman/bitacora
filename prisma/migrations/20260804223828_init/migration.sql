-- CreateTable
CREATE TABLE "Signal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "refs" TEXT NOT NULL DEFAULT '[]',
    "hash" TEXT NOT NULL,
    "capturedAt" DATETIME NOT NULL,
    "usedAt" DATETIME
);

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "signalId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "bodyEs" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revisions" TEXT NOT NULL DEFAULT '[]',
    "scheduledAt" DATETIME,
    "publishedUrn" TEXT,
    "publishAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "CycleLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "at" DATETIME NOT NULL,
    "outcome" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "Signal_hash_key" ON "Signal"("hash");

-- CreateIndex
CREATE INDEX "Signal_usedAt_idx" ON "Signal"("usedAt");

-- CreateIndex
CREATE INDEX "Draft_status_idx" ON "Draft"("status");

-- CreateIndex
CREATE INDEX "CycleLog_at_idx" ON "CycleLog"("at");
