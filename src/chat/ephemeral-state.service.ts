import { Injectable } from '@nestjs/common';

type ActiveRequestState = {
  requestId: string;
  conversationId: string;
  userId: string;
  startedAt: number;
  lastSeenAt: number;
};

@Injectable()
export class EphemeralStateService {
  private readonly requests = new Map<string, ActiveRequestState>();

  start(requestId: string, conversationId: string, userId: string) {
    const now = Date.now();
    this.requests.set(requestId, {
      requestId,
      conversationId,
      userId,
      startedAt: now,
      lastSeenAt: now,
    });
  }

  touch(requestId: string) {
    const current = this.requests.get(requestId);
    if (!current) {
      return;
    }

    this.requests.set(requestId, {
      ...current,
      lastSeenAt: Date.now(),
    });
  }

  finish(requestId: string) {
    this.requests.delete(requestId);
  }
}
