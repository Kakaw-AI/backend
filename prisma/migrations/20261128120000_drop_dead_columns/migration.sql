-- AlterEnum
BEGIN;
CREATE TYPE "MessageRole_new" AS ENUM ('USER', 'ASSISTANT');
ALTER TABLE "messages" ALTER COLUMN "role" TYPE "MessageRole_new" USING ("role"::text::"MessageRole_new");
ALTER TYPE "MessageRole" RENAME TO "MessageRole_old";
ALTER TYPE "MessageRole_new" RENAME TO "MessageRole";
DROP TYPE "MessageRole_old";
COMMIT;

-- AlterEnum
BEGIN;
CREATE TYPE "MessageArtifactType_new" AS ENUM ('TEXT', 'SQL', 'TABLE', 'CHART');
ALTER TABLE "message_artifacts" ALTER COLUMN "type" TYPE "MessageArtifactType_new" USING ("type"::text::"MessageArtifactType_new");
ALTER TYPE "MessageArtifactType" RENAME TO "MessageArtifactType_old";
ALTER TYPE "MessageArtifactType_new" RENAME TO "MessageArtifactType";
DROP TYPE "MessageArtifactType_old";
COMMIT;

-- DropForeignKey
ALTER TABLE "database_source_indexes" DROP CONSTRAINT "database_source_indexes_tableId_fkey";

-- DropForeignKey
ALTER TABLE "database_source_knowledge_documents" DROP CONSTRAINT "database_source_knowledge_documents_databaseSourceId_fkey";

-- DropIndex
DROP INDEX "query_memory_entries_sourceTraceId_idx";

-- DropIndex
DROP INDEX "conversations_userId_updatedAt_idx";

-- DropIndex
DROP INDEX "database_source_tables_databaseSourceId_name_idx";

-- DropIndex
DROP INDEX "agent_run_traces_requestId_key";

-- AlterTable
ALTER TABLE "query_memory_entries" DROP COLUMN "lastUsedAt",
DROP COLUMN "negativeCount",
DROP COLUMN "normalizedQuestion",
DROP COLUMN "positiveCount",
DROP COLUMN "reuseCount",
DROP COLUMN "rowCount",
DROP COLUMN "sourceTraceId";

-- AlterTable
ALTER TABLE "llm_connections" DROP COLUMN "linkedProviderId",
DROP COLUMN "usesLinkedAccount";

-- AlterTable
ALTER TABLE "database_source_tables" DROP COLUMN "sampleRows";

-- AlterTable
ALTER TABLE "database_source_columns" DROP COLUMN "normalizedName";

-- AlterTable
ALTER TABLE "database_source_relations" DROP COLUMN "constraintName",
DROP COLUMN "onDelete",
DROP COLUMN "onUpdate";

-- AlterTable
ALTER TABLE "agent_run_traces" DROP COLUMN "cacheKey",
DROP COLUMN "effectiveModel",
DROP COLUMN "feedback",
DROP COLUMN "feedbackAt",
DROP COLUMN "requestId",
DROP COLUMN "response",
DROP COLUMN "status",
DROP COLUMN "suggestions",
DROP COLUMN "updatedAt";

-- DropTable
DROP TABLE "database_source_indexes";

-- DropTable
DROP TABLE "database_source_knowledge_documents";

-- CreateIndex
CREATE INDEX "accounts_userId_idx" ON "accounts"("userId");

-- CreateIndex
CREATE INDEX "agent_run_traces_llmConnectionId_idx" ON "agent_run_traces"("llmConnectionId");

