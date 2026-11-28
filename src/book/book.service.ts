import { createHash } from 'node:crypto';
import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BookPageSource, BookStatus, Prisma } from '@prisma/client';
import { AgentGatewayService } from '../chat/agent-gateway.service';
import { toAgentLlmRuntime } from '../chat/runtime-config.service';
import type { AgentLlmRuntime } from '../chat/chat.types';
import { normalizeApiError } from '../common/errors/error-response';
import { DatabaseKnowledgeService } from '../database-knowledge/database-knowledge.service';
import type { BookTablePage, DatabaseKnowledgeRuntime } from '../database-knowledge/database-knowledge.types';
import { DatabaseSourcesService } from '../database-sources/database-sources.service';
import { LlmConnectionsService } from '../llm-connections/llm-connections.service';
import { PrismaService } from '../prisma/prisma.service';

/** A run stops starting new tables once it has used this many tokens. */
export const BOOK_TOKEN_LIMIT = 1_000_000;
/** Runs that read every table, per database per UTC day. Runs that update a few tables are free. */
export const FULL_RUNS_PER_DAY = 3;
const CONCURRENCY = 2;
/** Consecutive failed tables before the run gives up (a bad key fails every one). */
const MAX_CONSECUTIVE_FAILURES = 3;
/** Attempts per table. Hosted providers rate-limit bursts, so a failure waits and retries. */
const ATTEMPTS_PER_TABLE = 4;
const RETRY_DELAY_MS = 20_000;

/** Retries a call with a growing pause; rethrows the last error. */
async function withRetry<T>(call: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await call();
    } catch (error) {
      if (attempt >= ATTEMPTS_PER_TABLE) throw error;
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
  }
}

type CatalogTable = DatabaseKnowledgeRuntime['tables'][number];

export const tableKey = (table: { schemaName?: string | null; name: string }) =>
  `${table.schemaName ?? ''}.${table.name}`;

/** Changes when the table's columns or declared keys change, and only then. */
export function tableSchemaHash(table: CatalogTable): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        columns: table.columns.map((column) => [column.name, column.dataType, column.isNullable, column.isPrimaryKey]),
        foreignKeys: table.foreignKeys.map((fk) => [fk.sourceColumn, fk.targetSchema ?? null, fk.targetTable, fk.targetColumn]),
      }),
    )
    .digest('hex');
}

/**
 * Most connected first, then largest: if the token limit stops the run, the
 * tables most questions touch are already done.
 */
export function orderByImportance(tables: CatalogTable[]): CatalogTable[] {
  const degree = new Map<string, number>();
  for (const table of tables) {
    for (const fk of table.foreignKeys) {
      degree.set(tableKey(table), (degree.get(tableKey(table)) ?? 0) + 1);
      const target = tableKey({ schemaName: fk.targetSchema ?? table.schemaName, name: fk.targetTable });
      degree.set(target, (degree.get(target) ?? 0) + 1);
    }
  }
  return [...tables].sort(
    (a, b) =>
      (degree.get(tableKey(b)) ?? 0) - (degree.get(tableKey(a)) ?? 0) ||
      (b.rowCount ?? 0) - (a.rowCount ?? 0) ||
      a.name.localeCompare(b.name),
  );
}

const utcDay = () => new Date().toISOString().slice(0, 10);

@Injectable()
export class BookService implements OnModuleInit {
  private readonly logger = new Logger(BookService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly agentGatewayService: AgentGatewayService,
    private readonly databaseSourcesService: DatabaseSourcesService,
    private readonly databaseKnowledgeService: DatabaseKnowledgeService,
    private readonly llmConnectionsService: LlmConnectionsService,
  ) {}

  /** A run lives in this process; one that was running when it stopped is left resumable. */
  async onModuleInit() {
    // ponytail: assumes one backend instance. With several, mark only this instance's runs.
    await this.prisma.databaseBook.updateMany({
      where: { status: BookStatus.RUNNING },
      data: {
        status: BookStatus.PARTIAL,
        lastError: 'Stopped by a server restart. Press Improve accuracy to continue.',
        finishedAt: new Date(),
      },
    });
  }

