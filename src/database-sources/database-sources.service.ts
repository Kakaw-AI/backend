import { unlink } from 'node:fs/promises';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DatabaseSourceStatus } from '@prisma/client';
import { DatabaseKnowledgeService } from '../database-knowledge/database-knowledge.service';
import { AgentGatewayService } from '../chat/agent-gateway.service';
import { normalizeApiError } from '../common/errors/error-response';
import { DatabaseSourcesRepository } from './database-sources.repository';
import {
  SupportedDatabaseProvider,
  UploadedSqliteFile,
} from './database-sources.types';
import type { AgentDatabaseRuntime } from '../chat/chat.types';
import { SqliteFingerprintService } from './sqlite-fingerprint.service';

type CreateDatabaseSourceInput = {
  provider: SupportedDatabaseProvider;
  connectionString?: string;
  sqliteFile?: UploadedSqliteFile;
};

@Injectable()
export class DatabaseSourcesService {
  private readonly logger = new Logger(DatabaseSourcesService.name);

  constructor(
    private readonly databaseSourcesRepository: DatabaseSourcesRepository,
    private readonly agentGatewayService: AgentGatewayService,
    private readonly databaseKnowledgeService: DatabaseKnowledgeService,
    private readonly sqliteFingerprintService: SqliteFingerprintService,
  ) {}

  listForUser(userId: string) {
    return this.databaseSourcesRepository.findByUser(userId);
  }

  async getRuntimeForUser(userId: string, id: string) {
    const source = await this.databaseSourcesRepository.findRuntimeByUserAndId(
      userId,
      id,
    );

    if (!source) {
      throw new BadRequestException('Selected database source could not be found.');
    }

    if (source.status !== DatabaseSourceStatus.READY) {
      throw new BadRequestException(
        'Selected database source must finish sync before starting a chat.',
      );
    }

    return source;
  }

  async hasDatabaseSource(userId: string): Promise<boolean> {
    const readyConnectionCount =
      await this.databaseSourcesRepository.countReadyByUser(userId);

    return readyConnectionCount > 0;
  }

  async getOnboardingState(userId: string) {
    const [connectionCount, readyConnectionCount, latestSource] = await Promise.all([
      this.databaseSourcesRepository.countByUser(userId),
      this.databaseSourcesRepository.countReadyByUser(userId),
      this.databaseSourcesRepository.findLatestByUser(userId),
    ]);

    const blockingSync =
      readyConnectionCount === 0 &&
      latestSource &&
      latestSource.status !== DatabaseSourceStatus.READY
        ? {
            id: latestSource.id,
            label: this.toAgentDatabaseRuntime({
              id: latestSource.id,
              provider: latestSource.provider,
              sqliteOriginalFilename: latestSource.sqliteOriginalFilename,
            }).label,
            provider: latestSource.provider,
            status: latestSource.status,
            lastError: latestSource.lastError,
            lastTestedAt: latestSource.lastTestedAt?.toISOString() ?? null,
            lastSyncedAt: latestSource.lastSyncedAt?.toISOString() ?? null,
            syncRequestedAt: latestSource.syncRequestedAt?.toISOString() ?? null,
            createdAt: latestSource.createdAt.toISOString(),
            updatedAt: latestSource.updatedAt.toISOString(),
          }
        : null;

    return {
      hasDatabaseSource: readyConnectionCount > 0,
      connectionCount,
      isFirstConnection: connectionCount === 0,
      blockingSync,
    };
  }

  async createForUser(userId: string, input: CreateDatabaseSourceInput) {
    switch (input.provider) {
      case 'postgresql':
        return this.createPostgresqlSource(userId, input.connectionString);
      case 'sqlite':
        return this.createSqliteSource(userId, input.sqliteFile);
    }
  }

  async refreshForUser(userId: string, id: string) {
    const source = await this.databaseSourcesRepository.findRuntimeByUserAndId(
      userId,
      id,
    );

    if (!source) {
      throw new BadRequestException('Selected database source could not be found.');
    }

    const REFRESH_COOLDOWN_MS = 30_000;
    const lastSynced = source.lastSyncedAt;
    if (lastSynced && Date.now() - lastSynced.getTime() < REFRESH_COOLDOWN_MS) {
      throw new BadRequestException(
        'Please wait 30 seconds before refreshing again.',
      );
    }

    const syncingSource = await this.databaseSourcesRepository.markSyncing(source.id);
    this.queueSync(syncingSource.id);
    return syncingSource;
  }

