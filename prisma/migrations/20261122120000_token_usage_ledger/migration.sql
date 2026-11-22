-- Token usage ledger: one row per agent run with only the model and token
-- counts. agent_run_traces cascade away with their chat or database, which
-- used to take the user's token counter down with them.

CREATE TABLE "token_usage_entries" (
    "id" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "token_usage_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "token_usage_entries_userId_createdAt_idx"
    ON "token_usage_entries"("userId", "createdAt");

ALTER TABLE "token_usage_entries" ADD CONSTRAINT "token_usage_entries_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry over the usage of every run that still exists. The trace id is a cuid,
-- so it doubles as the new row's id.
INSERT INTO "token_usage_entries" ("id", "model", "inputTokens", "outputTokens", "createdAt", "userId")
SELECT
    "id",
    "effectiveModel",
    COALESCE(ROUND(("tokenUsage"->>'inputTokens')::float8), 0)::int,
    COALESCE(ROUND(("tokenUsage"->>'outputTokens')::float8), 0)::int,
    "createdAt",
    "userId"
FROM "agent_run_traces";
