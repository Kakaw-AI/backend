-- KAKAW retrieval baseline queries
--
-- Run these against the backend's own Postgres weekly. Prisma keeps the
-- camelCase field names as column names, so they must be double-quoted. Everything here reads columns that already exist —
-- no instrumentation needed except `columnCount` / `estimatedCatalogTokens`,
-- which land in "syncMetadata" on each source's next sync.
--
-- The phase-8 gate is query 1: do not build schema subsetting until a real
-- source shows more than 60 tables or ~12k estimated catalog tokens.


-- ─────────────────────────────────────────────────────────────────────────────
-- 1. Catalog size distribution  →  gates schema subsetting
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  ("syncMetadata" ->> 'tableCount')::int              AS tables,
  ("syncMetadata" ->> 'columnCount')::int             AS columns,
  ("syncMetadata" ->> 'estimatedCatalogTokens')::int  AS est_tokens,
  count(*)                                           AS sources
FROM database_sources
WHERE "syncMetadata" ? 'tableCount'
GROUP BY 1, 2, 3
ORDER BY est_tokens DESC NULLS LAST;

-- Headline percentiles.
SELECT
  count(*)                                                                    AS sources,
  percentile_disc(0.50) WITHIN GROUP (ORDER BY ("syncMetadata"->>'tableCount')::int) AS p50_tables,
  percentile_disc(0.95) WITHIN GROUP (ORDER BY ("syncMetadata"->>'tableCount')::int) AS p95_tables,
  max(("syncMetadata"->>'tableCount')::int)                                    AS max_tables,
  count(*) FILTER (WHERE ("syncMetadata"->>'estimatedCatalogTokens')::int > 12000) AS over_threshold
FROM database_sources
WHERE "syncMetadata" ? 'tableCount';


-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Execution success rate  →  the PRIMARY metric
--
-- A turn succeeded iff "toolCalls" contains an entry with tool = 'sql_execution'.
-- That entry is emitted only on a return path where the query actually ran, so
-- it is the one trustworthy signal.
-- ─────────────────────────────────────────────────────────────────────────────
WITH runs AS (
  SELECT
    id,
    "databaseSourceId",
    "createdAt",
    EXISTS (
      SELECT 1 FROM jsonb_array_elements("toolCalls"::jsonb) AS tc
      WHERE tc ->> 'tool' = 'sql_execution'
    ) AS executed,
    coalesce(jsonb_array_length("repairHistory"::jsonb), 0) AS repair_depth,
    ("chartSpec"::jsonb ->> 'rowCount')::int                AS row_count
  FROM agent_run_traces
  WHERE "toolCalls" IS NOT NULL
    AND jsonb_typeof("toolCalls"::jsonb) = 'array'
)
SELECT
  date_trunc('week', "createdAt")                                   AS week,
  count(*)                                                          AS turns,
  round(100.0 * count(*) FILTER (WHERE executed) / count(*), 1)     AS success_pct,
  round(avg(repair_depth) FILTER (WHERE executed), 2)               AS avg_repair_depth,
  round(100.0 * count(*) FILTER (WHERE executed AND row_count = 0)
        / nullif(count(*) FILTER (WHERE executed), 0), 1)           AS zero_row_pct
FROM runs
GROUP BY 1
ORDER BY 1;

-- Same, per source — retrieval is scoped per databaseSourceId, so this is the
-- grain that matters when judging whether query memory helped.
WITH runs AS (
  SELECT
    "databaseSourceId",
    EXISTS (
      SELECT 1 FROM jsonb_array_elements("toolCalls"::jsonb) AS tc
      WHERE tc ->> 'tool' = 'sql_execution'
    ) AS executed,
    coalesce(jsonb_array_length("repairHistory"::jsonb), 0) AS repair_depth
  FROM agent_run_traces
  WHERE "toolCalls" IS NOT NULL
    AND jsonb_typeof("toolCalls"::jsonb) = 'array'
)
SELECT
  "databaseSourceId",
  count(*)                                                      AS turns,
  round(100.0 * count(*) FILTER (WHERE executed) / count(*), 1) AS success_pct,
  round(avg(repair_depth), 2)                                   AS avg_repair_depth
FROM runs
GROUP BY 1
HAVING count(*) >= 20
ORDER BY success_pct ASC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Prompt cache effectiveness
--
-- cacheReadTokens / cacheWriteTokens were added when the repair prompt was
-- split so the schema catalog stays in a byte-identical cacheable prefix.
-- A high read ratio means that split is working. Watch this after adding
-- retrieval — if it collapses, something leaked into the system prompt.
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  date_trunc('week', "createdAt")                                   AS week,
  count(*)                                                          AS turns,
  round(avg(("tokenUsage"::jsonb ->> 'inputTokens')::numeric))       AS avg_input_tokens,
  round(avg(("tokenUsage"::jsonb ->> 'outputTokens')::numeric))      AS avg_output_tokens,
  round(100.0 * sum(("tokenUsage"::jsonb ->> 'cacheReadTokens')::numeric)
        / nullif(sum(("tokenUsage"::jsonb ->> 'cacheReadTokens')::numeric)
               + sum(("tokenUsage"::jsonb ->> 'cacheWriteTokens')::numeric), 0), 1)
                                                                    AS cache_read_pct
FROM agent_run_traces
WHERE "tokenUsage" IS NOT NULL
GROUP BY 1
ORDER BY 1;


-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Query memory corpus size  →  how much phase 1 has to work with
--
-- Distinct normalized questions per source that produced a query which actually
-- executed and returned rows. This is the number of entries the backfill will
-- create. If it is tiny, few-shot retrieval will not fire often and phase 4
-- should wait.
-- ─────────────────────────────────────────────────────────────────────────────
WITH usable AS (
  SELECT
    "databaseSourceId",
    lower(regexp_replace(btrim(question), '\s+', ' ', 'g')) AS normalized_question
  FROM agent_run_traces
  WHERE "toolCalls" IS NOT NULL
    AND jsonb_typeof("toolCalls"::jsonb) = 'array'
    AND EXISTS (
      SELECT 1 FROM jsonb_array_elements("toolCalls"::jsonb) AS tc
      WHERE tc ->> 'tool' = 'sql_execution'
        AND (tc ->> 'rowCount')::int > 0
    )
)
SELECT
  "databaseSourceId",
  count(*)                              AS usable_turns,
  count(DISTINCT normalized_question)   AS distinct_questions,
  round(100.0 * (count(*) - count(DISTINCT normalized_question)) / nullif(count(*), 0), 1)
                                        AS repeat_pct   -- what exact-tier memory saves
FROM usable
GROUP BY 1
ORDER BY distinct_questions DESC;


-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Trace table growth  →  agent_run_traces has no TTL and is never pruned
-- ─────────────────────────────────────────────────────────────────────────────
SELECT
  count(*)                                        AS total_traces,
  min("createdAt")                                AS oldest,
  pg_size_pretty(pg_total_relation_size('agent_run_traces')) AS table_size
FROM agent_run_traces;
