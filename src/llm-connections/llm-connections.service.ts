import { BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { LlmConnectionStatus } from '@prisma/client';
import { AuthService } from '../auth/auth.service';
import { GithubCopilotSdkService } from './github-copilot-sdk.service';
import { LlmConnectionsRepository } from './llm-connections.repository';
import { SecretsService } from './secrets.service';
import {
  CreateLlmConnectionInput,
  SupportedLlmProvider,
  buildDefaultDisplayName,
  providerUsesLinkedAccount,
  toPrismaLlmProvider,
} from './llm-connections.types';

type ProviderValidationRequest = {
  url: string;
  headers?: Record<string, string>;
};

@Injectable()
export class LlmConnectionsService {
  constructor(
    private readonly llmConnectionsRepository: LlmConnectionsRepository,
    private readonly secretsService: SecretsService,
    private readonly authService: AuthService,
    private readonly githubCopilotSdkService: GithubCopilotSdkService,
  ) {}

  listForUser(userId: string) {
    return this.llmConnectionsRepository.findByUser(userId);
  }

  async getRuntimeForUser(userId: string, id: string) {
    const connection = await this.llmConnectionsRepository.findRuntimeByUserAndId(
      userId,
      id,
    );

    if (!connection) {
      throw new BadRequestException('Selected LLM connection could not be found.');
    }

    if (connection.status !== LlmConnectionStatus.SUCCESS) {
      throw new BadRequestException(
        'Selected LLM connection must be healthy before starting a chat.',
      );
    }

    return {
      ...connection,
      apiKey: connection.encryptedApiKey
        ? this.secretsService.decrypt(connection.encryptedApiKey)
        : undefined,
    };
  }

  hasLinkedGithubAccount(userId: string) {
    return this.llmConnectionsRepository.hasLinkedGithubAccount(userId);
  }

  async getOnboardingState(userId: string) {
    const [llmConnectionCount, successfulLlmConnectionCount] = await Promise.all([
      this.llmConnectionsRepository.countByUser(userId),
      this.llmConnectionsRepository.countSuccessfulByUser(userId),
    ]);

    return {
      hasLlmConnection: successfulLlmConnectionCount > 0,
      llmConnectionCount,
    };
  }

  async createForUser(
    userId: string,
    request: Request,
    input: CreateLlmConnectionInput,
  ) {
    const displayName = input.displayName?.trim()
      ? input.displayName.trim()
      : buildDefaultDisplayName(input.provider, this.getDefaultModel(input));
    const defaultModel = this.getDefaultModel(input);
    const usesLinkedAccount = providerUsesLinkedAccount(input.provider);
    const apiKey = input.apiKey?.trim();

    if (usesLinkedAccount && apiKey) {
      throw new BadRequestException(
        'GitHub Copilot uses your linked GitHub account and does not accept an API key.',
      );
    }

    if (!usesLinkedAccount && !apiKey) {
      throw new BadRequestException('apiKey is required for this provider.');
    }

    const apiKeyLastFour = apiKey ? apiKey.slice(-4) : undefined;

    // Check display name uniqueness
    const existingByName = await this.llmConnectionsRepository.findByDisplayNameForUser(
      userId,
      displayName,
    );
    if (existingByName) {
      throw new BadRequestException(
        `An LLM connection named "${displayName}" already exists.`,
      );
    }

    // Check API key uniqueness (only when an API key is provided)
    if (apiKey) {
      const existingByKey = await this.llmConnectionsRepository.findByProviderAndLastFourForUser(
        userId,
        toPrismaLlmProvider(input.provider),
        apiKey.slice(-4),
      );
      if (existingByKey) {
        throw new BadRequestException(
          `This API key is already registered for ${input.provider}.`,
        );
      }
    }

    const pendingConnection = await this.llmConnectionsRepository.createPending({
      userId,
      provider: input.provider,
      displayName,
      defaultModel,
      encryptedApiKey: apiKey ? this.secretsService.encrypt(apiKey) : undefined,
      apiKeyLastFour,
      usesLinkedAccount,
      linkedProviderId: usesLinkedAccount ? 'github' : undefined,
      baseUrl: input.baseUrl?.trim() || undefined,
    });

    try {
      if (usesLinkedAccount) {
        await this.validateCopilotConnection(request, defaultModel);
      } else if (apiKey) {
        await this.validateApiKeyProvider(input.provider, apiKey, input.baseUrl?.trim());
      }

      await this.llmConnectionsRepository.markSuccess(pendingConnection.id);
      return this.getByIdForUser(userId, pendingConnection.id);
    } catch (error) {
      const message = this.toConnectionErrorMessage(
        error,
        'Unable to validate this LLM connection.',
      );
      await this.llmConnectionsRepository.markFailure(pendingConnection.id, message);
      throw new BadRequestException(message);
    }
  }

  private async getByIdForUser(userId: string, id: string) {
    const connections = await this.llmConnectionsRepository.findByUser(userId);
    const connection = connections.find((item) => item.id === id);

    if (!connection) {
      throw new BadRequestException('Saved connection could not be loaded.');
    }

    return connection;
  }

  private getDefaultModel(input: CreateLlmConnectionInput) {
    const defaultModel = input.defaultModel?.trim();
    if (!defaultModel) {
      throw new BadRequestException('defaultModel is required.');
    }

    return defaultModel;
  }

  private async validateCopilotConnection(request: Request, defaultModel: string) {
    const tokens = await this.authService.getAccessToken(request, 'github');
    const accessToken = tokens?.accessToken?.trim();
    if (!accessToken) {
      throw new Error('A linked GitHub account with an access token is required.');
    }

    try {
      await this.githubCopilotSdkService.validateAccessToken(
        accessToken,
        defaultModel,
      );
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message.trim()
          : 'GitHub Copilot rejected the linked GitHub token.';
      throw new Error(
        `${message} Ensure your GitHub account has an active Copilot subscription.`,
      );
    }
  }

  private async validateApiKeyProvider(
    provider: SupportedLlmProvider,
    apiKey: string,
    baseUrl?: string,
  ) {
    const response = await this.fetchValidationRequest(
      this.buildProviderValidationRequest(provider, apiKey, baseUrl),
    );

    if (!response.ok) {
      const detail = await this.readValidationFailure(response);
      throw new Error(detail);
    }
  }

  private buildProviderValidationRequest(
    provider: SupportedLlmProvider,
    apiKey: string,
    baseUrl?: string,
  ): ProviderValidationRequest {
    switch (provider) {
      case 'openai': {
        const resolvedBase = baseUrl?.trim() || 'https://api.openai.com/v1';
        return {
          url: `${resolvedBase.replace(/\/$/, '')}/models`,
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        };
      }
      case 'anthropic':
        return {
          url: 'https://api.anthropic.com/v1/models',
          headers: {
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
          },
        };
      case 'openrouter':
        return {
          url: 'https://openrouter.ai/api/v1/models',
          headers: {
            Authorization: `Bearer ${apiKey}`,
          },
        };
      case 'google':
        return {
          url: `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(
            apiKey,
          )}`,
        };
      case 'github-copilot':
        throw new Error('Copilot validation must use the linked GitHub account path.');
    }
  }

  private async fetchValidationRequest(request: ProviderValidationRequest) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      return await fetch(request.url, {
        method: 'GET',
        headers: request.headers,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeoutId);
    }
  }

  private async readValidationFailure(response: Response) {
    const raw = await response.text().catch(() => '');
    const message = raw.trim();
    if (!message) {
      return `Provider rejected the credentials with status ${response.status}.`;
    }

    return message;
  }

  private toConnectionErrorMessage(error: unknown, fallback: string) {
    if (!(error instanceof Error)) {
      return fallback;
    }

    const message = error.message.trim();
    if (!message) {
      return fallback;
    }

    return `${fallback} ${message}`;
  }
}
