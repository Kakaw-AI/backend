import { describe, expect, it } from 'vitest';
import {
  extractReferencedIdentifiers,
  extractReferencedTables,
  extractSqlFromToolCalls,
} from '../../src/retrieval/sql-identifiers';

describe('extractSqlFromToolCalls', () => {
  it('returns the SQL that executed', () => {
    const toolCalls = [
      { tool: 'schema_resolution', corrections: [] },
      { tool: 'sql_generation', sql: 'SELECT 1', rationale: 'draft' },
      { tool: 'sql_execution', sql: 'SELECT id FROM orders', rowCount: 42 },
    ];

    expect(extractSqlFromToolCalls(toolCalls)).toEqual({
      sql: 'SELECT id FROM orders',
      rowCount: 42,
    });
  });

  it('prefers the last execution, which carries any repairs', () => {
    // The execution layer mutates its local `sql` across repair attempts, so a
    // later entry is the corrected query and an earlier one may be the broken
    // version.
    const toolCalls = [
      { tool: 'sql_execution', sql: 'SELECT custmer_id FROM orders', rowCount: 0 },
      { tool: 'sql_execution', sql: 'SELECT customer_id FROM orders', rowCount: 7 },
    ];

    expect(extractSqlFromToolCalls(toolCalls)?.sql).toBe(
      'SELECT customer_id FROM orders',
    );
  });

  it('returns null when only a generation entry exists', () => {
    // This is the exhausted-repair case: SQL was drafted but never ran. Such a
    // run still persists as COMPLETED with error = NULL, which is exactly why
    // trace status cannot be trusted and this signal can.
    const toolCalls = [
      { tool: 'sql_generation', sql: 'SELECT nope FROM missing', rationale: null },
    ];

    expect(extractSqlFromToolCalls(toolCalls)).toBeNull();
  });

  it('degrades safely on malformed input', () => {
    expect(extractSqlFromToolCalls([])).toBeNull();
    expect(extractSqlFromToolCalls(null)).toBeNull();
    expect(extractSqlFromToolCalls(undefined)).toBeNull();
    expect(extractSqlFromToolCalls('not an array')).toBeNull();
    expect(extractSqlFromToolCalls([null, 3, 'x'])).toBeNull();
    expect(
      extractSqlFromToolCalls([{ tool: 'sql_execution', sql: '   ' }]),
    ).toBeNull();
  });

  it('defaults a missing rowCount to zero rather than throwing', () => {
    expect(
      extractSqlFromToolCalls([{ tool: 'sql_execution', sql: 'SELECT 1' }]),
    ).toEqual({ sql: 'SELECT 1', rowCount: 0 });
  });
});

describe('extractReferencedTables', () => {
  it('finds tables behind FROM and JOIN, schema-qualified or not', () => {
    const tables = extractReferencedTables(
      `SELECT c.name, sum(o.total)
       FROM public.customers c
       JOIN orders o ON o.customer_id = c.id
       LEFT JOIN order_items oi ON oi.order_id = o.id
       GROUP BY c.name`,
    );

    expect(new Set(tables)).toEqual(
      new Set(['customers', 'orders', 'order_items']),
    );
  });

  it('does not mistake a string literal for a table', () => {
    const tables = extractReferencedTables(
      "SELECT * FROM orders WHERE note = 'from secret_table'",
    );
    expect(tables).toEqual(['orders']);
  });

  it('ignores commented-out SQL', () => {
    const tables = extractReferencedTables(
      'SELECT 1 FROM orders -- FROM archived_orders\n/* FROM other */',
    );
    expect(tables).toEqual(['orders']);
  });
});

describe('extractReferencedIdentifiers', () => {
  it('collects identifiers but not string contents', () => {
    const identifiers = extractReferencedIdentifiers(
      "SELECT customer_id FROM orders WHERE status = 'shipped'",
    );

    expect(identifiers).toContain('customer_id');
    expect(identifiers).toContain('orders');
    expect(identifiers).not.toContain('shipped');
  });
});
