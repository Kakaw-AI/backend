import { BadRequestException, Body, Controller, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { AuthUser } from '../auth/better-auth.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import {
  CreateLlmConnectionInput,
  SUPPORTED_LLM_PROVIDERS,
  isSupportedLlmProvider,
} from './llm-connections.types';
import { LlmConnectionsService } from './llm-connections.service';

type CreateLlmConnectionBody = {
  provider?: unknown;
  displayName?: unknown;
  defaultModel?: unknown;
  apiKey?: unknown;
  baseUrl?: unknown;
};

@Controller('llm-connections')
export class LlmConnectionsController {
  constructor(
    private readonly llmConnectionsService: LlmConnectionsService,
  ) {}

  @Post()
  createLlmConnection(
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
    @Body() body: CreateLlmConnectionBody,
  ) {
    const input = this.toCreateInput(body);
    return this.llmConnectionsService.createForUser(user.id, request, input);
  }

  private toCreateInput(body: CreateLlmConnectionBody): CreateLlmConnectionInput {
    const provider =
      typeof body.provider === 'string' ? body.provider.trim().toLowerCase() : '';

    if (!provider) {
      throw new BadRequestException('provider is required');
    }

    if (!isSupportedLlmProvider(provider)) {
      throw new BadRequestException(
        `Unsupported provider. Supported values are ${SUPPORTED_LLM_PROVIDERS.join(', ')}.`,
      );
    }

    return {
      provider,
      displayName:
        typeof body.displayName === 'string' ? body.displayName.trim() : undefined,
      defaultModel:
        typeof body.defaultModel === 'string'
          ? body.defaultModel.trim()
          : undefined,
      apiKey: typeof body.apiKey === 'string' ? body.apiKey.trim() : undefined,
      baseUrl: typeof body.baseUrl === 'string' ? body.baseUrl.trim() : undefined,
    };
  }
}
