import { Injectable } from '@nestjs/common';
import { MessageArtifactType } from '@prisma/client';
import { ChatRepository } from './chat.repository';
import { AgentStreamEvent } from './chat.types';

export type ArtifactInput = {
  type: MessageArtifactType;
  payload: Record<string, unknown>;
};

@Injectable()
export class ArtifactService {
  constructor(private readonly chatRepository: ChatRepository) {}

  collectFromEvent(event: AgentStreamEvent, buffer: ArtifactInput[]): void {
    switch (event.type) {
      case 'sql_generated':
        buffer.push({ type: MessageArtifactType.SQL, payload: event.data });
        break;
      case 'sql_result':
        buffer.push({ type: MessageArtifactType.TABLE, payload: event.data });
        break;
      case 'chart_generated':
        buffer.push({ type: MessageArtifactType.CHART, payload: event.data });
        break;
      case 'web_sources':
        buffer.push({
          type: MessageArtifactType.TEXT,
          payload: { kind: 'web_sources', sources: event.data.sources },
        });
        break;
    }
  }

  async saveArtifacts(messageId: string, artifacts: ArtifactInput[]): Promise<void> {
    await this.chatRepository.createArtifacts(messageId, artifacts);
  }
}
