import { Module } from '@nestjs/common';
import { AgentRuntimeModule } from '../agent-runtime/agent-runtime.module';
import { DatabaseKnowledgeModule } from '../database-knowledge/database-knowledge.module';
import { DatabaseSourcesModule } from '../database-sources/database-sources.module';
import { LlmConnectionsModule } from '../llm-connections/llm-connections.module';
import { PrismaModule } from '../prisma/prisma.module';
import { BookController } from './book.controller';
import { BookService } from './book.service';

@Module({
  imports: [PrismaModule, AgentRuntimeModule, DatabaseKnowledgeModule, DatabaseSourcesModule, LlmConnectionsModule],
  controllers: [BookController],
  providers: [BookService],
})
export class BookModule {}
