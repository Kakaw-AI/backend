import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PrismaModule } from '../prisma/prisma.module';
import { LlmConnectionsController } from './llm-connections.controller';
import { LlmConnectionsRepository } from './llm-connections.repository';
import { LlmConnectionsService } from './llm-connections.service';
import { SecretsService } from './secrets.service';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [LlmConnectionsController],
  providers: [
    LlmConnectionsService,
    LlmConnectionsRepository,
    SecretsService,
  ],
  exports: [LlmConnectionsService, SecretsService],
})
export class LlmConnectionsModule {}
