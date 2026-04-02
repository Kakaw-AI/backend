/*
  Warnings:

  - A unique constraint covering the columns `[userId,displayName]` on the table `llm_connections` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[userId,provider,apiKeyLastFour]` on the table `llm_connections` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "suggestions" TEXT[],
ADD COLUMN     "tokenUsage" JSONB;

-- CreateIndex
CREATE UNIQUE INDEX "llm_connections_userId_displayName_key" ON "llm_connections"("userId", "displayName");

-- CreateIndex
CREATE UNIQUE INDEX "llm_connections_userId_provider_apiKeyLastFour_key" ON "llm_connections"("userId", "provider", "apiKeyLastFour");
