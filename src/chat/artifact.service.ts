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
      case 'artifact':
        buffer.push({ type: event.data.artifactType, payload: event.data.payload });
        break;
    }
  }

  async saveArtifacts(messageId: string, artifacts: ArtifactInput[]): Promise<void> {
    for (const artifact of artifacts) {
      await this.chatRepository.createArtifact({
        messageId,
        type: artifact.type,
        payload: artifact.payload,
      });
    }
  }
}
