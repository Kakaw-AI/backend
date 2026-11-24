import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser } from '../auth/better-auth.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/guards/rate-limit.guard';
import { ChatService } from './chat.service';
import { EphemeralStateService } from './ephemeral-state.service';
import {
  AgentStreamEvent,
  CreateConversationBody,
  CreateConversationInput,
  SendConversationMessageBody,
  UpdateConversationRuntimeBody,
  UpdateConversationRuntimeInput,
} from './chat.types';

const KEEP_ALIVE_MS = 20_000;

@Controller('chat')
export class ChatController {
  private readonly logger = new Logger(ChatController.name);

  constructor(
    private readonly chatService: ChatService,
    private readonly ephemeralState: EphemeralStateService,
  ) {}

  @Get('conversations')
  listConversations(@CurrentUser() user: AuthUser) {
    return this.chatService.listConversations(user.id);
  }

  @Get('conversations/:id')
  getConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.chatService.getConversation(user.id, id);
  }

  @Post('conversations')
  createConversation(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateConversationBody,
  ) {
    return this.chatService.createConversation(user.id, this.toCreateConversationInput(body));
  }

  @Delete('conversations/:id')
  @HttpCode(204)
  async deleteConversation(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    await this.chatService.deleteConversation(
      user.id,
      this.toConversationId(id),
    );
  }

  @Post('conversations/:id/runtime')
  updateConversationRuntime(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: UpdateConversationRuntimeBody,
  ) {
    return this.chatService.updateConversationRuntime(
      user.id,
      this.toConversationId(id),
      this.toUpdateConversationRuntimeInput(body),
    );
  }

  // Each call is a full agent run: several LLM calls and queries against the
  // user's database.
  @RateLimit(20)
  @Post('conversations/:id/messages/stream')
  async streamConversationMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Body() body: SendConversationMessageBody,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const content =
      typeof body.content === 'string' ? body.content.trim() : '';
    if (!content) {
      throw new BadRequestException('content is required');
    }

    const conversationId = this.toConversationId(id);
    const stream = this.chatService.streamConversationMessage(
      user.id,
      request,
      conversationId,
      content,
      body.thinking !== false,
    );

    await this.pipeStream(user.id, conversationId, stream, response);
  }

  @RateLimit(20)
  @Post('conversations/:id/messages/:messageId/retry')
  async retryConversationMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const conversationId = this.toConversationId(id);
    const stream = this.chatService.retryMessage(
      user.id,
      request,
      conversationId,
      this.toMessageId(messageId),
    );

    await this.pipeStream(user.id, conversationId, stream, response);
  }

  /**
   * Re-attaches to a reply still being written: every event so far, then the
   * live ones, as the same NDJSON stream. 204 when this process is not writing
   * it (finished, or run elsewhere); the stored message is then the truth.
   */
  @Get('conversations/:id/messages/:messageId/stream')
  async followConversationMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Res() response: Response,
  ) {
    const following = await this.followRun(
      this.toMessageId(messageId),
      user.id,
      this.toConversationId(id),
      response,
    );
    if (!following) response.status(204).end();
  }

  @Post('conversations/:id/messages/:messageId/stop')
  stopConversationMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chatService.stopMessage(
      user.id,
      this.toConversationId(id),
      this.toMessageId(messageId),
    );
  }

  private async pipeStream(
    userId: string,
    conversationId: string,
    stream: AsyncGenerator<AgentStreamEvent>,
    response: Response,
  ) {
    // The first event is awaited before any header is written on purpose: setup
    // failures (unknown conversation, missing LLM credentials, unauthorized)
    // throw out of the generator here and Nest's exception filter can still map
    // them to a real HTTP status. Once headers are flushed that is no longer
    // possible. Keeping setup off the critical path is handled upstream, by
    // caching the schema catalog and parallelizing the runtime resolution.
    const firstEvent = await stream.next();
    if (firstEvent.done || firstEvent.value.type !== 'message_started') {
      this.startNdjson(response);
      if (!firstEvent.done) response.write(`${JSON.stringify(firstEvent.value)}
`);
      response.end();
      return;
    }

    // The reply runs to the end on its own; this request is just its first
    // reader. Closing the tab or losing the connection no longer cuts it, and
    // the browser can re-attach with followConversationMessage.
    const messageId = firstEvent.value.data.messageId;
    this.ephemeralState.openRun(messageId, userId, conversationId);
    this.ephemeralState.pushRun(messageId, firstEvent.value);
    void this.drive(messageId, stream);

    await this.followRun(messageId, userId, conversationId, response);
  }

  /** Pulls a reply to its end whether or not anyone is reading it. */
  private async drive(messageId: string, stream: AsyncGenerator<AgentStreamEvent>) {
    try {
      for await (const event of stream) {
        this.ephemeralState.pushRun(messageId, event);
      }
    } catch (error) {
      this.logger.warn(
        `Reply ${messageId} ended with an error: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.ephemeralState.closeRun(messageId);
    }
  }

  /** Writes a running reply to the response. False when no such reply is running here. */
  private followRun(
    messageId: string,
    userId: string,
    conversationId: string,
    response: Response,
  ) {
    return new Promise<boolean>((resolve) => {
      // A model call can run past Cloudflare's 100 s idle limit with nothing
      // to send; a blank line keeps the connection open (readers skip it).
      const keepAlive = setInterval(() => {
        if (response.headersSent) response.write('\n');
      }, KEEP_ALIVE_MS);
      const unsubscribe = this.ephemeralState.followRun(
        messageId,
        userId,
        conversationId,
        (event) => {
          if (!response.headersSent) this.startNdjson(response);
          if (event === null) {
            clearInterval(keepAlive);
            response.end();
            resolve(true);
            return;
          }
          response.write(`${JSON.stringify(event)}
`);
        },
      );
      if (!unsubscribe) {
        clearInterval(keepAlive);
        resolve(false);
        return;
      }
      response.on('close', () => {
        clearInterval(keepAlive);
        unsubscribe();
        resolve(true);
      });
    });
  }

  private startNdjson(response: Response) {
    response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');
    response.flushHeaders();
  }

  @Patch('conversations/:conversationId/traces/:traceId/feedback')
  submitTraceFeedback(
    @CurrentUser() user: AuthUser,
    @Param('traceId') traceId: string,
    @Body() body: { feedback: unknown },
  ) {
    const feedback = body.feedback;
    if (feedback !== 'positive' && feedback !== 'negative') {
      throw new BadRequestException('feedback must be "positive" or "negative"');
    }

    return this.chatService.submitTraceFeedback(traceId.trim(), user.id, feedback);
  }

  private toCreateConversationInput(
    body: CreateConversationBody,
  ): CreateConversationInput {
    const databaseSourceId =
      typeof body.databaseSourceId === 'string'
        ? body.databaseSourceId.trim()
        : '';
    const llmConnectionId =
      typeof body.llmConnectionId === 'string'
        ? body.llmConnectionId.trim()
        : '';

    if (!databaseSourceId) {
      throw new BadRequestException('databaseSourceId is required');
    }

    if (!llmConnectionId) {
      throw new BadRequestException('llmConnectionId is required');
    }

    return {
      databaseSourceId,
      llmConnectionId,
      title: typeof body.title === 'string' ? body.title.trim() : undefined,
    };
  }

  private toUpdateConversationRuntimeInput(
    body: UpdateConversationRuntimeBody,
  ): UpdateConversationRuntimeInput {
    const llmConnectionId =
      typeof body.llmConnectionId === 'string'
        ? body.llmConnectionId.trim()
        : '';
    const llmModelOverride =
      typeof body.llmModelOverride === 'string'
        ? body.llmModelOverride.trim() || null
        : body.llmModelOverride == null
          ? null
          : undefined;

    if (llmConnectionId === '') {
      throw new BadRequestException('llmConnectionId is required');
    }

    if (llmModelOverride === undefined) {
      throw new BadRequestException('llmModelOverride must be a string or null');
    }

    return {
      llmConnectionId,
      llmModelOverride,
    };
  }

  private toConversationId(id: string) {
    const conversationId = id.trim();
    if (!conversationId) {
      throw new BadRequestException('id is required');
    }

    return conversationId;
  }

  private toMessageId(messageId: string) {
    const trimmed = messageId.trim();
    if (!trimmed) {
      throw new BadRequestException('messageId is required');
    }

    return trimmed;
  }
}
