import { BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  MessageArtifactType,
  MessageRole,
  MessageStatus,
} from '@prisma/client';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { fromPrismaLlmProvider } from '../llm-connections/llm-connections.types';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import { AgentGatewayService } from './agent-gateway.service';
import { ChatRepository } from './chat.repository';
import { EphemeralStateService } from './ephemeral-state.service';
import { RuntimeConfigService } from './runtime-config.service';
import {
  AgentStreamEvent,
  CreateConversationInput,
  PersistedConversationMessage,
} from './chat.types';

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly llmConnectionsService: LlmConnectionsService,
    private readonly runtimeConfigService: RuntimeConfigService,
    private readonly agentGatewayService: AgentGatewayService,
    private readonly ephemeralStateService: EphemeralStateService,
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
        this.toConversationMessage(message),
      ),
    };
  }

  async *streamConversationMessage(
    userId: string,
    request: Request,
    conversationId: string,
    content: string,
  ): AsyncGenerator<AgentStreamEvent> {
    const trimmedContent = content.trim();
    if (!trimmedContent) {
      throw new BadRequestException('content is required');
    }

    const conversation = await this.chatRepository.findConversationRuntime(
      userId,
      conversationId,
    );
    if (!conversation) {
      throw new BadRequestException('Conversation could not be found.');
    }

    const userMessage = await this.chatRepository.createMessage({
      conversationId,
      role: MessageRole.USER,
      status: MessageStatus.COMPLETED,
      content: trimmedContent,
    });

    const assistantMessage = await this.chatRepository.createMessage({
      conversationId,
      role: MessageRole.ASSISTANT,
      status: MessageStatus.STREAMING,
      content: '',
    });

    const history = await this.chatRepository.findRecentHistory(conversationId, 24);
    const runtime = await this.runtimeConfigService.resolve(
      userId,
      conversation.databaseSourceId,
      conversation.llmConnectionId,
      request,
    );

    const requestId = this.agentGatewayService.createRequestId();
    const artifactInputs: Array<{
      type: MessageArtifactType;
      payload: Record<string, unknown>;
    }> = [];

    let assistantContent = '';
    let failedMessage: string | null = null;
    let didComplete = false;

    this.ephemeralStateService.start(requestId, conversationId, userId);

    yield {
      type: 'message_started',
      data: {
        messageId: assistantMessage.id,
      },
    };

    try {
      for await (const event of this.agentGatewayService.streamChat({
        requestId,
        conversationId,
        userId,
        messageId: assistantMessage.id,
        message: trimmedContent,
        history: history
          .reverse()
          .map((message) => ({
            role: message.role.toLowerCase() as 'user' | 'assistant' | 'system',
            content: message.content,
          })),
        database: runtime.database,
        llm: runtime.llm,
      })) {
        this.ephemeralStateService.touch(requestId);

        switch (event.type) {
          case 'message_started':
            continue;
          case 'message_delta':
            assistantContent += event.data.delta;
            yield event;
            break;
          case 'sql_generated':
            artifactInputs.push({
              type: MessageArtifactType.SQL,
              payload: event.data,
            });
            yield event;
            break;
          case 'sql_result':
            artifactInputs.push({
              type: MessageArtifactType.TABLE,
              payload: event.data,
            });
            yield event;
            break;
          case 'chart_generated':
            artifactInputs.push({
              type: MessageArtifactType.CHART,
              payload: event.data,
            });
            yield event;
            break;
          case 'artifact':
            artifactInputs.push({
              type: event.data.artifactType,
              payload: event.data.payload,
            });
            yield event;
            break;
          case 'agent_step':
            yield event;
            break;
          case 'message_completed':
            assistantContent = event.data.content || assistantContent;
            didComplete = true;
            yield {
              type: 'message_completed',
              data: {
                messageId: assistantMessage.id,
                content: assistantContent,
              },
            };
            break;
          case 'message_failed':
            failedMessage = event.data.error || 'Agent execution failed.';
            yield {
              type: 'message_failed',
              data: {
                messageId: assistantMessage.id,
                error: failedMessage,
              },
            };
            break;
        }
      }

      if (failedMessage) {
        artifactInputs.push({
          type: MessageArtifactType.ERROR,
          payload: {
            error: failedMessage,
          },
        });
        await this.chatRepository.failMessage(
          assistantMessage.id,
          failedMessage,
          assistantContent,
        );
        return;
      }

      if (!didComplete) {
        yield {
          type: 'message_completed',
          data: {
            messageId: assistantMessage.id,
            content: assistantContent,
          },
        };
      }

      await this.chatRepository.completeMessage(assistantMessage.id, assistantContent);

      for (const artifact of artifactInputs) {
        await this.chatRepository.createArtifact({
          messageId: assistantMessage.id,
          type: artifact.type,
          payload: artifact.payload,
        });
      }
    } catch (error) {
      const message =
        error instanceof Error && error.message.trim()
          ? error.message
          : 'Agent execution failed.';

      await this.chatRepository.failMessage(
        assistantMessage.id,
        message,
        assistantContent,
      );
      await this.chatRepository.createArtifact({
        messageId: assistantMessage.id,
        type: MessageArtifactType.ERROR,
        payload: {
          error: message,
        },
      });

      yield {
        type: 'message_failed',
        data: {
          messageId: assistantMessage.id,
          error: message,
        },
      };
    } finally {
      this.ephemeralStateService.finish(requestId);
      void userMessage;
    }
  }

  private toConversationSummary(
    conversation: Awaited<
      ReturnType<ChatRepository['createConversation']>
    >,
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
