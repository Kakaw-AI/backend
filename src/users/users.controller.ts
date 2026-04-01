import { Controller, Get } from '@nestjs/common';
import { AuthUser } from '../auth/better-auth.config';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { UsersService } from './users.service';

@Controller('me')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get('onboarding-state')
  getOnboardingState(@CurrentUser() user: AuthUser) {
    return this.usersService.getOnboardingState(user.id);
  }

  @Get('connections')
  getConnections(@CurrentUser() user: AuthUser) {
    return this.usersService.getConnections(user.id);
  }

  @Get('llm-connections')
  getLlmConnections(@CurrentUser() user: AuthUser) {
    return this.usersService.getLlmConnections(user.id);
  }

  @Get('chat-options')
  getChatOptions(@CurrentUser() user: AuthUser) {
    return this.usersService.getChatOptions(user.id);
  }
}
