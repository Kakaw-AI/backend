import { Injectable } from '@nestjs/common';
import { MessageRole } from '@prisma/client';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import { PrismaService } from '../prisma/prisma.service';

type UsageRow = {
  model: string;
  runs: number;
  input: number;
  output: number;
  last30Days: number;
};

@Injectable()
export class UsersService {
  constructor(
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly llmConnectionsService: LlmConnectionsService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Deletes the account and everything it owns. Uploaded files first, since
   * they are the one thing the database cascade cannot reach; then the user
   * row, which takes sessions, linked accounts, database sources (with their
   * stored credentials), LLM keys, conversations and traces with it.
   */
  async deleteAccount(userId: string) {
    await this.databaseSourcesService.deleteUploadsForUser(userId);
    await this.prisma.user.delete({ where: { id: userId } });
  }

  /**
   * What the profile window shows: how much the user has set up and used.
   * Tokens come from the usage ledger, one row per turn (failed turns too).
   * Unlike the traces, it stays when chats or databases are deleted.
   */
  async getUsage(userId: string) {
    const [user, conversations, questions, databases, uploads, apiKeys, byModel] =
      await Promise.all([
        this.prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { createdAt: true },
        }),
        this.prisma.conversation.count({ where: { userId } }),
        this.prisma.message.count({
          where: { role: MessageRole.USER, conversation: { userId } },
        }),
        this.prisma.databaseSource.count({ where: { userId } }),
        this.prisma.databaseSource.count({
          where: { userId, sqliteObjectKey: { not: null } },
        }),
        this.prisma.llmConnection.count({ where: { userId } }),
        this.prisma.$queryRaw<UsageRow[]>`
          SELECT
            model,
            COUNT(*)::float8 AS runs,
            COALESCE(SUM("inputTokens"), 0)::float8 AS input,
            COALESCE(SUM("outputTokens"), 0)::float8 AS output,
            COALESCE(SUM("inputTokens" + "outputTokens")
              FILTER (WHERE "createdAt" > now() - interval '30 days'), 0)::float8 AS "last30Days"
          FROM token_usage_entries
          WHERE "userId" = ${userId}
          GROUP BY model`,
      ]);

    const models = byModel.map((row) => ({
      model: row.model,
      runs: row.runs,
      inputTokens: row.input,
      outputTokens: row.output,
      totalTokens: row.input + row.output,
    })).sort((a, b) => b.totalTokens - a.totalTokens);
    const sum = (pick: (row: UsageRow) => number) =>
      byModel.reduce((total, row) => total + pick(row), 0);

    return {
      memberSince: user.createdAt.toISOString(),
      counts: { conversations, questions, databases, uploads, apiKeys },
      tokens: {
        inputTokens: sum((row) => row.input),
        outputTokens: sum((row) => row.output),
        totalTokens: sum((row) => row.input + row.output),
        last30Days: sum((row) => row.last30Days),
        runs: sum((row) => row.runs),
      },
      models,
    };
  }

  async getOnboardingState(userId: string) {
    const [databaseState, llmState] = await Promise.all([
      this.databaseSourcesService.getOnboardingState(userId),
      this.llmConnectionsService.getOnboardingState(userId),
    ]);

    return {
      ...databaseState,
      ...llmState,
    };
  }

  getConnections(userId: string) {
    return this.databaseSourcesService.listForUser(userId);
  }

  getLlmConnections(userId: string) {
    return this.llmConnectionsService.listForUser(userId);
  }

  async getChatOptions(userId: string) {
    const [databaseSources, llmConnections] = await Promise.all([
      this.databaseSourcesService.listForUser(userId),
      this.llmConnectionsService.listForUser(userId),
    ]);

    return {
      databaseSources,
      llmConnections,
    };
  }
}
