import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthUser } from '../auth/better-auth.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ChatService } from './chat.service';
import {
  CreateConversationBody,
  CreateConversationInput,
  SendConversationMessageBody,
  UpdateConversationRuntimeBody,
  UpdateConversationRuntimeInput,
} from './chat.types';

@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

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

    const stream = this.chatService.streamConversationMessage(
      user.id,
      request,
      this.toConversationId(id),
      content,
    );

    await this.pipeStream(stream, response);
  }

  @Post('conversations/:id/messages/:messageId/retry')
  async retryConversationMessage(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    const stream = this.chatService.retryMessage(
      user.id,
      request,
      this.toConversationId(id),
      this.toMessageId(messageId),
    );

    await this.pipeStream(stream, response);
  }

  private async pipeStream(
    stream: AsyncGenerator<unknown>,
    response: Response,
  ) {
    const firstEvent = await stream.next();

    response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');

    if (!firstEvent.done) {
      response.write(`${JSON.stringify(firstEvent.value)}\n`);
    }

    for await (const event of stream) {
      response.write(`${JSON.stringify(event)}\n`);
    }

    response.end();
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
