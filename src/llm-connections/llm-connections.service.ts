import { BadRequestException, Injectable } from '@nestjs/common';
import { LlmConnectionStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { LlmConnectionsRepository } from './llm-connections.repository';
import { SecretsService } from './secrets.service';
import {
  CreateLlmConnectionInput,
  LlmConnectionAction,
  SupportedLlmProvider,
  buildDefaultDisplayName,
  getEffectiveRuntimeBaseUrl,
  normalizeBaseUrl,
  providerTakesOptionalApiKey,
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
    private readonly prisma: PrismaService,
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

    if (!connection.isActive) {
      throw new BadRequestException(
        'Selected LLM connection must be active before starting a chat.',
      );
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
    input: CreateLlmConnectionInput,
  ) {
    const defaultModel = this.getDefaultModel(input);
    const displayName = input.displayName?.trim()
      ? input.displayName.trim()
      : buildDefaultDisplayName(input.provider, defaultModel);
    const takesOptionalApiKey = providerTakesOptionalApiKey(input.provider);
    const apiKey = input.apiKey?.trim();
    const normalizedBaseUrl = normalizeBaseUrl(input.baseUrl);
    const effectiveRuntimeBaseUrl = getEffectiveRuntimeBaseUrl(
      input.provider,
      input.baseUrl,
    );

    if (!takesOptionalApiKey && !apiKey) {
      throw new BadRequestException('apiKey is required for this provider.');
    }

    const apiKeyLastFour = apiKey ? apiKey.slice(-4) : undefined;
    const encryptedApiKey = apiKey ? this.secretsService.encrypt(apiKey) : undefined;
    const pendingConnection = await this.createPendingConnectionWithDuplicateGuard({
      userId,
      provider: input.provider,
      displayName,
      defaultModel,
      encryptedApiKey,
      apiKeyLastFour,
      baseUrl: normalizedBaseUrl ?? undefined,
      effectiveRuntimeBaseUrl,
      rawApiKey: apiKey,
    });

    try {
      if (apiKey) {
        await this.validateApiKeyProvider(input.provider, apiKey, normalizedBaseUrl ?? undefined);
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

  private async createPendingConnectionWithDuplicateGuard(input: {
    userId: string;
    provider: SupportedLlmProvider;
    displayName: string;
    defaultModel: string;
    encryptedApiKey?: string;
    apiKeyLastFour?: string;
    baseUrl?: string;
    effectiveRuntimeBaseUrl: string | null;
    rawApiKey?: string;
  }) {
    const provider = toPrismaLlmProvider(input.provider);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          async (tx) => {
            const duplicateCandidates =
              await this.llmConnectionsRepository.findDuplicateCandidatesForUser(
                input.userId,
                provider,
                tx,
              );

            const exactDuplicate = duplicateCandidates.find((candidate) =>
              this.isExactDuplicateCandidate(candidate, input),
            );

            if (exactDuplicate) {
              throw new BadRequestException('This LLM connection already exists.');
            }

            return this.llmConnectionsRepository.createPending(
              {
                userId: input.userId,
                provider: input.provider,
                displayName: input.displayName,
                defaultModel: input.defaultModel,
                encryptedApiKey: input.encryptedApiKey,
                apiKeyLastFour: input.apiKeyLastFour,
                usesLinkedAccount: false,
                baseUrl: input.baseUrl,
              },
              tx,
            );
          },
          {
            isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
          },
        );
      } catch (error) {
        if (error instanceof BadRequestException) {
          throw error;
        }

        if (!this.isRetryableTransactionError(error) || attempt === 2) {
          throw error;
        }
      }
    }

    throw new Error('Failed to create the LLM connection.');
  }

  private isExactDuplicateCandidate(
    candidate: {
      displayName: string;
      defaultModel: string;
      encryptedApiKey: string | null;
      linkedProviderId: string | null;
      baseUrl: string | null;
    },
    input: {
      provider: SupportedLlmProvider;
      defaultModel: string;
      effectiveRuntimeBaseUrl: string | null;
      rawApiKey?: string;
    },
  ) {
    const sameModel = candidate.defaultModel.trim() === input.defaultModel;
    const sameBaseUrl =
      getEffectiveRuntimeBaseUrl(input.provider, candidate.baseUrl) ===
      input.effectiveRuntimeBaseUrl;

    if (!sameModel || !sameBaseUrl) {
      return false;
    }

    const candidateApiKey = candidate.encryptedApiKey
      ? this.secretsService.decrypt(candidate.encryptedApiKey)
      : null;

    return candidateApiKey === (input.rawApiKey ?? null);
  }

  private isRetryableTransactionError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2034'
    );
  }

  private async getByIdForUser(userId: string, id: string) {
    const connection = await this.llmConnectionsRepository.findByUserAndId(
      userId,
      id,
    );

    if (!connection) {
      throw new BadRequestException('Saved connection could not be loaded.');
    }

    return connection;
  }

  async activateForUser(userId: string, id: string) {
    return this.updateLifecycleForUser(userId, id, 'activate');
  }

  async deactivateForUser(userId: string, id: string) {
    return this.updateLifecycleForUser(userId, id, 'deactivate');
  }

  async deleteForUser(userId: string, id: string) {
    await this.getByIdForUser(userId, id);
    await this.llmConnectionsRepository.deleteForUser(id, userId);
    return { id };
  }

  private getDefaultModel(input: CreateLlmConnectionInput) {
    const defaultModel = input.defaultModel?.trim();
    if (!defaultModel) {
      throw new BadRequestException('defaultModel is required.');
    }

    return defaultModel;
  }

  private async updateLifecycleForUser(
    userId: string,
    id: string,
    action: Exclude<LlmConnectionAction, 'delete'>,
  ) {
    await this.getByIdForUser(userId, id);

    if (action === 'activate') {
      await this.llmConnectionsRepository.activate(id);
    } else {
      await this.llmConnectionsRepository.deactivate(id);
    }

    return this.getByIdForUser(userId, id);
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
      case 'openai':
      case 'ollama':
      case 'lm-studio': {
        const resolvedBase = getEffectiveRuntimeBaseUrl(provider, baseUrl) || 'https://api.openai.com/v1';
        return {
          url: `${resolvedBase.replace(/\/$/, '')}/models`,
          headers: apiKey ? {
            Authorization: `Bearer ${apiKey}`,
          } : undefined,
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
