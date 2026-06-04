import { extname } from 'node:path';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { DatabaseSourceStatus } from '@prisma/client';
import { DatabaseKnowledgeService } from '../database-knowledge/database-knowledge.service';
import { AgentGatewayService } from '../chat/agent-gateway.service';
import { normalizeApiError } from '../common/errors/error-response';
import { R2Service } from '../storage/r2.service';
import { DatabaseSourcesRepository } from './database-sources.repository';
import {
  SQLITE_ALLOWED_EXTENSIONS,
  SQLITE_UPLOAD_MAX_BYTES,
  SupportedDatabaseProvider,
} from './database-sources.types';
import type { AgentDatabaseRuntime } from '../chat/chat.types';

type CreateSqliteSourceInput = {
  objectKey: string;
  originalFilename: string;
};

type CreateDatabaseSourceInput = {
  provider: SupportedDatabaseProvider;
  name?: string;
  connectionString?: string;
  sqlite?: CreateSqliteSourceInput;
};

@Injectable()
export class DatabaseSourcesService {
  private readonly logger = new Logger(DatabaseSourcesService.name);

  constructor(
    private readonly databaseSourcesRepository: DatabaseSourcesRepository,
    private readonly agentGatewayService: AgentGatewayService,
    private readonly databaseKnowledgeService: DatabaseKnowledgeService,
    private readonly r2Service: R2Service,
  ) {}

  /**
   * Issues a short-lived presigned PUT URL so the browser uploads the SQLite
   * file straight to R2 — our server never receives the file bytes.
   */
  async presignSqliteUpload(
    userId: string,
    input: { filename: string; size: number; contentType?: string },
  ): Promise<{ uploadUrl: string; objectKey: string }> {
    const filename = input.filename?.trim();
    if (!filename) {
      throw new BadRequestException('filename is required');
    }

    const extension = extname(filename).toLowerCase();
    if (!SQLITE_ALLOWED_EXTENSIONS.has(extension)) {
      throw new BadRequestException(
        'SQLite uploads must use a .db, .sqlite, or .sqlite3 file.',
      );
    }

    if (
      typeof input.size !== 'number' ||
      input.size <= 0 ||
      input.size > SQLITE_UPLOAD_MAX_BYTES
    ) {
      throw new BadRequestException(
        `File must be between 1 byte and ${SQLITE_UPLOAD_MAX_BYTES} bytes.`,
      );
    }

    const objectKey = this.r2Service.buildSqliteKey(userId, filename);
    const uploadUrl = await this.r2Service.presignUpload(
      objectKey,
      input.contentType?.trim() || 'application/octet-stream',
    );

    return { uploadUrl, objectKey };
  }

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
            label: this.resolveSourceLabel(
              latestSource.provider,
              latestSource.sqliteOriginalFilename,
              latestSource.name,
            ),
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
    const name = input.name?.trim() || undefined;
    switch (input.provider) {
      case 'postgresql':
        return this.createPostgresqlSource(userId, input.connectionString, name);
      case 'sqlite':
        return this.createSqliteSource(userId, input.sqlite, name);
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

  private async createPostgresqlSource(
    userId: string,
    connectionString?: string,
    name?: string,
  ) {
    if (!connectionString) {
      throw new BadRequestException(
        'A PostgreSQL connection string is required.',
      );
    }

    const pendingSource = await this.databaseSourcesRepository.createPending({
      userId,
      provider: 'postgresql',
      name,
      connectionString,
    });

    const syncingSource = await this.databaseSourcesRepository.markSyncing(
      pendingSource.id,
    );
    this.queueSync(syncingSource.id);
    return syncingSource;
  }

  private async createSqliteSource(
    userId: string,
    sqlite?: CreateSqliteSourceInput,
    name?: string,
  ) {
    const objectKey = sqlite?.objectKey?.trim();
    if (!objectKey) {
      throw new BadRequestException('A SQLite database upload is required.');
    }

    // Confirm the browser's direct upload landed in R2 and use the object's
    // ETag as a content fingerprint (replaces hashing a local file).
    let head: { etag: string; size: number };
    try {
      head = await this.r2Service.headObject(objectKey);
    } catch {
      throw new BadRequestException(
        'The uploaded SQLite file could not be found in storage. Please re-upload.',
      );
    }

    const sqliteFingerprint = head.etag || objectKey;
    const existingSource =
      await this.databaseSourcesRepository.findSqliteDuplicateByFingerprint(
        userId,
        sqliteFingerprint,
      );

    if (existingSource) {
      return existingSource;
    }

    const pendingSource = await this.databaseSourcesRepository.createPending({
      userId,
      provider: 'sqlite',
      name,
      sqliteObjectKey: objectKey,
      sqliteOriginalFilename: sqlite?.originalFilename?.trim() || 'database.sqlite',
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
        database: await this.toAgentDatabaseRuntime(source),
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

  private resolveSourceLabel(
    provider: string,
    sqliteOriginalFilename?: string | null,
    name?: string | null,
  ): string {
    const explicitName = name?.trim();
    if (explicitName) {
      return explicitName;
    }

    return provider === 'sqlite'
      ? sqliteOriginalFilename?.trim() || 'SQLite upload'
      : 'PostgreSQL connection';
  }

  async toAgentDatabaseRuntime(
    source: {
      id: string;
      provider: string;
      name?: string | null;
      schemaFingerprint?: string | null;
      connectionString?: string | null;
      sqliteObjectKey?: string | null;
      sqliteOriginalFilename?: string | null;
    },
  ): Promise<AgentDatabaseRuntime> {
    const isSqlite = source.provider === 'sqlite';
    const sqliteObjectKey = isSqlite
      ? source.sqliteObjectKey ?? undefined
      : undefined;

    // Short-lived presigned GET so the agent can download the file once and
    // cache it locally — the file never passes back through our server.
    const sqliteDownloadUrl = sqliteObjectKey
      ? await this.r2Service.presignDownload(sqliteObjectKey)
      : undefined;

    return {
      sourceId: source.id,
      provider: source.provider as SupportedDatabaseProvider,
      label: this.resolveSourceLabel(
        source.provider,
        source.sqliteOriginalFilename,
        source.name,
      ),
      schemaFingerprint: source.schemaFingerprint ?? undefined,
      connectionString:
        source.provider === 'postgresql'
          ? source.connectionString ?? undefined
          : undefined,
      sqliteObjectKey,
      sqliteDownloadUrl,
      sqliteOriginalFilename: isSqlite
        ? source.sqliteOriginalFilename ?? undefined
        : undefined,
    };
  }
}
