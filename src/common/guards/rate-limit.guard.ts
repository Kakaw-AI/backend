import {
  CanActivate,
  ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request, Response } from 'express';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

const RATE_LIMIT_KEY = 'rateLimit';
const WINDOW_MS = 60_000;
/** Requests per user per minute across the whole API. */
const DEFAULT_LIMIT = 300;

/**
 * Gives a route its own, tighter per-user budget (requests per minute). For
 * the routes that cost real work: LLM runs, database syncs, outbound calls.
 */
export const RateLimit = (limit: number) => SetMetadata(RATE_LIMIT_KEY, limit);

/**
 * Fixed-window counter.
 *
 * ponytail: in memory, so it is per process — correct while the API runs as a
 * single replica. Move the counters to Redis (or @nestjs/throttler with a
 * shared store) before scaling out.
 */
export class FixedWindowLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();
  private nextSweepAt = 0;

  /** Returns 0 when the hit is allowed, otherwise the seconds until it will be. */
  hit(key: string, limit: number, now = Date.now()): number {
    if (now >= this.nextSweepAt) {
      for (const [entryKey, entry] of this.windows) {
        if (entry.resetAt <= now) {
          this.windows.delete(entryKey);
        }
      }
      this.nextSweepAt = now + WINDOW_MS;
    }

    const current = this.windows.get(key);
    if (!current || current.resetAt <= now) {
      this.windows.set(key, { count: 1, resetAt: now + WINDOW_MS });
      return 0;
    }

    current.count += 1;
    return current.count > limit
      ? Math.max(1, Math.ceil((current.resetAt - now) / 1000))
      : 0;
  }
}

/** Runs after AuthGuard, so the session it keys on is already on the request. */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly limiter = new FixedWindowLimiter();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets)) {
      return true;
    }

    const http = context.switchToHttp();
    const request = http.getRequest<Request & { session?: { user?: { id?: string } } }>();
    const userId = request.session?.user?.id;
    if (!userId) {
      return true;
    }

    const routeLimit = this.reflector.getAllAndOverride<number>(RATE_LIMIT_KEY, targets);
    const scope = routeLimit
      ? `${context.getClass().name}.${context.getHandler().name}`
      : '*';
    const retryAfter = this.limiter.hit(`${userId}:${scope}`, routeLimit ?? DEFAULT_LIMIT);

    if (retryAfter > 0) {
      http.getResponse<Response>().setHeader('Retry-After', String(retryAfter));
      throw new HttpException(
        `Too many requests. Try again in ${retryAfter} seconds.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}
