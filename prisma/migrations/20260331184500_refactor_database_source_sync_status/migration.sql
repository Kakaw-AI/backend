ALTER TYPE "DatabaseSourceStatus" RENAME VALUE 'SUCCESS' TO 'READY';

ALTER TYPE "DatabaseSourceStatus" ADD VALUE IF NOT EXISTS 'SYNCING';

ALTER TABLE "database_sources"
ADD COLUMN "schemaFingerprint" TEXT,
ADD COLUMN "lastSyncedAt" TIMESTAMP(3),
ADD COLUMN "syncRequestedAt" TIMESTAMP(3);
