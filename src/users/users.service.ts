import { Injectable } from '@nestjs/common';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import { PrismaService } from '../prisma/prisma.service';

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
