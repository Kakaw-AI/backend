-- CreateEnum
CREATE TYPE "LlmConnectionStatus" AS ENUM ('PENDING', 'SUCCESS', 'FAILED');

-- CreateEnum
CREATE TYPE "LlmProvider" AS ENUM (
  'OPENAI',
  'ANTHROPIC',
  'OPENROUTER',
  'GOOGLE',
  'GITHUB_COPILOT'
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
  "lastError" TEXT,
  "lastTestedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "userId" TEXT NOT NULL,

  CONSTRAINT "llm_connections_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "llm_connections"
ADD CONSTRAINT "llm_connections_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
