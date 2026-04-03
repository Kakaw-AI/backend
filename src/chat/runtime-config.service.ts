import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { DatabaseKnowledgeService } from '../database-knowledge/database-knowledge.service';
import type { DatabaseKnowledgeRuntime } from '../database-knowledge/database-knowledge.types';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import {
  AgentDatabaseRuntime,
  AgentLlmRuntime,
  buildRuntimeUnavailableException,
} from './chat.types';

@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly databaseKnowledgeService: DatabaseKnowledgeService,
    private readonly llmConnectionsService: LlmConnectionsService,
    private readonly authService: AuthService,
  ) {}

  async resolve(
    userId: string,
    sourceId: string,
    llmConnectionId: string,
    llmModelOverride: string | null,
    request: Request,
  ): Promise<{
    database: AgentDatabaseRuntime;
    knowledge: DatabaseKnowledgeRuntime;
    llm: AgentLlmRuntime;
  }> {
    const [databaseSource, llmConnection] = await Promise.all([
      this.databaseSourcesService.getRuntimeForUser(userId, sourceId),
      this.llmConnectionsService.getRuntimeForUser(userId, llmConnectionId),
    ]);
    const model = llmModelOverride?.trim() || llmConnection.defaultModel;

    return {
      database: this.databaseSourcesService.toAgentDatabaseRuntime(databaseSource),
      knowledge: await this.databaseKnowledgeService.getRuntimeKnowledge(sourceId),
      llm: await this.toLlmRuntime(request, llmConnection, model),
    };
  }

  private async toLlmRuntime(
    request: Request,
    connection: Awaited<ReturnType<LlmConnectionsService['getRuntimeForUser']>>,
    model: string,
  ): Promise<AgentLlmRuntime> {
    if (connection.provider === 'github-copilot') {
      const tokens = await this.authService.getAccessToken(request, 'github');
      const accessToken = tokens?.accessToken?.trim();
      if (!accessToken) {
        throw buildRuntimeUnavailableException(
          'A linked GitHub account with an access token is required for this runtime.',
        );
      }

      return {
        connectionId: connection.id,
        provider: 'github-copilot',
        model,
        accessToken,
      };
    }

    if (!connection.apiKey?.trim()) {
      throw buildRuntimeUnavailableException(
        'Selected LLM connection is missing runtime credentials.',
      );
    }

    switch (connection.provider) {
      case 'openai':
      case 'custom-openai':
        return {
          connectionId: connection.id,
          provider: connection.provider,
          model,
          apiKey: connection.apiKey,
          baseUrl: connection.baseUrl?.trim() || 'https://api.openai.com/v1',
        };
      case 'openrouter':
        return {
          connectionId: connection.id,
          provider: connection.provider,
          model,
          apiKey: connection.apiKey,
          baseUrl: 'https://openrouter.ai/api/v1',
        };
      case 'google':
      case 'anthropic':
        return {
          connectionId: connection.id,
          provider: connection.provider,
          model,
          apiKey: connection.apiKey,
        };
    }
  }
}
