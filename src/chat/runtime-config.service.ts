import { BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AuthService } from '../auth/auth.service';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import {
  AgentDatabaseRuntime,
  AgentLlmRuntime,
} from './chat.types';

@Injectable()
export class RuntimeConfigService {
  constructor(
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly llmConnectionsService: LlmConnectionsService,
    private readonly authService: AuthService,
  ) {}

  async resolve(
    userId: string,
    sourceId: string,
    llmConnectionId: string,
    llmModelOverride: string | null,
    request: Request,
  ): Promise<{ database: AgentDatabaseRuntime; llm: AgentLlmRuntime }> {
    const [databaseSource, llmConnection] = await Promise.all([
      this.databaseSourcesService.getRuntimeForUser(userId, sourceId),
      this.llmConnectionsService.getRuntimeForUser(userId, llmConnectionId),
    ]);
    const model = llmModelOverride?.trim() || llmConnection.defaultModel;

    return {
      database: this.toDatabaseRuntime(databaseSource),
      llm: await this.toLlmRuntime(request, llmConnection, model),
    };
  }

  private toDatabaseRuntime(
    source: Awaited<ReturnType<DatabaseSourcesService['getRuntimeForUser']>>,
  ): AgentDatabaseRuntime {
    const label =
      source.provider === 'sqlite'
        ? source.sqliteOriginalFilename?.trim() || 'SQLite upload'
        : 'PostgreSQL connection';

    return {
      sourceId: source.id,
      provider: source.provider as SupportedDatabaseProvider,
      label,
      connectionString:
        source.provider === 'postgresql'
          ? source.connectionString ?? undefined
          : undefined,
      sqliteFilePath:
        source.provider === 'sqlite'
          ? source.sqliteFilePath ?? undefined
          : undefined,
      sqliteOriginalFilename:
        source.provider === 'sqlite'
          ? source.sqliteOriginalFilename ?? undefined
          : undefined,
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
        throw new BadRequestException(
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
      throw new BadRequestException(
        'Selected LLM connection is missing runtime credentials.',
      );
    }

    switch (connection.provider) {
      case 'openai':
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
import type { SupportedDatabaseProvider } from '../database-sources/database-sources.types';
