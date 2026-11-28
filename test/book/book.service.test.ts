import { describe, expect, it } from 'vitest';
import { orderByImportance, tableSchemaHash } from '../../src/book/book.service';

const table = (name: string, rowCount: number, foreignKeys: Array<{ sourceColumn: string; targetTable: string }> = []) => ({
  schemaName: 'public',
  name,
  rowCount,
  columns: [{ name: 'id', dataType: 'int', isNullable: false, isPrimaryKey: true, ordinalPosition: 1 }],
  foreignKeys: foreignKeys.map((fk) => ({ ...fk, targetSchema: 'public', targetColumn: 'id' })),
});

describe('orderByImportance', () => {
  it('puts connected tables first, then larger ones', () => {
    const order = orderByImportance([
      table('audit_log', 90_000),
      table('orders', 3_000, [{ sourceColumn: 'customer_id', targetTable: 'customers' }]),
      table('customers', 400),
      table('notes', 10),
    ]).map((item) => item.name);
    expect(order).toEqual(['orders', 'customers', 'audit_log', 'notes']);
  });
});

describe('tableSchemaHash', () => {
  it('ignores row counts and changes with the columns', () => {
    const base = table('orders', 10);
    expect(tableSchemaHash({ ...base, rowCount: 99 })).toBe(tableSchemaHash(base));
    const widened = { ...base, columns: [...base.columns, { ...base.columns[0], name: 'total', isPrimaryKey: false }] };
    expect(tableSchemaHash(widened)).not.toBe(tableSchemaHash(base));
  });
});
