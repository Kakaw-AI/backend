import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { DatabaseCatalogInput, DatabaseKnowledgeRuntime } from './database-knowledge.types';

@Injectable()
export class DatabaseKnowledgeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async replaceCatalog(sourceId: string, catalog: DatabaseCatalogInput): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existingTables = await tx.databaseSourceTable.findMany({
        where: { databaseSourceId: sourceId },
        select: { id: true },
      });
      const tableIds = existingTables.map((table) => table.id);

      if (tableIds.length > 0) {
        await tx.databaseSourceRelation.deleteMany({
          where: {
            OR: [
              { sourceTableId: { in: tableIds } },
              { targetTableId: { in: tableIds } },
            ],
          },
        });
        await tx.databaseSourceIndex.deleteMany({
          where: { tableId: { in: tableIds } },
        });
        await tx.databaseSourceColumn.deleteMany({
          where: { tableId: { in: tableIds } },
        });
      }

      await tx.databaseSourceTable.deleteMany({
        where: { databaseSourceId: sourceId },
      });
      await tx.databaseSourceKnowledgeDocument.deleteMany({
        where: { databaseSourceId: sourceId },
      });

      const tableIdByKey = new Map<string, string>();

      for (const table of catalog.tables) {
        const createdTable = await tx.databaseSourceTable.create({
          data: {
            databaseSourceId: sourceId,
            schemaName: table.schemaName ?? null,
            name: table.name,
            rowCount: table.rowCount ?? null,
            sampleRows: (table.sampleRows ?? []) as Prisma.InputJsonValue,
          },
          select: { id: true },
        });

        tableIdByKey.set(this.toTableKey(table.schemaName, table.name), createdTable.id);

        if (table.columns.length > 0) {
          await tx.databaseSourceColumn.createMany({
            data: table.columns.map((column) => ({
              tableId: createdTable.id,
              name: column.name,
              normalizedName: column.normalizedName,
              dataType: column.dataType,
              isNullable: column.isNullable,
              isPrimaryKey: column.isPrimaryKey,
              ordinalPosition: column.ordinalPosition,
              sampleValues: (column.sampleValues ?? []) as Prisma.InputJsonValue,
            })),
          });
        }

        if (table.indexes.length > 0) {
          await tx.databaseSourceIndex.createMany({
            data: table.indexes.map((index) => ({
              tableId: createdTable.id,
              name: index.name,
              columns: index.columns,
              isUnique: index.isUnique,
              isPrimary: index.isPrimary,
            })),
          });
        }
      }

      for (const table of catalog.tables) {
        const sourceTableId = tableIdByKey.get(this.toTableKey(table.schemaName, table.name));
        if (!sourceTableId) {
          continue;
        }

        for (const foreignKey of table.foreignKeys) {
          const targetTableId = tableIdByKey.get(
            this.toTableKey(foreignKey.targetSchema, foreignKey.targetTable),
          );
          if (!targetTableId) {
            continue;
          }

          await tx.databaseSourceRelation.create({
            data: {
              sourceTableId,
              targetTableId,
              constraintName: foreignKey.constraintName ?? null,
              sourceColumn: foreignKey.sourceColumn,
              targetColumn: foreignKey.targetColumn,
              onUpdate: foreignKey.onUpdate ?? null,
              onDelete: foreignKey.onDelete ?? null,
            },
          });
        }
      }

      if (catalog.knowledgeDocuments.length > 0) {
        await tx.databaseSourceKnowledgeDocument.createMany({
          data: catalog.knowledgeDocuments.map((document) => ({
            databaseSourceId: sourceId,
            scope: document.scope,
            referenceType: document.referenceType,
            referenceKey: document.referenceKey,
            content: document.content,
            metadata: (document.metadata ?? {}) as Prisma.InputJsonValue,
          })),
        });
      }

      await tx.databaseSource.update({
        where: { id: sourceId },
        data: {
          schemaFingerprint: catalog.schemaFingerprint ?? null,
          syncMetadata: (catalog.syncMetadata ?? {}) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
    }, { timeout: 30_000 });
  }

  async getSchemaFingerprint(sourceId: string): Promise<string | null> {
    const source = await this.prisma.databaseSource.findUnique({
      where: { id: sourceId },
      select: { schemaFingerprint: true },
    });

    return source?.schemaFingerprint ?? null;
  }

  async getRuntimeKnowledge(sourceId: string): Promise<DatabaseKnowledgeRuntime> {
    const source = await this.prisma.databaseSource.findUnique({
      where: { id: sourceId },
      select: {
        schemaFingerprint: true,
        syncMetadata: true,
        tables: {
          orderBy: [{ schemaName: 'asc' }, { name: 'asc' }],
          select: {
            id: true,
            schemaName: true,
            name: true,
            rowCount: true,
            columns: {
              orderBy: { ordinalPosition: 'asc' },
              select: {
                name: true,
                normalizedName: true,
                dataType: true,
                isNullable: true,
                isPrimaryKey: true,
                ordinalPosition: true,
                sampleValues: true,
              },
            },
            indexes: {
              orderBy: { name: 'asc' },
              select: {
                name: true,
                columns: true,
                isUnique: true,
                isPrimary: true,
              },
            },
            outgoingRelations: {
              orderBy: [{ targetTable: { schemaName: 'asc' } }, { targetTable: { name: 'asc' } }],
              select: {
                constraintName: true,
                sourceColumn: true,
                targetColumn: true,
                onUpdate: true,
                onDelete: true,
                targetTable: {
                  select: {
                    schemaName: true,
                    name: true,
                  },
                },
              },
            },
          },
        },
        knowledgeDocuments: {
          orderBy: [{ scope: 'asc' }, { referenceType: 'asc' }, { referenceKey: 'asc' }],
          select: {
            scope: true,
            referenceType: true,
            referenceKey: true,
            content: true,
            metadata: true,
          },
        },
      },
    });

    return {
      schemaFingerprint: source?.schemaFingerprint ?? null,
      summary: this.buildSummary(source?.syncMetadata),
      tables:
        source?.tables.map((table) => ({
          schemaName: table.schemaName,
          name: table.name,
          rowCount: table.rowCount,
          columns: table.columns.map((column) => ({
            name: column.name,
            normalizedName: column.normalizedName,
            dataType: column.dataType,
            isNullable: column.isNullable,
            isPrimaryKey: column.isPrimaryKey,
            ordinalPosition: column.ordinalPosition,
            sampleValues: Array.isArray(column.sampleValues)
              ? column.sampleValues
              : [],
          })),
          indexes: table.indexes.map((index) => ({
            name: index.name,
            columns: index.columns,
            isUnique: index.isUnique,
            isPrimary: index.isPrimary,
          })),
          foreignKeys: table.outgoingRelations.map((relation) => ({
            constraintName: relation.constraintName,
            sourceColumn: relation.sourceColumn,
            targetTable: relation.targetTable.name,
            targetSchema: relation.targetTable.schemaName,
            targetColumn: relation.targetColumn,
            onUpdate: relation.onUpdate,
            onDelete: relation.onDelete,
          })),
        })) ?? [],
      knowledgeDocuments:
        source?.knowledgeDocuments.map((document) => ({
          scope: document.scope,
          referenceType: document.referenceType,
          referenceKey: document.referenceKey,
          content: document.content,
          metadata:
            document.metadata && typeof document.metadata === 'object'
              ? (document.metadata as Record<string, unknown>)
              : {},
        })) ?? [],
    };
  }

  private toTableKey(schemaName: string | null | undefined, tableName: string) {
    return `${schemaName ?? ''}:${tableName}`;
  }

  private buildSummary(syncMetadata: unknown) {
    if (!syncMetadata || typeof syncMetadata !== 'object') {
      return '';
    }

    const record = syncMetadata as Record<string, unknown>;
    const tableCount =
      typeof record.tableCount === 'number' ? `${record.tableCount} tables` : null;
    const documentCount =
      typeof record.documentCount === 'number'
        ? `${record.documentCount} knowledge documents`
        : null;
    const provider =
      typeof record.provider === 'string' ? record.provider : null;

    return [provider, tableCount, documentCount].filter(Boolean).join(' · ');
  }
}
