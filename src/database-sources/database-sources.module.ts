import { Module } from '@nestjs/common';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseSourcesController } from './database-sources.controller';
import { DatabaseSourcesRepository } from './database-sources.repository';
import { DatabaseSourcesService } from './database-sources.service';

@Module({
  imports: [PrismaModule, AgentRuntimeModule],
  controllers: [DatabaseSourcesController],
  providers: [DatabaseSourcesService, DatabaseSourcesRepository],
  exports: [DatabaseSourcesService],
})
export class DatabaseSourcesModule {}
