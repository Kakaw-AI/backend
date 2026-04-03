-- AlterEnum
ALTER TYPE "LlmProvider" ADD VALUE IF NOT EXISTS 'CUSTOM_OPENAI';

-- AlterTable
ALTER TABLE "database_sources"
ADD COLUMN "sqliteFingerprint" TEXT,
ADD COLUMN "syncMetadata" JSONB;

-- CreateTable
CREATE TABLE "database_source_tables" (
    "id" TEXT NOT NULL,
    "schemaName" TEXT,
    "name" TEXT NOT NULL,
    "rowCount" INTEGER,
    "sampleRows" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "databaseSourceId" TEXT NOT NULL,

    CONSTRAINT "database_source_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_source_columns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "dataType" TEXT NOT NULL,
    "isNullable" BOOLEAN NOT NULL,
    "isPrimaryKey" BOOLEAN NOT NULL,
    "ordinalPosition" INTEGER NOT NULL,
    "sampleValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tableId" TEXT NOT NULL,

    CONSTRAINT "database_source_columns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_source_indexes" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "columns" TEXT[],
    "isUnique" BOOLEAN NOT NULL DEFAULT false,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "tableId" TEXT NOT NULL,

    CONSTRAINT "database_source_indexes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_source_relations" (
    "id" TEXT NOT NULL,
    "constraintName" TEXT,
    "sourceColumn" TEXT NOT NULL,
    "targetColumn" TEXT NOT NULL,
    "onUpdate" TEXT,
    "onDelete" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "sourceTableId" TEXT NOT NULL,
    "targetTableId" TEXT NOT NULL,

    CONSTRAINT "database_source_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_source_knowledge_documents" (
    "id" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceKey" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "databaseSourceId" TEXT NOT NULL,

    CONSTRAINT "database_source_knowledge_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_run_traces" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL,
    "effectiveModel" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "response" TEXT,
    "error" TEXT,
    "tokenUsage" JSONB,
    "steps" JSONB,
    "toolCalls" JSONB,
    "repairHistory" JSONB,
    "chartSpec" JSONB,
    "cacheKey" TEXT,
    "cacheHit" BOOLEAN NOT NULL DEFAULT false,
    "suggestions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "databaseSourceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "llmConnectionId" TEXT,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "agent_run_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "database_sources_userId_sqliteFingerprint_idx" ON "database_sources"("userId", "sqliteFingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "database_source_tables_databaseSourceId_schemaName_name_key"
ON "database_source_tables"("databaseSourceId", "schemaName", "name");

-- CreateIndex
CREATE INDEX "database_source_tables_databaseSourceId_name_idx"
ON "database_source_tables"("databaseSourceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "database_source_columns_tableId_name_key"
ON "database_source_columns"("tableId", "name");

-- CreateIndex
CREATE INDEX "database_source_columns_tableId_ordinalPosition_idx"
ON "database_source_columns"("tableId", "ordinalPosition");

-- CreateIndex
CREATE UNIQUE INDEX "database_source_indexes_tableId_name_key"
ON "database_source_indexes"("tableId", "name");

-- CreateIndex
CREATE INDEX "database_source_relations_sourceTableId_idx"
ON "database_source_relations"("sourceTableId");

-- CreateIndex
CREATE INDEX "database_source_relations_targetTableId_idx"
ON "database_source_relations"("targetTableId");

-- CreateIndex
CREATE INDEX "database_source_knowledge_documents_databaseSourceId_scope_idx"
ON "database_source_knowledge_documents"("databaseSourceId", "scope");

-- CreateIndex
CREATE INDEX "database_source_knowledge_documents_databaseSourceId_referenceType_idx"
ON "database_source_knowledge_documents"("databaseSourceId", "referenceType");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_traces_requestId_key" ON "agent_run_traces"("requestId");

-- CreateIndex
CREATE INDEX "agent_run_traces_userId_databaseSourceId_createdAt_idx"
ON "agent_run_traces"("userId", "databaseSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_run_traces_conversationId_createdAt_idx"
ON "agent_run_traces"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "database_source_tables"
ADD CONSTRAINT "database_source_tables_databaseSourceId_fkey"
FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_columns"
ADD CONSTRAINT "database_source_columns_tableId_fkey"
FOREIGN KEY ("tableId") REFERENCES "database_source_tables"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_indexes"
ADD CONSTRAINT "database_source_indexes_tableId_fkey"
FOREIGN KEY ("tableId") REFERENCES "database_source_tables"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_relations"
ADD CONSTRAINT "database_source_relations_sourceTableId_fkey"
FOREIGN KEY ("sourceTableId") REFERENCES "database_source_tables"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_relations"
ADD CONSTRAINT "database_source_relations_targetTableId_fkey"
FOREIGN KEY ("targetTableId") REFERENCES "database_source_tables"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_knowledge_documents"
ADD CONSTRAINT "database_source_knowledge_documents_databaseSourceId_fkey"
FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces"
ADD CONSTRAINT "agent_run_traces_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces"
ADD CONSTRAINT "agent_run_traces_databaseSourceId_fkey"
FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces"
ADD CONSTRAINT "agent_run_traces_conversationId_fkey"
FOREIGN KEY ("conversationId") REFERENCES "conversations"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces"
ADD CONSTRAINT "agent_run_traces_llmConnectionId_fkey"
FOREIGN KEY ("llmConnectionId") REFERENCES "llm_connections"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
