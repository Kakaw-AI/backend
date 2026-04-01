import { Injectable } from '@nestjs/common';
import { Request } from 'express';
import { auth, AuthSession } from './better-auth.config';
import { fromNodeHeaders } from 'better-auth/node';

@Injectable()
export class AuthService {
  /**
   * Validates the session from an incoming Express request.
   * Used by AuthGuard to protect routes.
   */
  async getSession(req: Request): Promise<AuthSession | null> {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(req.headers),
    });

    return session ?? null;
  }

  async getAccessToken(req: Request, providerId: string) {
    return auth.api.getAccessToken({
      headers: fromNodeHeaders(req.headers),
      body: {
        providerId,
      },
    });
  }
}
