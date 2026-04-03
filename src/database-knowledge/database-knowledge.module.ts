import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { DatabaseKnowledgeRepository } from './database-knowledge.repository';
import { DatabaseKnowledgeService } from './database-knowledge.service';

@Module({
  imports: [PrismaModule],
  providers: [DatabaseKnowledgeRepository, DatabaseKnowledgeService],
  exports: [DatabaseKnowledgeService],
})
export class DatabaseKnowledgeModule {}
