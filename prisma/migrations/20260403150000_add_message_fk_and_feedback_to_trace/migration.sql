-- AlterTable: make messageId nullable on agent_run_traces and add feedback fields
ALTER TABLE "agent_run_traces"
  ALTER COLUMN "messageId" DROP NOT NULL,
  ADD COLUMN "feedback" TEXT,
  ADD COLUMN "feedbackAt" TIMESTAMP(3);

-- AddForeignKey: agent_run_traces.messageId -> messages.id (SetNull on delete)
ALTER TABLE "agent_run_traces"
  ADD CONSTRAINT "agent_run_traces_messageId_fkey"
  FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
