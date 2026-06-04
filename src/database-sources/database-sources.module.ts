import { Module } from '@nestjs/common';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { DatabaseKnowledgeModule } from '../database-knowledge/database-knowledge.module';
import { PrismaModule } from '../prisma/prisma.module';
import { StorageModule } from '../storage/storage.module';
import { DatabaseSourcesController } from './database-sources.controller';
import { DatabaseSourcesRepository } from './database-sources.repository';
import { DatabaseSourcesService } from './database-sources.service';

@Module({
  imports: [
    PrismaModule,
    AgentRuntimeModule,
    DatabaseKnowledgeModule,
    StorageModule,
  ],
  controllers: [DatabaseSourcesController],
  providers: [DatabaseSourcesService, DatabaseSourcesRepository],
  exports: [DatabaseSourcesService],
})
export class DatabaseSourcesModule {}
