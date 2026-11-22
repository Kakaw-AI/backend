import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Param,
  Post,
} from '@nestjs/common';
import { AuthUser } from '../auth/better-auth.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { RateLimit } from '../common/guards/rate-limit.guard';
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
  reuseKeyFromConnectionId?: unknown;
};

@Controller('llm-connections')
export class LlmConnectionsController {
  constructor(
    private readonly llmConnectionsService: LlmConnectionsService,
  ) {}

  // Makes an outbound validation call to the provider.
  @RateLimit(10)
  @Post()
  createLlmConnection(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateLlmConnectionBody,
  ) {
    const input = this.toCreateInput(body);
    return this.llmConnectionsService.createForUser(user.id, input);
  }

  // POST so the key travels in the body, not the URL. One outbound call each.
  @RateLimit(30)
  @Post('models')
  listProviderModels(
    @CurrentUser() user: AuthUser,
    @Body() body: CreateLlmConnectionBody,
  ) {
    const { provider, apiKey, baseUrl, reuseKeyFromConnectionId } = this.toCreateInput(body);
    return this.llmConnectionsService.listModelsForUser(user.id, {
      provider,
      apiKey,
      baseUrl,
      reuseKeyFromConnectionId,
    });
  }

  @Post(':id/activate')
  activateLlmConnection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.llmConnectionsService.activateForUser(user.id, this.toConnectionId(id));
  }

  @Post(':id/deactivate')
  deactivateLlmConnection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.llmConnectionsService.deactivateForUser(
      user.id,
      this.toConnectionId(id),
    );
  }

  @Delete(':id')
  deleteLlmConnection(
    @CurrentUser() user: AuthUser,
    @Param('id') id: string,
  ) {
    return this.llmConnectionsService.deleteForUser(user.id, this.toConnectionId(id));
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
      reuseKeyFromConnectionId:
        typeof body.reuseKeyFromConnectionId === 'string' && body.reuseKeyFromConnectionId.trim()
          ? body.reuseKeyFromConnectionId.trim()
          : undefined,
    };
  }

  private toConnectionId(id: string) {
    const connectionId = id.trim();
    if (!connectionId) {
      throw new BadRequestException('id is required');
    }

    return connectionId;
  }
}
