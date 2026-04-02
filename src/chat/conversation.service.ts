import { BadRequestException, Injectable } from '@nestjs/common';
import { MessageRole, MessageStatus } from '@prisma/client';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { fromPrismaLlmProvider } from '../llm-connections/llm-connections.types';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import { ChatRepository } from './chat.repository';
import { CreateConversationInput, PersistedConversationMessage, TokenUsage } from './chat.types';

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

  async getConversation(userId: string, conversationId: string) {
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
    return this.chatRepository.findConversationRuntime(userId, conversationId);
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
    conversation: Awaited<ReturnType<ChatRepository['createConversation']>>,
  ) {
    return {
      id: conversation.id,
      title: conversation.title,
      lastMessageAt: conversation.lastMessageAt?.toISOString() ?? null,
      createdAt: conversation.createdAt.toISOString(),
      updatedAt: conversation.updatedAt.toISOString(),
      databaseSourceId: conversation.databaseSourceId,
      llmConnectionId: conversation.llmConnectionId,
      databaseSource: {
        id: conversation.databaseSource.id,
        provider: conversation.databaseSource.provider,
        status: conversation.databaseSource.status,
        sqliteOriginalFilename: conversation.databaseSource.sqliteOriginalFilename,
        lastError: conversation.databaseSource.lastError,
        lastTestedAt: conversation.databaseSource.lastTestedAt?.toISOString() ?? null,
        createdAt: conversation.databaseSource.createdAt.toISOString(),
        updatedAt: conversation.databaseSource.updatedAt.toISOString(),
      },
      llmConnection: {
        id: conversation.llmConnection.id,
        provider: fromPrismaLlmProvider(conversation.llmConnection.provider),
        status: conversation.llmConnection.status,
        displayName: conversation.llmConnection.displayName,
        defaultModel: conversation.llmConnection.defaultModel,
        apiKeyLastFour: conversation.llmConnection.apiKeyLastFour,
        usesLinkedAccount: conversation.llmConnection.usesLinkedAccount,
        linkedProviderId: conversation.llmConnection.linkedProviderId,
        lastError: conversation.llmConnection.lastError,
        lastTestedAt: conversation.llmConnection.lastTestedAt?.toISOString() ?? null,
        createdAt: conversation.llmConnection.createdAt.toISOString(),
        updatedAt: conversation.llmConnection.updatedAt.toISOString(),
      },
    };
  }

  private toConversationMessage(message: PersistedConversationMessage) {
    return {
      id: message.id,
      role: message.role.toLowerCase(),
      status: message.status,
      content: message.content,
      error: message.error,
      tokenUsage: message.tokenUsage,
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