  async getStatus(user: { id: string; email: string }, sourceId: string) {
    const source = await this.prisma.databaseSource.findFirst({
      where: { id: sourceId, userId: user.id },
      select: { schemaFingerprint: true },
    });
    if (!source) throw new NotFoundException('Database not found.');

    const canViewPages = this.canViewPages(user.email);
    const book = await this.prisma.databaseBook.findUnique({
      where: { databaseSourceId: sourceId },
      include: canViewPages ? { pages: { orderBy: { tableKey: 'asc' } } } : undefined,
    });
    if (!book) {
      return { status: 'NONE' as const, tokenLimit: BOOK_TOKEN_LIMIT, fullRunsLeftToday: FULL_RUNS_PER_DAY, canViewPages };
    }

    const runsToday = book.runsDay === utcDay() ? book.fullRunsToday : 0;
    const pages = 'pages' in book ? (book.pages as Array<{ content: Prisma.JsonValue; source: BookPageSource; updatedAt: Date }>) : null;
    return {
      status: book.status,
      tablesTotal: book.tablesTotal,
      tablesDone: book.tablesDone,
      tokensUsed: book.tokensUsed,
      tokenLimit: BOOK_TOKEN_LIMIT,
      startedAt: book.startedAt.toISOString(),
      finishedAt: book.finishedAt?.toISOString() ?? null,
      lastError: book.lastError,
      llmConnectionId: book.llmConnectionId,
      // A finished book written against an older schema than the current sync.
      stale: book.status !== BookStatus.RUNNING && !!book.schemaFingerprint && book.schemaFingerprint !== source.schemaFingerprint,
      fullRunsLeftToday: Math.max(0, FULL_RUNS_PER_DAY - runsToday),
      canViewPages,
      ...(pages
        ? {
            overview: book.overview,
            pages: pages.map((page) => ({
              ...(page.content as BookTablePage),
              source: page.source,
              updatedAt: page.updatedAt.toISOString(),
            })),
          }
        : {}),
    };
  }

  async start(user: { id: string; email: string }, sourceId: string, llmConnectionId: string) {
    const source = await this.databaseSourcesService.getRuntimeForUser(user.id, sourceId);
    const connection = await this.llmConnectionsService.getRuntimeForUser(user.id, llmConnectionId);
    const llm = toAgentLlmRuntime(connection, connection.defaultModel);
    const { book: _book, ...knowledge } = await this.databaseKnowledgeService.getRuntimeKnowledge(sourceId);

    const existing = await this.prisma.databaseBook.findUnique({
      where: { databaseSourceId: sourceId },
      include: { pages: { select: { tableKey: true, schemaHash: true, source: true } } },
    });
    if (existing?.status === BookStatus.RUNNING) {
      throw new ConflictException('This database is already being improved.');
    }

    const pages = new Map((existing?.pages ?? []).map((page) => [page.tableKey, page]));
    const hashes = new Map(knowledge.tables.map((table) => [tableKey(table), tableSchemaHash(table)]));
    const todo = orderByImportance(knowledge.tables).filter((table) => {
      const page = pages.get(tableKey(table));
      // A page a person corrected is never overwritten by the model.
      return !page || (page.source !== BookPageSource.HUMAN && page.schemaHash !== hashes.get(tableKey(table)));
    });
    const needsOverview = !existing?.overview || todo.length > 0 || existing.status !== BookStatus.READY;
    if (knowledge.tables.length === 0) {
      throw new ConflictException('This database has no tables to read.');
    }

    const day = utcDay();
    const runsToday = existing?.runsDay === day ? existing.fullRunsToday : 0;
    const fullRun = todo.length === knowledge.tables.length;
    if (fullRun && runsToday >= FULL_RUNS_PER_DAY) {
      throw new HttpException(
        { error: { message: `You can rebuild a database's knowledge ${FULL_RUNS_PER_DAY} times a day. Try again tomorrow.`, code: 'BOOK_DAILY_LIMIT', statusCode: 429, retryable: false } },
        429,
      );
    }

    const data = {
      status: BookStatus.RUNNING,
      tokensUsed: 0,
      tablesTotal: knowledge.tables.length,
      tablesDone: knowledge.tables.length - todo.length,
      lastError: null,
      cancelRequested: false,
      startedAt: new Date(),
      finishedAt: null,
      llmConnectionId,
      fullRunsToday: fullRun ? runsToday + 1 : runsToday,
      runsDay: day,
    };
    const book = await this.prisma.databaseBook.upsert({
      where: { databaseSourceId: sourceId },
      create: { ...data, databaseSourceId: sourceId },
      update: data,
      select: { id: true },
    });
    // Pages of tables that no longer exist.
    await this.prisma.bookPage.deleteMany({ where: { bookId: book.id, tableKey: { notIn: [...hashes.keys()] } } });

    if (todo.length === 0 && !needsOverview) {
      await this.finish(book.id, BookStatus.READY, source.schemaFingerprint, null);
    } else {
      void this.run({ bookId: book.id, userId: user.id, source, llm, knowledge, todo, hashes });
    }
    return this.getStatus(user, sourceId);
  }

  async cancel(user: { id: string; email: string }, sourceId: string) {
    await this.prisma.databaseBook.updateMany({
      where: { databaseSourceId: sourceId, databaseSource: { userId: user.id }, status: BookStatus.RUNNING },
      data: { cancelRequested: true },
    });
    return this.getStatus(user, sourceId);
  }

