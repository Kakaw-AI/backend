import { Module } from '@nestjs/common';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { DatabaseKnowledgeModule } from '../database-knowledge/database-knowledge.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseSourcesController } from './database-sources.controller';
import { DatabaseSourcesRepository } from './database-sources.repository';
import { DatabaseSourcesService } from './database-sources.service';
import { SqliteFingerprintService } from './sqlite-fingerprint.service';

@Module({
  imports: [PrismaModule, AgentRuntimeModule, DatabaseKnowledgeModule],
  controllers: [DatabaseSourcesController],
  providers: [
    DatabaseSourcesService,
    DatabaseSourcesRepository,
    SqliteFingerprintService,
  ],
  exports: [DatabaseSourcesService],
})
export class DatabaseSourcesModule {}
