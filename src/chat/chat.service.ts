import { BadRequestException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { MessageArtifactType, MessageStatus } from '@prisma/client';
import { normalizeApiError } from '../common/errors/error-response';
import { ChatRepository } from './chat.repository';
import { EphemeralStateService } from './ephemeral-state.service';
import { RuntimeConfigService } from './runtime-config.service';
import { ArtifactInput, ArtifactService } from './artifact.service';
import { ConversationService } from './conversation.service';
import { MessageStreamingService } from './message-streaming.service';
import {
  AgentErrorInfo,
  AgentStreamEvent,
  CreateConversationInput,
  PersistedAgentTraceMetadata,
  TokenUsage,
  TraceAnalyticsOutcome,
  UpdateConversationRuntimeInput,
  VisualizationOutcome,
  buildRuntimeUnavailableException,
  toRuntimeUnavailableException,
} from './chat.types';

@Injectable()
export class ChatService {
  constructor(
    private readonly chatRepository: ChatRepository,
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
      throw buildRuntimeUnavailableException(
        conversation.runtime.warning ?? 'Selected LLM runtime is unavailable.',
      );
    }

    if (!conversation.llmConnectionId) {
      throw buildRuntimeUnavailableException(
        'Selected LLM runtime is unavailable.',
      );
    }

    let runtime: Awaited<ReturnType<RuntimeConfigService['resolve']>>;
    try {
      runtime = await this.runtimeConfigService.resolve(
        userId,
        conversation.databaseSourceId,
        conversation.llmConnectionId,
        conversation.llmModelOverride,
        request,
      );
    } catch (error) {
      const runtimeUnavailable = toRuntimeUnavailableException(
        error,
        'Selected LLM runtime is unavailable.',
      );

      if (runtimeUnavailable) {
        throw runtimeUnavailable;
      }

      throw error;
    }

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
    let traceSteps: Array<{ text: string; at: string }> = [];
    let traceToolCalls: Array<Record<string, unknown>> = [];
    let traceRepairHistory: Array<Record<string, unknown>> = [];
    let traceChartSpec: Record<string, unknown> | null = null;
    let traceVisualizationOutcome: VisualizationOutcome | null = null;
    let traceAnalyticsOutcome: TraceAnalyticsOutcome | null = null;
    let traceRowCount: number | null = null;
    let traceCacheKey: string | null = null;
    let traceCacheHit = false;

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
        knowledge: runtime.knowledge,
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
              data: {
                messageId: assistantMessage.id,
                content: assistantContent,
                tokenUsage: tokenUsage ?? undefined,
                visualizationOutcome: event.data.visualizationOutcome ?? undefined,
                analyticsOutcome: event.data.analyticsOutcome ?? undefined,
              },
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
          case 'agent_trace':
            traceSteps = Array.isArray(event.data.steps) ? event.data.steps : [];
            traceToolCalls = Array.isArray(event.data.toolCalls)
              ? event.data.toolCalls
              : [];
            traceRepairHistory = Array.isArray(event.data.repairHistory)
              ? event.data.repairHistory
              : [];
            traceChartSpec =
              event.data.chartSpec && typeof event.data.chartSpec === 'object'
                ? (event.data.chartSpec as Record<string, unknown>)
                : null;
            traceVisualizationOutcome =
              event.data.visualizationOutcome &&
              typeof event.data.visualizationOutcome === 'object'
                ? (event.data.visualizationOutcome as VisualizationOutcome)
                : null;
            traceAnalyticsOutcome =
              typeof event.data.analyticsOutcome === 'string'
                ? (event.data.analyticsOutcome as TraceAnalyticsOutcome)
                : null;
            traceRowCount =
              typeof event.data.rowCount === 'number' ? event.data.rowCount : null;
            traceCacheKey =
              typeof event.data.cacheKey === 'string' ? event.data.cacheKey : null;
            traceCacheHit = event.data.cacheHit === true;
            break;
          default:
            yield event;
        }
      }

      if (failedMessage) {
        const traceError = this.resolveTraceErrorMessage(failedMessage, failedErrorInfo);
        await this.conversationService.failMessage(
          assistantMessage.id,
          failedMessage,
          assistantContent,
        );
        await this.persistAgentRunTrace({
          requestId,
          status: MessageStatus.FAILED,
          effectiveModel: runtime.llm.model,
          question: trimmedContent,
          response: assistantContent,
          error: traceError,
          tokenUsage,
          steps: traceSteps,
          toolCalls: traceToolCalls,
          repairHistory: traceRepairHistory,
          traceMetadata: this.buildTraceMetadata(
            traceChartSpec,
            traceVisualizationOutcome,
            traceAnalyticsOutcome,
            traceRowCount,
          ),
          cacheKey: traceCacheKey,
          cacheHit: traceCacheHit,
          suggestions,
          userId,
          databaseSourceId: conversation.databaseSourceId,
          conversationId,
          llmConnectionId: conversation.llmConnectionId,
          messageId: assistantMessage.id,
        });
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
      await this.persistAgentRunTrace({
        requestId,
        status: MessageStatus.COMPLETED,
        effectiveModel: runtime.llm.model,
        question: trimmedContent,
        response: assistantContent,
        tokenUsage,
        steps: traceSteps,
        toolCalls: traceToolCalls,
        repairHistory: traceRepairHistory,
        traceMetadata: this.buildTraceMetadata(
          traceChartSpec,
          traceVisualizationOutcome,
          traceAnalyticsOutcome,
          traceRowCount,
        ),
        cacheKey: traceCacheKey,
        cacheHit: traceCacheHit,
        suggestions,
        userId,
        databaseSourceId: conversation.databaseSourceId,
        conversationId,
        llmConnectionId: conversation.llmConnectionId,
        messageId: assistantMessage.id,
      });
      await this.artifactService.saveArtifacts(assistantMessage.id, artifactBuffer);
    } catch (error) {
      const normalizedError = normalizeApiError(error, 'Agent execution failed.');
      const message = normalizedError.message;
      const publicMessage = this.resolvePublicErrorMessage(message, normalizedError);
      const traceError = this.resolveTraceErrorMessage(message, normalizedError);

      await this.conversationService.failMessage(
        assistantMessage.id,
        publicMessage,
        assistantContent,
      );
      await this.artifactService.saveArtifacts(assistantMessage.id, artifactBuffer);
      await this.persistAgentRunTrace({
        requestId,
        status: MessageStatus.FAILED,
        effectiveModel: runtime.llm.model,
        question: trimmedContent,
        response: assistantContent,
        error: traceError,
        tokenUsage,
        steps: traceSteps,
        toolCalls: traceToolCalls,
        repairHistory: traceRepairHistory,
        traceMetadata: this.buildTraceMetadata(
          traceChartSpec,
          traceVisualizationOutcome,
          traceAnalyticsOutcome,
          traceRowCount,
        ),
        cacheKey: traceCacheKey,
        cacheHit: traceCacheHit,
        suggestions,
        userId,
        databaseSourceId: conversation.databaseSourceId,
        conversationId,
        llmConnectionId: conversation.llmConnectionId,
        messageId: assistantMessage.id,
      });

      yield {
        type: 'message_failed',
        data: {
          messageId: assistantMessage.id,
          error: publicMessage,
          errorInfo: {
            ...normalizedError,
            message: publicMessage,
            ...(publicMessage === message
              ? {}
              : { metadata: { raw: message } }),
          },
        },
      };
    } finally {
      this.ephemeralStateService.finish(requestId);
    }
  }

  async submitTraceFeedback(
    traceId: string,
    userId: string,
    feedback: 'positive' | 'negative',
  ): Promise<void> {
    await this.chatRepository.submitFeedback(traceId, userId, feedback);
  }

  private persistAgentRunTrace(
    input: Parameters<ChatRepository['createAgentRunTrace']>[0],
  ) {
    return this.chatRepository.createAgentRunTrace(input);
  }

  private resolvePublicErrorMessage(
    fallbackMessage: string,
    errorInfo: { code?: string; statusCode?: number; provider?: string; metadata?: { raw?: string } },
  ) {
    if (
      (errorInfo.code?.startsWith('AGENT_') || (errorInfo.statusCode ?? 0) >= 500) &&
      !errorInfo.provider
    ) {
      return 'Failed';
    }

    return fallbackMessage;
  }

  private resolveTraceErrorMessage(
    fallbackMessage: string,
    errorInfo: { metadata?: { raw?: string } } | null,
  ) {
    return errorInfo?.metadata?.raw?.trim() || fallbackMessage;
  }

  private buildTraceMetadata(
    chartSpec: Record<string, unknown> | null,
    visualizationOutcome: VisualizationOutcome | null,
    analyticsOutcome: TraceAnalyticsOutcome | null,
    rowCount: number | null,
  ): PersistedAgentTraceMetadata | null {
    if (!chartSpec && !visualizationOutcome && !analyticsOutcome && rowCount == null) {
      return null;
    }

    return {
      chartSpec,
      visualizationOutcome,
      analyticsOutcome,
      rowCount,
    };
  }
}
