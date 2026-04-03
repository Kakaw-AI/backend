import { Injectable } from '@nestjs/common';
import { DatabaseKnowledgeRepository } from './database-knowledge.repository';
import { DatabaseCatalogInput } from './database-knowledge.types';

@Injectable()
export class DatabaseKnowledgeService {
  constructor(
    private readonly databaseKnowledgeRepository: DatabaseKnowledgeRepository,
  ) {}

  replaceCatalog(sourceId: string, catalog: DatabaseCatalogInput) {
    return this.databaseKnowledgeRepository.replaceCatalog(sourceId, catalog);
  }

  getRuntimeKnowledge(sourceId: string) {
    return this.databaseKnowledgeRepository.getRuntimeKnowledge(sourceId);
  }
}
