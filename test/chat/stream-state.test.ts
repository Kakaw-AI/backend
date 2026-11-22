import { MessageStatus } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EphemeralStateService } from '../../src/chat/ephemeral-state.service';
import { StaleStateSweeper } from '../../src/chat/stale-state.sweeper';
import type { PrismaService } from '../../src/prisma/prisma.service';

function setup() {
  const updateMany = vi.fn().mockResolvedValue({ count: 1 });
  const prisma = { message: { updateMany } } as unknown as PrismaService;
  const state = new EphemeralStateService();
  return { updateMany, state, sweeper: new StaleStateSweeper(prisma, state) };
}

describe('StaleStateSweeper on shutdown', () => {
  it('fails only the messages this process is still streaming', async () => {
    const { updateMany, state, sweeper } = setup();
    state.start('req-1', 'conv-1', 'user-1', 'msg-1');
    state.start('req-2', 'conv-2', 'user-1', 'msg-2');
    state.finish('req-2');

    await sweeper.onModuleDestroy();

    expect(updateMany).toHaveBeenCalledOnce();
    const { where, data } = updateMany.mock.calls[0][0];
    expect(where).toEqual({ id: { in: ['msg-1'] }, status: MessageStatus.STREAMING });
    expect(data.status).toBe(MessageStatus.FAILED);
  });

  it('does nothing when no stream is running', async () => {
    const { updateMany, sweeper } = setup();
    await sweeper.onModuleDestroy();
    expect(updateMany).not.toHaveBeenCalled();
  });
});

describe('EphemeralStateService.stop', () => {
  it('aborts the stream producing the message', () => {
    const state = new EphemeralStateService();
    const signal = state.start('req-1', 'conv-1', 'user-1', 'msg-1');
    expect(state.stop('msg-1')).toBe(true);
    expect(signal.aborted).toBe(true);
  });

  it('reports a message this process is not streaming', () => {
    const state = new EphemeralStateService();
    state.start('req-1', 'conv-1', 'user-1', 'msg-1');
    expect(state.stop('msg-2')).toBe(false);
  });
});
