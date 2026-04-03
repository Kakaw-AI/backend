import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseKnowledgeModule } from '../database-knowledge/database-knowledge.module';
import { DatabaseSourcesModule } from '../database-sources/database-sources.module';
import { LlmConnectionsModule } from '../llm-connections/llm-connections.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ArtifactService } from './artifact.service';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import { ConversationService } from './conversation.service';
import { EphemeralStateService } from './ephemeral-state.service';
import { MessageStreamingService } from './message-streaming.service';
import { RuntimeConfigService } from './runtime-config.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AgentRuntimeModule,
    DatabaseKnowledgeModule,
    DatabaseSourcesModule,
    LlmConnectionsModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatRepository,
    ChatService,
    ConversationService,
    ArtifactService,
    MessageStreamingService,
    RuntimeConfigService,
    EphemeralStateService,
  ],
})
export class ChatModule {}
