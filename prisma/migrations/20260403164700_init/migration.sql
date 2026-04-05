-- CreateEnum
CREATE TYPE "DatabaseSourceStatus" AS ENUM ('PENDING', 'SYNCING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "LlmConnectionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM ('OPENAI', 'CUSTOM_OPENAI', 'ANTHROPIC', 'OPENROUTER', 'GOOGLE', 'GITHUB_COPILOT');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('PENDING', 'STREAMING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageArtifactType" AS ENUM ('TEXT', 'SQL', 'TABLE', 'CHART', 'ERROR');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounts" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "verifications" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "verifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "database_sources" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "status" "DatabaseSourceStatus" NOT NULL DEFAULT 'PENDING',
    "connectionString" TEXT,
    "sqliteFilePath" TEXT,
    "sqliteOriginalFilename" TEXT,
    "sqliteFingerprint" TEXT,
    "schemaFingerprint" TEXT,
    "syncMetadata" JSONB,
    "lastError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "syncRequestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "database_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "llm_connections" (
    "id" TEXT NOT NULL,
    "provider" "LlmProvider" NOT NULL,
    "status" "LlmConnectionStatus" NOT NULL DEFAULT 'PENDING',
    "displayName" TEXT NOT NULL,
    "defaultModel" TEXT NOT NULL,
    "encryptedApiKey" TEXT,
    "apiKeyLastFour" TEXT,
    "usesLinkedAccount" BOOLEAN NOT NULL DEFAULT false,
    "linkedProviderId" TEXT,
    "baseUrl" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastError" TEXT,
    "lastTestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "llm_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lastMessageAt" TIMESTAMP(3),
    "llmModelOverride" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "databaseSourceId" TEXT NOT NULL,
    "llmConnectionId" TEXT,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'PENDING',
    "content" TEXT NOT NULL,
    "error" TEXT,
    "tokenUsage" JSONB,
    "suggestions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "conversationId" TEXT NOT NULL,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_artifacts" (
    "id" TEXT NOT NULL,
    "type" "MessageArtifactType" NOT NULL,
    "payload" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageId" TEXT NOT NULL,

    CONSTRAINT "message_artifacts_pkey" PRIMARY KEY ("id")
);

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
    "feedback" TEXT,
    "feedbackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "databaseSourceId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "llmConnectionId" TEXT,
    "messageId" TEXT,

    CONSTRAINT "agent_run_traces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_key" ON "sessions"("token");

-- CreateIndex
CREATE INDEX "database_sources_userId_sqliteFingerprint_idx" ON "database_sources"("userId", "sqliteFingerprint");

-- CreateIndex
CREATE INDEX "conversations_userId_updatedAt_idx" ON "conversations"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "message_artifacts_messageId_createdAt_idx" ON "message_artifacts"("messageId", "createdAt");

-- CreateIndex
CREATE INDEX "database_source_tables_databaseSourceId_name_idx" ON "database_source_tables"("databaseSourceId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "database_source_tables_databaseSourceId_schemaName_name_key" ON "database_source_tables"("databaseSourceId", "schemaName", "name");

-- CreateIndex
CREATE INDEX "database_source_columns_tableId_ordinalPosition_idx" ON "database_source_columns"("tableId", "ordinalPosition");

-- CreateIndex
CREATE UNIQUE INDEX "database_source_columns_tableId_name_key" ON "database_source_columns"("tableId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "database_source_indexes_tableId_name_key" ON "database_source_indexes"("tableId", "name");

-- CreateIndex
CREATE INDEX "database_source_relations_sourceTableId_idx" ON "database_source_relations"("sourceTableId");

-- CreateIndex
CREATE INDEX "database_source_relations_targetTableId_idx" ON "database_source_relations"("targetTableId");

-- CreateIndex
CREATE INDEX "database_source_knowledge_documents_databaseSourceId_scope_idx" ON "database_source_knowledge_documents"("databaseSourceId", "scope");

-- CreateIndex
CREATE INDEX "database_source_knowledge_documents_databaseSourceId_refere_idx" ON "database_source_knowledge_documents"("databaseSourceId", "referenceType");

-- CreateIndex
CREATE UNIQUE INDEX "agent_run_traces_requestId_key" ON "agent_run_traces"("requestId");

-- CreateIndex
CREATE INDEX "agent_run_traces_userId_databaseSourceId_createdAt_idx" ON "agent_run_traces"("userId", "databaseSourceId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_run_traces_conversationId_createdAt_idx" ON "agent_run_traces"("conversationId", "createdAt");

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_sources" ADD CONSTRAINT "database_sources_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "llm_connections" ADD CONSTRAINT "llm_connections_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_databaseSourceId_fkey" FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_llmConnectionId_fkey" FOREIGN KEY ("llmConnectionId") REFERENCES "llm_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_artifacts" ADD CONSTRAINT "message_artifacts_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_tables" ADD CONSTRAINT "database_source_tables_databaseSourceId_fkey" FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_columns" ADD CONSTRAINT "database_source_columns_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "database_source_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_indexes" ADD CONSTRAINT "database_source_indexes_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "database_source_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_relations" ADD CONSTRAINT "database_source_relations_sourceTableId_fkey" FOREIGN KEY ("sourceTableId") REFERENCES "database_source_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_relations" ADD CONSTRAINT "database_source_relations_targetTableId_fkey" FOREIGN KEY ("targetTableId") REFERENCES "database_source_tables"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "database_source_knowledge_documents" ADD CONSTRAINT "database_source_knowledge_documents_databaseSourceId_fkey" FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces" ADD CONSTRAINT "agent_run_traces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces" ADD CONSTRAINT "agent_run_traces_databaseSourceId_fkey" FOREIGN KEY ("databaseSourceId") REFERENCES "database_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces" ADD CONSTRAINT "agent_run_traces_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces" ADD CONSTRAINT "agent_run_traces_llmConnectionId_fkey" FOREIGN KEY ("llmConnectionId") REFERENCES "llm_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_run_traces" ADD CONSTRAINT "agent_run_traces_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
