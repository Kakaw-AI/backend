-- Migrate custom-openai connections to openai (same API, same base URL handling)
UPDATE "llm_connections" SET provider = 'OPENAI' WHERE provider = 'CUSTOM_OPENAI';

-- Remove github-copilot connections (used linked OAuth tokens, no stored API key — cannot auto-migrate)
DELETE FROM "llm_connections" WHERE provider = 'GITHUB_COPILOT';

-- Remove deprecated enum values
ALTER TYPE "LlmProvider" RENAME TO "LlmProvider_old";
CREATE TYPE "LlmProvider" AS ENUM ('OPENAI', 'ANTHROPIC', 'OPENROUTER', 'GOOGLE', 'OLLAMA', 'LM_STUDIO');
ALTER TABLE "llm_connections" ALTER COLUMN "provider" TYPE "LlmProvider" USING "provider"::text::"LlmProvider";
DROP TYPE "LlmProvider_old";
