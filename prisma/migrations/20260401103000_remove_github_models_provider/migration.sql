DELETE FROM "llm_connections"
WHERE "provider" = 'GITHUB';

ALTER TYPE "LlmProvider" RENAME TO "LlmProvider_old";

CREATE TYPE "LlmProvider" AS ENUM (
  'OPENAI',
  'ANTHROPIC',
  'OPENROUTER',
  'GOOGLE',
  'GITHUB_COPILOT'
);

ALTER TABLE "llm_connections"
ALTER COLUMN "provider" TYPE "LlmProvider"
USING ("provider"::text::"LlmProvider");

DROP TYPE "LlmProvider_old";
