import { Injectable } from '@nestjs/common';

type ActiveRequestState = {
  requestId: string;
  conversationId: string;
  userId: string;
  messageId: string;
  controller: AbortController;
  startedAt: number;
  lastSeenAt: number;
};

@Injectable()
export class EphemeralStateService {
  private readonly requests = new Map<string, ActiveRequestState>();

  /** Registers a running stream; the returned signal fires when the user stops it. */
  start(requestId: string, conversationId: string, userId: string, messageId: string) {
    const now = Date.now();
    const controller = new AbortController();
    this.requests.set(requestId, {
      requestId,
      conversationId,
      userId,
      messageId,
      controller,
      startedAt: now,
      lastSeenAt: now,
    });
    return controller.signal;
  }

  /** Aborts the stream producing this message. False when this process is not running it. */
  stop(messageId: string) {
    for (const request of this.requests.values()) {
      if (request.messageId === messageId) {
        request.controller.abort();
        return true;
      }
    }
    return false;
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
