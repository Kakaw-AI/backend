/**
 * The agent's introspection also sends indexes, normalizedName and FK
 * constraint names and rules (it fingerprints them). Nothing reads them at
 * question time, so they are not stored.
 */
export type DatabaseCatalogColumnInput = {
  name: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  ordinalPosition: number;
  sampleValues?: unknown[];
};

export type DatabaseCatalogForeignKeyInput = {
  sourceColumn: string;
  targetTable: string;
  targetSchema?: string | null;
  targetColumn: string;
};

export type DatabaseCatalogTableInput = {
  schemaName?: string | null;
  name: string;
  rowCount?: number | null;
  columns: DatabaseCatalogColumnInput[];
  foreignKeys: DatabaseCatalogForeignKeyInput[];
};

export type DatabaseCatalogInput = {
  schemaFingerprint?: string | null;
  syncMetadata?: Record<string, unknown>;
  tables: DatabaseCatalogTableInput[];
};

export type DatabaseKnowledgeRuntime = {
  schemaFingerprint: string | null;
  summary: string;
  tables: Array<{
    schemaName: string | null;
    name: string;
    rowCount: number | null;
    columns: DatabaseCatalogColumnInput[];
    foreignKeys: DatabaseCatalogForeignKeyInput[];
  }>;
};
