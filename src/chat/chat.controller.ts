import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
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

    response.setHeader('content-type', 'application/x-ndjson; charset=utf-8');
    response.setHeader('cache-control', 'no-cache, no-transform');
    response.setHeader('connection', 'keep-alive');

    for await (const event of this.chatService.streamConversationMessage(
      user.id,
      request,
      id,
      content,
    )) {
      response.write(`${JSON.stringify(event)}\n`);
    }

    response.end();
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
}
