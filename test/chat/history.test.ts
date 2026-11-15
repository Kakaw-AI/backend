import { MessageArtifactType, MessageRole } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { toAgentHistoryMessage } from '../../src/chat/chat.service';

describe('toAgentHistoryMessage', () => {
  it('carries the result table and the SQL behind an assistant turn', () => {
    expect(
      toAgentHistoryMessage({
        role: MessageRole.ASSISTANT,
        content: 'There were 61 cancelled orders.',
        artifacts: [
          { type: MessageArtifactType.TABLE, payload: { columns: ['count'], rows: [{ count: 61 }] } },
          { type: MessageArtifactType.SQL, payload: { sql: "SELECT COUNT(*) FROM orders WHERE status = 'Cancelled'" } },
        ],
      }),
    ).toEqual({
      role: 'assistant',
      content: 'There were 61 cancelled orders.',
      columns: ['count'],
      rows: [{ count: 61 }],
      sql: "SELECT COUNT(*) FROM orders WHERE status = 'Cancelled'",
    });
  });

  it('leaves the fields out for a turn without artifacts', () => {
    expect(
      toAgentHistoryMessage({ role: MessageRole.USER, content: 'and in 2025?', artifacts: [] }),
    ).toEqual({ role: 'user', content: 'and in 2025?', rows: undefined, columns: undefined });
  });
});
