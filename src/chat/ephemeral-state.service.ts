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

/** Receives each event of a reply, then null once the reply is over. */
type RunListener = (event: unknown) => void;

type Run = {
  userId: string;
  conversationId: string;
  events: unknown[];
  listeners: Set<RunListener>;
};

@Injectable()
export class EphemeralStateService {
  private readonly requests = new Map<string, ActiveRequestState>();
  // Replies running in this process, by assistant message id, with every event
  // sent so far. A browser that lost its stream (tab in the background, phone
  // locked, reload) re-attaches here and replays the reply up to now.
  // ponytail: in-process only; with more than one backend replica a resume can
  // land on the wrong one and fall back to polling. Move to Redis pub/sub then.
  private readonly runs = new Map<string, Run>();

  openRun(messageId: string, userId: string, conversationId: string) {
    this.runs.set(messageId, { userId, conversationId, events: [], listeners: new Set() });
  }

  pushRun(messageId: string, event: unknown) {
    const run = this.runs.get(messageId);
    if (!run) return;
    run.events.push(event);
    for (const listener of run.listeners) listener(event);
  }

  closeRun(messageId: string) {
    const run = this.runs.get(messageId);
    if (!run) return;
    this.runs.delete(messageId);
    for (const listener of run.listeners) listener(null);
  }

  /**
   * Replays the reply so far, then forwards live events. Returns the
   * unsubscribe function, or null when this process is not running a reply
   * with that id for that user and conversation.
   */
  followRun(messageId: string, userId: string, conversationId: string, listener: RunListener) {
    const run = this.runs.get(messageId);
    if (!run || run.userId !== userId || run.conversationId !== conversationId) return null;
    for (const event of run.events) listener(event);
    run.listeners.add(listener);
    return () => run.listeners.delete(listener);
  }

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
