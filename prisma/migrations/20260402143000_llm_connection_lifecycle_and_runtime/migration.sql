-- AlterTable
ALTER TABLE "llm_connections"
ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "conversations"
ADD COLUMN "llmModelOverride" TEXT NULL,
ALTER COLUMN "llmConnectionId" DROP NOT NULL;

-- DropForeignKey
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_llmConnectionId_fkey";

-- AddForeignKey
ALTER TABLE "conversations"
ADD CONSTRAINT "conversations_llmConnectionId_fkey"
FOREIGN KEY ("llmConnectionId")
REFERENCES "llm_connections"("id")
ON DELETE SET NULL
ON UPDATE CASCADE;
