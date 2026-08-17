import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { RetrievalModule } from '../retrieval/retrieval.module';
import { DatabaseKnowledgeRepository } from './database-knowledge.repository';
import { DatabaseKnowledgeService } from './database-knowledge.service';

@Module({
  imports: [PrismaModule, RetrievalModule],
  providers: [DatabaseKnowledgeRepository, DatabaseKnowledgeService],
  exports: [DatabaseKnowledgeService],
})
export class DatabaseKnowledgeModule {}
