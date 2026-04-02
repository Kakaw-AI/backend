import { BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { MessageArtifactType } from '@prisma/client';
import { normalizeApiError } from '../common/errors/error-response';
import { EphemeralStateService } from './ephemeral-state.service';
import { RuntimeConfigService } from './runtime-config.service';
import { ArtifactInput, ArtifactService } from './artifact.service';
import { ConversationService } from './conversation.service';
import { MessageStreamingService } from './message-streaming.service';
import {
  AgentErrorInfo,
  AgentStreamEvent,
  CreateConversationInput,
  TokenUsage,
  UpdateConversationRuntimeInput,
} from './chat.types';

@Injectable()
export class ChatService {
  constructor(
    private readonly conversationService: ConversationService,
    private readonly artifactService: ArtifactService,
    private readonly messageStreamingService: MessageStreamingService,
    private readonly runtimeConfigService: RuntimeConfigService,
    private readonly ephemeralStateService: EphemeralStateService,
  ) {}

  async createConversation(userId: string, input: CreateConversationInput) {
    return this.conversationService.createConversation(userId, input);
  }

  async listConversations(userId: string) {
    return this.conversationService.listConversations(userId);
  }

  async getConversation(userId: string, conversationId: string) {
    return this.conversationService.getConversation(userId, conversationId);
  }

  async updateConversationRuntime(
    userId: string,
    conversationId: string,
    input: UpdateConversationRuntimeInput,
  ) {
    return this.conversationService.updateConversationRuntime(
      userId,
      conversationId,
      input,
    );
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

    const conversation = await this.conversationService.findRuntime(userId, conversationId);
    if (!conversation) {
      throw new BadRequestException('Conversation could not be found.');
    }

    if (!conversation.runtime.isAvailableForChat) {
      throw new BadRequestException({
        error: {
          message:
            conversation.runtime.warning ?? 'Selected LLM runtime is unavailable.',
          code: 'LLM_CONNECTION_UNAVAILABLE',
          statusCode: 400,
          retryable: false,
        },
      });
    }

    if (!conversation.llmConnectionId) {
      throw new BadRequestException({
        error: {
          message: 'Selected LLM runtime is unavailable.',
          code: 'LLM_CONNECTION_UNAVAILABLE',
          statusCode: 400,
          retryable: false,
        },
      });
    }

    const runtime = await this.runtimeConfigService.resolve(
      userId,
      conversation.databaseSourceId,
      conversation.llmConnectionId,
      conversation.llmModelOverride,
      request,
    );

    const { assistantMessage } = await this.conversationService.createMessagePair(
      conversationId,
      trimmedContent,
    );

    const history = await this.conversationService.findRecentHistory(conversationId, 24);

    const requestId = this.messageStreamingService.createRequestId();
    const artifactBuffer: ArtifactInput[] = [];

    let assistantContent = '';
    let failedMessage: string | null = null;
    let failedErrorInfo: AgentErrorInfo | null = null;
    let didComplete = false;
    let tokenUsage: TokenUsage | null = null;
    let suggestions: string[] = [];

    this.ephemeralStateService.start(requestId, conversationId, userId);

    yield {
      type: 'message_started',
      data: { messageId: assistantMessage.id },
    };

    try {
      for await (const event of this.messageStreamingService.streamFromAgent({
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
        this.artifactService.collectFromEvent(event, artifactBuffer);

        switch (event.type) {
          case 'message_started':
            continue;
          case 'message_delta':
            assistantContent += event.data.delta;
            yield event;
            break;
          case 'message_completed':
            assistantContent = event.data.content || assistantContent;
            tokenUsage = event.data.tokenUsage ?? null;
            didComplete = true;
            yield {
              type: 'message_completed',
              data: { messageId: assistantMessage.id, content: assistantContent, tokenUsage: tokenUsage ?? undefined },
            };
            break;
          case 'message_failed':
            failedMessage = event.data.error || 'Agent execution failed.';
            failedErrorInfo = event.data.errorInfo ?? null;
            yield {
              type: 'message_failed',
              data: {
                messageId: assistantMessage.id,
                error: failedMessage,
                ...(failedErrorInfo ? { errorInfo: failedErrorInfo } : {}),
              },
            };
            break;
          case 'suggestions_generated':
            suggestions = Array.isArray(event.data.suggestions) ? event.data.suggestions : [];
            yield {
              type: 'suggestions_generated',
              data: { messageId: assistantMessage.id, suggestions },
            };
            break;
          default:
            yield event;
        }
      }

      if (failedMessage) {
        artifactBuffer.push({
          type: MessageArtifactType.ERROR,
          payload: {
            error: failedMessage,
            ...(failedErrorInfo ? { errorInfo: failedErrorInfo } : {}),
          },
        });
        await this.conversationService.failMessage(
          assistantMessage.id,
          failedMessage,
          assistantContent,
        );
        await this.artifactService.saveArtifacts(assistantMessage.id, artifactBuffer);
        return;
      }

      if (!didComplete) {
        yield {
          type: 'message_completed',
          data: { messageId: assistantMessage.id, content: assistantContent },
        };
      }

      await this.conversationService.completeMessage(assistantMessage.id, assistantContent, {
        tokenUsage,
        suggestions,
      });
      await this.artifactService.saveArtifacts(assistantMessage.id, artifactBuffer);
    } catch (error) {
      const normalizedError = normalizeApiError(error, 'Agent execution failed.');
      const message = normalizedError.message;

      await this.conversationService.failMessage(
        assistantMessage.id,
        message,
        assistantContent,
      );
      await this.artifactService.saveArtifacts(assistantMessage.id, [
        ...artifactBuffer,
        {
          type: MessageArtifactType.ERROR,
          payload: { error: message, errorInfo: normalizedError },
        },
      ]);

      yield {
        type: 'message_failed',
        data: {
          messageId: assistantMessage.id,
          error: message,
          errorInfo: normalizedError,
        },
      };
    } finally {
      this.ephemeralStateService.finish(requestId);
    }
  }
}
