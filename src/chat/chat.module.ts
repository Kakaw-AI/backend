import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseSourcesModule } from '../database-sources/database-sources.module';
import { LlmConnectionsModule } from '../llm-connections/llm-connections.module';
import { PrismaModule } from '../prisma/prisma.module';
import { ChatController } from './chat.controller';
import { ChatRepository } from './chat.repository';
import { ChatService } from './chat.service';
import { EphemeralStateService } from './ephemeral-state.service';
import { RuntimeConfigService } from './runtime-config.service';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AgentRuntimeModule,
    DatabaseSourcesModule,
    LlmConnectionsModule,
  ],
  controllers: [ChatController],
  providers: [
    ChatRepository,
    ChatService,
    RuntimeConfigService,
    EphemeralStateService,
  ],
})
export class ChatModule {}