  private async run(input: {
    bookId: string;
    userId: string;
    source: Awaited<ReturnType<DatabaseSourcesService['getRuntimeForUser']>>;
    llm: AgentLlmRuntime;
    knowledge: DatabaseKnowledgeRuntime;
    todo: CatalogTable[];
    hashes: Map<string, string>;
  }) {
    let tokens = 0;
    let failures = 0;
    let failed = 0;
    let stop: BookStatus | null = null;
    let lastError: string | null = null;
    const queue = [...input.todo];

    const worker = async () => {
      while (queue.length > 0 && !stop) {
        const book = await this.prisma.databaseBook.findUnique({ where: { id: input.bookId }, select: { cancelRequested: true } });
        if (!book || book.cancelRequested) {
          stop = BookStatus.CANCELLED;
          return;
        }
        if (tokens >= BOOK_TOKEN_LIMIT) {
          stop = BookStatus.PARTIAL;
          lastError = `Stopped at the ${BOOK_TOKEN_LIMIT.toLocaleString('en')} token limit. Press Improve accuracy to continue.`;
          return;
        }
        const table = queue.shift()!;
        try {
          const { page, tokenUsage } = await withRetry(async () =>
            this.agentGatewayService.improveTable({
              requestId: this.agentGatewayService.createRequestId(),
              // Fresh per call: a SQLite source's download link expires.
              database: await this.databaseSourcesService.toAgentDatabaseRuntime(input.source),
              llm: input.llm,
              knowledge: input.knowledge,
              table: { schemaName: table.schemaName, name: table.name },
            }),
          );
          const used = Math.round(tokenUsage?.totalTokens ?? 0);
          tokens += used;
          failures = 0;
          await this.prisma.$transaction([
            this.prisma.bookPage.upsert({
              where: { bookId_tableKey: { bookId: input.bookId, tableKey: tableKey(table) } },
              create: { bookId: input.bookId, tableKey: tableKey(table), schemaHash: input.hashes.get(tableKey(table))!, content: page as Prisma.InputJsonValue },
              update: { schemaHash: input.hashes.get(tableKey(table))!, content: page as Prisma.InputJsonValue, source: BookPageSource.LLM },
            }),
            this.prisma.databaseBook.update({
              where: { id: input.bookId },
              data: { tablesDone: { increment: 1 }, tokensUsed: tokens },
            }),
            this.recordTokens(input.userId, input.llm.model, tokenUsage),
          ]);
        } catch (error) {
          failed += 1;
          failures += 1;
          lastError = `${table.name}: ${normalizeApiError(error, 'The table could not be read.').message}`;
          this.logger.warn(`Improver failed on ${input.source.id}/${table.name}: ${lastError}`);
          if (failures >= MAX_CONSECUTIVE_FAILURES) stop = BookStatus.FAILED;
        }
      }
    };

    try {
      await Promise.all(Array.from({ length: CONCURRENCY }, worker));
      if (stop) {
        await this.finish(input.bookId, stop, null, lastError);
        return;
      }

      const pages = await this.prisma.bookPage.findMany({ where: { bookId: input.bookId }, select: { content: true } });
      const { overview, tokenUsage } = await withRetry(async () =>
        this.agentGatewayService.improveOverview({
          requestId: this.agentGatewayService.createRequestId(),
          database: await this.databaseSourcesService.toAgentDatabaseRuntime(input.source),
          llm: input.llm,
          knowledge: { ...input.knowledge, book: { tables: pages.map((page) => page.content as BookTablePage) } },
        }),
      );
      tokens += Math.round(tokenUsage?.totalTokens ?? 0);
      await this.prisma.$transaction([
        this.prisma.databaseBook.update({ where: { id: input.bookId }, data: { overview, tokensUsed: tokens } }),
        this.recordTokens(input.userId, input.llm.model, tokenUsage),
      ]);
      await this.finish(
        input.bookId,
        failed > 0 ? BookStatus.PARTIAL : BookStatus.READY,
        input.source.schemaFingerprint,
        failed > 0 ? `${failed} table${failed === 1 ? '' : 's'} could not be read. Last error: ${lastError}` : null,
      );
    } catch (error) {
      const message = normalizeApiError(error, 'The Improver stopped unexpectedly.').message;
      this.logger.error(`Improver run ${input.bookId} failed: ${message}`);
      await this.finish(input.bookId, BookStatus.FAILED, null, message).catch(() => undefined);
    }
  }

  private finish(bookId: string, status: BookStatus, schemaFingerprint: string | null | undefined, lastError: string | null) {
    return this.prisma.databaseBook.update({
      where: { id: bookId },
      data: {
        status,
        lastError,
        finishedAt: new Date(),
        cancelRequested: false,
        ...(schemaFingerprint ? { schemaFingerprint } : {}),
      },
    });
  }

  private recordTokens(userId: string, model: string, usage: { inputTokens: number; outputTokens: number } | null) {
    return this.prisma.tokenUsageEntry.create({
      data: {
        userId,
        kind: 'improver',
        model,
        inputTokens: Math.round(usage?.inputTokens ?? 0),
        outputTokens: Math.round(usage?.outputTokens ?? 0),
      },
      select: { id: true },
    });
  }

  /** The read-only page view is for debugging while the Improver is new. */
  private canViewPages(email: string): boolean {
    const allowed = (this.configService.get<string>('BOOK_PAGES_VISIBLE_TO') ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
    return allowed.includes('*') || allowed.includes(email.toLowerCase());
  }
}
