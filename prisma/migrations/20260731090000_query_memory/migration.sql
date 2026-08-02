-- Query memory: questions this source has already answered, paired with the SQL
-- that actually executed. The corpus is rebuilt from agent_run_traces by
-- scripts/backfill-query-memory.ts, which is run manually — deliberately NOT
-- from this migration, because migrations run synchronously during boot.

CREATE TYPE "QueryMemoryStatus" AS ENUM ('ACTIVE', 'QUARANTINED', 'RETIRED');

CREATE TABLE "query_memory_entries" (
    "id" TEXT NOT NULL,
    "schemaFingerprint" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "normalizedQuestion" TEXT NOT NULL,
    "questionHash" TEXT NOT NULL,
    "sql" TEXT NOT NULL,
    "tablesReferenced" TEXT[],
    "rowCount" INTEGER NOT NULL DEFAULT 0,
    "embedding" BYTEA,
    "embeddingModel" TEXT,
    "status" "QueryMemoryStatus" NOT NULL DEFAULT 'ACTIVE',
    "positiveCount" INTEGER NOT NULL DEFAULT 0,
    "negativeCount" INTEGER NOT NULL DEFAULT 0,
    "reuseCount" INTEGER NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),
    "sourceTraceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "databaseSourceId" TEXT NOT NULL,

    CONSTRAINT "query_memory_entries_pkey" PRIMARY KEY ("id")
);

-- One entry per question per source: a later correct answer overwrites an
-- earlier wrong one, which is the cheapest defense against a bad example
-- becoming permanent.
CREATE UNIQUE INDEX "query_memory_entries_databaseSourceId_questionHash_key"
    ON "query_memory_entries"("databaseSourceId", "questionHash");

CREATE INDEX "query_memory_entries_databaseSourceId_status_schemaFingerpri_idx"
    ON "query_memory_entries"("databaseSourceId", "status", "schemaFingerprint");

CREATE INDEX "query_memory_entries_sourceTraceId_idx"
    ON "query_memory_entries"("sourceTraceId");

ALTER TABLE "query_memory_entries" ADD CONSTRAINT "query_memory_entries_databaseSourceId_fkey"
    FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill and per-source analytics scan agent_run_traces by source alone; the
-- existing (userId, databaseSourceId, createdAt) index cannot serve that.
CREATE INDEX "agent_run_traces_databaseSourceId_createdAt_idx"
    ON "agent_run_traces"("databaseSourceId", "createdAt");
