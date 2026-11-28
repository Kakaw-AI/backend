import { Controller, Delete, Get, HttpCode } from '@nestjs/common';
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

  @Delete()
  @HttpCode(204)
  async deleteAccount(@CurrentUser() user: AuthUser) {
    await this.usersService.deleteAccount(user.id);
  }

  @Get('usage')
  getUsage(@CurrentUser() user: AuthUser) {
    return this.usersService.getUsage(user.id);
  }

  @Get('chat-options')
  getChatOptions(@CurrentUser() user: AuthUser) {
    return this.usersService.getChatOptions(user.id);
  }
}
