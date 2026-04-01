-- CreateEnum
CREATE TYPE "DatabaseSourceStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- AlterTable
ALTER TABLE "database_sources"
ADD COLUMN "status" "DatabaseSourceStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN "sqliteFilePath" TEXT,
ADD COLUMN "sqliteOriginalFilename" TEXT,
ADD COLUMN "lastError" TEXT,
ADD COLUMN "lastTestedAt" TIMESTAMP(3),
ALTER COLUMN "connectionString" DROP NOT NULL;
