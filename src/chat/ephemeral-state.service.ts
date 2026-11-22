import { Injectable } from '@nestjs/common';

type ActiveRequestState = {
  requestId: string;
  conversationId: string;
  userId: string;
  messageId: string;
  startedAt: number;
  lastSeenAt: number;
};

@Injectable()
export class EphemeralStateService {
  private readonly requests = new Map<string, ActiveRequestState>();

  start(requestId: string, conversationId: string, userId: string, messageId: string) {
    const now = Date.now();
    this.requests.set(requestId, {
      requestId,
      conversationId,
      userId,
      messageId,
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

  /** Assistant messages this process is streaming right now. */
  activeMessageIds() {
    return [...this.requests.values()].map((request) => request.messageId);
  }
}
