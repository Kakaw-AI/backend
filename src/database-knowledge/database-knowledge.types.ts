export type DatabaseCatalogColumnInput = {
  name: string;
  normalizedName: string;
  dataType: string;
  isNullable: boolean;
  isPrimaryKey: boolean;
  ordinalPosition: number;
  sampleValues?: unknown[];
};

export type DatabaseCatalogIndexInput = {
  name: string;
  columns: string[];
  isUnique: boolean;
  isPrimary: boolean;
};

export type DatabaseCatalogForeignKeyInput = {
  constraintName?: string | null;
  sourceColumn: string;
  targetTable: string;
  targetSchema?: string | null;
  targetColumn: string;
  onUpdate?: string | null;
  onDelete?: string | null;
};

export type DatabaseCatalogTableInput = {
  schemaName?: string | null;
  name: string;
  rowCount?: number | null;
  sampleRows?: Array<Record<string, unknown>>;
  columns: DatabaseCatalogColumnInput[];
  indexes: DatabaseCatalogIndexInput[];
  foreignKeys: DatabaseCatalogForeignKeyInput[];
};

export type DatabaseKnowledgeDocumentInput = {
  scope: string;
  referenceType: string;
  referenceKey: string;
  content: string;
  metadata?: Record<string, unknown>;
};

export type DatabaseCatalogInput = {
  schemaFingerprint?: string | null;
  syncMetadata?: Record<string, unknown>;
  tables: DatabaseCatalogTableInput[];
  knowledgeDocuments: DatabaseKnowledgeDocumentInput[];
};

export type DatabaseKnowledgeRuntime = {
  schemaFingerprint: string | null;
  summary: string;
  tables: Array<{
    schemaName: string | null;
    name: string;
    rowCount: number | null;
    columns: DatabaseCatalogColumnInput[];
    indexes: DatabaseCatalogIndexInput[];
    foreignKeys: DatabaseCatalogForeignKeyInput[];
  }>;
  knowledgeDocuments: DatabaseKnowledgeDocumentInput[];
};
