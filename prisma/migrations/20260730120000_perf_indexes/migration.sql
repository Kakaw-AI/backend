-- Every conversation load does a top-1 `orderBy createdAt desc` lookup on
-- agent_run_traces per message; there was no index on messageId at all.
CREATE INDEX "agent_run_traces_messageId_createdAt_idx" ON "agent_run_traces"("messageId", "createdAt");

-- The conversation list sorts by lastMessageAt first, which the existing
-- (userId, updatedAt) index does not cover.
CREATE INDEX "conversations_userId_lastMessageAt_idx" ON "conversations"("userId", "lastMessageAt");

-- llm_connections and sessions are both filtered by userId with no index.
CREATE INDEX "llm_connections_userId_idx" ON "llm_connections"("userId");
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");