  async discardUploadedFile(filePath: string) {
    await unlink(filePath).catch(() => undefined);
  }

  private async createPostgresqlSource(
    userId: string,
    connectionString?: string,
  ) {
    if (!connectionString) {
      throw new BadRequestException(
        'A PostgreSQL connection string is required.',
      );
    }

    const pendingSource = await this.databaseSourcesRepository.createPending({
      userId,
      provider: 'postgresql',
      connectionString,
    });

    const syncingSource = await this.databaseSourcesRepository.markSyncing(
      pendingSource.id,
    );
    this.queueSync(syncingSource.id);
    return syncingSource;
  }

  private async createSqliteSource(userId: string, sqliteFile?: UploadedSqliteFile) {
    if (!sqliteFile) {
      throw new BadRequestException('A SQLite database file is required.');
    }

    const sqliteFingerprint = await this.sqliteFingerprintService.fingerprint(
      sqliteFile.path,
    );
    const existingSource =
      await this.databaseSourcesRepository.findSqliteDuplicateByFingerprint(
        userId,
        sqliteFingerprint,
      );

    if (existingSource) {
      await this.discardUploadedFile(sqliteFile.path);
      return existingSource;
    }

    const pendingSource = await this.databaseSourcesRepository.createPending({
      userId,
      provider: 'sqlite',
      sqliteFilePath: sqliteFile.path,
      sqliteOriginalFilename: sqliteFile.originalName,
      sqliteFingerprint,
    });

    const syncingSource = await this.databaseSourcesRepository.markSyncing(
      pendingSource.id,
    );
    this.queueSync(syncingSource.id);
    return syncingSource;
  }

  private queueSync(sourceId: string) {
    void this.runSync(sourceId);
  }

  private async runSync(sourceId: string) {
    const source = await this.databaseSourcesRepository.findRuntimeById(sourceId);
    if (!source) {
      return;
    }

    try {
      const syncResult = await this.agentGatewayService.syncDatabaseSource({
        requestId: this.agentGatewayService.createRequestId(),
        userId: source.userId,
        database: this.toAgentDatabaseRuntime(source),
      });

      await this.databaseKnowledgeService.replaceCatalog(source.id, {
        schemaFingerprint: syncResult.schemaFingerprint,
        syncMetadata: syncResult.syncMetadata,
        tables: syncResult.catalog.tables,
        knowledgeDocuments: syncResult.catalog.knowledgeDocuments,
      });

      await this.databaseSourcesRepository.markReady(source.id, {
        schemaFingerprint: syncResult.schemaFingerprint,
        syncMetadata: syncResult.syncMetadata,
      });
    } catch (error) {
      const normalized = normalizeApiError(
        error,
        'Unable to sync the selected database with the agent runtime.',
      );
      this.logger.error(
        `Sync failed for database source ${source.id}: ${normalized.message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.databaseSourcesRepository.markFailure(
        source.id,
        normalized.message,
      );
    }
  }

  toAgentDatabaseRuntime(
    source: {
      id: string;
      provider: string;
      schemaFingerprint?: string | null;
      connectionString?: string | null;
      sqliteFilePath?: string | null;
      sqliteOriginalFilename?: string | null;
    },
  ): AgentDatabaseRuntime {
    return {
      sourceId: source.id,
      provider: source.provider as SupportedDatabaseProvider,
      label:
        source.provider === 'sqlite'
          ? source.sqliteOriginalFilename?.trim() || 'SQLite upload'
          : 'PostgreSQL connection',
      schemaFingerprint: source.schemaFingerprint ?? undefined,
      connectionString:
        source.provider === 'postgresql'
          ? source.connectionString ?? undefined
          : undefined,
      sqliteFilePath:
        source.provider === 'sqlite'
          ? source.sqliteFilePath ?? undefined
          : undefined,
      sqliteOriginalFilename:
        source.provider === 'sqlite'
          ? source.sqliteOriginalFilename ?? undefined
          : undefined,
    };
  }
}
