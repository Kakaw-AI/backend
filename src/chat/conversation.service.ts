import { BadRequestException, Injectable } from '@nestjs/common';
import {
  DatabaseSourceStatus,
  LlmConnectionStatus,
  MessageRole,
  MessageStatus,
  Prisma,
} from '@prisma/client';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { fromPrismaLlmProvider } from '../llm-connections/llm-connections.types';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import { ChatRepository } from './chat.repository';
import {
  ConversationDetailsResponse,
  ConversationLlmConnectionResponse,
  ConversationMessageResponse,
  ConversationRuntimeState,
  ConversationSummaryResponse,
  CreateConversationInput,
  PersistedConversationMessage,
  TokenUsage,
  UpdateConversationRuntimeInput,
} from './chat.types';

type ConversationSummaryRecord = Awaited<
  ReturnType<ChatRepository['createConversation']>
>;

@Injectable()
export class ConversationService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly llmConnectionsService: LlmConnectionsService,
  ) {}

  async createConversation(userId: string, input: CreateConversationInput) {
    const [databaseSource, llmConnection] = await Promise.all([
      this.databaseSourcesService.getRuntimeForUser(userId, input.databaseSourceId),
      this.llmConnectionsService.getRuntimeForUser(userId, input.llmConnectionId),
    ]);

    const title =
      input.title?.trim() ||
      `New chat · ${this.resolveDatabaseLabel(databaseSource.provider, databaseSource.sqliteOriginalFilename)} · ${llmConnection.defaultModel}`;

    const conversation = await this.chatRepository.createConversation({
      userId,
      title,
      databaseSourceId: input.databaseSourceId,
      llmConnectionId: input.llmConnectionId,
    });

    return this.toConversationSummary(conversation);
  }

  async listConversations(userId: string) {
    const conversations = await this.chatRepository.findConversationSummaryByUser(userId);
    return conversations.map((conversation) => this.toConversationSummary(conversation));
  }

  async getConversation(
    userId: string,
    conversationId: string,
  ): Promise<ConversationDetailsResponse> {
    const conversation = await this.chatRepository.findConversationForUser(
      userId,
      conversationId,
    );

    if (!conversation) {
      throw new BadRequestException('Conversation could not be found.');
    }

    return {
      ...this.toConversationSummary(conversation),
      messages: conversation.messages.map((message) =>
        this.toConversationMessage(message as unknown as PersistedConversationMessage),
      ),
    };
  }

  async findRuntime(userId: string, conversationId: string) {
    const conversation = await this.chatRepository.findConversationRuntime(
      userId,
      conversationId,
    );

    return conversation ? this.toConversationSummary(conversation) : null;
  }

  async updateConversationRuntime(
    userId: string,
    conversationId: string,
    input: UpdateConversationRuntimeInput,
  ) {
    const conversation = await this.chatRepository.findConversationRuntime(
      userId,
      conversationId,
    );

    if (!conversation) {
      throw new BadRequestException('Conversation could not be found.');
    }

    const llmConnectionId = input.llmConnectionId.trim();
    const llmModelOverride = input.llmModelOverride?.trim() || null;
    let nextLlmModelOverride = llmModelOverride;

    if (!llmConnectionId) {
      throw new BadRequestException('llmConnectionId is required');
    }

    const selectedConnection = await this.llmConnectionsService.getRuntimeForUser(
      userId,
      llmConnectionId,
    );

    if (
      llmModelOverride &&
      llmModelOverride === selectedConnection.defaultModel.trim()
    ) {
      nextLlmModelOverride = null;
    }

    try {
      await this.chatRepository.updateConversationRuntime(conversationId, {
        llmConnectionId: selectedConnection.id,
        llmModelOverride: nextLlmModelOverride,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003'
      ) {
        throw this.buildRuntimeUnavailableException(
          'Selected LLM connection could not be found.',
        );
      }

      throw error;
    }

    return this.getConversation(userId, conversationId);
  }

  async createMessagePair(conversationId: string, content: string) {
    const userMessage = await this.chatRepository.createMessage({
      conversationId,
      role: MessageRole.USER,
      status: MessageStatus.COMPLETED,
      content,
    });

    const assistantMessage = await this.chatRepository.createMessage({
      conversationId,
      role: MessageRole.ASSISTANT,
      status: MessageStatus.STREAMING,
      content: '',
    });

    return { userMessage, assistantMessage };
  }

  async findRecentHistory(conversationId: string, limit: number) {
    return this.chatRepository.findRecentHistory(conversationId, limit);
  }

  async completeMessage(
    messageId: string,
    content: string,
    meta: { tokenUsage: TokenUsage | null; suggestions: string[] },
  ) {
    return this.chatRepository.completeMessage(messageId, content, meta);
  }

  async failMessage(messageId: string, error: string, content: string) {
    return this.chatRepository.failMessage(messageId, error, content);
  }

  private toConversationSummary(
    conversation: ConversationSummaryRecord,
  ): ConversationSummaryResponse {
    const llmModelOverride =
      conversation.llmModelOverride?.trim() || null;

    return {
      id: conversation.id,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      databaseSourceId: conversation.databaseSourceId,
      llmConnectionId: conversation.llmConnectionId,
      llmModelOverride,
      databaseSource: {
        id: conversation.databaseSource.id,
        provider: conversation.databaseSource.provider as 'postgresql' | 'sqlite',
        status: conversation.databaseSource.status,
        sqliteOriginalFilename: conversation.databaseSource.sqliteOriginalFilename,
        lastError: conversation.databaseSource.lastError,
        lastTestedAt: conversation.databaseSource.lastTestedAt?.toISOString() ?? null,
        createdAt: conversation.databaseSource.createdAt.toISOString(),
        updatedAt: conversation.databaseSource.updatedAt.toISOString(),
      },
      llmConnection: this.toConversationLlmConnection(conversation.llmConnection),
      runtime: this.toConversationRuntime(
        conversation.databaseSource,
        conversation.llmConnection,
        llmModelOverride,
      ),
    };
  }

  private static toTokenUsage(raw: unknown): TokenUsage | null {
    if (
      raw != null &&
      typeof raw === 'object' &&
      'inputTokens' in raw &&
      'outputTokens' in raw &&
      'totalTokens' in raw &&
      typeof (raw as Record<string, unknown>).inputTokens === 'number' &&
      typeof (raw as Record<string, unknown>).outputTokens === 'number' &&
      typeof (raw as Record<string, unknown>).totalTokens === 'number'
    ) {
      return raw as TokenUsage;
    }
    return null;
  }

  private toConversationMessage(
    message: PersistedConversationMessage,
  ): ConversationMessageResponse {
    return {
      id: message.id,
      role: message.role.toLowerCase() as 'user' | 'assistant' | 'system',
      status: message.status,
      content: message.content,
      error: message.error,
      tokenUsage: ConversationService.toTokenUsage(message.tokenUsage),
      suggestions: message.suggestions,
      createdAt: message.createdAt.toISOString(),
      updatedAt: message.updatedAt.toISOString(),
      artifacts: message.artifacts.map((artifact) => ({
        id: artifact.id,
        type: artifact.type,
        payload: artifact.payload,
        createdAt: artifact.createdAt.toISOString(),
      })),
    };
  }

  private toConversationLlmConnection(
    llmConnection: ConversationSummaryRecord['llmConnection'],
  ): ConversationLlmConnectionResponse | null {
    if (!llmConnection) {
      return null;
    }

    return {
      id: llmConnection.id,
      provider: fromPrismaLlmProvider(llmConnection.provider),
      status: llmConnection.status,
      displayName: llmConnection.displayName,
      defaultModel: llmConnection.defaultModel,
      apiKeyLastFour: llmConnection.apiKeyLastFour,
      usesLinkedAccount: llmConnection.usesLinkedAccount,
      linkedProviderId: llmConnection.linkedProviderId,
      isActive: llmConnection.isActive,
      lastError: llmConnection.lastError,
      lastTestedAt: llmConnection.lastTestedAt?.toISOString() ?? null,
      createdAt: llmConnection.createdAt.toISOString(),
      updatedAt: llmConnection.updatedAt.toISOString(),
    };
  }

  private toConversationRuntime(
    databaseSource: ConversationSummaryRecord['databaseSource'],
    llmConnection: ConversationSummaryRecord['llmConnection'],
    llmModelOverride: string | null,
  ): ConversationRuntimeState {
    const effectiveModel = llmModelOverride ?? llmConnection?.defaultModel ?? null;

    if (databaseSource.status !== DatabaseSourceStatus.READY) {
      return {
        effectiveModel,
        isMissing: !llmConnection,
        isActive: llmConnection?.isActive ?? false,
        isAvailableForChat: false,
        warning:
          'This conversation’s database source is not ready to chat. Re-sync or replace the database source to continue.',
      };
    }

    if (!llmConnection) {
      return {
        effectiveModel,
        isMissing: true,
        isActive: false,
        isAvailableForChat: false,
        warning:
          'This conversation’s saved LLM connection was deleted. Select another connection to continue.',
      };
    }

    if (!llmConnection.isActive) {
      return {
        effectiveModel,
        isMissing: false,
        isActive: false,
        isAvailableForChat: false,
        warning:
          'This conversation uses a deactivated LLM connection. Reactivate it or switch to another saved connection to continue.',
      };
    }

    if (llmConnection.status !== LlmConnectionStatus.SUCCESS) {
      return {
        effectiveModel,
        isMissing: false,
        isActive: true,
        isAvailableForChat: false,
        warning:
          'This conversation’s LLM connection is not healthy enough to send messages. Fix or switch the connection to continue.',
      };
    }

    return {
      effectiveModel,
      isMissing: false,
      isActive: true,
      isAvailableForChat: true,
      warning: null,
    };
  }

  private buildRuntimeUnavailableException(message: string) {
    return new BadRequestException({
      error: {
        message,
        code: 'LLM_CONNECTION_UNAVAILABLE',
        statusCode: 400,
        retryable: false,
      },
    });
  }

  private resolveDatabaseLabel(provider: string, sqliteOriginalFilename?: string | null) {
    if (provider === 'sqlite') {
      return sqliteOriginalFilename?.trim() || 'SQLite upload';
    }
    if (provider === 'postgresql') {
      return 'PostgreSQL';
    }
    return provider;
  }
}
