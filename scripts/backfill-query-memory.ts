/**
 * Rebuilds query memory from historical agent runs.
 *
 * Every chat turn since launch wrote its question and the SQL that executed to
 * `agent_run_traces`, and nothing ever read it back. This turns that history
 * into the query-memory corpus.
 *
 * Run manually. It is deliberately NOT wired into a Prisma migration or app
 * boot: `ensureDatabaseReady` runs `prisma migrate deploy` synchronously during
 * startup, so a job that walks tens of thousands of rows there would block
 * every deploy and, on failure, wedge the boot.
 *
 *   npx tsx scripts/backfill-query-memory.ts --dry-run
 *   npx tsx scripts/backfill-query-memory.ts
 *   npx tsx scripts/backfill-query-memory.ts --after-id <cuid>   # resume
 *
 * Safe to re-run: entries are upserted on (databaseSourceId, questionHash).
 * Traces are walked oldest-first so that when one question was asked several
 * times, the newest verified answer is what survives.
 */
import 'dotenv/config';
import { PrismaClient, QueryMemoryStatus } from '@prisma/client';
import {
  extractReferencedTables,
  extractSqlFromToolCalls,
} from '../src/retrieval/sql-identifiers';
import {
  normalizeQuestion,
  questionHash,
} from '../src/retrieval/question-literals';

const BATCH_SIZE = 500;

type Args = {
  dryRun: boolean;
  afterId: string | null;
};

function parseArgs(argv: string[]): Args {
  const afterIndex = argv.indexOf('--after-id');
  return {
    dryRun: argv.includes('--dry-run'),
    afterId: afterIndex !== -1 ? (argv[afterIndex + 1] ?? null) : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const prisma = new PrismaClient();

  const stats = {
    scanned: 0,
    noSql: 0,
    noFingerprint: 0,
    quarantined: 0,
    written: 0,
  };

  let cursor: string | null = args.afterId;
  let lastId: string | null = null;

  console.log(
    `Backfilling query memory${args.dryRun ? ' (DRY RUN — no writes)' : ''}...`,
  );

  try {
    for (;;) {
      const traces = await prisma.agentRunTrace.findMany({
        where: cursor ? { id: { gt: cursor } } : undefined,
        // Keyset pagination on the primary key: a full ordered scan, which is
        // the right shape for a one-time job and needs no extra index.
        orderBy: { id: 'asc' },
        take: BATCH_SIZE,
        select: {
          id: true,
          question: true,
          toolCalls: true,
          cacheHit: true,
          databaseSourceId: true,
          createdAt: true,
          databaseSource: { select: { schemaFingerprint: true } },
        },
      });

      if (traces.length === 0) {
        break;
      }

      for (const trace of traces) {
        stats.scanned += 1;
        lastId = trace.id;

        if (trace.cacheHit) {
          continue;
        }

        const executed = extractSqlFromToolCalls(trace.toolCalls);
        if (!executed) {
          stats.noSql += 1;
          continue;
        }

        // Historical traces carry no fingerprint of their own, so the source's
        // current one is the best available. Entries whose SQL no longer fits
        // the live schema are retired by revalidation, not guessed at here.
        const schemaFingerprint = trace.databaseSource?.schemaFingerprint;
        if (!schemaFingerprint) {
          stats.noFingerprint += 1;
          continue;
        }

        const normalized = normalizeQuestion(trace.question);
        if (!normalized) {
          continue;
        }

        const status =
          executed.rowCount > 0
            ? QueryMemoryStatus.ACTIVE
            : QueryMemoryStatus.QUARANTINED;
        if (status === QueryMemoryStatus.QUARANTINED) {
          stats.quarantined += 1;
        }

        const data = {
          databaseSourceId: trace.databaseSourceId,
          schemaFingerprint,
          question: trace.question.trim(),
          normalizedQuestion: normalized,
          questionHash: questionHash(trace.databaseSourceId, normalized),
          sql: executed.sql,
          tablesReferenced: extractReferencedTables(executed.sql),
          rowCount: executed.rowCount,
          status,
          sourceTraceId: trace.id,
        };

        if (!args.dryRun) {
          await prisma.queryMemoryEntry.upsert({
            where: {
              databaseSourceId_questionHash: {
                databaseSourceId: data.databaseSourceId,
                questionHash: data.questionHash,
              },
            },
            create: data,
            update: {
              schemaFingerprint: data.schemaFingerprint,
              question: data.question,
              sql: data.sql,
              tablesReferenced: data.tablesReferenced,
              rowCount: data.rowCount,
              status: data.status,
              sourceTraceId: data.sourceTraceId,
            },
          });
        }
        stats.written += 1;
      }

      cursor = traces[traces.length - 1].id;
      console.log(
        `  scanned ${stats.scanned}, usable ${stats.written} (last id ${cursor})`,
      );
    }

    console.log('\nDone.');
    console.table(stats);
    if (lastId) {
      console.log(`Resume with: --after-id ${lastId}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
