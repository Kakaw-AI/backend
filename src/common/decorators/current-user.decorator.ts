import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AuthUser } from '../../auth/better-auth.config';

/**
 * Extracts the authenticated user from the request.
 * Only works on routes protected by AuthGuard.
 *
 * @example
 * \@Get('me')
 * getMe(\@CurrentUser() user: AuthUser) { ... }
 */
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthUser => {
    const request = ctx.switchToHttp().getRequest();
    return request.session?.user;
  },
);
