import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { DatabaseKnowledgeService } from '../database-knowledge/database-knowledge.service';
import type { DatabaseKnowledgeRuntime } from '../database-knowledge/database-knowledge.types';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import {
  AgentDatabaseRuntime,
  AgentLlmRuntime,
  buildRuntimeUnavailableException,
} from './chat.types';
import {
  getEffectiveRuntimeBaseUrl,
  providerTakesOptionalApiKey,
} from '../llm-connections/llm-connections.types';

@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly databaseKnowledgeService: DatabaseKnowledgeService,
    private readonly llmConnectionsService: LlmConnectionsService,
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
      llm: this.toLlmRuntime(llmConnection, model),
    };
  }

  private toLlmRuntime(
    connection: Awaited<ReturnType<LlmConnectionsService['getRuntimeForUser']>>,
    model: string,
  ): AgentLlmRuntime {
    if (!providerTakesOptionalApiKey(connection.provider) && !connection.apiKey?.trim()) {
      throw buildRuntimeUnavailableException(
        'Selected LLM connection is missing runtime credentials.',
      );
    }

    switch (connection.provider) {
      case 'openai':
      case 'ollama':
      case 'lm-studio':
        return {
          connectionId: connection.id,
          provider: connection.provider,
          model,
          apiKey: connection.apiKey || 'empty',
          baseUrl: getEffectiveRuntimeBaseUrl(connection.provider, connection.baseUrl) || 'https://api.openai.com/v1',
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
