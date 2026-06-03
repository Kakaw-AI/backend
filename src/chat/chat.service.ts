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

    const conversation = await this.loadConversationForChat(userId, conversationId);
    const runtime = await this.resolveRuntimeConfig(userId, conversation, request);

    const { assistantMessage } = await this.conversationService.createMessagePair(
      conversationId,
      trimmedContent,
    );
    const history = await this.conversationService.findRecentHistory(conversationId, 24);

    yield* this.runAgentStream({
      userId,
      conversationId,
      conversation,
      runtime,
      assistantMessageId: assistantMessage.id,
      question: trimmedContent,
      history,
    });
  }

  async *retryMessage(
    userId: string,
    request: Request,
    conversationId: string,
    messageId: string,
  ): AsyncGenerator<AgentStreamEvent> {
    const conversation = await this.loadConversationForChat(userId, conversationId);
    const target = await this.conversationService.prepareMessageRetry(
      conversationId,
      messageId,
    );
    const runtime = await this.resolveRuntimeConfig(userId, conversation, request);

    // Reset the failed assistant message in place (clears error/content/artifacts
    // and flips it back to STREAMING) so the retry reuses the same bubble and the
    // original user message — no duplicate turn is created.
    await this.conversationService.resetMessageForRetry(target.assistantMessageId);
    const history = await this.conversationService.findRecentHistory(conversationId, 24);

    yield* this.runAgentStream({
      userId,
      conversationId,
      conversation,
      runtime,
      assistantMessageId: target.assistantMessageId,
      question: target.question,
      history,
    });
  }

  private async loadConversationForChat(userId: string, conversationId: string) {
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

    return conversation;
  }

  private async resolveRuntimeConfig(
    userId: string,
    conversation: NonNullable<
      Awaited<ReturnType<ConversationService['findRuntime']>>
    >,
    request: Request,
  ): Promise<Awaited<ReturnType<RuntimeConfigService['resolve']>>> {
    if (!conversation.llmConnectionId) {
      throw buildRuntimeUnavailableException(
        'Selected LLM runtime is unavailable.',
      );
    }

    try {
      return await this.runtimeConfigService.resolve(
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
  }

  private async *runAgentStream(params: {
    userId: string;
    conversationId: string;
    conversation: NonNullable<
      Awaited<ReturnType<ConversationService['findRuntime']>>
    >;
    runtime: Awaited<ReturnType<RuntimeConfigService['resolve']>>;
    assistantMessageId: string;
    question: string;
    history: Awaited<ReturnType<ConversationService['findRecentHistory']>>;
  }): AsyncGenerator<AgentStreamEvent> {
    const {
      userId,
      conversationId,
      conversation,
      runtime,
      assistantMessageId,
      question: trimmedContent,
      history,
    } = params;

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
    // Tracks whether the message reached a persisted terminal state. If the
    // client disconnects mid-stream (lost connection / tab switch), the
    // generator is returned early and only `finally` runs — we use this to mark
    // the message FAILED instead of leaving it stuck STREAMING forever.
    let settled = false;

    this.ephemeralStateService.start(requestId, conversationId, userId);

    yield {
      type: 'message_started',
      data: { messageId: assistantMessageId },
    };

    try {
      for await (const event of this.messageStreamingService.streamFromAgent({
        requestId,
        conversationId,
        userId,
        messageId: assistantMessageId,
        message: trimmedContent,
        history: history
          .reverse()
          .map((message) => ({
            role: message.role.toLowerCase() as 'user' | 'assistant' | 'system',
            content: message.content,
            rows: (message.artifacts?.[0]?.payload as Record<string, unknown> | undefined)?.['rows'] as Array<Record<string, unknown>> | undefined,
            columns: (message.artifacts?.[0]?.payload as Record<string, unknown> | undefined)?.['columns'] as string[] | undefined,
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
                messageId: assistantMessageId,
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
                messageId: assistantMessageId,
                error: failedMessage,
                ...(failedErrorInfo ? { errorInfo: failedErrorInfo } : {}),
              },
            };
            break;
          case 'suggestions_generated':
            suggestions = Array.isArray(event.data.suggestions) ? event.data.suggestions : [];
            yield {
              type: 'suggestions_generated',
              data: { messageId: assistantMessageId, suggestions },
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
          assistantMessageId,
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
          messageId: assistantMessageId,
        });
        await this.artifactService.saveArtifacts(assistantMessageId, artifactBuffer);
        settled = true;
        return;
      }

      if (!didComplete) {
        yield {
          type: 'message_completed',
          data: { messageId: assistantMessageId, content: assistantContent },
        };
      }

      await this.conversationService.completeMessage(assistantMessageId, assistantContent, {
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
        messageId: assistantMessageId,
      });
      await this.artifactService.saveArtifacts(assistantMessageId, artifactBuffer);
      settled = true;
    } catch (error) {
      const normalizedError = normalizeApiError(error, 'Agent execution failed.');
      const message = normalizedError.message;
      const publicMessage = this.resolvePublicErrorMessage(message, normalizedError);
      const traceError = this.resolveTraceErrorMessage(message, normalizedError);

      await this.conversationService.failMessage(
        assistantMessageId,
        publicMessage,
        assistantContent,
      );
      await this.artifactService.saveArtifacts(assistantMessageId, artifactBuffer);
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
        messageId: assistantMessageId,
      });

      settled = true;
      yield {
        type: 'message_failed',
        data: {
          messageId: assistantMessageId,
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
      if (!settled) {
        // The consumer stopped reading before a terminal event (client
        // disconnect / tab switch). Persist a terminal FAILED state so the
        // message is retryable instead of stuck STREAMING. Best-effort: the
        // socket is already gone, so we cannot yield to the client here.
        try {
          await this.conversationService.failMessage(
            assistantMessageId,
            'The response was interrupted before it finished. Please retry.',
            assistantContent,
          );
          await this.artifactService.saveArtifacts(
            assistantMessageId,
            artifactBuffer,
          );
        } catch {
          // Swallow — nothing more we can do for an abandoned request.
        }
      }
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
