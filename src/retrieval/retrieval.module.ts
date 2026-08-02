import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { EmbeddingService } from './embedding.service';
import { QueryMemoryService } from './query-memory.service';

@Module({
  imports: [PrismaModule],
  providers: [EmbeddingService, QueryMemoryService],
  exports: [EmbeddingService, QueryMemoryService],
})
export class RetrievalModule {}
