import { Injectable, Logger } from '@nestjs/common';
import { QueryMemoryStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from './embedding.service';
import { dot } from './vector-pack';
import {
  extractReferencedIdentifiers,
  extractReferencedTables,
  extractSqlFromToolCalls,
} from './sql-identifiers';
import { normalizeQuestion, questionHash } from './question-literals';

/**
 * Words that appear in SQL without naming a catalog object, so their absence
 * from a catalog says nothing about whether a query is still valid.
 */
const SQL_VOCABULARY = new Set([
  'select', 'from', 'where', 'group', 'by', 'order', 'having', 'limit',
  'offset', 'join', 'inner', 'left', 'right', 'full', 'outer', 'cross', 'on',
  'as', 'and', 'or', 'not', 'in', 'is', 'null', 'like', 'ilike', 'between',
  'case', 'when', 'then', 'else', 'end', 'distinct', 'all', 'union', 'except',
  'intersect', 'with', 'asc', 'desc', 'nulls', 'first', 'last', 'over',
  'partition', 'rows', 'range', 'true', 'false', 'cast', 'interval', 'filter',
  'count', 'sum', 'avg', 'min', 'max', 'coalesce', 'nullif', 'greatest',
  'least', 'abs', 'round', 'floor', 'ceil', 'length', 'lower', 'upper', 'trim',
  'substring', 'concat', 'date', 'date_trunc', 'extract', 'now', 'current_date',
  'current_timestamp', 'to_char', 'to_date', 'age', 'row_number', 'rank',
  'dense_rank', 'lag', 'lead', 'array_agg', 'string_agg', 'json_agg', 'exists',
  'any', 'some', 'using', 'natural', 'lateral', 'returning', 'text', 'integer',
  'numeric', 'boolean', 'timestamp', 'bigint', 'varchar', 'char', 'real',
  'double', 'precision', 'decimal', 'int', 'smallint', 'serial', 'uuid',
]);

/**
 * Serializes a vector for storage. Slices by byteOffset/byteLength so a
 * Float32Array that is a view over a larger buffer writes only its own bytes.
 */
function toBytes(vector: Float32Array): Uint8Array<ArrayBuffer> {
  const bytes = vector.buffer.slice(
    vector.byteOffset,
    vector.byteOffset + vector.byteLength,
  ) as ArrayBuffer;
  return new Uint8Array(bytes);
}

/** Reads a stored embedding blob back into a scoring-ready vector. */
function toFloat32(buffer: Buffer | Uint8Array | null): Float32Array | null {
  if (!buffer || buffer.byteLength === 0 || buffer.byteLength % 4 !== 0) {
    return null;
  }
  // Copy rather than view: a Buffer out of Node's pool has an arbitrary
  // byteOffset and Float32Array requires 4-byte alignment.
  const copy = new Uint8Array(buffer.byteLength);
  copy.set(buffer);
  return new Float32Array(copy.buffer);
}

export type RecordFromTraceInput = {
  traceId: string;
  databaseSourceId: string;
  schemaFingerprint: string | null;
  question: string;
  toolCalls: unknown;
  cacheHit: boolean;
};

export type ExactPlanHit = {
  memoryId: string;
  sql: string;
};

export type SimilarExample = {
  memoryId: string;
  question: string;
  sql: string;
  tablesReferenced: string[];
  score: number;
};

type IndexedEntry = {
  id: string;
  question: string;
  sql: string;
  tablesReferenced: string[];
  vector: Float32Array;
};

type MemoryIndex = {
  fingerprint: string;
  entries: IndexedEntry[];
};

/**
 * Examples injected per question. Two is too few to convey a join style; five
 * crowds a prompt that already carries the whole schema catalog.
 */
const DEFAULT_K = 3;

/**
 * Cosine floor for treating a past question as a useful example.
 *
 * Measured on all-MiniLM-L6-v2: a genuine paraphrase of a real analytics
 * question scores ~0.68, a different question about the same database ~0.22,
 * an unrelated sentence ~0.00. 0.60 sits in that gap. A bad example is worse
 * than no example, so this errs high — and it is env-tunable because it is the
 * single most likely thing to need adjusting against real traffic.
 */
const SIMILARITY_FLOOR = Number(process.env.QUERY_MEMORY_FLOOR ?? 0.6);

/** Active entries held per source. Matches the eviction cap in the plan. */
const MAX_INDEXED_ENTRIES = 2000;

/**
 * Remembers which SQL answered which question, per data source.
 *
 * Every chat turn already wrote this to `agent_run_traces` and nothing ever
 * read it back. Promoting it into a queryable table gives a persistent,
 * cross-replica, restart-surviving replacement for the agent's in-process
 * 15-minute plan cache — and later, a corpus of few-shot examples.
 */
@Injectable()
export class QueryMemoryService {
  private readonly logger = new Logger(QueryMemoryService.name);

  /**
   * Per-source vectors, so a lookup is one dot-product scan instead of pulling
   * thousands of 1.5 KB embeddings out of Postgres on every question.
   * Invalidated on any write to that source.
   */
  private readonly indexCache = new Map<string, MemoryIndex>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddingService: EmbeddingService,
  ) {}

  /**
   * Stores the question/SQL pair from a finished run, if it earned it.
   *
   * Called fire-and-forget after the stream has settled, so it must never
   * throw into the caller.
   */
  async recordFromTrace(input: RecordFromTraceInput): Promise<void> {
    try {
      const entry = this.buildEntry(input);
      if (!entry) {
        return;
      }

      // Embedded here, off the critical path, so a lookup never has to.
      // ~3ms; a failure just leaves the entry usable by the exact tier.
      const vector = await this.embeddingService.embedQuery(
        entry.normalizedQuestion,
      );
      const embedding = vector ? toBytes(vector) : null;
      const embeddingModel = vector ? this.embeddingService.modelId : null;

      await this.prisma.queryMemoryEntry.upsert({
        where: {
          databaseSourceId_questionHash: {
            databaseSourceId: input.databaseSourceId,
            questionHash: entry.questionHash,
          },
        },
        create: { ...entry, embedding, embeddingModel },
        // Overwrite rather than accumulate: the newest verified answer for a
        // question supersedes whatever was there, which is how a previously
        // wrong entry heals when the user asks again and gets it right.
        update: {
          schemaFingerprint: entry.schemaFingerprint,
          question: entry.question,
          sql: entry.sql,
          tablesReferenced: entry.tablesReferenced,
          rowCount: entry.rowCount,
          status: entry.status,
          sourceTraceId: entry.sourceTraceId,
          embedding,
          embeddingModel,
        },
      });

      this.indexCache.delete(input.databaseSourceId);
    } catch (error) {
      // Never let memory bookkeeping affect a completed conversation.
      this.logger.warn(
        `Failed to record query memory for source ${input.databaseSourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Exact question match for this source and schema.
   *
   * Only ACTIVE entries, and only for the current fingerprint — SQL written
   * against an older schema may reference columns that no longer exist.
   */
  async findExact(
    databaseSourceId: string,
    schemaFingerprint: string | null,
    question: string,
  ): Promise<ExactPlanHit | null> {
    if (!schemaFingerprint) {
      return null;
    }

    try {
      const normalized = normalizeQuestion(question);
      if (!normalized) {
        return null;
      }

      const entry = await this.prisma.queryMemoryEntry.findUnique({
        where: {
          databaseSourceId_questionHash: {
            databaseSourceId,
            questionHash: questionHash(databaseSourceId, normalized),
          },
        },
        select: {
          id: true,
          sql: true,
          status: true,
          schemaFingerprint: true,
        },
      });

      if (
        !entry ||
        entry.status !== QueryMemoryStatus.ACTIVE ||
        entry.schemaFingerprint !== schemaFingerprint
      ) {
        return null;
      }

      return { memoryId: entry.id, sql: entry.sql };
    } catch (error) {
      this.logger.warn(
        `Query memory lookup failed for source ${databaseSourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  /**
   * The most similar past questions for this source, as few-shot examples.
   *
   * Returns nothing rather than failing: retrieval is an enhancement, and a
   * degraded prompt is far better than a broken conversation.
   */
  async findSimilar(
    databaseSourceId: string,
    schemaFingerprint: string | null,
    question: string,
    limit = DEFAULT_K,
  ): Promise<SimilarExample[]> {
    if (!schemaFingerprint) {
      return [];
    }

    try {
      const queryVector = await this.embeddingService.embedQuery(question);
      if (!queryVector) {
        return [];
      }

      const index = await this.loadIndex(databaseSourceId, schemaFingerprint);
      if (index.entries.length === 0) {
        return [];
      }

      const normalizedQuestion = normalizeQuestion(question);
      const scored: SimilarExample[] = [];

      for (const entry of index.entries) {
        // An exact match is handled by findExact, which skips generation
        // outright. Offering the same question back as an "example" of itself
        // teaches nothing.
        if (normalizeQuestion(entry.question) === normalizedQuestion) {
          continue;
        }

        const score = dot(queryVector, entry.vector);
        if (score >= SIMILARITY_FLOOR) {
          scored.push({
            memoryId: entry.id,
            question: entry.question,
            sql: entry.sql,
            tablesReferenced: entry.tablesReferenced,
            score,
          });
        }
      }

      scored.sort((left, right) => right.score - left.score);

      // Several phrasings of one query would otherwise consume every slot and
      // show the model the same thing three times.
      const seenSql = new Set<string>();
      const deduped: SimilarExample[] = [];
      for (const example of scored) {
        if (seenSql.has(example.sql)) {
          continue;
        }
        seenSql.add(example.sql);
        deduped.push(example);
        if (deduped.length >= limit) {
          break;
        }
      }

      return deduped;
    } catch (error) {
      this.logger.warn(
        `Similar-question lookup failed for source ${databaseSourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return [];
    }
  }

  private async loadIndex(
    databaseSourceId: string,
    schemaFingerprint: string,
  ): Promise<MemoryIndex> {
    const cached = this.indexCache.get(databaseSourceId);
    if (cached && cached.fingerprint === schemaFingerprint) {
      return cached;
    }

    const rows = await this.prisma.queryMemoryEntry.findMany({
      where: {
        databaseSourceId,
        status: QueryMemoryStatus.ACTIVE,
        schemaFingerprint,
        embedding: { not: null },
        embeddingModel: this.embeddingService.modelId,
      },
      orderBy: { updatedAt: 'desc' },
      take: MAX_INDEXED_ENTRIES,
      select: {
        id: true,
        question: true,
        sql: true,
        tablesReferenced: true,
        embedding: true,
      },
    });

    const entries: IndexedEntry[] = [];
    for (const row of rows) {
      const vector = toFloat32(row.embedding);
      if (!vector || vector.length !== this.embeddingService.dimension) {
        continue;
      }
      entries.push({
        id: row.id,
        question: row.question,
        sql: row.sql,
        tablesReferenced: row.tablesReferenced,
        vector,
      });
    }

    const index: MemoryIndex = { fingerprint: schemaFingerprint, entries };
    this.indexCache.set(databaseSourceId, index);
    return index;
  }

  /** Records that an entry was reused, for eviction ordering. */
  async markUsed(memoryId: string): Promise<void> {
    try {
      await this.prisma.queryMemoryEntry.update({
        where: { id: memoryId },
        data: { reuseCount: { increment: 1 }, lastUsedAt: new Date() },
        select: { id: true },
      });
    } catch {
      // Best-effort accounting.
    }
  }

  /**
   * Retires the entry a given run produced. Wired to negative feedback and to
   * the implicit signals (retry, rephrase) once those land.
   */
  async demoteByTraceId(traceId: string): Promise<void> {
    try {
      const affected = await this.prisma.queryMemoryEntry.updateMany({
        where: { sourceTraceId: traceId },
        data: {
          status: QueryMemoryStatus.RETIRED,
          negativeCount: { increment: 1 },
        },
      });
      if (affected.count > 0) {
        this.indexCache.clear();
      }
    } catch (error) {
      this.logger.warn(
        `Failed to demote query memory for trace ${traceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  /**
   * Re-checks stored SQL against a newly synced catalog.
   *
   * Filtering on the current fingerprint alone would discard the entire corpus
   * every time one unrelated column is added anywhere in the database. Instead
   * each entry's referenced identifiers are checked against the new catalog and
   * only genuinely broken ones are retired.
   *
   * Matching here is deliberately EXACT. A fuzzy check would happily keep an
   * entry whose column was renamed to something similar — which is precisely
   * the case that produces confidently wrong SQL.
   */
  async revalidateForFingerprint(
    databaseSourceId: string,
    newFingerprint: string,
    catalogIdentifiers: Set<string>,
  ): Promise<{ carried: number; retired: number }> {
    const result = { carried: 0, retired: 0 };

    try {
      const entries = await this.prisma.queryMemoryEntry.findMany({
        where: {
          databaseSourceId,
          status: QueryMemoryStatus.ACTIVE,
          schemaFingerprint: { not: newFingerprint },
        },
        select: { id: true, sql: true, tablesReferenced: true },
      });

      const carryIds: string[] = [];
      const retireIds: string[] = [];

      for (const entry of entries) {
        const referenced = new Set<string>([
          ...entry.tablesReferenced.map((name) => name.toLowerCase()),
          ...extractReferencedIdentifiers(entry.sql),
        ]);

        // Only names that look like catalog objects can be judged; SQL keywords
        // and aliases are not in the catalog and must not retire an entry.
        const missing = [...referenced].some(
          (name) =>
            !catalogIdentifiers.has(name) && !SQL_VOCABULARY.has(name),
        );

        if (missing) {
          retireIds.push(entry.id);
        } else {
          carryIds.push(entry.id);
        }
      }

      if (carryIds.length > 0) {
        await this.prisma.queryMemoryEntry.updateMany({
          where: { id: { in: carryIds } },
          data: { schemaFingerprint: newFingerprint },
        });
      }
      if (retireIds.length > 0) {
        // Kept, not deleted: a retired entry is evidence about what broke.
        await this.prisma.queryMemoryEntry.updateMany({
          where: { id: { in: retireIds } },
          data: { status: QueryMemoryStatus.RETIRED },
        });
      }

      this.indexCache.delete(databaseSourceId);
      result.carried = carryIds.length;
      result.retired = retireIds.length;
    } catch (error) {
      this.logger.warn(
        `Query memory revalidation failed for source ${databaseSourceId}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return result;
  }

  /**
   * Decides whether a finished run is worth remembering, and shapes the row.
   * Exported via the service so the backfill script applies identical rules.
   */
  buildEntry(input: RecordFromTraceInput) {
    if (!input.schemaFingerprint) {
      return null;
    }

    // A cached run would just rewrite the entry it came from.
    if (input.cacheHit) {
      return null;
    }

    const executed = extractSqlFromToolCalls(input.toolCalls);
    if (!executed) {
      return null;
    }

    const normalizedQuestion = normalizeQuestion(input.question);
    if (!normalizedQuestion) {
      return null;
    }

    // A zero-row result is syntactically valid and frequently semantically
    // wrong — the classic "filtered on the wrong column" outcome. Keep it for
    // debugging, never offer it as an example or a plan.
    const status =
      executed.rowCount > 0
        ? QueryMemoryStatus.ACTIVE
        : QueryMemoryStatus.QUARANTINED;

    return {
      databaseSourceId: input.databaseSourceId,
      schemaFingerprint: input.schemaFingerprint,
      question: input.question.trim(),
      normalizedQuestion,
      questionHash: questionHash(input.databaseSourceId, normalizedQuestion),
      sql: executed.sql,
      tablesReferenced: extractReferencedTables(executed.sql),
      rowCount: executed.rowCount,
      status,
      sourceTraceId: input.traceId,
    };
  }
}
