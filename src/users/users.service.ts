import { Injectable } from '@nestjs/common';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';

@Injectable()
export class UsersService {
  constructor(
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly llmConnectionsService: LlmConnectionsService,
  ) {}

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
    const [databaseSources, llmConnections, githubLinked] = await Promise.all([
      this.databaseSourcesService.listForUser(userId),
      this.llmConnectionsService.listForUser(userId),
      this.llmConnectionsService.hasLinkedGithubAccount(userId),
    ]);

    return {
      databaseSources,
      llmConnections,
      githubLinked,
    };
  }
}
