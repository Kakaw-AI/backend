import { Injectable } from '@nestjs/common';
import { DatabaseKnowledgeRepository } from './database-knowledge.repository';
import { DatabaseCatalogInput, DatabaseKnowledgeRuntime } from './database-knowledge.types';

// The runtime catalog is read on every chat message but only changes on sync.
// Loading it is a deeply nested query (every table, column, index, relation and
// knowledge document) followed by a full remap, so it is cached in-process and
// revalidated against the source's schema fingerprint. The fingerprint probe is
// a primary-key lookup, which keeps the cache correct when another replica runs
// the sync. Sources without a fingerprint are never cached, since there is then
// nothing cheap to validate against.
const CACHE_MAX_ENTRIES = 32;

type CacheEntry = {
  fingerprint: string;
  knowledge: DatabaseKnowledgeRuntime;
};

@Injectable()
export class DatabaseKnowledgeService {
  private readonly runtimeCache = new Map<string, CacheEntry>();

  constructor(
    private readonly databaseKnowledgeRepository: DatabaseKnowledgeRepository,
  ) {}

  async replaceCatalog(sourceId: string, catalog: DatabaseCatalogInput) {
    const result = await this.databaseKnowledgeRepository.replaceCatalog(
      sourceId,
      catalog,
    );
    this.runtimeCache.delete(sourceId);
    return result;
  }

  async getRuntimeKnowledge(sourceId: string): Promise<DatabaseKnowledgeRuntime> {
    const fingerprint =
      await this.databaseKnowledgeRepository.getSchemaFingerprint(sourceId);

    if (fingerprint) {
      const cached = this.runtimeCache.get(sourceId);
      if (cached && cached.fingerprint === fingerprint) {
        // Refresh recency without changing the entry.
        this.runtimeCache.delete(sourceId);
        this.runtimeCache.set(sourceId, cached);
        return cached.knowledge;
      }
    }

    const knowledge =
      await this.databaseKnowledgeRepository.getRuntimeKnowledge(sourceId);

    if (fingerprint && knowledge.schemaFingerprint === fingerprint) {
      this.setCached(sourceId, { fingerprint, knowledge });
    }

    return knowledge;
  }

  invalidateRuntimeKnowledge(sourceId: string) {
    this.runtimeCache.delete(sourceId);
  }

  private setCached(sourceId: string, entry: CacheEntry) {
    this.runtimeCache.delete(sourceId);
    this.runtimeCache.set(sourceId, entry);

    while (this.runtimeCache.size > CACHE_MAX_ENTRIES) {
      const oldest = this.runtimeCache.keys().next();
      if (oldest.done) {
        break;
      }
      this.runtimeCache.delete(oldest.value);
    }
  }
}
