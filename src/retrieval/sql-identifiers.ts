/**
 * Reads the SQL a run actually executed back out of a stored agent trace.
 *
 * `tool_calls` is a flat JSON array the agent accumulates across pipeline
 * layers. Two entries mention SQL and they mean different things:
 *
 *   {tool: "sql_generation", sql, rationale}  — the first draft. Emitted even
 *                                               when execution later fails.
 *   {tool: "sql_execution",  sql, rowCount}   — emitted ONLY from a return path
 *                                               where the query resolved.
 *
 * So the presence of an `sql_execution` entry is the one trustworthy success
 * signal in the schema. Trace `status` is not usable: a run that exhausts its
 * repair attempts returns an answer string rather than setting `errorMessage`,
 * and therefore persists as COMPLETED with error = NULL.
 */

export type ExecutedSql = {
  sql: string;
  rowCount: number;
};

type ToolCall = Record<string, unknown>;

function asToolCallArray(toolCalls: unknown): ToolCall[] {
  if (!Array.isArray(toolCalls)) {
    return [];
  }
  return toolCalls.filter(
    (entry): entry is ToolCall => !!entry && typeof entry === 'object',
  );
}

/**
 * The SQL that ran, or null if none did.
 *
 * Takes the LAST `sql_execution` entry, not the first: the execution layer
 * mutates its local `sql` in place across repairs, so later entries carry the
 * corrected query. The first one may be the version that failed.
 */
export function extractSqlFromToolCalls(toolCalls: unknown): ExecutedSql | null {
  const entries = asToolCallArray(toolCalls);

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry['tool'] !== 'sql_execution') {
      continue;
    }

    const sql = typeof entry['sql'] === 'string' ? entry['sql'].trim() : '';
    if (!sql) {
      continue;
    }

    const rawRowCount = entry['rowCount'];
    const rowCount = typeof rawRowCount === 'number' ? rawRowCount : 0;
    return { sql, rowCount };
  }

  return null;
}

const SQL_SOURCE_KEYWORDS = /\b(?:from|join)\s+([a-zA-Z_][\w$]*(?:\.[a-zA-Z_][\w$]*)*)/gi;

/**
 * Table names referenced in a query, best-effort.
 *
 * Deliberately a lexer, not a parser: this feeds example pinning and staleness
 * checks, where over-collecting is harmless (a spurious name simply fails the
 * catalog check) and a parse error on valid dialect SQL would not be. Strings
 * and comments are stripped first so a literal cannot masquerade as a table.
 */
export function extractReferencedTables(sql: string): string[] {
  const stripped = stripLiteralsAndComments(sql);
  const found = new Set<string>();

  for (const match of stripped.matchAll(SQL_SOURCE_KEYWORDS)) {
    const identifier = match[1];
    if (!identifier) {
      continue;
    }
    // Keep only the bare table name; schema qualification is compared
    // case-insensitively against the catalog elsewhere.
    const parts = identifier.split('.');
    found.add(parts[parts.length - 1].toLowerCase());
  }

  return [...found];
}

/** Every bare identifier in the query, for staleness checks against a catalog. */
export function extractReferencedIdentifiers(sql: string): string[] {
  const stripped = stripLiteralsAndComments(sql);
  const found = new Set<string>();

  for (const match of stripped.matchAll(/[a-zA-Z_][\w$]*/g)) {
    found.add(match[0].toLowerCase());
  }

  return [...found];
}

function stripLiteralsAndComments(sql: string): string {
  let result = '';
  let index = 0;

  while (index < sql.length) {
    const char = sql[index];

    if (char === "'" || char === '"' || char === '`') {
      const closing = char;
      let end = index + 1;
      while (end < sql.length) {
        if (sql[end] === closing) {
          if (sql[end + 1] === closing) {
            end += 2;
            continue;
          }
          break;
        }
        end += 1;
      }
      result += ' ';
      index = end + 1;
      continue;
    }

    if (char === '-' && sql[index + 1] === '-') {
      const end = sql.indexOf('\n', index);
      index = end === -1 ? sql.length : end;
      result += ' ';
      continue;
    }

    if (char === '/' && sql[index + 1] === '*') {
      const end = sql.indexOf('*/', index + 2);
      index = end === -1 ? sql.length : end + 2;
      result += ' ';
      continue;
    }

    result += char;
    index += 1;
  }

  return result;
}
