-- CreateEnum
CREATE TYPE "BookStatus" AS ENUM ('RUNNING', 'PARTIAL', 'READY', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BookPageSource" AS ENUM ('LLM', 'HUMAN');

-- AlterTable
ALTER TABLE "token_usage_entries" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'chat';

-- CreateTable
CREATE TABLE "database_books" (
    "id" TEXT NOT NULL,
    "status" "BookStatus" NOT NULL DEFAULT 'RUNNING',
    "overview" TEXT,
    "tokensUsed" INTEGER NOT NULL DEFAULT 0,
    "tablesTotal" INTEGER NOT NULL DEFAULT 0,
    "tablesDone" INTEGER NOT NULL DEFAULT 0,
    "schemaFingerprint" TEXT,
    "lastError" TEXT,
    "cancelRequested" BOOLEAN NOT NULL DEFAULT false,
    "fullRunsToday" INTEGER NOT NULL DEFAULT 0,
    "runsDay" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "databaseSourceId" TEXT NOT NULL,
    "llmConnectionId" TEXT,

    CONSTRAINT "database_books_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "book_pages" (
    "id" TEXT NOT NULL,
    "tableKey" TEXT NOT NULL,
    "schemaHash" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "source" "BookPageSource" NOT NULL DEFAULT 'LLM',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "bookId" TEXT NOT NULL,

    CONSTRAINT "book_pages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "database_books_databaseSourceId_key" ON "database_books"("databaseSourceId");

-- CreateIndex
CREATE INDEX "database_books_llmConnectionId_idx" ON "database_books"("llmConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "book_pages_bookId_tableKey_key" ON "book_pages"("bookId", "tableKey");

-- AddForeignKey
ALTER TABLE "database_books" ADD CONSTRAINT "database_books_databaseSourceId_fkey" FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_books" ADD CONSTRAINT "database_books_llmConnectionId_fkey" FOREIGN KEY ("llmConnectionId") REFERENCES "llm_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "book_pages" ADD CONSTRAINT "book_pages_bookId_fkey" FOREIGN KEY ("bookId") REFERENCES "database_books"("id") ON DELETE CASCADE ON UPDATE CASCADE;

